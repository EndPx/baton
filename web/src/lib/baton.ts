/**
 * Baton — shared types for the three-lane pipeline.
 *
 * The "baton" is the structured context package each lane hands to the next:
 * Context lane → Codegen lane → Publisher lane. Every hand-off is explicit
 * and typed, and every step emits TraceEvents that stream to the UI.
 */

export type Lane = "context" | "codegen" | "publisher";

export type TraceEventType =
  | "node_start"
  | "tool_call"
  | "tool_result"
  | "node_complete"
  /** The stage did not apply to this run; the label says why. */
  | "node_skipped"
  | "handoff"
  | "error"
  | "pipeline_complete";

export interface TraceEvent {
  id: string;
  lane: Lane;
  /** Node within the lane, e.g. "search_entities", "generate_sql" */
  node: string;
  /** Id of the canvas node this came from, so the right box lights up. */
  nodeId?: string;
  type: TraceEventType;
  /** Human-readable one-liner shown in the trace UI */
  label: string;
  /** Optional structured payload (tool args, result summaries) */
  data?: unknown;
  /** Epoch millis */
  ts: number;
}

export type TraceEmitter = (
  event: Omit<TraceEvent, "id" | "ts">,
) => void;

/** A dataset the search turned up, offered to the user when it is ambiguous. */
export interface EntityCandidate {
  urn: string;
  name: string;
  platform: string;
  description?: string;
}

/**
 * Emitted when the Context agent will not guess. The run stops here; the
 * client sends the chosen URNs back and the pipeline starts again with them
 * pinned. (Serverless has nowhere to park a half-finished stream.)
 */
export interface ChoiceRequest {
  candidates: EntityCandidate[];
  /** What Baton would have picked on its own. */
  preselected: string[];
  reason: string;
}

export interface ResolvedEntity {
  urn: string;
  name: string;
  platform: string;
  entityType: string;
  description?: string;
}

/** table name -> { column name -> native type } */
export type SchemaMap = Record<string, Record<string, string>>;

/** The baton passed from the Context lane to the Codegen lane. */
export interface BatonContext {
  goal: string;
  entities: ResolvedEntity[];
  schemaMap: SchemaMap;
  /** Raw lineage payload from get_lineage_paths_between (if available) */
  lineage?: unknown;
  /** SQL dialect derived from the entities' platform (e.g. "snowflake") */
  dialect: string;
}

export interface ValidationReport {
  valid: boolean;
  stage: "parse" | "qualify" | null;
  errors: string[];
  /** Every column the query references, including `SELECT *` expansions. */
  columnsUsed: string[];
  /** The columns the model returns — what a dbt schema file must declare. */
  outputColumns: string[];
  tablesUsed: string[];
}

/** The baton passed from the Codegen lane to the Publisher lane. */
export interface CodegenResult {
  context: BatonContext;
  sql: string;
  modelName: string;
  notes: string;
  validation: ValidationReport;
  attempts: number;
}

export interface GeneratedFile {
  name: string;
  content: string;
}

/**
 * A description drafted for a dataset. It is a deliverable in its own right:
 * with write-back off the draft is the only thing a documentation run
 * produces, so it has to reach the user instead of dying inside the pipeline.
 */
export interface DraftedDocument {
  urn: string;
  name: string;
  platform: string;
  description: string;
  /** True once it was actually published onto the dataset in DataHub. */
  published: boolean;
}

/** Final pipeline output surfaced to the user. */
export interface PublishResult {
  files: GeneratedFile[];
  documents: DraftedDocument[];
  writeBack: {
    enabled: boolean;
    taggedUrns: string[];
    describedUrns: string[];
    errors: string[];
  };
}
