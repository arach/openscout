import React from "react";

import { asErrorMessage, serializeAppSettings } from "@web/features/messages/lib/relay-utils";
import type { AppView, OnboardingWizardStepId } from "@/app-types";
import type { SettingsSectionId } from "@/settings/settings-paths";
import type { ScoutDesktopBridge } from "@/lib/desktop-bridge";
import type {
  AppSettingsState,
  DesktopShellState,
  DesktopSurfaceCapabilities,
  HiddenProjectSummary,
  OnboardingCommandName,
  OnboardingCommandResult,
} from "@/lib/scout-desktop";

export const SOURCE_ROOT_PATH_SUGGESTIONS = ["~/dev", "~/src", "~/code"] as const;

export const ONBOARDING_WIZARD_STEP_ORDER: OnboardingWizardStepId[] = [
  "welcome",
  "source-roots",
  "harness",
  "confirm",
  "setup",
  "doctor",
  "runtimes",
];

type StartupOnboardingState = "checking" | "active" | "done";

type OnboardingWizardStepViewModel = {
  id: OnboardingWizardStepId;
  number: string;
  title: string;
  detail: string;
  complete: boolean;
};

type RefreshVisibleAppSettingsOptions = {
  preferInventory?: boolean;
};

type UseSettingsControllerInput = {
  activeView: AppView;
  settingsSection: SettingsSectionId;
  scoutDesktop: ScoutDesktopBridge | null;
  shellState: DesktopShellState | null;
  surfaceCaps: DesktopSurfaceCapabilities | undefined;
  completeOnboardingIntoRelay: (nextShellState: DesktopShellState | null) => void;
  loadShellState: (withSpinner?: boolean) => Promise<DesktopShellState | null>;
};

