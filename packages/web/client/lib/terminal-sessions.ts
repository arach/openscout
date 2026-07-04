import type { TerminalSessionRecord, TerminalSurface } from "@openscout/protocol";
import { api } from "./api.ts";
import type { TerminalSurfaceDescriptor } from "./types.ts";

export type TerminalSessionsPayload = {
  ok: true;
  count: number;
  sessions: TerminalSessionRecord[];
};

export type RegisteredTerminalTarget = {
  session: TerminalSessionRecord;
  surface: TerminalSurface;
};

export type TerminalListItem = {
  id: string;
  session: TerminalSessionRecord;
  surface: TerminalSurface;
  key: string;
  title: string;
  detail: string;
  project: string;
  contextKind: string;
  contextValue: string;
  cwdLabel: string;
  origin: "backend" | "scout";
  condition: string;
  searchable: string;
};

export async function fetchTerminalSessions(options: { includeDiscovered?: boolean } = {}): Promise<TerminalSessionRecord[]> {
  const includeDiscovered = options.includeDiscovered ?? true;
  const payload = await api<TerminalSessionsPayload>(
    `/api/terminal-sessions${includeDiscovered ? "?includeDiscovered=1" : ""}`,
  );
  return payload.sessions;
}

export function isDiscoveredTerminalSession(session: TerminalSessionRecord): boolean {
  return session.metadata?.registryState === "discovered";
}

export function surfaceKey(surface: Pick<TerminalSurface, "backend" | "sessionName">): string {
  return `${surface.backend}:${surface.sessionName}`;
}

export function surfaceKeyFromParts(
  backend: string | undefined,
  sessionName: string | undefined,
): string | null {
  const cleanBackend = backend?.trim();
  const cleanSessionName = sessionName?.trim();
  if (
    (cleanBackend !== "tmux" && cleanBackend !== "zellij")
    || !cleanSessionName
  ) {
    return null;
  }
  return `${cleanBackend}:${cleanSessionName}`;
}

export function surfacePartsFromKey(
  key: string | undefined,
): { backend: "tmux" | "zellij"; sessionName: string } | null {
  if (!key) return null;
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  const backend = key.slice(0, separator);
  const sessionName = key.slice(separator + 1);
  if (backend !== "tmux" && backend !== "zellij") return null;
  return { backend, sessionName };
}

export function terminalSurfaceDescriptorFromRegisteredSurface(surface: TerminalSurface): TerminalSurfaceDescriptor {
  return {
    backend: surface.backend,
    sessionName: surface.sessionName,
    paneId: surface.paneId,
    socketDir: surface.socketDir ?? null,
  };
}

export function resolveRegisteredTerminalTarget(
  sessions: TerminalSessionRecord[],
  terminalSessionId: string | undefined,
  terminalSurfaceKey: string | undefined,
): RegisteredTerminalTarget | null {
  const session = terminalSessionId
    ? sessions.find((candidate) => candidate.id === terminalSessionId)
    : null;
  if (!terminalSurfaceKey) {
    const surface = session?.surfaces[0];
    return session && surface ? { session, surface } : null;
  }

  const surfaceSession = terminalSurfaceKey
    ? sessions.find((candidate) =>
      candidate.surfaces.some((surface) => surfaceKey(surface) === terminalSurfaceKey)
    )
    : null;
  const sessionHasSurface = session?.surfaces.some((surface) => surfaceKey(surface) === terminalSurfaceKey);
  const targetSession = sessionHasSurface ? session : surfaceSession;
  if (!targetSession) return null;
  const surface = targetSession.surfaces.find((candidate) => surfaceKey(candidate) === terminalSurfaceKey);
  if (!surface) return null;
  return { session: targetSession, surface };
}

export function terminalSessionSubtitle(session: TerminalSessionRecord): string {
  if (session.cwd) return session.cwd;
  const surface = session.surfaces[0];
  const state = typeof session.metadata?.backendState === "string"
    ? session.metadata.backendState
    : surface?.state;
  if (state) return state;
  return "terminal";
}

export function terminalConditionLabel(session: TerminalSessionRecord, surface: TerminalSurface): string {
  const attachedClients = typeof session.metadata?.attachedClients === "number"
    ? session.metadata.attachedClients
    : null;
  if (attachedClients !== null) {
    return `${attachedClients} attached`;
  }
  const state = typeof session.metadata?.backendState === "string"
    ? session.metadata.backendState
    : surface.state;
  return state ?? "ready";
}

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function compactTerminalPath(path: string | null | undefined): string {
  const trimmed = path?.trim().replace(/\/+$/u, "");
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 2) return trimmed;
  return `${parts.at(-2)}/${parts.at(-1)}`;
}

