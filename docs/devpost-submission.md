# Devpost submission — Baton

**Track:** Agents That Do Real Work (Track 1)
**Live demo:** https://baton.endpx.cloud/studio — no signup, no setup
**Repo:** https://github.com/EndPx/baton (Apache 2.0)
**Video:** _(paste URL once uploaded)_

---

## Tagline

A metadata-grounded codegen relay for DataHub: three agents read the catalog
through the MCP Server, generate data code that actually compiles, and write
what they learned back so the next agent starts ahead.

---

## Inspiration

Ask any model for "a dbt model joining orders and customers" and it writes
`first_name` and `email`. In the `showcase-ecommerce` warehouse those columns
are called `cust_first_name` and `cust_email`. The SQL looks right, reviews
fine, and fails the moment it runs.

The information that would have prevented it was sitting in DataHub the whole
time. That gap — a catalog full of ground truth, and a model guessing anyway —
is the entire reason Baton exists.

## What it does

You give Baton one goal in plain language. Three agents hand work to each other,
and the result is a file you could open a PR with, plus a catalog that is better
than it was before the run.

**Context agent** — resolves what you meant. It searches DataHub through the MCP
Server, and when `orders` and `customers` match eight datasets across dbt,
Snowflake, S3 and Postgres, it **stops and asks** rather than silently keeping
the first three. It then pulls the real schema (37 columns), the lineage between
the chosen tables, and the SQL people have historically run against them.

**Codegen agent** — generates the model constrained to that schema, then
validates it with sqlglot's schema-aware `qualify`, which resolves every column
reference against the columns DataHub actually reported. On failure the specific
error goes back to the model as a targeted correction, bounded at two retries.
In our runs the first attempt routinely fails and the second passes — that loop
is the mechanism, not decoration.

**Publisher agent** — packages a dbt `.sql` model plus its `.yml` schema file,
then writes back to DataHub: the source datasets get a `generated-by-baton` tag,
and documentation runs publish generated descriptions onto the datasets
themselves. That is the part that compounds. The next person, or the next agent,
inherits it.

The whole run streams to a live trace over SSE, where each node on the canvas is
lit by an actual tool call — not an animation on a timer.

## How we used DataHub

The MCP Server is the only way Baton reads or writes the catalog.

| Tool | Used for |
|---|---|
| `search` | Turning goal keywords into candidate datasets |
| `list_schema_fields` | The real columns and types that ground generation |
| `get_lineage_paths_between` | Relationship between the chosen datasets |
| `get_dataset_queries` | Historical SQL, as a house-style hint |
| `add_tags` | Marking the datasets that fed a generated artifact |
| `update_description` | Publishing generated documentation back |

Run against self-hosted DataHub OSS v1.5.0.6 with the `showcase-ecommerce`
datapack (827 searchable entities). Mutations are enabled via
`TOOLS_IS_MUTATION_ENABLED=true`, which takes the sidecar from 6 read tools to
18. The SQL dialect is not hard-coded — it is derived from the platform metadata
on the resolved datasets.

## How we built it

- **Next.js 16 / React 19 / TypeScript** — the Studio, and the route handler
  that runs the pipeline. Every model and MCP call is server-side; no secret
  reaches the browser.
- **`mcp-server-datahub` as a stdio sidecar** — GMS v1.5.0.6 has no built-in
  `/mcp` endpoint (documented, but 404 on this version), so Baton spawns the
  sidecar and speaks MCP to it as a client.
- **Python + FastAPI + sqlglot** — schema-aware SQL validation is not worth
  reimplementing in JavaScript, so it is one small service called for that step.
- **XyFlow** — the canvas. The graph is not a picture of the pipeline; a
  topological sort of it *is* the execution order.
- **Llama 3.1 70B via NVIDIA NIM**, through an OpenAI-compatible interface, so
  the provider is a config line rather than a rewrite.
- **Self-hosted** on a VPS behind nginx with TLS, co-located with DataHub so GMS
  stays bound to localhost and is never exposed to the internet.

## Challenges

**The MCP contract is not the one you assume.** `list_schema_fields` takes
`urn`, not `dataset_urn`. Our first version sent the wrong parameter, the tool
error was swallowed, and every table reported "0 columns" — the model was
generating against nothing while the trace looked green. The fix was making a
tool error throw by default. Similarly `add_tags` wants `{tag_urns,
entity_urns}` and fails with a vague message if the tag entity does not exist
yet, so Baton creates it first.

**A validator that says yes is worse than no validator.** Ours certified
`{{ filter_orders() }}` — a macro that does not exist — because only `ref()` and
`source()` were resolved and the leftover braces parsed into something
meaningless. It also passed `DROP TABLE orders`, and `parse_one` silently kept
only the first statement, so `select ...; drop table orders` validated clean
while the drop still shipped in the file. A dbt model is now required to be
exactly one SELECT.

**Same name, different dataset.** Two catalogs both hold `customers`. Anything
keyed on the bare table name merged them: one dataset was documented twice while
the other was skipped, and the run reported success. Datasets now carry a label
qualified only as far as it takes to be unique — `customers · dbt` versus
`customers · snowflake`.

**A schema file describing a model that does not exist.** The `.yml` was built
from every column the query referenced, so a CTE's `SELECT *` expanded to 27
columns on a model returning 10. It now comes from sqlglot's `named_selects`.

## Accomplishments

It genuinely works end to end against a real catalog, and the parts that are
easiest to fake are the parts we made real: the trace is driven by tool results,
the validation loop actually rejects and regenerates, and the write-back is
visible in DataHub's own UI after the run.

We are equally happy with what it refuses to do — guess between eight
candidates, generate without grounding (the rules engine blocks that graph), or
hand you a file it could not actually check.

## What we learned

The failure mode worth designing against is not the error — it is the **silent
success**. Every serious bug in this project looked like a passing run: zero
columns fetched, one dataset documented twice, a `.yml` describing columns that
do not exist, a destructive statement stamped "validated". Adversarial
end-to-end testing found all of them. None of them broke a build.

## What's next

Registering results as proper DataHub **assertions** via the Python SDK
(`upsert_custom_assertion`) rather than generic tags — confirmed feasible on OSS
Core, and a stronger contribution to the graph than a tag. Beyond that:
column-level lineage as a grounding input, and opening the PR directly.

## Built with

`next.js` · `react` · `typescript` · `tailwindcss` · `xyflow` · `python` ·
`fastapi` · `sqlglot` · `datahub` · `model-context-protocol` · `llama` ·
`nvidia-nim` · `docker` · `nginx` · `pm2`

## Testing instructions for judges

Open https://baton.endpx.cloud/studio and press **Run**. No login, no setup.

1. A template is already on the canvas — **Grounded dbt model** or
   **Documentation backfill** — or type your own goal.
2. It will stop and ask which datasets you meant. Pick the two `dbt` ones.
3. Watch the nodes light as each MCP call returns; the Orchestration panel logs
   every call by name.
4. The Deliverable panel shows the generated file, or the generated
   descriptions, with a Copy button.
5. **▶ Demo** replays a recorded trace with no backend calls, if you would
   rather not wait for a live run.

Sample output is committed in [`examples/`](../examples) so the artifact can be
judged without running anything.
