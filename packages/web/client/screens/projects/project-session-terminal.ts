import type { TerminalSessionRecord, TerminalSurface } from "@openscout/protocol";
import { surfaceKey } from "../../lib/terminal-sessions.ts";

export type ProjectSessionTmuxTarget = {
  terminalSessionId: string;
  terminalSurfaceKey: string;
  sessionName: string;
};

export type ProjectSessionTerminalHints = {
  agentId?: string | null;
  sessionRefs: Array<string | null | undefined>;
};

function cleanRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = trimmed.split(/[\\/]/u).filter(Boolean).at(-1) ?? trimmed;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function tmuxSurfaces(session: TerminalSessionRecord): TerminalSurface[] {
  return session.surfaces.filter((surface) => surface.backend === "tmux");
}

function target(session: TerminalSessionRecord, surface: TerminalSurface): ProjectSessionTmuxTarget {
  return {
    terminalSessionId: session.id,
    terminalSurfaceKey: surfaceKey(surface),
    sessionName: surface.sessionName,
  };
}

/** Resolve a project-session identity to an exact live tmux surface. */
export function resolveProjectSessionTmuxTarget(
  sessions: TerminalSessionRecord[],
  hints: ProjectSessionTerminalHints,
): ProjectSessionTmuxTarget | null {
  const agentId = cleanRef(hints.agentId);
  const refs = new Set(hints.sessionRefs.map(cleanRef).filter((value): value is string => Boolean(value)));
  const definitionId = agentId?.split(".", 1)[0] ?? null;
  if (definitionId?.startsWith("session-")) refs.add(definitionId);

  if (agentId) {
    for (const session of sessions) {
      const surface = tmuxSurfaces(session)[0];
      if (surface && session.agentId === agentId) return target(session, surface);
    }
  }

  for (const session of sessions) {
    const surface = tmuxSurfaces(session).find((candidate) => refs.has(candidate.sessionName));
    if (surface) return target(session, surface);
  }

  return null;
}

export function nativeTerminalDeepLink(target: ProjectSessionTmuxTarget, mode: "observe" | "takeover"): string {
  const params = new URLSearchParams({
    session: target.terminalSessionId,
    surface: target.terminalSurfaceKey,
    mode,
  });
  return `scout://terminal?${params.toString()}`;
}
