import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api.ts";
import {
  deleteOpenAIApiKey,
  deleteOpenAIKeyFromServer,
  ensureOpenAIKeyOnServer,
  getClientCredentialState,
  getServerCredentialState,
  saveOpenAIKeyToServer,
  setOpenAIApiKey,
  type ClientCredentialState,
  type ServerCredentialState,
} from "../../lib/credentials.ts";
import { useScout } from "../../scout/Provider.tsx";
import type {
  CommsChannel,
  CommsTone,
  CommsVerbosity,
  InterruptThreshold,
  OperatorProfile,
  PairingState,
  ProvisionalAgentNamesMode,
} from "../../lib/types.ts";
import { timeAgo } from "../../lib/time.ts";
import {
  fetchScoutVoiceHistory,
  fetchScoutVoiceSettings,
  saveScoutVoiceSettings,
  type ScoutVoiceInputDevice,
  type ScoutVoicePermissionStatus,
  type ScoutVoicePreference,
  type ScoutVoiceSessionHistoryEntry,
  type ScoutVoiceSettings,
} from "../../lib/scout-voice.ts";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import { VoiceHostStatusBanner, VoicePermissionsPanel } from "./VoicePermissionsPanel.tsx";
import "./settings-drawer.css";
import "./voice-permissions-panel.css";

export type DrawerSettingsSection = "operator" | "comms" | "credentials" | "voice" | "devices";
type Section = DrawerSettingsSection;

const HUE_PRESETS = [195, 125, 300, 45, 355, 210];

function hueColor(hue: number): string {
  return `oklch(0.80 0.14 ${hue})`;
}
function hueInk(hue: number): string {
  return `oklch(0.18 0.08 ${hue})`;
}

// ── Field primitives ──────────────────────────────────────────────────

function SectionRule({ label, right }: { label: string; right?: string }) {
  return (
    <div className="s-settings-section-rule">
      <span className="s-settings-section-label">{label}</span>
      <span className="s-settings-section-line" />
      {right && <span className="s-settings-section-right">{right}</span>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="s-settings-field">
      <label className="s-settings-field-label">{label}</label>
      {children}
      {hint && <span className="s-settings-field-hint">{hint}</span>}
    </div>
  );
}

function TextInput({ value, onChange, mono }: { value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <input
      className={`s-settings-input${mono ? " s-settings-input--mono" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      className="s-settings-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}

function SliderInput({
  value, onChange, min, max, step = 1, unit = "",
}: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string;
}) {
  return (
    <div className="s-settings-slider-wrap">
      <input type="range" min={min} max={max} step={step}
        value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="s-settings-slider-value">{value} {unit}</span>
    </div>
  );
}

function OptionRow<T extends string>({
  value, onChange, options, stacked, columns,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; sub: string }[];
  stacked?: boolean;
  columns?: number;
}) {
  return (
    <div
      className={stacked ? "s-settings-option-stacked" : "s-settings-option-grid"}
      style={!stacked ? { gridTemplateColumns: `repeat(${columns ?? options.length}, 1fr)` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.id}
          className={`s-settings-option-btn${value === o.id ? " s-settings-option-btn--active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          <span className="s-settings-option-label">{o.label}</span>
          <span className="s-settings-option-sub">{o.sub}</span>
        </button>
      ))}
    </div>
  );
}

// ── Operator section ──────────────────────────────────────────────────

