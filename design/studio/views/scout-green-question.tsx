"use client";

import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Scout — The Green Question.
 *
 * A decision aid, not a toggle. Scout ships three near-neighbor greens that
 * each play the same role on a different surface — the "alive / working"
 * signal:
 *   · HUD lime      #94E36B  (HUDChrome.accent — a warm-dark broadsheet costume)
 *   · menu green    #6DDB8C  (ShellPalette.accent, dark — the menu-bar helper)
 *   · iOS/web emerald #10B981 (HudPalette.accent — dark-locked phone + web)
 *
 * One open brand call: converge on a single green (and which), or let these
 * surfaces follow the user's chosen macOS accent instead. This is the
 * side-by-side to settle it — three signal surfaces DOWN × four treatments
 * ACROSS, rendered as a matrix so the eye can scan both ways.
 *
 * The surfaces are FIXED costumes; only the green-under-test changes per cell,
 * so the study reads the change honestly (lime on the iOS card looks loud —
 * that is the point). No skin toggle: nothing here follows --s-* tokens.
 *
 * Verified constant locations (grepped 2026-07-06):
 *   · HUDChrome.swift:60/62/63  lime restated across accent/accentSoft/whisper
 *     (+ hand-darkened accentDim L61) — rgb(0.580,0.890,0.420) = #94E36B
 *   · ScoutMenu/Views/Theme.swift:79-92,141  ShellPalette.accent adaptive pair
 *     (dark rgb 0.43,0.86,0.55 ≈ #6EDB8C) + derived soft/border/pressed/success
 *   · HudPalette.swift:27 (HudsonKit dependency, NOT this repo) rgb 16/185/129
 *     = #10B981, referenced 99× across 14 iOS files
 *   · web Provider.tsx:158/202 --hud-accent = oklch(0.72 0.16 125) — a YELLOWER
 *     green than #10B981; the "emerald" family is looser than it looks.
 */

/* ── palette constants (faithful, from the repo) ───────────────────────── */
const GREEN = {
  lime: "#94E36B", // HUDChrome.accent
  menu: "#6DDB8C", // ShellPalette.accent (dark)
  emerald: "#10B981", // HudPalette.accent
} as const;

const ACCENT = {
  juniper: "#3e66cc", // macOS default (juniper light)
  graphite: "#6d7ae8", // an alternate macOS accent
} as const;

/** HUD costume — HUDChrome.swift, converted from its rgb decimals. */
const HUD = {
  canvas: "#0B0A09",
  canvasAlt: "#141210",
  ink: "#E7E4DC",
  inkMuted: "#B3ADA5",
  inkFaint: "#807C74",
  border: "#413D37",
  borderSoft: "#28241F",
  rim: "#655E52",
} as const;

/** Menu costume — ShellPalette dark (hue 0.62 near-blacks + neutral inks). */
const MENU = {
  bg: "#131314",
  panel: "#18191A",
  card: "#1F2021",
  chrome: "#0F0F0F",
  ink: "#FFFFFF",
  copy: "#C7C7C7",
  dim: "#8F8F8F",
  muted: "#5C5C5C",
  line: "#242424",
  lineStrong: "#333333",
} as const;

/** iOS costume — the exact shipped --i-* HudPalette + scoutCard tones. */
const IOS = {
  ink: "#e5e5e5",
  muted: "#a3a3a3",
  dim: "#737373",
  cardTop: "#1b1b1e",
  cardBottom: "#131315",
  edgeTop: "#383a3f",
  edgeBottom: "#272727",
  hairline: "#181818",
} as const;

/** Soft-fill (accent @ ~12%) — kept honest per surface. */
function soft(hex: string, a = 0.13) {
  return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;
}

/* ════════════════════════════════════════════════════════════════════
   Surface mocks — each takes only the green-under-test (`c`). Everything
   else is the fixed costume. This is the whole thesis in code: the costume
   is constant, the accent is the variable.
   ════════════════════════════════════════════════════════════════════ */

function HudMock({ c }: { c: string }) {
  return (
    <div className="gq-hud">
      <div className="gq-hud-grain" />
      <div className="gq-hud-eyebrow" style={{ color: HUD.inkFaint }}>
        · FLEET — 6 AGENTS
      </div>
      <div className="gq-hud-rule" style={{ background: HUD.borderSoft }} />
      <div className="gq-hud-row">
        <span className="gq-workdot" style={{ background: c, boxShadow: `0 0 0 3px ${soft(c, 0.18)}` }} />
        <span className="gq-hud-name" style={{ color: HUD.ink }}>Talkie</span>
        <span className="gq-hud-status" style={{ color: c }}>WORKING</span>
        <span className="gq-hud-spacer" />
        <span className="gq-pip" style={{ background: c }} />
      </div>
      <div className="gq-hud-meta" style={{ color: HUD.inkMuted }}>
        ~/dev/talkie · master · resolveStartupTheme()
      </div>
    </div>
  );
}

function MenuMock({ c }: { c: string }) {
  const services = ["Broker", "Web", "Relay"];
  return (
    <div className="gq-menu" style={{ borderColor: MENU.line }}>
      <div className="gq-menu-grid" />
      <div className="gq-menu-head">
        <span className="gq-menu-mast" style={{ color: MENU.ink }}>Scout</span>
        <span className="gq-menu-sub" style={{ color: MENU.dim }}>3 services</span>
      </div>
      <div className="gq-menu-body">
        {services.map((s) => (
          <div key={s} className="gq-menu-svc">
            <span className="gq-svcdot" style={{ background: c }} />
            <span className="gq-menu-svcname" style={{ color: MENU.copy }}>{s}</span>
            <span className="gq-menu-svcstate" style={{ color: MENU.dim }}>running</span>
          </div>
        ))}
      </div>
      <div className="gq-menu-foot" style={{ borderColor: MENU.line }}>
        <button
          type="button"
          className="gq-menu-btn"
          style={{ color: c, background: soft(c, 0.14), borderColor: soft(c, 0.4) }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}

function IosMock({ c }: { c: string }) {
  return (
    <div className="gq-iosframe">
      {/* deck header — live pulse + needs-you pill (the emerald's roles) */}
      <div className="gq-ios-deckhead">
        <span className="gq-livedot" style={{ background: c, boxShadow: `0 0 0 0 ${c}` }} />
        <span className="gq-ios-decklabel" style={{ color: IOS.muted }}>WORK</span>
        <span
          className="gq-needs"
          style={{ color: c, background: soft(c, 0.12), borderColor: soft(c, 0.4) }}
        >
          2 need you
        </span>
      </div>
      {/* the deck card — sprite + task-as-title + attribution + status word */}
      <div
        className="gq-ioscard"
        style={{
          background: `linear-gradient(180deg, ${IOS.cardTop}, ${IOS.cardBottom})`,
          borderColor: soft(c, 0.5),
          boxShadow: `inset 0 1px 0 ${IOS.edgeTop}, 0 0 0 1px ${soft(c, 0.22)}, 0 3px 9px rgba(0,0,0,0.4)`,
        }}
      >
        <div className="gq-ios-task" style={{ color: IOS.ink }}>
          Wiring the in-app session route so a new conversation lands on the operator DM.
        </div>
        <div className="gq-ios-attr">
          <SpriteAvatar name="broker-smith" size={20} />
          <span className="gq-ios-name" style={{ color: IOS.muted }}>broker-smith</span>
          <span className="gq-ios-proj" style={{ color: IOS.dim }}>openscout · claude</span>
        </div>
        <div className="gq-ios-status">
          <span className="gq-ios-word" style={{ color: c }}>WORKING</span>
          <span style={{ color: IOS.dim }}>·</span>
          <span style={{ color: IOS.muted }}>4s ago</span>
        </div>
      </div>
    </div>
  );
}

type SurfaceId = "hud" | "menu" | "ios";
const MOCKS: Record<SurfaceId, (c: string) => React.ReactNode> = {
  hud: (c) => <HudMock c={c} />,
  menu: (c) => <MenuMock c={c} />,
  ios: (c) => <IosMock c={c} />,
};

/* Compact single-line echo of a surface's signal, for the follow-accent
   graphite sub-strip ("it tracks the accent"). */
function SignalEcho({ surface, c, bg }: { surface: SurfaceId; c: string; bg: string }) {
  if (surface === "hud") {
    return (
      <div className="gq-echo" style={{ background: bg }}>
        <span className="gq-echo-dot" style={{ background: c }} />
        <span className="gq-echo-word" style={{ color: c }}>WORKING</span>
        <span className="gq-echo-pip" style={{ background: c }} />
      </div>
    );
  }
  if (surface === "menu") {
    return (
      <div className="gq-echo" style={{ background: bg }}>
        <span className="gq-echo-dot" style={{ background: c }} />
        <span className="gq-echo-word" style={{ color: MENU.copy }}>Broker</span>
        <span className="gq-echo-btn" style={{ color: c, background: soft(c, 0.14), borderColor: soft(c, 0.4) }}>
          Restart
        </span>
      </div>
    );
  }
  return (
    <div className="gq-echo" style={{ background: bg }}>
      <span className="gq-echo-dot" style={{ background: c }} />
      <span className="gq-echo-word" style={{ color: c }}>WORKING</span>
      <span className="gq-echo-btn" style={{ color: c, background: soft(c, 0.12), borderColor: soft(c, 0.4) }}>
        2 need you
      </span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Matrix definition.
   ════════════════════════════════════════════════════════════════════ */

const SURFACES: {
  id: SurfaceId;
  name: string;
  role: string;
  ships: string; // shipped green hex label
  note?: React.ReactNode;
}[] = [
  {
    id: "hud",
    name: "HUD",
    role: "The lime's role — status text, working dots, attention pips. Type, grain, and the near-black stay the costume.",
    ships: GREEN.lime,
  },
  {
    id: "menu",
    name: "Menu bar helper",
    role: "The menu-green's role — service status dots and the Restart action. The grid-backdrop popover stays.",
    ships: GREEN.menu,
  },
  {
    id: "ios",
    name: "iOS deck card",
    role: "The emerald's role — the live pulse, the needs-you pill, the working word. Web shares this emerald (noted here, not a fourth row).",
    ships: GREEN.emerald,
    note: (
      <>
        Honest footnote: the web accent token is actually{" "}
        <code className="gq-code">oklch(0.72 0.16 125)</code> — a yellower green than{" "}
        <code className="gq-code">#10B981</code>. The family is looser than the three hexes imply.
      </>
    ),
  },
];

type ColId = "current" | "emerald" | "lime" | "accent";
const COLUMNS: {
  id: ColId;
  title: React.ReactNode;
  caption: React.ReactNode;
  /** Resolve the green-under-test for a given surface. */
  green: (s: SurfaceId) => string;
  cost?: React.ReactNode;
}[] = [
  {
    id: "current",
    title: <>Current</>,
    caption: <>Shipped. Each surface in its own green — three values, decided three times.</>,
    green: (s) => (s === "hud" ? GREEN.lime : s === "menu" ? GREEN.menu : GREEN.emerald),
  },
  {
    id: "emerald",
    title: (
      <>
        One green · Emerald <span className="gq-hex">#10B981</span>
      </>
    ),
    caption: (
      <>
        Emerald replaces lime and menu-green; iOS + web unchanged. It already owns 2 of 4 surfaces, so this
        converges on the most-used value — and only edits the two macOS palettes.
      </>
    ),
    green: () => GREEN.emerald,
  },
  {
    id: "lime",
    title: (
      <>
        One green · Lime <span className="gq-hex">#94E36B</span>
      </>
    ),
    caption: (
      <>
        Lime everywhere, the iOS card included. Rendered honestly — it reads loud on the raised card; that&rsquo;s
        data. Also the widest reach: it has to repaint the emerald surfaces too.
      </>
    ),
    green: () => GREEN.lime,
  },
  {
    id: "accent",
    title: <>Follow accent</>,
    caption: (
      <>
        The three surfaces render in the user&rsquo;s macOS accent — juniper <span className="gq-hex">#3e66cc</span>{" "}
        shown, graphite echo below. &ldquo;Alive&rdquo; then tracks whatever accent you pick.
      </>
    ),
    green: () => ACCENT.juniper,
    cost: (
      <>
        Not a palette swap. This is the demoted dynamic-theming feature — new transport + dynamic-accent plumbing,
        <strong> ~99 hardcoded accent call sites on iOS alone</strong>.
      </>
    ),
  },
];

/* ════════════════════════════════════════════════════════════════════
   Cost ledger — one-system ledger idiom.
   ════════════════════════════════════════════════════════════════════ */

type CostTag = "constants" | "constants-plus" | "feature";
const TAG: Record<CostTag, { label: string; bg: string; fg: string }> = {
  constants: { label: "Constants", bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)" },
  "constants-plus": { label: "Constants +", bg: "var(--status-info-bg)", fg: "var(--status-info-fg)" },
  feature: { label: "Feature", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
};

const LEDGER: { treatment: React.ReactNode; tag: CostTag; change: React.ReactNode }[] = [
  {
    treatment: <>One green · Emerald (col 2)</>,
    tag: "constants",
    change: (
      <>
        Two macOS files, bounded. <code className="gq-code">HUDChrome.swift:60/62/63</code> — the lime is one rgb
        triple restated across <code className="gq-code">accent / accentSoft / accentWhisper</code> plus a
        hand-darkened <code className="gq-code">accentDim</code> (L61). <code className="gq-code">ScoutMenu/Views/Theme.swift:79–92,141</code>{" "}
        — <code className="gq-code">ShellPalette.accent</code> is an adaptive light+dark pair, and the green is
        restated again in <code className="gq-code">accentSoft · accentBorder · accentPressed</code> + the{" "}
        <code className="gq-code">success = accent</code> alias (more places than &ldquo;one constant&rdquo;). iOS
        emerald + web are already the target → untouched.
      </>
    ),
  },
  {
    treatment: <>One green · Lime (col 3)</>,
    tag: "constants-plus",
    change: (
      <>
        Same two macOS files, lime instead — but now iOS + web must change too, which is the wider blast radius. The
        iOS emerald is <code className="gq-code">HudPalette.accent</code>, defined <strong>upstream in the HudsonKit
        dependency</strong> (<code className="gq-code">HudPalette.swift:27</code>, not this repo) and referenced{" "}
        <strong>99× across 14 iOS files</strong>; the web value lives in{" "}
        <code className="gq-code">Provider.tsx:158/202</code>. Loudest render, widest reach.
      </>
    ),
  },
  {
    treatment: <>Follow accent (col 4)</>,
    tag: "feature",
    change: (
      <>
        Not constants — the previously-deferred feature. New transport (<code className="gq-code">QRPayload</code>{" "}
        carries no theme; <code className="gq-code">ScoutBrokerClient</code> has no appearance capability — needs
        snapshot + subscribe), a dynamic-accent shim replacing the <strong>99 hardcoded{" "}
        <code className="gq-code">HudPalette.accent</code> sites across 14 files</strong>, and the HUD + menu
        palettes re-plumbed to read the chosen accent rather than a fixed green.
      </>
    ),
  },
];

/* ════════════════════════════════════════════════════════════════════
   Page.
   ════════════════════════════════════════════════════════════════════ */

export default function ScoutGreenQuestionStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <style>{GQ_CSS}</style>

      {/* Header */}
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · cross · scout-green-question
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout — The Green Question
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-studio-ink-muted">
          Scout ships three near-neighbor greens: the HUD lime{" "}
          <span className="gq-swatchinline" style={{ background: GREEN.lime }} /> <code className="gq-code">#94E36B</code>,
          the menu-bar green <span className="gq-swatchinline" style={{ background: GREEN.menu }} />{" "}
          <code className="gq-code">#6DDB8C</code>, and the iOS/web emerald{" "}
          <span className="gq-swatchinline" style={{ background: GREEN.emerald }} />{" "}
          <code className="gq-code">#10B981</code>. One open brand decision: converge on a single green — and which —
          or let these surfaces follow the user&rsquo;s chosen accent instead. This is the side-by-side to settle it:
          three signal surfaces down, four treatments across.
        </p>
      </header>

      {/* The tension — the actual decision */}
      <section className="gq-tension">
        <div className="gq-tension-eyebrow">The tension — the actual decision</div>
        <p className="gq-tension-lede">
          Green does double duty. It is Scout&rsquo;s de-facto <strong>brand</strong> color <em>and</em> the semantic
          signal for <strong>live / working</strong> — but the single-accent law says signal travels through one
          accent. The columns are two answers to one question:
        </p>
        <div className="gq-tension-split">
          <div className="gq-tension-side">
            <div className="gq-tension-tag">Cols 2–3 · green is a brand constant</div>
            <p>
              The &ldquo;alive&rdquo; color stays fixed no matter which accent you pick for the main window. The HUD and
              menu are primarily instrument surfaces — mostly signal — so they stay green.
            </p>
          </div>
          <div className="gq-tension-side">
            <div className="gq-tension-tag">Col 4 · green is the default accent</div>
            <p>
              The surfaces follow your choice — but then &ldquo;working&rdquo; pulses in whatever the accent is (a red
              accent makes the whole fleet pulse red), and the live-signal loses cross-surface stability.
            </p>
          </div>
        </div>
        <p className="gq-tension-foot">
          A stable brand-signal green vs. surfaces that track your accent — that trade is the decision.
        </p>
      </section>

      {/* The matrix */}
      <section className="gq-scroll">
        <div className="gq-matrix">
          {/* header row */}
          <div className="gq-corner">
            <span className="gq-corner-label">Surface ↓ · Treatment →</span>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.id} className={`gq-colhead ${col.id === "accent" ? "cost" : ""}`}>
              <div className="gq-colhead-title">{col.title}</div>
              <div className="gq-colhead-cap">{col.caption}</div>
              {col.cost ? <div className="gq-colhead-cost">{col.cost}</div> : null}
            </div>
          ))}

          {/* surface rows */}
          {SURFACES.map((s) => (
            <div key={s.id} className="gq-rowgroup">
              <div className="gq-gutter">
                <div className="gq-gutter-name">{s.name}</div>
                <div className="gq-gutter-shipswatch">
                  <span className="gq-swatch" style={{ background: s.ships }} />
                  <span className="gq-gutter-hex">ships {s.ships}</span>
                </div>
                <p className="gq-gutter-role">{s.role}</p>
                {s.note ? <p className="gq-gutter-note">{s.note}</p> : null}
              </div>
              {COLUMNS.map((col) => {
                const c = col.green(s.id);
                return (
                  <div key={col.id} className={`gq-cell ${col.id === "accent" ? "accent" : ""}`}>
                    <div className="gq-cell-mock">{MOCKS[s.id](c)}</div>
                    {col.id === "accent" ? (
                      <div className="gq-cell-echo">
                        <span className="gq-echo-label">tracks · graphite #6d7ae8</span>
                        <SignalEcho surface={s.id} c={ACCENT.graphite} bg="transparent" />
                      </div>
                    ) : null}
                    <div className="gq-cell-foot">
                      <span className="gq-swatch sm" style={{ background: c }} />
                      <span className="gq-cell-hex">{c.toUpperCase()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Cost ledger */}
      <section className="mt-12">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">Cost ledger</div>
        <h2 className="mb-1 mt-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">
          What each answer actually costs
        </h2>
        <p className="mb-4 max-w-[76ch] text-[13px] leading-relaxed text-studio-ink-muted">
          Two of the three answers are a handful of colour constants; the third is a feature. Priced against the real
          files.
        </p>
        <div className="overflow-hidden rounded-[8px] border border-studio-edge">
          <div className="gq-ledger-head">
            <span>Treatment</span>
            <span>Cost</span>
            <span>What changes — real files</span>
          </div>
          {LEDGER.map((r, i) => {
            const t = TAG[r.tag];
            return (
              <div key={i} className={`gq-ledger-row ${i > 0 ? "brd" : ""}`}>
                <span className="text-[12px] font-semibold leading-snug text-studio-ink">{r.treatment}</span>
                <span>
                  <span
                    className="inline-block rounded-[3px] px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    {t.label}
                  </span>
                </span>
                <span className="text-[11px] leading-snug text-studio-ink-muted">{r.change}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Verdict — intentionally empty; the owner decides. */}
      <section className="gq-verdict">
        <div className="gq-verdict-label">Verdict — owner&rsquo;s call</div>
        <div className="gq-verdict-slot" />
      </section>
    </main>
  );
}

/* ── Scoped CSS (raw <style>, scout-ios idiom). ────────────────────────── */
const GQ_CSS = `
.gq-code { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10.5px;
  color:var(--studio-ink); background:color-mix(in oklab, var(--studio-ink) 8%, transparent);
  padding:0 4px; border-radius:3px; }
.gq-hex { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10px; font-weight:600;
  color:var(--studio-ink-muted); letter-spacing:0; }
.gq-swatchinline { display:inline-block; width:9px; height:9px; border-radius:2px; vertical-align:-1px;
  box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--studio-ink) 20%, transparent); }
.gq-swatch { display:inline-block; width:11px; height:11px; border-radius:3px; flex:none;
  box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--studio-ink) 18%, transparent); }
.gq-swatch.sm { width:9px; height:9px; border-radius:2px; }

/* ── The tension callout ─────────────────────────────────────────────── */
.gq-tension { margin-bottom:34px; padding:16px 18px; border-radius:11px;
  border:1px solid var(--studio-edge); background:var(--studio-canvas-alt); max-width:96ch; }
.gq-tension-eyebrow { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.14em; color:var(--studio-ink-faint); margin-bottom:8px; }
.gq-tension-lede { font-size:13px; line-height:1.6; color:var(--studio-ink-muted); max-width:88ch; }
.gq-tension-lede strong, .gq-tension-side strong { color:var(--studio-ink); font-weight:650; }
.gq-tension-split { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px; }
.gq-tension-side { padding:11px 13px; border-radius:9px; border:1px solid var(--studio-edge);
  background:var(--studio-surface); }
.gq-tension-tag { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9.5px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.08em; color:var(--scout-accent); margin-bottom:6px; }
.gq-tension-side p { font-size:12px; line-height:1.5; color:var(--studio-ink-muted); }
.gq-tension-foot { margin-top:12px; font-size:12.5px; font-weight:600; color:var(--studio-ink); }

/* ── Matrix layout ───────────────────────────────────────────────────── */
.gq-scroll { overflow-x:auto; padding-bottom:6px; margin:0 -4px; }
.gq-matrix { display:grid; grid-template-columns:184px repeat(4, 256px); gap:10px;
  min-width:min-content; padding:0 4px; align-items:start; }
.gq-rowgroup { display:contents; }

.gq-corner { display:flex; align-items:flex-end; padding:6px 4px 8px; }
.gq-corner-label { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:8.5px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.08em; color:var(--studio-ink-faint); line-height:1.4; }

.gq-colhead { padding:9px 11px; border-radius:9px; border:1px solid var(--studio-edge);
  background:var(--studio-surface); align-self:stretch; }
.gq-colhead.cost { border-color:color-mix(in oklab, var(--studio-ink) 22%, transparent); }
.gq-colhead-title { font-size:12.5px; font-weight:700; color:var(--studio-ink); line-height:1.3;
  display:flex; flex-wrap:wrap; align-items:baseline; gap:5px; }
.gq-colhead-cap { margin-top:5px; font-size:10.5px; line-height:1.45; color:var(--studio-ink-muted); }
.gq-colhead-cost { margin-top:7px; padding-top:7px; border-top:1px solid var(--studio-edge);
  font-size:10px; line-height:1.45; color:var(--studio-ink-faint); }
.gq-colhead-cost strong { color:var(--studio-ink-muted); font-weight:650; }

.gq-gutter { padding:8px 8px 8px 4px; }
.gq-gutter-name { font-size:13px; font-weight:650; color:var(--studio-ink); }
.gq-gutter-shipswatch { display:flex; align-items:center; gap:6px; margin-top:5px; }
.gq-gutter-hex { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9.5px; font-weight:600;
  color:var(--studio-ink-faint); text-transform:uppercase; letter-spacing:0.04em; }
.gq-gutter-role { margin-top:8px; font-size:11px; line-height:1.5; color:var(--studio-ink-muted); }
.gq-gutter-note { margin-top:8px; font-size:10px; line-height:1.5; color:var(--studio-ink-faint);
  padding-top:8px; border-top:1px solid var(--studio-edge); }

.gq-cell { display:flex; flex-direction:column; gap:8px; }
.gq-cell-mock { }
.gq-cell-foot { display:flex; align-items:center; gap:6px; padding-left:2px; }
.gq-cell-hex { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9.5px; font-weight:600;
  color:var(--studio-ink-faint); letter-spacing:0.04em; }
.gq-cell-echo { display:flex; flex-direction:column; gap:4px; padding:8px 9px; border-radius:8px;
  border:1px dashed color-mix(in oklab, var(--studio-ink) 16%, transparent);
  background:color-mix(in oklab, var(--studio-ink) 3%, transparent); }
.gq-echo-label { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:8px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.08em; color:var(--studio-ink-faint); }
.gq-echo { display:flex; align-items:center; gap:7px; padding:5px 8px; border-radius:7px; }
.gq-echo-dot { width:6px; height:6px; border-radius:50%; flex:none; }
.gq-echo-word { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9.5px; font-weight:700;
  letter-spacing:0.05em; }
.gq-echo-pip { width:6px; height:6px; border-radius:50%; margin-left:auto; }
.gq-echo-btn { margin-left:auto; font-size:9.5px; font-weight:600; padding:2px 8px; border-radius:999px;
  border:1px solid transparent; white-space:nowrap; }

/* ── HUD broadsheet mock ─────────────────────────────────────────────── */
.gq-hud { position:relative; overflow:hidden; border-radius:9px; padding:12px 13px 13px;
  background:${HUD.canvas}; border:1px solid ${HUD.border};
  box-shadow:0 0 0 1px rgba(0,0,0,0.4), 0 10px 26px -14px rgba(0,0,0,0.7);
  font-family:"Inter Tight", ui-sans-serif, system-ui, sans-serif; }
.gq-hud-grain { position:absolute; inset:0; pointer-events:none; opacity:0.5;
  background-image:radial-gradient(rgba(255,255,255,0.02) 0.5px, transparent 0.6px); background-size:3px 3px; }
.gq-hud-eyebrow { position:relative; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:8.5px;
  font-weight:700; text-transform:uppercase; letter-spacing:0.16em; }
.gq-hud-rule { position:relative; height:1px; margin:9px 0 9px; }
.gq-hud-row { position:relative; display:flex; align-items:center; gap:8px; }
.gq-workdot { width:7px; height:7px; border-radius:50%; flex:none;
  animation:gqPulse 1.6s ease-in-out infinite; }
.gq-hud-name { font-size:14px; font-weight:600; letter-spacing:-0.01em; }
.gq-hud-status { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; font-weight:700;
  letter-spacing:0.09em; }
.gq-hud-spacer { flex:1; }
.gq-pip { width:7px; height:7px; border-radius:50%; flex:none;
  box-shadow:0 0 6px currentColor; }
.gq-hud-meta { position:relative; margin-top:8px; font-family:"JetBrains Mono", ui-monospace, monospace;
  font-size:9.5px; letter-spacing:0.01em; }

/* ── Menu-bar helper mock ────────────────────────────────────────────── */
.gq-menu { position:relative; overflow:hidden; border-radius:10px; border:1px solid;
  background:${MENU.bg}; box-shadow:0 12px 30px -14px rgba(0,0,0,0.8);
  font-family:"Inter Tight", ui-sans-serif, system-ui, sans-serif; }
.gq-menu-grid { position:absolute; inset:0; pointer-events:none; opacity:0.5;
  background-image:linear-gradient(${MENU.line} 1px, transparent 1px),
    linear-gradient(90deg, ${MENU.line} 1px, transparent 1px);
  background-size:26px 26px; mask-image:linear-gradient(180deg, rgba(0,0,0,0.25), transparent 70%); }
.gq-menu-head { position:relative; display:flex; align-items:baseline; justify-content:space-between;
  padding:10px 13px 8px; }
.gq-menu-mast { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:13px; font-weight:700;
  letter-spacing:-0.01em; }
.gq-menu-sub { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; }
.gq-menu-body { position:relative; padding:2px 8px 6px; display:flex; flex-direction:column; gap:1px; }
.gq-menu-svc { display:flex; align-items:center; gap:9px; padding:6px 5px; border-radius:6px; }
.gq-svcdot { width:7px; height:7px; border-radius:50%; flex:none; }
.gq-menu-svcname { font-size:12.5px; font-weight:500; flex:1; }
.gq-menu-svcstate { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10px; }
.gq-menu-foot { position:relative; padding:9px 13px 11px; border-top:1px solid; margin-top:2px; }
.gq-menu-btn { font-size:11.5px; font-weight:600; padding:5px 13px; border-radius:8px; border:1px solid;
  cursor:default; }

/* ── iOS deck-card mock ──────────────────────────────────────────────── */
.gq-iosframe { border-radius:12px; padding:11px; background:#0a0a0a; border:1px solid #202024;
  font-family:"Inter Tight", ui-sans-serif, system-ui, sans-serif; }
.gq-ios-deckhead { display:flex; align-items:center; gap:7px; padding:1px 3px 9px; }
.gq-livedot { width:6px; height:6px; border-radius:50%; flex:none; animation:gqPulseRing 1.6s ease-out infinite; }
.gq-ios-decklabel { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; font-weight:700;
  letter-spacing:0.13em; }
.gq-needs { margin-left:auto; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; font-weight:700;
  letter-spacing:0.04em; text-transform:uppercase; padding:2px 8px; border-radius:999px; border:1px solid; }
.gq-ioscard { border-radius:14px; padding:11px 12px; border:1px solid; }
.gq-ios-task { font-size:13px; font-weight:600; line-height:1.35; }
.gq-ios-attr { display:flex; align-items:center; gap:7px; margin-top:9px; }
.gq-ios-name { font-size:11.5px; font-weight:500; }
.gq-ios-proj { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10px; }
.gq-ios-status { display:flex; align-items:center; gap:6px; margin-top:9px; }
.gq-ios-word { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9.5px; font-weight:700;
  letter-spacing:0.05em; }

@keyframes gqPulse { 0%,100%{ box-shadow:0 0 0 0 transparent; } 50%{ opacity:0.72; } }
@keyframes gqPulseRing { 0%{ box-shadow:0 0 0 0 color-mix(in oklab, currentColor 0%, transparent); }
  70%{ box-shadow:0 0 0 5px transparent; } 100%{ box-shadow:0 0 0 0 transparent; } }

/* ── Ledger ──────────────────────────────────────────────────────────── */
.gq-ledger-head { display:grid; grid-template-columns:1.3fr 84px 3fr; gap:16px;
  padding:8px 16px; border-bottom:1px solid var(--studio-edge); background:var(--studio-canvas-alt);
  font-family:"JetBrains Mono", ui-monospace, monospace; font-size:8.5px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.1em; color:var(--studio-ink-faint); }
.gq-ledger-row { display:grid; grid-template-columns:1.3fr 84px 3fr; gap:16px; padding:12px 16px;
  align-items:start; }
.gq-ledger-row.brd { border-top:1px solid var(--studio-edge); }

/* ── Verdict ─────────────────────────────────────────────────────────── */
.gq-verdict { margin-top:26px; padding:14px 16px; border-radius:10px;
  border:1px dashed color-mix(in oklab, var(--studio-ink) 22%, transparent);
  background:color-mix(in oklab, var(--studio-ink) 2%, transparent); }
.gq-verdict-label { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:9px; font-weight:700;
  text-transform:uppercase; letter-spacing:0.14em; color:var(--studio-ink-faint); }
.gq-verdict-slot { height:34px; margin-top:8px; border-radius:7px;
  border:1px solid var(--studio-edge); background:var(--studio-surface); }
`;
