"""Baton SQL validator — schema-aware validation via sqlglot.

Validates generated dbt SQL against the real schema fetched from DataHub.
dbt Jinja (`{{ ref(...) }}` / `{{ source(...) }}`) is stripped into plain
table names before parsing, since sqlglot doesn't understand Jinja.
"""

import re

import sqlglot
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sqlglot import exp
from sqlglot.errors import ParseError, SqlglotError
from sqlglot.optimizer.qualify import qualify

app = FastAPI(title="baton-validator")

JINJA_REF = re.compile(r"\{\{\s*ref\(\s*['\"]([\w.]+)['\"]\s*\)\s*\}\}")
JINJA_SOURCE = re.compile(
    r"\{\{\s*source\(\s*['\"]([\w.]+)['\"]\s*,\s*['\"]([\w.]+)['\"]\s*\)\s*\}\}"
)
# Anything still wearing Jinja after ref()/source() are resolved. A macro like
# {{ filter_orders() }} cannot be checked against the catalog, and sqlglot will
# happily parse the leftover braces into something meaningless — so the model
# gets told to write real SQL instead of being handed a passing verdict.
JINJA_LEFTOVER = re.compile(r"\{\{.*?\}\}|\{%.*?%\}", re.DOTALL)


class ValidateRequest(BaseModel):
    sql: str
    # table name -> {column name -> type}, e.g. {"orders": {"order_id": "int"}}
    schema_map: dict[str, dict[str, str]] = Field(default_factory=dict)
    dialect: str = "snowflake"


def strip_dbt_jinja(sql: str) -> str:
    """Replace dbt ref()/source() macros with plain table names."""
    sql = JINJA_REF.sub(lambda m: m.group(1), sql)
    sql = JINJA_SOURCE.sub(lambda m: f"{m.group(1)}.{m.group(2)}", sql)
    return sql


@app.get("/health")
def health() -> dict:
    return {"ok": True, "sqlglot": sqlglot.__version__}


@app.post("/validate")
def validate(req: ValidateRequest) -> dict:
    sql = strip_dbt_jinja(req.sql)

    leftover = sorted(set(JINJA_LEFTOVER.findall(sql)))
    if leftover:
        return {
            "valid": False,
            "stage": "jinja",
            "errors": [
                f"Unsupported dbt template expression {m.strip()} — only "
                "{{ ref('model') }} and {{ source('src', 'table') }} can be "
                "resolved against the catalog. Write plain SQL instead."
                for m in leftover
            ],
            "columns_used": [], "tables_used": [], "output_columns": [],
        }

    try:
        statements = [s for s in sqlglot.parse(sql, dialect=req.dialect) if s]
    except ParseError as e:
        return {"valid": False, "stage": "parse", "errors": [str(e)],
                "columns_used": [], "tables_used": [], "output_columns": []}

    # A dbt model is exactly one SELECT. parse_one would silently keep only the
    # first statement, so "select 1; drop table orders" validated clean and the
    # drop still shipped in the file. And a bare DROP/DELETE/INSERT qualifies
    # without complaint, which would have put a destructive statement under a
    # header claiming it was validated against the live schema.
    if len(statements) != 1:
        return {
            "valid": False, "stage": "shape",
            "errors": [f"A dbt model must be a single statement; found {len(statements)}."],
            "columns_used": [], "tables_used": [], "output_columns": [],
        }

    tree = statements[0]
    if not isinstance(tree, exp.Query):
        return {
            "valid": False, "stage": "shape",
            "errors": [
                f"A dbt model must be a SELECT; found {tree.key.upper()}. "
                "Models describe a result set, they do not modify the warehouse."
            ],
            "columns_used": [], "tables_used": [], "output_columns": [],
        }

    try:
        qualified = qualify(
            tree,
            schema=req.schema_map or None,
            dialect=req.dialect,
            validate_qualify_columns=bool(req.schema_map),
        )
    except SqlglotError as e:
        return {"valid": False, "stage": "qualify", "errors": [str(e)],
                "columns_used": [], "tables_used": [], "output_columns": []}

    columns = sorted({c.sql(dialect=req.dialect) for c in qualified.find_all(exp.Column)})
    tables = sorted({t.name for t in qualified.find_all(exp.Table)})
    # The columns the model actually returns. `columns_used` is every column
    # the query touches — join keys, filter predicates, and everything a
    # `SELECT *` expands to during qualify — so it badly over-states what a
    # dbt schema file should declare.
    output = list(getattr(qualified, "named_selects", None) or [])
    return {"valid": True, "stage": None, "errors": [],
            "columns_used": columns, "tables_used": tables,
            "output_columns": output}
