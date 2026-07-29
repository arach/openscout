/**
 * Typography — foundation.
 *
 * One shared ladder (`--text-*` in theme-aliases.css / tokens.css). Tailwind
 * `text-*` utilities and CSS modules both resolve through it. Whole pixels
 * only; fractional sizes are retired.
 */

import { StudyHeader } from "@/components/StudyHeader";

type Row = { sample: React.ReactNode; spec: Array<[string, string]> };

/** Full scale table — source of truth for the page. */
const LADDER: Array<{ rung: string; px: string; role: string }> = [
  { rung: "3xs", px: "8px", role: "dense instrument chrome" },
  { rung: "2xs", px: "9px", role: "eyebrows · captions" },
  { rung: "xs", px: "10px", role: "mono meta · chips" },
  { rung: "sm", px: "11px", role: "secondary UI" },
  { rung: "md", px: "12px", role: "body default" },
  { rung: "lg", px: "13px", role: "comfortable body · lede · prose" },
  { rung: "xl", px: "14px", role: "emphasis body" },
  { rung: "2xl", px: "15px", role: "subheads" },
  { rung: "3xl", px: "17px", role: "section titles" },
  { rung: "4xl", px: "19px", role: "study titles" },
  { rung: "5xl", px: "22px", role: "page titles" },
  { rung: "6xl", px: "26px", role: "landing mastheads · prose h1" },
];

const DISPLAY: Row[] = [
  {
    sample: (
      <span className="font-display text-6xl font-medium leading-[1.15] tracking-[-0.012em] text-studio-ink">
        H1 — text-6xl
      </span>
    ),
    spec: [
      ["token", "--text-6xl"],
      ["size", "26px"],
      ["weight", "500"],
      ["usage", "landing mastheads · prose h1"],
    ],
  },
  {
    sample: (
      <span className="font-display text-4xl font-medium leading-[1.25] tracking-[-0.012em] text-studio-ink">
        H2 — text-4xl
      </span>
    ),
    spec: [
      ["token", "--text-4xl"],
      ["size", "19px"],
      ["weight", "500"],
      ["usage", "study titles · prose h2"],
    ],
  },
  {
    sample: (
      <span className="font-display text-2xl font-semibold tracking-[-0.012em] text-studio-ink">
        H3 — text-2xl
      </span>
    ),
    spec: [
      ["token", "--text-2xl"],
      ["size", "15px"],
      ["weight", "600"],
      ["usage", "prose h3 · sub-section"],
    ],
  },
  {
    sample: (
      <span className="font-mono text-lg font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        H4 — text-lg mono caps
      </span>
    ),
    spec: [
      ["token", "--text-lg"],
      ["size", "13px"],
      ["weight", "600"],
      ["letter-spacing", "0.22em"],
      ["usage", "prose h4 · section kickers"],
    ],
  },
];

const SANS: Row[] = [
  {
    sample: (
      <span className="font-sans text-lg font-medium text-studio-ink">
        Body — text-lg (13)
      </span>
    ),
    spec: [
      ["token", "--text-lg"],
      ["size", "13px"],
      ["usage", "lede · primary chrome label · prose body"],
    ],
  },
  {
    sample: (
      <span className="font-sans text-md text-studio-ink-muted">
        Caption — text-md (12)
      </span>
    ),
    spec: [
      ["token", "--text-md"],
      ["size", "12px"],
      ["color", "ink-muted"],
      ["usage", "task line · row metadata"],
    ],
  },
  {
    sample: (
      <span className="font-sans text-sm text-studio-ink-faint">
        Small — text-sm (11)
      </span>
    ),
    spec: [
      ["token", "--text-sm"],
      ["size", "11px"],
      ["color", "ink-faint"],
      ["usage", "hint text · supporting UI"],
    ],
  },
];

const MONO: Row[] = [
  {
    sample: (
      <span className="font-mono text-md leading-[1.55] text-studio-ink">
        const value = &quot;code text-md&quot;;
      </span>
    ),
    spec: [
      ["token", "--text-md"],
      ["size", "12px"],
      ["line-height", "1.55"],
      ["usage", "prose pre · CodeMirror"],
    ],
  },
  {
    sample: (
      <span className="font-mono text-xs tabular-nums text-studio-ink-faint">
        chrome text-xs · 2s ago · 14:32:01
      </span>
    ),
    spec: [
      ["token", "--text-xs"],
      ["size", "10px"],
      ["usage", "timestamps · chips · meta"],
    ],
  },
  {
    sample: (
      <span className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · eyebrow text-2xs
      </span>
    ),
    spec: [
      ["token", "--text-2xs"],
      ["size", "9px"],
      ["weight", "600"],
      ["letter-spacing", "0.22em"],
      ["usage", "page eyebrow · sidebar buckets"],
    ],
  },
  {
    sample: (
      <span className="font-mono text-3xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · dense text-3xs
      </span>
    ),
    spec: [
      ["token", "--text-3xs"],
      ["size", "8px"],
      ["usage", "instrument chrome · micro labels"],
    ],
  },
];

