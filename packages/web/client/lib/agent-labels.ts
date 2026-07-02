import type { Agent } from "./types.ts";

export function compactAgentId(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  if (!trimmed) return null;

  const [head] = trimmed.split(".");
  return head?.trim() || trimmed;
}

export function minimalAgentHandle(input: {
  handle?: string | null;
  selector?: string | null;
  id?: string | null;
}): string | null {
  const handle = input.handle?.trim().replace(/^@+/, "");
  if (handle) return `@${handle}`;

  const selector = input.selector?.trim();
  if (selector) return selector;

  const compact = compactAgentId(input.id);
  return compact ? `@${compact}` : null;
}

function normalizeHandleSegment(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

export function qualifiedAgentHandle(input: {
  name?: string | null;
  handle?: string | null;
  selector?: string | null;
  id?: string | null;
}): string | null {
  const handle = input.handle?.trim().replace(/^@+/, "");
  if (handle) {
    const normalizedHandle = normalizeHandleSegment(handle);
    const normalizedName = normalizeHandleSegment(input.name);
    if (
      normalizedHandle
      && normalizedName?.startsWith(`${normalizedHandle}-`)
      && normalizedName.length > normalizedHandle.length + 1
    ) {
      return normalizedName;
    }
    return handle;
  }

  const selector = input.selector?.trim().replace(/^@+/, "");
  if (selector) return selector;

  return compactAgentId(input.id);
}

export function minimalAgentDisplayName(input: {
  name?: string | null;
  agentName?: string | null;
  id?: string | null;
  title?: string | null;
}): string {
  return (
    input.name?.trim()
    || input.agentName?.trim()
    || compactAgentId(input.id)
    || input.title?.trim()
    || "Conversation"
  );
}

export function minimalAgentLabel(agent: Agent | null | undefined): string | null {
  if (!agent) return null;
  return minimalAgentDisplayName({
    name: agent.name,
    id: agent.id,
  });
}
