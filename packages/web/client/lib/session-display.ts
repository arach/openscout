function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function titleCase(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function cleanSynopsis(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (/^(session [\w:-]+|turn context|task started|task complete|tokens)\b/i.test(trimmed)) {
    return null;
  }
  if (/^\[[^\]]+\]$/.test(trimmed)) return null;
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

function compactCommand(command: string | null | undefined): string | null {
  const trimmed = command?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const withoutPaths = trimmed.replace(/(?:\/[^\s/]+)+\/([^\s/]+)/g, "$1");
  return withoutPaths.length > 96 ? `${withoutPaths.slice(0, 93)}...` : withoutPaths;
}

function sessionReference(value: string | null | undefined): string | null {
  const compact = shortSessionId(value, "");
  return compact || null;
}

export function shortSessionId(value: string | null | undefined, fallback = "session"): string {
  if (!value) return fallback;
  const leaf = basename(value) ?? value;
  const withoutExt = leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
  const compact = withoutExt.replace(/^session[_:-]?/i, "");
  return compact.length > 10 ? compact.slice(0, 8) : compact;
}

export type ObservedSessionDisplayInput = {
  source: string | null | undefined;
  project: string | null | undefined;
  cwd: string | null | undefined;
  branch?: string | null | undefined;
  sessionId?: string | null | undefined;
  refId?: string | null | undefined;
  transcriptPath?: string | null | undefined;
  processCommand?: string | null | undefined;
  summary?: string | null | undefined;
  scoutPreview?: string | null | undefined;
};

export type ObservedSessionDisplay = {
  label: string;
  detail: string | null;
  branchOrCwd: string;
  context: string | null;
  title: string;
};

export function observedSessionDisplay(input: ObservedSessionDisplayInput): ObservedSessionDisplay {
  const source = input.source?.trim() || "session";
  const project = input.project?.trim() || basename(input.cwd) || null;
  const branch = input.branch?.trim() || null;
  const cwdLabel = basename(input.cwd);
  const ref = sessionReference(input.sessionId ?? input.refId ?? input.transcriptPath);
  const synopsis =
    cleanSynopsis(input.scoutPreview)
    ?? cleanSynopsis(input.summary)
    ?? (input.transcriptPath ? null : compactCommand(input.processCommand));
  const fallback = project
    ? `${titleCase(source)} session in ${project}`
    : `${titleCase(source)} session`;
  const label = synopsis ?? fallback;
  const branchOrCwd = branch ?? cwdLabel ?? (input.transcriptPath ? "transcript" : "-");
  const contextParts = [
    branch ?? cwdLabel ?? project,
    ref ? `session ${ref}` : null,
  ].filter(Boolean);
  const detail = contextParts.length > 0 ? contextParts.join(" - ") : null;
  const title = [
    label,
    detail,
    input.cwd ? `cwd: ${input.cwd}` : null,
    input.transcriptPath ? `transcript: ${input.transcriptPath}` : null,
  ].filter(Boolean).join("\n");
  return {
    label,
    detail,
    branchOrCwd,
    context: detail,
    title,
  };
}
