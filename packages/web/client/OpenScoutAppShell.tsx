'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Pin, PinOff, Search, Sparkles, Terminal as TerminalIcon, X } from "lucide-react";
import { Assistant, type HudsonApp, type CommandOption, usePersistentState, usePlatform, usePlatformLayout } from "@hudsonkit";
import { CommandDock, Frame, SidePanel, StatusBar } from "@hudsonkit/chrome";
import { FeatureFlagsProvider, useOptionalFlag } from "hudsonkit/flags";
import { ScoutFeatureFlagPanel } from "./components/ScoutFeatureFlagPanel.tsx";
import { DevFlagToggle } from "./components/DevFlagToggle.tsx";
import { isScoutDevToolsAvailable } from "./lib/use-scout-dev-flags.ts";
import { CommandPalette, TerminalDrawer } from "@hudsonkit/overlays";

import {
  CanvasMinimapProvider,
  useCanvasMinimap,
} from "./lib/canvas-minimap.tsx";
import {
  SCOUT_AUDIENCE_ORDER,
  SCOUT_DEFAULT_AUDIENCE,
  SCOUT_FLAG_STORAGE_KEY,
  scoutFlagInitialLayers,
  scoutFlags,
} from "./lib/scout-flags.ts";
import { useScopeShellChrome } from "./scope/index.ts";
import { type ScoutStatusBarState, useScoutStatusBarState } from "./scout/hooks.ts";
import { resolveCaptureRouteContext } from "./lib/media-route.ts";
import { useScout } from "./scout/Provider.tsx";
import { useBrowserLocation } from "./lib/router.ts";
import { KeyboardHelpOverlay, useKeyboardHelp } from "./components/KeyboardHelpOverlay.tsx";
import { PairingRequestPrompt } from "./components/PairingRequestPrompt.tsx";
import {
  ScoutActivityLogOverlay,
  ScoutActivityLogStatusButton,
} from "./components/ScoutActivityLogOverlay.tsx";
import { ScoutbotBroadcastChip } from "./components/ScoutbotBroadcastChip.tsx";
import { useScoutActivityLogBridge } from "./lib/scout-activity-log-bridge.ts";
import { isEditableTarget, isTerminalInputTarget, usePaneNav } from "./lib/keyboard-nav.ts";
import {
  isNewChatShortcut,
  NEW_CHAT_SHORTCUT_LABEL,
} from "./lib/new-chat-shortcut.ts";
import { goShortcutForKey } from "./lib/go-shortcuts.ts";
import { SidebarProvider } from "./components/ui/sidebar.tsx";
import { ScoutSidebar } from "./scout/sidebar/ScoutSidebar.tsx";
import {
  ScoutSideRail,
  sideRailHasContent,
} from "./scout/sidebar/ScoutSideRail.tsx";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  useSidebarCollapse,
} from "./scout/sidebar/useSidebarCollapse.ts";

interface OpenScoutAppShellProps {
  app: HudsonApp;
  assistant?: boolean;
}

const SIDE_PANEL_MIN_WIDTH = 240;
const SIDE_PANEL_MAX_WIDTH_HARD_CAP = 900;
const SIDE_PANEL_MAX_WIDTH_VIEWPORT_RATIO = 0.45;
const SIDE_PANEL_MAX_WIDTH_FLOOR = 500;
const SEARCH_RIGHT_PANEL_MIN_WIDTH = 420;
// Agent + session detail is a core flow; give it a wider pane when it slides in.
const AGENTS_RIGHT_PANEL_MIN_WIDTH = 480;
const DISPATCH_SHEET_MIN_WIDTH = 520;
const CENTER_CONTENT_MIN_WIDTH = 560;
const GO_SHORTCUT_TIMEOUT_MS = 1500;

interface ScoutNavigationBarProps {
  title: string;
  center?: React.ReactNode;
  actions?: React.ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
}

// Cap at 45% of viewport, floored at 500 so small screens still get usable inspector.
function computeSidePanelMaxWidth(viewportWidth: number) {
  return Math.min(
    SIDE_PANEL_MAX_WIDTH_HARD_CAP,
    Math.max(SIDE_PANEL_MAX_WIDTH_FLOOR, Math.floor(viewportWidth * SIDE_PANEL_MAX_WIDTH_VIEWPORT_RATIO)),
  );
}

function ScoutChromeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon
        points="10,4.3 14.8,7.1 14.8,12.9 10,15.7 5.2,12.9 5.2,7.1"
        strokeWidth="1.9"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <polygon
        points="10,7 12.4,8.4 12.4,10.6 10,12 7.6,10.6 7.6,8.4"
        strokeWidth="0.9"
        fill="currentColor"
        fillOpacity="0.9"
      />
    </svg>
  );
}

