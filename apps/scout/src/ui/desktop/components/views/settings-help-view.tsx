import React from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FileJson,
  FolderOpen,
  Key,
  MessageSquare,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  Sun,
  Terminal,
} from 'lucide-react';

import { AgentSettingsView } from '@/components/agent-settings-view';
import { CommunicationSettingsView } from '@/components/communication-settings-view';
import { WorkspaceExplorerView } from '@/components/workspace-explorer-view';
import type { AppView, OnboardingWizardStepId, SettingsSectionMeta } from '@/app-types';
import { C } from '@/lib/theme';
import type {
  AppSettingsState,
  DesktopShellState,
  OnboardingCommandName,
  OnboardingCommandResult,
} from '@/lib/scout-desktop';
import type { SettingsSectionId } from '@/settings/settings-paths';

interface SettingsViewStyles {
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
}

interface HelpViewModel {
  styles: SettingsViewStyles;
  buildOnboardingCommandLine: (command: OnboardingCommandName) => string;
  onboardingCopiedCommand: OnboardingCommandName | null;
  onboardingCommandPending: OnboardingCommandName | null;
  onCopyOnboardingCommand: (command: OnboardingCommandName) => Promise<void>;
  onRunOnboardingCommand: (command: OnboardingCommandName) => Promise<void>;
  onOpenGeneralSettings: () => void;
}

interface OnboardingWizardStepViewModel {
  id: OnboardingWizardStepId;
  number: string;
  title: string;
  detail: string;
  complete: boolean;
  helper?: string;
}

interface ProfileSettingsViewModel {
  styles: SettingsViewStyles;
  visibleAppSettings: AppSettingsState | null;
  appSettings: AppSettingsState | null;
  isAppSettingsEditing: boolean;
  appSettingsSaving: boolean;
  appSettingsLoading: boolean;
  appSettingsDirty: boolean;
  appSettingsFeedback: string | null;
  settingsOperatorNameRef: React.RefObject<HTMLInputElement | null>;
  onboardingWizardStep: OnboardingWizardStepId;
  setOnboardingWizardStep: React.Dispatch<React.SetStateAction<OnboardingWizardStepId>>;
  activeOnboardingStepIndex: number;
  activeOnboardingStep: OnboardingWizardStepViewModel;
  onboardingWizardSteps: OnboardingWizardStepViewModel[];
  sourceRootPathSuggestions: readonly string[];
  onboardingRuntimeMatch: AppSettingsState['runtimeCatalog'][number] | null;
  onboardingHasProjectConfig: boolean;
  onboardingCopiedCommand: OnboardingCommandName | null;
  onboardingCommandPending: OnboardingCommandName | null;
  onboardingCommandResult: OnboardingCommandResult | null;
  canGoToPreviousOnboardingStep: boolean;
  canGoToNextOnboardingStep: boolean;
  moveOnboardingWizard: (direction: -1 | 1) => void;
  handleOnboardingContinue: () => void;
  handleRestartOnboarding: () => void;
  handleStartAppSettingsEdit: () => void;
  handleBeginGeneralEdit: () => void;
  handleSetSourceRootAt: (index: number, value: string) => void;
  handleBrowseForSourceRoot: (index: number) => void;
  handleRemoveSourceRootRow: (index: number) => void;
  handleAddSourceRootRow: () => void;
  handleAddSourceRootSuggestion: (root: string) => void;
  handleSetOnboardingContextRoot: (value: string) => void;
  handleBrowseForOnboardingContextRoot: () => void;
  setAppSettingsDraft: React.Dispatch<React.SetStateAction<AppSettingsState | null>>;
  setAppSettingsFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  buildOnboardingCommandLine: (command: OnboardingCommandName) => string;
  handleCopyOnboardingCommand: (command: OnboardingCommandName) => Promise<void>;
  handleRunOnboardingCommand: (command: OnboardingCommandName) => Promise<void>;
  renderOnboardingCommandShell: (
    command: OnboardingCommandName,
    commandLine: string,
    running: boolean,
  ) => React.ReactNode;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
  openKnowledgeBase: () => void;
}

interface DatabaseViewModel {
  styles: SettingsViewStyles;
  stats: {
    totalSessions: number;
    totalMessages: number;
    projects: number;
    totalTokens: number;
  };
  runtime: DesktopShellState['runtime'] | null;
  visibleAppSettings: AppSettingsState | null;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
  onRevealPath: (filePath: string) => void;
}

interface AppearanceViewModel {
  styles: SettingsViewStyles;
  dark: boolean;
  setDark: React.Dispatch<React.SetStateAction<boolean>>;
  showAnnotations: boolean;
  setShowAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  isCollapsed: boolean;
  activeSettingsLabel: string;
}

interface SettingsViewModel {
  styles: SettingsViewStyles;
  settingsSection: SettingsSectionId;
  settingsSections: SettingsSectionMeta[];
  activeSettingsMeta: SettingsSectionMeta;
  onSetSettingsSection: (section: SettingsSectionId) => void;
  onOpenFeedbackDialog: () => void;
  headerActions: React.ReactNode;
  profile: ProfileSettingsViewModel;
  agentSettingsViewProps: React.ComponentProps<typeof AgentSettingsView>;
  workspaceExplorerViewProps: React.ComponentProps<typeof WorkspaceExplorerView>;
  communicationSettingsViewProps: React.ComponentProps<typeof CommunicationSettingsView>;
  database: DatabaseViewModel;
  appearance: AppearanceViewModel;
}

export interface SettingsHelpViewProps {
  activeView: AppView;
  help: HelpViewModel;
  settings: SettingsViewModel;
}

