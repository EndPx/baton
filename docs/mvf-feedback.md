# Most Valuable Feedback — submission content

Separate form, one per entrant, due **Aug 10**. Everything below was hit
directly while building Baton, with exact versions and the fix that worked.

Environment: DataHub OSS **v1.5.0.6** (`datahub docker quickstart`), CLI
**1.6.0.17**, `mcp-server-datahub` PyPI **0.6.0** (reports **3.4.6** over MCP),
Claude Code CLI **2.1.220**, Ubuntu 24.04.

---

## 1. `list_schema_fields` rejects a wrong parameter without naming the right one

**Severity: high — this one silently corrupted our output.**

The tool takes `urn`. We sent `dataset_urn`. The error came back as an MCP
result with `isError: true` rather than a thrown exception, our client treated
it as an empty result, and **every dataset reported "0 columns"**. The pipeline
kept running and generated SQL against an empty schema map. Nothing looked
broken — the trace was green end to end.

**Ask:** name the expected parameter in the error (`unknown argument
'dataset_urn'; expected 'urn'`). Tool-argument mistakes are the most likely
integration error, and right now the message does not close the loop.

## 2. `add_tags` fails opaquely when the tag entity does not exist

Calling `add_tags` with a tag URN that has never been created returns `Failed to
validate label`. Nothing indicates that the fix is to create the tag first. We
lost time assuming a permissions or URN-format problem.

**Ask:** either say so (`tag urn:li:tag:x does not exist — create it first`), or
create-on-write, which is what most callers want.

Related: the parameter shape is `{tag_urns, entity_urns}` — both plural, both
lists. Reasonable, but easy to get backwards from the name alone, and it fails
the same opaque way.

## 3. `createTag` reports an existing tag as an error

`createTag` on an existing tag raises `This Tag already exists!`. For anything
idempotent — every automated writer — the tag being present is the desired
state, not a failure. We had to pattern-match the message string to tell
"succeeded" from "already fine", which breaks the moment the wording changes.

**Ask:** make it idempotent, or return a typed/coded error rather than prose.

## 4. The MCP server's PyPI version is not the version it reports

`serverInfo.version` is **3.4.6** (the DataHub SDK version). The PyPI package is
**0.6.0**. Pinning the version you can observe gives:

```
No solution found: there is no version of mcp-server-datahub==3.4.6
```

We only found the real number by running `importlib.metadata.version` inside the
tool environment.

**Ask:** report the package version in `serverInfo`, or document the difference.
This matters more than it sounds — running `@latest` in production means the
sidecar can change under a deployment. Ours moved 3.4.5 → 3.4.6 on its own
mid-build, and pinning is the obvious mitigation right up until the version you
can see is not the version you can pin.

## 5. GMS `/mcp` endpoint is documented but returns 404 on v1.5.0.6

The docs describe `http://<gms-host>:8080/mcp` for self-hosted. On v1.5.0.6
deployed by `datahub docker quickstart`, both GET and POST return 404. We
verified this before falling back to running `mcp-server-datahub` as a stdio
sidecar, which works well.

**Ask:** state the minimum GMS version for the built-in endpoint. As written,
self-hosters will try the documented path first and conclude their install is
broken.

## 6. `datahub docker quickstart --no-open-browser` is documented but absent

Not a flag in CLI 1.6.0.17; it fails with an unrecognised-option error. Minor,
but it is exactly the flag you reach for when scripting a headless VPS install —
which is the situation the docs are describing.

## 7. quickstart ships OpenSearch with `nofile=1024` and no restart policy

**Severity: high for anyone running a long-lived demo or trial.**

The generated compose file sets no `ulimits` and no `restart` policy. OpenSearch
documents `nofile 65536`; the container runs with the Docker default of 1024.
Ours died after ~27 hours with:

```
java.lang.OutOfMemoryError: unable to create native thread
pthread_create failed (EAGAIN)
```

Not memory pressure — 9.7 GiB was free. Because `RestartPolicy=no`, nothing
brought it back, and every search returned 500 until a human noticed. We fixed
it with `ulimits.nofile 65536` + `memlock -1`, and `restart: unless-stopped` on
the long-running services.

**Ask:** ship those in the generated compose. Two caveats worth encoding:
`system-update` is a one-shot job and must stay `restart: no` or it loops
forever; and the file leaves `DATAHUB_VERSION` unset, so a plain
`docker compose up` against it resolves blank image tags.

## 8. `claude plugins install --from` does not exist (DataHub Skills docs)

The skills docs give:

```
claude plugins install datahub-skills --from github:datahub-project/datahub-skills
```

In Claude Code CLI 2.1.220 the command is `plugin` (singular) and there is no
`--from`. What works:

```
claude plugin marketplace add datahub-project/datahub-skills
claude plugin install datahub-skills@datahub-skills
```

---

## Suggested framing for the form

If the form asks for one thing: lead with **#1 and #7**. They are the two that
cost real time and cause silent failure — a tool-argument error that produces
empty results instead of an exception, and a default deployment that dies
unattended with no restart policy. The rest are documentation accuracy.
