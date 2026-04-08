import React from "react";

import { asErrorMessage } from "@/components/relay/relay-utils";
import type { AppView } from "@/app-types";
import type { ScoutDesktopBridge } from "@/lib/electron";
import type { SettingsSectionId } from "@/settings/settings-paths";
import type {
  AppSettingsState,
  BrokerControlAction,
  DesktopBrokerInspector,
  DesktopFeedbackBundle,
  DesktopFeedbackSubmission,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopShellState,
  DesktopSurfaceCapabilities,
  PairingState,
  SubmitFeedbackReportInput,
} from "@/lib/scout-desktop";

type UseDiagnosticsControllerInput = {
  activeView: AppView;
  settingsSection: SettingsSectionId;
  scoutDesktop: ScoutDesktopBridge | null;
  surfaceCaps: DesktopSurfaceCapabilities | undefined;
  pendingBrokerInspectorFocus: boolean;
  setPendingBrokerInspectorFocus: React.Dispatch<React.SetStateAction<boolean>>;
  relayServiceInspectorRef: React.RefObject<HTMLElement | null>;
  loadShellState: (withSpinner?: boolean) => Promise<DesktopShellState | null>;
  setShellState: React.Dispatch<React.SetStateAction<DesktopShellState | null>>;
  setShellError: React.Dispatch<React.SetStateAction<string | null>>;
  applyRestartedOnboardingSettings: (nextSettings: AppSettingsState) => void;
  commitPairingState: (nextState: PairingState) => void;
  pairingState: PairingState | null;
  setAppSettingsFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  setRelayFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  setPairingError: React.Dispatch<React.SetStateAction<string | null>>;
  setPairingConfigFeedback: React.Dispatch<React.SetStateAction<string | null>>;
};

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) {
      return;
    }
  }

  throw new Error("Clipboard unavailable.");
}