export function useSettingsController({
  activeView,
  settingsSection,
  scoutDesktop,
  shellState,
  surfaceCaps,
  completeOnboardingIntoRelay,
  loadShellState,
}: UseSettingsControllerInput) {
  const [appSettings, setAppSettings] = React.useState<AppSettingsState | null>(null);
  const [appSettingsDraft, setAppSettingsDraft] = React.useState<AppSettingsState | null>(null);
  const [appSettingsLoading, setAppSettingsLoading] = React.useState(false);
  const [workspaceInventoryLoading, setWorkspaceInventoryLoading] = React.useState(false);
  const [appSettingsSaving, setAppSettingsSaving] = React.useState(false);
  const [appSettingsFeedback, setAppSettingsFeedback] = React.useState<string | null>(null);
  const [isAppSettingsEditing, setIsAppSettingsEditing] = React.useState(false);
  const [projectRetirementPendingRoot, setProjectRetirementPendingRoot] = React.useState<string | null>(null);
  const [onboardingWizardStep, setOnboardingWizardStep] = React.useState<OnboardingWizardStepId>("welcome");
  const [onboardingCommandPending, setOnboardingCommandPending] = React.useState<OnboardingCommandName | null>(null);
  const [onboardingCommandResult, setOnboardingCommandResult] = React.useState<OnboardingCommandResult | null>(null);
  const [onboardingCommandHistory, setOnboardingCommandHistory] = React.useState<Partial<Record<OnboardingCommandName, OnboardingCommandResult>>>({});
  const [onboardingCopiedCommand, setOnboardingCopiedCommand] = React.useState<OnboardingCommandName | null>(null);
  const [startupOnboardingState, setStartupOnboardingState] = React.useState<StartupOnboardingState>("checking");

  const visibleAppSettings = isAppSettingsEditing ? (appSettingsDraft ?? appSettings) : appSettings;
  const agentableProjects = visibleAppSettings?.projectInventory ?? [];
  const hiddenProjects = visibleAppSettings?.hiddenProjects ?? [];
  const appSettingsDirty = React.useMemo(
    () => serializeAppSettings(appSettingsDraft) !== serializeAppSettings(appSettings),
    [appSettingsDraft, appSettings],
  );
  const workspaceInventoryLoaded = Boolean(visibleAppSettings?.workspaceInventoryLoaded);
  const canRefreshWorkspaceInventory = Boolean(appSettings && scoutDesktop?.refreshSettingsInventory);
  const showDoctorOutput = Boolean(
    onboardingCommandPending === "doctor"
      || onboardingCommandHistory.doctor
      || onboardingCommandResult?.command === "doctor",
  );
  const onboardingContextRoot = visibleAppSettings?.onboardingContextRoot
    ?? visibleAppSettings?.workspaceRoots?.[0]
    ?? null;
  const onboardingHasProjectConfig = Boolean(visibleAppSettings?.currentProjectConfigPath);
  const onboardingRuntimeMatch = (visibleAppSettings?.runtimeCatalog ?? []).find(
    (entry) => entry.name === visibleAppSettings?.defaultHarness,
  ) ?? null;
  const onboardingStepCompletion = React.useMemo(
    () => new Map((visibleAppSettings?.onboarding.steps ?? []).map((step) => [step.id, step.complete])),
    [visibleAppSettings?.onboarding.steps],
  );
  const onboardingWizardSteps = React.useMemo<OnboardingWizardStepViewModel[]>(() => ([
    {
      id: "welcome",
      number: "01",
      title: "Say hi",
      detail: "Tell Scout what to call you before the rest of setup begins.",
      complete: onboardingStepCompletion.get("welcome") ?? false,
    },
    {
      id: "source-roots",
      number: "02",
      title: "Choose folders to scan",
      detail: "Pick the parent folders Scout should scan for repos, then choose where this Scout context should live.",
      complete: onboardingStepCompletion.get("source-roots") ?? false,
    },
    {
      id: "harness",
      number: "03",
      title: "Choose a default harness",
      detail: "This is the assistant family Scout should prefer when a project does not pin one of its own.",
      complete: onboardingStepCompletion.get("harness") ?? false,
    },
    {
      id: "confirm",
      number: "04",
      title: "Confirm this context",
      detail: "Review which folders Scout will scan and where it will save this context before moving into the command steps.",
      complete: onboardingStepCompletion.get("confirm") ?? false,
    },
    {
      id: "setup",
      number: "05",
      title: "Run setup",
      detail: "See how Scout writes `.openscout/project.json` at your chosen context root and uses it as this context anchor.",
      complete: onboardingStepCompletion.get("setup") ?? false,
    },
    {
      id: "doctor",
      number: "06",
      title: "Run doctor",
      detail: "See how Scout combines broker health, scanned folders, and context manifests into one inventory view.",
      complete: onboardingStepCompletion.get("doctor") ?? false,
    },
    {
      id: "runtimes",
      number: "07",
      title: "Run runtimes",
      detail: "Check whether Claude or Codex is installed, signed in, and ready for broker-owned sessions.",
      complete: onboardingStepCompletion.get("runtimes") ?? false,
    },
  ]), [onboardingStepCompletion]);
  const onboardingWizardIndex = Math.max(
    0,
    ONBOARDING_WIZARD_STEP_ORDER.indexOf(onboardingWizardStep),
  );
  const activeOnboardingStep = onboardingWizardSteps[onboardingWizardIndex] ?? onboardingWizardSteps[0];
  const canGoToPreviousOnboardingStep = onboardingWizardIndex > 0;
  const canGoToNextOnboardingStep = onboardingWizardIndex < onboardingWizardSteps.length - 1;
  const startupOnboardingVisible = startupOnboardingState === "active" && Boolean(visibleAppSettings?.onboarding);
  const startupOnboardingBlocking = startupOnboardingState !== "done";

  const mergeEditableAppSettingsDraft = React.useCallback((
    currentDraft: AppSettingsState | null,
    nextSettings: AppSettingsState,
  ): AppSettingsState => {
    if (!currentDraft) {
      return nextSettings;
    }

    return {
      ...nextSettings,
      operatorName: currentDraft.operatorName,
      onboardingContextRoot: currentDraft.onboardingContextRoot,
      workspaceRoots: currentDraft.workspaceRoots,
      includeCurrentRepo: currentDraft.includeCurrentRepo,
      defaultHarness: currentDraft.defaultHarness,
      defaultTransport: currentDraft.defaultTransport,
      defaultCapabilities: currentDraft.defaultCapabilities,
      sessionPrefix: currentDraft.sessionPrefix,
      telegram: currentDraft.telegram,
    };
  }, []);

  const replaceAppSettings = React.useCallback((nextSettings: AppSettingsState) => {
    setAppSettings(nextSettings);
    setAppSettingsDraft(nextSettings);
    if (nextSettings.workspaceInventoryLoaded) {
      setWorkspaceInventoryLoading(false);
    }
  }, []);

  const syncRefreshedAppSettings = React.useCallback((nextSettings: AppSettingsState) => {
    setAppSettings(nextSettings);
    setAppSettingsDraft((current) => isAppSettingsEditing ? current : nextSettings);
    if (nextSettings.workspaceInventoryLoaded) {
      setWorkspaceInventoryLoading(false);
    }
  }, [isAppSettingsEditing]);

  const applyNextAppSettings = React.useCallback((nextSettings: AppSettingsState) => {
    setAppSettings(nextSettings);
    setAppSettingsDraft((current) => (
      isAppSettingsEditing
        ? mergeEditableAppSettingsDraft(current, nextSettings)
        : nextSettings
    ));
    if (nextSettings.workspaceInventoryLoaded) {
      setWorkspaceInventoryLoading(false);
    }
  }, [isAppSettingsEditing, mergeEditableAppSettingsDraft]);

  const applyRestartedOnboardingSettings = React.useCallback((nextSettings: AppSettingsState) => {
    replaceAppSettings(nextSettings);
    setOnboardingWizardStep("welcome");
    setOnboardingCommandResult(null);
    setOnboardingCopiedCommand(null);
    setIsAppSettingsEditing(true);
    setStartupOnboardingState("active");
  }, [replaceAppSettings]);

  const buildOnboardingCommandLine = React.useCallback((command: OnboardingCommandName) => {
    const contextRootArg = onboardingContextRoot ? ` --context-root ${onboardingContextRoot}` : "";
    const sourceRootArgs = command === "setup"
      ? (visibleAppSettings?.workspaceRoots ?? []).map((root) => ` --source-root ${root}`).join("")
      : "";
    return `scout ${command}${contextRootArg}${sourceRootArgs}`;
  }, [onboardingContextRoot, visibleAppSettings?.workspaceRoots]);

  const refreshVisibleAppSettings = React.useCallback(async (
    options?: RefreshVisibleAppSettingsOptions,
  ): Promise<AppSettingsState | null> => {
    if (!scoutDesktop?.getAppSettings) {
      return null;
    }

    const nextSettings = options?.preferInventory && scoutDesktop.refreshSettingsInventory
      ? await scoutDesktop.refreshSettingsInventory()
      : await scoutDesktop.getAppSettings();
    syncRefreshedAppSettings(nextSettings);
    return nextSettings;
  }, [scoutDesktop, syncRefreshedAppSettings]);

  React.useEffect(() => {
    const shouldLoadAppSettings = activeView === "settings" || activeView === "help" || startupOnboardingState === "active";
    if (!shouldLoadAppSettings || !scoutDesktop?.getAppSettings) {
      return;
    }

    let cancelled = false;
    const loadAppSettings = async () => {
      setAppSettingsLoading(true);
      try {
        const nextSettings = await scoutDesktop.getAppSettings();
        if (cancelled) {
          return;
        }
        replaceAppSettings(nextSettings);
        if (startupOnboardingState === "active" && nextSettings.onboarding.needed) {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(true);
          setOnboardingWizardStep((current) => current || "welcome");
        } else {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(false);
        }
        if (startupOnboardingState === "active" && !nextSettings.onboarding.needed) {
          completeOnboardingIntoRelay(shellState);
          setStartupOnboardingState("done");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAppSettings(null);
        setAppSettingsDraft(null);
        setAppSettingsFeedback(asErrorMessage(error));
        setIsAppSettingsEditing(false);
        if (startupOnboardingState !== "done") {
          setStartupOnboardingState("done");
        }
      } finally {
        if (!cancelled) {
          setAppSettingsLoading(false);
        }
      }
    };

    void loadAppSettings();
    return () => {
      cancelled = true;
    };
  }, [activeView, completeOnboardingIntoRelay, replaceAppSettings, scoutDesktop, shellState, startupOnboardingState]);

  React.useEffect(() => {
    let cancelled = false;

    if (!scoutDesktop?.getAppSettings) {
      setStartupOnboardingState("done");
      return () => {
        cancelled = true;
      };
    }

    const checkOnboarding = async () => {
      try {
        const nextSettings = await scoutDesktop.getAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings((current) => current ?? nextSettings);
        setAppSettingsDraft((current) => current ?? nextSettings);
        if (nextSettings.onboarding.needed) {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(true);
          setOnboardingWizardStep("welcome");
          setStartupOnboardingState("active");
        } else {
          setStartupOnboardingState("done");
        }
      } catch {
        if (!cancelled) {
          setStartupOnboardingState("done");
        }
      }
    };

    void checkOnboarding();
    return () => {
      cancelled = true;
    };
  }, [scoutDesktop]);

  React.useEffect(() => {
    if (
      activeView !== "settings"
      || settingsSection !== "workspaces"
      || !scoutDesktop?.refreshSettingsInventory
      || !appSettings
      || appSettings.workspaceInventoryLoaded
      || workspaceInventoryLoading
    ) {
      return;
    }

    let cancelled = false;
    const loadWorkspaceInventory = async () => {
      setWorkspaceInventoryLoading(true);
      try {
        const nextSettings = await scoutDesktop.refreshSettingsInventory();
        if (!cancelled) {
          applyNextAppSettings(nextSettings);
        }
      } catch (error) {
        if (!cancelled) {
          setAppSettingsFeedback(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceInventoryLoading(false);
        }
      }
    };

    void loadWorkspaceInventory();
    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    appSettings,
    applyNextAppSettings,
    scoutDesktop,
    settingsSection,
    workspaceInventoryLoading,
  ]);

  const handleStartAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
    if (appSettings?.onboarding.needed) {
      setOnboardingWizardStep("welcome");
    }
  }, [appSettings]);

  const handleCancelAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(false);
  }, [appSettings]);

  const updateAppSettingsDraft = React.useCallback((updater: (current: AppSettingsState) => AppSettingsState) => {
    setAppSettingsDraft((current) => current ? updater(current) : current);
    setAppSettingsFeedback(null);
  }, []);

  const handleSaveAppSettings = React.useCallback(async (): Promise<boolean> => {
    if (!appSettingsDraft || !scoutDesktop?.updateAppSettings) {
      return false;
    }

    setAppSettingsSaving(true);
    try {
      const nextSettings = await scoutDesktop.updateAppSettings({
        operatorName: appSettingsDraft.operatorName,
        onboardingContextRoot: appSettingsDraft.onboardingContextRoot,
        workspaceRootsText: appSettingsDraft.workspaceRoots.join("\n"),
        includeCurrentRepo: appSettingsDraft.includeCurrentRepo,
        defaultHarness: appSettingsDraft.defaultHarness,
        defaultCapabilitiesText: appSettingsDraft.defaultCapabilities.join("\n"),
        sessionPrefix: appSettingsDraft.sessionPrefix,
        telegram: {
          enabled: appSettingsDraft.telegram.enabled,
          mode: appSettingsDraft.telegram.mode,
          botToken: appSettingsDraft.telegram.botToken,
          secretToken: appSettingsDraft.telegram.secretToken,
          apiBaseUrl: appSettingsDraft.telegram.apiBaseUrl,
          userName: appSettingsDraft.telegram.userName,
          defaultConversationId: appSettingsDraft.telegram.defaultConversationId,
          ownerNodeId: appSettingsDraft.telegram.ownerNodeId,
        },
      });
      replaceAppSettings(nextSettings);
      setAppSettingsFeedback("Settings saved.");
      setIsAppSettingsEditing(nextSettings.onboarding.needed);
      setStartupOnboardingState((current) => current === "active"
        ? (nextSettings.onboarding.needed ? "active" : "done")
        : current);
      await loadShellState(false);
      return true;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return false;
    } finally {
      setAppSettingsSaving(false);
    }
  }, [appSettingsDraft, loadShellState, replaceAppSettings, scoutDesktop]);

  const moveOnboardingWizard = React.useCallback((direction: -1 | 1) => {
    setOnboardingWizardStep((current) => {
      const currentIndex = ONBOARDING_WIZARD_STEP_ORDER.indexOf(current);
      if (currentIndex < 0) {
        return ONBOARDING_WIZARD_STEP_ORDER[0];
      }
      const nextIndex = Math.min(
        ONBOARDING_WIZARD_STEP_ORDER.length - 1,
        Math.max(0, currentIndex + direction),
      );
      return ONBOARDING_WIZARD_STEP_ORDER[nextIndex];
    });
  }, []);

  const handleRunOnboardingCommand = React.useCallback(async (
    command: OnboardingCommandName,
  ): Promise<OnboardingCommandResult | null> => {
    if (!surfaceCaps?.canProvisionRuntime || !scoutDesktop?.runOnboardingCommand) {
      setAppSettingsFeedback(
        surfaceCaps && !surfaceCaps.canProvisionRuntime
          ? "Setup and doctor commands must be run from the Scout CLI (`scout setup`, `scout doctor`) on this host."
          : null,
      );
      return null;
    }

    setOnboardingCommandPending(command);
    setAppSettingsFeedback(null);
    try {
      const sourceRoots = (appSettingsDraft ?? appSettings)?.workspaceRoots ?? [];
      const result = await scoutDesktop.runOnboardingCommand({
        command,
        contextRoot: (appSettingsDraft ?? appSettings)?.onboardingContextRoot ?? sourceRoots[0],
        sourceRoots: command === "setup" ? sourceRoots : undefined,
      });
      setOnboardingCommandResult(result);
      setOnboardingCommandHistory((prev) => ({ ...prev, [command]: result }));
      setAppSettingsFeedback(
        result.exitCode !== 0
          ? `${command} exited with status ${result.exitCode}. Review the output below before continuing.`
          : null,
      );

      if (scoutDesktop.getAppSettings) {
        const nextSettings = (command === "doctor" || command === "setup") && scoutDesktop.refreshSettingsInventory
          ? await scoutDesktop.refreshSettingsInventory()
          : await scoutDesktop.getAppSettings();
        replaceAppSettings(nextSettings);
        setIsAppSettingsEditing(nextSettings.onboarding.needed);
        const nextShellState = await loadShellState(false);

        if (!nextSettings.onboarding.needed) {
          completeOnboardingIntoRelay(nextShellState);
        } else if (command === "runtimes" && result.exitCode === 0 && !nextShellState?.runtime?.brokerReachable) {
          setOnboardingWizardStep("doctor");
          setAppSettingsFeedback("Relay is still offline. Run doctor again and make sure the broker is reachable before onboarding can finish.");
        } else if (result.exitCode === 0) {
          setTimeout(() => {
            moveOnboardingWizard(1);
          }, 1800);
        }

        setStartupOnboardingState((current) => current === "active"
          ? (nextSettings.onboarding.needed ? "active" : "done")
          : current);
      }
      return result;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return null;
    } finally {
      setOnboardingCommandPending(null);
    }
  }, [appSettings, appSettingsDraft, completeOnboardingIntoRelay, loadShellState, moveOnboardingWizard, scoutDesktop, surfaceCaps]);

  const handleRetireProject = React.useCallback(async (projectRoot: string, projectTitle: string): Promise<boolean> => {
    if (!surfaceCaps?.canEditFilesystem) {
      setAppSettingsFeedback("Project retirement is not available in this host. Use the Scout CLI or desktop app.");
      return false;
    }
    if (!scoutDesktop?.retireProject) {
      setAppSettingsFeedback("Project retirement is unavailable in this build.");
      return false;
    }

    setProjectRetirementPendingRoot(projectRoot);
    try {
      const nextSettings = await scoutDesktop.retireProject(projectRoot);
      applyNextAppSettings(nextSettings);
      await loadShellState(false);
      setAppSettingsFeedback(`Retired ${projectTitle}. It is hidden from discovery until restored.`);
      return true;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return false;
    } finally {
      setProjectRetirementPendingRoot(null);
    }
  }, [applyNextAppSettings, loadShellState, scoutDesktop, surfaceCaps]);

  const handleRestoreProject = React.useCallback(async (project: HiddenProjectSummary): Promise<boolean> => {
    if (!surfaceCaps?.canEditFilesystem) {
      setAppSettingsFeedback("Project restore is not available in this host. Use the Scout CLI or desktop app.");
      return false;
    }
    if (!scoutDesktop?.restoreProject) {
      setAppSettingsFeedback("Project restore is unavailable in this build.");
      return false;
    }

    setProjectRetirementPendingRoot(project.root);
    try {
      const nextSettings = await scoutDesktop.restoreProject(project.root);
      applyNextAppSettings(nextSettings);
      await loadShellState(false);
      setAppSettingsFeedback(`Restored ${project.title}. Scout will discover it again.`);
      return true;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return false;
    } finally {
      setProjectRetirementPendingRoot(null);
    }
  }, [applyNextAppSettings, loadShellState, scoutDesktop, surfaceCaps]);

  const handleRestartOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (!scoutDesktop?.restartOnboarding) {
          return;
        }

        const nextSettings = await scoutDesktop.restartOnboarding();
        applyRestartedOnboardingSettings(nextSettings);
        setAppSettingsFeedback("Onboarding restarted.");
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [applyRestartedOnboardingSettings, scoutDesktop]);

  const handleAddSourceRootSuggestion = React.useCallback((root: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const nextRoots = Array.from(new Set([...base.workspaceRoots, root]));
      return {
        ...base,
        onboardingContextRoot: base.onboardingContextRoot || root,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback("Project paths updated. Save General to persist the change.");
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBeginGeneralEdit = React.useCallback(() => {
    if (!isAppSettingsEditing) {
      setAppSettingsDraft(appSettings);
      setAppSettingsFeedback(null);
      setIsAppSettingsEditing(true);
    }
  }, [appSettings, isAppSettingsEditing]);

  const handleSetSourceRootAt = React.useCallback((index: number, value: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const nextRoots = [...base.workspaceRoots];
      while (nextRoots.length <= index) {
        nextRoots.push("");
      }
      nextRoots[index] = value;

      return {
        ...base,
        onboardingContextRoot: index === 0 && (!base.onboardingContextRoot || base.onboardingContextRoot === base.workspaceRoots[0]) ? value : base.onboardingContextRoot,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleAddSourceRootRow = React.useCallback(() => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      return {
        ...base,
        workspaceRoots: [...base.workspaceRoots, ""],
      };
    });
    setAppSettingsFeedback("Project paths updated. Save General to persist the change.");
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleRemoveSourceRootRow = React.useCallback((index: number) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const removedRoot = base.workspaceRoots[index] ?? "";
      const nextRoots = base.workspaceRoots.filter((_, entryIndex) => entryIndex !== index);
      const nextContextRoot = index === 0 && (!base.onboardingContextRoot || base.onboardingContextRoot === removedRoot)
        ? (nextRoots[0] ?? "")
        : base.onboardingContextRoot;

      return {
        ...base,
        onboardingContextRoot: nextContextRoot,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback("Project paths updated. Save General to persist the change.");
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBrowseForSourceRoot = React.useCallback((index: number) => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetSourceRootAt(index, selectedPath);
        setAppSettingsFeedback("Project paths updated. Save General to persist the change.");
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [handleSetSourceRootAt, scoutDesktop, surfaceCaps]);

  const handleSetOnboardingContextRoot = React.useCallback((value: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      return {
        ...base,
        onboardingContextRoot: value,
      };
    });
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBrowseForOnboardingContextRoot = React.useCallback(() => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetOnboardingContextRoot(selectedPath);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [handleSetOnboardingContextRoot, scoutDesktop, surfaceCaps]);

  const dismissStartupOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (scoutDesktop?.skipOnboarding) {
          const nextSettings = await scoutDesktop.skipOnboarding();
          replaceAppSettings(nextSettings);
        }
        setStartupOnboardingState("done");
        setAppSettingsFeedback(null);
        setIsAppSettingsEditing(false);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [replaceAppSettings, scoutDesktop]);

  const handleOnboardingContinue = React.useCallback(() => {
    void (async () => {
      if (activeOnboardingStep.id !== "confirm") {
        moveOnboardingWizard(1);
        return;
      }

      if (!appSettingsDirty) {
        moveOnboardingWizard(1);
        return;
      }

      const saved = await handleSaveAppSettings();
      if (saved) {
        moveOnboardingWizard(1);
      }
    })();
  }, [activeOnboardingStep.id, appSettingsDirty, handleSaveAppSettings, moveOnboardingWizard]);

  React.useEffect(() => {
    const step = activeOnboardingStep.id;
    if (step !== "setup" && step !== "doctor" && step !== "runtimes") return;
    if (onboardingCommandPending) return;
    if (onboardingCommandHistory[step as OnboardingCommandName]) return;
    if (!visibleAppSettings || appSettingsLoading) return;
    if (step === "doctor" && !onboardingHasProjectConfig) return;
    const timer = setTimeout(() => {
      void handleRunOnboardingCommand(step as OnboardingCommandName);
    }, 600);
    return () => clearTimeout(timer);
  }, [
    activeOnboardingStep.id,
    appSettingsLoading,
    handleRunOnboardingCommand,
    onboardingCommandHistory,
    onboardingCommandPending,
    onboardingHasProjectConfig,
    visibleAppSettings,
  ]);

  const skipCurrentOnboardingStep = React.useCallback(() => {
    if (canGoToNextOnboardingStep) {
      moveOnboardingWizard(1);
      return;
    }
    dismissStartupOnboarding();
  }, [canGoToNextOnboardingStep, dismissStartupOnboarding, moveOnboardingWizard]);

  const handleCopyOnboardingCommand = React.useCallback(async (command: OnboardingCommandName) => {
    const commandLine = buildOnboardingCommandLine(command);
    await navigator.clipboard.writeText(commandLine);
    setOnboardingCopiedCommand(command);
    window.setTimeout(() => {
      setOnboardingCopiedCommand((current) => current === command ? null : current);
    }, 1500);
  }, [buildOnboardingCommandLine]);

  const handleLoadWorkspaceInventory = React.useCallback(() => {
    if (!scoutDesktop?.refreshSettingsInventory) {
      return;
    }
    setWorkspaceInventoryLoading(true);
    void scoutDesktop.refreshSettingsInventory()
      .then((nextSettings) => {
        applyNextAppSettings(nextSettings);
      })
      .catch((error) => {
        setAppSettingsFeedback(asErrorMessage(error));
      })
      .finally(() => {
        setWorkspaceInventoryLoading(false);
      });
  }, [applyNextAppSettings, scoutDesktop]);

  return {
    SOURCE_ROOT_PATH_SUGGESTIONS,
    appSettings,
    setAppSettings,
    appSettingsDraft,
    appSettingsLoading,
    workspaceInventoryLoading,
    appSettingsSaving,
    appSettingsFeedback,
    setAppSettingsFeedback,
    setAppSettingsDraft,
    isAppSettingsEditing,
    onboardingWizardStep,
    setOnboardingWizardStep,
    onboardingCommandPending,
    onboardingCommandResult,
    onboardingCommandHistory,
    onboardingCopiedCommand,
    startupOnboardingState,
    setStartupOnboardingState,
    setIsAppSettingsEditing,
    setOnboardingCommandResult,
    setOnboardingCopiedCommand,
    visibleAppSettings,
    agentableProjects,
    hiddenProjects,
    appSettingsDirty,
    projectRetirementPendingRoot,
    workspaceInventoryLoaded,
    canRefreshWorkspaceInventory,
    showDoctorOutput,
    onboardingContextRoot,
    onboardingHasProjectConfig,
    onboardingRuntimeMatch,
    onboardingWizardSteps,
    onboardingWizardIndex,
    activeOnboardingStep,
    canGoToPreviousOnboardingStep,
    canGoToNextOnboardingStep,
    startupOnboardingVisible,
    startupOnboardingBlocking,
    buildOnboardingCommandLine,
    replaceAppSettings,
    syncRefreshedAppSettings,
    applyNextAppSettings,
    applyRestartedOnboardingSettings,
    refreshVisibleAppSettings,
    handleStartAppSettingsEdit,
    handleCancelAppSettingsEdit,
    updateAppSettingsDraft,
    handleSaveAppSettings,
    moveOnboardingWizard,
    handleRunOnboardingCommand,
    handleRetireProject,
    handleRestoreProject,
    handleRestartOnboarding,
    handleAddSourceRootSuggestion,
    handleBeginGeneralEdit,
    handleSetSourceRootAt,
    handleAddSourceRootRow,
    handleRemoveSourceRootRow,
    handleBrowseForSourceRoot,
    handleSetOnboardingContextRoot,
    handleBrowseForOnboardingContextRoot,
    dismissStartupOnboarding,
    handleOnboardingContinue,
    skipCurrentOnboardingStep,
    handleCopyOnboardingCommand,
    handleLoadWorkspaceInventory,
  };
}
