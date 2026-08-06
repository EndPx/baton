import "server-only";

/**
 * Direct GraphQL against DataHub's GMS, for the few things the MCP server
 * does not expose. Right now that is exactly one thing: creating a tag.
 *
 * DataHub's addTags mutation validates that the tag entity already exists, so
 * a fresh instance rejects the write-back with "Failed to validate label"
 * until someone creates the tag by hand. Baton creates it itself instead —
 * cloning the repo should not require a manual catalog setup step.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${requireEnv("DATAHUB_GMS_URL")}/api/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("DATAHUB_GMS_TOKEN")}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `DataHub GraphQL failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }

  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`DataHub GraphQL error: ${body.errors[0].message}`);
  }
  if (!body.data) throw new Error("DataHub GraphQL returned no data");
  return body.data;
}

/**
 * Make sure the tag exists before anything tries to apply it.
 *
 * createTag is idempotent on DataHub — it returns the URN whether or not the
 * tag was already there, and it revives a soft-deleted one. So this is a
 * single unconditional call: querying first would cost a round trip and would
 * also mistake a soft-deleted tag for a usable one (the Tag type exposes no
 * status field to tell them apart).
 */
export async function ensureTag(
  id: string,
  description: string,
): Promise<string> {
  try {
    const result = await graphql<{ createTag: string }>(
      `mutation($input: CreateTagInput!) { createTag(input: $input) }`,
      { input: { id, name: id, description } },
    );
    return result.createTag;
  } catch (err) {
    // The tag already being there is the state this function exists to reach,
    // not a failure. Treating it as one made every run after the very first
    // report "Tagged 2, 1 failure(s)" for a write-back that fully succeeded.
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) return `urn:li:tag:${id}`;
    throw err;
  }
}
