"use client";

/**
 * Mobile v3 · Feed identity — the post's left column and its harness splash.
 *
 * Extends /studies/mobile-timeline §1 (the X-like Home feed). That study
 * settled the post anatomy; this one settles the two things it left flat:
 *
 *   1 · the identity mark — today a tinted tile with ONE mono initial, drawn
 *       from the four STATUS colors, so a project's agents share an initial
 *       AND identity borrows the vocabulary that means live/needs/failed;
 *   2 · the harness — currently absent from the feed entirely.
 *
 * Both marks here are deterministic (name → hue → glyph) on the same curated
 * wheel the sprite engine already uses (lib/agent-identity.ts), so a fleet
 * reads as one designed set and identity never collides with status color.
 *
 * HONEST CONSTRAINT (measured 2026-08-04): the phone can only resolve a
 * harness for the ~⅓ of feed rows that match an agent or session in the
 * roster. Cardless flight agents ("openscout-faraday-2") are actors whose
 * endpoint carries `harness: claude` in the broker snapshot, but the
 * `mobile/activity` row does not carry it to the phone. Frames below show
 * both states: a known harness gets its mark, an unknown one gets nothing —
 * never a guessed badge.
 */

import type { CSSProperties, ReactNode } from "react";
import { PhoneShell, ScoutIOSStyles, Glyph } from "@/components/scout-ios";
import { HarnessMark } from "@/components/HarnessMark";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { CURATED_HUES, initials, xmur3 } from "@/lib/agent-identity";

/* ════════════════════════════════════════════════════════════════════
   Studio helpers — same grammar as the sibling editorial studies.
   ════════════════════════════════════════════════════════════════════ */

function FrameCap({ k, children }: { k: string; children?: ReactNode }) {
  return (
    <div className="mb-3 min-h-[76px]">
      <div
        className="font-mono text-2xs font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--scout-accent)" }}
      >
        {k}
      </div>
      {children ? (
        <div className="mt-1 max-w-[42ch] text-sm leading-snug text-studio-ink-muted">{children}</div>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   The 5×7 matrix face.

   One well-known letterform grid, written as bit rows so it ports to Swift
   verbatim (the Swift side needs the same 7 five-bit rows, nothing else).
   Unlit cells are drawn too, at low alpha — that is what makes it read as a
   display rather than as a pixel letter.
   ════════════════════════════════════════════════════════════════════ */

const FACE_5x7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "·": ["00000", "00000", "01110", "01110", "01110", "00000", "00000"],
};

/** Same hash the sprite engine seeds with, so one name lands on one hue
 *  across every mark in the system. */
function hueFor(name: string): number {
  const seed = xmur3(name)();
  return CURATED_HUES[seed % CURATED_HUES.length];
}

function faceFor(ch: string): string[] {
  return FACE_5x7[ch.toUpperCase()] ?? FACE_5x7["·"];
}

/**
 * The matrix mark: `letters` rendered as lit cells on a 5×7 grid per glyph,
 * tinted by the name's hue, on a soft plate of the same hue.
 */
function MatrixMark({
  name,
  letters,
  size = 34,
  dim = 0.13,
}: {
  name: string;
  letters: string;
  /** Plate height in px; the plate widens for a second glyph. */
  size?: number;
  /** Unlit-cell alpha. */
  dim?: number;
}) {
  const hue = hueFor(name);
  const lit = `oklch(0.78 0.15 ${hue})`;
  const off = `oklch(0.78 0.15 ${hue} / ${dim})`;
  const glyphs = [...letters].map(faceFor);
  const gap = 1; // blank columns between glyphs
  const cols = glyphs.length * 5 + (glyphs.length - 1) * gap;
  const rows = 7;
  // Cell pitch derives from the height so glyphs stay square-ish.
  const pitch = (size - 10) / rows;
  const r = pitch * 0.36;

  const cells: ReactNode[] = [];
  glyphs.forEach((face, gi) => {
    const originX = gi * (5 + gap);
    face.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        cells.push(
          <circle
            key={`${gi}-${y}-${x}`}
            cx={(originX + x + 0.5) * pitch}
            cy={(y + 0.5) * pitch}
            r={r}
            fill={bit === "1" ? lit : off}
          />,
        );
      });
    });
  });

  return (
    <span
      className="fid-mark"
      style={
        {
          width: cols * pitch + 10,
          height: size,
          background: `oklch(0.78 0.15 ${hue} / 0.10)`,
          borderColor: `oklch(0.78 0.15 ${hue} / 0.30)`,
        } as CSSProperties
      }
    >
      <svg width={cols * pitch} height={rows * pitch} style={{ display: "block" }}>
        {cells}
      </svg>
    </span>
  );
}

