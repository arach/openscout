export type CaptureContextItem = {
  label: string;
  value: string;
};

const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_VALUE_LENGTH = 4_000;

function cleanContextItem(value: unknown): CaptureContextItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.label !== "string" || typeof candidate.value !== "string") return null;
  const label = candidate.label.trim();
  const itemValue = candidate.value.trim().slice(0, MAX_CONTEXT_VALUE_LENGTH);
  if (!label || !itemValue) return null;
  return { label, value: itemValue };
}

export function parseCaptureContextItems(value: string | null): CaptureContextItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_CONTEXT_ITEMS)
      .map(cleanContextItem)
      .filter((item): item is CaptureContextItem => item !== null);
  } catch {
    return [];
  }
}

function formatContextValue(value: string): string {
  return value.replace(/\n/g, "\n  ");
}

export function composeCaptureMessage(
  message: string,
  contextItems: readonly CaptureContextItem[] = [],
): string {
  const body = message.trim();
  if (contextItems.length === 0) return body;
  const context = contextItems
    .map((item) => `- ${item.label}: ${formatContextValue(item.value)}`)
    .join("\n");
  return [body, `Context from the host surface:\n${context}`].filter(Boolean).join("\n\n");
}
