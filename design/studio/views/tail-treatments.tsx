"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import styles from "./tail-treatments.module.css";

/**
 * Tail — treatments.
 *
 * Four genuinely different directions for the live event stream, rendered from
 * the same event slice so they're comparable. All obey the same rules: one full
 * line per event (identity always shown, nothing collapsed), no "live"
 * theatrics, no throughput. They differ in structure and feel:
 *
 *   01 · Console   — dense single mono line; kind is a glyph only (shape+hue).
 *   02 · Ledger    — a columnar logs table with headers + a compact kind pill.
 *   03 · Feed      — roomy two-line blocks; identity leads, action gets a line.
 *   04 · Timeline  — a chronological spine with a kind-colored node per event.
 *
 * Rendered through the real `--s-*` skins.
 */

type KindKey = "user" | "assistant" | "tool" | "toolResult" | "system" | "other";

const KINDS: Record<KindKey, { label: string; tone: string }> = {
  user: { label: "USER", tone: "var(--s-accent)" },
  assistant: { label: "ASST", tone: "var(--s-ok)" },
  tool: { label: "TOOL", tone: "var(--s-warn)" },
  toolResult: { label: "OUT", tone: "var(--s-muted)" },
  system: { label: "SYS", tone: "var(--s-dim)" },
  other: { label: "EVT", tone: "var(--s-dim)" },
};

const SIGNAL: Set<KindKey> = new Set(["user", "assistant", "tool"]);

type IdTier = "agent" | "project" | "proc";
type Ev = { t: string; id: string; tier: IdTier; kind: KindKey; html: string };

const EVENTS: Ev[] = [
  { t: "09:42:18", id: "@scout", tier: "agent", kind: "tool", html: "Read <code>views/scout-tail.tsx</code>" },
  { t: "09:42:18", id: "@scout", tier: "agent", kind: "toolResult", html: "247 lines" },
  { t: "09:42:21", id: "@scout", tier: "agent", kind: "tool", html: "Edit <code>broker/service.ts</code>" },
  { t: "09:42:21", id: "@scout", tier: "agent", kind: "toolResult", html: "<span class=\"add\">+12</span> <span class=\"del\">−3</span>" },
  { t: "09:42:31", id: "@scout", tier: "agent", kind: "assistant", html: "rebased main onto origin — 2 ahead, clean" },
  { t: "09:42:40", id: "@art", tier: "agent", kind: "user", html: "take both — and surface the active theme in the inspector" },
  { t: "09:42:44", id: "@hudson", tier: "agent", kind: "tool", html: "Grep <code>data-scout-skin</code>" },
  { t: "09:42:44", id: "@hudson", tier: "agent", kind: "toolResult", html: "6 matches · 6 files" },
  { t: "09:42:52", id: "codex·4894", tier: "proc", kind: "system", html: "session <code>relay-openscout-codex</code> started · tmux" },
  { t: "09:42:58", id: "@lattices", tier: "agent", kind: "assistant", html: "bundle built in 4.2s · 0 warnings" },
  { t: "09:43:02", id: "talkie", tier: "project", kind: "tool", html: "<code>sed -n '1,180p' studio/components/PhoneFrame.tsx</code>" },
  { t: "09:43:02", id: "talkie", tier: "project", kind: "toolResult", html: "180 lines" },
  { t: "09:43:05", id: "talkie", tier: "project", kind: "other", html: "permission-mode → acceptEdits" },
];

function isNewRun(i: number): boolean {
  return i === 0 || EVENTS[i - 1].id !== EVENTS[i].id;
}

