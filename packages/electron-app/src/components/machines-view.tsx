"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronRight,
  Globe,
  HardDrive,
  Laptop,
  RefreshCw,
  Server,
  Terminal,
  Workflow,
} from "lucide-react";

import type { DesktopMachine, DesktopMachinesState } from "@/lib/openscout-desktop";

type ThemePalette = Record<string, string>;
type ThemeStyles = {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  activeItem: React.CSSProperties;
  tagBadge: React.CSSProperties;
};

type MachinesViewProps = {
  machinesState: DesktopMachinesState;
  C: ThemePalette;
  s: ThemeStyles;
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent) => void;
  onOpenRelayAgent: (agentId: string) => void;
  onRefresh: () => void;
  identityColor: (identity: string) => string;
};

function machineIcon(machine: DesktopMachine) {
  if (machine.isLocal) {
    return Laptop;
  }

  if (machine.capabilities.includes("broker")) {
    return Server;
  }

  return Globe;
}

function statusPillStyle(
  status: DesktopMachine["status"],
  C: ThemePalette,
): React.CSSProperties {
  switch (status) {
    case "online":
      return { backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#059669" };
    case "degraded":
      return { backgroundColor: "rgba(245, 158, 11, 0.14)", color: "#d97706" };
    case "offline":
      return { backgroundColor: C.tagBg, color: C.muted };
  }
}

function endpointPillStyle(
  state: DesktopMachine["endpoints"][number]["state"],
  C: ThemePalette,
): React.CSSProperties {
  switch (state) {
    case "running":
      return { backgroundColor: "rgba(59, 130, 246, 0.12)", color: "#2563eb" };
    case "idle":
      return { backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#059669" };
    case "waiting":
      return { backgroundColor: "rgba(245, 158, 11, 0.14)", color: "#d97706" };
    case "offline":
      return { backgroundColor: C.tagBg, color: C.muted };
  }
}

export default function MachinesView({
  machinesState,
  C,
  s,
  isCollapsed,
  sidebarWidth,
  onResizeStart,
  onOpenRelayAgent,
  onRefresh,
  identityColor,
}: MachinesViewProps) {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(machinesState.machines[0]?.id ?? null);

  useEffect(() => {
    if (!machinesState.machines.length) {
      setSelectedMachineId(null);
      return;
    }

    if (!selectedMachineId || !machinesState.machines.some((machine) => machine.id === selectedMachineId)) {
      setSelectedMachineId(machinesState.machines[0]?.id ?? null);
    }
  }, [machinesState.machines, selectedMachineId]);

  const selectedMachine = useMemo(
    () => machinesState.machines.find((machine) => machine.id === selectedMachineId) ?? machinesState.machines[0] ?? null,
    [machinesState.machines, selectedMachineId],
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {!isCollapsed ? (
        <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
          <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={onResizeStart} />
          <div className="px-4 h-14 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
            <div>
              <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Machines</h1>
              <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                {machinesState.onlineCount}/{machinesState.totalMachines} online
              </div>
            </div>
            <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={onRefresh}>
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="p-3 border-b grid grid-cols-3 gap-2" style={{ borderColor: C.border }}>
            {[
              { label: "Nodes", value: machinesState.totalMachines, icon: Server },
              { label: "Live", value: machinesState.onlineCount, icon: Activity },
              { label: "Warn", value: machinesState.degradedCount, icon: Workflow },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-2 rounded" style={{ backgroundColor: C.surface }}>
                <stat.icon size={14} className="mx-auto mb-1" style={s.mutedText} />
                <div className="text-sm font-bold" style={s.inkText}>{stat.value}</div>
                <div className="text-[8px] font-mono uppercase" style={s.mutedText}>{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {machinesState.machines.map((machine) => {
                const Icon = machineIcon(machine);
                const selected = machine.id === selectedMachine?.id;

                return (
                  <button
                    key={machine.id}
                    onClick={() => setSelectedMachineId(machine.id)}
                    className="os-row w-full text-left p-3 rounded-lg transition-all"
                    style={selected ? { backgroundColor: C.surface, borderColor: C.border, border: `1px solid ${C.border}` } : undefined}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.tagBg }}>
                        <Icon size={18} style={machine.status === "offline" ? s.mutedText : s.inkText} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-[12px] font-medium truncate" style={s.inkText}>{machine.title}</div>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={statusPillStyle(machine.status, C)}>
                            {machine.statusLabel}
                          </span>
                        </div>
                        <div className="text-[10px] leading-[1.5]" style={s.mutedText}>
                          {machine.endpointCount} endpoints
                          {machine.lastSeenLabel ? ` · seen ${machine.lastSeenLabel}` : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {isCollapsed && machinesState.machines.length > 0 ? (
          <div className="px-6 py-4 border-b flex items-center gap-2 overflow-x-auto" style={{ borderColor: C.border }}>
            {machinesState.machines.map((machine) => (
              <button
                key={machine.id}
                onClick={() => setSelectedMachineId(machine.id)}
                className="os-btn border rounded-lg px-3 py-2 text-[11px] font-medium whitespace-nowrap"
                style={machine.id === selectedMachine?.id ? s.activeItem : { ...s.surface, borderColor: C.border, color: C.ink }}
              >
                {machine.title}
              </button>
            ))}
          </div>
        ) : null}

        {selectedMachine ? (
          <div className="px-8 py-8 space-y-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Node Detail</div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-[26px] font-semibold tracking-tight" style={s.inkText}>{selectedMachine.title}</h1>
                  <span className="text-[10px] font-mono uppercase px-2 py-1 rounded" style={statusPillStyle(selectedMachine.status, C)}>
                    {selectedMachine.statusLabel}
                  </span>
                </div>
                <div className="text-[13px] leading-[1.7] max-w-2xl" style={s.mutedText}>
                  {selectedMachine.statusDetail}
                  {selectedMachine.hostName ? ` Host: ${selectedMachine.hostName}.` : ""}
                  {selectedMachine.brokerUrl ? ` Broker: ${selectedMachine.brokerUrl}.` : ""}
                </div>
              </div>
              <button
                onClick={onRefresh}
                className="os-btn border px-3 py-2 rounded-lg text-[12px] font-medium shadow-sm flex items-center gap-2"
                style={{ ...s.surface, borderColor: C.border, color: C.ink }}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-4 gap-4">
                {[
                  { label: "Reachable", value: selectedMachine.reachableEndpointCount, icon: Activity },
                  { label: "Running", value: selectedMachine.workingEndpointCount, icon: Workflow },
                  { label: "Projects", value: selectedMachine.projectCount, icon: Globe },
                  { label: "Endpoints", value: selectedMachine.endpointCount, icon: Terminal },
                ].map((stat) => (
                <div key={stat.label} className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="flex items-center gap-2 mb-2" style={s.mutedText}>
                    <stat.icon size={14} />
                    <span className="text-[10px] font-mono uppercase tracking-widest">{stat.label}</span>
                  </div>
                  <div className="text-[22px] font-semibold" style={s.inkText}>{stat.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-6">
              <section className="border rounded-xl overflow-hidden" style={{ borderColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ ...s.surface, borderBottomColor: C.border }}>
                  <div>
                    <div className="text-[13px] font-semibold" style={s.inkText}>Runtime Endpoints</div>
                    <div className="text-[10px] font-mono mt-1" style={s.mutedText}>
                      Relay agents and sessions attached to this node
                    </div>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {selectedMachine.endpoints.length > 0 ? selectedMachine.endpoints.map((endpoint) => (
                    <div key={endpoint.id} className="px-4 py-4" style={s.surface}>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-[11px] font-bold shrink-0"
                            style={{ backgroundColor: identityColor(endpoint.agentId) }}
                          >
                            {endpoint.agentName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="text-[13px] font-medium truncate" style={s.inkText}>{endpoint.agentName}</div>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={endpointPillStyle(endpoint.state, C)}>
                                {endpoint.stateLabel}
                              </span>
                            </div>
                            <div className="text-[11px] leading-[1.6]" style={s.mutedText}>
                              {endpoint.project ?? "No project root"}
                              {endpoint.projectRoot ? ` · ${endpoint.projectRoot}` : ""}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => onOpenRelayAgent(endpoint.agentId)}
                          className="text-[11px] font-medium flex items-center gap-1 shrink-0"
                          style={{ color: C.accent }}
                        >
                          Open Relay <ChevronRight size={12} />
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-[11px]">
                        <div>
                          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Harness</div>
                          <div style={s.inkText}>{endpoint.harness ?? "Unknown"}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Transport</div>
                          <div style={s.inkText}>{endpoint.transport ?? "Unknown"}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Session</div>
                          <div style={s.inkText}>{endpoint.sessionId ?? "Not reported"}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Activity</div>
                          <div style={s.inkText}>{endpoint.lastActiveLabel ?? "Not reported"}</div>
                        </div>
                      </div>
                      {endpoint.activeTask ? (
                        <div className="mt-3 text-[11px] leading-[1.6] border rounded-lg px-3 py-2" style={{ borderColor: C.border, color: C.muted, backgroundColor: C.bg }}>
                          {endpoint.activeTask}
                        </div>
                      ) : null}
                    </div>
                  )) : (
                    <div className="px-4 py-8 text-[12px] text-center" style={{ ...s.surface, color: C.muted }}>
                      No registered endpoints on this node yet.
                    </div>
                  )}
                </div>
              </section>

              <div className="space-y-4">
                <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Machine Profile</div>
                  <div className="space-y-3 text-[12px]">
                    {[
                      ["Scope", selectedMachine.advertiseScope ?? "Not reported"],
                      ["Registered", selectedMachine.registeredAtLabel ?? "Not reported"],
                      ["Seen", selectedMachine.lastSeenLabel ?? "Not reported"],
                      ["Labels", selectedMachine.labels.length ? selectedMachine.labels.join(", ") : "None"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                        <div style={s.inkText}>{value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Projects</div>
                  {selectedMachine.projectRoots.length > 0 ? (
                    <div className="space-y-2">
                      {selectedMachine.projectRoots.map((projectRoot) => (
                        <div key={projectRoot} className="flex items-center gap-2 text-[12px]" style={s.inkText}>
                          <HardDrive size={12} style={s.mutedText} />
                          <span className="truncate">{projectRoot}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12px]" style={s.mutedText}>
                      No project roots reported for this node yet.
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center px-8 text-center">
            <div>
              <div className="text-[15px] font-medium mb-2" style={s.inkText}>No machines visible</div>
              <div className="text-[12px]" style={s.mutedText}>
                Start the broker and register a node to inspect servers and workstations here.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
