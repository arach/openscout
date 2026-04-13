import type {
  ScoutDesktopAppInfo,
  ScoutDesktopHomeActivityItem,
  ScoutDesktopHomeAgent,
  ScoutDesktopHomeState,
  ScoutDesktopFeatureFlags,
  ScoutDesktopMessagesWorkspaceState,
  ScoutHostSurface,
  ScoutSurfaceCapabilities,
  ScoutDesktopMachine,
  ScoutDesktopMachinesState,
  ScoutDesktopMachineEndpoint,
  ScoutDesktopMachineEndpointState,
  ScoutDesktopMachineStatus,
  ScoutMessagesState,
  ScoutMessagesThread,
  ScoutMessagesThreadGroup,
  ScoutMessagesThreadKind,
  ScoutDesktopPlan,
  ScoutDesktopPlansState,
  ScoutDesktopPlanStatus,
  ScoutDesktopReconciliationFinding,
  ScoutDesktopReconciliationFindingKind,
  ScoutDesktopReconciliationFindingSeverity,
  ScoutDesktopRuntimeState,
  ScoutDesktopServicesState,
  ScoutDesktopShellPatch,
  ScoutDesktopShellState,
  ScoutDesktopTask,
  ScoutDesktopTaskStatus,
  ScoutInterAgentAgent,
  ScoutInterAgentParticipant,
  ScoutInterAgentState,
  ScoutInterAgentThread,
  ScoutPhonePreparationState,
  ScoutRelayDestinationKind,
  ScoutRelayDirectState,
  ScoutRelayDirectThread,
  ScoutRelayMessage,
  ScoutRelayMessageReceipt,
  ScoutRelayMessageReceiptState,
  ScoutRelayNavItem,
  ScoutRelayState,
  ScoutRelayVoiceState,
  ScoutSessionMetadata,
  UpdateScoutPhonePreparationInput,
} from "../../../app/desktop/state.ts";
import type {
  DecideScoutPairingApprovalInput,
  ScoutPairingApprovalRequest,
  ScoutPairingSnapshot,
  ScoutPairingState,
  UpdateScoutPairingConfigInput,
} from "../../../app/host/pairing.ts";
import type {
  AppSettingsState,
  HiddenProjectSummary,
  OnboardingCommandName,
  OnboardingCommandResult,
  RunOnboardingCommandInput,
  SetupAgentSummary,
  SetupOnboardingState,
  SetupOnboardingStep,
  SetupProjectHarnessSummary,
  SetupProjectSummary,
  SetupRuntimeSummary,
  UpdateAppSettingsInput,
} from "../../../app/host/settings.ts";
import type {
  ScoutDesktopAgentConfigState,
  ScoutDesktopUpdateAgentConfigInput,
} from "../../../app/host/agent-config.ts";
import type {
  ReadScoutLogSourceInput,
  ScoutDesktopBrokerInspector,
  ScoutDesktopFeedbackBundle,
  ScoutDesktopFeedbackSubmission,
  ScoutDesktopLogCatalog,
  ScoutDesktopLogContent,
  ScoutDesktopLogGroup,
  ScoutDesktopLogSource,
  SubmitScoutFeedbackReportInput,
} from "../../../app/host/diagnostics.ts";
import type { ScoutDesktopAgentSessionInspector } from "../../../app/host/agent-session.ts";
import type {
  ScoutDesktopCreateAgentInput,
  ScoutDesktopCreateAgentResult,
  ScoutDesktopBrokerControlAction,
  ScoutDesktopRestartAgentInput,
  ScoutDesktopSendRelayMessageInput,
} from "../../../app/host/broker-actions.ts";