export default function TailTreatmentsStudy() {
  return (
    <ScoutStudyShell
      pageId="tail-treatments"
      title="Tail — treatments"
      blurb={
        <>
          Four directions for the event stream, same data, so you can compare
          like-for-like. All keep <b>one full line per event</b> (identity always
          shown, nothing collapsed), drop every <b>live</b> cue, and drop{" "}
          <b>throughput</b>. They differ in structure: a dense <b>Console</b>, a
          columnar <b>Ledger</b>, a roomy two-line <b>Feed</b>, and a{" "}
          <b>Timeline</b> spine.
        </>
      }
    >
      <div className={styles.stack}>
        <Variant n="01" name="Console" desc="Dense single mono line. Kind is a glyph only — shape + hue, no word-label. journalctl/htop energy, maximum rows per screen.">
          <ConsoleStream />
        </Variant>
        <Variant n="02" name="Ledger" desc="A columnar logs table: field headers, aligned columns, kind shown as a glyph. Reads like a pro logs tool (Datadog / journalctl -o).">
          <LedgerStream />
        </Variant>
        <Variant n="03" name="Feed" desc="Roomy two-line blocks — identity + kind glyph lead, the action gets its own line. Most legible; gives each agent real vertical space.">
          <FeedStream />
        </Variant>
        <Variant n="04" name="Timeline" desc="A chronological spine where each node IS the kind glyph; identity + action sit to the right. Time reads as a continuous axis.">
          <TimelineStream />
        </Variant>
      </div>
    </ScoutStudyShell>
  );
}

/* Each treatment lives in a labeled surface with a slim, real header. */
function Variant({ n, name, desc, children }: { n: string; name: string; desc: string; children: React.ReactNode }) {
  return (
    <section className={styles.variant}>
      <div className={styles.vLabel}>
        <span className={styles.vNum}>TREATMENT {n}</span>
        <span className={styles.vName}>{name}</span>
        <span className={styles.vDesc}>{desc}</span>
      </div>
      <div className={styles.surface}>
        <header className={styles.surfaceHead}>
          <span className={styles.identity}>
            <TailGlyph />
            <span className={styles.title}>Tail</span>
          </span>
          <span className={styles.counts}>
            <b>25</b> logs <span className={styles.dot}>·</span> <b>22</b> procs
          </span>
          <div className={styles.follow}>
            <button className={`${styles.followSeg} ${styles.followOn}`}><PlayGlyph /> Follow</button>
            <button className={styles.followSeg}><PauseGlyph /> Pause</button>
          </div>
        </header>
        {children}
      </div>
    </section>
  );
}

/* ── 01 · Console ──────────────────────────────────────────────────── */
function ConsoleStream() {
  return (
    <div className={`${styles.stream} ${styles.console}`}>
      {EVENTS.map((e, i) => (
        <div key={i} className={`${styles.cRow} ${isNewRun(i) ? styles.runGap : ""}`}>
          <span className={styles.time}>{e.t}</span>
          <span className={styles.cGlyph} style={tone(e.kind)} title={KINDS[e.kind].label}>
            <KindGlyph kind={e.kind} />
          </span>
          <span className={styles.cId}>
            {e.tier === "agent" ? (
              <SpriteAvatar name={e.id.replace(/^@/, "")} size={18} tile className={styles.cAvatar} />
            ) : (
              <span className={styles.cAvatarBlank} aria-hidden />
            )}
            <span className={`${styles.id} ${styles[`id_${e.tier}`]}`}>{e.id}</span>
          </span>
          <span
            className={`${styles.action} ${e.kind === "toolResult" ? styles.out : ""}`}
            dangerouslySetInnerHTML={{ __html: e.kind === "toolResult" ? `→ ${e.html}` : e.html }}
          />
        </div>
      ))}
    </div>
  );
}

/* ── 02 · Ledger ───────────────────────────────────────────────────── */
function LedgerStream() {
  return (
    <div className={`${styles.stream} ${styles.ledger}`}>
      <div className={`${styles.lRow} ${styles.lHead}`}>
        <span>Time</span>
        <span />
        <span>Source</span>
        <span>Event</span>
      </div>
      {EVENTS.map((e, i) => (
        <div key={i} className={styles.lRow}>
          <span className={styles.time}>{e.t}</span>
          <span className={styles.lKindCell}>
            <KindMark kind={e.kind} />
          </span>
          <span className={styles.cId}>
            {e.tier === "agent" ? (
              <SpriteAvatar name={e.id.replace(/^@/, "")} size={18} tile className={styles.cAvatar} />
            ) : (
              <span className={styles.cAvatarBlank} aria-hidden />
            )}
            <span className={`${styles.id} ${styles[`id_${e.tier}`]}`}>{e.id}</span>
          </span>
          <span
            className={`${styles.action} ${e.kind === "toolResult" ? styles.out : ""}`}
            dangerouslySetInnerHTML={{ __html: e.kind === "toolResult" ? `→ ${e.html}` : e.html }}
          />
        </div>
      ))}
    </div>
  );
}