function OperatorSection({
  profile, update,
}: {
  profile: OperatorProfile;
  update: (patch: Partial<OperatorProfile>) => void;
}) {
  return (
    <div className="s-settings-col-gap">
      <SectionRule label="Identity" right="visible to every agent" />

      <div className="s-settings-identity-card">
        <span className="s-settings-identity-dot" style={{
          background: hueColor(profile.hue),
          color: hueInk(profile.hue),
        }}>
          {(profile.name || "?")[0].toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <div className="s-settings-identity-name">{profile.name || "Unnamed"}</div>
          <div className="s-settings-identity-meta">
            {profile.handle || "@you"} · {profile.pronouns || "—"} · operator
          </div>
        </div>
        <div className="s-settings-hue-wrap">
          <span className="s-settings-field-label">Identity hue</span>
          <div className="s-settings-hue-row">
            {HUE_PRESETS.map((h) => (
              <button key={h} onClick={() => update({ hue: h })}
                className={`s-settings-hue-dot${profile.hue === h ? " s-settings-hue-dot--active" : ""}`}
                style={{ background: hueColor(h) }} />
            ))}
          </div>
        </div>
      </div>

      <Field label="Display name" hint="Shown when agents address you.">
        <TextInput value={profile.name} onChange={(v) => update({ name: v })} />
      </Field>
      <Field label="Handle" hint="Used in @mentions across threads.">
        <TextInput value={profile.handle} onChange={(v) => update({ handle: v })} mono />
      </Field>
      <Field label="Pronouns">
        <TextInput value={profile.pronouns} onChange={(v) => update({ pronouns: v })} />
      </Field>

      <SectionRule label="How agents understand you" right="shipped as system prompt context" />
      <Field label="Operator bio" hint="How you want to be worked with. Agents read this before asking you things.">
        <TextArea value={profile.bio} onChange={(v) => update({ bio: v })} rows={4} />
      </Field>

      <div className="s-settings-two-col">
        <Field label="Timezone">
          <TextInput value={profile.timezone} onChange={(v) => update({ timezone: v })} mono />
        </Field>
        <Field label="Working hours">
          <TextInput value={profile.workingHours} onChange={(v) => update({ workingHours: v })} mono />
        </Field>
      </div>

      <SectionRule label="Ephemeral agent names" right="rotation pool for one-off agents" />
      <Field
        label="Name pool"
        hint={
          profile.provisionalAgentNames.length > 0
            ? `${profile.provisionalAgentNamesResolvedCount} names active (${profile.provisionalAgentNamesSource}). Preview: ${profile.provisionalAgentNamesPreview.join(", ")}${profile.provisionalAgentNamesResolvedCount > profile.provisionalAgentNamesPreview.length ? ", …" : ""}`
            : "Leave empty to use Scout's built-in rotation. One short name per line."
        }
      >
        <TextArea
          value={profile.provisionalAgentNames.join("\n")}
          onChange={(v) => update({
            provisionalAgentNames: v
              .split(/\r?\n/u)
              .map((line) => line.trim())
              .filter(Boolean),
          })}
          rows={6}
        />
      </Field>
      <Field
        label="Pool mode"
        hint="Replace uses only your list. Add to defaults prepends yours, then Scout's built-in names."
      >
        <OptionRow<ProvisionalAgentNamesMode>
          value={profile.provisionalAgentNamesMode}
          onChange={(v) => update({ provisionalAgentNamesMode: v })}
          options={[
            { id: "replace", label: "Replace", sub: "your list only" },
            { id: "extend", label: "Add to defaults", sub: "yours first, then Scout" },
          ]}
          columns={2}
        />
      </Field>
    </div>
  );
}

// ── Communication section ─────────────────────────────────────────────

function CommsSection({
  profile, update,
}: {
  profile: OperatorProfile;
  update: (patch: Partial<OperatorProfile>) => void;
}) {
  return (
    <div className="s-settings-col-gap">
      <SectionRule label="Interrupt policy" />
      <Field label="When agents can ping you directly"
        hint="Blocking-only means only asks that truly stall work. Others get batched.">
        <OptionRow<InterruptThreshold>
          value={profile.interruptThreshold}
          onChange={(v) => update({ interruptThreshold: v })}
          options={[
            { id: "always", label: "Always", sub: "any ask, any time" },
            { id: "blocking-only", label: "Blocking only", sub: "stuck agents · default" },
            { id: "batched", label: "Batched", sub: "grouped every 15m" },
            { id: "never", label: "Never", sub: "queue only, I'll check in" },
          ]}
        />
      </Field>

      <div className="s-settings-two-col">
        <Field label="Batch window (min)">
          <SliderInput value={profile.batchWindow} min={5} max={60} step={5}
            onChange={(v) => update({ batchWindow: v })} unit="min" />
        </Field>
        <Field label="Quiet hours">
          <TextInput value={profile.quietHours} onChange={(v) => update({ quietHours: v })} mono />
        </Field>
      </div>

      <SectionRule label="Where to reach you" />
      <Field label="Preferred channel">
        <OptionRow<CommsChannel>
          value={profile.channel}
          onChange={(v) => update({ channel: v })}
          options={[
            { id: "here", label: "Here only", sub: "desktop app" },
            { id: "mobile", label: "Mobile only", sub: "paired phone" },
            { id: "here+mobile", label: "Both", sub: "whichever is active" },
          ]}
        />
      </Field>

      <SectionRule label="Tone calibration" right="how agents write to you" />
      <div className="s-settings-two-col">
        <Field label="Verbosity">
          <OptionRow<CommsVerbosity>
            stacked
            value={profile.verbosity}
            onChange={(v) => update({ verbosity: v })}
            options={[
              { id: "terse", label: "Terse", sub: "one-liners, answers only" },
              { id: "normal", label: "Normal", sub: "context + answer" },
              { id: "detailed", label: "Detailed", sub: "show reasoning" },
            ]}
          />
        </Field>
        <Field label="Tone">
          <OptionRow<CommsTone>
            stacked
            value={profile.tone}
            onChange={(v) => update({ tone: v })}
            options={[
              { id: "direct", label: "Direct", sub: "no hedging" },
              { id: "warm", label: "Warm", sub: "friendly, conversational" },
              { id: "formal", label: "Formal", sub: "business-like" },
            ]}
          />
        </Field>
      </div>
    </div>
  );
}

// ── Credentials section ───────────────────────────────────────────────

function CredentialsSection({
  clientCredentials,
  serverCredentials,
  reloadCredentials,
}: {
  clientCredentials: ClientCredentialState | null;
  serverCredentials: ServerCredentialState | null;
  reloadCredentials: () => Promise<void>;
}) {
  const [openAIKeyDraft, setOpenAIKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const serverOpenAI = serverCredentials?.openai ?? null;
  const configured = Boolean(serverOpenAI?.configured);
  const serverSource = serverOpenAI?.source === "env"
    ? "OPENAI_API_KEY"
    : serverOpenAI?.source === "local-config"
      ? "local Scout config"
      : serverOpenAI?.source === "local-store"
        ? "local OpenScout store"
        : "missing";
  const source = serverOpenAI?.source === "local-store" && clientCredentials?.configured
    ? "local OpenScout store + HudVault mirror"
    : serverSource;
  const preview = serverOpenAI?.preview ?? clientCredentials?.preview ?? null;

  const saveOpenAIKey = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const apiKey = openAIKeyDraft.trim();
      await saveOpenAIKeyToServer(apiKey);
      let hudVaultError: string | null = null;
      try {
        await setOpenAIApiKey(apiKey);
      } catch (error) {
        hudVaultError = error instanceof Error ? error.message : "HudVault save failed.";
      }
      setOpenAIKeyDraft("");
      await reloadCredentials();
      setStatus(hudVaultError
        ? `Saved to local OpenScout store. Browser mirror failed: ${hudVaultError}`
        : "Saved to local OpenScout store and Hudson Vault.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save key.");
    } finally {
      setSaving(false);
    }
  };

  const clearOpenAIKey = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const [clientResult, serverResult] = await Promise.allSettled([
        deleteOpenAIApiKey(),
        deleteOpenAIKeyFromServer(),
      ]);
      setOpenAIKeyDraft("");
      await reloadCredentials();
      if (clientResult.status === "rejected" || serverResult.status === "rejected") {
        setStatus("Cleared what I could; one credential store did not respond.");
      } else {
        setStatus(serverOpenAI?.source === "env" || serverOpenAI?.source === "local-config"
        ? "Removed saved key. Server fallback is still configured."
        : "Removed saved key.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="s-settings-col-gap">
      <SectionRule label="Model providers" right={configured ? `configured · ${source}` : "missing"} />

      <div className="s-settings-relay-card">
        <div>
          <div className="s-settings-relay-title">
            OpenAI · <span className="s-settings-device-status" style={{ color: configured ? "var(--green)" : "var(--dim)" }}>
              {"●"} {configured ? "ready" : "missing"}
            </span>
          </div>
          <div className="s-settings-relay-meta">
            {preview ?? "No key stored"} · {source}
          </div>
          <div className="s-settings-relay-desc">
            Scout stores user-entered keys in the local OpenScout credential store and keeps a HudVault mirror for this browser profile.
          </div>
        </div>
      </div>

      <Field label="OpenAI API key" hint="Saved locally. Existing keys are never shown again.">
        <input
          className="s-settings-input s-settings-input--mono"
          type="password"
          value={openAIKeyDraft}
          placeholder={configured ? "Saved key configured" : "sk-..."}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setOpenAIKeyDraft(event.target.value)}
        />
      </Field>

      {status && <div className="s-settings-field-hint">{status}</div>}

      <div className="s-settings-button-row">
        <button
          type="button"
          className="s-btn"
          disabled={saving || !openAIKeyDraft.trim()}
          onClick={() => void saveOpenAIKey()}
        >
          {saving ? "Saving" : "Save key"}
        </button>
        <button
          type="button"
          className="s-btn"
          disabled={saving || !(clientCredentials?.configured || serverOpenAI?.source === "local-store")}
          onClick={() => void clearOpenAIKey()}
        >
          Clear saved key
        </button>
      </div>
    </div>
  );
}

