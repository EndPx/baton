# Sample output

These files were not written by hand. They came out of a real run against a
real DataHub instance, so you can judge the quality of Baton's output without
setting anything up.

## The run

| | |
|---|---|
| Goal | `generate a dbt model joining orders and customers, filtered to the last 90 days` |
| Catalog | `showcase-ecommerce` datapack, 827 entities |
| Sources chosen | `orders` and `customers`, both on the **dbt** platform |
| Grounding | 37 real columns pulled via `list_schema_fields` (orders 15, customers 22) |
| Validation | sqlglot schema-aware qualify, dialect read from the platform metadata (`snowflake`) — **27 columns across 3 tables resolved** |
| Self-correction | the first attempt was rejected; the second passed (**2 attempts**) |
| Write-back | both source datasets tagged `generated-by-baton`, no errors |
| Model | `meta/llama-3.1-70b-instruct` via NVIDIA NIM |

## Why the column names matter

Look at `cust_first_name`, `cust_last_name`, `town_city` in the SQL.

A model guessing at an "orders joined to customers" table writes `first_name`,
`last_name`, `city` — those are the obvious names, and they do not exist in
this warehouse. Baton used the real ones because it read the schema out of
DataHub before generating anything, and sqlglot then resolved every one of
those references against that same schema before the file was allowed out.

That is the whole point of the project, visible in three column names.

## What the .yml does *not* say

The schema file lists exactly the ten columns the model returns — not the
twenty-seven the query touches. The CTE's `SELECT *` expands during
qualification to every column of `orders`, and the join key and filter
predicate pull in more. A schema file built from "columns referenced" would
declare `warehouse_id` and `promotion_id` on a model that never selects them,
and `dbt docs` would then describe a model that does not exist.

## The ambiguity Baton refused to guess through

Searching this catalog for "orders" and "customers" returns **eight** datasets
— the same two tables on `dbt`, `snowflake`, `s3` and `postgres`. Rather than
silently keeping the first three, the Context agent stopped and asked which
ones to ground against. The dbt pair above is what was picked.

Two of those candidates are both called `customers`, on different platforms.
Baton labels them `customers · dbt` and `customers · snowflake` throughout the
run, because identifying a dataset by its bare table name silently merges two
different things.

## Reproducing

Open the [Studio](https://baton.endpx.cloud/studio), type the goal, press
**Run**, and choose the same two datasets when it asks.
