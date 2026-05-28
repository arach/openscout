/**
 * Spacing & density — foundation.
 *
 * Two parts:
 *  1. Spacing scale — visual bars at every step the studio uses
 *     (4 / 8 / 12 / 14 / 16 / 20 / 24 / 28 / 32 px) with tailwind
 *     shorthand + usage notes.
 *  2. Density study — one agent-row pattern rendered comfortable /
 *     compact / manifest with px callouts for py and gap. Patterns
 *     lifted from `app/studies/agent-pulse/page.tsx`.
 */

type Step = { px: number; tw: string; usage: string };
type Agent = { name: string; state: keyof typeof STATE_COLOR; task: string; updatedAgo: string; hue: number };

const SCALE: Step[] = [
  { px: 4,  tw: "1",   usage: "tight icon gap · dot offset" },
  { px: 8,  tw: "2",   usage: "compact row gap" },
  { px: 10, tw: "2.5", usage: "comfortable row gap" },
  { px: 12, tw: "3",   usage: "default chrome gap" },
  { px: 14, tw: "3.5", usage: "row padding-x" },
  { px: 16, tw: "4",   usage: "manifest gap · section gap" },
  { px: 20, tw: "5",   usage: "card padding" },
  { px: 24, tw: "6",   usage: "page rhythm step" },
  { px: 28, tw: "7",   usage: "page padding-x (px-7)" },
  { px: 32, tw: "8",   usage: "page padding-y (py-8)" },
];

const STATE_COLOR = {
  working: "var(--status-warn-fg)",
  available: "var(--status-ok-fg)",
  "needs attention": "var(--status-error-fg)",
} as const;

const AGENTS: Agent[] = [
  { name: "Scout",  state: "working",         task: "indexing channel.shared",  updatedAgo: "2s",  hue: 125 },
  { name: "Hudson", state: "working",         task: "reviewing PR #214",        updatedAgo: "11s", hue: 210 },
  { name: "QB",     state: "needs attention", task: "awaiting decision · 0c8f", updatedAgo: "1m",  hue: 25 },
  { name: "Cody",   state: "available",       task: "idle, ready to dispatch",  updatedAgo: "4m",  hue: 85 },
];

export default function SpacingDensityPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · foundations · spacing & density
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Spacing & density
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Spacing scale + the three density variants used across studio rows. The agent-row
          pattern below is lifted from{" "}
          <code className="font-mono text-[11px] text-studio-ink">app/studies/agent-pulse</code>{" "}
          and annotated with px callouts so the deltas between densities are explicit.
        </p>
      </header>

      <Section title="Spacing scale" hint="Every step the studio actually uses">
        <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
          <div className="mb-3 grid grid-cols-[60px_64px_1fr_minmax(220px,1fr)] gap-4 border-b border-studio-edge pb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <div>px</div><div>tw</div><div>bar</div><div>usage</div>
          </div>
          <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge">
            {SCALE.map((s) => (
              <div key={s.px} className="grid grid-cols-[60px_64px_1fr_minmax(220px,1fr)] items-center gap-4 py-2.5">
                <code className="font-mono text-[11px] tabular-nums text-studio-ink">{s.px}px</code>
                <code className="font-mono text-[11px] text-studio-ink-muted">p-{s.tw} · gap-{s.tw}</code>
                <div className="flex items-center gap-3">
                  <div className="h-3 rounded-[2px] bg-studio-canvas-alt ring-1 ring-studio-edge" style={{ width: `${s.px}px` }} />
                  <span className="font-mono text-[9.5px] text-studio-ink-faint">{s.px}px</span>
                </div>
                <div className="font-sans text-[12px] text-studio-ink-faint">{s.usage}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Density variants" hint="One row pattern, three densities, side-by-side callouts">
        <div className="grid gap-5 lg:grid-cols-3">
          <DensityColumn label="Comfortable" sub="py-1.5 · gap-2.5" hint="Roster sidebar default"
            callouts={[["py", "6px"], ["gap", "10px"], ["avatar", "24px"]]}>
            <div className="rounded-md border border-studio-edge bg-studio-surface p-2">
              {AGENTS.map((a) => <ComfortableRow key={a.name} a={a} />)}
            </div>
          </DensityColumn>

          <DensityColumn label="Compact" sub="py-1 · gap-2" hint="~25 rows above the fold"
            callouts={[["py", "4px"], ["gap", "8px"], ["avatar", "20px"]]}>
            <div className="rounded-md border border-studio-edge bg-studio-surface p-1">
              {AGENTS.map((a) => <CompactRow key={a.name} a={a} />)}
            </div>
          </DensityColumn>

          <DensityColumn label="Manifest" sub="py-1.5 · gap-4 · inline" hint="Ops / tail firehose"
            callouts={[["py", "6px"], ["gap", "16px"], ["layout", "single-line"]]}>
            <div className="rounded-md border border-studio-edge bg-studio-surface">
              {AGENTS.map((a) => <ManifestRow key={a.name} a={a} />)}
            </div>
          </DensityColumn>
        </div>
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

function DensityColumn({
  label, sub, callouts, hint, children,
}: {
  label: string; sub: string; callouts: Array<[string, string]>; hint: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-sans text-[13px] font-medium text-studio-ink">{label}</div>
          <code className="font-mono text-[10px] text-studio-ink-faint">{sub}</code>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">{hint}</div>
      </div>
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-studio-edge pt-1.5 font-mono text-[9.5px]">
        {callouts.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">{k}:</dt>
            <dd className="tabular-nums text-studio-ink-muted">{v}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

function Avatar({ name, hue, size }: { name: string; hue: number; size: "sm" | "md" }) {
  const cls = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[10.5px]";
  return (
    <div className={`shrink-0 rounded-full font-mono ${cls} flex items-center justify-center`}
      style={{ background: `oklch(0.72 0.14 ${hue})`, color: "var(--studio-canvas)" }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

function ComfortableRow({ a }: { a: Agent }) {
  const color = STATE_COLOR[a.state];
  return (
    <div className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 transition-colors hover:bg-studio-canvas-alt">
      <Avatar name={a.name} hue={a.hue} size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-[12.5px] text-studio-ink">{a.name}</span>
        <span className="truncate font-mono text-[10px]" style={{ color }}>
          {a.state} <span className="text-studio-ink-faint">· {a.task}</span>
        </span>
      </div>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">{a.updatedAgo}</span>
    </div>
  );
}

function CompactRow({ a }: { a: Agent }) {
  const color = STATE_COLOR[a.state];
  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-studio-canvas-alt">
      <Avatar name={a.name} hue={a.hue} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-[12px] text-studio-ink">{a.name}</span>
        <span className="truncate font-mono text-[9.5px]" style={{ color }}>{a.state}</span>
      </div>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">{a.updatedAgo}</span>
    </div>
  );
}

function ManifestRow({ a }: { a: Agent }) {
  const color = STATE_COLOR[a.state];
  return (
    <div className="flex items-baseline gap-4 border-b border-studio-edge px-3 py-1.5 last:border-b-0 transition-colors hover:bg-studio-canvas-alt">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="w-[64px] shrink-0 truncate font-sans text-[12.5px] font-medium text-studio-ink">{a.name}</span>
      <span className="w-[88px] shrink-0 truncate font-mono text-[9.5px] uppercase tracking-eyebrow" style={{ color }}>{a.state}</span>
      <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-studio-ink-faint">{a.task}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-studio-ink-faint">{a.updatedAgo}</span>
    </div>
  );
}
