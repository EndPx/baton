/**
 * Baton — DataHub MCP client (server-side only).
 *
 * Spawns `uvx mcp-server-datahub@latest` over stdio and exposes a typed
 * callTool() helper. GMS v1.5.0.6 has no built-in /mcp endpoint, so the
 * sidecar process is the MCP surface (verified 2026-08-04).
 *
 * Never import this from a client component — it reads secrets from env.
 */

import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let clientPromise: Promise<Client> | null = null;

async function createClient(): Promise<Client> {
  const command = process.env.MCP_COMMAND ?? "uvx";
  const args = (process.env.MCP_ARGS ?? "mcp-server-datahub@latest").split(" ");

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...(process.env as Record<string, string>),
      DATAHUB_GMS_URL: requireEnv("DATAHUB_GMS_URL"),
      DATAHUB_GMS_TOKEN: requireEnv("DATAHUB_GMS_TOKEN"),
      TOOLS_IS_MUTATION_ENABLED: process.env.TOOLS_IS_MUTATION_ENABLED ?? "true",
    },
  });

  const client = new Client({ name: "baton", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

/** Lazily-initialized singleton MCP client (one sidecar per server process). */
export function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = createClient().catch((err) => {
      clientPromise = null; // allow retry on next call
      throw err;
    });
  }
  return clientPromise;
}

export interface ToolCallResult<T> {
  /** Parsed JSON payload when the tool returned JSON text, else null. */
  data: T | null;
  /** Raw text content, always present. */
  raw: string;
  isError: boolean;
}

/**
 * Call a DataHub MCP tool and parse its text content as JSON when possible.
 * Read tools available on our stack: search, get_entities, list_schema_fields,
 * get_lineage, get_lineage_paths_between, get_dataset_queries.
 * Mutations (TOOLS_IS_MUTATION_ENABLED): add_tags, update_description, etc.
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult<T>> {
  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args });

  const content = Array.isArray(result.content) ? result.content : [];
  const raw = content
    .filter((c): c is { type: "text"; text: string } => c?.type === "text")
    .map((c) => c.text)
    .join("\n");

  let data: T | null = null;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    // non-JSON tool output — leave data null, raw still carries the text
  }

  return { data, raw, isError: result.isError === true };
}