export function terminalSessionProjectLabel(session: TerminalSessionRecord, surface?: TerminalSurface): string {
  const metadata = session.metadata;
  const explicit = firstString(
    metadataStringValue(metadata, "project"),
    metadataStringValue(metadata, "projectName"),
    metadataStringValue(metadata, "workspace"),
    metadataStringValue(metadata, "workspaceQualifier"),
  );
  if (explicit) return explicit;

  const root = firstString(
    metadataStringValue(metadata, "projectRoot"),
    metadataStringValue(metadata, "workspaceRoot"),
    session.cwd,
  );
  const rootLeaf = compactTerminalPath(root).split("/").pop();
  if (rootLeaf) return rootLeaf;

  const relayName = surface?.sessionName ?? session.sourceSessionId;
  const relayMatch = /^relay-(.+?)-(?:claude|codex)$/iu.exec(relayName);
  if (relayMatch?.[1]) return relayMatch[1];

  return isDiscoveredTerminalSession(session) ? "backend-only" : "unscoped";
}

export function terminalSessionContextLabel(session: TerminalSessionRecord): { kind: string; value: string } {
  const metadata = session.metadata;
  const threadId = metadataStringValue(metadata, "threadId");
  if (threadId) return { kind: "thread", value: threadId };

  const externalSessionId = metadataStringValue(metadata, "externalSessionId");
  if (externalSessionId) return { kind: "external", value: externalSessionId };

  const conversationId = metadataStringValue(metadata, "conversationId");
  if (conversationId) return { kind: "conversation", value: conversationId };

  const runtimeSessionId = firstString(
    metadataStringValue(metadata, "runtimeSessionId"),
    metadataStringValue(metadata, "sessionId"),
  );
  if (runtimeSessionId) return { kind: "runtime", value: runtimeSessionId };

  return { kind: "source", value: session.sourceSessionId };
}

export function terminalListItems(sessions: TerminalSessionRecord[]): TerminalListItem[] {
  return sessions.flatMap((session) =>
    session.surfaces.map((surface) => {
      const key = surfaceKey(surface);
      const title = compactTerminalName(surface.sessionName);
      const detail = terminalSessionSubtitle(session);
      const project = terminalSessionProjectLabel(session, surface);
      const context = terminalSessionContextLabel(session);
      const cwdLabel = compactTerminalPath(session.cwd);
      const origin = isDiscoveredTerminalSession(session) ? "backend" : "scout";
      const condition = terminalConditionLabel(session, surface);
      return {
        id: `${session.id}:${key}`,
        session,
        surface,
        key,
        title,
        detail,
        project,
        contextKind: context.kind,
        contextValue: context.value,
        cwdLabel,
        origin,
        condition,
        searchable: [
          session.harness,
          session.sourceSessionId,
          session.cwd,
          project,
          context.kind,
          context.value,
          cwdLabel,
          metadataStringValue(session.metadata, "currentCommand"),
          metadataStringValue(session.metadata, "currentPath"),
          surface.backend,
          surface.sessionName,
          title,
          detail,
          origin,
          condition,
        ].filter(Boolean).join(" ").toLowerCase(),
      };
    })
  );
}

export function compactTerminalName(sessionName: string): string {
  return sessionName
    .replace(/^relay-/u, "")
    .replace(/^(claude|codex|tmux)-/u, "$1 · ");
}

export function terminalSummaryDetailRows(target: RegisteredTerminalTarget): Array<[string, string]> {
  const origin = target.session.metadata?.registryState === "discovered" ? "Backend" : "Scout";
  const backendState = typeof target.session.metadata?.backendState === "string"
    ? target.session.metadata.backendState
    : target.surface.state;
  const condition = terminalConditionLabel(target.session, target.surface);
  return [
    ["Backend", target.surface.backend],
    ["Session", target.surface.sessionName],
    ["Origin", origin],
    ["Condition", condition],
    ["State", backendState],
    ["Harness", target.session.harness],
    ["Working Dir", target.session.cwd],
    ["Source Id", target.session.sourceSessionId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}
