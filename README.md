<p align="center">
  <img src="assets/logo-mark.png" alt="Baton logo" width="140" />
</p>

# Baton

**A metadata-grounded codegen relay for DataHub.**

🔗 **Live demo:** [baton-roan.vercel.app](https://baton-roan.vercel.app) — click **▶ Demo** to watch the relay animate.

Baton is a multi-agent pipeline that turns a natural-language goal — *"generate a dbt model joining orders and customers, filtered to the last 90 days"* — into a validated, PR-ready dbt model, grounded in what your [DataHub](https://datahub.com) catalog actually knows: real schemas, real lineage, real ownership.

Like a relay race, three specialized agents each run their leg and pass a structured **baton** of context forward — and the last runner writes the result back into DataHub, so the next person (or agent) inherits the knowledge.

> 🏆 Built for [Build with DataHub: The Agent Hackathon](https://datahub.devpost.com/) — Track 1: *Agents That Do Real Work*.

## How it works

```
  goal ──▶ [ Context agent ] ──▶ [ Codegen agent ] ──▶ [ Publisher agent ] ──▶ dbt model + write-back
             resolves entities      generates SQL          packages .sql/.yml
             pulls schema &         validates against      writes provenance
             lineage via MCP        real schema (sqlglot)  back to DataHub
                                    self-corrects
```

1. **Context agent** — resolves the tables you mention into DataHub URNs via the DataHub MCP Server (`search`, `get_entities`), then pulls real column names/types and lineage (`list_schema_fields`, `get_lineage`, `get_lineage_paths_between`).
2. **Codegen agent** — generates a dbt SQL model constrained to the fetched schema, then validates every column reference with schema-aware [sqlglot](https://github.com/tobymao/sqlglot) qualification. Validation errors feed a bounded self-correction loop.
3. **Publisher agent** — packages the validated SQL into a dbt `.sql` model + `.yml` schema file, and writes provenance back to DataHub (tags/descriptions on the source tables), closing the loop in the metadata graph.

Every MCP tool call streams to a live trace UI, so you watch the baton move between agents in real time.

## Status

🚧 Under active development for the hackathon (deadline Aug 10, 2026).

## Self-hosting

Requirements: a DataHub instance (e.g. `datahub docker quickstart`) and an API key for any OpenAI-compatible LLM endpoint — the hosted demo runs `meta/llama-3.1-70b-instruct` on NVIDIA NIM, but OpenRouter, Together or a local vLLM work by changing `LLM_BASE_URL`.

```bash
cp .env.example .env   # fill in your values
# full setup instructions coming with the first release
```

## Tech

Next.js (TypeScript) · DataHub MCP Server · sqlglot · any OpenAI-compatible LLM · XyFlow (react-flow)

## License

[Apache 2.0](LICENSE)
