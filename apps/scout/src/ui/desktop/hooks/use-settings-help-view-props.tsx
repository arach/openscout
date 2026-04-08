import React from 'react';
import { RefreshCw } from 'lucide-react';

import { compactHomePath, interAgentProfileKindLabel } from '@/components/relay/relay-utils';
import { type SettingsHelpViewProps } from '@/components/views/settings-help-view';
import { useAgentController } from '@/hooks/use-agent-controller';
import { useDiagnosticsController } from '@/hooks/use-diagnostics-controller';
import { useSettingsController } from '@/hooks/use-settings-controller';
import type {
  AppView,
  SettingsSectionMeta,
  WorkspaceExplorerFilterTab,
  WorkspaceExplorerViewMode,
} from '@/app-types';
import type { ScoutDesktopBridge } from '@/lib/electron';
import { C } from '@/lib/theme';
import type {
  DesktopFeatureFlags,
  DesktopShellState,
  DesktopSurfaceCapabilities,
  InterAgentAgent,
  RelayState,
} from '@/lib/scout-desktop';
import type { SettingsSectionId } from '@/settings/settings-paths';

type SharedSettingsStyles = SettingsHelpViewProps['help']['styles'];
type RenderOnboardingCommandShell = SettingsHelpViewProps['settings']['profile']['renderOnboardingCommandShell'];
type RenderLocalPathValue = SettingsHelpViewProps['settings']['profile']['renderLocalPathValue'];
type SettingsStats = SettingsHelpViewProps['settings']['database']['stats'];

type UseSettingsHelpViewPropsInput = {
  activeView: AppView;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  settingsSection: SettingsSectionId;
  setSettingsSection: React.Dispatch<React.SetStateAction<SettingsSectionId>>;
  settingsSections: SettingsSectionMeta[];
  activeSettingsMeta: SettingsSectionMeta;
  desktopFeatures: DesktopFeatureFlags;
  stats: SettingsStats;
  runtime: DesktopShellState['runtime'] | null;
  relayState: RelayState | null;
  relayRuntimeBooting: boolean;
  relayRuntimeHealthLabel: string;
  reachableRelayAgentCount: number;
  dark: boolean;
  setDark: SettingsHelpViewProps['settings']['appearance']['setDark'];
  showAnnotations: boolean;
  setShowAnnotations: SettingsHelpViewProps['settings']['appearance']['setShowAnnotations'];
  isCollapsed: boolean;
  styles: SharedSettingsStyles;
  scoutDesktop: ScoutDesktopBridge | null;
  surfaceCaps: DesktopSurfaceCapabilities | undefined;
  interAgentAgents: InterAgentAgent[];
  openKnowledgeBase: () => void;
  openAgentProfile: SettingsHelpViewProps['settings']['agentSettingsViewProps']['onOpenAgentProfile'];
  openDirectConversation: (
    agentId: string,
    options?: { draft?: string | null; focusComposer?: boolean },
  ) => void;
  renderOnboardingCommandShell: RenderOnboardingCommandShell;
  renderLocalPathValue: RenderLocalPathValue;
  settingsOperatorNameRef: React.RefObject<HTMLInputElement | null>;
  relayServiceInspectorRef: React.RefObject<HTMLElement | null>;
  handleSetVoiceRepliesEnabled: (enabled: boolean) => Promise<void> | void;
  settingsController: ReturnType<typeof useSettingsController>;
  diagnosticsController: ReturnType<typeof useDiagnosticsController>;
  agentController: ReturnType<typeof useAgentController>;
};

