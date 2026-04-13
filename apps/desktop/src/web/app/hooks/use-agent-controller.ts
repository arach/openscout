import React from "react";

import { copyTextToClipboard } from "@web/features/messages/components/relay-timeline";
import {
  asErrorMessage,
  compareAgentRoster,
  firstInterAgentThreadIdForAgent,
  isAgentRosterActive,
  parseCapabilityText,
  relaySecondaryText,
  serializeEditableAgentConfig,
} from "@web/features/messages/lib/relay-utils";
import type { AgentRosterFilterMode, AgentRosterSortMode } from "@web/features/messages/lib/relay-types";
import type { AppView } from "@/app-types";
import { buildDefaultCreateAgentDraft } from "@/app-utils";
import type { ScoutDesktopBridge } from "@/lib/desktop-bridge";
import type {
  AgentConfigState,
  AgentSessionInspector,
  AppSettingsState,
  DesktopShellState,
  DesktopSurfaceCapabilities,
  InterAgentAgent,
  InterAgentState,
  InterAgentThread,
  MessagesThread,
  RelayDestinationKind,
  RelayState,
  SetupProjectSummary,
} from "@/lib/scout-desktop";
import type { SettingsSectionId } from "@/settings/settings-paths";

type UseAgentControllerInput = {
  activeView: AppView;
  scoutDesktop: ScoutDesktopBridge | null;
  surfaceCaps: DesktopSurfaceCapabilities | undefined;
  interAgentState: InterAgentState | null;
  interAgentAgents: InterAgentAgent[];
  interAgentThreads: InterAgentThread[];
  relayState: RelayState | null;
  selectedMessagesThread: MessagesThread | null;
  selectedMessagesDetailAgentId: string | null;
  selectedRelayKind: RelayDestinationKind;
  selectedRelayId: string;
  agentableProjects: SetupProjectSummary[];
  visibleAppSettings: AppSettingsState | null;
  isAppSettingsEditing: boolean;
  appSettingsDirty: boolean;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettingsState | null>>;
  setAppSettingsDraft: React.Dispatch<React.SetStateAction<AppSettingsState | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setSettingsSection: React.Dispatch<React.SetStateAction<SettingsSectionId>>;
  setSettingsAgentId: React.Dispatch<React.SetStateAction<string | null>>;
  setShellState: React.Dispatch<React.SetStateAction<DesktopShellState | null>>;
  setShellError: React.Dispatch<React.SetStateAction<string | null>>;
  setRelayFeedback: React.Dispatch<React.SetStateAction<string | null>>;
};

type SessionTargetInput = {
  activeView: AppView;
  selectedMessagesThread: MessagesThread | null;
  selectedRelayKind: RelayDestinationKind;
  selectedRelayId: string;
  selectedInterAgentId: string | null;
};

function resolveAgentSessionTargetId({
  activeView,
  selectedMessagesThread,
  selectedRelayKind,
  selectedRelayId,
  selectedInterAgentId,
}: SessionTargetInput) {
  if (activeView === "messages") {
    return selectedMessagesThread?.kind === "relay" && selectedRelayKind === "direct"
      ? selectedRelayId
      : null;
  }

  if (activeView === "agents") {
    return selectedInterAgentId;
  }

  return null;
}

function buildAgentConfigUpdate(config: AgentConfigState) {
  return {
    runtime: {
      cwd: config.runtime.cwd,
      harness: config.runtime.harness,
      sessionId: config.runtime.sessionId,
      transport: config.runtime.transport,
    },
    systemPrompt: config.systemPrompt,
    toolUse: {
      launchArgsText: config.toolUse.launchArgsText,
    },
    capabilitiesText: config.capabilitiesText,
  };
}

