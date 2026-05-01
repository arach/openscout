import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "../lib/router.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import {
  extractRangerUiActions,
  isRangerActorId,
  rangerConversationId,
  resolveRangerAgentId,
  type RangerUiAction,
} from "../lib/ranger.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { SettingsDrawer } from "../screens/SettingsDrawer.tsx";
import type { Agent, Route } from "../lib/types.ts";
import type { ScoutTheme } from "../lib/theme.ts";

declare global {
  interface Window {
    scoutRanger?: {
      applyUiAction: (action: RangerUiAction) => void;
      navigate: (route: Route) => void;
    };
  }
}

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
  onlineCount: number;

  reload: () => Promise<void>;

  onboarding: OnboardingState | null;
  refreshOnboarding: () => Promise<void>;
  onboardingSkipped: boolean;
  skipOnboarding: () => void;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  rangerAgentId: string;
  rangerConversationId: string;
  applyRangerUiAction: (action: RangerUiAction) => void;
}

const ScoutContext = createContext<ScoutContextValue | null>(null);

const AGENT_REFRESH_EVENT_KINDS = [
  "hello",
  "node.upserted",
  "actor.registered",
  "agent.registered",
  "agent.endpoint.upserted",
  "invocation.requested",
  "flight.updated",
  "delivery.state.changed",
  "scout.dispatched",
] as const;
const AGENT_REFRESH_EVENT_KIND_SET = new Set<string>(AGENT_REFRESH_EVENT_KINDS);

type ThemeVars = CSSProperties & Record<`--${string}`, string>;

const DARK_THEME_VARS: ThemeVars = {
  "--hud-bg": "oklch(0.14 0.008 80)",
  "--hud-surface": "oklch(0.18 0.009 80)",
  "--hud-ink": "oklch(0.96 0.008 80)",
  "--hud-muted": "oklch(0.72 0.012 80)",
  "--hud-dim": "oklch(0.58 0.012 80)",
  "--hud-border": "oklch(0.96 0.008 80 / 0.035)",
  "--hud-accent": "oklch(0.86 0.17 125)",
  "--hud-accent-soft": "oklch(0.86 0.17 125 / 0.08)",
  "--hud-shadow-soft": "oklch(0.10 0.006 75 / 0.4)",
  "--hud-chrome-border": "oklch(0.96 0.008 80 / 0.016)",
  "--hud-shadow-panel": "0 12px 34px oklch(0.08 0.006 75 / 0.45)",
  "--hud-shadow-panel-hover": "0 14px 38px oklch(0.08 0.006 75 / 0.52)",
  "--hud-shadow-bar": "0 -10px 28px oklch(0.08 0.006 75 / 0.38)",
  "--hud-shadow-nav": "0 8px 24px oklch(0.08 0.006 75 / 0.32)",
  "--hud-shadow-minimap": "0 10px 24px oklch(0.08 0.006 75 / 0.38)",
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
  "--scout-chrome-border-soft": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-avatar-ink": "#111111",
  "--hud-font-sans": "'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif",
  "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--hud-font-serif": "'Instrument Serif', 'Spectral', Georgia, serif",
};

const LIGHT_THEME_VARS: ThemeVars = {
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
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const skipOnboarding = useCallback(() => setOnboardingSkipped(true), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const themeVars = initialTheme === "light" ? LIGHT_THEME_VARS : DARK_THEME_VARS;
  const rangerAgentId = useMemo(() => resolveRangerAgentId(agents), [agents]);
  const rangerDmConversationId = useMemo(() => rangerConversationId(rangerAgentId), [rangerAgentId]);

  const reload = useCallback(async () => {
    const agentsResult = await api<Agent[]>("/api/agents").catch(() => null);
    if (agentsResult) {
      setAgents(agentsResult);
    }
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

  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const applyRangerUiAction = useCallback((action: RangerUiAction) => {
    switch (action.type) {
      case "navigate":
        navigate(action.route);
        break;
      case "open-ranger":
        navigate({
          view: "conversation",
          conversationId: rangerDmConversationId,
          ...(action.mode === "ask" ? { composeMode: "ask" } : {}),
        });
        break;
      case "refresh":
        void reload();
        break;
    }
  }, [navigate, rangerDmConversationId, reload]);

  const rangerBridgeRef = useRef({
    rangerAgentId,
    applyRangerUiAction,
  });
  rangerBridgeRef.current = { rangerAgentId, applyRangerUiAction };

  useBrokerEvents((event) => {
    if (AGENT_REFRESH_EVENT_KIND_SET.has(event.kind)) {
      void reload();
    }

    const message = event.kind === "message.posted" && event.payload && typeof event.payload === "object"
      ? (event.payload as { message?: unknown }).message
      : null;
    if (!message || typeof message !== "object") {
      return;
    }

    const record = message as { actorId?: unknown; body?: unknown };
    const actorId = typeof record.actorId === "string" ? record.actorId : "";
    const body = typeof record.body === "string" ? record.body : "";
    if (!actorId || !body || !isRangerActorId(actorId, rangerBridgeRef.current.rangerAgentId)) {
      return;
    }

    for (const action of extractRangerUiActions(body)) {
      rangerBridgeRef.current.applyRangerUiAction(action);
    }
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const action = detail && typeof detail === "object" && "type" in detail
        ? detail as RangerUiAction
        : null;
      if (action) {
        rangerBridgeRef.current.applyRangerUiAction(action);
      }
    };
    window.addEventListener("scout:ranger-ui-action", handler);
    window.scoutRanger = {
      applyUiAction: (action: RangerUiAction) => rangerBridgeRef.current.applyRangerUiAction(action),
      navigate: (route: Route) => rangerBridgeRef.current.applyRangerUiAction({ type: "navigate", route }),
    };
    return () => {
      window.removeEventListener("scout:ranger-ui-action", handler);
      if (window.scoutRanger?.applyUiAction) {
        delete window.scoutRanger;
      }
    };
  }, []);

  const value = useMemo<ScoutContextValue>(
    () => ({
      route, navigate, agents, onlineCount, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
      rangerAgentId, rangerConversationId: rangerDmConversationId, applyRangerUiAction,
    }),
    [
      route, navigate, agents, onlineCount, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
      rangerAgentId, rangerDmConversationId, applyRangerUiAction,
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
