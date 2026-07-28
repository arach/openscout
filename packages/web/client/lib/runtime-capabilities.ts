export type RuntimeCapabilityCatalog = {
  schemaVersion: "openscout.runtime-capabilities.v1";
  generatedAt?: number;
  scope?: "global" | "project" | "global+project";
  projectRoot?: string;
  harnesses: Array<{ id: string; label?: string }>;
  models: Array<{ id: string; label?: string; harnesses: string[] }>;
  efforts: Array<{
    id: string;
    label: string;
    harnesses: string[];
    models?: string[];
  }>;
};

/** Cold-start seed only; a fetched versioned catalog replaces it. */
export const RUNTIME_CAPABILITY_SEED: RuntimeCapabilityCatalog = {
  schemaVersion: "openscout.runtime-capabilities.v1",
  harnesses: ["claude", "codex", "grok", "grok-acp", "kimi", "flue", "cursor", "pi"]
    .map((id) => ({ id })),
  models: [
    { id: "claude-opus-5", harnesses: ["claude"] },
    { id: "claude-sonnet-4-6", harnesses: ["claude"] },
    { id: "claude-haiku-4-5", harnesses: ["claude"] },
    { id: "gpt-5.6-sol", harnesses: ["codex"] },
    { id: "gpt-5.6-terra", harnesses: ["codex"] },
    { id: "gpt-5.6-luna", harnesses: ["codex"] },
    { id: "gpt-5.5", harnesses: ["codex"] },
    { id: "gpt-5.5-mini", harnesses: ["codex"] },
  ],
  efforts: [
    { id: "none", label: "None", harnesses: ["codex"] },
    { id: "minimal", label: "Minimal", harnesses: ["codex"] },
    { id: "low", label: "Low", harnesses: ["claude", "codex"] },
    { id: "medium", label: "Medium", harnesses: ["claude", "codex"] },
    { id: "high", label: "High", harnesses: ["claude", "codex"] },
    { id: "xhigh", label: "XHigh", harnesses: ["claude", "codex"] },
    { id: "max", label: "Max", harnesses: ["claude", "codex"] },
    { id: "ultra", label: "Ultra", harnesses: ["codex"] },
  ],
};

export function runtimeModelsForHarness(
  catalog: RuntimeCapabilityCatalog,
  harness: string,
): string[] {
  return catalog.models
    .filter((candidate) => candidate.harnesses.includes(harness))
    .map((candidate) => candidate.id);
}

export function runtimeEffortsForSelection(
  catalog: RuntimeCapabilityCatalog,
  harness: string,
  model: string,
): Array<{ value: string; label: string }> {
  return catalog.efforts
    .filter((candidate) => (
      candidate.harnesses.includes(harness)
      && (!candidate.models || candidate.models.length === 0 || candidate.models.includes(model))
    ))
    .map((candidate) => ({ value: candidate.id, label: candidate.label }));
}
