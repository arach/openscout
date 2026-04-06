import type {
  ScoutDesktopAppInfo,
  ScoutDesktopFeatureFlags,
  ScoutDesktopMachine,
  ScoutDesktopMachinesState,
  ScoutDesktopMachineEndpoint,
  ScoutDesktopMachineEndpointState,
  ScoutDesktopMachineStatus,
  ScoutDesktopPlan,
  ScoutDesktopPlansState,
  ScoutDesktopPlanStatus,
  ScoutDesktopReconciliationFinding,
  ScoutDesktopReconciliationFindingKind,
  ScoutDesktopReconciliationFindingSeverity,
  ScoutDesktopRuntimeState,
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
} from "../../../app/electron/pairing.ts";
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
} from "../../../app/electron/settings.ts";
import type {
  ScoutElectronAgentConfigState,
  ScoutElectronUpdateAgentConfigInput,
} from "../../../app/electron/agent-config.ts";
import type {
  ReadScoutLogSourceInput,
  ScoutDesktopBrokerInspector,
  ScoutDesktopLogCatalog,
  ScoutDesktopLogContent,
  ScoutDesktopLogGroup,
  ScoutDesktopLogSource,
} from "../../../app/electron/diagnostics.ts";
import type { ScoutElectronAgentSessionInspector } from "../../../app/electron/agent-session.ts";
import type {
  ScoutElectronCreateAgentInput,
  ScoutElectronCreateAgentResult,
  ScoutElectronBrokerControlAction,
  ScoutElectronRestartAgentInput,
  ScoutElectronSendRelayMessageInput,
} from "../../../app/electron/broker-actions.ts";

export type DesktopFeatureFlags = ScoutDesktopFeatureFlags;
export type DesktopAppInfo = ScoutDesktopAppInfo;
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
export type PhonePreparationState = ScoutPhonePreparationState;
export type UpdatePhonePreparationInput = UpdateScoutPhonePreparationInput;

export type AgentConfigState = ScoutElectronAgentConfigState;
export type UpdateAgentConfigInput = ScoutElectronUpdateAgentConfigInput;
export type CreateAgentInput = ScoutElectronCreateAgentInput;
export type CreateAgentResult = ScoutElectronCreateAgentResult;
export type RestartAgentInput = ScoutElectronRestartAgentInput;
export type SendRelayMessageInput = ScoutElectronSendRelayMessageInput;
export type BrokerControlAction = ScoutElectronBrokerControlAction;
export type UpdatePairingConfigInput = UpdateScoutPairingConfigInput;
export type DecidePairingApprovalInput = DecideScoutPairingApprovalInput;

export type DesktopLogGroup = ScoutDesktopLogGroup;
export type DesktopLogSource = ScoutDesktopLogSource;
export type DesktopLogCatalog = ScoutDesktopLogCatalog;
export type DesktopBrokerInspector = ScoutDesktopBrokerInspector;
export type ReadLogSourceInput = ReadScoutLogSourceInput;
export type DesktopLogContent = ScoutDesktopLogContent;
export type AgentSessionInspector = ScoutElectronAgentSessionInspector;

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
