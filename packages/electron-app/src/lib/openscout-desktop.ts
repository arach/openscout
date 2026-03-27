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

export type RelayDirectThread = {
  kind: "direct";
  id: string;
  title: string;
  subtitle: string;
  preview: string | null;
  timestampLabel: string | null;
  state: string;
  reachable: boolean;
};

export type RelayVoiceState = {
  captureState: string;
  captureTitle: string;
  repliesEnabled: boolean;
  detail: string | null;
  isCapturing: boolean;
};

export type RelayMessageReceipt = {
  state: string;
  label: string;
  detail: string | null;
};

export type RelayMessage = {
  receipt?: RelayMessageReceipt | null;
  id: string;
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
      sendRelayMessage: (input: SendRelayMessageInput) => Promise<DesktopShellState>;
      controlBroker: (action: BrokerControlAction) => Promise<DesktopShellState>;
    };
  }
}
