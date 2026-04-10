"use client";

import React from "react";
import { C } from "@/lib/theme";
import type {
  AgentConfigState,
  InterAgentAgent,
} from "@/lib/scout-desktop";

export type AgentSettingsViewStyles = {
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
};

type AgentConfigUpdater = (updater: (current: AgentConfigState) => AgentConfigState) => void;

export function AgentSettingsView({
  styles,
  selectedInterAgent,
  availableAgents,
  isAgentConfigEditing,
  hasEditableAgentConfig,
  agentConfigLoading,
  agentConfigSaving,
  agentConfigRestarting,
  visibleAgentConfig,
  agentConfigFeedback,
  agentCapabilitiesPreview,
  agentRuntimePathRef,
  onOpenAgents,
  onOpenAgentProfile,
  onOpenAgentThread,
  onUpdateAgentConfigDraft,
  renderLocalPathValue,
  interAgentProfileKindLabel,
  onSelectAgent,
}: {
  styles: AgentSettingsViewStyles;
  selectedInterAgent: InterAgentAgent | null;
  availableAgents: InterAgentAgent[];
  isAgentConfigEditing: boolean;
  hasEditableAgentConfig: boolean;
  agentConfigLoading: boolean;
  agentConfigSaving: boolean;
  agentConfigRestarting: boolean;
  visibleAgentConfig: AgentConfigState | null;
  agentConfigFeedback: string | null;
  agentCapabilitiesPreview: string[];
  agentRuntimePathRef: React.RefObject<HTMLInputElement | null>;
  onOpenAgents: () => void;
  onOpenAgentProfile: (agentId: string) => void;
  onOpenAgentThread: (agentId: string) => void;
  onUpdateAgentConfigDraft: AgentConfigUpdater;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
  interAgentProfileKindLabel: (profileKind: InterAgentAgent["profileKind"]) => string;
  onSelectAgent: (agentId: string) => void;
}) {
  const selectedAgentId = selectedInterAgent?.id ?? null;
  const agentList = (
    <section className="border rounded-xl p-3" style={{ ...styles.surface, borderColor: C.border }}>
      <div className="flex items-center justify-between gap-3 px-2 pt-2 mb-2">
        <div>
          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>
            Agent List
          </div>
          <div className="text-[11px] mt-1" style={styles.mutedText}>
            {availableAgents.length > 0
              ? "Pick the agent you want to configure."
              : "No agents available yet."}
          </div>
        </div>
        {availableAgents.length > 0 ? (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0" style={styles.tagBadge}>
            {availableAgents.length}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {availableAgents.length > 0 ? availableAgents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          return (
            <button
              key={agent.id}
              type="button"
              className="rounded-lg border px-3 py-2 text-left transition-opacity hover:opacity-90"
              style={{
                borderColor: isSelected ? C.accent : C.border,
                backgroundColor: isSelected ? C.surface : C.bg,
              }}
              onClick={() => onSelectAgent(agent.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium truncate" style={styles.inkText}>{agent.title}</div>
                  <div className="text-[10px] mt-0.5 truncate" style={styles.mutedText}>
                    {interAgentProfileKindLabel(agent.profileKind)} · {agent.statusDetail ?? agent.summary ?? "No status reported."}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isSelected ? (
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={styles.activePill}>
                      Selected
                    </span>
                  ) : null}
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={agent.state === "working" ? styles.activePill : styles.tagBadge}>
                    {agent.statusLabel}
                  </span>
                </div>
              </div>
            </button>
          );
        }) : (
          <div className="px-3 py-6 text-[11px] text-center" style={styles.mutedText}>
            No agents available yet.
          </div>
        )}
      </div>
      <div className="mt-3 px-2 pb-2">
        <button
          type="button"
          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
          style={{ color: C.ink }}
          onClick={onOpenAgents}
        >
          Open Agents
        </button>
      </div>
    </section>
  );

  if (!selectedInterAgent) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)] gap-4 min-w-0">
        <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
          <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>
            Agent Settings
          </div>
          <div className="text-[18px] font-semibold tracking-tight" style={styles.inkText}>
            Select an agent
          </div>
          <div className="text-[12px] mt-2 leading-[1.6]" style={styles.mutedText}>
            Agent configuration lives here now. Pick an agent from the list to edit its runtime, tools, and capabilities.
          </div>
        </section>
        <div className="space-y-4 min-w-0">
          {agentList}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Selected Agent</div>
            <div className="text-[18px] font-semibold tracking-tight mt-1.5" style={styles.inkText}>{selectedInterAgent.title}</div>
            <div className="text-[12px] mt-2 leading-[1.6]" style={styles.mutedText}>
              {interAgentProfileKindLabel(selectedInterAgent.profileKind)} · {selectedInterAgent.statusDetail ?? selectedInterAgent.summary ?? "No status reported."}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
              onClick={() => onOpenAgentThread(selectedInterAgent.id)}
            >
              Message
            </button>
            <button
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
              onClick={() => onOpenAgentProfile(selectedInterAgent.id)}
            >
              Show in Agents
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
        <div className="space-y-4 min-w-0">
          <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Runtime</div>
            {agentConfigLoading ? (
              <div className="text-[11px]" style={styles.mutedText}>Loading runtime…</div>
            ) : isAgentConfigEditing ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Path</div>
                  <input
                    ref={agentRuntimePathRef}
                    value={visibleAgentConfig?.runtime.cwd ?? ""}
                    onChange={(event) => {
                      onUpdateAgentConfigDraft((current) => ({
                        ...current,
                        runtime: {
                          ...current.runtime,
                          cwd: event.target.value,
                        },
                      }));
                    }}
                    readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                    className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                    style={{ borderColor: C.border, color: C.ink }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Harness</div>
                    <select
                      value={visibleAgentConfig?.runtime.harness ?? ""}
                      onChange={(event) => {
                        onUpdateAgentConfigDraft((current) => ({
                          ...current,
                          runtime: {
                            ...current.runtime,
                            harness: event.target.value,
                          },
                        }));
                      }}
                      disabled={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                      className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    >
                      {visibleAgentConfig?.availableHarnesses.map((harness) => (
                        <option key={harness} value={harness}>{harness}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Session</div>
                    <input
                      value={visibleAgentConfig?.runtime.sessionId ?? ""}
                      onChange={(event) => {
                        onUpdateAgentConfigDraft((current) => ({
                          ...current,
                          runtime: {
                            ...current.runtime,
                            sessionId: event.target.value,
                          },
                        }));
                      }}
                      readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                      className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  </div>
                  <div>
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Mode</div>
                    <select
                      value={visibleAgentConfig?.runtime.transport === "tmux" ? "interactive" : "async"}
                      onChange={(event) => {
                        onUpdateAgentConfigDraft((current) => ({
                          ...current,
                          runtime: {
                            ...current.runtime,
                            transport: event.target.value === "interactive" ? "tmux" : "claude_stream_json",
                          },
                        }));
                      }}
                      disabled={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                      className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    >
                      <option value="async">Async</option>
                      <option value="interactive">Interactive (PTY)</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <dl>
                {[
                  ["Path", visibleAgentConfig?.runtime.cwd ?? selectedInterAgent.projectRoot ?? selectedInterAgent.cwd ?? "Not reported"],
                  ["Harness", visibleAgentConfig?.runtime.harness ?? selectedInterAgent.harness ?? "Not reported"],
                  ["Session", visibleAgentConfig?.runtime.sessionId ?? selectedInterAgent.sessionId ?? "Not reported"],
                  ["Mode", (() => { const transport = visibleAgentConfig?.runtime.transport ?? selectedInterAgent.transport; return transport === "tmux" ? "Interactive (PTY)" : "Async"; })()],
                  ["Wake policy", visibleAgentConfig?.runtime.wakePolicy || selectedInterAgent.wakePolicy || "Not reported"],
                  ["Live runtime", selectedInterAgent.projectRoot ?? selectedInterAgent.cwd ?? "Not reported"],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 py-2.5 border-b last:border-b-0" style={{ borderColor: C.border }}>
                    <dt className="text-[9px] font-mono uppercase tracking-widest shrink-0 sm:w-[7.5rem]" style={styles.mutedText}>{label}</dt>
                    <dd className="text-[11px] leading-[1.45] break-words min-w-0 text-left sm:text-right sm:max-w-[70%]">
                      <span style={styles.inkText}>
                        {label === "Path" || label === "Live runtime"
                          ? renderLocalPathValue(String(value), {
                            className: "text-left sm:text-right underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity",
                          })
                          : value}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Tool Use</div>
            {isAgentConfigEditing ? (
              <textarea
                value={visibleAgentConfig?.toolUse.launchArgsText ?? ""}
                onChange={(event) => {
                  onUpdateAgentConfigDraft((current) => ({
                    ...current,
                    toolUse: {
                      ...current.toolUse,
                      launchArgsText: event.target.value,
                    },
                  }));
                }}
                readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                className="w-full min-h-[132px] rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.5] resize-y bg-transparent outline-none"
                style={{ borderColor: C.border, color: C.ink }}
              />
            ) : (
              <div className="rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.55] whitespace-pre-wrap break-words min-h-[88px]" style={{ borderColor: C.border, color: C.ink }}>
                {visibleAgentConfig
                  ? (normalizeDraftText(visibleAgentConfig.toolUse.launchArgsText) || "No launch args configured.")
                  : "Launch args load on demand when editing this agent."}
              </div>
            )}
          </section>

          <section className="border rounded-xl p-5" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Capabilities</div>
            {isAgentConfigEditing ? (
              <input
                value={visibleAgentConfig?.capabilitiesText ?? ""}
                onChange={(event) => {
                  onUpdateAgentConfigDraft((current) => ({
                    ...current,
                    capabilitiesText: event.target.value,
                  }));
                }}
                readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                style={{ borderColor: C.border, color: C.ink }}
              />
            ) : null}
            {agentCapabilitiesPreview.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {agentCapabilitiesPreview.map((capability) => (
                  <span key={capability} className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={styles.tagBadge}>
                    {capability}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px]" style={styles.mutedText}>No capabilities configured.</div>
            )}
            {agentConfigFeedback ? (
              <div className="text-[11px] mt-2 leading-[1.5]" style={styles.inkText}>{agentConfigFeedback}</div>
            ) : null}
          </section>
        </div>
        <div className="space-y-4 min-w-0">
          {agentList}
        </div>
      </div>
    </div>
  );
}

function normalizeDraftText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}
