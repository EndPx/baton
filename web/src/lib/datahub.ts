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

/** Create the tag if the catalog does not have it yet. */
export async function ensureTag(
  id: string,
  description: string,
): Promise<"existed" | "created"> {
  const urn = `urn:li:tag:${id}`;

  const existing = await graphql<{ tag: { urn: string } | null }>(
    `query($urn: String!) { tag(urn: $urn) { urn } }`,
    { urn },
  );
  if (existing.tag) return "existed";

  await graphql<{ createTag: string }>(
    `mutation($input: CreateTagInput!) { createTag(input: $input) }`,
    { input: { id, name: id, description } },
  );
  return "created";
}
