import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useScout } from "../scout/Provider.tsx";
import type {
  CommsChannel,
  CommsTone,
  CommsVerbosity,
  InterruptThreshold,
  OperatorProfile,
  PairingState,
} from "../lib/types.ts";
import { timeAgo } from "../lib/time.ts";
import "./settings-drawer.css";

type Section = "operator" | "comms" | "devices";

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
  { id: "devices", label: "Paired devices", sub: "relay · connected" },
];

const SECTION_TITLES: Record<Section, string> = {
  operator: "Operator identity",
  comms: "Communication",
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
};

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshOnboarding } = useScout();
  const [section, setSection] = useState<Section>("operator");
  const [profile, setProfile] = useState<OperatorProfile>(DEFAULT_PROFILE);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

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
      <div className={`s-settings-drawer ${open ? "s-settings-drawer--open" : "s-settings-drawer--closed"}`}>
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