// ── Voice section ─────────────────────────────────────────────────────

const VOICE_ENGINE_OPTIONS: { id: ScoutVoicePreference; label: string; sub: string }[] = [
  { id: "auto", label: "Auto", sub: "Parakeet when warm, Apple fallback" },
  { id: "parakeet", label: "Parakeet", sub: "on-device, best quality" },
  { id: "apple", label: "Apple Speech", sub: "instant, no model warmup" },
];

function VoiceSection() {
  const [settings, setSettings] = useState<ScoutVoiceSettings | null>(null);
  const [devices, setDevices] = useState<ScoutVoiceInputDevice[]>([]);
  const [history, setHistory] = useState<ScoutVoiceSessionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshot, sessions] = await Promise.all([
        fetchScoutVoiceSettings(),
        fetchScoutVoiceHistory(12).catch(() => []),
      ]);
      setSettings(snapshot.settings);
      setDevices(snapshot.devices);
      setHistory(sessions);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(async (
    patch: Partial<Pick<ScoutVoiceSettings, "preference" | "inputDeviceId">>,
  ) => {
    setSaving(true);
    setError(null);
    try {
      const snapshot = await saveScoutVoiceSettings(patch);
      setSettings(snapshot.settings);
      setDevices(snapshot.devices);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading && !settings) {
    return <div className="s-settings-field-hint">Loading voice settings…</div>;
  }

  const selectedDeviceId = settings?.inputDeviceId
    ?? devices.find((device) => device.isDefault)?.id
    ?? "";
  const micPermission = settings?.permissions?.find((entry) => entry.kind === "microphone") ?? null;
  const speechPermission = settings?.permissions?.find((entry) => entry.kind === "speechRecognition") ?? null;
  const hostOnline = (settings?.permissions?.length ?? 0) > 0 || devices.length > 0;

  const troubleshootingTips = [
    !hostOnline
      ? "Scout voice host is offline. Launch Scout Menu on this Mac — the browser does not capture audio."
      : null,
    micPermission?.status === "denied" || micPermission?.status === "restricted"
      ? micPermission?.status === "restricted"
        ? "Microphone access is restricted on this Mac."
        : "Microphone access is off for Scout Menu. Choose Retry access to reopen the macOS permission pane."
      : micPermission?.canRequest
        ? "Microphone has not been requested yet. Request access or tap the mic in chat to show the macOS prompt."
        : null,
    !speechPermission?.granted && (speechPermission?.status === "denied" || speechPermission?.status === "restricted")
      ? speechPermission?.status === "restricted"
        ? "Speech recognition is restricted on this Mac."
        : "Speech recognition is off for Scout Menu. Open Privacy & Security → Speech Recognition to change it."
      : null,
    settings?.modelReady
      ? null
      : "Parakeet may download on first use. Apple Speech stays available while the model warms.",
    "Dictation requires Scout Menu running. The browser does not capture audio.",
    "If transcription hangs on Processing, wait up to 60 seconds or tap the mic again to cancel.",
  ].filter((tip): tip is string => Boolean(tip));

  return (
    <div className="s-settings-col-gap">
      {error && <div className="s-settings-field-hint" style={{ color: "var(--amber)" }}>{error}</div>}

      <VoiceHostStatusBanner
        hostOnline={hostOnline}
        micPermission={micPermission}
        speechPermission={speechPermission}
        modelReady={settings?.modelReady}
      />

      <SectionRule label="Scout Menu permissions" right="voice host" />
      <VoicePermissionsPanel
        permissions={settings?.permissions}
        hostOnline={hostOnline}
        disabled={saving || loading}
        onError={(message) => setError(message)}
        onRefresh={load}
      />

      <SectionRule label="Transcription" />
      <Field
        label="Engine"
        hint={
          settings?.modelReady
            ? "Parakeet is warm and ready."
            : settings?.modelInstalled
              ? "Parakeet is installed; first dictation may warm the model."
              : "Parakeet downloads on first use. Apple Speech stays available meanwhile."
        }
      >
        <OptionRow<ScoutVoicePreference>
          value={settings?.preference ?? "auto"}
          onChange={(preference) => {
            setSettings((prev) => (prev ? { ...prev, preference } : prev));
            void apply({ preference });
          }}
          options={VOICE_ENGINE_OPTIONS}
          columns={3}
        />
      </Field>

      <Field
        label="Microphone input"
        hint="Scout Menu uses the macOS system default input unless you pick a device here. The browser never captures audio."
      >
        {devices.length > 0 ? (
          <select
            className="s-settings-input"
            value={selectedDeviceId}
            disabled={saving}
            onChange={(event) => {
              const inputDeviceId = event.target.value || null;
              setSettings((prev) => (
                prev
                  ? {
                      ...prev,
                      inputDeviceId,
                      inputDeviceName: devices.find((device) => device.id === inputDeviceId)?.name ?? null,
                    }
                  : prev
              ));
              void apply({ inputDeviceId });
            }}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}{device.isDefault ? " (system default)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="s-settings-field-hint">
            Scout Menu is not reporting microphones. Launch Scout Menu, grant mic access, then refresh.
          </div>
        )}
      </Field>

      <SectionRule label="Diagnostics" />
      <ul className="s-settings-field-hint" style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.35rem" }}>
        {troubleshootingTips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>

      <SectionRule label="Recent sessions" right={history.length ? `${history.length} shown` : "none"} />
      {history.length === 0 ? (
        <div className="s-settings-field-hint">
          No recent dictation sessions on this web server. History fills as you use the mic in chat.
        </div>
      ) : (
        <div className="s-settings-col-gap" style={{ gap: "0.35rem" }}>
          {history.map((session) => (
            <div key={session.sessionId} className="s-settings-device-row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="s-settings-device-name" style={{ fontFamily: "var(--mono)" }}>
                  {session.status}
                  {" · "}
                  {session.lastEvent ?? "started"}
                </div>
                <div className="s-settings-device-meta">
                  {session.surface}
                  {" · "}
                  {timeAgo(session.updatedAt)}
                  {session.error ? ` · ${session.error}` : ""}
                </div>
                {session.lastTranscript ? (
                  <div className="s-settings-field-hint" style={{ marginTop: "0.2rem" }}>
                    {session.lastTranscript.length > 96
                      ? `${session.lastTranscript.slice(0, 96)}…`
                      : session.lastTranscript}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="s-settings-button-row">
        <button type="button" className="s-btn" disabled={loading || saving} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

// ── Devices section ───────────────────────────────────────────────────

type PeerDevice = {
  id: string;
  name: string;
  kind: "desktop" | "mobile" | "tablet";
  status: "this-device" | "online" | "offline";
  relay: string;
  lastSeen: string;
};

const DEVICE_GLYPHS: Record<string, string> = { desktop: "◻", mobile: "▯", tablet: "▭" };

function DeviceRow({ device }: { device: PeerDevice }) {
  const statusColor = device.status === "this-device" ? "var(--accent)"
    : device.status === "online" ? "var(--green)"
    : "var(--dim)";
  return (
    <div className="s-settings-device-row">
      <span className="s-settings-device-icon">{DEVICE_GLYPHS[device.kind] ?? "□"}</span>
      <div>
        <div className="s-settings-device-name">{device.name}</div>
        <div className="s-settings-device-meta">
          {device.kind} · via {device.relay} · {device.lastSeen}
        </div>
      </div>
      <span className="s-settings-device-status" style={{ color: statusColor }}>
        {"●"} {device.status === "this-device" ? "this device" : device.status}
      </span>
      <button className="s-btn" disabled={device.status === "this-device"}>
        {device.status === "this-device" ? "—" : "Unpair"}
      </button>
    </div>
  );
}

function DevicesSection({ pairing }: { pairing: PairingState | null }) {
  const devices: PeerDevice[] = [
    { id: "local", name: "This machine", kind: "desktop", status: "this-device", relay: "local", lastSeen: "now" },
  ];
  if (pairing?.trustedPeers) {
    for (const peer of pairing.trustedPeers) {
      const isConnected = peer.fingerprint === pairing.connectedPeerFingerprint;
      devices.push({
        id: peer.fingerprint,
        name: peer.name ?? "Paired device",
        kind: "mobile",
        status: isConnected ? "online" : "offline",
        relay: "tailscale",
        lastSeen: peer.lastSeenLabel ?? "—",
      });
    }
  }

  return (
    <div className="s-settings-col-gap">
      <SectionRule label={`Paired devices · ${devices.length}`} />

      <div className="s-settings-col-gap" style={{ gap: 10 }}>
        {devices.map((d) => <DeviceRow key={d.id} device={d} />)}
      </div>

      <SectionRule label="Relay" />
      <div className="s-settings-relay-card">
        <div>
          <div className="s-settings-relay-title">
            Relay · <span className="s-settings-device-status" style={{ color: pairing?.isRunning ? "var(--green)" : "var(--dim)" }}>
              {"●"} {pairing?.isRunning ? "connected" : "offline"}
            </span>
          </div>
          <div className="s-settings-relay-meta">
            {pairing?.relay ?? "not configured"} · tailscale
          </div>
          <div className="s-settings-relay-desc">
            Agents route through your relay to reach mobile when the app is backgrounded.
            End-to-end encrypted; keys never leave your devices.
          </div>
        </div>
        <button className="s-btn">Configure</button>
      </div>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────

const SECTIONS: { id: Section; label: string; sub: string }[] = [
  { id: "operator", label: "Operator", sub: "identity · bio · hours" },
  { id: "comms", label: "Communication", sub: "how agents reach you" },
  { id: "voice", label: "Voice", sub: "permissions · dictation" },
  { id: "credentials", label: "Credentials", sub: "model provider keys" },
  { id: "devices", label: "Paired devices", sub: "relay · connected" },
];

const SECTION_TITLES: Record<Section, string> = {
  operator: "Operator identity",
  comms: "Communication",
  voice: "Voice",
  credentials: "Credentials",
  devices: "Paired devices",
};

const DEFAULT_PROFILE: OperatorProfile = {
  name: "",
  handle: "",
  pronouns: "",
  hue: 195,
  bio: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  workingHours: "08:00 – 18:00",
  interruptThreshold: "blocking-only",
  batchWindow: 15,
  channel: "here+mobile",
  verbosity: "terse",
  tone: "direct",
  quietHours: "22:00 – 07:00",
  provisionalAgentNames: [],
  provisionalAgentNamesMode: "replace",
  provisionalAgentNamesResolvedCount: 0,
  provisionalAgentNamesPreview: [],
  provisionalAgentNamesSource: "default",
};

export function SettingsDrawer({
  open,
  onClose,
  section: controlledSection,
  onSectionChange,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the rail is controlled by the URL (SCO-082 Phase B). */
  section?: Section;
  onSectionChange?: (section: Section) => void;
}) {
  const { refreshOnboarding } = useScout();
  const { ref: drawerRef, onKeyDown: onDrawerKeyDown } = useFocusTrap<HTMLDivElement>(open);
  const [uncontrolledSection, setUncontrolledSection] = useState<Section>("operator");
  const section = controlledSection ?? uncontrolledSection;
  const setSection = useCallback((next: Section) => {
    if (onSectionChange) onSectionChange(next);
    else setUncontrolledSection(next);
  }, [onSectionChange]);
  const [profile, setProfile] = useState<OperatorProfile>(DEFAULT_PROFILE);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [clientCredentials, setClientCredentials] = useState<ClientCredentialState | null>(null);
  const [serverCredentials, setServerCredentials] = useState<ServerCredentialState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCredentials = useCallback(async () => {
    const [client, server] = await Promise.allSettled([
      getClientCredentialState(),
      getServerCredentialState(),
    ]);
    const clientValue = client.status === "fulfilled" ? client.value : null;
    let serverValue = server.status === "fulfilled" ? server.value : null;
    if (clientValue?.configured && !serverValue?.openai.configured) {
      serverValue = await ensureOpenAIKeyOnServer().catch(() => serverValue);
    }
    setClientCredentials(clientValue);
    setServerCredentials(serverValue);
  }, []);

  const load = useCallback(async () => {
    try {
      const userPromise = api<OperatorProfile>("/api/user");
      const pairPromise = Promise.race([
        api<PairingState>("/api/pairing-state"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      const [user, pair] = await Promise.allSettled([userPromise, pairPromise]);
      if (user.status === "fulfilled") setProfile(user.value);
      if (pair.status === "fulfilled") setPairing(pair.value);
      await loadCredentials();
    } finally {
      setLoaded(true);
    }
  }, [loadCredentials]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const cycleSection = useCallback((delta: number) => {
    const index = SECTIONS.findIndex((entry) => entry.id === section);
    const next = (index + delta + SECTIONS.length) % SECTIONS.length;
    setSection(SECTIONS[next]!.id);
  }, [section]);

  const handleDrawerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    onDrawerKeyDown(event);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const target = event.target as HTMLElement | null;
    const onRail = Boolean(target?.closest(".s-settings-rail"));
    if (!onRail) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cycleSection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cycleSection(-1);
    }
  }, [cycleSection, onClose, onDrawerKeyDown]);

  const save = useCallback((next: OperatorProfile) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api<OperatorProfile>("/api/user", {
        method: "POST",
        body: JSON.stringify(next),
      })
        .then(() => refreshOnboarding())
        .catch(() => {
          /* keep local draft state; next successful load will reconcile */
        });
    }, 400);
  }, [refreshOnboarding]);

  const update = useCallback((patch: Partial<OperatorProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, [save]);

  return (
    <>
      <div
        className={`s-settings-scrim ${open ? "s-settings-scrim--open" : "s-settings-scrim--closed"}`}
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={`s-settings-drawer ${open ? "s-settings-drawer--open" : "s-settings-drawer--closed"}`}
        onKeyDown={handleDrawerKeyDown}
      >
        {/* Header */}
        <div className="s-settings-header">
          <div className="s-settings-header-title">{"⚙"} SETTINGS</div>
          <span className="s-settings-header-sep">/</span>
          <span className="s-settings-header-section">{SECTION_TITLES[section]}</span>
          <span style={{ flex: 1 }} />
          <span className="s-settings-header-hint">ESC to close</span>
          <button className="s-settings-close" onClick={onClose}>{"×"}</button>
        </div>

        {/* Rail */}
        <nav className="s-settings-rail">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`s-settings-rail-btn${section === s.id ? " s-settings-rail-btn--active" : ""}`}>
              <span className="s-settings-rail-label">{s.label}</span>
              <span className="s-settings-rail-sub">{s.sub}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="s-settings-content">
          {!loaded ? (
            <div style={{ color: "var(--dim)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading...</div>
          ) : (
            <>
              {section === "operator" && <OperatorSection profile={profile} update={update} />}
              {section === "comms" && <CommsSection profile={profile} update={update} />}
              {section === "credentials" && (
                <CredentialsSection
                  clientCredentials={clientCredentials}
                  serverCredentials={serverCredentials}
                  reloadCredentials={loadCredentials}
                />
              )}
              {section === "voice" && <VoiceSection />}
              {section === "devices" && <DevicesSection pairing={pairing} />}
            </>
          )}
        </main>

        {/* Footer */}
        <div className="s-settings-footer">
          <span className="s-settings-footer-sync">{"●"} synced</span>
          <span>{"·"}</span>
          <span>changes apply instantly to every agent in your fleet</span>
          <span style={{ flex: 1 }} />
          <button className="s-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}
