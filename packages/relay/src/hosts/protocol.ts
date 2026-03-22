import type { TwinActionRequest, TwinActionResult } from "../twin-actions/protocol.js";

export type TwinHostId = "claude" | "codex";

export interface HostTwinActionAdapter {
  host: TwinHostId;
  invokeTwinAction(request: TwinActionRequest): Promise<TwinActionResult>;
}
