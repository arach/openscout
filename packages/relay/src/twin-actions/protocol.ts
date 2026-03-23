export type TwinActionKind = "consult" | "execute" | "status" | "summarize" | "tick";

export type TwinActionMode = "persistent" | "ephemeral";

export interface TwinActionRequest {
  twinId: string;
  action: TwinActionKind;
  mode?: TwinActionMode;
  input?: string;
  context?: Record<string, unknown>;
  actor?: string;
  timeoutSeconds?: number;
}

export interface TwinActionResult {
  twinId: string;
  action: TwinActionKind;
  mode: TwinActionMode;
  ok: boolean;
  output: string;
  respondedAt: number;
  runner: string;
  transport: "relay";
  flightId?: string;
  metadata?: Record<string, unknown>;
}

export interface TwinActionRunner {
  invokeTwinAction(request: TwinActionRequest): Promise<TwinActionResult>;
}
