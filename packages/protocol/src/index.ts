export type ScoutIntegrationMode = "link" | "embed" | "copy";

export interface ScoutCapabilityDescriptor {
  id: string;
  label: string;
  kind: "context" | "workflow" | "action" | "provider" | "surface";
}

export interface ScoutModuleDescriptor {
  id: string;
  name: string;
  summary: string;
  integrationMode: ScoutIntegrationMode;
  capabilities: ScoutCapabilityDescriptor[];
}

export interface ScoutWorkerHeartbeat {
  state: "stopped" | "launching" | "running" | "degraded" | "failed";
  detail: string;
  pid: number;
  heartbeatAt: string;
}