export type DesktopFeatureFlags = ScoutDesktopFeatureFlags;
export type DesktopAppInfo = ScoutDesktopAppInfo;
export type DesktopHomeAgent = ScoutDesktopHomeAgent;
export type DesktopHomeActivityItem = ScoutDesktopHomeActivityItem;
export type DesktopHomeState = ScoutDesktopHomeState;
export type DesktopMessagesWorkspaceState = ScoutDesktopMessagesWorkspaceState;
export type DesktopHostSurface = ScoutHostSurface;
export type DesktopSurfaceCapabilities = ScoutSurfaceCapabilities;
export type MessagesThreadGroup = ScoutMessagesThreadGroup;
export type MessagesThreadKind = ScoutMessagesThreadKind;
export type MessagesThread = ScoutMessagesThread;
export type MessagesState = ScoutMessagesState;
export type RelayDestinationKind = ScoutRelayDestinationKind;
export type RelayNavItem = ScoutRelayNavItem;
export type RelayDirectState = ScoutRelayDirectState;
export type RelayDirectThread = ScoutRelayDirectThread;
export type RelayVoiceState = ScoutRelayVoiceState;
export type RelayMessageReceiptState = ScoutRelayMessageReceiptState;
export type RelayMessageReceipt = ScoutRelayMessageReceipt;
export type RelayMessage = ScoutRelayMessage;
export type RelayState = ScoutRelayState;
export type InterAgentParticipant = ScoutInterAgentParticipant;
export type InterAgentAgent = ScoutInterAgentAgent;
export type InterAgentThread = ScoutInterAgentThread;
export type InterAgentState = ScoutInterAgentState;
export type SessionMetadata = ScoutSessionMetadata;
export type PairingSnapshot = ScoutPairingSnapshot;
export type PairingApprovalRequest = ScoutPairingApprovalRequest;
export type PairingState = ScoutPairingState;
export type DesktopServicesState = ScoutDesktopServicesState;
export type DesktopRuntimeState = ScoutDesktopRuntimeState;
export type DesktopMachineEndpointState = ScoutDesktopMachineEndpointState;
export type DesktopMachineEndpoint = ScoutDesktopMachineEndpoint;
export type DesktopMachineStatus = ScoutDesktopMachineStatus;
export type DesktopMachine = ScoutDesktopMachine;
export type DesktopMachinesState = ScoutDesktopMachinesState;
export type DesktopTaskStatus = ScoutDesktopTaskStatus;
export type DesktopTask = ScoutDesktopTask;
export type DesktopReconciliationFindingSeverity = ScoutDesktopReconciliationFindingSeverity;
export type DesktopReconciliationFindingKind = ScoutDesktopReconciliationFindingKind;
export type DesktopReconciliationFinding = ScoutDesktopReconciliationFinding;
export type DesktopPlanStatus = ScoutDesktopPlanStatus;
export type DesktopPlan = ScoutDesktopPlan;
export type DesktopPlansState = ScoutDesktopPlansState;
export type DesktopShellState = ScoutDesktopShellState;
export type DesktopShellPatch = ScoutDesktopShellPatch;
export type PhonePreparationState = ScoutPhonePreparationState;
export type UpdatePhonePreparationInput = UpdateScoutPhonePreparationInput;

export type AgentConfigState = ScoutDesktopAgentConfigState;
export type UpdateAgentConfigInput = ScoutDesktopUpdateAgentConfigInput;
export type CreateAgentInput = ScoutDesktopCreateAgentInput;
export type CreateAgentResult = ScoutDesktopCreateAgentResult;
export type RestartAgentInput = ScoutDesktopRestartAgentInput;
export type SendRelayMessageInput = ScoutDesktopSendRelayMessageInput;
export type BrokerControlAction = ScoutDesktopBrokerControlAction;
export type UpdatePairingConfigInput = UpdateScoutPairingConfigInput;
export type DecidePairingApprovalInput = DecideScoutPairingApprovalInput;

export type DesktopLogGroup = ScoutDesktopLogGroup;
export type DesktopLogSource = ScoutDesktopLogSource;
export type DesktopLogCatalog = ScoutDesktopLogCatalog;
export type DesktopBrokerInspector = ScoutDesktopBrokerInspector;
export type DesktopFeedbackBundle = ScoutDesktopFeedbackBundle;
export type DesktopFeedbackSubmission = ScoutDesktopFeedbackSubmission;
export type ReadLogSourceInput = ReadScoutLogSourceInput;
export type DesktopLogContent = ScoutDesktopLogContent;
export type AgentSessionInspector = ScoutDesktopAgentSessionInspector;
export type SubmitFeedbackReportInput = SubmitScoutFeedbackReportInput;

export type {
  AppSettingsState,
  HiddenProjectSummary,
  OnboardingCommandName,
  OnboardingCommandResult,
  RunOnboardingCommandInput,
  SetupAgentSummary,
  SetupOnboardingState,
  SetupOnboardingStep,
  SetupProjectHarnessSummary,
  SetupProjectSummary,
  SetupRuntimeSummary,
  UpdateAppSettingsInput,
};
