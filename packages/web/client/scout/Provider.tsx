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
import {
  isSettingsHistoryEntry,
  useBrowserLocation,
  useRouter,
  type NavigateOptions,
} from "../lib/router.ts";
import { api } from "../lib/api.ts";
import { friendlyApiError } from "../lib/api-errors.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import {
  resolveScoutbotAgent,
  resolveScoutbotAgentId,
  type ScoutbotUiAction,
} from "../lib/scoutbot.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { FilePreviewOverlay } from "./FilePreviewOverlay.tsx";
import { ScoutbotStateProvider } from "./scoutbot/ScoutbotStateContext.tsx";
import { SettingsDrawer } from "../screens/settings/SettingsDrawer.tsx";
import { ContextCaptureHost } from "./ContextCaptureHost.tsx";
import type { Agent, BrokerRouteAttempt, Route } from "../lib/types.ts";
import type { ScoutTheme } from "../lib/theme.ts";
import { resolveScoutNativeThemeVars } from "../lib/theme.ts";
import type { KnowledgeHit } from "../lib/knowledge-search.ts";
import type { FocusedSession } from "../lib/session-catalog.ts";

declare global {
  interface Window {
    scoutScoutbot?: {
      applyUiAction: (action: ScoutbotUiAction) => void;
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
  projectConfigPath?: string | null;
  currentDirectory: string | null;
  contextRoot?: string | null;
  sourceRoots?: string[];
  defaultHarness?: string;
  operatorName: string | null;
  operatorNameSuggestion: string | null;
  brokerReachable?: boolean;
  hasReadyRuntime?: boolean;
  skippedAt?: number | null;
  completedAt?: number | null;
  needed?: boolean;
}

export interface ScoutContextValue {
  route: Route;
  navigate: (r: Route, options?: NavigateOptions) => void;

  agents: Agent[];
  onlineCount: number;
  apiConnection: ApiConnectionState;

  reload: () => Promise<void>;

  onboarding: OnboardingState | null;
  refreshOnboarding: () => Promise<void>;
  onboardingSkipped: boolean;
  skipOnboarding: () => void;

  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  scoutbotAgentId: string;
  scoutbotConversationId: string | null;
  applyScoutbotUiAction: (action: ScoutbotUiAction) => void;

  selectedBrokerAttempt: BrokerRouteAttempt | null;
  inspectBrokerAttempt: (attempt: BrokerRouteAttempt) => void;
  clearBrokerAttempt: () => void;

  selectedKnowledgeHit: KnowledgeHit | null;
  selectedKnowledgeQuery: string;
  inspectKnowledgeHit: (hit: KnowledgeHit, query?: string) => void;
  clearKnowledgeHit: () => void;

  // The agent-profile session the center is exploring; the rail follows it so
  // its session info + secondary actions track the center's selection.
  focusedSession: FocusedSession | null;
  focusSession: (agentId: string, sessionId: string) => void;

  openFilePreview: (path: string) => void;
  closeFilePreview: () => void;

  openContextCapture: (request?: ContextCaptureRequest) => void;
  closeContextCapture: () => void;
}

export type ContextCaptureRequest = {
  agentId?: string;
  conversationId?: string;
  message?: string;
  files?: File[];
  attachmentFeedback?: string;
  preferExistingChat?: boolean;
};

export type ApiConnectionState = {
  status: "checking" | "online" | "offline";
  message: string | null;
  lastCheckedAt: number | null;
};

// Exported so the design-sync preview provider (client/_ds/) can supply a mock
// ScoutContext to context-coupled components (e.g. AgentsLibrary) without the
// full ScoutProvider chrome. No behavior change for the app.
export const ScoutContext = createContext<ScoutContextValue | null>(null);

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
const AGENT_REFRESH_POLL_MS = 15_000;

type ThemeVars = CSSProperties & Record<`--${string}`, string>;

function keepPreviousIfJsonEqual<T>(previous: T, next: T): T {
  try {
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
  } catch {
    return next;
  }
}

// Exported for the design-sync lightweight preview provider (client/_ds/) — it
// reuses these vars so cards render on the real dark theme. No behavior change.
export const DARK_THEME_VARS: ThemeVars = {
  "--hud-bg": "oklch(0.132 0.004 260)",
  "--hud-surface": "oklch(0.178 0.005 260)",
  "--hud-ink": "oklch(0.965 0.006 260)",
  "--hud-muted": "oklch(0.72 0.008 260)",
  "--hud-dim": "oklch(0.57 0.007 260)",
  "--hud-border": "oklch(0.965 0.006 260 / 0.04)",
  "--hud-accent": "oklch(0.86 0.17 125)",
  "--hud-accent-soft": "oklch(0.86 0.17 125 / 0.08)",
  "--hud-shadow-soft": "oklch(0.08 0.004 260 / 0.42)",
  "--hud-chrome-border": "oklch(0.965 0.006 260 / 0.012)",
  "--hud-shadow-panel": "0 12px 34px oklch(0.08 0.004 260 / 0.45)",
  "--hud-shadow-panel-hover": "0 14px 38px oklch(0.08 0.004 260 / 0.52)",
  "--hud-shadow-bar": "0 -10px 28px oklch(0.08 0.004 260 / 0.38)",
  "--hud-shadow-nav": "0 8px 24px oklch(0.08 0.004 260 / 0.32)",
  "--hud-shadow-minimap": "0 10px 24px oklch(0.08 0.004 260 / 0.38)",
  "--hud-status-ok": "oklch(0.80 0.15 155)",
  "--hud-status-warn": "oklch(0.82 0.15 85)",
  "--hud-status-error": "oklch(0.72 0.18 25)",
  // Scout semantic colors (web-only; no HudsonKit equivalent).
  "--scrim": "rgba(0, 0, 0, 0.5)",
  "--scrim-soft": "rgba(0, 0, 0, 0.3)",
  "--info": "#62b6ff",
  "--shadow-card": "0 8px 22px rgba(0, 0, 0, 0.22)",
  "--shadow-card-hover": "0 14px 36px rgba(0, 0, 0, 0.30)",
  // Categorical / brand accents — distinct from status colors, do not flatten.
  "--cat-gold": "#d7a978",
  "--cat-purple": "#c58cff",
  "--cat-sky": "#38bdf8",
  "--scout-chrome-ink-strong": "color-mix(in srgb, var(--hud-ink) 92%, transparent)",
  "--scout-chrome-ink": "color-mix(in srgb, var(--hud-ink) 78%, transparent)",
  "--scout-chrome-ink-soft": "color-mix(in srgb, var(--hud-ink) 58%, transparent)",
  "--scout-chrome-ink-faint": "color-mix(in srgb, var(--hud-ink) 38%, transparent)",
  "--scout-chrome-ink-ghost": "color-mix(in srgb, var(--hud-ink) 22%, transparent)",
  "--scout-chrome-hover": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-active": "color-mix(in srgb, var(--hud-ink) 8%, transparent)",
  "--scout-chrome-border-soft": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-avatar-ink": "#111111",
  "--hud-font-sans": "'Inter', ui-sans-serif, system-ui, sans-serif",
  "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--hud-font-serif": "'Spectral', 'Cormorant Garamond', Georgia, serif",
  "--hud-font-accent-title": "'Inter Tight', var(--hud-font-sans)",
};

export const LIGHT_THEME_VARS: ThemeVars = {
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
  // Scout semantic colors (web-only; no HudsonKit equivalent).
  "--scrim": "rgba(20, 22, 26, 0.32)",
  "--scrim-soft": "rgba(20, 22, 26, 0.18)",
  "--info": "#2f7fd6",
  "--shadow-card": "0 8px 22px oklch(0.42 0.01 80 / 0.10)",
  "--shadow-card-hover": "0 14px 36px oklch(0.42 0.01 80 / 0.14)",
  // Categorical / brand accents — distinct from status colors, do not flatten.
  "--cat-gold": "#a9824f",
  "--cat-purple": "#8b5cf6",
  "--cat-sky": "#0ea5e9",
  "--scout-chrome-ink-strong": "color-mix(in srgb, var(--hud-ink) 94%, transparent)",
  "--scout-chrome-ink": "color-mix(in srgb, var(--hud-ink) 78%, transparent)",
  "--scout-chrome-ink-soft": "color-mix(in srgb, var(--hud-ink) 60%, transparent)",
  "--scout-chrome-ink-faint": "color-mix(in srgb, var(--hud-ink) 40%, transparent)",
  "--scout-chrome-ink-ghost": "color-mix(in srgb, var(--hud-ink) 24%, transparent)",
  "--scout-chrome-hover": "color-mix(in srgb, var(--hud-ink) 4%, transparent)",
  "--scout-chrome-active": "color-mix(in srgb, var(--hud-ink) 8%, transparent)",
  "--scout-chrome-border-soft": "color-mix(in srgb, var(--hud-border) 80%, transparent)",
  "--scout-chrome-avatar-ink": "#ffffff",
  "--hud-font-sans": "'Inter', ui-sans-serif, system-ui, sans-serif",
  "--hud-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--hud-font-serif": "'Spectral', 'Cormorant Garamond', Georgia, serif",
  "--hud-font-accent-title": "'Inter Tight', var(--hud-font-sans)",
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
  const locationState = useBrowserLocation().state;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiConnection, setApiConnection] = useState<ApiConnectionState>({
    status: "checking",
    message: null,
    lastCheckedAt: null,
  });
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  // Selection objects are cached for immediate inspector payload; the URL is
  // the durable source of truth for attempt/hit/session ids (SCO-082 Phase B).
  const [brokerAttemptCache, setBrokerAttemptCache] = useState<BrokerRouteAttempt | null>(null);
  const [knowledgeHitCache, setKnowledgeHitCache] = useState<KnowledgeHit | null>(null);
  const [selectedKnowledgeQuery, setSelectedKnowledgeQuery] = useState("");
  const [contextCaptureRequest, setContextCaptureRequest] = useState<ContextCaptureRequest | null>(null);

  const settingsOpen = route.view === "settings"
    && route.section !== "agents"
    && route.section !== "pairing"
    && route.section !== undefined;

  const selectedBrokerAttempt = useMemo(() => {
    if (route.view !== "broker" || !route.attemptId) return null;
    if (brokerAttemptCache?.id === route.attemptId) return brokerAttemptCache;
    // Deep-link stub until the diagnostics feed resolves the full attempt.
    return { id: route.attemptId } as BrokerRouteAttempt;
  }, [brokerAttemptCache, route]);

  const selectedKnowledgeHit = useMemo(() => {
    if (route.view !== "search" || !route.hitId) return null;
    if (knowledgeHitCache?.id === route.hitId) return knowledgeHitCache;
    return null;
  }, [knowledgeHitCache, route]);

  // Session selection is routed sessionId only — no parallel memory fallback.
  const focusedSession = useMemo<FocusedSession | null>(() => {
    if (route.view === "agents-v2" && route.agentId && route.sessionId) {
      return { agentId: route.agentId, sessionId: route.sessionId };
    }
    if (route.view === "sessions" && route.sessionId) {
      return {
        agentId: route.agentId ?? "",
        sessionId: route.sessionId,
      };
    }
    return null;
  }, [route]);

  const focusSession = useCallback((agentId: string, sessionId: string) => {
    if (route.view === "agents-v2" && route.agentId === agentId) {
      navigate({ ...route, sessionId }, { replace: true });
      return;
    }
    if (route.view === "sessions") {
      navigate({ view: "sessions", sessionId, agentId }, { replace: true });
      return;
    }
    navigate({ view: "agents-v2", agentId, sessionId }, { replace: true });
  }, [navigate, route]);

  const openSettings = useCallback(() => {
    navigate(
      { view: "settings", section: "operator" },
      // Mark the pushed entry so closeSettings can restore the user's place
      // via history.back() instead of dumping them on Home.
      { state: { settingsEntry: true } },
    );
  }, [navigate]);
  const closeSettings = useCallback(() => {
    if (route.view !== "settings") return;
    // Closing the settings entry the app pushed returns to wherever the user
    // was; a deep link straight into /settings/* has no prior entry to trust,
    // so fall back to inbox.
    if (
      isSettingsHistoryEntry(locationState)
      && typeof window !== "undefined"
      && window.history.length > 1
    ) {
      window.history.back();
      return;
    }
    navigate({ view: "inbox" });
  }, [navigate, route.view, locationState]);
  const openContextCapture = useCallback((request: ContextCaptureRequest = {}) => {
    setContextCaptureRequest(request);
  }, []);
  const closeContextCapture = useCallback(() => setContextCaptureRequest(null), []);
  const inspectBrokerAttempt = useCallback((attempt: BrokerRouteAttempt) => {
    setBrokerAttemptCache(attempt);
    if (route.view === "broker" && route.attemptId === attempt.id) return;
    navigate(
      { view: "broker", attemptId: attempt.id },
      { replace: route.view === "broker" },
    );
  }, [navigate, route]);
  const clearBrokerAttempt = useCallback(() => {
    setBrokerAttemptCache(null);
    if (route.view === "broker" && route.attemptId) {
      navigate({ view: "broker" }, { replace: true });
    }
  }, [navigate, route]);
  const inspectKnowledgeHit = useCallback((hit: KnowledgeHit, query?: string) => {
    setKnowledgeHitCache(hit);
    if (typeof query === "string") {
      setSelectedKnowledgeQuery(query.trim());
    }
    if (route.view === "search" && route.hitId === hit.id) return;
    navigate(
      {
        view: "search",
        ...(route.view === "search" && route.mode ? { mode: route.mode } : {}),
        hitId: hit.id,
      },
      { replace: route.view === "search" },
    );
  }, [navigate, route]);
  const clearKnowledgeHit = useCallback(() => {
    setKnowledgeHitCache(null);
    setSelectedKnowledgeQuery("");
    if (route.view === "search" && route.hitId) {
      navigate({
        view: "search",
        ...(route.mode ? { mode: route.mode } : {}),
      }, { replace: true });
    }
  }, [navigate, route]);
  // Base web light/dark vars, with the native app's resolved palette layered on
  // top when hosted in the macOS embed (so the viewer matches the app exactly).
  const nativeThemeVars = useMemo(() => resolveScoutNativeThemeVars(), []);
  const themeVars = useMemo(
    () => ({
      ...(initialTheme === "light" ? LIGHT_THEME_VARS : DARK_THEME_VARS),
      ...(nativeThemeVars ?? {}),
    }),
    [initialTheme, nativeThemeVars],
  );
  const scoutbotAgent = useMemo(() => resolveScoutbotAgent(agents), [agents]);
  const scoutbotAgentId = scoutbotAgent?.id ?? resolveScoutbotAgentId(agents);
  const scoutbotDmConversationId = scoutbotAgent?.conversationId ?? null;
  const reloadInFlightRef = useRef<Promise<void> | null>(null);

  const markApiOnline = useCallback(() => {
    setApiConnection({
      status: "online",
      message: null,
      lastCheckedAt: Date.now(),
    });
  }, []);

  const markApiOffline = useCallback((cause: unknown) => {
    setApiConnection({
      status: "offline",
      message: friendlyApiError(cause),
      lastCheckedAt: Date.now(),
    });
  }, []);

  const reload = useCallback(async () => {
    if (reloadInFlightRef.current) {
      return reloadInFlightRef.current;
    }

    const request = (async () => {
      try {
        const agentsResult = await api<Agent[]>("/api/agents");
        setAgents((previous) => keepPreviousIfJsonEqual(previous, agentsResult));
        markApiOnline();
      } catch (cause) {
        markApiOffline(cause);
      }
    })();

    reloadInFlightRef.current = request;
    try {
      await request;
    } finally {
      reloadInFlightRef.current = null;
    }
  }, [markApiOffline, markApiOnline]);

  const refreshOnboarding = useCallback(async () => {
    try {
      const state = await api<OnboardingState>("/api/onboarding/state");
      setOnboarding(state);
      markApiOnline();
    } catch (cause) {
      markApiOffline(cause);
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
  }, [markApiOffline, markApiOnline]);

  const skipOnboarding = useCallback(() => {
    setOnboardingSkipped(true);
    void api("/api/onboarding/skip", { method: "POST", body: "{}" })
      .then(() => refreshOnboarding())
      .catch(() => null);
  }, [refreshOnboarding]);

  useEffect(() => {
    void reload();
    void refreshOnboarding();
  }, [reload, refreshOnboarding]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void reload();
    };

    const interval = window.setInterval(refreshIfVisible, AGENT_REFRESH_POLL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [reload]);

  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const [filePreviewPath, setFilePreviewPath] = useState<string | null>(null);
  const openFilePreview = useCallback((path: string) => {
    if (!path?.trim()) return;
    setFilePreviewPath(path.trim());
  }, []);
  const closeFilePreview = useCallback(() => setFilePreviewPath(null), []);

  const applyScoutbotUiAction = useCallback((action: ScoutbotUiAction) => {
    switch (action.type) {
      case "navigate":
        navigate(action.route);
        break;
      case "open-scoutbot":
        window.dispatchEvent(new CustomEvent("scout:scoutbot-panel-open", { detail: action }));
        break;
      case "refresh":
        void reload();
        break;
      case "view-file":
        openFilePreview(action.path);
        break;
    }
  }, [navigate, openFilePreview, reload]);

  const scoutbotBridgeRef = useRef({
    applyScoutbotUiAction,
  });
  scoutbotBridgeRef.current = { applyScoutbotUiAction };

  useBrokerEvents((event) => {
    if (AGENT_REFRESH_EVENT_KIND_SET.has(event.kind)) {
      void reload();
    }
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const action = detail && typeof detail === "object" && "type" in detail
        ? detail as ScoutbotUiAction
        : null;
      if (action) {
        scoutbotBridgeRef.current.applyScoutbotUiAction(action);
      }
    };
    window.addEventListener("scout:scoutbot-ui-action", handler);
    window.scoutScoutbot = {
      applyUiAction: (action: ScoutbotUiAction) => scoutbotBridgeRef.current.applyScoutbotUiAction(action),
      navigate: (route: Route) => scoutbotBridgeRef.current.applyScoutbotUiAction({ type: "navigate", route }),
    };
    return () => {
      window.removeEventListener("scout:scoutbot-ui-action", handler);
      if (window.scoutScoutbot?.applyUiAction) {
        delete window.scoutScoutbot;
      }
    };
  }, []);

  const value = useMemo<ScoutContextValue>(
    () => ({
      route, navigate, agents, onlineCount, apiConnection, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
      scoutbotAgentId, scoutbotConversationId: scoutbotDmConversationId, applyScoutbotUiAction,
      selectedBrokerAttempt, inspectBrokerAttempt, clearBrokerAttempt,
      selectedKnowledgeHit, selectedKnowledgeQuery, inspectKnowledgeHit, clearKnowledgeHit,
      focusedSession, focusSession,
      openFilePreview, closeFilePreview,
      openContextCapture, closeContextCapture,
    }),
    [
      route, navigate, agents, onlineCount, apiConnection, reload,
      onboarding, refreshOnboarding, onboardingSkipped, skipOnboarding,
      settingsOpen, openSettings, closeSettings,
      scoutbotAgentId, scoutbotDmConversationId, applyScoutbotUiAction,
      selectedBrokerAttempt, inspectBrokerAttempt, clearBrokerAttempt,
      selectedKnowledgeHit, selectedKnowledgeQuery, inspectKnowledgeHit, clearKnowledgeHit,
      focusedSession, focusSession,
      openFilePreview, closeFilePreview,
      openContextCapture, closeContextCapture,
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
          <ScoutbotStateProvider>
            {children}
            {/* Drawer presentation for operator/comms/credentials/voice/devices.
                Pairing + agents stay full routed SettingsScreen. URL is SoT. */}
            <SettingsDrawer
              open={settingsOpen}
              onClose={closeSettings}
              section={
                route.view === "settings"
                  && route.section
                  && route.section !== "agents"
                  && route.section !== "pairing"
                  ? route.section
                  : undefined
              }
              onSectionChange={(section) => {
                // Section switching is chrome state, not a new destination:
                // replace so rail clicks don't stack history entries. The
                // settings-entry marker rides along (replace preserves entry
                // state), so close still returns via Back only when the entry
                // was app-pushed.
                navigate({ view: "settings", section }, { replace: true });
              }}
            />
            <FilePreviewOverlay
              path={filePreviewPath}
              onOpenPath={openFilePreview}
              onClose={closeFilePreview}
            />
            <ContextCaptureHost
              request={contextCaptureRequest}
              onClose={closeContextCapture}
              onOpenCapture={openContextCapture}
            />
          </ScoutbotStateProvider>
        </ContextMenuProvider>
      </div>
    </ScoutContext.Provider>
  );
}
