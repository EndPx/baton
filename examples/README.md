# Sample output

These files were not written by hand. They came out of a real run against a
real DataHub instance, so you can judge the quality of Baton's output without
setting anything up.

## The run

| | |
|---|---|
| Goal | `generate a dbt model joining orders and customers` |
| Catalog | `showcase-ecommerce` datapack, 827 entities |
| Sources chosen | `orders` and `customers`, both on the **dbt** platform |
| Grounding | 37 real columns pulled via `list_schema_fields` (orders 15, customers 22) |
| Validation | sqlglot schema-aware qualify, dialect read from the platform metadata (`snowflake`) — **9 columns across 2 tables resolved** |
| Write-back | both source datasets tagged `generated-by-baton` |
| Wall clock | ~18s, 7 MCP/LLM tool calls |
| Model | `meta/llama-3.1-70b-instruct` via NVIDIA NIM |

## Why the column names matter

Look at `cust_first_name`, `cust_last_name`, `cust_email` in the SQL.

A model guessing at an "orders joined to customers" table writes
`first_name`, `last_name`, `email` — those are the obvious names, and they do
not exist in this warehouse. Baton used the `cust_` prefix because it read the
schema out of DataHub before generating anything, and sqlglot then resolved
every one of those references against that same schema before the file was
allowed out.

That is the whole point of the project, visible in three column names.

## The ambiguity Baton refused to guess through

Searching this catalog for "orders" and "customers" returns **eight** datasets
— the same two tables on `dbt`, `snowflake`, `s3` and `postgres`. Rather than
silently keeping the first three, the Context agent stopped and asked which
ones to ground against. The dbt pair above is what was picked.

## Reproducing

Open the [Studio](https://baton.endpx.cloud/studio), type the goal, press
**Run**, and choose the same two datasets when it asks.
