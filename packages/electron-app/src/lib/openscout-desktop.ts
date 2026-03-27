export type DesktopAppInfo = {
  productName: string;
  appVersion: string;
  isPackaged: boolean;
  platform: string;
};

export type RelayDestinationKind = "channel" | "filter" | "direct";

export type RelayNavItem = {
  kind: RelayDestinationKind;
  id: string;
  title: string;
  subtitle: string;
  count: number;
};

export type RelayDirectState = "offline" | "available" | "working";

export type RelayDirectThread = {
  kind: "direct";
  id: string;
  title: string;
  subtitle: string;
  preview: string | null;
  timestampLabel: string | null;
  state: RelayDirectState;
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
  activeTask: string | null;
};

export type RelayVoiceState = {
  captureState: string;
  captureTitle: string;
  repliesEnabled: boolean;
  detail: string | null;
  isCapturing: boolean;
  speaking: boolean;
};

export type RelayMessageReceiptState = "sent" | "delivered" | "seen" | "replied";

export type RelayMessageReceipt = {
  state: RelayMessageReceiptState;
  label: string;
  detail: string | null;
};

export type RelayMessage = {
  receipt?: RelayMessageReceipt | null;
  id: string;
  conversationId: string;
  createdAt: number;
  replyToMessageId: string | null;
  authorId: string;
  authorName: string;
  authorRole: string | null;
  body: string;
  timestampLabel: string;
  dayLabel: string;
  normalizedChannel: string | null;
  recipients: string[];
  isDirectConversation: boolean;
  isSystem: boolean;
  isVoice: boolean;
  messageClass: string | null;
  routingSummary: string | null;
  provenanceSummary: string | null;
  provenanceDetail: string | null;
  isOperator: boolean;
  avatarLabel: string;
  avatarColor: string;
};

export type RelayState = {
  title: string;
  subtitle: string;
  transportTitle: string;
  meshTitle: string;
  syncLine: string;
  operatorId: string;
  channels: RelayNavItem[];
  views: RelayNavItem[];
  directs: RelayDirectThread[];
  messages: RelayMessage[];
  voice: RelayVoiceState;
  lastUpdatedLabel: string | null;
};

export type InterAgentParticipant = {
  id: string;
  title: string;
  role: string | null;
};

export type InterAgentAgent = {
  id: string;
  title: string;
  subtitle: string;
  profileKind: "project" | "role" | "system";
  source: string | null;
  agentClass: string | null;
  role: string | null;
  summary: string | null;
  harness: string | null;
  transport: string | null;
  cwd: string | null;
  projectRoot: string | null;
  sessionId: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  threadCount: number;
  counterpartCount: number;
  timestampLabel: string | null;
  state: RelayDirectState;
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
};

export type InterAgentThread = {
  id: string;
  conversationId: string | null;
  title: string;
  subtitle: string;
  preview: string | null;
  timestampLabel: string | null;
  messageCount: number;
  latestAuthorName: string | null;
  messageIds: string[];
  sourceKind: "private" | "projected";
  participants: InterAgentParticipant[];
};

export type InterAgentState = {
  title: string;
  subtitle: string;
  agents: InterAgentAgent[];
  threads: InterAgentThread[];
  lastUpdatedLabel: string | null;
};

export type SessionMetadata = {
  id: string;
  project: string;
  agent: string;
  title: string;
  messageCount: number;
  createdAt: string;
  lastModified: string;
  tokens?: number;
  model?: string;
  tags?: string[];
  preview: string;
};

export type DesktopRuntimeState = {
  helperRunning: boolean;
  helperDetail: string | null;
  brokerInstalled: boolean;
  brokerLoaded: boolean;
  brokerReachable: boolean;
  brokerHealthy: boolean;
  brokerLabel: string;
  brokerUrl: string;
  nodeId: string | null;
  agentCount: number;
  conversationCount: number;
  messageCount: number;
  flightCount: number;
  tmuxSessionCount: number;
  latestRelayLabel: string | null;
  lastHeartbeatLabel: string | null;
  updatedAtLabel: string | null;
};

export type DesktopShellState = {
  appInfo: DesktopAppInfo;
  runtime: DesktopRuntimeState;
  sessions: SessionMetadata[];
  relay: RelayState;
  interAgent: InterAgentState;
};

export type AgentConfigState = {
  agentId: string;
  editable: boolean;
  title: string;
  typeLabel: string | null;
  applyModeLabel: string | null;
  note: string | null;
  systemPromptHint: string | null;
  availableHarnesses: string[];
  runtime: {
    cwd: string;
    projectRoot: string | null;
    harness: string;
    transport: string;
    sessionId: string;
    wakePolicy: string;
    source: string | null;
  };
  systemPrompt: string;
  toolUse: {
    launchArgsText: string;
  };
  capabilitiesText: string;
};

export type UpdateAgentConfigInput = {
  agentId: string;
  runtime: {
    cwd: string;
    harness: string;
    sessionId: string;
  };
  systemPrompt: string;
  toolUse: {
    launchArgsText: string;
  };
  capabilitiesText: string;
};

export type RestartAgentInput = {
  agentId: string;
  previousSessionId?: string | null;
};

export type SendRelayMessageInput = {
  destinationKind: RelayDestinationKind;
  destinationId: string;
  body: string;
};

export type BrokerControlAction = "start" | "stop" | "restart";

declare global {
  interface Window {
    openScoutDesktop?: {
      isDesktop: boolean;
      getAppInfo: () => Promise<DesktopAppInfo>;
      getShellState: () => Promise<DesktopShellState>;
      refreshShellState: () => Promise<DesktopShellState>;
      getAgentConfig: (agentId: string) => Promise<AgentConfigState>;
      updateAgentConfig: (input: UpdateAgentConfigInput) => Promise<AgentConfigState>;
      restartAgent: (input: RestartAgentInput) => Promise<DesktopShellState>;
      sendRelayMessage: (input: SendRelayMessageInput) => Promise<DesktopShellState>;
      controlBroker: (action: BrokerControlAction) => Promise<DesktopShellState>;
      toggleVoiceCapture: () => Promise<DesktopShellState>;
      setVoiceRepliesEnabled: (enabled: boolean) => Promise<DesktopShellState>;
    };
  }
}
