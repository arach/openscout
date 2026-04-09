"use client";

import React from "react";
import { Button } from "@/components/primitives/button";
import { C } from "@/lib/theme";
import type {
  AppSettingsState,
  BrokerControlAction,
  DesktopBrokerInspector,
  DesktopShellState,
} from "@/lib/scout-desktop";
import type { AgentSettingsViewStyles } from "@/components/agent-settings-view";

type AppSettingsUpdater = (updater: (current: AppSettingsState) => AppSettingsState) => void;

export function CommunicationSettingsView({
  styles,
  showTelegram,
  showVoice,
  visibleAppSettings,
  isAppSettingsEditing,
  appSettingsSaving,
  appSettingsFeedback,
  onUpdateAppSettingsDraft,
  brokerInspector,
  brokerControlPending,
  brokerControlFeedback,
  onBrokerControl,
  relayServiceInspectorRef,
  relayRuntimeBooting,
  relayRuntimeHealthLabel,
  runtime,
  reachableRelayAgentCount,
  voiceCaptureTitle,
  voiceRepliesEnabled,
  onSetVoiceRepliesEnabled,
  renderLocalPathValue,
}: {
  styles: AgentSettingsViewStyles;
  showTelegram: boolean;
  showVoice: boolean;
  visibleAppSettings: AppSettingsState | null;
  isAppSettingsEditing: boolean;
  appSettingsSaving: boolean;
  appSettingsFeedback: string | null;
  onUpdateAppSettingsDraft: AppSettingsUpdater;
  brokerInspector: DesktopBrokerInspector | null;
  brokerControlPending: boolean;
  brokerControlFeedback: string | null;
  onBrokerControl: (action: BrokerControlAction) => void;
  relayServiceInspectorRef: React.RefObject<HTMLElement | null>;
  relayRuntimeBooting: boolean;
  relayRuntimeHealthLabel: string;
  runtime: DesktopShellState["runtime"] | null | undefined;
  reachableRelayAgentCount: number;
  voiceCaptureTitle: string;
  voiceRepliesEnabled: boolean;
  onSetVoiceRepliesEnabled: (enabled: boolean) => void;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
}) {
  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-5 min-w-0">
        {showTelegram ? (
          <section className="border rounded-lg p-4" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>Telegram Bridge</div>
                <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm" style={visibleAppSettings?.telegram.running ? styles.activePill : styles.tagBadge}>
                  {visibleAppSettings?.telegram.running ? "Running" : visibleAppSettings?.telegram.enabled ? "Stopped" : "Disabled"}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px]" style={styles.mutedText}>Enabled</span>
                <input
                  type="checkbox"
                  checked={visibleAppSettings?.telegram.enabled ?? false}
                  disabled={!isAppSettingsEditing || appSettingsSaving}
                  onChange={(event) => {
                    onUpdateAppSettingsDraft((current) => ({
                      ...current,
                      telegram: {
                        ...current.telegram,
                        enabled: event.target.checked,
                      },
                    }));
                  }}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Mode</div>
                  {isAppSettingsEditing ? (
                    <select
                      value={visibleAppSettings?.telegram.mode ?? "polling"}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            mode: event.target.value as "auto" | "webhook" | "polling",
                          },
                        }));
                      }}
                      disabled={appSettingsSaving}
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    >
                      <option value="polling">polling</option>
                      <option value="auto">auto</option>
                      <option value="webhook">webhook</option>
                    </select>
                  ) : (
                    <div className="text-[12px] font-medium" style={styles.inkText}>{visibleAppSettings?.telegram.mode ?? "polling"}</div>
                  )}
                </div>

                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Telegram Target</div>
                  {isAppSettingsEditing ? (
                    <input
                      value={visibleAppSettings?.telegram.defaultConversationId ?? "dm.scout.primary"}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            defaultConversationId: event.target.value,
                          },
                        }));
                      }}
                      readOnly={appSettingsSaving}
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  ) : (
                    <div className="text-[13px] font-medium" style={styles.inkText}>{visibleAppSettings?.telegram.defaultConversationId ?? "dm.scout.primary"}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Bot Username</div>
                  {isAppSettingsEditing ? (
                    <input
                      value={visibleAppSettings?.telegram.userName ?? ""}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            userName: event.target.value,
                          },
                        }));
                      }}
                      readOnly={appSettingsSaving}
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  ) : (
                    <div className="text-[12px] font-medium break-words" style={styles.inkText}>{visibleAppSettings?.telegram.userName || "Not set"}</div>
                  )}
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Owner Node</div>
                  {isAppSettingsEditing ? (
                    <input
                      value={visibleAppSettings?.telegram.ownerNodeId ?? ""}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            ownerNodeId: event.target.value,
                          },
                        }));
                      }}
                      readOnly={appSettingsSaving}
                      placeholder="Automatic"
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  ) : (
                    <div className="text-[12px] font-medium break-words" style={styles.inkText}>
                      {visibleAppSettings?.telegram.ownerNodeId || "Automatic"}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Bot Token</div>
                  {isAppSettingsEditing ? (
                    <input
                      type="password"
                      value={visibleAppSettings?.telegram.botToken ?? ""}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            botToken: event.target.value,
                          },
                        }));
                      }}
                      readOnly={appSettingsSaving}
                      placeholder="Telegram bot token"
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  ) : (
                    <div className="text-[11px]" style={styles.inkText}>
                      {visibleAppSettings?.telegram.botToken ? "Configured" : "Not set"}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Webhook Secret</div>
                  {isAppSettingsEditing ? (
                    <input
                      type="password"
                      value={visibleAppSettings?.telegram.secretToken ?? ""}
                      onChange={(event) => {
                        onUpdateAppSettingsDraft((current) => ({
                          ...current,
                          telegram: {
                            ...current.telegram,
                            secretToken: event.target.value,
                          },
                        }));
                      }}
                      readOnly={appSettingsSaving}
                      placeholder="Optional"
                      className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                      style={{ borderColor: C.border, color: C.ink }}
                    />
                  ) : (
                    <div className="text-[11px]" style={styles.inkText}>
                      {visibleAppSettings?.telegram.secretToken ? "Configured" : "Not set"}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>API Base URL</div>
                {isAppSettingsEditing ? (
                  <input
                    value={visibleAppSettings?.telegram.apiBaseUrl ?? ""}
                    onChange={(event) => {
                      onUpdateAppSettingsDraft((current) => ({
                        ...current,
                        telegram: {
                          ...current.telegram,
                          apiBaseUrl: event.target.value,
                        },
                      }));
                    }}
                    readOnly={appSettingsSaving}
                    className="w-full rounded-md border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                    style={{ borderColor: C.border, color: C.ink }}
                  />
                ) : (
                  <div className="text-[12px] font-medium break-words" style={styles.inkText}>{visibleAppSettings?.telegram.apiBaseUrl || "Default Telegram API"}</div>
                )}
              </div>

              {appSettingsFeedback ? (
                <div className="text-[11px] leading-[1.5]" style={styles.inkText}>{appSettingsFeedback}</div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section ref={relayServiceInspectorRef} className="border rounded-lg overflow-hidden" style={{ ...styles.surface, borderColor: C.border }}>
          {brokerInspector ? (
            <>
              <div className="p-4">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>Relay Service</div>
                    <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm" style={brokerInspector.reachable ? styles.activePill : styles.tagBadge}>
                      {brokerInspector.statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant={brokerInspector.reachable ? "outline" : "default"}
                      size="sm"
                      onClick={() => onBrokerControl(brokerInspector.reachable ? "restart" : "start")}
                      disabled={brokerControlPending}
                    >
                      {brokerInspector.reachable ? "Restart" : "Start"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onBrokerControl("stop")}
                      disabled={brokerControlPending || !brokerInspector.loaded}
                    >
                      Stop
                    </Button>
                  </div>
                </div>
                <div className="text-[11px] mb-4 leading-[1.5]" style={styles.mutedText}>
                  {brokerInspector.statusDetail ?? "Service status not reported yet."}
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                  {[
                    ["Relay URL", brokerInspector.url],
                    ["Version", brokerInspector.version ?? "Not reported"],
                    ["Mode", brokerInspector.mode],
                    ["Service Label", brokerInspector.label],
                    ["PID", brokerInspector.pid ?? "Not reported"],
                    ["Last Restart", brokerInspector.lastRestartLabel ?? "Not reported"],
                    ["Launch State", brokerInspector.launchdState ?? "Not reported"],
                    ["Mesh", brokerInspector.meshId ?? "Not reported"],
                    ["Last Exit", brokerInspector.lastExitStatus ?? "Not reported"],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>{label}</div>
                      <div className="text-[11px] leading-[1.45] break-words" style={styles.inkText}>{value}</div>
                    </div>
                  ))}
                </div>
                {brokerInspector.processCommand ? (
                  <div className="mt-3 pt-3 border-t" style={{ borderTopColor: C.border }}>
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>Process</div>
                    <div className="text-[10px] font-mono leading-[1.45] break-all" style={styles.mutedText}>{brokerInspector.processCommand}</div>
                  </div>
                ) : null}
                {brokerControlFeedback ? (
                  <div className="mt-3 pt-3 border-t text-[11px] leading-[1.45]" style={{ borderTopColor: C.border, color: C.ink }}>
                    {brokerControlFeedback}
                  </div>
                ) : null}
              </div>
              <div className="border-t" style={{ borderTopColor: C.border }} />
            </>
          ) : null}

          <div className="px-4 py-3" style={{ backgroundColor: C.bg }}>
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>Runtime</div>
              <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm" style={relayRuntimeBooting || runtime?.brokerHealthy ? styles.activePill : styles.tagBadge}>
                {relayRuntimeHealthLabel}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-x-4 gap-y-2.5">
              {[
                ["Node ID", relayRuntimeBooting ? "Syncing…" : (runtime?.nodeId ?? "Not reported")],
                ["Agents", `${runtime?.agentCount ?? 0}`],
                ["Conversations", `${runtime?.conversationCount ?? 0}`],
                ["Flights", `${runtime?.flightCount ?? 0}`],
                ["Latest Relay", relayRuntimeBooting ? "Syncing…" : (runtime?.latestRelayLabel ?? "Not reported")],
                ["Updated", relayRuntimeBooting ? "Syncing…" : (runtime?.updatedAtLabel ?? "Not reported")],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>{label}</div>
                  <div className="text-[11px] leading-[1.45] break-words" style={styles.inkText}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {brokerInspector ? (
          <section className="border rounded-lg p-4" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-3" style={styles.mutedText}>Relay Paths</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ["Support", brokerInspector.supportDirectory],
                ["Control Home", brokerInspector.controlHome],
                ["LaunchAgent", brokerInspector.launchAgentPath],
                ["Stdout Log", brokerInspector.stdoutLogPath],
                ["Stderr Log", brokerInspector.stderrLogPath],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>{label}</div>
                  <div className="text-[10px] font-mono leading-[1.45] truncate" style={styles.mutedText}>
                    {renderLocalPathValue(String(value), {
                      className: "text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity",
                    })}
                  </div>
                </div>
              ))}
            </div>
            {brokerInspector.lastLogLine ? (
              <div className="mt-3 pt-3 border-t" style={{ borderTopColor: C.border }}>
                <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>Last Service Log</div>
                <div className="text-[10px] font-mono leading-[1.45] break-words" style={styles.mutedText}>{brokerInspector.lastLogLine}</div>
              </div>
            ) : null}
          </section>
        ) : null}

        {brokerInspector && (brokerInspector.troubleshooting.length > 0 || brokerInspector.feedbackSummary) ? (
          <section className="border rounded-lg p-4" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-3" style={styles.mutedText}>Diagnostics</div>
            {brokerInspector.troubleshooting.length > 0 ? (
              <div className="space-y-2 mb-4">
                {brokerInspector.troubleshooting.map((item) => (
                  <div key={item} className="text-[11px] leading-[1.5]" style={styles.inkText}>{item}</div>
                ))}
              </div>
            ) : null}
            {brokerInspector.feedbackSummary ? (
              <div className="rounded-md border px-3 py-3 text-[10px] font-mono leading-[1.55] whitespace-pre-wrap break-words" style={{ borderColor: C.border, color: C.ink }}>
                {brokerInspector.feedbackSummary}
              </div>
            ) : null}
          </section>
        ) : null}

        {showVoice ? (
          <section className="border rounded-lg p-4" style={{ ...styles.surface, borderColor: C.border }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-3" style={styles.mutedText}>Voice & Delivery</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>Capture</div>
                <div className="text-[11px]" style={styles.inkText}>{voiceCaptureTitle}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>Reachable Directs</div>
                <div className="text-[11px]" style={styles.inkText}>{reachableRelayAgentCount}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={styles.mutedText}>Replies</div>
                <button
                  className="os-toolbar-button text-[10px] font-medium px-2 py-0.5 rounded-md"
                  style={{ color: C.ink }}
                  onClick={() => void onSetVoiceRepliesEnabled(!voiceRepliesEnabled)}
                >
                  {voiceRepliesEnabled ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