export function useAgentController({
  activeView,
  scoutDesktop,
  surfaceCaps,
  interAgentState,
  interAgentAgents,
  interAgentThreads,
  relayState,
  selectedMessagesThread,
  selectedMessagesDetailAgentId,
  selectedRelayKind,
  selectedRelayId,
  agentableProjects,
  visibleAppSettings,
  isAppSettingsEditing,
  appSettingsDirty,
  setAppSettings,
  setAppSettingsDraft,
  setActiveView,
  setSettingsSection,
  setSettingsAgentId,
  setShellState,
  setShellError,
  setRelayFeedback,
}: UseAgentControllerInput) {
  const [selectedInterAgentId, setSelectedInterAgentId] = React.useState<string | null>(null);
  const [selectedInterAgentThreadId, setSelectedInterAgentThreadId] = React.useState<string | null>(null);
  const [agentRosterFilter, setAgentRosterFilter] = React.useState<AgentRosterFilterMode>("all");
  const [agentRosterSort, setAgentRosterSort] = React.useState<AgentRosterSortMode>("chat");
  const [agentThreadsExpanded, setAgentThreadsExpanded] = React.useState(false);
  const [agentSnapshotExpanded, setAgentSnapshotExpanded] = React.useState(false);
  const [agentActivityExpanded, setAgentActivityExpanded] = React.useState(false);
  const [agentSessionLogsExpanded, setAgentSessionLogsExpanded] = React.useState(false);
  const [agentRosterMenu, setAgentRosterMenu] = React.useState<null | "filter" | "sort">(null);
  const [agentConfig, setAgentConfig] = React.useState<AgentConfigState | null>(null);
  const [agentConfigDraft, setAgentConfigDraft] = React.useState<AgentConfigState | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = React.useState(false);
  const [agentConfigSaving, setAgentConfigSaving] = React.useState(false);
  const [agentConfigRestarting, setAgentConfigRestarting] = React.useState(false);
  const [agentConfigFeedback, setAgentConfigFeedback] = React.useState<string | null>(null);
  const [pendingConfigFocusAgentId, setPendingConfigFocusAgentId] = React.useState<string | null>(null);
  const [isAgentConfigEditing, setIsAgentConfigEditing] = React.useState(false);
  const [isCreateAgentDialogOpen, setIsCreateAgentDialogOpen] = React.useState(false);
  const [createAgentDraft, setCreateAgentDraft] = React.useState(() => buildDefaultCreateAgentDraft(agentableProjects, visibleAppSettings));
  const [createAgentSubmitting, setCreateAgentSubmitting] = React.useState(false);
  const [createAgentFeedback, setCreateAgentFeedback] = React.useState<string | null>(null);
  const [agentSession, setAgentSession] = React.useState<AgentSessionInspector | null>(null);
  const [agentSessionLoading, setAgentSessionLoading] = React.useState(false);
  const [agentSessionFeedback, setAgentSessionFeedback] = React.useState<string | null>(null);
  const [agentSessionCopied, setAgentSessionCopied] = React.useState(false);
  const [agentSessionRefreshTick, setAgentSessionRefreshTick] = React.useState(0);
  const [isAgentSessionPeekOpen, setIsAgentSessionPeekOpen] = React.useState(false);

  const agentRuntimePathRef = React.useRef<HTMLInputElement | null>(null);
  const agentSessionInlineViewportRef = React.useRef<HTMLElement | null>(null);
  const agentSessionPeekViewportRef = React.useRef<HTMLElement | null>(null);
  const agentSessionInlineStickToBottomRef = React.useRef(true);
  const agentSessionPeekStickToBottomRef = React.useRef(true);

  const rosterInterAgentAgents = React.useMemo(
    () => {
      const filteredAgents = interAgentAgents.filter((agent) => (
        agentRosterFilter === "all" ? true : isAgentRosterActive(agent)
      ));

      return [...filteredAgents].sort((lhs, rhs) => compareAgentRoster(lhs, rhs, agentRosterSort));
    },
    [agentRosterFilter, agentRosterSort, interAgentAgents],
  );

  const rosterAgentTitleCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of rosterInterAgentAgents) {
      counts.set(agent.title, (counts.get(agent.title) ?? 0) + 1);
    }
    return counts;
  }, [rosterInterAgentAgents]);

  const selectedInterAgent = React.useMemo(
    () => interAgentAgents.find((agent) => agent.id === selectedInterAgentId) ?? null,
    [interAgentAgents, selectedInterAgentId],
  );

  const visibleInterAgentThreads = React.useMemo(
    () => interAgentThreads.filter((thread) => thread.participants.some((participant) => participant.id === selectedInterAgentId)),
    [interAgentThreads, selectedInterAgentId],
  );

  const selectedInterAgentThread = React.useMemo(
    () => visibleInterAgentThreads.find((thread) => thread.id === selectedInterAgentThreadId) ?? null,
    [selectedInterAgentThreadId, visibleInterAgentThreads],
  );

  const selectedInterAgentDirectThread = React.useMemo(
    () => selectedInterAgent
      ? relayState?.directs.find((thread) => thread.id === selectedInterAgent.id) ?? null
      : null,
    [relayState, selectedInterAgent],
  );

  const selectedInterAgentChatActionLabel = selectedInterAgentDirectThread?.preview || selectedInterAgentDirectThread?.timestampLabel
    ? "Open Chat"
    : "Start Chat";

  const selectedAgentDirectLinePreview = selectedInterAgentDirectThread?.preview || selectedInterAgentDirectThread?.timestampLabel
    ? relaySecondaryText(selectedInterAgentDirectThread)
    : selectedInterAgent
      ? `${selectedInterAgent.title} is ready for a direct message.`
      : "Direct line available.";

  const createAgentDefaults = React.useMemo(
    () => buildDefaultCreateAgentDraft(agentableProjects, visibleAppSettings),
    [agentableProjects, visibleAppSettings],
  );

  const visibleAgentConfig = selectedInterAgentId && (agentConfigDraft ?? agentConfig)?.agentId === selectedInterAgentId
    ? (agentConfigDraft ?? agentConfig)
    : null;

  const hasEditableAgentConfig = Boolean(agentConfig?.editable && visibleAgentConfig);

  const updateAgentConfigDraft = React.useCallback((updater: (current: AgentConfigState) => AgentConfigState) => {
    setAgentConfigDraft((current) => current ? updater(current) : current);
    setAgentConfigFeedback(null);
  }, []);

  const agentConfigDirty = React.useMemo(
    () => serializeEditableAgentConfig(agentConfigDraft) !== serializeEditableAgentConfig(agentConfig),
    [agentConfigDraft, agentConfig],
  );

  const agentCapabilitiesPreview = React.useMemo(() => {
    const parsedCapabilities = parseCapabilityText(visibleAgentConfig?.capabilitiesText ?? "");
    if (parsedCapabilities.length > 0) {
      return parsedCapabilities;
    }

    return selectedInterAgent?.capabilities ?? [];
  }, [selectedInterAgent?.capabilities, visibleAgentConfig?.capabilitiesText]);

  const agentRestartActionLabel = isAgentConfigEditing && agentConfigDirty ? "Save + Restart" : "Restart Agent";

  const currentSessionTargetAgentId = React.useMemo(
    () => resolveAgentSessionTargetId({
      activeView,
      selectedMessagesThread,
      selectedRelayKind,
      selectedRelayId,
      selectedInterAgentId,
    }),
    [activeView, selectedInterAgentId, selectedMessagesThread, selectedRelayId, selectedRelayKind],
  );

  const shouldLoadAgentConfig = Boolean(
    selectedInterAgentId
      && scoutDesktop?.getAgentConfig
      && activeView === "settings"
      && isAgentConfigEditing,
  );

  const shouldLoadAgentSession = Boolean(
    currentSessionTargetAgentId
      && scoutDesktop?.getAgentSession
      && (
        isAgentSessionPeekOpen
        || agentSessionLogsExpanded
      ),
  );

  const visibleAgentSession = agentSession?.agentId === selectedMessagesDetailAgentId || agentSession?.agentId === selectedInterAgentId
    ? agentSession
    : null;

  const agentSessionPending = agentSessionLoading && !visibleAgentSession;

  React.useEffect(() => {
    if (!interAgentState) {
      return;
    }

    const allAgents = interAgentState.agents;
    const filteredAgents = allAgents
      .filter((agent) => (agentRosterFilter === "all" ? true : isAgentRosterActive(agent)))
      .sort((lhs, rhs) => compareAgentRoster(lhs, rhs, agentRosterSort));
    const selectableAgents = activeView === "agents" || activeView === "inter-agent"
      ? filteredAgents
      : allAgents;

    if (!selectableAgents.length) {
      setSelectedInterAgentId(null);
      setSelectedInterAgentThreadId(null);
      return;
    }

    const preferredAgentId = selectableAgents.find((agent) => agent.threadCount > 0)?.id
      ?? selectableAgents[0]?.id
      ?? null;
    const nextAgentId = selectableAgents.some((agent) => agent.id === selectedInterAgentId)
      ? selectedInterAgentId
      : preferredAgentId;
    if (nextAgentId !== selectedInterAgentId) {
      setSelectedInterAgentId(nextAgentId);
    }

    const availableThreads = interAgentState.threads.filter((thread) =>
      thread.participants.some((participant) => participant.id === nextAgentId),
    );
    const nextThreadId = availableThreads.some((thread) => thread.id === selectedInterAgentThreadId)
      ? selectedInterAgentThreadId
      : availableThreads[0]?.id ?? null;
    if (nextThreadId !== selectedInterAgentThreadId) {
      setSelectedInterAgentThreadId(nextThreadId);
    }
  }, [activeView, agentRosterFilter, agentRosterSort, interAgentState, selectedInterAgentId, selectedInterAgentThreadId]);

  React.useEffect(() => {
    if (!selectedInterAgentId) {
      setAgentConfig(null);
      setAgentConfigDraft(null);
      setAgentConfigFeedback(null);
      setAgentConfigLoading(false);
      setAgentThreadsExpanded(false);
      setAgentSnapshotExpanded(false);
      setAgentActivityExpanded(false);
      return;
    }

    if (!shouldLoadAgentConfig) {
      setAgentConfigLoading(false);
      return;
    }
    const desktop = scoutDesktop;
    if (!desktop?.getAgentConfig) {
      setAgentConfigLoading(false);
      return;
    }

    let cancelled = false;
    const loadAgentConfig = async () => {
      setAgentConfigLoading(true);
      try {
        const nextConfig = await desktop.getAgentConfig(selectedInterAgentId);
        if (cancelled) {
          return;
        }
        setAgentConfig(nextConfig);
        setAgentConfigDraft(nextConfig);
        setAgentConfigFeedback(null);
        if (!pendingConfigFocusAgentId || pendingConfigFocusAgentId !== selectedInterAgentId) {
          setIsAgentConfigEditing(false);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAgentConfig(null);
        setAgentConfigDraft(null);
        setAgentConfigFeedback(asErrorMessage(error));
        setIsAgentConfigEditing(false);
      } finally {
        if (!cancelled) {
          setAgentConfigLoading(false);
        }
      }
    };

    void loadAgentConfig();
    return () => {
      cancelled = true;
    };
  }, [pendingConfigFocusAgentId, scoutDesktop, selectedInterAgentId, shouldLoadAgentConfig]);

  React.useEffect(() => {
    if (!currentSessionTargetAgentId) {
      setAgentSession(null);
      setAgentSessionFeedback(null);
      setAgentSessionCopied(false);
      setAgentSessionLoading(false);
      return;
    }

    if (!shouldLoadAgentSession) {
      setAgentSessionLoading(false);
      return;
    }
    const desktop = scoutDesktop;
    if (!desktop?.getAgentSession) {
      setAgentSessionLoading(false);
      return;
    }

    let cancelled = false;
    const loadAgentSession = async () => {
      setAgentSessionLoading(true);
      try {
        const nextSession = await desktop.getAgentSession(currentSessionTargetAgentId);
        if (cancelled) {
          return;
        }
        setAgentSession(nextSession);
        setAgentSessionFeedback(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAgentSession(null);
        setAgentSessionFeedback(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setAgentSessionLoading(false);
        }
      }
    };

    void loadAgentSession();
    return () => {
      cancelled = true;
    };
  }, [agentSessionRefreshTick, currentSessionTargetAgentId, scoutDesktop, shouldLoadAgentSession]);

  React.useEffect(() => {
    setAgentSessionFeedback(null);
    setAgentSessionCopied(false);
  }, [currentSessionTargetAgentId]);

  React.useEffect(() => {
    if (activeView !== "agents" && activeView !== "messages") {
      setIsAgentSessionPeekOpen(false);
    }
  }, [activeView]);

  React.useEffect(() => {
    if (!isAgentSessionPeekOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAgentSessionPeekOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAgentSessionPeekOpen]);

  const agentSessionShouldStickToBottom = React.useCallback((element: HTMLElement | null) => {
    if (!element) {
      return true;
    }

    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    return remaining <= 48;
  }, []);

  const scrollAgentSessionToBottom = React.useCallback((element: HTMLElement | null) => {
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, []);

  React.useEffect(() => {
    agentSessionInlineStickToBottomRef.current = true;
    agentSessionPeekStickToBottomRef.current = true;
  }, [isAgentSessionPeekOpen, selectedInterAgentId]);

  React.useEffect(() => {
    if (!currentSessionTargetAgentId || !shouldLoadAgentSession) {
      return;
    }

    const interval = window.setInterval(() => {
      setAgentSessionRefreshTick((current) => current + 1);
    }, isAgentSessionPeekOpen ? 1600 : 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentSessionTargetAgentId, isAgentSessionPeekOpen, shouldLoadAgentSession]);

  React.useEffect(() => {
    if (!agentSessionCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAgentSessionCopied(false);
    }, 1500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [agentSessionCopied]);

  React.useEffect(() => {
    if (
      activeView !== "settings"
      || !pendingConfigFocusAgentId
      || selectedInterAgentId !== pendingConfigFocusAgentId
      || agentConfigLoading
    ) {
      return;
    }

    const target = agentRuntimePathRef.current;
    if (!target) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.focus();
      if ("value" in target && typeof target.value === "string") {
        const end = target.value.length;
        target.setSelectionRange?.(end, end);
      }
      setPendingConfigFocusAgentId((current) => (current === pendingConfigFocusAgentId ? null : current));
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeView, pendingConfigFocusAgentId, selectedInterAgentId, agentConfigDraft, agentConfigLoading]);

  React.useEffect(() => {
    if (activeView !== "agents" || !isAgentConfigEditing) {
      return;
    }

    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
  }, [activeView, isAgentConfigEditing]);

  React.useEffect(() => {
    if (!visibleAgentSession?.body) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      if (agentSessionInlineStickToBottomRef.current) {
        scrollAgentSessionToBottom(agentSessionInlineViewportRef.current);
      }
      if (isAgentSessionPeekOpen && agentSessionPeekStickToBottomRef.current) {
        scrollAgentSessionToBottom(agentSessionPeekViewportRef.current);
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    isAgentSessionPeekOpen,
    scrollAgentSessionToBottom,
    visibleAgentSession?.agentId,
    visibleAgentSession?.body,
    visibleAgentSession?.updatedAtLabel,
  ]);

  const handleSelectInterAgent = React.useCallback((agentId: string) => {
    setSelectedInterAgentId(agentId);
    setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agentId));
  }, [interAgentThreads]);

  const handleOpenAgentSettings = React.useCallback((agentId: string, focusConfig = false) => {
    handleSelectInterAgent(agentId);
    setSettingsSection("agents");
    setSettingsAgentId(agentId);
    setActiveView("settings");
    setIsAgentConfigEditing(focusConfig);
    setPendingConfigFocusAgentId(focusConfig ? agentId : null);
  }, [handleSelectInterAgent, setActiveView, setSettingsAgentId, setSettingsSection]);

  const deactivateAgentConfigEdit = React.useCallback(() => {
    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
  }, []);

  const resetAgentInspector = React.useCallback(() => {
    setSelectedInterAgentId(null);
    setSelectedInterAgentThreadId(null);
    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
    setAgentConfigFeedback(null);
  }, []);

  const handleOpenCreateAgentDialog = React.useCallback(() => {
    setCreateAgentDraft(buildDefaultCreateAgentDraft(agentableProjects, visibleAppSettings));
    setCreateAgentFeedback(null);
    setIsCreateAgentDialogOpen(true);
  }, [agentableProjects, visibleAppSettings]);

  const handleBrowseCreateAgentProject = React.useCallback(() => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        setCreateAgentDraft((current) => ({
          ...current,
          projectPath: selectedPath,
        }));
        setCreateAgentFeedback(null);
      } catch (error) {
        setCreateAgentFeedback(asErrorMessage(error));
      }
    })();
  }, [scoutDesktop, surfaceCaps]);

  const handleCreateAgent = React.useCallback(() => {
    void (async () => {
      if (!scoutDesktop?.createAgent) {
        setCreateAgentFeedback("Desktop bridge is unavailable.");
        return;
      }

      const projectPath = createAgentDraft.projectPath.trim();
      if (!projectPath) {
        setCreateAgentFeedback("Choose a project path first.");
        return;
      }

      setCreateAgentSubmitting(true);
      setCreateAgentFeedback(null);
      try {
        const result = await scoutDesktop.createAgent({
          projectPath,
          agentName: createAgentDraft.agentName.trim() || null,
          harness: createAgentDraft.harness,
        });

        setShellState(result.shellState);
        setShellError(null);
        setRelayFeedback(`Created ${result.agentId}.`);
        setSelectedInterAgentId(result.agentId);
        setSelectedInterAgentThreadId(null);
        setActiveView("agents");
        setIsCreateAgentDialogOpen(false);

        if (scoutDesktop.refreshSettingsInventory) {
          try {
            const nextSettings = await scoutDesktop.refreshSettingsInventory();
            setAppSettings(nextSettings);
            if (!isAppSettingsEditing || !appSettingsDirty) {
              setAppSettingsDraft(nextSettings);
            }
          } catch {
            // Keep the created agent flow successful even if inventory refresh fails.
          }
        }
      } catch (error) {
        setCreateAgentFeedback(asErrorMessage(error));
      } finally {
        setCreateAgentSubmitting(false);
      }
    })();
  }, [
    appSettingsDirty,
    createAgentDraft,
    isAppSettingsEditing,
    scoutDesktop,
    setActiveView,
    setAppSettings,
    setAppSettingsDraft,
    setRelayFeedback,
    setShellError,
    setShellState,
  ]);

  const handleStartAgentConfigEdit = React.useCallback(() => {
    setActiveView("settings");
    setSettingsSection("agents");
    if (selectedInterAgentId) {
      setSettingsAgentId(selectedInterAgentId);
    }
    setIsAgentConfigEditing(true);
    if (selectedInterAgentId) {
      setPendingConfigFocusAgentId(selectedInterAgentId);
    }
  }, [selectedInterAgentId, setActiveView, setSettingsAgentId, setSettingsSection]);

  const handleCancelAgentConfigEdit = React.useCallback(() => {
    setAgentConfigDraft(agentConfig);
    setAgentConfigFeedback(null);
    setIsAgentConfigEditing(false);
  }, [agentConfig]);

  const handleSaveAgentConfig = React.useCallback(async () => {
    if (!selectedInterAgentId || !visibleAgentConfig || !scoutDesktop?.updateAgentConfig) {
      return;
    }

    setAgentConfigSaving(true);
    try {
      const nextConfig = await scoutDesktop.updateAgentConfig({
        agentId: selectedInterAgentId,
        ...buildAgentConfigUpdate(visibleAgentConfig),
      });
      setAgentConfig(nextConfig);
      setAgentConfigDraft(nextConfig);
      setAgentConfigFeedback("Agent settings saved.");
      setIsAgentConfigEditing(false);
    } catch (error) {
      setAgentConfigFeedback(asErrorMessage(error));
    } finally {
      setAgentConfigSaving(false);
    }
  }, [scoutDesktop, selectedInterAgentId, visibleAgentConfig]);

  const handleRestartAgent = React.useCallback(async () => {
    if (!selectedInterAgentId || !visibleAgentConfig || !scoutDesktop?.restartAgent) {
      return;
    }

    setAgentConfigRestarting(true);
    try {
      let nextConfig = visibleAgentConfig;
      if (agentConfigDirty && scoutDesktop.updateAgentConfig) {
        setAgentConfigSaving(true);
        nextConfig = await scoutDesktop.updateAgentConfig({
          agentId: selectedInterAgentId,
          ...buildAgentConfigUpdate(visibleAgentConfig),
        });
        setAgentConfig(nextConfig);
        setAgentConfigDraft(nextConfig);
        setAgentConfigSaving(false);
      }

      const nextShellState = await scoutDesktop.restartAgent({
        agentId: selectedInterAgentId,
        previousSessionId: selectedInterAgent?.sessionId ?? agentConfig?.runtime.sessionId ?? null,
      });
      setShellState(nextShellState);
      setShellError(null);
      setAgentConfigFeedback(`${selectedInterAgent?.title ?? "Agent"} restarted.`);
      setIsAgentConfigEditing(false);
    } catch (error) {
      setAgentConfigFeedback(asErrorMessage(error));
    } finally {
      setAgentConfigSaving(false);
      setAgentConfigRestarting(false);
    }
  }, [agentConfig, agentConfigDirty, scoutDesktop, selectedInterAgent, selectedInterAgentId, setShellError, setShellState, visibleAgentConfig]);

  const handleOpenAgentSession = React.useCallback(async () => {
    if (!surfaceCaps?.canOpenNativeSession || !currentSessionTargetAgentId || !scoutDesktop?.openAgentSession) {
      return;
    }

    try {
      await scoutDesktop.openAgentSession(currentSessionTargetAgentId);
      setAgentSessionFeedback(agentSession?.mode === "tmux" ? "Opening tmux session in Terminal." : "Opening session logs.");
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [agentSession?.mode, currentSessionTargetAgentId, scoutDesktop, surfaceCaps]);

  const handleCopyAgentSessionCommand = React.useCallback(async () => {
    if (!agentSession?.commandLabel) {
      return;
    }

    try {
      await copyTextToClipboard(agentSession.commandLabel);
      setAgentSessionCopied(true);
      setAgentSessionFeedback("Attach command copied.");
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [agentSession]);

  const refreshAgentSession = React.useCallback(() => {
    setAgentSessionRefreshTick((current) => current + 1);
  }, []);

  const handlePeekAgentSession = React.useCallback(() => {
    setAgentSessionFeedback(null);
    setIsAgentSessionPeekOpen(true);
    refreshAgentSession();
  }, [refreshAgentSession]);

  const closeAgentSessionPeek = React.useCallback(() => {
    setIsAgentSessionPeekOpen(false);
  }, []);

  const handleInlineAgentSessionScroll = React.useCallback((event: React.UIEvent<HTMLElement>) => {
    agentSessionInlineStickToBottomRef.current = agentSessionShouldStickToBottom(event.currentTarget);
  }, [agentSessionShouldStickToBottom]);

  const handlePeekAgentSessionScroll = React.useCallback((event: React.UIEvent<HTMLElement>) => {
    agentSessionPeekStickToBottomRef.current = agentSessionShouldStickToBottom(event.currentTarget);
  }, [agentSessionShouldStickToBottom]);

  return {
    selectedInterAgentId,
    selectedInterAgentThreadId,
    setSelectedInterAgentThreadId,
    agentRosterFilter,
    setAgentRosterFilter,
    agentRosterSort,
    setAgentRosterSort,
    agentThreadsExpanded,
    setAgentThreadsExpanded,
    agentSnapshotExpanded,
    setAgentSnapshotExpanded,
    agentActivityExpanded,
    setAgentActivityExpanded,
    agentSessionLogsExpanded,
    setAgentSessionLogsExpanded,
    agentRosterMenu,
    setAgentRosterMenu,
    selectedInterAgent,
    rosterInterAgentAgents,
    rosterAgentTitleCounts,
    visibleInterAgentThreads,
    selectedInterAgentDirectThread,
    selectedInterAgentThread,
    selectedInterAgentChatActionLabel,
    selectedAgentDirectLinePreview,
    isAgentConfigEditing,
    visibleAgentConfig,
    hasEditableAgentConfig,
    agentConfigLoading,
    agentConfigSaving,
    agentConfigRestarting,
    agentConfigFeedback,
    agentCapabilitiesPreview,
    agentRuntimePathRef,
    updateAgentConfigDraft,
    agentConfigDirty,
    agentRestartActionLabel,
    handleSelectInterAgent,
    handleOpenAgentSettings,
    deactivateAgentConfigEdit,
    resetAgentInspector,
    handleStartAgentConfigEdit,
    handleCancelAgentConfigEdit,
    handleSaveAgentConfig,
    handleRestartAgent,
    isCreateAgentDialogOpen,
    setIsCreateAgentDialogOpen,
    createAgentDraft,
    setCreateAgentDraft,
    createAgentDefaults,
    createAgentSubmitting,
    createAgentFeedback,
    setCreateAgentFeedback,
    handleOpenCreateAgentDialog,
    handleBrowseCreateAgentProject,
    handleCreateAgent,
    visibleAgentSession,
    agentSessionPending,
    agentSessionLoading,
    agentSessionFeedback,
    agentSessionCopied,
    isAgentSessionPeekOpen,
    closeAgentSessionPeek,
    agentSessionInlineViewportRef,
    handleInlineAgentSessionScroll,
    agentSessionPeekViewportRef,
    handlePeekAgentSessionScroll,
    handleOpenAgentSession,
    handleCopyAgentSessionCommand,
    handlePeekAgentSession,
    refreshAgentSession,
  };
}