export function SettingsHelpView({
  activeView,
  help,
  settings,
}: SettingsHelpViewProps) {
  if (activeView === 'help') {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl px-8 py-6">
          <div className="flex items-start justify-between gap-6 mb-5">
            <div>
              <div className="text-[10px] font-mono tracking-widest uppercase mb-1.5" style={{ color: C.accent }}>Help</div>
              <h1 className="text-[22px] font-semibold tracking-tight" style={help.styles.inkText}>Knowledge Base</h1>
              <p className="text-[12px] mt-1.5 max-w-2xl leading-[1.6]" style={help.styles.mutedText}>
                Core Scout terms and the main CLI commands you can use here or in Terminal.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                style={{ color: C.ink }}
                onClick={help.onOpenGeneralSettings}
              >
                <Settings size={12} />
                General
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <section className="border rounded-xl p-5" style={{ ...help.styles.surface, borderColor: C.border }}>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Vocabulary</div>
                  <div className="text-[14px] font-medium mt-1" style={help.styles.inkText}>What Scout means by each term</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  [
                    'Project Path',
                    'A folder Scout scans recursively to discover repos, project roots, and harness evidence.',
                  ],
                  [
                    'Context Root',
                    'The directory where Scout saves `.openscout/project.json` for the current local context.',
                  ],
                  [
                    'Harness',
                    'The assistant family a project prefers by default, such as `claude` or `codex`.',
                  ],
                  [
                    'Runtime',
                    'The installed local program or persistent session Scout uses to launch a chosen harness.',
                  ],
                ].map(([label, value]) => (
                  <article
                    key={label}
                    className="rounded-xl border px-4 py-3.5"
                    style={{ borderColor: C.border, backgroundColor: C.bg }}
                  >
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>{label}</div>
                    <div className="text-[12px] mt-2 leading-[1.6]" style={help.styles.inkText}>{value}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="border rounded-xl p-5" style={{ ...help.styles.surface, borderColor: C.border }}>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>CLI Basics</div>
                  <div className="text-[14px] font-medium mt-1" style={help.styles.inkText}>The same commands the app runs for you</div>
                  <div className="text-[12px] mt-1 leading-[1.6] max-w-2xl" style={help.styles.mutedText}>
                    Run them from here for guidance, or copy them into your shell when you want the direct Scout workflow.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {([
                  {
                    command: 'setup' as const,
                    title: 'Setup',
                    detail: 'Writes a local `.openscout/project.json` for the chosen context.',
                  },
                  {
                    command: 'doctor' as const,
                    title: 'Doctor',
                    detail: 'Checks broker health and whether Scout can discover workspaces from your scan roots.',
                  },
                  {
                    command: 'runtimes' as const,
                    title: 'Runtimes',
                    detail: 'Shows whether Claude and Codex are installed, authenticated, and ready.',
                  },
                ]).map((item) => (
                  <article
                    key={item.command}
                    className="rounded-xl border px-4 py-3.5"
                    style={{ borderColor: C.border, backgroundColor: C.bg }}
                  >
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>{item.title}</div>
                    <div className="text-[12px] mt-2 leading-[1.6]" style={help.styles.inkText}>{item.detail}</div>
                    <div className="text-[10px] font-mono mt-3 break-all" style={help.styles.mutedText}>
                      {help.buildOnboardingCommandLine(item.command)}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                        style={{ color: C.ink }}
                        onClick={() => { void help.onCopyOnboardingCommand(item.command); }}
                      >
                        {help.onboardingCopiedCommand === item.command ? <Check size={12} /> : <Copy size={12} />}
                        Copy
                      </button>
                      <button
                        type="button"
                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                        style={{ color: C.ink }}
                        onClick={() => { void help.onRunOnboardingCommand(item.command); }}
                        disabled={Boolean(help.onboardingCommandPending)}
                      >
                        <Terminal size={12} />
                        Run
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  if (activeView !== 'settings') {
    return null;
  }

  const profile = settings.profile;
  const visibleAppSettings = profile.visibleAppSettings;

  return (
    <div className="flex-1 flex overflow-hidden" style={settings.styles.surface}>
      <div className="w-56 border-r flex flex-col shrink-0" style={{ backgroundColor: C.bg, borderColor: C.border }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Settings</div>
        </div>
        <div className="px-2 py-2 flex flex-col gap-0.5 flex-1">
          {settings.settingsSections.map((section) => {
            const active = settings.settingsSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => settings.onSetSettingsSection(section.id)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors"
                style={active ? { backgroundColor: C.surface, borderColor: C.border, color: C.ink, boxShadow: C.shadowXs } : settings.styles.mutedText}
              >
                <span style={{ color: active ? C.accent : C.muted }}>{section.icon}</span>
                <span className="text-[12px] font-medium" style={active ? settings.styles.inkText : undefined}>{section.label}</span>
                {active ? <ChevronRight size={12} className="ml-auto" style={settings.styles.mutedText} /> : null}
              </button>
            );
          })}
        </div>
        <div className="px-3 py-3 border-t" style={{ borderColor: C.border }}>
          <button
            type="button"
            onClick={settings.onOpenFeedbackDialog}
            className="flex items-center gap-2 px-3 py-2 w-full rounded-lg transition-colors hover:opacity-70"
            style={settings.styles.mutedText}
          >
            <MessageSquare size={13} style={{ color: C.muted }} />
            <span className="text-[12px] font-medium">Feedback</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl px-8 py-6">
          <div className="flex items-start justify-between gap-6 mb-5">
            <div>
              <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>Settings</div>
              <h1 className="text-[18px] font-semibold tracking-tight" style={settings.styles.inkText}>{settings.activeSettingsMeta.label}</h1>
              <p className="text-[11px] mt-1 max-w-2xl leading-[1.6]" style={settings.styles.mutedText}>
                {settings.activeSettingsMeta.description}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {settings.headerActions}
            </div>
          </div>

          {settings.settingsSection === 'profile' ? (
            <div className="max-w-3xl">
              <div className="space-y-5 min-w-0">
                {visibleAppSettings?.onboarding?.needed ? (
                  <section className="border rounded-xl p-5" style={{ ...settings.styles.surface, borderColor: C.border }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={settings.styles.mutedText}>Onboarding</div>
                        <div className="text-[13px] font-medium mt-1" style={settings.styles.inkText}>{visibleAppSettings.onboarding.title}</div>
                        <div className="text-[11px] mt-1 leading-[1.5]" style={settings.styles.mutedText}>
                          {visibleAppSettings.onboarding.detail}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                          style={{ color: C.ink }}
                          onClick={profile.handleRestartOnboarding}
                        >
                          <RefreshCw size={12} />
                          Restart onboarding
                        </button>
                        <span
                          className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={settings.styles.tagBadge}
                        >
                          {`${profile.activeOnboardingStepIndex + 1}/${profile.onboardingWizardSteps.length}`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                      <div className="space-y-2">
                        {profile.onboardingWizardSteps.map((step, index) => {
                          const active = profile.onboardingWizardStep === step.id;
                          const complete = index < profile.activeOnboardingStepIndex;
                          return (
                            <button
                              key={step.id}
                              type="button"
                              className="w-full rounded-lg border px-3 py-2 text-left transition-opacity hover:opacity-90"
                              style={{
                                borderColor: active ? C.accent : C.border,
                                backgroundColor: active ? C.accentBg : C.surface,
                                color: active ? C.accent : C.ink,
                              }}
                              onClick={() => profile.setOnboardingWizardStep(step.id)}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-mono uppercase tracking-widest">{step.title}</div>
                                  <div className="text-[10px] mt-1 leading-[1.5]" style={active ? { color: C.accent } : settings.styles.mutedText}>
                                    {step.detail}
                                  </div>
                                </div>
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={complete ? settings.styles.activePill : settings.styles.tagBadge}>
                                  {complete ? 'done' : index + 1}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: C.accent }}>{profile.activeOnboardingStep.title}</div>
                        <div className="text-[13px] font-medium mt-1" style={settings.styles.inkText}>{profile.activeOnboardingStep.detail}</div>
                        <div className="text-[11px] mt-2 leading-[1.6]" style={settings.styles.mutedText}>
                          {profile.activeOnboardingStep.helper}
                        </div>

                        {profile.activeOnboardingStep.id === 'welcome' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="text-[12px] font-medium" style={settings.styles.inkText}>Before you start</div>
                              <div className="text-[10px] mt-1 leading-[1.5]" style={settings.styles.mutedText}>
                                Scout discovers workspaces from scan folders, stores local config under a context root, and needs a default harness before it can broker local runs.
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {[
                                ['Source roots', (visibleAppSettings.workspaceRoots ?? []).join(', ') || 'None yet'],
                                ['Context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                                ['Default harness', visibleAppSettings.defaultHarness ?? 'Not set'],
                                ['Operator', visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>{label}</div>
                                  <div className="text-[11px] leading-[1.45]" style={settings.styles.inkText}>{value}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : profile.activeOnboardingStep.id === 'source-roots' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="text-[12px] font-medium" style={settings.styles.inkText}>Project scan folders</div>
                              <div className="text-[10px] mt-1 leading-[1.5]" style={settings.styles.mutedText}>
                                Scout recursively scans these folders to find repos, manifests, and harness evidence.
                              </div>
                            </div>

                            <div className="space-y-2">
                              {(visibleAppSettings.workspaceRoots ?? []).map((root, index) => (
                                <div key={`onboarding-source-root-${index}`} className="flex items-center gap-1.5">
                                  <input
                                    value={root}
                                    onChange={(event) => profile.handleSetSourceRootAt(index, event.target.value)}
                                    readOnly={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                    className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                    style={{ borderColor: C.border, color: C.ink }}
                                    placeholder={index === 0 ? '~/dev' : 'Add another scan folder'}
                                  />
                                  <button
                                    type="button"
                                    className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                    style={{ color: C.ink }}
                                    onClick={() => profile.handleBrowseForSourceRoot(index)}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                  >
                                    Finder
                                  </button>
                                  <button
                                    type="button"
                                    className="os-toolbar-button text-[12px] font-medium w-7 h-7 rounded-md disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => profile.handleRemoveSourceRootRow(index)}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving || ((visibleAppSettings.workspaceRoots ?? []).length <= 1 && !root)}
                                    aria-label={`Remove source root ${index + 1}`}
                                  >
                                    -
                                  </button>
                                </div>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                style={{ color: C.ink }}
                                onClick={() => {
                                  profile.handleBeginGeneralEdit();
                                  profile.handleAddSourceRootRow();
                                }}
                                disabled={profile.appSettingsSaving}
                              >
                                <span className="text-[12px] leading-none">+</span>
                                Add path
                              </button>
                              <span className="text-[10px]" style={settings.styles.mutedText}>or</span>
                              {profile.sourceRootPathSuggestions.map((root) => (
                                <button
                                  key={root}
                                  type="button"
                                  className="os-toolbar-button text-[10px] font-mono px-2 py-1 rounded-md disabled:opacity-50"
                                  style={{ color: C.ink }}
                                  onClick={() => {
                                    profile.handleBeginGeneralEdit();
                                    profile.handleAddSourceRootSuggestion(root);
                                  }}
                                  disabled={profile.appSettingsSaving}
                                >
                                  {root}
                                </button>
                              ))}
                            </div>

                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>Context root</div>
                              {profile.isAppSettingsEditing ? (
                                <>
                                  <div className="flex items-center gap-1.5 max-w-md">
                                    <input
                                      value={visibleAppSettings.onboardingContextRoot ?? ''}
                                      onChange={(event) => profile.handleSetOnboardingContextRoot(event.target.value)}
                                      readOnly={profile.appSettingsSaving}
                                      className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                      style={{ borderColor: C.border, color: C.ink }}
                                      placeholder="Choose where .openscout should live"
                                    />
                                    <button
                                      type="button"
                                      className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                      style={{ color: C.ink }}
                                      onClick={profile.handleBrowseForOnboardingContextRoot}
                                      disabled={profile.appSettingsSaving}
                                    >
                                      Finder
                                    </button>
                                  </div>
                                  <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                    Project manifest will be saved here.
                                  </div>
                                </>
                              ) : (
                                <div className="text-[11px] leading-[1.45]" style={settings.styles.inkText}>
                                  {visibleAppSettings.onboardingContextRoot || 'Not set'}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : profile.activeOnboardingStep.id === 'harness' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="flex items-center gap-2">
                                <Key size={14} style={{ color: C.accent }} />
                                <div className="text-[12px] font-medium" style={settings.styles.inkText}>Harness vs runtime</div>
                              </div>
                              <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                The harness is the assistant family (e.g. Claude, Codex). The runtime is the local program that launches it.
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {(['claude', 'codex'] as const).map((harness) => {
                                const runtimeEntry = (visibleAppSettings.runtimeCatalog ?? []).find((entry) => entry.name === harness) ?? null;
                                const selected = visibleAppSettings.defaultHarness === harness;
                                return (
                                  <button
                                    key={harness}
                                    className="text-left rounded-lg border px-3 py-3 transition-opacity hover:opacity-90 disabled:opacity-60"
                                    style={{ borderColor: C.border, backgroundColor: selected ? C.bg : C.surface }}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                    onClick={() => {
                                      profile.setAppSettingsDraft((current) => current ? {
                                        ...current,
                                        defaultHarness: harness,
                                      } : current);
                                      profile.setAppSettingsFeedback(null);
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[12px] font-medium capitalize" style={settings.styles.inkText}>{harness}</div>
                                        <div className="text-[10px] mt-1 leading-[1.5]" style={settings.styles.mutedText}>
                                          {harness === 'claude'
                                            ? 'Use Claude as the default responder for new project agents.'
                                            : 'Use Codex as the default responder for new project agents.'}
                                        </div>
                                        <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                          Runtime: {runtimeEntry?.label ?? harness} · {runtimeEntry?.readinessDetail ?? 'Not reported yet.'}
                                        </div>
                                      </div>
                                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={selected ? settings.styles.activePill : settings.styles.tagBadge}>
                                        {selected ? 'selected' : 'available'}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : profile.activeOnboardingStep.id === 'confirm' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="text-[12px] font-medium" style={settings.styles.inkText}>Confirm this context</div>
                              <div className="text-[10px] mt-1 leading-[1.5]" style={settings.styles.mutedText}>
                                Review your scan folders and context root before continuing.
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                {[
                                  ['Source roots', (visibleAppSettings.workspaceRoots ?? []).join(', ') || 'None yet'],
                                  ['Default harness', visibleAppSettings.defaultHarness ?? 'Not set'],
                                  ['Relay context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                                  ['Operator', visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
                                ].map(([label, value]) => (
                                  <div key={label}>
                                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>{label}</div>
                                    <div className="text-[11px] leading-[1.45]" style={settings.styles.inkText}>{value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 items-center">
                              {!profile.isAppSettingsEditing ? (
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                                  style={{ color: C.ink }}
                                  onClick={profile.handleStartAppSettingsEdit}
                                  disabled={profile.appSettingsLoading || profile.appSettingsSaving}
                                >
                                  Edit Inputs
                                </button>
                              ) : null}
                              <div className="text-[10px] leading-[1.5]" style={settings.styles.mutedText}>
                                {profile.appSettingsDirty
                                  ? 'Next confirms and saves these choices locally.'
                                  : 'Everything here is already saved locally.'}
                              </div>
                            </div>
                          </div>
                        ) : profile.activeOnboardingStep.id === 'setup' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="flex items-center gap-2">
                                <FileJson size={14} style={{ color: C.accent }} />
                                <div className="text-[12px] font-medium" style={settings.styles.inkText}>Create the local project manifest</div>
                              </div>
                              <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                Initialize the project manifest at your context root.
                              </div>
                              <div className="text-[11px] font-mono mt-3 break-all" style={settings.styles.inkText}>
                                {profile.buildOnboardingCommandLine('setup')}
                              </div>
                              <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                Project config path:{' '}
                                {profile.renderLocalPathValue(
                                  visibleAppSettings.currentProjectConfigPath ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : 'Not created yet.'),
                                  { className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity', style: settings.styles.mutedText },
                                )}
                              </div>
                            </div>
                            <button
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                              style={{ color: C.ink }}
                              onClick={() => { void profile.handleRunOnboardingCommand('setup'); }}
                              disabled={Boolean(profile.onboardingCommandPending) || profile.appSettingsLoading || profile.appSettingsDirty}
                            >
                              {profile.onboardingCommandPending === 'setup' ? 'Running Setup…' : 'Run Setup'}
                            </button>
                          </div>
                        ) : profile.activeOnboardingStep.id === 'doctor' ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="flex items-center gap-2">
                                <Shield size={14} style={{ color: C.accent }} />
                                <div className="text-[12px] font-medium" style={settings.styles.inkText}>Review the current inventory</div>
                              </div>
                              <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                Check broker connectivity, source roots, and discovered projects.
                              </div>
                              <div className="grid grid-cols-2 gap-3 mt-3">
                                <div>
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>Projects</div>
                                  <div className="text-[12px] font-medium" style={settings.styles.inkText}>{visibleAppSettings.projectInventory.length}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>Broker</div>
                                  <div className="text-[12px] font-medium" style={settings.styles.inkText}>{visibleAppSettings.broker.reachable ? 'Reachable' : 'Unavailable'}</div>
                                </div>
                              </div>
                              <div className="text-[11px] font-mono mt-3 break-all" style={settings.styles.inkText}>scout doctor</div>
                            </div>
                            <button
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                              style={{ color: C.ink }}
                              onClick={() => { void profile.handleRunOnboardingCommand('doctor'); }}
                              disabled={Boolean(profile.onboardingCommandPending) || profile.appSettingsLoading || !profile.onboardingHasProjectConfig}
                            >
                              {profile.onboardingCommandPending === 'doctor' ? 'Running Doctor…' : 'Run Doctor'}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                              <div className="flex items-center gap-2">
                                <Terminal size={14} style={{ color: C.accent }} />
                                <div className="text-[12px] font-medium" style={settings.styles.inkText}>Check runtime readiness</div>
                              </div>
                              <div className="text-[10px] mt-2 leading-[1.5]" style={settings.styles.mutedText}>
                                Verify each harness runtime is installed and ready.
                              </div>
                              <div className="grid grid-cols-1 gap-2 mt-3">
                                {(visibleAppSettings.runtimeCatalog ?? []).map((runtimeEntry) => (
                                  <div key={runtimeEntry.name} className="rounded-lg border px-3 py-2.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[11px] font-medium" style={settings.styles.inkText}>{runtimeEntry.label}</div>
                                        <div className="text-[10px] mt-1 leading-[1.4]" style={settings.styles.mutedText}>{runtimeEntry.readinessDetail}</div>
                                      </div>
                                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={runtimeEntry.readinessState === 'ready' ? settings.styles.activePill : settings.styles.tagBadge}>
                                        {runtimeEntry.readinessState}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="text-[10px] mt-3 leading-[1.5]" style={settings.styles.mutedText}>
                                Default harness: {visibleAppSettings.defaultHarness}. {profile.onboardingRuntimeMatch ? `${profile.onboardingRuntimeMatch.label} currently reports ${profile.onboardingRuntimeMatch.readinessState}.` : 'No matching runtime is reported yet.'}
                              </div>
                              <div className="text-[11px] font-mono mt-3 break-all" style={settings.styles.inkText}>scout runtimes</div>
                            </div>
                            <button
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                              style={{ color: C.ink }}
                              onClick={() => void profile.handleRunOnboardingCommand('runtimes')}
                              disabled={Boolean(profile.onboardingCommandPending) || profile.appSettingsLoading}
                            >
                              {profile.onboardingCommandPending === 'runtimes' ? 'Running Runtimes…' : 'Run Runtimes'}
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
                          <button
                            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                            style={{ color: C.ink }}
                            onClick={() => profile.moveOnboardingWizard(-1)}
                            disabled={!profile.canGoToPreviousOnboardingStep}
                          >
                            Back
                          </button>
                          <button
                            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                            style={{ color: C.ink }}
                            onClick={profile.handleOnboardingContinue}
                            disabled={!profile.canGoToNextOnboardingStep || profile.appSettingsSaving || profile.appSettingsLoading}
                          >
                            {profile.activeOnboardingStep.id === 'confirm'
                              ? (profile.appSettingsSaving ? 'Confirming…' : 'Confirm')
                              : 'Next'}
                            {profile.activeOnboardingStep.id === 'confirm' ? null : <ChevronRight size={12} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border px-3 py-3 mt-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={settings.styles.mutedText}>CLI Equivalent</div>
                      <div className="space-y-1">
                        {visibleAppSettings.onboarding.commands.map((command) => (
                          <div key={command} className="text-[11px] font-mono break-all" style={settings.styles.inkText}>{command}</div>
                        ))}
                      </div>
                      <div className="text-[10px] mt-3 leading-[1.5]" style={settings.styles.mutedText}>
                        Each wizard step runs the corresponding CLI command above.
                      </div>
                    </div>

                    {profile.appSettingsFeedback ? (
                      <div className="text-[11px] mt-3 leading-[1.5]" style={settings.styles.inkText}>{profile.appSettingsFeedback}</div>
                    ) : null}

                    {profile.onboardingCommandResult ? (
                      <div className="rounded-lg border px-3 py-3 mt-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.styles.mutedText}>Last Command</div>
                            <div className="text-[11px] font-mono break-all" style={settings.styles.inkText}>{profile.onboardingCommandResult.commandLine}</div>
                            <div className="text-[10px] mt-1" style={settings.styles.mutedText}>
                              cwd:{' '}
                              {profile.renderLocalPathValue(profile.onboardingCommandResult.cwd, {
                                className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity',
                                style: settings.styles.mutedText,
                              })}
                            </div>
                          </div>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                            style={profile.onboardingCommandResult.exitCode === 0 ? settings.styles.activePill : settings.styles.tagBadge}
                          >
                            exit {profile.onboardingCommandResult.exitCode}
                          </span>
                        </div>
                        <pre
                          className="mt-3 text-[10px] leading-[1.45] whitespace-pre-wrap break-words overflow-x-auto"
                          style={{ color: C.ink }}
                        >
                          {profile.onboardingCommandResult.output}
                        </pre>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {profile.appSettingsLoading && !visibleAppSettings ? (
                  <div className="text-[11px]" style={settings.styles.mutedText}>Loading settings…</div>
                ) : (
                  <div className="space-y-5">
                    <section className="border rounded-lg overflow-hidden" style={{ ...settings.styles.surface, borderColor: C.border }}>
                      <div className="p-4 border-b" style={{ borderColor: C.border }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Scout CLI</div>
                            <div className="text-[14px] font-medium mt-1" style={settings.styles.inkText}>Use the same commands here and in Terminal</div>
                            <div className="text-[11px] mt-1 leading-[1.6] max-w-2xl" style={settings.styles.mutedText}>
                              General is for local Scout setup. Workspace discovery lives in Workspace Explorer so this screen can stay fast.
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                              style={{ color: C.ink }}
                              onClick={profile.openKnowledgeBase}
                            >
                              <BookOpen size={12} />
                              Knowledge Base
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4">
                        {([
                          {
                            command: 'setup' as const,
                            title: 'scout setup',
                            detail: 'Create or refresh the local project manifest for this context.',
                          },
                          {
                            command: 'doctor' as const,
                            title: 'scout doctor',
                            detail: 'Check broker health, scan roots, and discovery readiness.',
                          },
                          {
                            command: 'runtimes' as const,
                            title: 'scout runtimes',
                            detail: 'Verify Claude and Codex runtimes are installed and ready.',
                          },
                        ]).map((item) => (
                          <article
                            key={item.command}
                            className="rounded-xl border px-4 py-4"
                            style={{ borderColor: C.border, backgroundColor: C.bg }}
                          >
                            <div className="text-[11px] font-mono font-medium" style={{ color: C.accent }}>{item.title}</div>
                            <div className="text-[11px] mt-2 leading-[1.6]" style={settings.styles.mutedText}>{item.detail}</div>
                            <div className="text-[10px] font-mono mt-3 break-all" style={settings.styles.inkText}>
                              {profile.buildOnboardingCommandLine(item.command)}
                            </div>
                            <div className="flex items-center gap-2 mt-4">
                              <button
                                type="button"
                                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                style={{ color: C.ink }}
                                onClick={() => { void profile.handleRunOnboardingCommand(item.command); }}
                                disabled={Boolean(profile.onboardingCommandPending) || profile.appSettingsLoading || profile.appSettingsSaving || (item.command === 'doctor' && profile.appSettingsDirty)}
                              >
                                <Terminal size={12} />
                                Run
                              </button>
                              <button
                                type="button"
                                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                                style={{ color: C.ink }}
                                onClick={() => { void profile.handleCopyOnboardingCommand(item.command); }}
                              >
                                {profile.onboardingCopiedCommand === item.command ? <Check size={12} /> : <Copy size={12} />}
                                Copy
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="border rounded-lg overflow-hidden" style={{ ...settings.styles.surface, borderColor: C.border }}>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="sm:w-1/3">
                            <div className="text-[12px] font-medium" style={settings.styles.inkText}>Display Name</div>
                            <div className="text-[10px] mt-0.5" style={settings.styles.mutedText}>Used across Scout and Relay.</div>
                          </div>
                          <div className="sm:w-2/3">
                            <input
                              ref={profile.settingsOperatorNameRef}
                              value={profile.isAppSettingsEditing ? (visibleAppSettings?.operatorName ?? '') : (visibleAppSettings?.operatorName ?? visibleAppSettings?.operatorNameDefault ?? '')}
                              onChange={(event) => {
                                profile.setAppSettingsDraft((current) => current ? {
                                  ...current,
                                  operatorName: event.target.value,
                                } : current);
                                profile.setAppSettingsFeedback(null);
                              }}
                              readOnly={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                              placeholder={profile.appSettings?.operatorNameDefault ?? 'Operator'}
                              className="w-full max-w-md rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none"
                              style={{ borderColor: C.border, color: C.ink }}
                            />
                          </div>
                        </div>

                        <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="sm:w-1/3">
                            <div className="text-[12px] font-medium" style={settings.styles.inkText}>Default Harness</div>
                            <div className="text-[10px] mt-0.5" style={settings.styles.mutedText}>Fallback assistant family.</div>
                          </div>
                          <div className="sm:w-2/3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(['claude', 'codex'] as const).map((harness) => {
                                const selected = visibleAppSettings?.defaultHarness === harness;
                                const runtime = (visibleAppSettings?.runtimeCatalog ?? []).find((entry) => entry.name === harness);
                                return (
                                  <button
                                    key={harness}
                                    type="button"
                                    className="rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                    style={{ borderColor: selected ? C.accentBorder : C.border, backgroundColor: selected ? C.accentBg : C.bg, color: selected ? C.accent : C.ink }}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                    onClick={() => {
                                      profile.setAppSettingsDraft((current) => current ? {
                                        ...current,
                                        defaultHarness: harness,
                                      } : current);
                                      profile.setAppSettingsFeedback(null);
                                    }}
                                  >
                                    {harness}
                                    {runtime ? (
                                      <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm" style={runtime.readinessState === 'ready' ? settings.styles.activePill : settings.styles.tagBadge}>
                                        {runtime.readinessState}
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                className="rounded-md border border-dashed w-8 h-8 flex items-center justify-center text-[14px] transition-colors disabled:opacity-40"
                                style={{ borderColor: C.border, color: C.muted }}
                                disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                title="Add runtime"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="sm:w-1/3">
                            <div className="text-[12px] font-medium" style={settings.styles.inkText}>Context Root</div>
                            <div className="text-[10px] mt-0.5" style={settings.styles.mutedText}>Where Scout stores workspace config.</div>
                          </div>
                          <div className="sm:w-2/3">
                            <div className="flex items-center gap-1.5 max-w-md mb-2">
                              <input
                                value={visibleAppSettings?.onboardingContextRoot ?? ''}
                                onChange={(event) => profile.handleSetOnboardingContextRoot(event.target.value)}
                                readOnly={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                style={{ borderColor: C.border, color: C.ink }}
                                placeholder="Choose where .openscout should live"
                              />
                              <button
                                type="button"
                                className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                style={{ color: C.ink }}
                                onClick={profile.handleBrowseForOnboardingContextRoot}
                                disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                              >
                                Finder
                              </button>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={visibleAppSettings?.includeCurrentRepo ?? true}
                                  disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                  onChange={(event) => {
                                    profile.setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      includeCurrentRepo: event.target.checked,
                                    } : current);
                                    profile.setAppSettingsFeedback(null);
                                  }}
                                />
                                <span className="text-[10px]" style={settings.styles.inkText}>Include root in discovery</span>
                              </label>
                              {visibleAppSettings?.currentProjectConfigPath ? (
                                <>
                                  <div className="hidden sm:block w-px h-3" style={{ backgroundColor: C.border }} />
                                  <span className="text-[9px] font-mono truncate" style={settings.styles.mutedText} title={visibleAppSettings.currentProjectConfigPath}>
                                    {profile.renderLocalPathValue(visibleAppSettings.currentProjectConfigPath, {
                                      compact: true,
                                      className: 'text-left hover:opacity-80 transition-opacity',
                                      style: settings.styles.mutedText,
                                    })}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="sm:w-1/3">
                            <div className="text-[12px] font-medium" style={settings.styles.inkText}>Scan Folders</div>
                            <div className="text-[10px] mt-0.5" style={settings.styles.mutedText}>Parent directories for repos.</div>
                          </div>
                          <div className="sm:w-2/3">
                            <div className="space-y-1.5">
                              {(visibleAppSettings?.workspaceRoots ?? []).map((root, index) => (
                                <div key={`general-source-root-${index}`} className="flex items-center gap-1.5 max-w-md">
                                  <input
                                    value={root}
                                    onChange={(event) => profile.handleSetSourceRootAt(index, event.target.value)}
                                    readOnly={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                    className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                    style={{ borderColor: C.border, color: C.ink }}
                                    placeholder={index === 0 ? '~/dev' : 'Add another path'}
                                  />
                                  <button
                                    type="button"
                                    className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                    style={{ color: C.ink }}
                                    onClick={() => profile.handleBrowseForSourceRoot(index)}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving}
                                  >
                                    Finder
                                  </button>
                                  <button
                                    type="button"
                                    className="os-toolbar-button text-[12px] font-medium w-7 h-7 rounded-md disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => profile.handleRemoveSourceRootRow(index)}
                                    disabled={!profile.isAppSettingsEditing || profile.appSettingsSaving || ((visibleAppSettings?.workspaceRoots ?? []).length <= 1 && !root)}
                                    aria-label={`Remove project path ${index + 1}`}
                                  >
                                    -
                                  </button>
                                </div>
                              ))}
                              {(visibleAppSettings?.workspaceRoots?.length ?? 0) === 0 ? (
                                <div className="rounded-md border border-dashed px-2.5 py-2.5 text-[11px] leading-[1.5] max-w-md" style={{ borderColor: C.border, color: C.muted }}>
                                  No scan folders configured. Add one to discover projects.
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <button
                                type="button"
                                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                style={{ color: C.ink }}
                                onClick={() => {
                                  profile.handleBeginGeneralEdit();
                                  profile.handleAddSourceRootRow();
                                }}
                                disabled={profile.appSettingsSaving}
                              >
                                <span className="text-[12px] leading-none">+</span>
                                Add path
                              </button>
                              <span className="text-[10px]" style={settings.styles.mutedText}>or</span>
                              {profile.sourceRootPathSuggestions.map((root) => (
                                <button
                                  key={root}
                                  type="button"
                                  className="os-toolbar-button text-[10px] font-mono px-2 py-1 rounded-md disabled:opacity-50"
                                  style={{ color: C.ink }}
                                  onClick={() => {
                                    profile.handleBeginGeneralEdit();
                                    profile.handleAddSourceRootSuggestion(root);
                                  }}
                                  disabled={profile.appSettingsSaving}
                                >
                                  {root}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    {profile.appSettingsFeedback ? (
                      <div className="text-[11px] leading-[1.5]" style={settings.styles.inkText}>{profile.appSettingsFeedback}</div>
                    ) : null}

                    {profile.onboardingCommandResult?.command === 'doctor' ? (
                      <div className="space-y-2">
                        <div className="text-[9px] font-mono uppercase tracking-widest" style={settings.styles.mutedText}>Doctor Output</div>
                        {profile.renderOnboardingCommandShell('doctor', profile.buildOnboardingCommandLine('doctor'), profile.onboardingCommandPending === 'doctor')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : settings.settingsSection === 'agents' ? (
            <AgentSettingsView {...settings.agentSettingsViewProps} />
          ) : settings.settingsSection === 'workspaces' ? (
            <WorkspaceExplorerView {...settings.workspaceExplorerViewProps} />
          ) : settings.settingsSection === 'communication' ? (
            <CommunicationSettingsView {...settings.communicationSettingsViewProps} />
          ) : settings.settingsSection === 'database' ? (
            <div className="space-y-4">
              <section className="border rounded-xl p-5" style={{ ...settings.database.styles.surface, borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Session Index</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Sessions', `${settings.database.stats.totalSessions}`],
                    ['Messages', `${settings.database.stats.totalMessages}`],
                    ['Projects', `${settings.database.stats.projects}`],
                    ['Tokens', `${Math.round(settings.database.stats.totalTokens / 1000)}k`],
                    ['Runtime Messages', `${settings.database.runtime?.messageCount ?? 0}`],
                    ['tmux Sessions', `${settings.database.runtime?.tmuxSessionCount ?? 0}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border px-3 py-2.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.database.styles.mutedText}>{label}</div>
                      <div className="text-[16px] font-semibold" style={settings.database.styles.inkText}>{value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border rounded-xl p-5" style={{ ...settings.database.styles.surface, borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Storage</div>
                <div className="space-y-3">
                  {settings.database.visibleAppSettings?.controlPlaneSqlitePath ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium" style={settings.database.styles.inkText}>Control plane database</div>
                        <div className="text-[11px] font-mono mt-1 truncate" style={settings.database.styles.mutedText}>
                          {settings.database.renderLocalPathValue(settings.database.visibleAppSettings.controlPlaneSqlitePath, {
                            className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                            style: settings.database.styles.mutedText,
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                        style={{ color: C.ink, borderColor: C.border }}
                        onClick={() => settings.database.onRevealPath(settings.database.visibleAppSettings!.controlPlaneSqlitePath!)}
                      >
                        Reveal in Finder
                      </button>
                    </div>
                  ) : null}
                  {settings.database.visibleAppSettings?.settingsPath ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium" style={settings.database.styles.inkText}>Settings</div>
                        <div className="text-[11px] font-mono mt-1 truncate" style={settings.database.styles.mutedText}>
                          {settings.database.renderLocalPathValue(settings.database.visibleAppSettings.settingsPath, {
                            className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                            style: settings.database.styles.mutedText,
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                        style={{ color: C.ink, borderColor: C.border }}
                        onClick={() => settings.database.onRevealPath(settings.database.visibleAppSettings!.settingsPath!)}
                      >
                        Reveal in Finder
                      </button>
                    </div>
                  ) : null}
                  {settings.database.visibleAppSettings?.supportDirectory ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium" style={settings.database.styles.inkText}>Support directory</div>
                        <div className="text-[11px] font-mono mt-1 truncate" style={settings.database.styles.mutedText}>
                          {settings.database.renderLocalPathValue(settings.database.visibleAppSettings.supportDirectory, {
                            className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                            style: settings.database.styles.mutedText,
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                        style={{ color: C.ink, borderColor: C.border }}
                        onClick={() => settings.database.onRevealPath(settings.database.visibleAppSettings!.supportDirectory!)}
                      >
                        Reveal in Finder
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(320px,0.85fr)] gap-4">
              <section className="border rounded-xl p-5" style={{ ...settings.appearance.styles.surface, borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Color Mode</div>
                <div className="flex gap-3 mb-5">
                  {[
                    { id: 'light', label: 'Light' },
                    { id: 'dark', label: 'Dark' },
                  ].map((mode) => {
                    const active = mode.id === (settings.appearance.dark ? 'dark' : 'light');
                    return (
                      <button
                        key={mode.id}
                        onClick={() => settings.appearance.setDark(mode.id === 'dark')}
                        className="flex-1 border rounded-xl px-4 py-4 text-left"
                        style={{
                          borderColor: active ? C.accent : C.border,
                          backgroundColor: active ? C.bg : C.surface,
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1" style={{ color: active ? C.accent : C.muted }}>
                          {mode.id === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                          <span className="text-[12px] font-medium" style={active ? { color: C.accent } : settings.appearance.styles.inkText}>{mode.label}</span>
                        </div>
                        <div className="text-[11px] leading-[1.5]" style={settings.appearance.styles.mutedText}>
                          {mode.id === 'dark' ? 'Deep shell contrast for low-light work.' : 'Warm neutral shell with higher paper-like contrast.'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="border rounded-xl px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>Annotations</div>
                      <div className="text-[12px] leading-[1.6]" style={settings.appearance.styles.mutedText}>
                        Show routing and provenance tags in timelines.
                      </div>
                    </div>
                    <button
                      onClick={() => settings.appearance.setShowAnnotations((current) => !current)}
                      className="os-toolbar-button text-[11px] font-medium px-2 py-1 rounded"
                      style={{ color: C.ink }}
                    >
                      {settings.appearance.showAnnotations ? 'Hide annotations' : 'Show annotations'}
                    </button>
                  </div>
                </div>
              </section>

              <div className="space-y-4 min-w-0">
                <section className="border rounded-xl p-5" style={{ ...settings.appearance.styles.surface, borderColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Current Surface</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {[
                      ['Mode', settings.appearance.dark ? 'Dark' : 'Light'],
                      ['Annotations', settings.appearance.showAnnotations ? 'Visible' : 'Hidden'],
                      ['Sidebar', settings.appearance.isCollapsed ? 'Collapsed' : 'Expanded'],
                      ['Section', settings.appearance.activeSettingsLabel],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={settings.appearance.styles.mutedText}>{label}</div>
                        <div className="text-[12px]" style={settings.appearance.styles.inkText}>{value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border rounded-xl p-5" style={{ ...settings.appearance.styles.surface, borderColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Coming Soon</div>
                  <div className="text-[12px] leading-[1.6]" style={settings.appearance.styles.mutedText}>
                    Theme, density, and typography controls.
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
