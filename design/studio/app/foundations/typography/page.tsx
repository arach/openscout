/**
 * Typography — foundation.
 *
 * Display / sans / mono ramps plus a `.studio-prose` stress-test
 * rendered in both themes. Sizes mirror the rules in
 * `app/globals.css:.studio-prose` and the chrome conventions used by
 * existing studies. Specs alongside each sample so the page doubles
 * as documentation.
 */

type Row = { sample: React.ReactNode; spec: Array<[string, string]> };

const DISPLAY: Row[] = [
  {
    sample: <span className="font-display text-[28px] font-medium leading-[1.15] tracking-[-0.012em] text-studio-ink">H1 — Display 28</span>,
    spec: [["family", "Play"], ["size", "28px"], ["weight", "500"], ["letter-spacing", "-0.012em"], ["line-height", "1.15"], ["usage", "page titles · prose h1"]],
  },
  {
    sample: <span className="font-display text-[20px] font-medium leading-[1.25] tracking-[-0.012em] text-studio-ink">H2 — Display 20</span>,
    spec: [["family", "Play"], ["size", "20px"], ["weight", "500"], ["line-height", "1.25"], ["usage", "prose h2 · section openers"]],
  },
  {
    sample: <span className="font-display text-[16px] font-semibold tracking-[-0.012em] text-studio-ink">H3 — Display 16</span>,
    spec: [["family", "Play"], ["size", "16px"], ["weight", "600"], ["usage", "prose h3 · sub-section"]],
  },
  {
    sample: <span className="font-mono text-[13.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">H4 — Mono caps 13.5</span>,
    spec: [["family", "JetBrains Mono"], ["size", "13.5px"], ["weight", "600"], ["letter-spacing", "0.18em"], ["transform", "uppercase"], ["usage", "prose h4 — overrides serif"]],
  },
];

const SANS: Row[] = [
  {
    sample: <span className="font-sans text-[13.5px] font-medium text-studio-ink">Body 13.5 — UI default in chrome rows</span>,
    spec: [["family", "Inter Tight"], ["size", "13.5px"], ["weight", "500"], ["usage", "primary chrome label (agent row)"]],
  },
  {
    sample: <span className="font-sans text-[14.5px] leading-[1.65] text-studio-ink">Prose 14.5 — sustained reading column body</span>,
    spec: [["family", "Inter Tight"], ["size", "14.5px"], ["weight", "400"], ["line-height", "1.65"], ["usage", "prose body · plans + eng docs"]],
  },
  {
    sample: <span className="font-sans text-[12.5px] text-studio-ink-muted">Caption 12.5 — secondary chrome / task lines</span>,
    spec: [["family", "Inter Tight"], ["size", "12.5px"], ["color", "ink-muted"], ["usage", "task line · row metadata"]],
  },
  {
    sample: <span className="font-sans text-[11px] text-studio-ink-faint">Small 11 — supporting hints</span>,
    spec: [["family", "Inter Tight"], ["size", "11px"], ["color", "ink-faint"], ["usage", "hint text · sidebar sub-labels"]],
  },
];

const MONO: Row[] = [
  {
    sample: <span className="font-mono text-[12.5px] leading-[1.55] text-studio-ink">const value = &quot;code 12.5&quot;;</span>,
    spec: [["family", "JetBrains Mono"], ["size", "12.5px"], ["line-height", "1.55"], ["usage", "prose pre · inline code"]],
  },
  {
    sample: <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">chrome 10 · 2s ago · 14:32:01</span>,
    spec: [["family", "JetBrains Mono"], ["size", "10px"], ["usage", "timestamps · row metadata"]],
  },
  {
    sample: <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">· eyebrow 9 — section labels</span>,
    spec: [["family", "JetBrains Mono"], ["size", "9px"], ["weight", "600"], ["letter-spacing", "0.22em"], ["transform", "uppercase"], ["usage", "page eyebrow · sidebar buckets"]],
  },
];

export default function TypographyPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · foundations · typography
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Typography
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Three families, three ramps, one prose stress-test. Display is Play, body
          is Inter Tight, chrome is JetBrains Mono. Sizes match the rules in{" "}
          <code className="font-mono text-[11px] text-studio-ink">.studio-prose</code>{" "}
          (app/globals.css) and the conventions used across existing studies.
        </p>
      </header>

      <Section title="Display ramp" hint="Play — page titles and prose headings">
        <RampTable rows={DISPLAY} />
      </Section>
      <Section title="Sans ramp" hint="Inter Tight — body copy and chrome labels">
        <RampTable rows={SANS} />
      </Section>
      <Section title="Mono ramp" hint="JetBrains Mono — code, timestamps, eyebrows">
        <RampTable rows={MONO} />
      </Section>
      <Section title="Prose stress-test" hint=".studio-prose in both themes — every element in one pass">
        <div className="grid gap-4 lg:grid-cols-2">
          <ProseSample theme="dark" />
          <ProseSample theme="light" />
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

function RampTable({ rows }: { rows: Row[] }) {
  return (
    <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge rounded-md border border-studio-edge">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-center gap-6 px-4 py-4">
          <div className="min-w-0">{row.sample}</div>
          <dl className="flex flex-col gap-0.5 font-mono text-[10px]">
            {row.spec.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</dt>
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
    <div data-theme={theme} className="rounded-md border border-studio-edge bg-studio-canvas p-5">
      <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · theme: {theme}
      </div>
      <article className="studio-prose">
        <h1>Plan: agent pulse cleanup</h1>
        <p>
          The roster sidebar needs one primitive that says <strong>this agent is doing X</strong>.
          Today we have three near-duplicates; <em>shipping the consolidated row</em> means we can
          retire the legacy <a href="#">HomeAgentsInspector</a> path.
        </p>
        <h2>Approach</h2>
        <p>
          Lift the visual from <code>AgentRow</code> in <code>HomeAgentsInspector.tsx</code>,
          rebuild against studio tokens, offer three densities. Inline is single-line; comfortable
          is the default; compact targets ops surfaces.
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
          Telemetry rate at ~25 agents is fine; double-check at the ops-tail firehose density
          (100+ rows).
        </p>
        <pre><code>{`<AgentRow agent={mock} density="comfortable" />`}</code></pre>
        <blockquote>One primitive per concept; renderers, not switches, when the taxonomy grows.</blockquote>
        <table>
          <thead><tr><th>Density</th><th>py</th><th>gap</th><th>Usage</th></tr></thead>
          <tbody>
            <tr><td>comfortable</td><td>6px</td><td>10px</td><td>roster default</td></tr>
            <tr><td>compact</td><td>4px</td><td>8px</td><td>25-above-fold</td></tr>
            <tr><td>manifest</td><td>6px</td><td>16px</td><td>ops / tail</td></tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
