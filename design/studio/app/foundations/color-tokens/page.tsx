/**
 * Color tokens — foundation.
 *
 * Every studio CSS var, rendered side-by-side in both themes so the
 * viewer can compare dark vs light without flipping the global toggle.
 * Trick: each swatch is wrapped in a forced `data-theme` div so vars
 * resolve against that theme's bundle regardless of <html>.
 *
 * Values sourced verbatim from `app/globals.css`; the rightmost
 * columns double as live documentation.
 */

type Solo = { name: string; dark: string; light: string; ink?: boolean };
type Pair = { label: string; fg: Solo; bg: Solo };

const CHROME: Solo[] = [
  { name: "--studio-canvas",      dark: "oklch(0.14 0.008 80)",        light: "oklch(0.978 0.004 85)" },
  { name: "--studio-canvas-alt",  dark: "oklch(0.18 0.009 80)",        light: "oklch(0.94 0.005 85)" },
  { name: "--studio-surface",     dark: "oklch(0.20 0.010 80)",        light: "oklch(0.992 0.003 85)" },
  { name: "--studio-ink",         dark: "oklch(0.96 0.008 80)",        light: "oklch(0.24 0.01 80)",   ink: true },
  { name: "--studio-ink-muted",   dark: "oklch(0.72 0.012 80)",        light: "oklch(0.50 0.014 80)",  ink: true },
  { name: "--studio-ink-faint",   dark: "oklch(0.58 0.012 80)",        light: "oklch(0.66 0.012 80)",  ink: true },
  { name: "--studio-edge",        dark: "oklch(0.96 0.008 80 / 0.10)", light: "oklch(0.84 0.008 82)" },
  { name: "--studio-edge-strong", dark: "oklch(0.96 0.008 80 / 0.18)", light: "oklch(0.72 0.010 82)" },
];

const ACCENT: Solo[] = [
  { name: "--scout-accent",      dark: "oklch(0.86 0.17 125)",         light: "oklch(0.62 0.16 125)" },
  { name: "--scout-accent-soft", dark: "oklch(0.86 0.17 125 / 0.18)",  light: "oklch(0.72 0.16 125 / 0.18)" },
];

const STATUS: Pair[] = (
  [
    ["ok",      "0.84 0.16 155",      "0.40 0.14 155",      "0.64 0.16 155 / 0.18", "0.88 0.08 155 / 0.55"],
    ["warn",    "0.85 0.15 85",       "0.48 0.14 75",       "0.72 0.15 85 / 0.16",  "0.90 0.10 85 / 0.55"],
    ["error",   "0.78 0.17 25",       "0.46 0.18 25",       "0.72 0.18 25 / 0.16",  "0.88 0.08 25 / 0.55"],
    ["info",    "0.80 0.10 220",      "0.42 0.10 220",      "0.70 0.12 220 / 0.18", "0.88 0.06 220 / 0.55"],
    ["neutral", "0.78 0.010 80",      "0.38 0.010 80",      "0.96 0.008 80 / 0.06", "0.92 0.006 80"],
  ] as const
).map(([label, fgD, fgL, bgD, bgL]) => ({
  label,
  fg: { name: `--status-${label}-fg`, dark: `oklch(${fgD})`, light: `oklch(${fgL})` },
  bg: { name: `--status-${label}-bg`, dark: `oklch(${bgD})`, light: `oklch(${bgL})` },
}));

const CODE: Solo[] = [
  { name: "--code-bg",     dark: "oklch(0.20 0.010 80)",        light: "oklch(0.94 0.005 85)" },
  { name: "--code-border", dark: "oklch(0.96 0.008 80 / 0.08)", light: "oklch(0.84 0.008 82)" },
];

const SOLO_COLS = "grid grid-cols-[200px_1fr_1fr_minmax(220px,1fr)_minmax(220px,1fr)] items-center gap-4";
const PAIR_COLS = "grid grid-cols-[120px_1fr_1fr_minmax(220px,1fr)_minmax(220px,1fr)] items-center gap-4";

