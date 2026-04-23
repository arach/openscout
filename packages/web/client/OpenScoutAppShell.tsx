'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Sparkles, Terminal as TerminalIcon } from "lucide-react";
import { Assistant, type HudsonApp, type CommandOption, usePersistentState, usePlatformLayout } from "@hudson/sdk";
import { CommandDock, Frame, NavigationBar, SidePanel, StatusBar } from "@hudson/sdk/chrome";
import { CommandPalette, TerminalDrawer } from "@hudson/sdk/overlays";

import { type ScoutStatusBarState, useScoutStatusBarState } from "./scout/hooks.ts";

interface OpenScoutAppShellProps {
  app: HudsonApp;
  assistant?: boolean;
}

export function OpenScoutAppShell({ app, assistant = true }: OpenScoutAppShellProps) {
  return (
    <app.Provider>
      <OpenScoutAppShellInner app={app} assistantEnabled={assistant} />
    </app.Provider>
  );
}

function OpenScoutStatusBarLeft({ statusBar }: { statusBar: ScoutStatusBarState }) {
  const meshValueClass = statusBar.mesh.color === "amber"
    ? "text-amber-400"
    : statusBar.mesh.color === "red"
      ? "text-red-400"
      : "text-neutral-100";

  return (
    <div className="flex items-center gap-3 font-mono text-[12px]">
      <div className="flex items-center gap-1.5">
        <span className="text-neutral-500">{statusBar.activeAgents.label}:</span>
        <span className="text-neutral-100">{statusBar.activeAgents.count}</span>
      </div>
      <div className="h-3 w-px bg-neutral-700" />
      <div className="flex items-center gap-1.5">
        <span className="text-neutral-500">{statusBar.mesh.label}:</span>
        <span className={meshValueClass}>{statusBar.mesh.value}</span>
      </div>
    </div>
  );
}