function ScoutNavigationBar({ title, center, actions, search }: ScoutNavigationBarProps) {
  const { dragRegionProps, onInteractiveMouseDown } = usePlatform();
  const { navTotalHeight } = usePlatformLayout();
  const isFiltered = Boolean(search?.value);
  const barRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  // The center strip shifts itself to stay centered over the content area
  // (see .scout-nav-tabs transform). Publish the real widths of the bar's
  // left/right groups and the strip so the CSS clamp can keep the strip from
  // sliding under either absolutely-positioned side group.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => {
      const leftW = (leftRef.current?.offsetWidth ?? 0) + 16;
      const rightW = (rightRef.current?.offsetWidth ?? 0) + 16;
      const stripW = centerRef.current?.firstElementChild?.clientWidth ?? 0;
      bar.style.setProperty("--scout-nav-left-w", `${leftW}px`);
      bar.style.setProperty("--scout-nav-right-w", `${rightW}px`);
      bar.style.setProperty("--scout-nav-strip-w", `${stripW}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    const strip = centerRef.current?.firstElementChild;
    for (const el of [leftRef.current, rightRef.current, strip]) {
      if (el) observer.observe(el);
    }
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-frame-panel="navigation"
      className="fixed top-0 left-0 right-0 z-50 pointer-events-auto"
      {...dragRegionProps}
    >
      <div
        className="bg-background/95 border-b shadow-[var(--hud-shadow-nav)] flex items-end px-4"
        style={{ height: navTotalHeight, borderColor: "var(--hud-chrome-border, oklch(var(--border) / 0.8))" }}
      >
        <div
          ref={leftRef}
          className="absolute left-4 bottom-0 h-12 z-10 flex items-center gap-2.5 select-none"
          onMouseDown={onInteractiveMouseDown}
        >
          <div
            aria-label={title}
            className="flex items-center gap-2 rounded-sm px-0.5 -mx-0.5 leading-none text-foreground/90"
          >
            <ScoutChromeMark className="h-5 w-5 text-[#f8f3e8] drop-shadow-[0_0_6px_rgba(255,247,234,0.3)]" />
            <span className="font-mono text-[11px] font-medium tracking-[0.06em] leading-none">
              {title}
            </span>
          </div>
        </div>

        {center && (
          <div ref={centerRef} className="flex-1 flex justify-center h-12 items-center" onMouseDown={onInteractiveMouseDown}>
            {center}
          </div>
        )}

        <div ref={rightRef} className="absolute right-4 bottom-0 h-12 z-10 flex items-center gap-3" onMouseDown={onInteractiveMouseDown}>
          {actions}

          {search && (
            <div className="hidden sm:block relative w-[220px] max-w-[34vw] bg-card border border-input rounded px-2.5 shadow-[inset_0_1px_0_oklch(var(--foreground)/0.02)] hover:border-ring/60 focus-within:border-ring focus-within:bg-card transition-colors duration-200">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={search.placeholder ?? "Search"}
                className={`
                  w-full h-7 pl-5 pr-6 bg-transparent text-[11px] font-mono font-normal tracking-[0.02em]
                  placeholder:text-muted-foreground/80 placeholder:font-light text-foreground
                  focus:outline-none transition-all duration-200
                  ${isFiltered ? "text-accent" : ""}
                `}
              />
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => search.onChange("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function OpenScoutAppShell({ app, assistant = true }: OpenScoutAppShellProps) {
  return (
    <FeatureFlagsProvider
      registry={scoutFlags}
      audience={SCOUT_DEFAULT_AUDIENCE}
      audienceOrder={SCOUT_AUDIENCE_ORDER}
      storageKey={SCOUT_FLAG_STORAGE_KEY}
      initialLayers={scoutFlagInitialLayers()}
    >
      <app.Provider>
        <CanvasMinimapProvider>
          <OpenScoutAppShellInner app={app} assistantEnabled={assistant} />
        </CanvasMinimapProvider>
      </app.Provider>
    </FeatureFlagsProvider>
  );
}

function OpenScoutStatusBarLeft({ statusBar }: { statusBar: ScoutStatusBarState }) {
  const scoutbotEnabled = useOptionalFlag("surface.scoutbot", true);
  const meshValueClass = statusBar.mesh.color === "amber"
    ? "text-amber-400"
    : statusBar.mesh.color === "red"
      ? "text-red-400"
      : "text-foreground";

  return (
    <div className="flex items-center gap-3 font-mono leading-none">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-normal uppercase tracking-[0.16em] text-muted-foreground">
          {statusBar.activeAgents.label}
        </span>
        <span className="text-[10px] tabular-nums text-foreground">{statusBar.activeAgents.count}</span>
      </div>
      <span aria-hidden="true" className="select-none text-muted-foreground/40 text-[10px]">·</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-normal uppercase tracking-[0.16em] text-muted-foreground">
          {statusBar.mesh.label}
        </span>
        <span className={`text-[10px] ${meshValueClass}`}>{statusBar.mesh.value}</span>
      </div>
      {scoutbotEnabled && (
        <>
          <span aria-hidden="true" className="select-none text-muted-foreground/40 text-[10px]">·</span>
          <ScoutbotBroadcastChip />
        </>
      )}
    </div>
  );
}

function OpenScoutStatusBarRight({
  statusBar,
  onOpenFlagPanel,
  onOpenActivityLog,
}: {
  statusBar: ScoutStatusBarState;
  onOpenFlagPanel: () => void;
  onOpenActivityLog: () => void;
}) {
  return (
    <div className="flex max-w-[42vw] items-center gap-3">
      <ScoutActivityLogStatusButton onOpen={onOpenActivityLog} />
      <span aria-hidden="true" className="select-none text-muted-foreground/40 text-[10px]">·</span>
      <DevFlagToggle onOpenPanel={onOpenFlagPanel} />
      <div
        className="truncate font-mono text-[10px] leading-none text-muted-foreground"
        title={statusBar.build.title}
      >
        {statusBar.build.label}
      </div>
    </div>
  );
}

function OpenScoutAppShellInner({ app, assistantEnabled }: { app: HudsonApp; assistantEnabled: boolean }) {
  const { navTotalHeight } = usePlatformLayout();
  const keyboardHelp = useKeyboardHelp();
  usePaneNav();
  const { route, agents, openContextCapture, apiConnection, navigate, selectedBrokerAttempt } = useScout();
  const browserLocation = useBrowserLocation();
  // SCO-083: exactly one chrome tree — sidebar experiment vs legacy left panel.
  const sidebarChrome = useOptionalFlag("nav.sidebar", false);

  const appCommands = app.hooks.useCommands();
  const appSearch = app.hooks.useSearch?.() ?? null;
  const appNavCenter = app.hooks.useNavCenter?.() ?? null;
  const appNavActions = app.hooks.useNavActions?.() ?? null;
  const layoutMode = app.hooks.useLayoutMode?.() ?? app.mode;
  const frameMode = layoutMode === "focus" ? "panel" : layoutMode;
  const activeToolHint = app.hooks.useActiveToolHint?.() ?? null;
  const takeover = app.hooks.useTakeover?.() ?? null;
  const takeoverActive = takeover?.active === true;
  const takeoverDismissible = takeoverActive && takeover?.dismissible === true;
  const takeoverOnDismiss = takeover?.onDismiss;
  const TakeoverSlot = app.slots.Takeover;
  const statusBar = useScoutStatusBarState();
  useScoutActivityLogBridge(statusBar, apiConnection);
  const canvasMinimap = useCanvasMinimap();
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Legacy left-panel key — kept during soak; sidebar uses its own key.
  const [leftCollapsed, setLeftCollapsed] = usePersistentState(`appshell.${app.id}.left`, false);
  const [rightCollapsed, setRightCollapsed] = usePersistentState(`appshell.${app.id}.right`, false);
  const [rightOverlay, setRightOverlay] = usePersistentState(`appshell.${app.id}.rightOverlay`, false);
  const [leftWidth, setLeftWidth] = usePersistentState(`appshell.${app.id}.leftW`, 260);
  const [rightWidth, setRightWidth] = usePersistentState(`appshell.${app.id}.rightW`, 280);
  const [minimapCollapsed, setMinimapCollapsed] = usePersistentState("openscout.ops.minimap.collapsed", false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  const [sidePanelMaxWidth, setSidePanelMaxWidth] = useState(() =>
    computeSidePanelMaxWidth(typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  const isSearchRoute = route.view === "search" || browserLocation.pathname === "/search";
  const sidebarCollapse = useSidebarCollapse(app.id, viewportWidth);

  useEffect(() => {
    const update = () => {
      setViewportWidth(window.innerWidth);
      setSidePanelMaxWidth(computeSidePanelMaxWidth(window.innerWidth));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Path-driven Scope presentation — never mutates persisted collapse prefs.
  const { active: scopePresentation, brandLabel: scopeBrandLabel } = useScopeShellChrome({
    route,
  });

  useEffect(() => {
    if (sidebarChrome) {
      document.documentElement.setAttribute("data-scout-sidebar-chrome", "");
      document.documentElement.style.setProperty(
        "--scout-nav-rail-width",
        `${sidebarCollapse.width}px`,
      );
    } else {
      document.documentElement.removeAttribute("data-scout-sidebar-chrome");
      document.documentElement.style.removeProperty("--scout-nav-rail-width");
    }
    return () => {
      document.documentElement.removeAttribute("data-scout-sidebar-chrome");
      document.documentElement.style.removeProperty("--scout-nav-rail-width");
    };
  }, [sidebarChrome, sidebarCollapse.width]);

  useEffect(() => {
    setLeftWidth((current) => Math.min(sidePanelMaxWidth, Math.max(SIDE_PANEL_MIN_WIDTH, current)));
    setRightWidth((current) => Math.min(sidePanelMaxWidth, Math.max(SIDE_PANEL_MIN_WIDTH, current)));
  }, [sidePanelMaxWidth, setLeftWidth, setRightWidth]);

  useEffect(() => {
    if (!isSearchRoute || rightCollapsed || rightOverlay) return;
    setRightWidth((current) => Math.max(current, Math.min(sidePanelMaxWidth, SEARCH_RIGHT_PANEL_MIN_WIDTH)));
  }, [isSearchRoute, rightCollapsed, rightOverlay, setRightWidth, sidePanelMaxWidth]);

  // Widen the inspector when an agent's detail slides in — sessions + agent
  // detail are a core flow here and want room to be parsed, not a 280px sliver.
  const agentsV2Peek =
    route.view === "agents-v2"
    && !route.agentId
    && !route.sessionId
    && Boolean(route.selectedAgentId);
  const agentDetailOpen =
    agentsV2Peek
    || (route.view === "agents-v2" && Boolean(route.agentId));
  useEffect(() => {
    if (!agentDetailOpen || rightCollapsed || rightOverlay) return;
    setRightWidth((current) => Math.max(current, Math.min(sidePanelMaxWidth, AGENTS_RIGHT_PANEL_MIN_WIDTH)));
  }, [agentDetailOpen, rightCollapsed, rightOverlay, setRightWidth, sidePanelMaxWidth]);

  const dispatchSheetOpen = route.view === "broker" && Boolean(selectedBrokerAttempt);
  useEffect(() => {
    if (!dispatchSheetOpen) return;
    setRightCollapsed(false);
    setRightWidth((current) => Math.max(current, Math.min(sidePanelMaxWidth, DISPATCH_SHEET_MIN_WIDTH)));
  }, [dispatchSheetOpen, setRightCollapsed, setRightWidth, sidePanelMaxWidth]);

  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const handlePan = useCallback((delta: { x: number; y: number }) => {
    setPanOffset((prev) => ({ x: prev.x + delta.x, y: prev.y + delta.y }));
  }, []);

  const handleZoom = useCallback((newScale: number) => {
    setScale(newScale);
  }, []);

  const [showTerminal, setShowTerminal] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const [terminalHeight, setTerminalHeight] = usePersistentState(`appshell.${app.id}.termH`, 320);

  const hasTerminalSlot = !!app.slots.Terminal;
  const drawerTabs = useMemo<DrawerTab[]>(() => {
    const tabs: DrawerTab[] = [];
    if (hasTerminalSlot) tabs.push("terminal");
    if (assistantEnabled) tabs.push("assistant");
    return tabs;
  }, [hasTerminalSlot, assistantEnabled]);
  const defaultTab: DrawerTab = drawerTabs[0] ?? "terminal";
  const [activeTab, setActiveTab] = usePersistentState<DrawerTab>(
    `appshell.${app.id}.drawerTab`,
    defaultTab,
  );
  const resolvedTab: DrawerTab = drawerTabs.includes(activeTab) ? activeTab : defaultTab;

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showFlagPanel, setShowFlagPanel] = useState(false);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const goShortcutPendingRef = useRef(false);
  const goShortcutTimerRef = useRef<number | null>(null);

  const clearGoShortcut = useCallback(() => {
    goShortcutPendingRef.current = false;
    if (goShortcutTimerRef.current !== null) {
      window.clearTimeout(goShortcutTimerRef.current);
      goShortcutTimerRef.current = null;
    }
  }, []);

  const startGoShortcut = useCallback(() => {
    goShortcutPendingRef.current = true;
    if (goShortcutTimerRef.current !== null) {
      window.clearTimeout(goShortcutTimerRef.current);
    }
    goShortcutTimerRef.current = window.setTimeout(clearGoShortcut, GO_SHORTCUT_TIMEOUT_MS);
  }, [clearGoShortcut]);

  useEffect(() => clearGoShortcut, [clearGoShortcut]);

  const toggleTool = useCallback((id: string) => {
    setOpenTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleResizeStart = useCallback((side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const setter = side === "left" ? setLeftWidth : setRightWidth;
    const direction = side === "left" ? 1 : -1;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * direction;
      setter(Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(sidePanelMaxWidth, startWidth + delta)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [leftWidth, rightWidth, setLeftWidth, setRightWidth, sidePanelMaxWidth]);

  const shellCommands: CommandOption[] = useMemo(() => {
    const toggleLeft = () => {
      if (sidebarChrome) {
        sidebarCollapse.toggleCollapsed();
      } else {
        setLeftCollapsed((collapsed) => !collapsed);
      }
    };
    const commands: CommandOption[] = [
      {
        id: "shell:toggle-left",
        label: sidebarChrome ? "Toggle Sidebar" : "Toggle Left Panel",
        shortcut: "Cmd+[",
        action: toggleLeft,
      },
      {
        id: "shell:toggle-sidebar-b",
        label: "Toggle Sidebar",
        shortcut: "Cmd+B",
        action: toggleLeft,
      },
      {
        id: "shell:toggle-right",
        label: "Toggle Right Panel",
        shortcut: "Cmd+]",
        action: () => setRightCollapsed((collapsed) => !collapsed),
      },
      {
        id: "shell:toggle-right-overlay",
        label: "Toggle Inspector Overlay",
        shortcut: "Cmd+Shift+]",
        action: () => setRightOverlay((overlay) => !overlay),
      },
      {
        id: "shell:new-session",
        label: "New Chat",
        shortcut: NEW_CHAT_SHORTCUT_LABEL,
        action: () => {
          const context = resolveCaptureRouteContext(route, agents);
          openContextCapture({ agentId: context.agentId ?? undefined });
        },
      },
      {
        id: "shell:toggle-terminal",
        label: "Toggle Terminal",
        shortcut: "Ctrl+`",
        action: () => setShowTerminal((visible) => !visible),
      },
      {
        id: "shell:feature-flags",
        label: "Feature Flags",
        shortcut: isScoutDevToolsAvailable() ? "Cmd+Shift+F" : undefined,
        action: () => setShowFlagPanel(true),
      },
    ];
    if (assistantEnabled) {
      commands.push({
        id: "shell:toggle-assistant",
        label: "Toggle Assistant",
        shortcut: "Cmd+J",
        action: () => {
          setActiveTab("assistant");
          setShowTerminal((visible) => !visible || activeTab !== "assistant");
        },
      });
    }
    return commands;
  }, [
    agents,
    assistantEnabled,
    activeTab,
    openContextCapture,
    route,
    setActiveTab,
    setLeftCollapsed,
    setRightCollapsed,
    setRightOverlay,
    setShowFlagPanel,
    sidebarChrome,
    sidebarCollapse,
  ]);

  const allCommands = useMemo(() => [...appCommands, ...shellCommands], [appCommands, shellCommands]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTerminalInputTarget(e.target)) return;
      if (takeoverActive || keyboardHelp.open) return;
      const key = e.key.toLowerCase();
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
      const typing = isEditableTarget(e.target);
      if (goShortcutPendingRef.current) {
        if (e.key === "Escape" || hasModifier || typing) {
          clearGoShortcut();
        } else {
          const goShortcut = goShortcutForKey(key);
          if (goShortcut) {
            e.preventDefault();
            e.stopPropagation();
            clearGoShortcut();
            navigate(goShortcut.route);
            return;
          } else {
            clearGoShortcut();
          }
        }
      }
      if (!hasModifier && !e.shiftKey && key === "g" && !typing) {
        e.preventDefault();
        e.stopPropagation();
        startGoShortcut();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      if (isNewChatShortcut(e)) {
        e.preventDefault();
        const context = resolveCaptureRouteContext(route, agents);
        openContextCapture({ agentId: context.agentId ?? undefined });
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "[" || e.key.toLowerCase() === "b")) {
        // Cmd+[ and Cmd+B retarget the primary left chrome (sidebar or legacy panel).
        // Skip Cmd+B inside editable/terminal targets (handled by outer guards partially;
        // re-check editable for B so typing "b" with accidental meta is less risky).
        if (e.key.toLowerCase() === "b" && typing) return;
        e.preventDefault();
        if (sidebarChrome) {
          sidebarCollapse.toggleCollapsed();
        } else {
          setLeftCollapsed((collapsed) => !collapsed);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        e.preventDefault();
        if (e.shiftKey) {
          setRightOverlay((overlay) => !overlay);
        } else {
          setRightCollapsed((collapsed) => !collapsed);
        }
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setShowTerminal((visible) => !visible);
      }
      if (assistantEnabled && (e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setActiveTab("assistant");
        setShowTerminal((visible) => !(visible && resolvedTab === "assistant"));
      }
      if (
        isScoutDevToolsAvailable()
        && (e.metaKey || e.ctrlKey)
        && e.shiftKey
        && !e.altKey
        && e.code === "KeyF"
      ) {
        e.preventDefault();
        e.stopPropagation();
        setShowFlagPanel(true);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    agents,
    assistantEnabled,
    clearGoShortcut,
    keyboardHelp.open,
    navigate,
    openContextCapture,
    resolvedTab,
    route,
    setActiveTab,
    setLeftCollapsed,
    setRightCollapsed,
    setRightOverlay,
    setShowFlagPanel,
    sidebarChrome,
    sidebarCollapse,
    startGoShortcut,
    takeoverActive,
  ]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ width?: unknown }>).detail;
      const width = typeof detail?.width === "number" ? detail.width : 420;
      setRightCollapsed(false);
      setRightWidth((current) =>
        Math.max(current, Math.min(sidePanelMaxWidth, Math.max(SIDE_PANEL_MIN_WIDTH, width))),
      );
    };
    window.addEventListener("scout:set-inspector-width", handler);
    return () => window.removeEventListener("scout:set-inspector-width", handler);
  }, [setRightCollapsed, setRightWidth, sidePanelMaxWidth]);

  const InspectorSlot = app.slots.Inspector;
  const RightPanelSlot = app.slots.RightPanel;
  const hasTools = app.tools && app.tools.length > 0;

  const rightContent = (
    <>
      {InspectorSlot && <InspectorSlot />}
      {!InspectorSlot && RightPanelSlot && <RightPanelSlot />}
      {hasTools && (
        <div className="border-t border-neutral-700/50">
          {app.tools!.map((tool) => {
            const isOpen = openTools.has(tool.id);
            return (
              <div key={tool.id}>
                <button
                  onClick={() => toggleTool(tool.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono tracking-wider uppercase transition-colors hover:bg-white/5 ${
                    activeToolHint === tool.id ? "text-emerald-400" : "text-neutral-300"
                  }`}
                >
                  {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <span className="text-neutral-400">{tool.icon}</span>
                  <span className="font-bold">{tool.name}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3">
                    <tool.Component />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const rightFooter = (
    <CommandDock onOpenCommandPalette={() => setShowCommandPalette(true)} />
  );
  const minimapChrome = useMemo(() => ({
    isCollapsed: minimapCollapsed,
    onToggleCollapse: () => setMinimapCollapsed((collapsed) => !collapsed),
  }), [minimapCollapsed, setMinimapCollapsed]);
  const canvasMinimapNode = canvasMinimap ? (
    <div className={`scout-canvas-minimap-shell${minimapCollapsed ? " scout-canvas-minimap-shell--collapsed" : ""}`}>
      {canvasMinimap.render(minimapChrome)}
    </div>
  ) : null;
  const floatingCanvasMinimapNode = canvasMinimap ? (
    <div className={`scout-canvas-minimap-shell scout-canvas-minimap-shell--floating${minimapCollapsed ? " scout-canvas-minimap-shell--collapsed" : ""}`}>
      {canvasMinimap.render(minimapChrome)}
    </div>
  ) : null;

  const backgroundRef = useRef<HTMLDivElement>(null);
  const takeoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = backgroundRef.current;
    if (!el) return;
    if (takeoverActive) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }, [takeoverActive]);

  useEffect(() => {
    if (!takeoverActive) return;
    const el = takeoverRef.current;
    if (el) {
      const firstFocusable = el.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      (firstFocusable ?? el).focus();
    }
    if (!takeoverDismissible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        takeoverOnDismiss?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [takeoverActive, takeoverDismissible, takeoverOnDismiss]);

  // Directory surfaces have nothing "in context" until a row is engaged, so
  // the inspector loads minimized there and opens itself when a concrete agent,
  // thread, or session enters context. This only overrides the rendered collapse
  // — the stored preference is untouched, so engaged views keep their state.
  const inspectorHasNothingInContext = route.view === "agents-v2" && !route.agentId;
  const projectsHaveNothingInContext = route.view === "agents-v2"
    && !route.agentId
    && !route.selectedAgentId
    && !route.sessionId;
  const dispatchHasNothingInContext = route.view === "broker" && !selectedBrokerAttempt;
  const agentsV2Route = route.view === "agents-v2";
  const effectiveRightCollapsed = rightCollapsed
    || inspectorHasNothingInContext
    || projectsHaveNothingInContext
    || dispatchHasNothingInContext
    || scopePresentation;
  const showRightPanel = !scopePresentation && (route.view !== "broker" || dispatchSheetOpen);

  // Scope presentation: legacy chrome collapses left/right as derived state
  // (never written to prefs). New sidebar chrome keeps a path-aware Scope model.
  const scopeHidesLegacyLeft = scopePresentation && !sidebarChrome;
  const scopeHidesRight = scopePresentation;

  // Side rail (context SidePanel) only when sidebar chrome is on and the route
  // has resolveSidebarContext content. Scope has no Scout context pane.
  const sideRailActive =
    sidebarChrome && sideRailHasContent(route, scopePresentation);
  const sideRailPushWidth =
    sideRailActive && !leftCollapsed ? leftWidth : 0;

  // Sidebar chrome: left inset = nav sidebar width + side-rail width.
  // Nav sidebar always reserves rail width (expanded 260 or 48px icon rail).
  // Side rail collapses to zero width with a floating expand control (as today).
  // Legacy SidePanel collapses to zero width with a floating expand control.
  const leftPushInset = sidebarChrome
    ? sidebarCollapse.width + sideRailPushWidth
    : (leftCollapsed || scopeHidesLegacyLeft ? 0 : leftWidth);
  const rightPushInset =
    effectiveRightCollapsed || rightOverlay || dispatchSheetOpen || scopeHidesRight
      ? 0
      : rightWidth;
  const pushedContentWidth = viewportWidth - leftPushInset - rightPushInset;
  const shouldAutoOverlayPanels =
    layoutMode === "panel" &&
    pushedContentWidth < CENTER_CONTENT_MIN_WIDTH &&
    (leftPushInset > 0 || rightPushInset > 0);
  const autoOverlayRight = shouldAutoOverlayPanels && rightPushInset > 0;
  // Side rail (not the icon nav rail) may overlay when center content is squeezed.
  const autoOverlayLeft =
    shouldAutoOverlayPanels &&
    (sidebarChrome
      ? sideRailPushWidth > 0 &&
        viewportWidth - sidebarCollapse.width - sideRailPushWidth < CENTER_CONTENT_MIN_WIDTH
      : leftPushInset > 0 &&
        viewportWidth - leftPushInset < CENTER_CONTENT_MIN_WIDTH);
  const leftPanelOverlaysContent = autoOverlayLeft;
  const rightPanelOverlaysContent = dispatchSheetOpen || rightOverlay || autoOverlayRight;
  // When the side rail overlays, keep the nav rail inset so content starts after icons.
  const leftInset = leftPanelOverlaysContent
    ? (sidebarChrome ? sidebarCollapse.width : 0)
    : leftPushInset;
  const rightInset = rightPanelOverlaysContent ? 0 : rightPushInset;
  const contentStyle: React.CSSProperties = layoutMode === "panel" ? {
    position: "absolute",
    top: navTotalHeight,
    bottom: 28,
    left: leftInset,
    right: rightInset,
    overflow: "auto",
    transition: "left 200ms ease, right 200ms ease",
  } : {};
  const shellChromeStyle = {
    display: "contents",
    "--scout-shell-left-inset": `${layoutMode === "panel" ? leftInset : 0}px`,
    "--scout-shell-right-inset": `${layoutMode === "panel" ? rightInset : 0}px`,
    // Side-rail expand control offsets against the nav icon/expanded rail width.
    ...(sidebarChrome
      ? { "--scout-nav-rail-width": `${sidebarCollapse.width}px` }
      : {}),
  } as React.CSSProperties;
  const rightOverlayControlTitle = rightOverlay
    ? "Pin inspector (push content)"
    : autoOverlayRight
      ? "Keep inspector floating when there is room"
      : "Float inspector (overlay content)";
  const panelOverlayStyle = useCallback((side: "left" | "right", sheet = false): React.CSSProperties => ({
    backgroundColor: "rgba(13, 14, 16, 0.72)",
    backdropFilter: "blur(24px) saturate(140%)",
    WebkitBackdropFilter: "blur(24px) saturate(140%)",
    boxShadow: side === "left"
      ? "18px 0 48px -12px rgba(0,0,0,0.7), inset -1px 0 0 0 rgba(255,255,255,0.06)"
      : "-18px 0 48px -12px rgba(0,0,0,0.7), inset 1px 0 0 0 rgba(255,255,255,0.06)",
    ...(sheet ? {
      right: 12,
      bottom: 40,
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: 12,
      boxShadow: "-24px 18px 72px -18px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.025)",
    } : {}),
  }), []);

  return (
    <>
      <div ref={backgroundRef} aria-hidden={takeoverActive ? true : undefined} style={shellChromeStyle}>
        <Frame
          mode={frameMode}
          panOffset={panOffset}
          scale={scale}
          onPan={handlePan}
          onZoom={handleZoom}
          hud={
            <>
              <ScoutNavigationBar
                title={scopePresentation ? scopeBrandLabel : app.name}
                search={scopePresentation ? undefined : (appSearch ?? undefined)}
                center={appNavCenter}
                actions={appNavActions}
              />

              {sidebarChrome ? (
                <>
                  <SidebarProvider
                    open={!sidebarCollapse.effectiveCollapsed}
                    onOpenChange={(open) => sidebarCollapse.setCollapsed(!open)}
                    style={
                      {
                        "--sidebar-width": `${SIDEBAR_EXPANDED_WIDTH}px`,
                        "--sidebar-width-icon": `${SIDEBAR_COLLAPSED_WIDTH}px`,
                        "--scout-sidebar-top": `${navTotalHeight}px`,
                      } as React.CSSProperties
                    }
                  >
                    <ScoutSidebar
                      brandLabel={scopePresentation ? scopeBrandLabel : app.name}
                    />
                  </SidebarProvider>

                  {/* Side rail: per-area context in a LEFT HudsonKit SidePanel.
                      Distinct shell slot from the nav sidebar and legacy LeftPanel. */}
                  {sideRailActive ? (
                    <ScoutSideRail
                      navRailWidth={sidebarCollapse.width}
                      isCollapsed={leftCollapsed}
                      onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
                      width={leftWidth}
                      onResizeStart={handleResizeStart("left")}
                      style={leftPanelOverlaysContent ? panelOverlayStyle("left") : undefined}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <SidePanel
                    side="left"
                    title={
                      agentsV2Route
                        ? "Browse"
                        : route.view === "agents-v2" || route.view === "agent-info"
                          ? "Projects"
                          : app.leftPanel?.title ?? "Navigation"
                    }
                    icon={app.leftPanel?.icon}
                    isCollapsed={leftCollapsed || scopeHidesLegacyLeft}
                    onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
                    width={leftWidth}
                    onResizeStart={handleResizeStart("left")}
                    style={leftPanelOverlaysContent ? panelOverlayStyle("left") : undefined}
                    footer={!leftCollapsed && !scopeHidesLegacyLeft ? canvasMinimapNode : undefined}
                    headerActions={app.leftPanel?.headerActions && <app.leftPanel.headerActions />}
                  >
                    <div data-pane="left" style={{ display: "contents" }}>
                      {app.slots.LeftPanel && <app.slots.LeftPanel />}
                    </div>
                  </SidePanel>

                  {(leftCollapsed || scopeHidesLegacyLeft) ? floatingCanvasMinimapNode : null}
                </>
              )}

              {showRightPanel && (
                <SidePanel
                  side="right"
                  title={dispatchSheetOpen ? "Dispatch detail" : agentsV2Route ? "Detail" : app.rightPanel?.title ?? "Inspector"}
                  icon={app.rightPanel?.icon}
                  isCollapsed={effectiveRightCollapsed}
                  onToggleCollapse={() => {
                    // Nothing to inspect on an unselected directory, so the expand
                    // affordance is inert there — don't flip the stored preference.
                    if (inspectorHasNothingInContext || projectsHaveNothingInContext) return;
                    setRightCollapsed(!rightCollapsed);
                  }}
                  width={rightWidth}
                  onResizeStart={handleResizeStart("right")}
                  floating={rightPanelOverlaysContent}
                  style={rightPanelOverlaysContent ? panelOverlayStyle("right", dispatchSheetOpen) : undefined}
                  footer={rightFooter}
                  headerActions={
                    <>
                      {!dispatchSheetOpen && (
                        <button
                          type="button"
                          onClick={() => setRightOverlay((o) => (autoOverlayRight && !o ? true : !o))}
                          title={rightOverlayControlTitle}
                          aria-label={rightOverlayControlTitle}
                          className="p-1 hover:bg-accent/10 rounded transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {rightPanelOverlaysContent ? <PinOff size={12} /> : <Pin size={12} />}
                        </button>
                      )}
                      {app.rightPanel?.headerActions && <app.rightPanel.headerActions />}
                    </>
                  }
                >
                  <div data-pane="right" style={{ display: "contents" }}>
                    {rightContent}
                  </div>
                </SidePanel>
              )}

              <StatusBar
                status={statusBar.status}
                left={<OpenScoutStatusBarLeft statusBar={statusBar} />}
                right={(
                  <OpenScoutStatusBarRight
                    statusBar={statusBar}
                    onOpenFlagPanel={() => setShowFlagPanel(true)}
                    onOpenActivityLog={() => setShowActivityLog(true)}
                  />
                )}
                onToggleTerminal={() => setShowTerminal((visible) => !visible)}
                isTerminalOpen={showTerminal}
              />

              <ScoutActivityLogOverlay
                open={showActivityLog}
                onClose={() => setShowActivityLog(false)}
              />

              <div
                className="pointer-events-none"
                style={{
                  position: "fixed",
                  left: leftInset,
                  right: rightInset,
                  bottom: 0,
                  top: 0,
                  zIndex: 45,
                  transition: "left 200ms ease, right 200ms ease",
                  transform: "translateZ(0)",
                }}
              >
                <TerminalDrawer
                  isOpen={showTerminal}
                  onClose={() => setShowTerminal(false)}
                  onToggleMaximize={() => setIsTerminalMaximized((maximized) => !maximized)}
                  isMaximized={isTerminalMaximized}
                  height={Math.min(terminalHeight, window.innerHeight * 0.8)}
                  onHeightChange={(h) => setTerminalHeight(Math.min(h, window.innerHeight * 0.8))}
                  title={(
                    <DrawerTabs
                      tabs={drawerTabs}
                      active={resolvedTab}
                      onSelect={setActiveTab}
                    />
                  )}
                >
                  {showTerminal && resolvedTab === "terminal" && (
                    app.slots.Terminal ? (
                      <app.slots.Terminal />
                    ) : (
                      <div className="p-4 font-mono text-[12px] text-neutral-400">
                        No terminal content
                      </div>
                    )
                  )}
                  {showTerminal && resolvedTab === "assistant" && (
                    <Assistant app={app} commands={appCommands} />
                  )}
                </TerminalDrawer>
              </div>

              <CommandPalette
                isOpen={showCommandPalette}
                onClose={() => setShowCommandPalette(false)}
                commands={allCommands}
              />
            </>
          }
        >
          <div style={contentStyle} className="frame-scrollbar" data-pane="center">
            <app.slots.Content />
          </div>
        </Frame>
      </div>
      {takeoverActive && TakeoverSlot ? (
        <div
          ref={takeoverRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 80, outline: "none" }}
        >
          <TakeoverSlot />
        </div>
      ) : null}
      <KeyboardHelpOverlay
        open={keyboardHelp.open}
        onClose={() => keyboardHelp.setOpen(false)}
      />
      <ScoutFeatureFlagPanel
        isOpen={showFlagPanel}
        onClose={() => setShowFlagPanel(false)}
        audienceOptions={SCOUT_AUDIENCE_ORDER}
      />
      <PairingRequestPrompt />
    </>
  );
}

type DrawerTab = "terminal" | "assistant";

function DrawerTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: DrawerTab[];
  active: DrawerTab;
  onSelect: (tab: DrawerTab) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((tab) => {
        const isActive = tab === active;
        const Icon = tab === "terminal" ? TerminalIcon : Sparkles;
        const label = tab === "terminal" ? "TERMINAL" : "ASSISTANT";
        const accent = tab === "terminal" ? "text-emerald-400" : "text-cyan-400";
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold tracking-widest font-mono transition-colors ${
              isActive ? `${accent} bg-white/[0.04]` : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
