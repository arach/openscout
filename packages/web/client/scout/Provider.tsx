import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "../lib/router.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { SettingsDrawer } from "../screens/SettingsDrawer.tsx";
import type { Agent, Message, Route } from "../lib/types.ts";
import type { ScoutTheme } from "../lib/theme.ts";

export interface OnboardingState {
  hasLocalConfig: boolean;
  hasProjectConfig: boolean;
  hasOperatorName: boolean;
  localConfigPath: string | null;
  projectRoot: string | null;
  currentDirectory: string | null;
  operatorName: string | null;
  operatorNameSuggestion: string | null;
}

export interface ScoutContextValue {
  route: Route;
  navigate: (r: Route) => void;

  agents: Agent[];
  messages: Message[];
  onlineCount: number;

  reload: () => Promise<void>;

  onboarding: OnboardingState | null;
  refreshOnboarding: () => Promise<void>;
  onboardingSkipped: boolean;
  skipOnboarding: () => void;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

const ScoutContext = createContext<ScoutContextValue | null>(null);

const DARK_THEME_VARS: CSSProperties = {
  "--hud-bg": "oklch(0.14 0.008 80)",
  "--hud-surface": "oklch(0.18 0.009 80)",
  "--hud-ink": "oklch(0.96 0.008 80)",
  "--hud-muted": "oklch(0.72 0.012 80)",
  "--hud-dim": "oklch(0.58 0.012 80)",
  "--hud-border": "oklch(0.23 0.010 80 / 0.8)",
  "--hud-accent": "oklch(0.86 0.17 125)",
  "--hud-accent-soft": "oklch(0.86 0.17 125 / 0.08)",
  "--hud-shadow-soft": "oklch(0.10 0.006 75 / 0.4)",
  "--hud-status-ok": "oklch(0.80 0.15 155)",
  "--hud-status-warn": "oklch(0.82 0.15 85)",
  "--hud-status-error": "oklch(0.72 0.18 25)",
  "--scout-chrome-ink-strong": "color-mix(in srgb, var(--hud-ink) 92%, transparent)",
  "--scout-chrome-ink": "color-mix(in srgb, var(--hud-ink) 78%, transparent)",
  "--scout-chrome-ink-soft": "color-mix(in srgb, var(--hud-ink) 58%, transparent)",
  "--scout-chrome-ink-faint": "color-mix(in srgb, var(--hud-ink) 38%, transparent)",
  "--scout-chrome-ink-ghost": "color-mix(in srgb, var(--hud-ink) 22%, transparent)",
  "--scout-chrome-hover": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-active": "color-mix(in srgb, var(--hud-ink) 8%, transparent)",
  "--scout-chrome-border-soft": "color-mix(in srgb, var(--hud-border) 55%, transparent)",
  "--scout-chrome-avatar-ink": "#111111",
  "--hud-font-sans": "'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif",
  "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--hud-font-serif": "'Instrument Serif', 'Spectral', Georgia, serif",
};

const LIGHT_THEME_VARS: CSSProperties = {
  "--hud-bg": "oklch(0.978 0.004 85)",
  "--hud-surface": "oklch(0.992 0.003 85)",
  "--hud-ink": "oklch(0.24 0.01 80)",
  "--hud-muted": "oklch(0.56 0.014 80)",
  "--hud-dim": "oklch(0.72 0.01 80)",
  "--hud-border": "oklch(0.88 0.008 82 / 0.95)",
  "--hud-accent": "oklch(0.72 0.16 125)",
  "--hud-accent-soft": "oklch(0.72 0.16 125 / 0.11)",
  "--hud-shadow-soft": "oklch(0.42 0.01 80 / 0.12)",
  "--hud-status-ok": "oklch(0.64 0.16 155)",
  "--hud-status-warn": "oklch(0.72 0.15 85)",
  "--hud-status-error": "oklch(0.62 0.19 25)",
  "--scout-chrome-ink-strong": "color-mix(in srgb, var(--hud-ink) 94%, transparent)",
  "--scout-chrome-ink": "color-mix(in srgb, var(--hud-ink) 78%, transparent)",
  "--scout-chrome-ink-soft": "color-mix(in srgb, var(--hud-ink) 60%, transparent)",
  "--scout-chrome-ink-faint": "color-mix(in srgb, var(--hud-ink) 40%, transparent)",
  "--scout-chrome-ink-ghost": "color-mix(in srgb, var(--hud-ink) 24%, transparent)",
  "--scout-chrome-hover": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-active": "color-mix(in srgb, var(--hud-ink) 8%, transparent)",
  "--scout-chrome-border-soft": "color-mix(in srgb, var(--hud-border) 80%, transparent)",
  "--scout-chrome-avatar-ink": "#ffffff",
  "--hud-font-sans": "'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif",
  "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--hud-font-serif": "'Instrument Serif', 'Spectral', Georgia, serif",
};

export function useScout() {
  const ctx = useContext(ScoutContext);
  if (!ctx) throw new Error("useScout must be used inside ScoutProvider");
  return ctx;
}

export function ScoutProvider({
  children,
  initialTheme = "dark",
}: {
  children: ReactNode;
  initialTheme?: ScoutTheme;
}) {
  const { route, navigate } = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const skipOnboarding = useCallback(() => setOnboardingSkipped(true), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const themeVars = initialTheme === "light" ? LIGHT_THEME_VARS : DARK_THEME_VARS;

  const reload = useCallback(async () => {
    const [agentsResult, messagesResult] = await Promise.allSettled([
      api<Agent[]>("/api/agents"),
      api<Message[]>("/api/messages"),
    ]);
    if (agentsResult.status === "fulfilled") setAgents(agentsResult.value);
    if (messagesResult.status === "fulfilled") setMessages(messagesResult.value);
  }, []);

  const refreshOnboarding = useCallback(async () => {
    try {
      const state = await api<OnboardingState>("/api/onboarding/state");
      setOnboarding(state);
    } catch {
      setOnboarding({
        hasLocalConfig: true,
        hasProjectConfig: true,
        hasOperatorName: true,
        localConfigPath: null,
        projectRoot: null,
        currentDirectory: null,
        operatorName: null,
        operatorNameSuggestion: null,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshOnboarding();
  }, [reload, refreshOnboarding]);
  useBrokerEvents(reload);

  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const value = useMemo<ScoutContextValue>(
    () => ({
      route, navigate, agents, messages, onlineCount, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
    }),
    [
      route, navigate, agents, messages, onlineCount, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
    ],
  );

  return (
    <ScoutContext.Provider value={value}>
      <div
        data-scout-theme={initialTheme}
        data-scout-theme-mode={initialTheme}
        style={{
          ...themeVars,
        }}
      >
        <ContextMenuProvider>
          {children}
          <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
        </ContextMenuProvider>
      </div>
    </ScoutContext.Provider>
  );
}
