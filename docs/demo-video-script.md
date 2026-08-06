# Demo video script — Baton

**Hard limits from the rules:** under 3 minutes, public on YouTube/Vimeo/Youku,
must show the project actually functioning, **no third-party trademarks and no
copyrighted music**. Judges may score from the video and description alone, so
it has to stand on its own.

**Decisions baked into this script**

- **No music.** Voice over silence. It removes the single biggest
  disqualification risk and makes the narration easier to hear.
- **No logos on screen** other than Baton's own. The DataHub UI shot is
  unavoidable and fine — it is the platform being built on, shown as a result.
- **Lead with the agents, not the canvas.** Track 1 is "agents that do real
  work." If the canvas opens the video, it reads as a workflow builder.
- **Every number spoken is real** and comes from the run on screen.

Target: **2:35**, leaving buffer under 3:00.

---

## Shot list

### 0:00–0:15 — The problem, in one sentence

**Screen:** Studio open, canvas idle, goal box empty.

> "Ask any model to write a dbt model joining orders and customers, and it will
> write `first_name` and `email`. In this warehouse those columns are called
> `cust_first_name` and `cust_email`. The SQL looks right, and it does not run."

---

### 0:15–0:35 — State the goal, press Run

**Screen:** Type the goal into the composer, press **Run**. Nodes begin lighting.

> "Baton starts from the catalog instead. One goal, and three agents hand work
> to each other — Context, Codegen, Publisher."

**Note:** type the goal live. Do not paste — it reads as pre-baked.

---

### 0:35–1:00 — Real MCP calls, and the agent refusing to guess

**Screen:** Orchestration log scrolling. Pause on the disambiguation panel.

> "The Context agent searches DataHub through the MCP server. `orders` and
> `customers` match eight datasets — the same two tables on dbt, Snowflake, S3
> and Postgres. It stops and asks, rather than silently picking the first three."

**Screen:** Select the two dbt datasets, confirm.

> "Two of those candidates are both called `customers`. Baton labels them
> `customers · dbt` and `customers · snowflake`, because identifying a dataset
> by its bare table name quietly merges two different things."

---

### 1:00–1:20 — Grounding is a real fetch, not a prompt

**Screen:** `list_schema_fields` calls, then "37 columns across 2 dataset(s)",
then the lane hand-off line.

> "It pulls the real schema — thirty-seven columns — plus lineage and the SQL
> people have actually run against these tables. That package is handed to the
> Codegen agent."

---

### 1:20–1:50 — The part that matters: it catches itself

**Screen:** Generate → **Validate** turns red → Generate re-fires → **Valid ✓**.
Let this breathe; it is the most persuasive moment in the video.

> "The first attempt fails. sqlglot resolves every column against the schema we
> just fetched, the specific error goes back to the model, and the second
> attempt passes. Nothing reaches the file until it does."

> "The validator also refuses anything that is not a single SELECT — no DROP, no
> DELETE, nothing smuggled in after a semicolon."

---

### 1:50–2:10 — The artifact

**Screen:** Deliverable panel. Scroll the `.sql`, then the `.yml`.

> "Out comes a dbt model and its schema file. Look at the column names —
> `cust_first_name`, `town_city`. Those came from DataHub, not from a guess."

> "And the schema file lists the ten columns the model returns, not the
> twenty-seven the query touches."

---

### 2:10–2:30 — Write-back: the loop closes *(Track 1's signature — do not cut)*

**Screen:** Cut to the DataHub UI on the `orders` dataset. Show the
`generated-by-baton` tag, and the generated description.

> "Then the Publisher agent writes back. The tag and the description are in
> DataHub now — so the next person, or the next agent, inherits what this run
> learned. That is the whole point: the catalog is better after the run than
> before it."

---

### 2:30–2:35 — Close

**Screen:** Canvas with the graph, brief pan.

> "The pipeline is a graph you can rewire, and the rules stop you building one
> that generates SQL without grounding it first. Baton — open source, Apache 2.0."

**Screen (last frame, held 3s):** `baton.endpx.cloud` · `github.com/EndPx/baton`

---

## Recording checklist

- [ ] Run once before recording so the MCP sidecar is warm — a cold start can
      time out on the very first call. (It retries now, but that costs seconds.)
- [ ] Confirm DataHub is healthy: all six containers up.
- [ ] Clear the `generated-by-baton` tag and description from `orders` first, so
      the write-back shot shows them *appearing*, not already there.
- [ ] Browser at 1440×900, zoom 100%, no bookmarks bar, no extensions visible.
- [ ] Close every other tab — tab titles are third-party names.
- [ ] Check the recording has **no audio track other than voice**.
- [ ] Watch it once at 2× to confirm nothing personal is on screen.

## If a live run is too risky on the day

The **▶ Demo** button replays a recorded trace with no backend calls. It is
honest to use for pacing, but the submission is much stronger with a live run —
"must show the project actually functioning" is the rule. Record a live run and
keep the demo replay as a fallback only if the API is failing at record time.

## Narration script, continuous

For reading straight through. ~330 words, ≈2:20 at a measured pace.

> Ask any model to write a dbt model joining orders and customers, and it will
> write `first_name` and `email`. In this warehouse those columns are called
> `cust_first_name` and `cust_email`. The SQL looks right, and it does not run.
>
> Baton starts from the catalog instead. One goal, and three agents hand work to
> each other — Context, Codegen, Publisher.
>
> The Context agent searches DataHub through the MCP server. `orders` and
> `customers` match eight datasets — the same two tables on dbt, Snowflake, S3
> and Postgres. It stops and asks, rather than silently picking the first three.
> Two of those candidates are both called `customers`; Baton labels them
> `customers · dbt` and `customers · snowflake`, because identifying a dataset by
> its bare table name quietly merges two different things.
>
> It pulls the real schema — thirty-seven columns — plus lineage and the SQL
> people have actually run against these tables. That package is handed to the
> Codegen agent.
>
> The first attempt fails. sqlglot resolves every column against the schema we
> just fetched, the specific error goes back to the model, and the second attempt
> passes. Nothing reaches the file until it does. The validator also refuses
> anything that is not a single SELECT — no DROP, no DELETE, nothing smuggled in
> after a semicolon.
>
> Out comes a dbt model and its schema file. Look at the column names —
> `cust_first_name`, `town_city`. Those came from DataHub, not from a guess. And
> the schema file lists the ten columns the model returns, not the twenty-seven
> the query touches.
>
> Then the Publisher agent writes back. The tag and the description are in
> DataHub now — so the next person, or the next agent, inherits what this run
> learned. That is the whole point: the catalog is better after the run than
> before it.
>
> The pipeline is a graph you can rewire, and the rules stop you building one
> that generates SQL without grounding it first. Baton — open source, Apache 2.0.
