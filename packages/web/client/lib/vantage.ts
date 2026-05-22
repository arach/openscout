import { api } from "./api.ts";
import { resolveScoutRoutePath } from "./runtime-config.ts";

export type ScoutVantageHandoffResult = {
  ok: true;
  schema: "openscout.vantage.handoff.v1";
  handoffId: string;
  handoffPath: string;
  setupPath: string;
  openUrl: string;
  launch: {
    attempted: boolean;
    ok: boolean;
    error: string | null;
  };
  plan: {
    manifest: {
      workspaceID?: string;
      handoffId?: string;
      nodes: unknown[];
      selectedAgentIds?: string[];
      selectedNativeSessionIds?: string[];
      selection?: string[];
      focused?: string | null;
      focusedNodeId: string | null;
    };
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  };
};

export function shortVantageHandoffId(handoffId: string | null | undefined): string | null {
  const trimmed = handoffId?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^handoff-/, "").slice(0, 18);
}

export function formatVantageLinkLabel(handoff: Pick<ScoutVantageHandoffResult, "handoffId" | "plan">): string {
  const workspaceID = handoff.plan.manifest.workspaceID?.trim();
  const handoffId = shortVantageHandoffId(handoff.plan.manifest.handoffId ?? handoff.handoffId);
  return [workspaceID, handoffId].filter(Boolean).join(" · ");
}

export async function createVantageHandoff(input: {
  agentId?: string | null;
  agentIds?: readonly string[];
  nativeSessionIds?: readonly string[];
  launch?: boolean;
} = {}): Promise<ScoutVantageHandoffResult> {
  return await api<ScoutVantageHandoffResult>(resolveScoutRoutePath("vantageOpenPath"), {
    method: "POST",
    body: JSON.stringify({
      agentId: input.agentId ?? null,
      agentIds: input.agentIds ?? [],
      nativeSessionIds: input.nativeSessionIds ?? [],
      launch: input.launch ?? true,
    }),
  });
}
