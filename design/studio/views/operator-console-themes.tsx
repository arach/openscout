"use client";

import { useEffect, useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import styles from "./operator-console-themes.module.css";

/**
 * Studio: the six Operator Console themes, extracted and DECOMPOSED
 * (docs/design/operator-console-themes.md).
 *
 * The source mock welds canvas + accent + radius + type + texture + light into
 * six monolithic blocks. docs/design/appearance-decomposed-picker.md §0.1
 * already diagnosed that shape as our own defect: "the picker is not offering
 * three settings; it is offering three opinions."
 *
 * So each theme here is a NAMED PRESET over six independent axes. The presets
 * are preserved; the axes are separable. "Unit 47's corners on Meridian's
 * canvas" is a legal request in this model and an impossible one in the mock.
 *
 * The same frame renders under every preset, because the only honest way to
 * compare themes is identical content. Editor is the control case — the only
 * preset with no texture. If the textured presets don't beat it on legibility,
 * the texture axis is decoration.
 */

/**
 * The type axis is the contested one, so it has to actually render — with the
 * faces missing, all six presets collapse to the studio's Inter and the whole
 * argument becomes invisible. Loaded on mount rather than in the root layout so
 * eight families are only fetched by someone who opened this study.
 */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600" +
  "&family=IBM+Plex+Sans:wght@400;500;600" +
  "&family=Instrument+Sans:wght@400;500;600" +
  "&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500" +
  "&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600" +
  "&family=Archivo:wght@400;500;600" +
  "&family=Playfair+Display:ital,wght@0,400;0,500;1,400" +
  "&family=Syne:wght@600;700;800" +
  "&family=JetBrains+Mono:wght@400;500&display=swap";

function useThemeFonts() {
  useEffect(() => {
    if (document.querySelector(`link[data-oc-fonts]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    link.setAttribute("data-oc-fonts", "");
    document.head.appendChild(link);
  }, []);
}

type Axis = "canvas" | "accent" | "radius" | "type" | "texture" | "light";

type Theme = {
  id: string;
  name: string;
  note: string;
  scheme: "dark" | "light";
  /** Axes that our token contract does NOT cover today. */
  novel: Axis[];
  vars: Record<string, string>;
};

const THEMES: Theme[] = [
  {
    id: "mission",
    name: "Mission",
    note: "dark · warm · square",
    scheme: "dark",
    novel: ["type", "texture", "light"],
    vars: {
      "--oc-frame": "#07080b",
      "--oc-panel": "#090b0e",
      "--oc-canvas": "#0d0f13",
      "--oc-raised": "#14171c",
      "--oc-sunken": "#06070a",
      "--oc-screen": "#040507",
      "--oc-screen-ink": "rgba(232,234,236,0.78)",
      "--oc-line": "rgba(232,234,236,0.09)",
      "--oc-line-strong": "rgba(232,234,236,0.17)",
      "--oc-ink": "#f4f6f8",
      "--oc-ink-dim": "rgba(232,234,236,0.84)",
      "--oc-ink-mut": "rgba(232,234,236,0.56)",
      "--oc-ink-faint": "rgba(232,234,236,0.46)",
      "--oc-accent": "#c9903f",
      "--oc-accent-ink": "#14100a",
      "--oc-accent-wash": "rgba(201,144,63,0.09)",
      "--oc-accent-text": "#c9903f",
      "--oc-live": "#86b39a",
      "--oc-live-text": "#93bfa6",
      "--oc-live-wash": "rgba(134,179,154,0.045)",
      "--oc-danger": "#c8655a",
      "--oc-display": "'Barlow Condensed', sans-serif",
      "--oc-prose": "'Barlow Condensed', sans-serif",
      "--oc-label": "'JetBrains Mono', ui-monospace, monospace",
      "--oc-label-w": "400",
      "--oc-prose-size": "15px",
      "--oc-prose-lh": "1.68",
      "--oc-r-sm": "0px",
      "--oc-r-md": "0px",
      "--oc-frost": "rgba(13,15,19,0.52)",
      "--oc-texture":
        "repeating-linear-gradient(90deg, rgba(232,234,236,0.04) 0 1px, transparent 1px 88px), repeating-linear-gradient(0deg, rgba(232,234,236,0.022) 0 1px, transparent 1px 88px)",
      "--oc-texture-size": "100% 100%, 100% 100%",
      "--oc-bloom":
        "radial-gradient(900px 460px at 22% 0%, rgba(201,144,63,0.045), transparent 70%)",
    },
  },
  {
    id: "atelier",
    name: "Atelier",
    note: "light · paper · editorial · live folds into accent",
    scheme: "light",
    novel: ["type", "texture", "light"],
    vars: {
      "--oc-frame": "#fbfaf7",
      "--oc-panel": "#f7f5f0",
      "--oc-canvas": "#fbfaf7",
      "--oc-raised": "#f5f2ec",
      "--oc-sunken": "#efece4",
      "--oc-screen": "#14110e",
      "--oc-screen-ink": "rgba(242,237,228,0.82)",
      "--oc-line": "rgba(20,17,14,0.12)",
      "--oc-line-strong": "rgba(20,17,14,0.24)",
      "--oc-ink": "#14110e",
      "--oc-ink-dim": "#3a352e",
      "--oc-ink-mut": "#6f685e",
      "--oc-ink-faint": "#857f74",
      "--oc-accent": "#d8382a",
      "--oc-accent-ink": "#fbfaf7",
      "--oc-accent-wash": "rgba(216,56,42,0.07)",
      "--oc-accent-text": "#b52d20",
      "--oc-live": "#d8382a",
      "--oc-live-text": "#b52d20",
      "--oc-live-wash": "rgba(216,56,42,0.05)",
      "--oc-danger": "#a8281c",
      "--oc-display": "'Playfair Display', Georgia, serif",
      "--oc-prose": "'Playfair Display', Georgia, serif",
      "--oc-label": "'JetBrains Mono', ui-monospace, monospace",
      "--oc-label-w": "400",
      "--oc-prose-size": "15px",
      "--oc-prose-lh": "1.68",
      "--oc-r-sm": "0px",
      "--oc-r-md": "0px",
      "--oc-frost": "rgba(251,250,247,0.55)",
      /* asymmetric rule — wide column / tight baseline = ruled stock */
      "--oc-texture":
        "repeating-linear-gradient(90deg, rgba(20,17,14,0.045) 0 1px, transparent 1px 124px), repeating-linear-gradient(0deg, rgba(20,17,14,0.02) 0 1px, transparent 1px 31px)",
      "--oc-texture-size": "100% 100%, 100% 100%",
      "--oc-bloom":
        "radial-gradient(1000px 520px at 40% 0%, rgba(255,255,255,0.85), transparent 72%)",
    },
  },
  {
    id: "unit47",
    name: "Unit 47",
    note: "light · industrial · monospace prose · the only rounded preset",
    scheme: "light",
    novel: ["type", "texture", "light"],
    vars: {
      "--oc-frame": "#dcd8d0",
      "--oc-panel": "#efece6",
      "--oc-canvas": "#e7e4dd",
      "--oc-raised": "#f8f6f1",
      "--oc-sunken": "#f8f6f1",
      "--oc-screen": "#131412",
      "--oc-screen-ink": "rgba(233,230,221,0.76)",
      "--oc-line": "rgba(27,26,23,0.16)",
      "--oc-line-strong": "rgba(27,26,23,0.3)",
      "--oc-ink": "#1b1a17",
      "--oc-ink-dim": "#3b3934",
      "--oc-ink-mut": "#6e6b63",
      "--oc-ink-faint": "#8a8377",
      "--oc-accent": "#ff6a13",
      "--oc-accent-ink": "#ffffff",
      "--oc-accent-wash": "rgba(255,106,19,0.12)",
      "--oc-accent-text": "#a8410a",
      "--oc-live": "#46c26a",
      "--oc-live-text": "#1f7a42",
      "--oc-live-wash": "rgba(70,194,106,0.08)",
      "--oc-danger": "#d8442a",
      "--oc-display": "'IBM Plex Sans', sans-serif",
      "--oc-prose": "'JetBrains Mono', ui-monospace, monospace",
      "--oc-label": "'Syne', sans-serif",
      "--oc-label-w": "700",
      "--oc-prose-size": "12px",
      "--oc-prose-lh": "1.75",
      "--oc-r-sm": "8px",
      "--oc-r-md": "10px",
      "--oc-frost": "rgba(231,228,221,0.5)",
      "--oc-texture":
        "repeating-linear-gradient(90deg, rgba(27,26,23,0.022) 0 1px, transparent 1px 3px), radial-gradient(rgba(27,26,23,0.045) 1px, transparent 1px)",
      "--oc-texture-size": "100% 100%, 22px 22px",
      "--oc-bloom":
        "radial-gradient(900px 500px at 44% 0%, rgba(255,255,255,0.7), transparent 70%)",
    },
  },
  {
    id: "meridian",
    name: "Meridian",
    note: "dark · cool · two opposing light sources",
    scheme: "dark",
    novel: ["type", "texture", "light"],
    vars: {
      "--oc-frame": "#0a0d11",
      "--oc-panel": "#0c1015",
      "--oc-canvas": "#12171e",
      "--oc-raised": "#1a2027",
      "--oc-sunken": "#090c10",
      "--oc-screen": "#05080b",
      "--oc-screen-ink": "rgba(223,233,240,0.8)",
      "--oc-line": "rgba(223,233,240,0.08)",
      "--oc-line-strong": "rgba(223,233,240,0.16)",
      "--oc-ink": "#e7eef5",
      "--oc-ink-dim": "rgba(223,233,240,0.82)",
      "--oc-ink-mut": "rgba(223,233,240,0.58)",
      "--oc-ink-faint": "rgba(223,233,240,0.46)",
      "--oc-accent": "#4fa3ff",
      "--oc-accent-ink": "#04101c",
      "--oc-accent-wash": "rgba(79,163,255,0.1)",
      "--oc-accent-text": "#7dbcff",
      "--oc-live": "#3ecfa8",
      "--oc-live-text": "#55dcb6",
      "--oc-live-wash": "rgba(62,207,168,0.05)",
      "--oc-danger": "#f77f72",
      "--oc-display": "'Bricolage Grotesque', sans-serif",
      "--oc-prose": "'Archivo', sans-serif",
      "--oc-label": "'Archivo', sans-serif",
      "--oc-label-w": "600",
      "--oc-prose-size": "14px",
      "--oc-prose-lh": "1.72",
      "--oc-r-sm": "4px",
      "--oc-r-md": "8px",
      "--oc-frost": "rgba(18,23,30,0.55)",
      "--oc-texture":
        "repeating-linear-gradient(0deg, rgba(223,233,240,0.022) 0 1px, transparent 1px 32px), repeating-linear-gradient(90deg, rgba(223,233,240,0.022) 0 1px, transparent 1px 32px)",
      "--oc-texture-size": "100% 100%, 100% 100%",
      "--oc-bloom":
        "radial-gradient(1100px 560px at 56% -16%, rgba(79,163,255,0.08), transparent 70%), radial-gradient(760px 460px at 96% 112%, rgba(62,207,168,0.055), transparent 70%)",
    },
  },
  {
    id: "porcelain",
    name: "Porcelain",
    note: "light · formal · halftone dot screen",
    scheme: "light",
    novel: ["type", "texture", "light"],
    vars: {
      "--oc-frame": "#fcfcfd",
      "--oc-panel": "#f7f8fa",
      "--oc-canvas": "#fcfcfd",
      "--oc-raised": "#ffffff",
      "--oc-sunken": "#f2f3f6",
      "--oc-screen": "#10131a",
      "--oc-screen-ink": "rgba(233,237,244,0.82)",
      "--oc-line": "rgba(15,23,42,0.09)",
      "--oc-line-strong": "rgba(15,23,42,0.16)",
      "--oc-ink": "#0f172a",
      "--oc-ink-dim": "#33405a",
      "--oc-ink-mut": "#5b6780",
      "--oc-ink-faint": "#7c8699",
      "--oc-accent": "#3346c9",
      "--oc-accent-ink": "#ffffff",
      "--oc-accent-wash": "rgba(51,70,201,0.07)",
      "--oc-accent-text": "#2c3cb0",
      "--oc-live": "#12855c",
      "--oc-live-text": "#0f7351",
      "--oc-live-wash": "rgba(18,133,92,0.05)",
      "--oc-danger": "#b4232a",
      "--oc-display": "'Bodoni Moda', Georgia, serif",
      "--oc-prose": "'Instrument Sans', sans-serif",
      "--oc-label": "'Instrument Sans', sans-serif",
      "--oc-label-w": "600",
      "--oc-prose-size": "14px",
      "--oc-prose-lh": "1.7",
      "--oc-r-sm": "5px",
      "--oc-r-md": "9px",
      "--oc-frost": "rgba(252,252,253,0.6)",
      "--oc-texture":
        "radial-gradient(rgba(15,23,42,0.034) 1px, transparent 1px), radial-gradient(rgba(15,23,42,0.022) 1px, transparent 1px)",
      "--oc-texture-size": "14px 14px, 42px 42px",
      "--oc-bloom":
        "radial-gradient(1000px 520px at 46% 0%, rgba(255,255,255,0.9), transparent 72%)",
    },
  },
  {
    id: "editor",
    name: "Editor",
    note: "dark · neutral · NO texture — the control case",
    scheme: "dark",
    novel: ["type", "light"],
    vars: {
      "--oc-frame": "#181818",
      "--oc-panel": "#1c1c1c",
      "--oc-canvas": "#1f1f1f",
      "--oc-raised": "#252526",
      "--oc-sunken": "#141414",
      "--oc-screen": "#121212",
      "--oc-screen-ink": "rgba(212,212,212,0.86)",
      "--oc-line": "rgba(255,255,255,0.075)",
      "--oc-line-strong": "rgba(255,255,255,0.16)",
      "--oc-ink": "#e4e4e4",
      "--oc-ink-dim": "rgba(212,212,212,0.86)",
      "--oc-ink-mut": "rgba(212,212,212,0.6)",
      "--oc-ink-faint": "rgba(212,212,212,0.46)",
      "--oc-accent": "#4d9dfb",
      "--oc-accent-ink": "#08131f",
      "--oc-accent-wash": "rgba(77,157,251,0.12)",
      "--oc-accent-text": "#7cb8ff",
      "--oc-live": "#4ec9b0",
      "--oc-live-text": "#4ec9b0",
      "--oc-live-wash": "rgba(78,201,176,0.05)",
      "--oc-danger": "#f14c4c",
      "--oc-display": "'Archivo', sans-serif",
      "--oc-prose": "'Archivo', sans-serif",
      "--oc-label": "'JetBrains Mono', ui-monospace, monospace",
      "--oc-label-w": "400",
      "--oc-prose-size": "14px",
      "--oc-prose-lh": "1.72",
      "--oc-r-sm": "4px",
      "--oc-r-md": "6px",
      "--oc-frost": "rgba(31,31,31,0.6)",
      "--oc-texture": "none",
      "--oc-texture-size": "100% 100%",
      "--oc-bloom":
        "radial-gradient(1000px 520px at 50% -10%, rgba(255,255,255,0.025), transparent 70%)",
    },
  },
];

/* The rail keeps our v3 hierarchy — sections compress, they don't list.
   Section headers carry a rule + count: precedence is legible before you read. */
const RAIL: Array<{ label: string; count: number; lead?: boolean }> = [
  { label: "Needs you", count: 2, lead: true },
  { label: "Agents · by project", count: 14 },
  { label: "Channels", count: 4 },
];

const STEPS = [
  { n: "07", tool: "ls", arg: "~/.openscout/ 2>/dev/null; echo ---", ok: true, took: "10s" },
  { n: "08", tool: "bash", arg: 'for n in pdf-research "PDF Research"…', ok: true, took: "7s" },
  { n: "09", tool: "bash", arg: "sqlite3 -readonly control-plane.sqlite…", ok: true, took: "5s" },
  { n: "10", tool: "bash", arg: "sqlite3 -readonly control-plane.s…", ok: false, took: "now" },
];

/**
 * The thread — a real multi-agent exchange, not a monologue with one live turn.
 *
 * Fixture is the actual conversation that produced this study: the operator
 * briefs two harnesses, grok returns an adversarial verdict, kimi reports and
 * then asks a question back. That makes the study self-documenting, and it
 * exercises every register at once under all six presets.
 *
 * Turn grammar is comms-one-rail's, unchanged (docs/design/comms-channel-navigation.md):
 *   ambient  flat, no card — the default and the bulk
 *   status   one compact mono line, indented past the avatar; not a full turn
 *   ask      the steering atom: the ONLY carded, ONLY accented unit in the flow
 *   notices  identical broker posts coalesce to one read unit
 *
 * Note what is deliberately NOT here: per-agent color. Identity is carried by
 * name and avatar letter only. Coloring agents would be exactly the categorical
 * coding the house rule bans, and it would also collide with the accent that
 * marks the ask — the one thing in the thread that actually wants your eye.
 */
type Register = "ambient" | "status" | "ask";

type ThreadTurn = {
  who: string;
  harness?: string;
  when: string;
  body: string;
  register?: Register;
  mention?: boolean;
  artifact?: string;
  /** Hidden in the 6-up grid, where only the tail of the thread fits. */
  secondary?: boolean;
};

const THREAD: ThreadTurn[] = [
  {
    who: "You",
    when: "21:04",
    body: "Two lenses on the operator-console harvest: adversarial on the theme contract, build on the instrument components. Work from the doc, not from my summary.",
    artifact: "docs/design/operator-console-harvest.md",
    secondary: true,
  },
  {
    who: "maxwell-2",
    harness: "grok",
    when: "21:19",
    body: "Type axis doesn't survive native. ScoutThemeColors is fifteen Color fields and nothing else; bubbleRadius is hardcoded to 11. Native has nowhere to put type or radius, and native originates the contract. Structural row count survives a type swap — viewport density doesn't.",
    artifact: "docs/eng/theme-token-contract-adversarial-review.md",
  },
  {
    who: "epicurus-4",
    harness: "kimi",
    when: "21:31",
    register: "status",
    body: "ready — 4 specimens, both skins verified",
  },
  {
    who: "epicurus-4",
    harness: "kimi",
    when: "21:38",
    register: "ask",
    mention: true,
    body: "The fixture surfaced something the mock never had to face: a mid-turn error scrolls behind the fold within a few steps, so in the product the failure row is usually collapsed. Does the ledger need an error-pinned-above-the-fold rule?",
  },
];

const NOTICES = { count: 2, label: "broker dispatch notices" };

/** Durations → bar heights. One error bar; everything else neutral.
    One accent only: "working" is carried by motion, not by a second hue. */
const SPARK = [3, 5, 2, 6, 3, 5, 14, 10, 7, 5, 8];

function ThreadTurnView({ turn }: { turn: ThreadTurn }) {
  if (turn.register === "status") {
    return (
      <div className={styles.status} data-secondary={turn.secondary || undefined}>
        <span className={styles.statusWho}>{turn.who}</span>
        <span className={styles.statusBody}>{turn.body}</span>
        <span className={styles.turnWhen}>{turn.when}</span>
      </div>
    );
  }
  const ask = turn.register === "ask";
  return (
    <div className={styles.threadTurn} data-secondary={turn.secondary || undefined}>
      <span className={styles.avatar}>{turn.who.slice(0, 1).toUpperCase()}</span>
      {/* The ask is the only carded unit — full-perimeter tinted hairline, no
          left bar (house rule: no left accent bars on rounded elements). */}
      <div className={ask ? `${styles.threadBody} ${styles.askCard}` : styles.threadBody}>
        <div className={styles.threadHead}>
          <span className={styles.turnWho}>{turn.who}</span>
          {turn.harness && <span className={styles.harness}>{turn.harness}</span>}
          {ask && <span className={styles.askTag}>ask · needs your reply</span>}
          <span className={styles.turnWhen}>{turn.when}</span>
        </div>
        <p className={styles.turnText}>
          {turn.mention && <span className={styles.mention}>@you</span>} {turn.body}
        </p>
        {turn.artifact && <span className={styles.artifact}>{turn.artifact}</span>}
      </div>
    </div>
  );
}

function Frame({ theme, compact }: { theme: Theme; compact?: boolean }) {
  return (
    <div
      className={`${styles.frame}${compact ? ` ${styles.frameCompact}` : ""}`}
      style={theme.vars as React.CSSProperties}
    >
      <div className={styles.titlebar}>
        <span className={styles.mark} />
        <span className={styles.titleLabel}>Openscout · Messages</span>
        <span className={styles.titleSpacer} />
        <span className={styles.keycap}>⌘</span>
        <span className={styles.keycap}>K</span>
      </div>

      <div className={styles.body}>
        <div className={styles.rail}>
          {RAIL.map((s) => (
            <div key={s.label}>
              <div className={styles.section} data-lead={s.lead || undefined}>
                <span className={styles.sectionLabel}>{s.label}</span>
                <span className={styles.sectionRule} />
                <span className={styles.sectionCount}>{s.count}</span>
              </div>
              {s.lead ? (
                <>
                  <div className={styles.row} data-on>
                    <span className={styles.rowName}>openscout</span>
                    <span className={styles.rowBadge}>5</span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowName}>blink-ios-sync-council</span>
                    <span className={styles.rowBadgeSoft}>1</span>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.row} data-live>
                    <span className={styles.rowName}>openscout · pdf audit</span>
                    <span className={styles.rowTime}>4m</span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowName}>openscout · relay</span>
                    <span className={styles.rowTime}>11h</span>
                  </div>
                </>
              )}
            </div>
          ))}
          <div className={styles.railFoot}>
            <span className={styles.sectionLabel}>Observed</span>
            <span className={styles.sectionCount}>112</span>
          </div>
        </div>

        <div className={styles.pane}>
          {/* texture + bloom: ONE non-interactive overlay, fully themed */}
          <div className={styles.paneTexture} aria-hidden />

          <div className={styles.paneHead}>
            <span className={styles.paneAccentBar} />
            <span className={styles.paneTitle}>openscout</span>
            <span className={styles.paneSub}>PDF Research reproduction</span>
          </div>

          <div className={styles.turns}>
            <div className={styles.divider} data-secondary>
              <span className={styles.dividerRule} />
              <span className={styles.dividerLabel}>Today</span>
              <span className={styles.dividerRule} />
            </div>

            {THREAD.map((turn, i) => (
              <div key={i}>
                <ThreadTurnView turn={turn} />
                {/* identical broker posts collapse to ONE read unit in-thread */}
                {i === 0 && (
                  <div className={styles.noticeFold} data-secondary>
                    <span className={styles.noticeCount}>{NOTICES.count}</span>
                    <span className={styles.noticeLabel}>{NOTICES.label}</span>
                    <span className={styles.noticeChevron}>▸</span>
                  </div>
                )}
              </div>
            ))}

            <div className={styles.turn}>
              <span className={styles.avatarLive}>S</span>
              <div className={styles.turnBody}>
                <div className={styles.turnHead}>
                  <span className={styles.turnTitle}>PDF Research audit</span>
                  <span className={styles.turnChip}>msawl57m</span>
                  <span className={styles.spark}>
                    {SPARK.map((h, i) => (
                      <span
                        key={i}
                        className={styles.sparkBar}
                        data-hot={i === 9 ? "err" : i >= 6 ? "on" : undefined}
                        style={{ height: `${h}px` }}
                      />
                    ))}
                  </span>
                  <span className={styles.working}>
                    <span className={styles.liveDot} />
                    Working 4m 12s
                  </span>
                </div>

                <div className={styles.running}>
                  <div className={styles.runningLabel}>Running now</div>
                  <div className={styles.runningCmd}>
                    <span className={styles.cmdVerb}>bash</span> sqlite3{" "}
                    <span className={styles.cmdFlag}>-readonly</span> control-plane.sqlite
                    <span className={styles.caret}>▍</span>
                  </div>
                </div>

                <div className={styles.ledger}>
                  <div className={styles.ledgerHead}>
                    <span>#</span>
                    <span>Tool call</span>
                    <span>Result</span>
                    <span className={styles.right}>Took</span>
                  </div>
                  {STEPS.map((s) => (
                    <div key={s.n} className={styles.ledgerRow} data-err={!s.ok || undefined}>
                      <span className={styles.ledgerN}>{s.n}</span>
                      <span className={styles.ledgerCall}>
                        <span className={styles.cmdVerb}>{s.tool}</span> {s.arg}
                      </span>
                      <span className={s.ok ? styles.ok : styles.err}>
                        {s.ok ? "✓ success" : "✕ error"}
                      </span>
                      <span className={`${styles.right} ${styles.took}`}>{s.took}</span>
                    </div>
                  ))}
                  <div className={styles.ledgerMore}>↑ 6 earlier steps</div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.composer}>
            <span className={styles.composerCaret} />
            <span className={styles.composerHint}>
              Message #openscout — or @session to steer an agent
            </span>
            <span className={styles.keycap}>⏎</span>
          </div>
        </div>

        <div className={styles.context}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Context</span>
            <span className={styles.sectionRule} />
            <span className={styles.sectionCount}>§1</span>
          </div>
          {/* elapsed as a hero numeral — FLAT, no box (Instrument rule) */}
          <div className={styles.met}>
            <span className={styles.metNum}>04:12</span>
            <span className={styles.metLabel}>elapsed</span>
          </div>
          <div className={styles.metSince}>since 20:53:48</div>

          <div className={styles.kv}>
            <span>project</span>
            <span className={styles.kvVal}>openscout</span>
          </div>
          <div className={styles.kv}>
            <span>runtime</span>
            <span className={styles.kvVal}>claude · tmux</span>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Live terminal</span>
            <span className={styles.sectionRule} />
          </div>
          <div className={styles.screenWrap}>
            {/* corner registration ticks — instrument viewport, no chrome bar */}
            <span className={styles.tick} data-c="tl" />
            <span className={styles.tick} data-c="tr" />
            <span className={styles.tick} data-c="bl" />
            <span className={styles.tick} data-c="br" />
            <div className={styles.screen}>
              <div className={styles.screenLive}>$ sqlite3 -readonly control-plane.sqlite</div>
              <div>CREATE TABLE conversations (</div>
              <div>&nbsp;&nbsp;id TEXT PRIMARY KEY,</div>
              <div className={styles.screenAccent}>
                &nbsp;&nbsp;body_raw TEXT<span className={styles.caret}>▍</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Silhouette as the fourth channel for the ask.
 *
 * Today the ask is marked three ways — carded, accent stroke, accent wash — all
 * of which are COLOR. Shape is pre-attentive in a way color isn't: you register
 * an outline before you read, it survives every preset identically, and it does
 * not spend the accent budget.
 *
 * Two house rules bound the option set, and both are load-bearing:
 *   · No tails. Avatar-led turns were chosen over chat bubbles outright
 *     (feedback: comms design calls) — so no pointer/beak treatments.
 *   · A left accent bar is legal ONLY on square elements, never on rounded
 *     (feedback: no left bar on rounded). So "go square" is not a neutral
 *     choice — it unlocks an idiom that rounding forbids.
 *
 * The interesting move: the ask stops using --r-md at all. Its silhouette then
 * differs categorically from every other surface in the frame, in all six
 * presets, including the rounded one.
 */
type AskShape = {
  id: string;
  name: string;
  note: string;
  /** Whether the treatment still reads when --r-md is 10px (Unit 47). */
  survivesRounded: boolean;
};

const ASK_SHAPES: AskShape[] = [
  { id: "rounded", name: "Rounded", note: "baseline — today's ask card, radius from the preset", survivesRounded: true },
  { id: "chamfer", name: "Chamfer", note: "one clipped corner; quietest option, reads as tagged", survivesRounded: true },
  { id: "ticket", name: "Ticket", note: "opposed chamfers — a tag pulled from a rack", survivesRounded: true },
  { id: "perforated", name: "Perforated", note: "tear-off foot: an ask is a thing you take away and answer", survivesRounded: true },
  { id: "square", name: "Square + bar", note: "going square legalizes the left accent bar", survivesRounded: false },
  { id: "ticks", name: "Registration ticks", note: "no stroke at all; four corner marks — instrument grammar", survivesRounded: true },
];

function AskShapeSpecimen({ shape }: { shape: AskShape }) {
  const inner = (
    <>
      <div className={styles.threadHead}>
        <span className={styles.turnWho}>epicurus-4</span>
        <span className={styles.harness}>kimi</span>
        <span className={styles.askTag}>ask · needs your reply</span>
        <span className={styles.turnWhen}>21:38</span>
      </div>
      <p className={styles.turnText}>
        <span className={styles.mention}>@you</span> Does the ledger need an
        error-pinned-above-the-fold rule?
      </p>
    </>
  );
  return (
    <div className={styles.threadTurn}>
      <span className={styles.avatar}>E</span>
      {/* chamfered shapes need a two-layer clip to keep a true 1px stroke on
          the diagonal — a single clipped element loses its border there */}
      <div className={`${styles.shapeOuter} ${styles[`shape_${shape.id}`]}`}>
        <div className={styles.shapeInner}>
          {shape.id === "ticks" && (
            <>
              <span className={styles.tick} data-c="tl" />
              <span className={styles.tick} data-c="tr" />
              <span className={styles.tick} data-c="bl" />
              <span className={styles.tick} data-c="br" />
            </>
          )}
          {inner}
        </div>
      </div>
    </div>
  );
}

function AskShapes({ theme }: { theme: Theme }) {
  return (
    <div className={styles.shapeGrid} style={theme.vars as React.CSSProperties}>
      {ASK_SHAPES.map((shape) => (
        <div key={shape.id} className={styles.shapeCell}>
          <div className={styles.shapeLabel}>
            <span className={styles.shapeName}>{shape.name}</span>
            {!shape.survivesRounded && <span className={styles.shapeWarn}>square only</span>}
          </div>
          <div className={styles.shapeNote}>{shape.note}</div>
          <div className={styles.shapeStage}>
            <div className={styles.shapeStageTexture} aria-hidden />
            <AskShapeSpecimen shape={shape} />
          </div>
        </div>
      ))}
    </div>
  );
}

const AXES: Array<{ axis: Axis; tokens: string; ours: boolean; note: string }> = [
  { axis: "canvas", tokens: "frame · panel · canvas · raised · sunken · screen", ours: true, note: "surface ramp + temperature" },
  { axis: "accent", tokens: "accent · accent-wash · live · danger", ours: true, note: "two presets fold live into accent" },
  { axis: "radius", tokens: "r-sm · r-md", ours: true, note: "in our contract, but welded to canvas+accent" },
  { axis: "type", tokens: "display · prose · label · prose-size · prose-lh · label-w", ours: false, note: "NEW — the expensive one; native can't host it" },
  { axis: "texture", tokens: "texture · texture-size", ours: false, note: "NEW — one overlay div, genuinely cheap" },
  { axis: "light", tokens: "bloom · frost", ours: false, note: "NEW — one overlay div, genuinely cheap" },
];

function AxisTable({ theme }: { theme: Theme }) {
  return (
    <div className={styles.axes}>
      {AXES.map((a) => {
        const novel = theme.novel.includes(a.axis);
        return (
          <div key={a.axis} className={styles.axisRow} data-novel={novel || undefined}>
            <span className={styles.axisName}>{a.axis}</span>
            <span className={styles.axisTokens}>{a.tokens}</span>
            <span className={styles.axisNote}>{a.note}</span>
            <span className={styles.axisFlag}>{a.ours ? "in contract" : "new axis"}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function OperatorConsoleThemesStudy() {
  const [active, setActive] = useState(0);
  const theme = THEMES[active]!;
  useThemeFonts();

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · cross · themes" title="Operator Console — six themes, decomposed">
        Extracted from the Operator Console mock and pulled apart onto six axes,
        because copying its six welded blocks would import the exact defect
        appearance-decomposed-picker.md §0.1 already diagnosed in our own picker
        (&ldquo;not three settings; three opinions&rdquo;). Each theme survives as a named
        preset; the axes stay separable. Canvas, accent, and radius are already in
        our contract — type, texture, and light are new, and they do not cost the
        same: texture and light are one overlay div, while type breaks native
        parity outright (ScoutThemeColors is fifteen Color fields, zero fonts).
        Identical content under every preset, because that is the only honest
        comparison. The content is a real multi-agent thread — operator briefs two
        harnesses, grok returns a verdict, kimi reports and asks back — so all four
        turn registers (ambient · status · ask · coalesced notices) get exercised
        under every preset at once. Editor is the control: the one preset with no
        texture.
      </StudyHeader>

      <section className="mt-8 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          One frame, one preset — a multi-agent thread ending in a live turn
        </h2>
        <div className={styles.tabs}>
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className={styles.tab}
              data-on={i === active || undefined}
              onClick={() => setActive(i)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className={styles.themeNote}>{theme.note}</div>
        <Frame theme={theme} />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          The ask, shaped — silhouette as the fourth channel (rendered in {theme.name})
        </h2>
        <p className={styles.sectionLede}>
          The ask is marked three ways today and all three are color. Shape is
          pre-attentive, costs no accent budget, and reads identically in every
          preset. Flip the preset above and watch which treatments survive —
          the square one is the tell, because a left accent bar is only legal
          when there is no radius to fight.
        </p>
        <AskShapes theme={theme} />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          The axes — what {theme.name} sets, and what our contract already covers
        </h2>
        <AxisTable theme={theme} />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          All six at once — the comparison the mock&rsquo;s tab strip can&rsquo;t give you
        </h2>
        <div className={styles.grid}>
          {THEMES.map((t) => (
            <div key={t.id} className={styles.gridCell}>
              <div className={styles.gridLabel}>
                <span className={styles.gridName}>{t.name}</span>
                <span className={styles.gridNote}>{t.note}</span>
              </div>
              <Frame theme={t} compact />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
