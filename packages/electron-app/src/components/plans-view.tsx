"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  FolderOpen,
  GitBranch,
  ListTodo,
  Loader2,
  RefreshCw,
  Target,
} from "lucide-react";

import type { DesktopPlan, DesktopPlansState, DesktopTask } from "@/lib/openscout-desktop";

type ThemePalette = Record<string, string>;
type ThemeStyles = {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  activeItem: React.CSSProperties;
  tagBadge: React.CSSProperties;
};

type PlansViewProps = {
  plansState: DesktopPlansState;
  C: ThemePalette;
  s: ThemeStyles;
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent) => void;
  onOpenRelayAgent: (agentId: string) => void;
  onRefresh: () => void;
  identityColor: (identity: string) => string;
};

function taskStatusMeta(task: DesktopTask, C: ThemePalette) {
  switch (task.status) {
    case "running":
      return {
        icon: Loader2,
        pill: { backgroundColor: "rgba(59, 130, 246, 0.12)", color: "#2563eb" },
      };
    case "completed":
      return {
        icon: CheckCircle2,
        pill: { backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#059669" },
      };
    case "failed":
      return {
        icon: AlertCircle,
        pill: { backgroundColor: "rgba(239, 68, 68, 0.12)", color: "#dc2626" },
      };
    case "queued":
      return {
        icon: Circle,
        pill: { backgroundColor: C.tagBg, color: C.muted },
      };
  }
}

function planStatusStyle(plan: DesktopPlan, C: ThemePalette): React.CSSProperties {
  switch (plan.status) {
    case "completed":
      return { backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#059669" };
    case "in-progress":
      return { backgroundColor: "rgba(59, 130, 246, 0.12)", color: "#2563eb" };
    case "awaiting-review":
      return { backgroundColor: "rgba(245, 158, 11, 0.14)", color: "#d97706" };
    case "paused":
      return { backgroundColor: "rgba(148, 163, 184, 0.18)", color: "#475569" };
    case "draft":
      return { backgroundColor: C.tagBg, color: C.muted };
  }
}

export default function PlansView({
  plansState,
  C,
  s,
  isCollapsed,
  sidebarWidth,
  onResizeStart,
  onOpenRelayAgent,
  onRefresh,
  identityColor,
}: PlansViewProps) {
  const [mode, setMode] = useState<"tasks" | "plans">("tasks");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");

  const taskAgents = useMemo(
    () => Array.from(new Set(plansState.tasks.map((task) => task.targetAgentName))).sort(),
    [plansState.tasks],
  );

  const filteredTasks = useMemo(
    () => selectedAgent === "all"
      ? plansState.tasks
      : plansState.tasks.filter((task) => task.targetAgentName === selectedAgent),
    [plansState.tasks, selectedAgent],
  );

  const filteredPlans = useMemo(
    () => selectedAgent === "all"
      ? plansState.plans
      : plansState.plans.filter((plan) => plan.agent === selectedAgent || plan.twinId === selectedAgent.toLowerCase()),
    [plansState.plans, selectedAgent],
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {!isCollapsed ? (
        <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
          <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={onResizeStart} />
          <div className="px-4 h-14 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
            <div>
              <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Plans & Tasks</h1>
              <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                {plansState.taskCount} asks · {plansState.planCount} plans
              </div>
            </div>
            <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={onRefresh}>
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="p-3 border-b grid grid-cols-2 gap-2" style={{ borderColor: C.border }}>
            {[
              { label: "Running", value: plansState.runningTaskCount },
              { label: "Plans", value: plansState.planCount },
              { label: "Failed", value: plansState.failedTaskCount },
              { label: "Workspaces", value: plansState.workspaceCount },
            ].map((stat) => (
              <div key={stat.label} className="p-2 rounded" style={{ backgroundColor: C.surface }}>
                <div className="text-[8px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{stat.label}</div>
                <div className="text-[16px] font-semibold" style={s.inkText}>{stat.value}</div>
              </div>
            ))}
          </div>
          <div className="px-3 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { mode: "tasks" as const, label: "Tasks", icon: ListTodo },
                { mode: "plans" as const, label: "Plans", icon: FolderOpen },
              ].map((item) => {
                const Icon = item.icon;
                return (
                <button
                  key={item.mode}
                  onClick={() => setMode(item.mode)}
                  className="border rounded-lg px-3 py-2 text-[11px] font-medium flex items-center gap-2 justify-center"
                  style={mode === item.mode ? s.activeItem : { ...s.surface, borderColor: C.border, color: C.ink }}
                >
                  <Icon size={12} />
                  {item.label}
                </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="font-mono text-[9px] tracking-widest uppercase mb-2 px-2" style={s.mutedText}>Agents</div>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedAgent("all")}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium"
                style={selectedAgent === "all" ? s.activeItem : s.mutedText}
              >
                All Agents
              </button>
              {taskAgents.map((agent) => (
                <button
                  key={agent}
                  onClick={() => setSelectedAgent(agent)}
                  className="w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium flex items-center gap-2"
                  style={selectedAgent === agent ? s.activeItem : s.mutedText}
                >
                  <div className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold" style={{ backgroundColor: identityColor(agent) }}>
                    {agent.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate">{agent}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {isCollapsed ? (
          <div className="px-6 py-4 border-b flex items-center gap-2 overflow-x-auto" style={{ borderColor: C.border }}>
            {[
              ["tasks", "Tasks"],
              ["plans", "Plans"],
            ].map(([nextMode, label]) => (
              <button
                key={nextMode}
                onClick={() => setMode(nextMode as "tasks" | "plans")}
                className="os-btn border rounded-lg px-3 py-2 text-[11px] font-medium whitespace-nowrap"
                style={mode === nextMode ? s.activeItem : { ...s.surface, borderColor: C.border, color: C.ink }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="px-8 py-8 space-y-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Control Plane Queue</div>
              <h1 className="text-[26px] font-semibold tracking-tight mb-2" style={s.inkText}>
                {mode === "tasks" ? "Recent Agent Asks" : "Workspace Plans"}
              </h1>
              <div className="text-[13px] leading-[1.7] max-w-2xl" style={s.mutedText}>
                {mode === "tasks"
                  ? "These are the operator asks currently flowing through Relay, resolved against live reply and status signals."
                  : "Plan files are loaded from registered twin workspaces under plans/ or .openscout/plans/ so each project can keep its own roadmap."}
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
              { label: "Running", value: plansState.runningTaskCount, icon: Loader2 },
              { label: "Completed", value: plansState.completedTaskCount, icon: CheckCircle2 },
              { label: "Failed", value: plansState.failedTaskCount, icon: AlertCircle },
              { label: "Plans", value: plansState.planCount, icon: Target },
            ].map((stat) => (
              <div key={stat.label} className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-2" style={s.mutedText}>
                  <stat.icon size={14} className={stat.label === "Running" ? "animate-spin" : ""} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">{stat.label}</span>
                </div>
                <div className="text-[22px] font-semibold" style={s.inkText}>{stat.value}</div>
              </div>
            ))}
          </div>

          {mode === "tasks" ? (
            <div className="space-y-4">
              {filteredTasks.length > 0 ? filteredTasks.map((task) => {
                const meta = taskStatusMeta(task, C);
                const StatusIcon = meta.icon;

                return (
                  <div key={task.id} className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5" style={{ color: meta.pill.color }}>
                          <StatusIcon size={18} className={task.status === "running" ? "animate-spin" : ""} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <div className="text-[15px] font-semibold" style={s.inkText}>{task.title}</div>
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={meta.pill}>
                              {task.statusLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] flex-wrap mb-3" style={s.mutedText}>
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold" style={{ backgroundColor: identityColor(task.targetAgentId) }}>
                                {task.targetAgentName.charAt(0).toUpperCase()}
                              </div>
                              <span>{task.targetAgentName}</span>
                            </div>
                            {task.project ? <span className="font-mono">{task.project}</span> : null}
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {task.ageLabel}
                            </span>
                          </div>
                          <div className="text-[12px] leading-[1.7]" style={s.mutedText}>
                            {task.statusDetail}
                          </div>
                          {task.replyPreview ? (
                            <div className="mt-3 border rounded-lg px-3 py-2 text-[12px] leading-[1.7]" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.muted }}>
                              {task.replyPreview}
                            </div>
                          ) : null}
                          {task.projectRoot ? (
                            <div className="mt-3 text-[10px] font-mono" style={s.mutedText}>
                              {task.projectRoot}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <button
                        onClick={() => onOpenRelayAgent(task.targetAgentId)}
                        className="text-[11px] font-medium flex items-center gap-1 shrink-0"
                        style={{ color: C.accent }}
                      >
                        Open Relay <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="border rounded-xl p-8 text-center" style={{ ...s.surface, borderColor: C.border, color: C.muted }}>
                  No task-like asks are visible yet.
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-5">
              {filteredPlans.length > 0 ? filteredPlans.map((plan) => (
                <div key={`${plan.workspacePath}:${plan.path}`} className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="text-[15px] font-semibold mb-1" style={s.inkText}>{plan.title}</div>
                      <div className="text-[11px] flex items-center gap-2 flex-wrap" style={s.mutedText}>
                        <span className="flex items-center gap-1">
                          <GitBranch size={10} />
                          {plan.twinId}
                        </span>
                        <span>{plan.workspaceName}</span>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0" style={planStatusStyle(plan, C)}>
                      {plan.status}
                    </span>
                  </div>
                  <div className="text-[12px] leading-[1.7] mb-4" style={s.mutedText}>
                    {plan.summary}
                  </div>
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>
                      <span>Progress</span>
                      <span>{plan.stepsCompleted}/{plan.stepsTotal || 0}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
                      <div className="h-full rounded-full" style={{ width: `${plan.progressPercent}%`, backgroundColor: C.accent }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div>
                      <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Updated</div>
                      <div style={s.inkText}>{plan.updatedAtLabel}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>File</div>
                      <div style={s.inkText}>{plan.path}</div>
                    </div>
                  </div>
                  {plan.tags.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {plan.tags.map((tag) => (
                        <span key={tag} className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="col-span-2 border rounded-xl p-8 text-center" style={{ ...s.surface, borderColor: C.border, color: C.muted }}>
                  <div className="text-[14px] font-medium mb-2" style={s.inkText}>No plan files found</div>
                  <div className="text-[12px] leading-[1.7]">
                    Add Markdown plans under <span className="font-mono">plans/</span> or <span className="font-mono">.openscout/plans/</span> in a registered twin workspace and they will appear here.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
