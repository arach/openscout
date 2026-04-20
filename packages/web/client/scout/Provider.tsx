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
    }),
    [
      route, navigate, agents, messages, onlineCount, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
    ],
  );

  return (
    <ScoutContext.Provider value={value}>
      {/* data-scout-theme is the scope where Scout's --bg/--ink/--accent/etc.
       * aliases resolve (see app.css). Content inherits Hudson's dark --hud-*
       * defaults to align with chrome; we override only the font stacks to
       * match the web fonts Scout loads in index.html. */}
      <div
        data-scout-theme
        style={{
          "--hud-font-sans": "'Inter', ui-sans-serif, system-ui, sans-serif",
          "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
          "--hud-font-serif": "'Spectral', Georgia, serif",
        } as React.CSSProperties}
      >
        <ContextMenuProvider>
          {children}
        </ContextMenuProvider>
      </div>
    </ScoutContext.Provider>
  );
}