export function useSettingsHelpViewProps({
  activeView,
  setActiveView,
  settingsSection,
  setSettingsSection,
  settingsSections,
  activeSettingsMeta,
  desktopFeatures,
  stats,
  runtime,
  relayState,
  relayRuntimeBooting,
  relayRuntimeHealthLabel,
  reachableRelayAgentCount,
  dark,
  setDark,
  showAnnotations,
  setShowAnnotations,
  isCollapsed,
  styles,
  scoutDesktop,
  surfaceCaps,
  interAgentAgents,
  openKnowledgeBase,
  openAgentProfile,
  openDirectConversation,
  renderOnboardingCommandShell,
  renderLocalPathValue,
  settingsOperatorNameRef,
  relayServiceInspectorRef,
  handleSetVoiceRepliesEnabled,
  settingsController,
  diagnosticsController,
  agentController,
}: UseSettingsHelpViewPropsInput): SettingsHelpViewProps {
  const [selectedAgentableProjectId, setSelectedAgentableProjectId] = React.useState<string | null>(null);
  const [workspaceExplorerQuery, setWorkspaceExplorerQuery] = React.useState('');
  const [workspaceExplorerFilter, setWorkspaceExplorerFilter] = React.useState<WorkspaceExplorerFilterTab>('all');
  const [workspaceExplorerViewMode, setWorkspaceExplorerViewMode] = React.useState<WorkspaceExplorerViewMode>('grid');

  const selectedAgentableProject = React.useMemo(
    () => settingsController.agentableProjects.find((project) => project.id === selectedAgentableProjectId) ?? null,
    [selectedAgentableProjectId, settingsController.agentableProjects],
  );
  const selectedWorkspaceProject = selectedAgentableProject;
  const selectedWorkspaceAgent = React.useMemo(
    () => selectedWorkspaceProject
      ? interAgentAgents.find((agent) => (
        agent.id === selectedWorkspaceProject.id || agent.id === selectedWorkspaceProject.definitionId
      )) ?? null
      : null,
    [interAgentAgents, selectedWorkspaceProject],
  );
  const workspaceExplorerItems = React.useMemo(
    () => settingsController.agentableProjects.map((project) => {
      const linkedAgent = interAgentAgents.find((agent) => (
        agent.id === project.id || agent.id === project.definitionId
      )) ?? null;
      const isBound = Boolean(linkedAgent) || project.registrationKind === 'configured';
      const primaryHarness = project.harnesses[0]?.harness ?? project.defaultHarness;
      return {
        project,
        linkedAgent,
        isBound,
        primaryHarness,
        pathLabel: compactHomePath(project.root) ?? project.root,
        branchLabel: 'local',
        activityLabel: linkedAgent?.timestampLabel ?? 'Workspace',
        statusLabel: isBound ? 'Bound' : project.registrationKind === 'configured' ? 'Ready' : 'Discovered',
      };
    }),
    [interAgentAgents, settingsController.agentableProjects],
  );
  const filteredWorkspaceExplorerItems = React.useMemo(() => {
    const query = workspaceExplorerQuery.trim().toLowerCase();
    return workspaceExplorerItems.filter(({ project, isBound, primaryHarness }) => {
      const matchesFilter = workspaceExplorerFilter === 'all'
        ? true
        : workspaceExplorerFilter === 'bound'
          ? isBound
          : !isBound;
      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        project.title,
        project.projectName,
        project.root,
        project.relativePath,
        primaryHarness,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [workspaceExplorerFilter, workspaceExplorerItems, workspaceExplorerQuery]);
  const workspaceExplorerBoundCount = React.useMemo(
    () => workspaceExplorerItems.filter((item) => item.isBound).length,
    [workspaceExplorerItems],
  );
  const workspaceExplorerDiscoveredCount = React.useMemo(
    () => workspaceExplorerItems.filter((item) => !item.isBound).length,
    [workspaceExplorerItems],
  );

  React.useEffect(() => {
    if (!selectedAgentableProjectId) {
      return;
    }

    if (!settingsController.agentableProjects.some((project) => project.id === selectedAgentableProjectId)) {
      setSelectedAgentableProjectId(null);
    }
  }, [selectedAgentableProjectId, settingsController.agentableProjects]);

  const handleInspectWorkspace = React.useCallback((project: typeof settingsController.agentableProjects[number]) => {
    setSelectedAgentableProjectId(project.id);
    agentController.resetAgentInspector();
  }, [agentController]);

  const handleOpenWorkspace = React.useCallback((project: typeof settingsController.agentableProjects[number]) => {
    if (project.registrationKind === 'configured') {
      openAgentProfile(project.id);
      return;
    }
    handleInspectWorkspace(project);
  }, [handleInspectWorkspace, openAgentProfile]);

  const handleAddWorkspaceFromExplorer = React.useCallback(() => {
    setActiveView('settings');
    setSettingsSection('profile');
    settingsController.handleBeginGeneralEdit();
    settingsController.setAppSettingsFeedback('Add a scan folder below, then go back to Workspaces and refresh to discover workspaces.');
  }, [setActiveView, setSettingsSection, settingsController]);

  const handleRetireWorkspace = React.useCallback((project: typeof settingsController.agentableProjects[number]) => {
    void settingsController.handleRetireProject(project.root, project.title).then((retired) => {
      if (!retired || selectedAgentableProject?.root !== project.root) {
        return;
      }
      setSelectedAgentableProjectId(null);
      agentController.resetAgentInspector();
    });
  }, [agentController, selectedAgentableProject?.root, settingsController]);

  const headerActions = settingsSection === 'profile' ? (
    <>
      {settingsController.isAppSettingsEditing ? (
        <>
          <button
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
            style={{ color: C.ink }}
            onClick={() => settingsController.handleCancelAppSettingsEdit()}
            disabled={settingsController.appSettingsSaving}
          >
            Cancel
          </button>
          <button
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
            style={{ color: C.ink }}
            onClick={() => void settingsController.handleSaveAppSettings()}
            disabled={!settingsController.appSettingsDirty || settingsController.appSettingsSaving || settingsController.appSettingsLoading}
          >
            {settingsController.appSettingsSaving ? 'Saving…' : 'Save General'}
          </button>
        </>
      ) : (
        <button
          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
          style={{ color: C.ink }}
          onClick={() => settingsController.handleStartAppSettingsEdit()}
          disabled={settingsController.appSettingsLoading || !settingsController.visibleAppSettings}
        >
          Edit General
        </button>
      )}
      <button
        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
        style={{ color: C.ink }}
        onClick={settingsController.handleRestartOnboarding}
        disabled={settingsController.appSettingsLoading || !settingsController.visibleAppSettings}
      >
        <RefreshCw size={12} />
        Restart onboarding
      </button>
    </>
  ) : settingsSection === 'communication' ? (
    settingsController.isAppSettingsEditing ? (
      <>
        <button
          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
          style={{ color: C.ink }}
          onClick={() => settingsController.handleCancelAppSettingsEdit()}
          disabled={settingsController.appSettingsSaving}
        >
          Cancel
        </button>
        <button
          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
          style={{ color: C.ink }}
          onClick={() => void settingsController.handleSaveAppSettings()}
          disabled={!settingsController.appSettingsDirty || settingsController.appSettingsSaving || settingsController.appSettingsLoading}
        >
          {settingsController.appSettingsSaving ? 'Saving…' : desktopFeatures.telegram ? 'Save Telegram' : 'Save Communication'}
        </button>
      </>
    ) : (
      <button
        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
        style={{ color: C.ink }}
        onClick={() => settingsController.handleStartAppSettingsEdit()}
        disabled={settingsController.appSettingsLoading || !settingsController.visibleAppSettings}
      >
        {desktopFeatures.telegram ? 'Edit Telegram' : 'Edit Communication'}
      </button>
    )
  ) : settingsSection === 'agents' ? (
    <>
      <button
        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
        style={{ color: C.ink }}
        onClick={() => setActiveView('agents')}
      >
        Open Agents
      </button>
      {agentController.selectedInterAgent && agentController.hasEditableAgentConfig ? (
        agentController.isAgentConfigEditing ? (
          <>
            <button
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
              style={{ color: C.ink }}
              onClick={() => agentController.handleCancelAgentConfigEdit()}
              disabled={agentController.agentConfigSaving || agentController.agentConfigRestarting}
            >
              Cancel
            </button>
            <button
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
              style={{ color: C.ink }}
              onClick={() => void agentController.handleSaveAgentConfig()}
              disabled={!agentController.agentConfigDirty || agentController.agentConfigLoading || agentController.agentConfigSaving || agentController.agentConfigRestarting}
            >
              {agentController.agentConfigSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <button
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
            style={{ color: C.ink }}
            onClick={() => agentController.handleStartAgentConfigEdit()}
            disabled={agentController.agentConfigLoading || agentController.agentConfigRestarting}
          >
            Edit Agent
          </button>
        )
      ) : null}
      {agentController.selectedInterAgent && agentController.hasEditableAgentConfig ? (
        <button
          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
          style={{ color: C.ink }}
          onClick={() => void agentController.handleRestartAgent()}
          disabled={agentController.agentConfigLoading || agentController.agentConfigRestarting || !agentController.visibleAgentConfig}
        >
          {agentController.agentConfigRestarting ? 'Restarting…' : agentController.agentRestartActionLabel}
        </button>
      ) : null}
    </>
  ) : settingsSection === 'database' ? (
    <button
      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ color: C.ink }}
      onClick={() => setActiveView('sessions')}
    >
      Browse Sessions
    </button>
  ) : null;

  return {
    activeView,
    help: {
      styles,
      buildOnboardingCommandLine: settingsController.buildOnboardingCommandLine,
      onboardingCopiedCommand: settingsController.onboardingCopiedCommand,
      onboardingCommandPending: settingsController.onboardingCommandPending,
      onCopyOnboardingCommand: settingsController.handleCopyOnboardingCommand,
      onRunOnboardingCommand: settingsController.handleRunOnboardingCommand,
      onOpenGeneralSettings: () => {
        setActiveView('settings');
        setSettingsSection('profile');
      },
    },
    settings: {
      styles,
      settingsSection,
      settingsSections,
      activeSettingsMeta,
      onSetSettingsSection: setSettingsSection,
      onOpenFeedbackDialog: diagnosticsController.openFeedbackDialog,
      headerActions,
      profile: {
        styles,
        visibleAppSettings: settingsController.visibleAppSettings,
        appSettings: settingsController.appSettings,
        isAppSettingsEditing: settingsController.isAppSettingsEditing,
        appSettingsSaving: settingsController.appSettingsSaving,
        appSettingsLoading: settingsController.appSettingsLoading,
        appSettingsDirty: settingsController.appSettingsDirty,
        appSettingsFeedback: settingsController.appSettingsFeedback,
        settingsOperatorNameRef,
        onboardingWizardStep: settingsController.onboardingWizardStep,
        setOnboardingWizardStep: settingsController.setOnboardingWizardStep,
        activeOnboardingStepIndex: settingsController.onboardingWizardIndex,
        activeOnboardingStep: settingsController.activeOnboardingStep,
        onboardingWizardSteps: settingsController.onboardingWizardSteps,
        sourceRootPathSuggestions: settingsController.SOURCE_ROOT_PATH_SUGGESTIONS,
        onboardingRuntimeMatch: settingsController.onboardingRuntimeMatch,
        onboardingHasProjectConfig: settingsController.onboardingHasProjectConfig,
        onboardingCopiedCommand: settingsController.onboardingCopiedCommand,
        onboardingCommandPending: settingsController.onboardingCommandPending,
        onboardingCommandResult: settingsController.onboardingCommandResult,
        canGoToPreviousOnboardingStep: settingsController.canGoToPreviousOnboardingStep,
        canGoToNextOnboardingStep: settingsController.canGoToNextOnboardingStep,
        moveOnboardingWizard: settingsController.moveOnboardingWizard,
        handleOnboardingContinue: settingsController.handleOnboardingContinue,
        handleRestartOnboarding: settingsController.handleRestartOnboarding,
        handleStartAppSettingsEdit: settingsController.handleStartAppSettingsEdit,
        handleBeginGeneralEdit: settingsController.handleBeginGeneralEdit,
        handleSetSourceRootAt: settingsController.handleSetSourceRootAt,
        handleBrowseForSourceRoot: settingsController.handleBrowseForSourceRoot,
        handleRemoveSourceRootRow: settingsController.handleRemoveSourceRootRow,
        handleAddSourceRootRow: settingsController.handleAddSourceRootRow,
        handleAddSourceRootSuggestion: settingsController.handleAddSourceRootSuggestion,
        handleSetOnboardingContextRoot: settingsController.handleSetOnboardingContextRoot,
        handleBrowseForOnboardingContextRoot: settingsController.handleBrowseForOnboardingContextRoot,
        setAppSettingsDraft: settingsController.setAppSettingsDraft,
        setAppSettingsFeedback: settingsController.setAppSettingsFeedback,
        buildOnboardingCommandLine: settingsController.buildOnboardingCommandLine,
        handleCopyOnboardingCommand: settingsController.handleCopyOnboardingCommand,
        handleRunOnboardingCommand: settingsController.handleRunOnboardingCommand,
        renderOnboardingCommandShell,
        renderLocalPathValue,
        openKnowledgeBase,
      },
      agentSettingsViewProps: {
        styles,
        selectedInterAgent: agentController.selectedInterAgent,
        availableAgents: agentController.rosterInterAgentAgents,
        isAgentConfigEditing: agentController.isAgentConfigEditing,
        hasEditableAgentConfig: agentController.hasEditableAgentConfig,
        agentConfigLoading: agentController.agentConfigLoading,
        agentConfigSaving: agentController.agentConfigSaving,
        agentConfigRestarting: agentController.agentConfigRestarting,
        visibleAgentConfig: agentController.visibleAgentConfig,
        agentConfigFeedback: agentController.agentConfigFeedback,
        agentCapabilitiesPreview: agentController.agentCapabilitiesPreview,
        agentRuntimePathRef: agentController.agentRuntimePathRef,
        onOpenAgents: () => setActiveView('agents'),
        onOpenAgentProfile: openAgentProfile,
        onOpenAgentThread: (agentId) => openDirectConversation(agentId, { focusComposer: true }),
        onUpdateAgentConfigDraft: agentController.updateAgentConfigDraft,
        renderLocalPathValue,
        interAgentProfileKindLabel,
        onSelectAgent: agentController.handleSelectInterAgent,
      },
      workspaceExplorerViewProps: {
        styles,
        selectedWorkspaceProject,
        selectedWorkspaceAgent,
        workspaceExplorerQuery,
        setWorkspaceExplorerQuery,
        workspaceExplorerFilter,
        setWorkspaceExplorerFilter,
        workspaceExplorerViewMode,
        setWorkspaceExplorerViewMode,
        workspaceExplorerItems,
        workspaceExplorerBoundCount,
        workspaceExplorerDiscoveredCount,
        filteredWorkspaceExplorerItems,
        workspaceInventoryLoaded: settingsController.workspaceInventoryLoaded,
        workspaceInventoryLoading: settingsController.workspaceInventoryLoading,
        canRefreshWorkspaceInventory: settingsController.canRefreshWorkspaceInventory,
        onboardingCommandPending: settingsController.onboardingCommandPending,
        appSettingsLoading: settingsController.appSettingsLoading,
        appSettingsSaving: settingsController.appSettingsSaving,
        appSettingsDirty: settingsController.appSettingsDirty,
        appSettingsFeedback: settingsController.appSettingsFeedback,
        showDoctorOutput: settingsController.showDoctorOutput,
        doctorOutput: renderOnboardingCommandShell(
          'doctor',
          settingsController.buildOnboardingCommandLine('doctor'),
          settingsController.onboardingCommandPending === 'doctor',
        ),
        projectRetirementPendingRoot: settingsController.projectRetirementPendingRoot,
        onRefreshWorkspaceDiscovery: () => {
          void settingsController.handleRunOnboardingCommand('doctor');
        },
        onLoadWorkspaceInventory: settingsController.handleLoadWorkspaceInventory,
        onAddWorkspace: handleAddWorkspaceFromExplorer,
        onInspectWorkspace: handleInspectWorkspace,
        onOpenWorkspace: handleOpenWorkspace,
        onRetireWorkspace: handleRetireWorkspace,
        onOpenAgentProfile: openAgentProfile,
        onOpenAgentSettings: (agentId) => agentController.handleOpenAgentSettings(agentId, true),
        renderLocalPathValue,
      },
      communicationSettingsViewProps: {
        styles,
        showTelegram: desktopFeatures.telegram,
        showVoice: desktopFeatures.voice,
        visibleAppSettings: settingsController.visibleAppSettings,
        isAppSettingsEditing: settingsController.isAppSettingsEditing,
        appSettingsSaving: settingsController.appSettingsSaving,
        appSettingsFeedback: settingsController.appSettingsFeedback,
        onUpdateAppSettingsDraft: settingsController.updateAppSettingsDraft,
        brokerInspector: diagnosticsController.brokerInspector,
        brokerControlPending: diagnosticsController.brokerControlPending,
        brokerControlFeedback: diagnosticsController.brokerControlFeedback,
        onBrokerControl: (action) => {
          void diagnosticsController.handleBrokerControl(action);
        },
        relayServiceInspectorRef,
        relayRuntimeBooting,
        relayRuntimeHealthLabel,
        runtime,
        reachableRelayAgentCount,
        voiceCaptureTitle: relayState?.voice.captureTitle ?? 'Not reported',
        voiceRepliesEnabled: relayState?.voice.repliesEnabled ?? false,
        onSetVoiceRepliesEnabled: (enabled) => {
          void handleSetVoiceRepliesEnabled(enabled);
        },
        renderLocalPathValue,
      },
      database: {
        styles,
        stats,
        runtime,
        visibleAppSettings: settingsController.visibleAppSettings,
        renderLocalPathValue,
        onRevealPath: (filePath) => {
          if (!surfaceCaps?.canRevealPath) {
            return;
          }
          void scoutDesktop?.revealPath?.(filePath);
        },
      },
      appearance: {
        styles,
        dark,
        setDark,
        showAnnotations,
        setShowAnnotations,
        isCollapsed,
        activeSettingsLabel: activeSettingsMeta.label,
      },
    },
  };
}