/* ── 03 · Feed ─────────────────────────────────────────────────────── */
function FeedStream() {
  return (
    <div className={`${styles.stream} ${styles.feed}`}>
      {EVENTS.map((e, i) => (
        <div key={i} className={`${styles.fRow} ${isNewRun(i) ? styles.fNewRun : ""}`}>
          <div className={styles.fTop}>
            <KindMark kind={e.kind} />
            <span className={`${styles.id} ${styles[`id_${e.tier}`]}`}>{e.id}</span>
            <span className={styles.fTime}>{e.t}</span>
          </div>
          <div
            className={`${styles.fAction} ${e.kind === "toolResult" ? styles.out : ""}`}
            dangerouslySetInnerHTML={{ __html: e.kind === "toolResult" ? `→ ${e.html}` : e.html }}
          />
        </div>
      ))}
    </div>
  );
}

/* ── 04 · Timeline ─────────────────────────────────────────────────── */
function TimelineStream() {
  return (
    <div className={`${styles.stream} ${styles.timeline}`}>
      {EVENTS.map((e, i) => (
        <div key={i} className={styles.tRow}>
          <span className={styles.time}>{e.t}</span>
          <span className={styles.tSpine}>
            <span className={styles.tNode} style={tone(e.kind)}>
              <KindGlyph kind={e.kind} />
            </span>
          </span>
          <span className={styles.tContent}>
            <span className={`${styles.id} ${styles[`id_${e.tier}`]}`}>{e.id}</span>
            <span
              className={`${styles.action} ${e.kind === "toolResult" ? styles.out : ""}`}
              dangerouslySetInnerHTML={{ __html: e.kind === "toolResult" ? `→ ${e.html}` : e.html }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Shared kind expressions ───────────────────────────────────────── */

function tone(kind: KindKey): React.CSSProperties {
  return { "--chip-tone": KINDS[kind].tone } as React.CSSProperties;
}

/* Kind = a colored glyph, no word-label. Bulk kinds inherit a grey tone. */
function KindMark({ kind }: { kind: KindKey }) {
  return (
    <span className={styles.mark} style={tone(kind)}>
      <KindGlyph kind={kind} />
    </span>
  );
}

/* Per-kind geometric marks (currentColor). */
function KindGlyph({ kind }: { kind: KindKey }) {
  const c = { width: 9, height: 9, viewBox: "0 0 14 14", "aria-hidden": true } as const;
  switch (kind) {
    case "user":
      return <svg {...c} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3l4 4-4 4" /></svg>;
    case "assistant":
      return <svg {...c} fill="currentColor"><path d="M7 0.5l1.3 4.2 4.2 1.3-4.2 1.3L7 13.5 5.7 7.3 1.5 6l4.2-1.3z" /></svg>;
    case "tool":
      return <svg {...c} fill="currentColor"><rect x="2.5" y="2.5" width="9" height="9" rx="1.6" /></svg>;
    case "toolResult":
      return <svg {...c} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7h8M7 4l3 3-3 3" /></svg>;
    case "system":
      return <svg {...c} fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="4" /></svg>;
    default:
      return <svg {...c} fill="currentColor"><circle cx="7" cy="7" r="2.2" /></svg>;
  }
}

function TailGlyph() {
  return <svg className={styles.tailGlyph} width="17" height="12" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 7h4.2l2-4.5 3 9 2.4-6 1.6 3H21" /></svg>;
}
function PlayGlyph() {
  return <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 2.5l9 5.5-9 5.5z" /></svg>;
}
function PauseGlyph() {
  return <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>;
}