export default function ColorTokensPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · foundations · color tokens
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Color tokens
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Every studio CSS var, side-by-side in both themes. Each swatch sits inside a forced{" "}
          <code className="font-mono text-[11px] text-studio-ink">data-theme</code> wrapper so
          comparison holds regardless of the global toggle. Values sourced verbatim from{" "}
          <code className="font-mono text-[11px] text-studio-ink">app/globals.css</code>.
        </p>
      </header>

      <Section title="Studio chrome" hint="Canvas, surface, ink, edge — the structural palette">
        <SoloHeader />
        <Rows>{CHROME.map((t) => <SoloRow key={t.name} t={t} />)}</Rows>
      </Section>

      <Section title="Scout accent" hint="Brand accent + soft fill for selection / hover">
        <SoloHeader />
        <Rows>{ACCENT.map((t) => <SoloRow key={t.name} t={t} />)}</Rows>
      </Section>

      <Section title="Status palette" hint="Five tones × fg/bg — shown fg-on-bg in both themes">
        <PairHeader />
        <Rows>{STATUS.map((p) => <PairRow key={p.label} p={p} />)}</Rows>
      </Section>

      <Section title="Code surface" hint="Background and border for inline + block code">
        <SoloHeader />
        <Rows>{CODE.map((t) => <SoloRow key={t.name} t={t} />)}</Rows>
      </Section>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">· {title}</div>
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge">{children}</div>
  );
}

function SoloHeader() {
  return (
    <div className={`${SOLO_COLS} mb-2 border-b border-studio-edge pb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint`}>
      <div>Token</div><div>Dark</div><div>Light</div><div>oklch · dark</div><div>oklch · light</div>
    </div>
  );
}

function PairHeader() {
  return (
    <div className={`${PAIR_COLS} mb-2 border-b border-studio-edge pb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint`}>
      <div>Tone</div><div>Dark · fg on bg</div><div>Light · fg on bg</div><div>oklch · fg</div><div>oklch · bg</div>
    </div>
  );
}

function SoloRow({ t }: { t: Solo }) {
  return (
    <div className={`${SOLO_COLS} py-3`}>
      <code className="font-mono text-[11px] text-studio-ink">{t.name}</code>
      <Swatch theme="dark" varName={t.name} ink={t.ink} />
      <Swatch theme="light" varName={t.name} ink={t.ink} />
      <code className="font-mono text-[10.5px] text-studio-ink-faint">{t.dark}</code>
      <code className="font-mono text-[10.5px] text-studio-ink-faint">{t.light}</code>
    </div>
  );
}

function PairRow({ p }: { p: Pair }) {
  return (
    <div className={`${PAIR_COLS} py-3`}>
      <div>
        <div className="font-sans text-[13px] font-medium text-studio-ink">{p.label}</div>
        <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">fg + bg</div>
      </div>
      <PairSwatch theme="dark" fg={p.fg.name} bg={p.bg.name} label={p.label} />
      <PairSwatch theme="light" fg={p.fg.name} bg={p.bg.name} label={p.label} />
      <OklchCell name={p.fg.name} dark={p.fg.dark} light={p.fg.light} />
      <OklchCell name={p.bg.name} dark={p.bg.dark} light={p.bg.light} />
    </div>
  );
}

function OklchCell({ name, dark, light }: { name: string; dark: string; light: string }) {
  return (
    <div className="flex flex-col gap-0.5 font-mono text-[10px] text-studio-ink-faint">
      <code>{name}</code>
      <code className="opacity-80">d: {dark}</code>
      <code className="opacity-80">l: {light}</code>
    </div>
  );
}

/** Force-render a swatch with one theme's tokens regardless of the
 *  global `<html data-theme>` value. */
function Swatch({ theme, varName, ink }: { theme: "dark" | "light"; varName: string; ink?: boolean }) {
  return (
    <div data-theme={theme} className="rounded-[4px] border border-studio-edge bg-studio-canvas p-2">
      <div
        className="flex h-10 w-full items-center justify-center rounded-[3px] border border-studio-edge"
        style={{ background: `var(${varName})` }}
      >
        {ink ? (
          <span className="font-mono text-[10px] tracking-eyebrow" style={{ color: "var(--studio-canvas)" }}>
            INK
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PairSwatch({ theme, fg, bg, label }: { theme: "dark" | "light"; fg: string; bg: string; label: string }) {
  return (
    <div data-theme={theme} className="rounded-[4px] border border-studio-edge bg-studio-canvas p-2">
      <div className="flex h-10 w-full items-center justify-center rounded-[3px]" style={{ background: `var(${bg})` }}>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-status" style={{ color: `var(${fg})` }}>
          {label}
        </span>
      </div>
    </div>
  );
}
