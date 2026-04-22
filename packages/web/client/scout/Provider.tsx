import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "../lib/router.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { SettingsDrawer } from "../screens/SettingsDrawer.tsx";
import type { Agent, Message, Route } from "../lib/types.ts";

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

export function useScout() {
  const ctx = useContext(ScoutContext);
  if (!ctx) throw new Error("useScout must be used inside ScoutProvider");
  return ctx;
}

export function ScoutProvider({ children }: { children: ReactNode }) {
  const { route, navigate } = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const skipOnboarding = useCallback(() => setOnboardingSkipped(true), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

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
        data-scout-theme
        style={{
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
          "--hud-font-sans": "'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif",
          "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
          "--hud-font-serif": "'Instrument Serif', 'Spectral', Georgia, serif",
        } as React.CSSProperties}
      >
        <ContextMenuProvider>
          {children}
          <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
        </ContextMenuProvider>
      </div>
    </ScoutContext.Provider>
  );
}
