import type {
  AgentEndpoint,
  AgentDefinition,
  ControlEvent,
  ScoutDeliverRequest,
  ScoutDeliverResponse,
  FlightRecord,
} from "@openscout/protocol";

export type {
  AgentEndpoint,
  ScoutDeliverRequest,
  ScoutDeliverResponse,
  FlightRecord,
};

// ─── Broker client ────────────────────────────────────────────────────────────

export type BrokerSnapshot = {
  agents: Record<string, AgentDefinition>;
  endpoints: Record<string, AgentEndpoint>;
};

export interface AgentInfo {
  id: string;
  label: string;
  state: string;
  harness?: string;
  nodeId?: string;
}

export interface DeliverParams {
  intent: "tell" | "consult";
  body: string;
  target: { kind: "agent_label"; label: string } | { kind: "agent_id"; id: string };
  channel?: string;
  workItem?: { title: string };
}

export type ScoutEvent = ControlEvent;

// ─── TUI Components ──────────────────────────────────────────────────────────

export interface PickerResult {
  selected: AgentInfo | null;
  cancelled: boolean;
}

export interface ComposeResult {
  body: string;
  confirmed: boolean;
  cancelled: boolean;
}
