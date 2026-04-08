import React from "react";
import { AlertCircle, CheckCheck, Copy } from "lucide-react";

import type { OnboardingWizardStepId } from "@/app-types";
import { C } from "@/lib/theme";
import type {
  AppSettingsState,
  OnboardingCommandName,
  OnboardingCommandResult,
} from "@/lib/scout-desktop";

type StartupOnboardingStyles = {
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  activePill: React.CSSProperties;
  tagBadge: React.CSSProperties;
};

type OnboardingWizardStepViewModel = {
  id: OnboardingWizardStepId;
  number: string;
  title: string;
  detail: string;
  complete: boolean;
};

type RenderLocalPathValue = (
  filePath: string | null | undefined,
  options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
) => React.ReactNode;

export function OnboardingCommandShell({
  command,
  commandLine,
  running,
  commandResult,
  visibleAppSettings,
  onboardingCopiedCommand,
  onboardingCommandPending,
  onboardingContextRoot,
  onCopyOnboardingCommand,
  onRunOnboardingCommand,
}: {
  command: OnboardingCommandName;
  commandLine: string;
  running: boolean;
  commandResult: OnboardingCommandResult | null;
  visibleAppSettings: AppSettingsState | null;
  onboardingCopiedCommand: OnboardingCommandName | null;
  onboardingCommandPending: OnboardingCommandName | null;
  onboardingContextRoot: string | null;
  onCopyOnboardingCommand: (command: OnboardingCommandName) => Promise<void>;
  onRunOnboardingCommand: (command: OnboardingCommandName) => Promise<OnboardingCommandResult | null>;
}) {
  const succeeded = commandResult && commandResult.exitCode === 0;
  const failed = commandResult && commandResult.exitCode !== 0;

  return (
    <div className="space-y-2">
      {succeeded && (() => {
        const projectCount = visibleAppSettings?.projectInventory?.length ?? 0;
        const brokerOk = visibleAppSettings?.broker?.reachable;
        const runtimesReady = (visibleAppSettings?.runtimeCatalog ?? []).filter((runtime) => runtime.readinessState === "ready").length;
        const runtimesTotal = (visibleAppSettings?.runtimeCatalog ?? []).length;

        const facts: string[] = [];
        if (command === "setup" || command === "doctor") {
          facts.push(brokerOk ? "Broker running" : "Broker installed");
          if (projectCount > 0) {
            facts.push(`${projectCount} project${projectCount === 1 ? "" : "s"} discovered`);
          }
        }
        if (command === "runtimes" && runtimesTotal > 0) {
          facts.push(`${runtimesReady} of ${runtimesTotal} runtime${runtimesTotal === 1 ? "" : "s"} ready`);
        }

        return (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.25)" }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCheck size={14} style={{ color: "#16a34a" }} />
              <span className="text-[12px] font-semibold" style={{ color: "#16a34a" }}>Done</span>
            </div>
            {facts.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {facts.map((fact) => (
                  <span key={fact} className="text-[11px]" style={{ color: "#16a34a", opacity: 0.85 }}>
                    {fact}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })()}
      {failed ? (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.25)" }}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <AlertCircle size={15} className="shrink-0 mt-0.5" style={{ color: "#dc2626" }} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold" style={{ color: "#dc2626" }}>
                Command failed (exit {commandResult.exitCode})
              </div>
              <div className="text-[11px] mt-1 leading-[1.5]" style={{ color: "#dc2626", opacity: 0.8 }}>
                Check the output below for details, then try again or run the command in Terminal for more context.
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
              style={{ borderColor: "rgba(239,68,68,0.35)", color: "#dc2626", backgroundColor: "rgba(239,68,68,0.08)" }}
              onClick={() => void onRunOnboardingCommand(command)}
              disabled={Boolean(onboardingCommandPending)}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(15, 23, 42, 0.12)", backgroundColor: C.termBg }}>
        <div
          className="flex items-center justify-between gap-3 px-3.5 py-2 border-b"
          style={{ borderBottomColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.03)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-[5px]">
              <span className="w-[7px] h-[7px] rounded-full bg-[#ff5f57]" />
              <span className="w-[7px] h-[7px] rounded-full bg-[#febc2e]" />
              <span className="w-[7px] h-[7px] rounded-full bg-[#28c840]" />
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.38)" }}>
              Terminal
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {running ? (
              <span className="text-[10px] font-mono px-2 py-1 rounded animate-pulse" style={{ backgroundColor: "rgba(45,212,191,0.18)", color: "#99f6e4" }}>
                Running…
              </span>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-85"
              style={{ borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.82)", backgroundColor: "rgba(255,255,255,0.04)" }}
              onClick={() => void onCopyOnboardingCommand(command)}
            >
              {onboardingCopiedCommand === command ? <CheckCheck size={12} /> : <Copy size={12} />}
              {onboardingCopiedCommand === command ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[13px] leading-[1.7] font-mono break-all" style={{ color: C.termFg }}>
            <span style={{ color: "rgba(153,246,228,0.80)" }}>$</span> {commandLine}
          </div>
        </div>
        {running || commandResult ? (
          <div className="border-t px-4 py-3" style={{ borderTopColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(0,0,0,0.08)" }}>
            <div className="text-[10px] font-mono mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
              cwd: {commandResult?.cwd ?? (onboardingContextRoot || "…")}
            </div>
            <pre
              className="text-[11px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto font-mono"
              style={{ color: failed ? "rgba(252,165,165,0.85)" : C.termFg, maxHeight: "16rem", overflowY: "auto" }}
            >
              {running ? "… waiting for output" : commandResult?.output}
            </pre>
          </div>
        ) : (
          <div className="px-4 py-4 border-t" style={{ borderTopColor: "rgba(255,255,255,0.06)" }}>
            <div className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
              Output will appear here after you run the command.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StartupOnboardingStepContent({
  activeOnboardingStep,
  visibleAppSettings,
  appSettingsSaving,
  appSettingsLoading,
  appSettingsDirty,
  onboardingCommandPending,
  onboardingHasProjectConfig,
  sourceRootPathSuggestions,
  settingsOperatorNameRef,
  setAppSettingsDraft,
  setAppSettingsFeedback,
  setIsAppSettingsEditing,
  handleAddSourceRootRow,
  handleSetSourceRootAt,
  handleBrowseForSourceRoot,
  handleRemoveSourceRootRow,
  handleSetOnboardingContextRoot,
  handleBrowseForOnboardingContextRoot,
  handleAddSourceRootSuggestion,
  handleRunOnboardingCommand,
  buildOnboardingCommandLine,
  renderOnboardingCommandShell,
  renderLocalPathValue,
  styles,
  availableHarnesses,
}: {
  activeOnboardingStep: OnboardingWizardStepViewModel;
  visibleAppSettings: AppSettingsState;
  appSettingsSaving: boolean;
  appSettingsLoading: boolean;
  appSettingsDirty: boolean;
  onboardingCommandPending: OnboardingCommandName | null;
  onboardingHasProjectConfig: boolean;
  sourceRootPathSuggestions: readonly string[];
  settingsOperatorNameRef: React.RefObject<HTMLInputElement | null>;
  setAppSettingsDraft: React.Dispatch<React.SetStateAction<AppSettingsState | null>>;
  setAppSettingsFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  setIsAppSettingsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  handleAddSourceRootRow: () => void;
  handleSetSourceRootAt: (index: number, value: string) => void;
  handleBrowseForSourceRoot: (index: number) => void;
  handleRemoveSourceRootRow: (index: number) => void;
  handleSetOnboardingContextRoot: (value: string) => void;
  handleBrowseForOnboardingContextRoot: () => void;
  handleAddSourceRootSuggestion: (root: string) => void;
  handleRunOnboardingCommand: (command: OnboardingCommandName) => Promise<OnboardingCommandResult | null>;
  buildOnboardingCommandLine: (command: OnboardingCommandName) => string;
  renderOnboardingCommandShell: (
    command: OnboardingCommandName,
    commandLine: string,
    running: boolean,
  ) => React.ReactNode;
  renderLocalPathValue: RenderLocalPathValue;
  styles: StartupOnboardingStyles;
  availableHarnesses: readonly string[];
}) {
  if (activeOnboardingStep.id === "welcome") {
    return (
      <div className="space-y-8">
        <div className="space-y-3">
          <div className="text-[32px] font-bold tracking-tight leading-[1.15]" style={styles.inkText}>
            Welcome to Scout
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={styles.mutedText}>
            What should we call you?
          </div>
        </div>

        <div className="rounded-xl border px-6 py-6" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-4" style={{ color: C.accent }}>Your name</div>
          <input
            ref={settingsOperatorNameRef}
            value={visibleAppSettings.operatorName ?? ""}
            onChange={(event) => {
              setAppSettingsDraft((current) => current ? {
                ...current,
                operatorName: event.target.value,
              } : current);
              setAppSettingsFeedback(null);
              setIsAppSettingsEditing(true);
            }}
            readOnly={appSettingsSaving}
            placeholder={visibleAppSettings.operatorNameDefault || "Operator"}
            className="w-full border-b-2 border-t-0 border-l-0 border-r-0 px-0 py-3 text-[24px] font-semibold leading-[1.3] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
            style={{ borderBottomColor: C.border, color: C.ink }}
          />
          <div className="text-[12px] mt-4 leading-[1.6]" style={styles.mutedText}>
            Prefilled from your machine.
          </div>
        </div>
      </div>
    );
  }

  if (activeOnboardingStep.id === "source-roots") {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>
            Scan folders and context root
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={styles.mutedText}>
            Choose the parent folders Scout should scan for repos, then choose the one directory where this Scout context should live.
          </div>
        </div>

        <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[11px] font-mono uppercase tracking-widest" style={styles.mutedText}>Source Roots</div>
            <button
              type="button"
              className="os-toolbar-button inline-flex items-center gap-1 text-[12px] font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50"
              style={{ color: C.ink, borderColor: C.border }}
              onClick={handleAddSourceRootRow}
              disabled={appSettingsSaving}
            >
              <span className="text-[14px] leading-none">+</span>
              Add path
            </button>
          </div>
          <div className="text-[12px] mb-3 leading-[1.6]" style={styles.mutedText}>
            These are scan inputs. Scout looks through the repos underneath them, but listing a folder here does not make it the place where Scout saves this context.
          </div>
          <div className="space-y-3">
            {(visibleAppSettings.workspaceRoots ?? []).map((root, index) => (
              <div key={`immersive-source-root-${index}`} className="flex items-center gap-2">
                <input
                  value={root}
                  onChange={(event) => handleSetSourceRootAt(index, event.target.value)}
                  readOnly={appSettingsSaving}
                  className="flex-1 rounded-lg border px-4 py-3 text-[15px] font-mono leading-[1.5] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
                  style={{ borderColor: C.border, color: C.ink }}
                  placeholder={index === 0 ? "~/dev" : "Add another source root"}
                />
                <button
                  type="button"
                  className="os-toolbar-button text-[12px] font-medium px-3 py-3 rounded-lg border disabled:opacity-50 shrink-0"
                  style={{ color: C.ink, borderColor: C.border }}
                  onClick={() => handleBrowseForSourceRoot(index)}
                  disabled={appSettingsSaving}
                >
                  Finder
                </button>
                <button
                  type="button"
                  className="os-toolbar-button text-[14px] font-medium w-10 h-10 rounded-lg border disabled:opacity-50 shrink-0"
                  style={{ color: C.ink, borderColor: C.border }}
                  onClick={() => handleRemoveSourceRootRow(index)}
                  disabled={appSettingsSaving || ((visibleAppSettings.workspaceRoots ?? []).length <= 1 && !root)}
                  aria-label={`Remove source root ${index + 1}`}
                >
                  -
                </button>
              </div>
            ))}
            {(visibleAppSettings.workspaceRoots ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-4 text-[12px] leading-[1.6]" style={{ borderColor: C.border, color: C.muted }}>
                No scan folders yet. Add a path above to tell Scout where to look for repos and projects.
              </div>
            ) : null}
          </div>
          <div className="mt-5 pt-5 border-t" style={{ borderTopColor: C.border }}>
            <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={styles.mutedText}>Relay Context Root</div>
            <div className="text-[12px] leading-[1.6] mb-3" style={styles.mutedText}>
              This is different from the scan folders above. Scout will save this context here by writing <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>.openscout/project.json</code> inside this directory.
            </div>
            <div className="flex items-center gap-2">
              <input
                value={visibleAppSettings.onboardingContextRoot ?? ""}
                onChange={(event) => handleSetOnboardingContextRoot(event.target.value)}
                readOnly={appSettingsSaving}
                className="flex-1 rounded-lg border px-4 py-3 text-[15px] font-mono leading-[1.5] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
                style={{ borderColor: C.border, color: C.ink }}
                placeholder="Choose where .openscout should live"
              />
              <button
                type="button"
                className="os-toolbar-button text-[12px] font-medium px-3 py-3 rounded-lg border disabled:opacity-50 shrink-0"
                style={{ color: C.ink, borderColor: C.border }}
                onClick={handleBrowseForOnboardingContextRoot}
                disabled={appSettingsSaving}
              >
                Finder
              </button>
            </div>
          </div>
          <div className="text-[12px] mt-3 leading-[1.6]" style={styles.mutedText}>
            Usually something like <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>~/dev</code> or <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>~/src</code>.
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {sourceRootPathSuggestions.map((root) => (
              <button
                key={root}
                className="os-toolbar-button text-[12px] font-mono font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ color: C.ink, borderColor: C.border }}
                onClick={() => handleAddSourceRootSuggestion(root)}
                disabled={appSettingsSaving}
              >
                {root}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (activeOnboardingStep.id === "harness") {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>
            Default harness
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={styles.mutedText}>
            Which assistant should answer new project turns by default?
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availableHarnesses.map((harness) => {
            const runtimeEntry = (visibleAppSettings.runtimeCatalog ?? []).find((entry) => entry.name === harness) ?? null;
            const selected = visibleAppSettings.defaultHarness === harness;
            return (
              <button
                key={harness}
                className="os-card text-left rounded-xl border px-5 py-5 disabled:opacity-60"
                style={{ borderColor: selected ? C.accent : C.border, backgroundColor: selected ? C.accentBg : C.surface, boxShadow: selected ? `0 0 0 1px ${C.accent}` : "none" }}
                disabled={appSettingsSaving}
                onClick={() => {
                  setAppSettingsDraft((current) => current ? {
                    ...current,
                    defaultHarness: harness,
                  } : current);
                  setAppSettingsFeedback(null);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold capitalize tracking-tight" style={styles.inkText}>{harness}</div>
                    <div className="text-[13px] mt-2 leading-[1.6]" style={styles.mutedText}>
                      {harness === "claude"
                        ? "Anthropic Claude Code — agentic coding via local CLI session."
                        : "OpenAI Codex — agentic coding via cloud sandbox."}
                    </div>
                    <div className="text-[12px] mt-4 leading-[1.6]" style={styles.mutedText}>
                      Runtime: {runtimeEntry?.label ?? harness} · {runtimeEntry?.readinessDetail ?? "Not reported yet."}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full shrink-0" style={selected ? styles.activePill : styles.tagBadge}>
                    {selected ? "selected" : "available"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (activeOnboardingStep.id === "confirm") {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>
            Confirm this context
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={styles.mutedText}>
            Review which folders Scout will scan and where it will save this context before continuing.
          </div>
        </div>

        <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              ["Operator", visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
              ["Source roots", (visibleAppSettings.workspaceRoots ?? []).join(", ") || "None yet"],
              ["Default harness", visibleAppSettings.defaultHarness ?? "Not set"],
              ["Relay context root", visibleAppSettings.onboardingContextRoot || "Not set"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg px-4 py-3" style={{ backgroundColor: C.bg }}>
                <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: C.accent }}>{label}</div>
                <div className="text-[15px] font-medium leading-[1.5]" style={styles.inkText}>
                  {label === "Relay context root"
                    ? renderLocalPathValue(String(value), { className: "text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity" })
                    : value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {appSettingsDirty ? (
          <div className="text-[12px] leading-[1.6]" style={styles.mutedText}>Unsaved changes.</div>
        ) : null}
      </div>
    );
  }

  if (activeOnboardingStep.id === "setup") {
    const setupCommandLine = buildOnboardingCommandLine("setup");
    const setupRunning = onboardingCommandPending === "setup";
    const initManifestPath = visibleAppSettings.currentProjectConfigPath
      ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : "Not created yet.");

    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>
            Setup
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={styles.mutedText}>
            Create the local project manifest.
          </div>
        </div>

        {renderOnboardingCommandShell("setup", setupCommandLine, setupRunning)}

        <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              ["1. Context root", visibleAppSettings.onboardingContextRoot || "Not set"],
              ["2. Manifest", "Writes `.openscout/project.json` at that root to anchor this context."],
              ["3. Discovery", "Uses that context plus scanned folders to build inventory and routing."],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-lg border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="text-[11px] font-mono font-medium tracking-wide" style={{ color: C.accent }}>{label}</div>
                <div className="text-[12px] mt-2 leading-[1.6]" style={styles.mutedText}>{detail}</div>
              </div>
            ))}
          </div>
          <div className="text-[12px] font-mono mt-5 leading-[1.6] break-all" style={styles.mutedText}>
            {typeof initManifestPath === "string"
              ? renderLocalPathValue(initManifestPath, { className: "text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity", style: styles.mutedText })
              : initManifestPath}
          </div>
        </div>

        <button
          className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
          style={{ backgroundColor: C.accent, color: "#fff" }}
          onClick={() => { void handleRunOnboardingCommand("setup"); }}
          disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsDirty}
        >
          {setupRunning ? "Running Setup…" : "Run Setup"}
        </button>
      </div>
    );
  }

  if (activeOnboardingStep.id === "doctor") {
    const doctorCommandLine = buildOnboardingCommandLine("doctor");
    const doctorRunning = onboardingCommandPending === "doctor";
    const brokerOk = visibleAppSettings.broker.reachable;
    const projectCount = visibleAppSettings.projectInventory.length;
    const statusItems = [
      {
        label: "Broker",
        value: brokerOk ? "Reachable" : "Unavailable",
        ok: brokerOk,
        fix: brokerOk ? null : "Re-run setup to install and start the broker service.",
      },
      {
        label: "Projects",
        value: `${projectCount} found`,
        ok: projectCount > 0,
        fix: projectCount === 0 ? "Add workspace roots in Settings → General, then refresh Workspaces." : null,
      },
      {
        label: "Context root",
        value: visibleAppSettings.currentProjectConfigPath ? "Configured" : "Missing",
        ok: Boolean(visibleAppSettings.currentProjectConfigPath),
        fix: visibleAppSettings.currentProjectConfigPath ? null : "Run setup again from the previous step.",
      },
    ];
    const hasIssues = statusItems.some((item) => !item.ok);

    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>Doctor</div>
          <div className="text-[14px] leading-[1.6]" style={styles.mutedText}>
            Verify broker health, project discovery, and relay context.
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {statusItems.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border px-4 py-3"
              style={{
                borderColor: item.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
                backgroundColor: item.ok ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
              }}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span style={{ color: item.ok ? "#16a34a" : "#dc2626", fontSize: 13 }}>
                  {item.ok ? "✓" : "✗"}
                </span>
                <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: item.ok ? "#16a34a" : "#dc2626" }}>
                  {item.label}
                </div>
              </div>
              <div className="text-[13px] font-medium" style={styles.inkText}>{item.value}</div>
              {item.fix ? (
                <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: "#dc2626", opacity: 0.8 }}>
                  {item.fix}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {renderOnboardingCommandShell("doctor", doctorCommandLine, doctorRunning)}

        <button
          className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
          style={{ backgroundColor: hasIssues ? "#dc2626" : C.accent, color: "#fff" }}
          onClick={() => { void handleRunOnboardingCommand("doctor"); }}
          disabled={Boolean(onboardingCommandPending) || appSettingsLoading || !onboardingHasProjectConfig}
        >
          {doctorRunning ? "Running Doctor…" : hasIssues ? "Run Doctor to diagnose" : "Run Doctor"}
        </button>
      </div>
    );
  }

  const runtimesCommandLine = buildOnboardingCommandLine("runtimes");
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[28px] font-semibold tracking-tight" style={styles.inkText}>Runtimes</div>
        <div className="text-[14px] leading-[1.6]" style={styles.mutedText}>
          Verify each harness has a working local runtime.
        </div>
      </div>

      {(visibleAppSettings.runtimeCatalog ?? []).length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {(visibleAppSettings.runtimeCatalog ?? []).map((runtimeEntry) => {
            const ready = runtimeEntry.readinessState === "ready";
            return (
              <div
                key={runtimeEntry.name}
                className="rounded-xl border px-4 py-3 flex items-start justify-between gap-3"
                style={{
                  borderColor: ready ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
                  backgroundColor: ready ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
                }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="mt-0.5 text-[14px]" style={{ color: ready ? "#16a34a" : "#dc2626" }}>
                    {ready ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold" style={styles.inkText}>{runtimeEntry.label}</div>
                    <div className="text-[11px] mt-0.5 leading-[1.5]" style={ready ? styles.mutedText : { color: "#dc2626", opacity: 0.85 }}>
                      {runtimeEntry.readinessDetail}
                    </div>
                    {!ready && runtimeEntry.readinessState === "missing" ? (
                      <div className="text-[10px] font-mono mt-1.5 px-2 py-1 rounded inline-block" style={{ backgroundColor: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
                        {runtimeEntry.name === "claude" ? "brew install claude" : runtimeEntry.name === "codex" ? "npm install -g @openai/codex" : `install ${runtimeEntry.name}`}
                      </div>
                    ) : null}
                    {!ready && runtimeEntry.readinessState === "configured" ? (
                      <div className="text-[10px] font-mono mt-1.5 px-2 py-1 rounded inline-block" style={{ backgroundColor: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
                        {runtimeEntry.name === "claude" ? "claude login" : runtimeEntry.name === "codex" ? "codex login" : `${runtimeEntry.name} login`}
                      </div>
                    ) : null}
                  </div>
                </div>
                <span
                  className="text-[10px] font-mono px-2.5 py-1 rounded-full shrink-0"
                  style={ready ? styles.activePill : { backgroundColor: "rgba(239,68,68,0.12)", color: "#dc2626" }}
                >
                  {runtimeEntry.readinessState}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {renderOnboardingCommandShell("runtimes", runtimesCommandLine, onboardingCommandPending === "runtimes")}

      <button
        className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
        style={{ backgroundColor: C.accent, color: "#fff" }}
        onClick={() => void handleRunOnboardingCommand("runtimes")}
        disabled={Boolean(onboardingCommandPending) || appSettingsLoading}
      >
        {onboardingCommandPending === "runtimes" ? "Running Runtimes…" : "Run Runtimes"}
      </button>
    </div>
  );
}
