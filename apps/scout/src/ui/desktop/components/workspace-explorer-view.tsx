"use client";

import React from "react";
import {
  Clock,
  FolderOpen,
  GitBranch,
  Grid3x3,
  List,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { C } from "@/lib/theme";
import type {
  InterAgentAgent,
  OnboardingCommandName,
  SetupProjectSummary,
} from "@/lib/scout-desktop";
import type { AgentSettingsViewStyles } from "@/components/agent-settings-view";

type WorkspaceExplorerFilterTab = "all" | "bound" | "discovered";
type WorkspaceExplorerViewMode = "grid" | "list";

type WorkspaceExplorerItem = {
  project: SetupProjectSummary;
  linkedAgent: InterAgentAgent | null;
  isBound: boolean;
  primaryHarness: string;
  pathLabel: string;
  branchLabel: string;
  activityLabel: string;
  statusLabel: string;
};

export function WorkspaceExplorerView({
  styles,
  selectedWorkspaceProject,
  selectedWorkspaceAgent,
  workspaceExplorerQuery,
  setWorkspaceExplorerQuery,
  workspaceExplorerFilter,
  setWorkspaceExplorerFilter,
  workspaceExplorerViewMode,
  setWorkspaceExplorerViewMode,
  workspaceExplorerItems,
  workspaceExplorerBoundCount,
  workspaceExplorerDiscoveredCount,
  filteredWorkspaceExplorerItems,
  workspaceInventoryLoaded,
  workspaceInventoryLoading,
  canRefreshWorkspaceInventory,
  onboardingCommandPending,
  appSettingsLoading,
  appSettingsSaving,
  appSettingsDirty,
  appSettingsFeedback,
  showDoctorOutput,
  doctorOutput,
  projectRetirementPendingRoot,
  onRefreshWorkspaceDiscovery,
  onLoadWorkspaceInventory,
  onAddWorkspace,
  onInspectWorkspace,
  onOpenWorkspace,
  onRetireWorkspace,
  onOpenAgentProfile,
  onOpenAgentSettings,
  renderLocalPathValue,
}: {
  styles: AgentSettingsViewStyles;
  selectedWorkspaceProject: SetupProjectSummary | null;
  selectedWorkspaceAgent: InterAgentAgent | null;
  workspaceExplorerQuery: string;
  setWorkspaceExplorerQuery: React.Dispatch<React.SetStateAction<string>>;
  workspaceExplorerFilter: WorkspaceExplorerFilterTab;
  setWorkspaceExplorerFilter: React.Dispatch<React.SetStateAction<WorkspaceExplorerFilterTab>>;
  workspaceExplorerViewMode: WorkspaceExplorerViewMode;
  setWorkspaceExplorerViewMode: React.Dispatch<React.SetStateAction<WorkspaceExplorerViewMode>>;
  workspaceExplorerItems: WorkspaceExplorerItem[];
  workspaceExplorerBoundCount: number;
  workspaceExplorerDiscoveredCount: number;
  filteredWorkspaceExplorerItems: WorkspaceExplorerItem[];
  workspaceInventoryLoaded: boolean;
  workspaceInventoryLoading: boolean;
  canRefreshWorkspaceInventory: boolean;
  onboardingCommandPending: OnboardingCommandName | null;
  appSettingsLoading: boolean;
  appSettingsSaving: boolean;
  appSettingsDirty: boolean;
  appSettingsFeedback: string | null;
  showDoctorOutput: boolean;
  doctorOutput: React.ReactNode;
  projectRetirementPendingRoot: string | null;
  onRefreshWorkspaceDiscovery: () => void;
  onLoadWorkspaceInventory: () => void;
  onAddWorkspace: () => void;
  onInspectWorkspace: (project: SetupProjectSummary) => void;
  onOpenWorkspace: (project: SetupProjectSummary) => void;
  onRetireWorkspace: (project: SetupProjectSummary) => void;
  onOpenAgentProfile: (agentId: string) => void;
  onOpenAgentSettings: (agentId: string) => void;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
}) {
  return (
    <div className="max-w-6xl px-8 py-6 space-y-4">
      <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>
              Workspace Discovery
            </div>
            <div className="text-[18px] font-semibold tracking-tight" style={styles.inkText}>Workspace Explorer</div>
            <div className="text-[12px] mt-1 leading-[1.6]" style={styles.mutedText}>
              Discover local projects, inspect harness readiness, and jump into the bound agent when one already exists.
            </div>
          </div>
          <div className="hidden xl:flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onRefreshWorkspaceDiscovery}
              disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsSaving || appSettingsDirty}
            >
              {onboardingCommandPending === "doctor" ? <Spinner className="text-[14px]" /> : <RefreshCw className="h-4 w-4" />}
              {onboardingCommandPending === "doctor" ? "Scanning…" : "Refresh"}
            </Button>
            <Button size="sm" className="gap-2" onClick={onAddWorkspace}>
              <Plus className="h-4 w-4" />
              Add Workspace
            </Button>
          </div>
        </div>
      </section>

      <section className="border rounded-xl overflow-hidden" style={{ ...styles.surface, borderColor: C.border }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, var(--os-bg) 82%, transparent)" }}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative w-full xl:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.muted }} />
                <Input
                  placeholder="Search workspaces..."
                  value={workspaceExplorerQuery}
                  onChange={(event) => setWorkspaceExplorerQuery(event.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                {[
                  ["all", "All", workspaceExplorerItems.length],
                  ["bound", "Bound", workspaceExplorerBoundCount],
                  ["discovered", "Discovered", workspaceExplorerDiscoveredCount],
                ].map(([id, label, count]) => {
                  const active = workspaceExplorerFilter === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                      style={{
                        backgroundColor: active ? C.surface : "transparent",
                        color: active ? C.ink : C.muted,
                        boxShadow: active ? C.shadowXs : "none",
                      }}
                      onClick={() => setWorkspaceExplorerFilter(id as WorkspaceExplorerFilterTab)}
                    >
                      <span className="flex items-center gap-1.5">
                        {id === "bound" ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                        {label}
                        <span style={{ color: C.muted }}>{count}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <button
                  type="button"
                  className="rounded-md p-1.5 transition-colors"
                  style={{ backgroundColor: workspaceExplorerViewMode === "grid" ? C.surface : "transparent", color: workspaceExplorerViewMode === "grid" ? C.ink : C.muted }}
                  onClick={() => setWorkspaceExplorerViewMode("grid")}
                  title="Grid view"
                >
                  <Grid3x3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 transition-colors"
                  style={{ backgroundColor: workspaceExplorerViewMode === "list" ? C.surface : "transparent", color: workspaceExplorerViewMode === "list" ? C.ink : C.muted }}
                  onClick={() => setWorkspaceExplorerViewMode("list")}
                  title="List view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>

              <div className="xl:hidden flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={onRefreshWorkspaceDiscovery}
                  disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsSaving || appSettingsDirty}
                >
                  {onboardingCommandPending === "doctor" ? <Spinner className="text-[14px]" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
                <Button size="sm" className="gap-2" onClick={onAddWorkspace}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          {!workspaceInventoryLoaded ? (
            <div
              className="flex flex-col items-stretch rounded-xl border border-dashed px-6 py-10 text-center"
              style={{ borderColor: C.border }}
              aria-busy={workspaceInventoryLoading}
            >
              <div className="flex flex-col items-center max-w-lg mx-auto">
                {workspaceInventoryLoading ? <Spinner className="text-[28px] mb-3" style={{ color: C.muted, opacity: 0.7 }} /> : <FolderOpen className="h-8 w-8 mb-3" style={{ color: C.muted, opacity: 0.5 }} />}
                <div className="text-[13px] font-medium mb-1" style={styles.inkText}>
                  {workspaceInventoryLoading ? "Loading workspaces…" : "Workspace inventory is not loaded yet"}
                </div>
                <div className="text-[11px] mb-5 max-w-md leading-[1.6]" style={styles.mutedText}>
                  Scan folders and project manifests are read when you load this list. Use General to edit scan roots first if discovery looks empty.
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2"
                  onClick={onLoadWorkspaceInventory}
                  disabled={workspaceInventoryLoading || !canRefreshWorkspaceInventory}
                >
                  {workspaceInventoryLoading ? <Spinner className="text-[14px]" /> : <RefreshCw className="h-4 w-4" />}
                  Load Workspaces
                </Button>
              </div>
              {workspaceInventoryLoading ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 mt-8 w-full">
                  {[0, 1, 2].map((slot) => (
                    <div
                      key={`ws-skel-${slot}`}
                      className="h-[88px] rounded-xl border animate-pulse"
                      style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, var(--os-bg) 70%, transparent)" }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : filteredWorkspaceExplorerItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center" style={{ borderColor: C.border }}>
              <FolderOpen className="h-8 w-8 mb-3" style={{ color: C.muted, opacity: 0.5 }} />
              <div className="text-[13px] font-medium mb-1" style={styles.inkText}>No workspaces found</div>
              <div className="text-[11px] mb-4 max-w-md leading-[1.6]" style={styles.mutedText}>
                {workspaceExplorerQuery
                  ? "Try a different search term or filter."
                  : "Add scan directories in General settings, then refresh to discover workspaces."}
              </div>
              <Button
                variant="outline"
                className="gap-2"
                onClick={onRefreshWorkspaceDiscovery}
                disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsSaving || appSettingsDirty}
              >
                {onboardingCommandPending === "doctor" ? <Spinner className="text-[14px]" /> : <RefreshCw className="h-4 w-4" />}
                Scan Workspaces
              </Button>
            </div>
          ) : workspaceExplorerViewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filteredWorkspaceExplorerItems.map((item) => (
                <WorkspaceExplorerCard
                  key={item.project.id}
                  item={item}
                  isSelected={selectedWorkspaceProject?.id === item.project.id}
                  onSelect={() => onInspectWorkspace(item.project)}
                  onPrimaryAction={() => onOpenWorkspace(item.project)}
                  onSecondaryAction={() => onRetireWorkspace(item.project)}
                  secondaryActionPending={projectRetirementPendingRoot === item.project.root}
                />
              ))}
            </div>
          ) : (
            <WorkspaceExplorerTable
              items={filteredWorkspaceExplorerItems}
              selectedWorkspaceId={selectedWorkspaceProject?.id ?? null}
              onSelectWorkspace={onInspectWorkspace}
              onPrimaryAction={onOpenWorkspace}
              onSecondaryAction={onRetireWorkspace}
              projectRetirementPendingRoot={projectRetirementPendingRoot}
            />
          )}
        </div>
      </section>

      {appSettingsFeedback ? (
        <div className="text-[11px] leading-[1.5]" style={styles.inkText}>{appSettingsFeedback}</div>
      ) : null}

      {showDoctorOutput ? (
        <div className="space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>Scan Results</div>
          {doctorOutput}
        </div>
      ) : null}

      {!selectedWorkspaceProject ? (
        <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
          <div className="text-[13px] font-medium mb-1" style={styles.inkText}>Select a workspace</div>
          <div className="text-[12px] leading-[1.6]" style={styles.mutedText}>
            Choose a workspace above to inspect its project details, harness evidence, and any bound agent.
          </div>
        </section>
      ) : (
        <>
          <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Workspace Details</div>
                <div className="text-[18px] font-semibold tracking-tight mt-1.5" style={styles.inkText}>{selectedWorkspaceProject.title}</div>
                <div className="text-[12px] mt-2 leading-[1.6]" style={styles.mutedText}>
                  {selectedWorkspaceAgent ? "Bound workspace with an existing agent." : "Discovered workspace. No bound agent is attached yet."}
                </div>
              </div>
              <button
                type="button"
                className="os-toolbar-button text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50 shrink-0"
                style={{ color: C.ink }}
                onClick={() => onRetireWorkspace(selectedWorkspaceProject)}
                disabled={Boolean(projectRetirementPendingRoot)}
              >
                {projectRetirementPendingRoot === selectedWorkspaceProject.root ? "Retiring…" : "Retire Workspace"}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
            <section className="border rounded-xl p-5 min-w-0" style={{ ...styles.surface, borderColor: C.border }}>
              <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Workspace Summary</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {[
                  ["Workspace", selectedWorkspaceProject.projectName],
                  ["Agent ID", selectedWorkspaceProject.definitionId],
                  ["Root", selectedWorkspaceProject.root],
                  ["Source Root", selectedWorkspaceProject.sourceRoot],
                  ["Relative Path", selectedWorkspaceProject.relativePath],
                  ["Default Harness", selectedWorkspaceProject.defaultHarness],
                  ["Registration", selectedWorkspaceProject.registrationKind],
                  ["Manifest", selectedWorkspaceProject.projectConfigPath ?? "Not created"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>{label}</div>
                    <div className="text-[11px] leading-[1.45] break-words" style={styles.inkText}>
                      {label === "Root" || label === "Source Root" || label === "Manifest"
                        ? renderLocalPathValue(String(value), {
                          className: "text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity",
                        })
                        : value}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-4 min-w-0">
              {selectedWorkspaceAgent ? (
                <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Bound Agent</div>
                  <div className="text-[14px] font-medium" style={styles.inkText}>{selectedWorkspaceAgent.title}</div>
                  <div className="text-[11px] mt-1 leading-[1.6]" style={styles.mutedText}>
                    {selectedWorkspaceAgent.profileKind} · {selectedWorkspaceAgent.statusDetail ?? selectedWorkspaceAgent.summary ?? "No status reported."}
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      type="button"
                      className="os-toolbar-button text-[10px] font-medium px-2 py-1 rounded"
                      style={{ color: C.ink }}
                      onClick={() => onOpenAgentProfile(selectedWorkspaceAgent.id)}
                    >
                      Open Agent
                    </button>
                    <button
                      type="button"
                      className="os-toolbar-button text-[10px] font-medium px-2 py-1 rounded"
                      style={{ color: C.ink }}
                      onClick={() => onOpenAgentSettings(selectedWorkspaceAgent.id)}
                    >
                      Edit Agent
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Harness Evidence</div>
                <div className="space-y-2">
                  {selectedWorkspaceProject.harnesses.map((entry) => (
                    <div key={`${entry.harness}-${entry.source}`} className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium" style={styles.inkText}>{entry.harness}</div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={entry.readinessState === "ready" ? styles.activePill : styles.tagBadge}>
                          {entry.source}
                        </span>
                      </div>
                      <div className="text-[10px] mt-1 leading-[1.5]" style={styles.mutedText}>{entry.detail}</div>
                      {entry.readinessDetail ? (
                        <div className="text-[10px] mt-1 leading-[1.5]" style={styles.mutedText}>{entry.readinessDetail}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const sStatic = {
  ink: { color: C.ink } as React.CSSProperties,
  muted: { color: C.muted } as React.CSSProperties,
};

function WorkspaceExplorerCard({
  item,
  isSelected,
  onSelect,
  onPrimaryAction,
  onSecondaryAction,
  secondaryActionPending,
}: {
  item: WorkspaceExplorerItem;
  isSelected: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
  secondaryActionPending: boolean;
}) {
  const { project, isBound, primaryHarness, pathLabel, branchLabel, activityLabel, statusLabel } = item;
  const initial = project.title.trim().charAt(0).toUpperCase() || "W";
  const statusTone = isBound
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
    : project.registrationKind === "configured"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700"
      : "border-border bg-secondary text-secondary-foreground";

  return (
    <div
      className={cn(
        "os-card rounded-xl border p-4 cursor-pointer",
        isSelected ? "ring-1 ring-[color:var(--os-accent)]" : "",
      )}
      style={{ borderColor: isSelected ? C.accent : C.border, backgroundColor: C.surface, boxShadow: isSelected ? C.shadowSm : undefined }}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold",
            isBound ? "bg-emerald-500/10 text-emerald-700" : "bg-secondary text-secondary-foreground",
          )}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight tracking-tight" style={sStatic.ink}>{project.title}</div>
          <div className="mt-0.5 truncate text-[10px] font-mono" style={sStatic.muted}>{pathLabel}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-mono text-[10px] capitalize">{primaryHarness}</Badge>
        <Badge className={cn("text-[10px]", statusTone)}>
          {isBound ? <Zap className="h-3 w-3" /> : null}
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px]" style={sStatic.muted}>
        <div className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {branchLabel}
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {activityLabel}
        </div>
      </div>

      <div className="mt-3 border-t pt-3" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <Button
            variant={isBound ? "outline" : "default"}
            size="sm"
            className="flex-1 text-[11px]"
            onClick={(event) => { event.stopPropagation(); onPrimaryAction(); }}
          >
            {isBound ? "Open Agent" : "Inspect"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px]"
            onClick={(event) => { event.stopPropagation(); onSecondaryAction(); }}
            disabled={secondaryActionPending}
          >
            {secondaryActionPending ? "Retiring…" : "Retire"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceExplorerTable({
  items,
  selectedWorkspaceId,
  onSelectWorkspace,
  onPrimaryAction,
  onSecondaryAction,
  projectRetirementPendingRoot,
}: {
  items: WorkspaceExplorerItem[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (project: SetupProjectSummary) => void;
  onPrimaryAction: (project: SetupProjectSummary) => void;
  onSecondaryAction: (project: SetupProjectSummary) => void;
  projectRetirementPendingRoot: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border" style={{ borderColor: C.border, backgroundColor: C.surface }}>
      <table className="w-full">
        <thead>
          <tr style={{ backgroundColor: "color-mix(in srgb, var(--os-bg) 82%, transparent)" }}>
            <th className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-widest" style={sStatic.muted}>Workspace</th>
            <th className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-widest" style={sStatic.muted}>Harness</th>
            <th className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-widest" style={sStatic.muted}>Status</th>
            <th className="px-4 py-3 text-right text-[10px] font-mono uppercase tracking-widest" style={sStatic.muted}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active = selectedWorkspaceId === item.project.id;
            return (
              <tr
                key={item.project.id}
                className="border-t"
                style={{ borderColor: C.border, backgroundColor: active ? "color-mix(in srgb, var(--os-surface) 80%, white)" : "transparent" }}
              >
                <td className="px-4 py-3">
                  <button type="button" onClick={() => onSelectWorkspace(item.project)} className="flex min-w-0 items-center gap-3 text-left">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                        item.isBound ? "bg-emerald-500/10 text-emerald-700" : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {item.project.title.trim().charAt(0).toUpperCase() || "W"}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium" style={sStatic.ink}>{item.project.title}</div>
                      <div className="truncate text-[11px]" style={sStatic.muted}>{item.pathLabel}</div>
                    </div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="font-mono text-[11px] capitalize">{item.primaryHarness}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={cn(
                      "text-[11px]",
                      item.isBound
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                        : item.project.registrationKind === "configured"
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-700"
                          : "border-border bg-secondary text-secondary-foreground",
                    )}
                  >
                    {item.isBound ? <Zap className="h-3 w-3" /> : null}
                    {item.statusLabel}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant={item.isBound ? "outline" : "default"} size="sm" onClick={() => onPrimaryAction(item.project)}>
                      {item.isBound ? "Open" : "Inspect"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onSecondaryAction(item.project)}
                      disabled={projectRetirementPendingRoot === item.project.root}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
