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


def test_parse_error_fails():
    r = client.post("/validate", json={
        "sql": "selec broken from",
        "schema_map": SCHEMA,
    })
    body = r.json()
    assert body["valid"] is False
    assert body["stage"] == "parse"
