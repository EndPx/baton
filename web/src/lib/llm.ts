import "server-only";

/**
 * The one place Baton talks to a language model.
 *
 * Deliberately provider-agnostic: any OpenAI-compatible chat completions
 * endpoint works — OpenRouter, NVIDIA NIM, Together, a local vLLM — so
 * changing model or vendor is configuration, not a rewrite.
 *
 *   LLM_BASE_URL  https://openrouter.ai/api/v1  (default)
 *                 https://integrate.api.nvidia.com/v1  (NVIDIA)
 *   LLM_MODEL     moonshotai/kimi-k2.6         (default)
 *   LLM_API_KEY   provider key, server-side only
 */

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";

export const LLM_MODEL = process.env.LLM_MODEL ?? "moonshotai/kimi-k2.6";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Models wrap JSON in prose or a code fence often enough that trusting the
 * happy path costs a whole run. Try the strictest reading first, then recover.
 */
export function parseJsonLoose<T>(
  content: string,
  isValid: (value: T) => boolean,
): T {
  const candidates = [content.trim()];

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());

  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(content.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as T;
      if (isValid(parsed)) return parsed;
    } catch {
      // try the next reading
    }
  }
  throw new Error(
    `Model output was not the expected JSON: ${content.slice(0, 200)}`,
  );
}

/** One chat turn constrained to a JSON schema. */
export async function chatJson<T>(options: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  isValid: (value: T) => boolean;
  maxTokens?: number;
}): Promise<T> {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("LLM_API_KEY")}`,
      // Ignored by providers that do not use them (OpenRouter attribution).
      "HTTP-Referer": "https://baton.endpx.cloud",
      "X-Title": "Baton",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: options.maxTokens ?? 8192,
      temperature: 0,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schemaName,
          strict: true,
          schema: options.schema,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `LLM request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (body.error) throw new Error(`LLM error: ${body.error.message}`);

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");

  return parseJsonLoose<T>(content, options.isValid);
}