/** Today's mark: one mono initial on a status-palette tile. */
const LEGACY_TONES = ["var(--i-accent)", "var(--i-info)", "var(--i-ok)", "var(--i-warn)"];
function LegacyMark({ name }: { name: string }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const tone = LEGACY_TONES[h % LEGACY_TONES.length];
  return (
    <span className="fid-mark fid-mark-legacy" style={{ color: tone }}>
      {(name.replace(/[^a-zA-Z0-9]/g, "")[0] ?? "•").toUpperCase()}
    </span>
  );
}

/** The harness as a corner badge riding the mark's bottom-right. */
function MarkWithBadge({ children, harness }: { children: ReactNode; harness?: string | null }) {
  return (
    <span className="fid-markwrap">
      {children}
      {harness ? (
        <span className="fid-badge" title={harness}>
          <HarnessMark harness={harness} size={9} />
        </span>
      ) : null}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Feed rows — the real posts on the phone right now (2026-08-04 12:20),
   including the two states that matter: a resolved harness and an
   unresolved one.
   ════════════════════════════════════════════════════════════════════ */

type Mark = "legacy" | "initial" | "monogram" | "sprite";
type PostState = "active" | "needs" | "failed";

interface Post {
  agent: string;
  project?: string;
  harness?: string | null;
  age: string;
  state: PostState;
  line: string;
}

const POSTS: Post[] = [
  {
    agent: "faraday-2", project: "openscout", harness: "claude", age: "1h", state: "active",
    line: "Kimi session that ran iOS Scout xcodebuild for v3 navigation:",
  },
  {
    agent: "bartok-3", project: "openscout", harness: null, age: "1h", state: "active",
    line: "answered — one Kimi session matches.",
  },
  {
    agent: "avogadro-3", project: "openscout", harness: null, age: "1h", state: "active",
    line: "Kimi iOS v3 nav / sim build coordinates, from local ~/.kimi-code records.",
  },
  {
    agent: "locke-2", project: "openscout", harness: "codex", age: "1h", state: "needs",
    line: "Kimi iOS v3 nav / sim build coordinates — from local ~/.kimi-code records, not inferred.",
  },
  {
    agent: "You", age: "1h", state: "active",
    line: "Review this from first principles, then inspect the relevant implementation.",
  },
  {
    agent: "epicurus-3", project: "blink", harness: "claude", age: "1h", state: "active",
    line: "I'm starting with the evidence trail—Scout/OpenScout sessions and git history—before touching iOS files. In parallel, I'm isolating the c…",
  },
  {
    agent: "spinoza-2", project: "blink", harness: "codex", age: "2h", state: "failed",
    line: "APP_ID and BUILD_ID remain pending: ASC has no app record, and web auth failed.",
  },
];

const STATE_LABEL: Record<PostState, string> = { active: "", needs: "Needs you", failed: "Failed" };

function markFor(kind: Mark, p: Post) {
  switch (kind) {
    case "legacy":
      return <LegacyMark name={p.agent} />;
    case "initial":
      return <MatrixMark name={p.agent} letters={(p.agent[0] ?? "·").toUpperCase()} />;
    case "monogram":
      return <MatrixMark name={p.agent} letters={initials(p.agent)} />;
    case "sprite":
      return <SpriteAvatar name={p.agent} size={34} tile />;
  }
}

function FeedRow({ p, mark, badge }: { p: Post; mark: Mark; badge: boolean }) {
  const meta = [p.project, badge ? null : p.harness, p.age].filter(Boolean).join(" · ");
  return (
    <div className="fid-post">
      {badge ? <MarkWithBadge harness={p.harness}>{markFor(mark, p)}</MarkWithBadge> : markFor(mark, p)}
      <div className="fid-post-main">
        <div className="fid-post-top">
          <span className="fid-post-agent">{p.agent}</span>
          <span className="fid-post-meta">{meta}</span>
          {p.state !== "active" ? (
            <span className="fid-post-state" data-state={p.state}>
              {STATE_LABEL[p.state]}
            </span>
          ) : null}
        </div>
        <div className="fid-post-line">{p.line}</div>
      </div>
    </div>
  );
}

function FeedFrame({ mark, badge = true }: { mark: Mark; badge?: boolean }) {
  return (
    <PhoneShell surface="home" variant="shipped" showChrome={false}>
      <div className="iBody fid-body">
        <div className="fid-subbar">
          <span className="fid-filter">
            For you
            <Glyph kind="chevron" size={10} rotate={90} />
          </span>
        </div>
        <div className="fid-feed">
          {POSTS.map((p) => (
            <FeedRow key={p.agent} p={p} mark={mark} badge={badge} />
          ))}
        </div>
      </div>
    </PhoneShell>
  );
}

/** The marks alone, at 1× and 3×, so the letterform is judgeable. */
function MarkStrip({ kind }: { kind: Mark }) {
  const names = ["faraday-2", "bartok-3", "avogadro-3", "epicurus-3", "spinoza-2", "You"];
  return (
    <div className="fid-strip">
      <div className="fid-strip-row">
        {names.map((n) => (
          <span key={n}>{markFor(kind, { agent: n, age: "", state: "active", line: "" })}</span>
        ))}
      </div>
      <div className="fid-zoom">{markFor(kind, { agent: "faraday-2", age: "", state: "active", line: "" })}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */

export default function V3FeedIdentityStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <ScoutIOSStyles />
      <style>{CSS}</style>

      <div className="font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
        Mobile v3 · Home feed
      </div>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-studio-ink">Feed identity</h1>
      <p className="mt-3 max-w-[62ch] text-md leading-relaxed text-studio-ink-muted">
        The post anatomy is settled (
        <a className="underline decoration-dotted" href="/studies/mobile-timeline">
          mobile-timeline §1
        </a>
        ). Two things it left flat: the identity mark is one mono initial drawn from the four{" "}
        <em>status</em> colors — so every agent in a project shares a letter, and identity speaks in the
        vocabulary that means live / needs you / failed — and the harness never appears at all. Both marks
        below are deterministic on the sprite engine&rsquo;s curated hue wheel, so identity gets its own
        register and the status colors stay rare.
      </p>

      <div className="fid-grid">
        <div>
          <FrameCap k="0 · Today">
            One initial, status palette. Four projects of agents collapse onto a handful of letters and
            four colors.
          </FrameCap>
          <MarkStrip kind="legacy" />
          <FeedFrame mark="legacy" badge={false} />
        </div>

        <div>
          <FrameCap k="1 · Matrix initial">
            The letter on a 5×7 display: lit cells at the name&rsquo;s hue, unlit cells still drawn at low
            alpha so it reads as an instrument, not a pixel font.
          </FrameCap>
          <MarkStrip kind="initial" />
          <FeedFrame mark="initial" />
        </div>

        <div>
          <FrameCap k="2 · Matrix monogram">
            Two glyphs on one plate — `faraday-2` → FA. Far more separable across a long fleet; the plate
            goes rectangular, which reads as a nameplate rather than an avatar.
          </FrameCap>
          <MarkStrip kind="monogram" />
          <FeedFrame mark="monogram" />
        </div>

        <div>
          <FrameCap k="3 · Sprite">
            The identity Scout already ships (macOS/web roster): same name → same creature. Warmest of the
            three, least technical, and already ported.
          </FrameCap>
          <MarkStrip kind="sprite" />
          <FeedFrame mark="sprite" />
        </div>
      </div>

      <FrameCap k="Harness — where the splash goes">
        The badge rides the mark&rsquo;s corner (left) or sits inline in the meta line (right). The corner
        keeps the meta line short and puts runtime with identity, where it belongs; inline is quieter but
        competes with project · age. Rows whose harness the phone cannot resolve show <em>nothing</em> —
        no placeholder, no guess.
      </FrameCap>
      <div className="fid-grid">
        <div>
          <FrameCap k="A · Corner badge" />
          <FeedFrame mark="initial" badge />
        </div>
        <div>
          <FrameCap k="B · Inline in meta" />
          <FeedFrame mark="initial" badge={false} />
        </div>
      </div>

      <div className="mt-10 max-w-[62ch] text-sm leading-relaxed text-studio-ink-muted">
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-studio-ink-faint">
          Attribution gap
        </span>
        <p className="mt-2">
          Measured on the live fleet: only ~⅓ of feed rows can resolve a harness on the phone today.
          Cardless flight agents are broker <code>actors</code> whose endpoint records{" "}
          <code>harness: claude</code>, but <code>mobile/activity</code> does not carry it to the device.
          Closing that is a bridge change (both router copies + the Swift wire + the drift test), not a
          design change — the frames above are honest about the gap rather than papering it with a
          placeholder glyph.
        </p>
      </div>
    </main>
  );
}

const CSS = `
.fid-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(390px, 1fr)); gap: 40px 30px; margin-top: 28px; }

/* The strip reserves the zoomed mark's box so a 2.4× transform can never
   collide with the neighbouring column. */
.fid-strip { margin-bottom: 16px; display: flex; align-items: center; gap: 26px; height: 92px; }
.fid-strip-row { display: flex; align-items: center; gap: 8px; }
.fid-zoom { flex: none; width: 130px; height: 92px; display: grid; place-items: center; overflow: hidden;
  border-radius: 10px; background: color-mix(in srgb, var(--studio-ink, #fff) 3%, transparent); }
.fid-zoom > * { transform: scale(2.4); }

.fid-mark { flex: none; display: inline-grid; place-items: center; border-radius: 9px;
  border: 1px solid transparent; }
.fid-mark-legacy { width: 30px; height: 30px; font-family: var(--i-mono); font-size: 13px; font-weight: 700;
  color: currentColor; background: color-mix(in srgb, currentColor 13%, transparent);
  border-color: color-mix(in srgb, currentColor 32%, transparent); }

.fid-markwrap { position: relative; flex: none; display: inline-block; line-height: 0; }
.fid-badge { position: absolute; right: -4px; bottom: -4px; width: 15px; height: 15px; border-radius: 5px;
  display: grid; place-items: center; background: var(--i-bg); color: var(--i-muted);
  border: 1px solid var(--i-hairline); }

.fid-body { padding: 0; }
.fid-subbar { display: flex; align-items: center; padding: 0 14px; height: 40px;
  border-bottom: 1px solid var(--i-hairline); }
.fid-filter { display: inline-flex; align-items: center; gap: 5px; font-family: var(--i-mono);
  font-size: var(--text-2xs); font-weight: 600; color: var(--i-ink); }

.fid-feed { padding: 0 14px; }
.fid-post { display: flex; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--i-hairline); }
.fid-post-main { flex: 1; min-width: 0; }
.fid-post-top { display: flex; align-items: baseline; gap: 7px; }
.fid-post-agent { font-size: var(--text-lg); font-weight: 700; color: var(--i-ink); }
.fid-post-meta { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fid-post-state { margin-left: auto; flex: none; font-family: var(--i-mono); font-size: var(--text-2xs);
  font-weight: 700; letter-spacing: 0.5px; }
.fid-post-state[data-state="failed"] { color: var(--i-error); }
.fid-post-state[data-state="needs"] { color: var(--i-warn); }
.fid-post-line { margin-top: 3px; font-size: var(--text-md); line-height: 1.45; color: var(--i-ink);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
`;
