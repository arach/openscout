export type EntityProjectRefSource =
  | "agent"
  | "conversation"
  | "activity"
  | "inferred";

export type EntityProjectRef = {
  key: string;
  title: string;
  root: string | null;
  source: EntityProjectRefSource;
};

export type EntityAgentState =
  | "working"
  | "available"
  | "offline"
  | "unknown";

export type EntityAgentRef = {
  id: string;
  name: string;
  state: EntityAgentState;
  active: boolean;
  retired: boolean;
  harness: string | null;
  projectKey: string | null;
};

export type EntityConversationRef = {
  id: string;
  kind: string;
  title: string;
};

export type EntityFlightRef = {
  id: string;
  invocationId: string | null;
  state: string;
};

export type EntityRefs = {
  project: EntityProjectRef | null;
  agent: EntityAgentRef | null;
  conversation: EntityConversationRef | null;
  flight: EntityFlightRef | null;
};