function OpenScoutAppShellInner({ app, assistantEnabled }: { app: HudsonApp; assistantEnabled: boolean }) {
  const { navTotalHeight } = usePlatformLayout();

  const appCommands = app.hooks.useCommands();
  const appSearch = app.hooks.useSearch?.() ?? null;
  const appNavCenter = app.hooks.useNavCenter?.() ?? null;
  const appNavActions = app.hooks.useNavActions?.() ?? null;
  const layoutMode = app.hooks.useLayoutMode?.() ?? app.mode;
  const activeToolHint = app.hooks.useActiveToolHint?.() ?? null;
  const takeover = app.hooks.useTakeover?.() ?? null;
  const takeoverActive = takeover?.active === true;
  const takeoverDismissible = takeoverActive && takeover?.dismissible === true;
  const takeoverOnDismiss = takeover?.onDismiss;
  const TakeoverSlot = app.slots.Takeover;
  const statusBar = useScoutStatusBarState();

  const [leftCollapsed, setLeftCollapsed] = usePersistentState(`appshell.${app.id}.left`, false);
  const [rightCollapsed, setRightCollapsed] = usePersistentState(`appshell.${app.id}.right`, false);
  const [leftWidth, setLeftWidth] = usePersistentState(`appshell.${app.id}.leftW`, 260);
  const [rightWidth, setRightWidth] = usePersistentState(`appshell.${app.id}.rightW`, 280);

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
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());

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
      setter(Math.max(200, Math.min(500, startWidth + delta)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [leftWidth, rightWidth, setLeftWidth, setRightWidth]);

  const shellCommands: CommandOption[] = useMemo(() => {
    const commands: CommandOption[] = [
      {
        id: "shell:toggle-left",
        label: "Toggle Left Panel",
        shortcut: "Cmd+[",
        action: () => setLeftCollapsed((collapsed) => !collapsed),
      },
      {
        id: "shell:toggle-right",
        label: "Toggle Right Panel",
        shortcut: "Cmd+]",
        action: () => setRightCollapsed((collapsed) => !collapsed),
      },
      {
        id: "shell:toggle-terminal",
        label: "Toggle Terminal",
        shortcut: "Ctrl+`",
        action: () => setShowTerminal((visible) => !visible),
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
  }, [assistantEnabled, activeTab, setActiveTab, setLeftCollapsed, setRightCollapsed]);

  const allCommands = useMemo(() => [...appCommands, ...shellCommands], [appCommands, shellCommands]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (takeoverActive) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        e.preventDefault();
        setLeftCollapsed((collapsed) => !collapsed);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        e.preventDefault();
        setRightCollapsed((collapsed) => !collapsed);
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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [assistantEnabled, resolvedTab, setActiveTab, setLeftCollapsed, setRightCollapsed, takeoverActive]);

  useEffect(() => {
    const handler = () => {
      setActiveTab("terminal");
      setShowTerminal(true);
    };
    window.addEventListener("scout:open-terminal", handler);
    return () => window.removeEventListener("scout:open-terminal", handler);
  }, [setActiveTab]);

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

  const leftFooter = (
    <>
      {app.slots.LeftFooter && <app.slots.LeftFooter />}
      <CommandDock onOpenCommandPalette={() => setShowCommandPalette(true)} />
    </>
  );

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

  const contentStyle: React.CSSProperties = layoutMode === "panel" ? {
    position: "absolute",
    top: navTotalHeight,
    bottom: 28,
    left: leftCollapsed ? 0 : leftWidth,
    right: rightCollapsed ? 0 : rightWidth,
    overflow: "auto",
    transition: "left 200ms ease, right 200ms ease",
  } : {};

  return (
    <>
      <div ref={backgroundRef} aria-hidden={takeoverActive ? true : undefined} style={{ display: "contents" }}>
        <Frame
          mode={layoutMode}
          panOffset={panOffset}
          scale={scale}
          onPan={handlePan}
          onZoom={handleZoom}
          hud={
            <>
              <NavigationBar
                title={app.name.toUpperCase()}
                search={appSearch ?? undefined}
                center={appNavCenter}
                actions={appNavActions}
              />

              <SidePanel
                side="left"
                title={app.leftPanel?.title ?? "Navigation"}
                icon={app.leftPanel?.icon}
                isCollapsed={leftCollapsed}
                onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
                width={leftWidth}
                onResizeStart={handleResizeStart("left")}
                footer={leftFooter}
                headerActions={app.leftPanel?.headerActions && <app.leftPanel.headerActions />}
              >
                {app.slots.LeftPanel && <app.slots.LeftPanel />}
              </SidePanel>

              <SidePanel
                side="right"
                title={app.rightPanel?.title ?? "Inspector"}
                icon={app.rightPanel?.icon}
                isCollapsed={rightCollapsed}
                onToggleCollapse={() => setRightCollapsed(!rightCollapsed)}
                width={rightWidth}
                onResizeStart={handleResizeStart("right")}
                headerActions={app.rightPanel?.headerActions && <app.rightPanel.headerActions />}
              >
                {rightContent}
              </SidePanel>

              <StatusBar
                status={statusBar.status}
                left={<OpenScoutStatusBarLeft statusBar={statusBar} />}
                onToggleTerminal={() => setShowTerminal((visible) => !visible)}
                isTerminalOpen={showTerminal}
              />

              <div
                className="pointer-events-none"
                style={{
                  position: "fixed",
                  left: leftCollapsed ? 0 : leftWidth,
                  right: rightCollapsed ? 0 : rightWidth,
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
                  height={terminalHeight}
                  onHeightChange={setTerminalHeight}
                  title={(
                    <DrawerTabs
                      tabs={drawerTabs}
                      active={resolvedTab}
                      onSelect={setActiveTab}
                    />
                  )}
                >
                  {resolvedTab === "terminal" && (
                    app.slots.Terminal ? (
                      <app.slots.Terminal />
                    ) : (
                      <div className="p-4 font-mono text-[12px] text-neutral-400">
                        No terminal content
                      </div>
                    )
                  )}
                  {resolvedTab === "assistant" && (
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
          <div style={contentStyle} className="frame-scrollbar">
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