export default function TypographyPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="foundations · typography" title="Typography">
        One ladder, whole pixels only. Display and body are Inter Tight; chrome
        is JetBrains Mono. Sizes are named rungs (
        <code className="font-mono text-sm text-studio-ink">text-sm</code>,{" "}
        <code className="font-mono text-sm text-studio-ink">var(--text-sm)</code>
        ) — never ad-hoc{" "}
        <code className="font-mono text-sm text-studio-ink">text-[11px]</code>.
        Shared with Scout web via{" "}
        <code className="font-mono text-sm text-studio-ink">docs/design/tokens.md</code>.
      </StudyHeader>

      <Section title="Scale" hint="--text-* · whole px · ties snap down">
        <div className="overflow-hidden rounded-md border border-studio-edge">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-studio-edge font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
                <th className="px-4 py-2 font-semibold">Rung</th>
                <th className="px-4 py-2 font-semibold">px</th>
                <th className="px-4 py-2 font-semibold">Sample</th>
                <th className="px-4 py-2 font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              {LADDER.map((row) => (
                <tr
                  key={row.rung}
                  className="border-t border-studio-edge/70"
                >
                  <td className="px-4 py-2 font-mono text-xs text-studio-ink">
                    {row.rung}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs tabular-nums text-studio-ink-muted">
                    {row.px}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`font-sans text-${row.rung} text-studio-ink`}
                      style={{ fontSize: `var(--text-${row.rung})` }}
                    >
                      Ag
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-studio-ink-faint">
                    {row.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Display ramp" hint="Inter Tight — page titles and prose headings">
        <RampTable rows={DISPLAY} />
      </Section>
      <Section title="Sans ramp" hint="Inter Tight — body copy and chrome labels">
        <RampTable rows={SANS} />
      </Section>
      <Section title="Mono ramp" hint="JetBrains Mono — code, timestamps, eyebrows">
        <RampTable rows={MONO} />
      </Section>
      <Section
        title="Prose stress-test"
        hint=".studio-prose in both themes — every element in one pass"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ProseSample theme="dark" />
          <ProseSample theme="light" />
        </div>
      </Section>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · {title}
        </div>
        <div className="font-mono text-xs text-studio-ink-faint">{hint}</div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
    </section>
  );
}

function RampTable({ rows }: { rows: Row[] }) {
  return (
    <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge rounded-md border border-studio-edge">
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-center gap-6 px-4 py-4"
        >
          <div className="min-w-0">{row.sample}</div>
          <dl className="flex flex-col gap-0.5 font-mono text-xs">
            {row.spec.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
                  {k}
                </dt>
                <dd className="text-studio-ink-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function ProseSample({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      className="rounded-md border border-studio-edge bg-studio-canvas p-5"
    >
      <div className="mb-3 font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · theme: {theme}
      </div>
      <article className="studio-prose">
        <h1>Plan: agent pulse cleanup</h1>
        <p>
          The roster sidebar needs one primitive that says{" "}
          <strong>this agent is doing X</strong>. Today we have three
          near-duplicates; <em>shipping the consolidated row</em> means we can
          retire the legacy <a href="#">HomeAgentsInspector</a> path.
        </p>
        <h2>Approach</h2>
        <p>
          Lift the visual from <code>AgentRow</code> in{" "}
          <code>HomeAgentsInspector.tsx</code>, rebuild against studio tokens,
          offer three densities. Inline is single-line; comfortable is the
          default; compact targets ops surfaces.
        </p>
        <h3>State vocabulary</h3>
        <ul>
          <li>working — pulsing accent, task line live</li>
          <li>available — solid accent, ready to dispatch</li>
          <li>needs attention — error tone, awaiting decision</li>
          <li>idle / offline — muted, last-seen visible</li>
        </ul>
        <h3>Ordering</h3>
        <ol>
          <li>Replace AgentRow in inspector</li>
          <li>Wire telemetry to broker presence</li>
          <li>Retire HomeAgentsInspector</li>
        </ol>
        <h4>Risk</h4>
        <p>
          Telemetry rate at ~25 agents is fine; double-check at the ops-tail
          firehose density (100+ rows).
        </p>
        <pre>
          <code>{`<AgentRow agent={mock} density="comfortable" />`}</code>
        </pre>
        <blockquote>
          One primitive per concept; renderers, not switches, when the taxonomy
          grows.
        </blockquote>
        <table>
          <thead>
            <tr>
              <th>Density</th>
              <th>py</th>
              <th>gap</th>
              <th>Usage</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>comfortable</td>
              <td>6px</td>
              <td>10px</td>
              <td>roster default</td>
            </tr>
            <tr>
              <td>compact</td>
              <td>4px</td>
              <td>8px</td>
              <td>25-above-fold</td>
            </tr>
            <tr>
              <td>manifest</td>
              <td>6px</td>
              <td>16px</td>
              <td>ops / tail</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
