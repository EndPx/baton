from fastapi.testclient import TestClient

from app import app, strip_dbt_jinja

client = TestClient(app)

SCHEMA = {
    "orders": {"order_id": "int", "customer_id": "int", "amount": "double", "created_at": "timestamp"},
    "customers": {"customer_id": "int", "name": "varchar"},
}


def test_strip_dbt_jinja():
    sql = "select * from {{ ref('orders') }} o join {{ source('crm', 'customers') }} c on o.customer_id = c.customer_id"
    out = strip_dbt_jinja(sql)
    assert "{{" not in out
    assert "orders" in out and "crm.customers" in out


def test_valid_sql_passes():
    r = client.post("/validate", json={
        "sql": "select o.order_id, c.name from {{ ref('orders') }} o join {{ ref('customers') }} c on o.customer_id = c.customer_id",
        "schema_map": SCHEMA,
        "dialect": "snowflake",
    })
    body = r.json()
    assert body["valid"] is True, body
    # Snowflake dialect normalizes unquoted identifiers to uppercase
    tables = {t.upper() for t in body["tables_used"]}
    assert "ORDERS" in tables and "CUSTOMERS" in tables


def test_unknown_column_fails():
    r = client.post("/validate", json={
        "sql": "select o.nonexistent_col from {{ ref('orders') }} o",
        "schema_map": SCHEMA,
        "dialect": "snowflake",
    })
    body = r.json()
    assert body["valid"] is False, body
    assert body["stage"] == "qualify"
    assert any("nonexistent_col" in e.lower() for e in body["errors"])


def test_output_columns_exclude_the_star_expansion():
    """A `SELECT *` inside a CTE expands during qualify, so columns_used covers
    every source column. A dbt schema file must declare only what the model
    returns, which is what output_columns reports."""
    r = client.post("/validate", json={
        "sql": (
            "with recent as (select * from {{ ref('orders') }}) "
            "select c.name, r.order_id, r.amount from {{ ref('customers') }} c "
            "join recent r on c.customer_id = r.customer_id"
        ),
        "schema_map": SCHEMA,
        "dialect": "snowflake",
    })
    body = r.json()
    assert body["valid"] is True, body

    output = {c.lower() for c in body["output_columns"]}
    assert output == {"name", "order_id", "amount"}, body["output_columns"]

    # created_at is reachable only through the star expansion, so it is a
    # column the query touches but not one the model returns.
    assert "created_at" not in output
    used = {c.split(".")[-1].replace('"', "").lower() for c in body["columns_used"]}
    assert "created_at" in used, body["columns_used"]


def test_parse_error_fails():
    r = client.post("/validate", json={
        "sql": "selec broken from",
        "schema_map": SCHEMA,
    })
    body = r.json()
    assert body["valid"] is False
    assert body["stage"] == "parse"
