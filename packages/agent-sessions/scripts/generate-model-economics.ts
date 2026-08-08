/**
 * Regenerates src/model-economics.generated.ts from models.dev.
 *
 *   bun scripts/generate-model-economics.ts
 *
 * Sibling of generate-model-windows.ts, same sourcing rules: models.dev
 * (https://models.dev/api.json) is the community catalog, and only each
 * model's NATIVE provider is trusted — aggregators/resellers carry stale or
 * padded numbers. Where windows answer "how much fits", economics answers
 * "what does a token cost and what can the model do": input/output $ per
 * 1M tokens, structured-output support, and release date.
 *
 * The curated layer (model-economics.ts) picks per-family tier winners over
 * this raw data; keep curation THERE, not here — this file is data only.
 */
const SOURCE = "https://models.dev/api.json";

// Authoritative native providers only, one per family we represent.
const NATIVE_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "xai",
  "google",
  "google-vertex",
  "minimax",
  "mistral",
  "deepseek",
  "alibaba",
  "moonshotai",
  "zai",
  "groq",
  "cohere",
  "meta",
]);

function canonical(id: string): string {
  return id.trim().toLowerCase().replace(/[._]/gu, "-");
}

type SourceModel = {
  cost?: { input?: number; output?: number };
  limit?: { context?: number };
  structured_output?: boolean;
  release_date?: string;
  name?: string;
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`);
const data = (await res.json()) as Record<string, { models?: Record<string, SourceModel> }>;

type Row = {
  family: string;
  input: number;
  output: number;
  context?: number;
  structuredOutput?: boolean;
  released?: string;
};

const rows = new Map<string, Row>();
let providerCount = 0;
for (const [providerId, provider] of Object.entries(data)) {
  providerCount += 1;
  if (!NATIVE_PROVIDERS.has(providerId)) continue;
  const family = providerId === "google-vertex" ? "google" : providerId;
  for (const [id, model] of Object.entries(provider.models ?? {})) {
    const input = model.cost?.input;
    const output = model.cost?.output;
    if (typeof input !== "number" || typeof output !== "number") continue;
    const key = canonical(id);
    // First writer wins per family precedence order above; families never
    // collide on canonical ids in practice, and native beats vertex aliasing.
    if (rows.has(key)) continue;
    rows.set(key, {
      family,
      input,
      output,
      context: model.limit?.context,
      structuredOutput: model.structured_output,
      released: model.release_date,
    });
  }
}

const sorted = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
const body = sorted
  .map(([k, v]) => {
    const fields = [
      `family: ${JSON.stringify(v.family)}`,
      `input: ${v.input}`,
      `output: ${v.output}`,
      v.context ? `context: ${v.context}` : null,
      v.structuredOutput === undefined ? null : `structuredOutput: ${v.structuredOutput}`,
      v.released ? `released: ${JSON.stringify(v.released)}` : null,
    ].filter(Boolean);
    return `  ${JSON.stringify(k)}: { ${fields.join(", ")} },`;
  })
  .join("\n");

const out = `// AUTO-GENERATED — do not edit by hand.
// Source: ${SOURCE} (community model-metadata catalog, ~${providerCount} providers)
// Regenerate: bun scripts/generate-model-economics.ts
// Generated: ${new Date().toISOString().slice(0, 10)}
//
// Per-model economics from each model's NATIVE provider only: $ per 1M
// tokens (input/output), context window, structured-output support, release
// date. Curated tier picks layer over this in model-economics.ts.
// ${sorted.length} models.
export type ModelEconomicsEntry = {
  family: string;
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  context?: number;
  structuredOutput?: boolean;
  released?: string;
};

export const MODEL_ECONOMICS: Record<string, ModelEconomicsEntry> = {
${body}
};
`;

await Bun.write("src/model-economics.generated.ts", out);
console.log(`wrote ${sorted.length} models from ${providerCount} providers`);