export function useDiagnosticsController({
  activeView,
  settingsSection,
  scoutDesktop,
  surfaceCaps,
  pendingBrokerInspectorFocus,
  setPendingBrokerInspectorFocus,
  relayServiceInspectorRef,
  loadShellState,
  setShellState,
  setShellError,
  applyRestartedOnboardingSettings,
  commitPairingState,
  pairingState,
  setAppSettingsFeedback,
  setRelayFeedback,
  setPairingError,
  setPairingConfigFeedback,
}: UseDiagnosticsControllerInput) {
  const [logCatalog, setLogCatalog] = React.useState<DesktopLogCatalog | null>(null);
  const [selectedLogSourceId, setSelectedLogSourceId] = React.useState<string | null>(null);
  const [logContent, setLogContent] = React.useState<DesktopLogContent | null>(null);
  const [brokerInspector, setBrokerInspector] = React.useState<DesktopBrokerInspector | null>(null);
  const [brokerControlPending, setBrokerControlPending] = React.useState(false);
  const [brokerControlFeedback, setBrokerControlFeedback] = React.useState<string | null>(null);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = React.useState(false);
  const [feedbackBundle, setFeedbackBundle] = React.useState<DesktopFeedbackBundle | null>(null);
  const [feedbackBundleLoading, setFeedbackBundleLoading] = React.useState(false);
  const [feedbackBundleError, setFeedbackBundleError] = React.useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = React.useState("");
  const [feedbackSubmission, setFeedbackSubmission] = React.useState<DesktopFeedbackSubmission | null>(null);
  const [feedbackActionPending, setFeedbackActionPending] = React.useState<"copy" | "refresh" | "repair" | "submit" | null>(null);
  const [feedbackActionMessage, setFeedbackActionMessage] = React.useState<string | null>(null);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [logsFeedback, setLogsFeedback] = React.useState<string | null>(null);
  const [logSearchQuery, setLogSearchQuery] = React.useState("");
  const [logSourceQuery, setLogSourceQuery] = React.useState("");
  const [logsRefreshTick, setLogsRefreshTick] = React.useState(0);

  const logSources = logCatalog?.sources ?? [];
  const filteredLogSources = React.useMemo(() => {
    const query = logSourceQuery.trim().toLowerCase();
    if (!query) {
      return logSources;
    }
    return logSources.filter((source) => (
      source.title.toLowerCase().includes(query)
      || source.subtitle.toLowerCase().includes(query)
    ));
  }, [logSourceQuery, logSources]);
  const selectedLogSource = logSources.find((source) => source.id === selectedLogSourceId) ?? null;

  const refreshLogs = React.useCallback(() => {
    setLogsRefreshTick((current) => current + 1);
  }, []);

  const openFeedbackDialog = React.useCallback(() => {
    setIsFeedbackDialogOpen(true);
    setFeedbackActionMessage(null);
  }, []);

  const handleFeedbackDialogOpenChange = React.useCallback((open: boolean) => {
    setIsFeedbackDialogOpen(open);
    if (!open) {
      setFeedbackActionMessage(null);
    }
  }, []);

  const refreshBrokerInspector = React.useCallback(async () => {
    if (!scoutDesktop?.getBrokerInspector) {
      setBrokerInspector(null);
      return null;
    }

    try {
      const nextInspector = await scoutDesktop.getBrokerInspector();
      setBrokerInspector(nextInspector);
      return nextInspector;
    } catch {
      setBrokerInspector(null);
      return null;
    }
  }, [scoutDesktop]);

  const loadFeedbackBundle = React.useCallback(async (options?: { showSpinner?: boolean }) => {
    if (!scoutDesktop?.getFeedbackBundle) {
      setFeedbackBundleError("Feedback diagnostics are unavailable in this build.");
      return null;
    }

    if (options?.showSpinner) {
      setFeedbackBundleLoading(true);
    }

    try {
      const nextBundle = await scoutDesktop.getFeedbackBundle();
      setFeedbackBundle(nextBundle);
      setFeedbackBundleError(null);
      return nextBundle;
    } catch (error) {
      setFeedbackBundleError(asErrorMessage(error));
      return null;
    } finally {
      if (options?.showSpinner) {
        setFeedbackBundleLoading(false);
      }
    }
  }, [scoutDesktop]);

  React.useEffect(() => {
    if (activeView !== "logs") {
      return;
    }
    if (!scoutDesktop?.getLogCatalog) {
      setLogCatalog(null);
      setLogsFeedback("Logs are unavailable in the current desktop bridge. Restart the app so the latest Electron preload is loaded.");
      return;
    }

    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const nextCatalog = await scoutDesktop.getLogCatalog();
        if (cancelled) {
          return;
        }
        setLogCatalog(nextCatalog);
        setSelectedLogSourceId((current) => {
          if (current && nextCatalog.sources.some((source) => source.id === current)) {
            return current;
          }
          return nextCatalog.defaultSourceId ?? nextCatalog.sources[0]?.id ?? null;
        });
        if (nextCatalog.sources.length === 0) {
          setLogsFeedback("No log sources available.");
        }
      } catch (error) {
        if (!cancelled) {
          setLogsFeedback(asErrorMessage(error));
        }
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [activeView, scoutDesktop]);

  React.useEffect(() => {
    if (activeView !== "logs" || !selectedLogSourceId) {
      return;
    }
    if (!scoutDesktop?.readLogSource) {
      setLogContent(null);
      return;
    }

    let cancelled = false;
    if (!logContent || logContent.sourceId !== selectedLogSourceId) {
      setLogsLoading(true);
    }
    setLogsFeedback(null);

    const loadContent = async () => {
      try {
        const nextContent = await scoutDesktop.readLogSource({ sourceId: selectedLogSourceId, tailLines: 500 });
        if (cancelled) {
          return;
        }
        setLogContent(nextContent);
        setLogsFeedback(null);
      } catch (error) {
        if (!cancelled) {
          setLogContent(null);
          setLogsFeedback(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
    };

    void loadContent();
    return () => {
      cancelled = true;
    };
  }, [activeView, logsRefreshTick, scoutDesktop, selectedLogSourceId]);

  React.useEffect(() => {
    if (activeView !== "settings" || settingsSection !== "communication") {
      return;
    }

    void refreshBrokerInspector();
  }, [activeView, logsRefreshTick, refreshBrokerInspector, settingsSection]);

  React.useEffect(() => {
    if (!pendingBrokerInspectorFocus || activeView !== "settings" || settingsSection !== "communication") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      relayServiceInspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingBrokerInspectorFocus(false);
    }, 40);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeView, pendingBrokerInspectorFocus, relayServiceInspectorRef, settingsSection, brokerInspector]);

  React.useEffect(() => {
    if (activeView !== "logs") {
      return;
    }

    const interval = window.setInterval(() => {
      setLogsRefreshTick((current) => current + 1);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeView]);

  React.useEffect(() => {
    if (!isFeedbackDialogOpen) {
      return;
    }

    void loadFeedbackBundle({ showSpinner: true });
  }, [isFeedbackDialogOpen, loadFeedbackBundle]);

  const handleBrokerControl = React.useCallback(async (action: BrokerControlAction) => {
    if (!surfaceCaps?.canManageBroker || !scoutDesktop?.controlBroker) {
      return;
    }

    setBrokerControlPending(true);
    setBrokerControlFeedback(null);
    try {
      const nextState = await scoutDesktop.controlBroker(action);
      setShellState(nextState);
      setShellError(null);
      await refreshBrokerInspector();
      setBrokerControlFeedback(
        action === "start" ? "Relay started." : action === "stop" ? "Relay stopped." : "Relay restarted.",
      );
    } catch (error) {
      setBrokerControlFeedback(asErrorMessage(error));
    } finally {
      setBrokerControlPending(false);
    }
  }, [refreshBrokerInspector, scoutDesktop, setShellError, setShellState, surfaceCaps]);

  const handleRefreshFeedbackBundle = React.useCallback(() => {
    void (async () => {
      setFeedbackActionPending("refresh");
      setFeedbackActionMessage(null);
      try {
        await loadFeedbackBundle({ showSpinner: true });
        setFeedbackActionMessage("Support details refreshed.");
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [loadFeedbackBundle]);

  const handleCopyFeedbackBundle = React.useCallback(() => {
    void (async () => {
      if (!feedbackBundle?.text) {
        setFeedbackActionMessage("Support bundle is still loading.");
        return;
      }

      setFeedbackActionPending("copy");
      setFeedbackActionMessage(null);
      try {
        await copyText(feedbackBundle.text);
        setFeedbackActionMessage("Support bundle copied.");
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [feedbackBundle?.text]);

  const handleSubmitFeedbackReport = React.useCallback(() => {
    void (async () => {
      if (!scoutDesktop?.submitFeedbackReport) {
        setFeedbackActionMessage("Feedback submission is unavailable in this build.");
        return;
      }

      const message = feedbackDraft.trim();
      if (!message) {
        setFeedbackActionMessage("Add a short description before submitting.");
        return;
      }

      setFeedbackActionPending("submit");
      setFeedbackActionMessage(null);
      try {
        const result = await scoutDesktop.submitFeedbackReport({
          message,
        } satisfies SubmitFeedbackReportInput);
        setFeedbackSubmission(result);
        setFeedbackDraft("");
        setFeedbackActionMessage(`Feedback submitted as ${result.key}.`);
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [feedbackDraft, scoutDesktop]);

  const handleRepairSetup = React.useCallback(() => {
    void (async () => {
      const notes: string[] = [];
      setFeedbackActionPending("repair");
      setFeedbackActionMessage(null);

      try {
        if (scoutDesktop?.restartOnboarding) {
          const nextSettings = await scoutDesktop.restartOnboarding();
          applyRestartedOnboardingSettings(nextSettings);
        } else {
          notes.push("Onboarding reset unavailable.");
        }

        setAppSettingsFeedback(null);
        setRelayFeedback(null);
        setPairingError(null);
        setPairingConfigFeedback(null);
        setBrokerControlFeedback(null);
        setLogsFeedback(null);

        if (surfaceCaps?.canManageBroker && scoutDesktop?.controlBroker) {
          try {
            const nextShellState = await scoutDesktop.controlBroker(
              brokerInspector?.installed ? "restart" : "start",
            );
            setShellState(nextShellState);
            setShellError(null);
          } catch (error) {
            notes.push(`Relay: ${asErrorMessage(error)}`);
          }
        }

        if (scoutDesktop?.controlPairingService) {
          try {
            const nextPairingState = await scoutDesktop.controlPairingService(
              pairingState?.isRunning ? "restart" : "start",
            );
            commitPairingState(nextPairingState);
          } catch (error) {
            notes.push(`Pairing: ${asErrorMessage(error)}`);
          }
        }

        try {
          await refreshBrokerInspector();
        } catch (error) {
          notes.push(`Broker diagnostics: ${asErrorMessage(error)}`);
        }

        if (scoutDesktop?.refreshPairingState) {
          try {
            const nextPairingState = await scoutDesktop.refreshPairingState();
            commitPairingState(nextPairingState);
          } catch (error) {
            notes.push(`Pairing refresh: ${asErrorMessage(error)}`);
          }
        }

        await loadShellState(false);
        await loadFeedbackBundle();
        setFeedbackActionMessage(
          notes.length > 0
            ? `Repair finished with notes: ${notes.join(" · ")}`
            : "Setup repaired. Onboarding was reset and local services were refreshed.",
        );
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [
    applyRestartedOnboardingSettings,
    brokerInspector?.installed,
    commitPairingState,
    loadFeedbackBundle,
    loadShellState,
    pairingState?.isRunning,
    refreshBrokerInspector,
    scoutDesktop,
    setAppSettingsFeedback,
    setPairingConfigFeedback,
    setPairingError,
    setRelayFeedback,
    setShellError,
    setShellState,
    surfaceCaps,
  ]);

  return {
    logCatalog,
    logSources,
    filteredLogSources,
    selectedLogSourceId,
    setSelectedLogSourceId,
    selectedLogSource,
    logContent,
    brokerInspector,
    brokerControlPending,
    brokerControlFeedback,
    isFeedbackDialogOpen,
    feedbackBundle,
    feedbackBundleLoading,
    feedbackBundleError,
    feedbackDraft,
    setFeedbackDraft,
    feedbackSubmission,
    feedbackActionPending,
    feedbackActionMessage,
    logsLoading,
    logsFeedback,
    logSearchQuery,
    setLogSearchQuery,
    logSourceQuery,
    setLogSourceQuery,
    refreshLogs,
    refreshBrokerInspector,
    openFeedbackDialog,
    handleFeedbackDialogOpenChange,
    handleBrokerControl,
    handleRefreshFeedbackBundle,
    handleCopyFeedbackBundle,
    handleSubmitFeedbackReport,
    handleRepairSetup,
  };
}
