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
  registrationKind: "configured" | "discovered";
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
  lastChatAt: number | null;
  lastChatLabel: string | null;
  lastCodeChangeAt: number | null;
  lastCodeChangeLabel: string | null;
  lastSessionAt: number | null;
  lastSessionLabel: string | null;
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

export type DesktopMachineEndpointState = "running" | "idle" | "waiting" | "offline";

export type DesktopMachineEndpoint = {
  id: string;
  agentId: string;
  agentName: string;
  project: string | null;
  projectRoot: string | null;
  cwd: string | null;
  harness: string | null;
  transport: string | null;
  sessionId: string | null;
  state: DesktopMachineEndpointState;
  stateLabel: string;
  reachable: boolean;
  lastActiveLabel: string | null;
  activeTask: string | null;
};

export type DesktopMachineStatus = "online" | "degraded" | "offline";

export type DesktopMachine = {
  id: string;
  title: string;
  hostName: string | null;
  status: DesktopMachineStatus;
  statusLabel: string;
  statusDetail: string | null;
  advertiseScope: string | null;
  brokerUrl: string | null;
  capabilities: string[];
  labels: string[];
  isLocal: boolean;
  registeredAtLabel: string | null;
  lastSeenLabel: string | null;
  projectRoots: string[];
  projectCount: number;
  endpointCount: number;
  reachableEndpointCount: number;
  workingEndpointCount: number;
  idleEndpointCount: number;
  waitingEndpointCount: number;
  endpoints: DesktopMachineEndpoint[];
};

export type DesktopMachinesState = {
  title: string;
  subtitle: string;
  totalMachines: number;
  onlineCount: number;
  degradedCount: number;
  offlineCount: number;
  lastUpdatedLabel: string | null;
  machines: DesktopMachine[];
};

export type DesktopTaskStatus = "queued" | "running" | "completed" | "failed";

export type DesktopTask = {
  id: string;
  messageId: string;
  conversationId: string;
  targetAgentId: string;
  targetAgentName: string;
  project: string | null;
  projectRoot: string | null;
  title: string;
  body: string;
  status: DesktopTaskStatus;
  statusLabel: string;
  statusDetail: string | null;
  replyPreview: string | null;
  createdAt: number;
  createdAtLabel: string;
  updatedAtLabel: string | null;
  ageLabel: string | null;
};

export type DesktopPlanStatus =
  | "awaiting-review"
  | "in-progress"
  | "completed"
  | "paused"
  | "draft";

export type DesktopPlan = {
  id: string;
  title: string;
  summary: string;
  status: DesktopPlanStatus;
  stepsCompleted: number;
  stepsTotal: number;
  progressPercent: number;
  tags: string[];
  twinId: string;
  agent: string;
  workspaceName: string;
  workspacePath: string;
  path: string;
  updatedAt: string;
  updatedAtLabel: string;
};

export type DesktopPlansState = {
  title: string;
  subtitle: string;
  taskCount: number;
  runningTaskCount: number;
  failedTaskCount: number;
  completedTaskCount: number;
  planCount: number;
  workspaceCount: number;
  lastUpdatedLabel: string | null;
  tasks: DesktopTask[];
  plans: DesktopPlan[];
};

export type DesktopShellState = {
  appInfo: DesktopAppInfo;
  runtime: DesktopRuntimeState;
  machines: DesktopMachinesState;
  plans: DesktopPlansState;
  sessions: SessionMetadata[];
  relay: RelayState;
  interAgent: InterAgentState;
};

export type SetupAgentSummary = {
  id: string;
  title: string;
  root: string;
  source: string;
  registrationKind: "configured" | "discovered";
  harness: string;
  sessionId: string;
  projectConfigPath: string | null;
};

export type AppSettingsState = {
  operatorId: string;
  operatorName: string;
  operatorNameDefault: string;
  note: string | null;
  settingsPath: string;
  relayAgentsPath: string;
  relayHubPath: string;
  supportDirectory: string;
  currentProjectConfigPath: string | null;
  workspaceRoots: string[];
  workspaceRootsNote: string | null;
  includeCurrentRepo: boolean;
  defaultHarness: string;
  defaultTransport: string;
  defaultCapabilities: string[];
  sessionPrefix: string;
  discoveredAgents: SetupAgentSummary[];
  broker: {
    label: string;
    url: string;
    installed: boolean;
    loaded: boolean;
    reachable: boolean;
    launchAgentPath: string;
    stdoutLogPath: string;
    stderrLogPath: string;
  };
};

export type UpdateAppSettingsInput = {
  operatorName: string;
  workspaceRootsText: string;
  includeCurrentRepo: boolean;
  defaultHarness: string;
  defaultCapabilitiesText: string;
  sessionPrefix: string;
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
  replyToMessageId?: string | null;
};

export type BrokerControlAction = "start" | "stop" | "restart";

export type DesktopLogGroup = "runtime" | "app" | "agents";

export type DesktopLogSource = {
  id: string;
  title: string;
  subtitle: string;
  group: DesktopLogGroup;
  pathLabel: string;
};

export type DesktopLogCatalog = {
  sources: DesktopLogSource[];
  defaultSourceId: string | null;
};

export type DesktopBrokerInspector = {
  statusLabel: string;
  statusDetail: string | null;
  version: string | null;
  label: string;
  mode: string;
  url: string;
  installed: boolean;
  loaded: boolean;
  reachable: boolean;
  pid: string | null;
  processCommand: string | null;
  lastRestartLabel: string | null;
  nodeId: string | null;
  meshId: string | null;
  launchdState: string | null;
  lastExitStatus: string | null;
  lastLogLine: string | null;
  supportDirectory: string;
  controlHome: string;
  launchAgentPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  actorCount: number | null;
  agentCount: number | null;
  conversationCount: number | null;
  messageCount: number | null;
  flightCount: number | null;
  troubleshooting: string[];
  feedbackSummary: string;
};

export type ReadLogSourceInput = {
  sourceId: string;
  tailLines?: number;
};

export type DesktopLogContent = {
  sourceId: string;
  title: string;
  subtitle: string;
  pathLabel: string;
  body: string;
  updatedAtLabel: string | null;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
};

declare global {
  interface Window {
    openScoutDesktop?: {
      isDesktop: boolean;
      getAppInfo: () => Promise<DesktopAppInfo>;
      getShellState: () => Promise<DesktopShellState>;
      refreshShellState: () => Promise<DesktopShellState>;
      getAppSettings: () => Promise<AppSettingsState>;
      updateAppSettings: (input: UpdateAppSettingsInput) => Promise<AppSettingsState>;
      getAgentConfig: (agentId: string) => Promise<AgentConfigState>;
      updateAgentConfig: (input: UpdateAgentConfigInput) => Promise<AgentConfigState>;
      restartAgent: (input: RestartAgentInput) => Promise<DesktopShellState>;
      sendRelayMessage: (input: SendRelayMessageInput) => Promise<DesktopShellState>;
      controlBroker: (action: BrokerControlAction) => Promise<DesktopShellState>;
      getLogCatalog: () => Promise<DesktopLogCatalog>;
      getBrokerInspector: () => Promise<DesktopBrokerInspector>;
      readLogSource: (input: ReadLogSourceInput) => Promise<DesktopLogContent>;
      toggleVoiceCapture: () => Promise<DesktopShellState>;
      setVoiceRepliesEnabled: (enabled: boolean) => Promise<DesktopShellState>;
    };
  }
}
