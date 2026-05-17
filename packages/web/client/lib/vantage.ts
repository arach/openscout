import { api } from "./api.ts";
import { resolveScoutRoutePath } from "./runtime-config.ts";

export type ScoutVantageHandoffResult = {
  ok: true;
  schema: "openscout.vantage.handoff.v1";
  handoffId: string;
  handoffPath: string;
  openUrl: string;
  launch: {
    attempted: boolean;
    ok: boolean;
    error: string | null;
  };
  plan: {
    manifest: {
      nodes: unknown[];
      focusedNodeId: string | null;
    };
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  };
};

export async function createVantageHandoff(input: {
  agentId?: string | null;
  launch?: boolean;
} = {}): Promise<ScoutVantageHandoffResult> {
  return await api<ScoutVantageHandoffResult>(resolveScoutRoutePath("vantageOpenPath"), {
    method: "POST",
    body: JSON.stringify({
      agentId: input.agentId ?? null,
      launch: input.launch ?? true,
    }),
  });
}
