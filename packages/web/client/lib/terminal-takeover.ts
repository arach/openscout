import { resolveScoutRoutePath } from "./runtime-config.ts";

export type QueueTakeoverInput = {
  command: string;
  cwd?: string | null;
  agentId?: string | null;
};

export async function queueTakeover(input: QueueTakeoverInput): Promise<void> {
  clearPersistedTakeoverSession(input.agentId);
  const response = await fetch(resolveScoutRoutePath("terminalRunPath"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: input.command,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to queue takeover");
  }
}

function clearPersistedTakeoverSession(agentId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("hudson.relay.scout-takeover");
    if (agentId) {
      window.localStorage.removeItem(`hudson.relay.scout-takeover-${agentId}`);
    }
  } catch {}
}
