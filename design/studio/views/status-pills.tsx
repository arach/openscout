/**
 * Status Pills — study.
 *
 * Documents the studio's status palette in three forms: filled pill,
 * outlined pill, text-only. Same five status types (ok, warn, error,
 * info, neutral) — used for SCO status (shipped / in-flight / shelved
 * / concept / draft) and any other status surface.
 *
 * Token names alongside each swatch so the values are copy-pasteable.
 * Auto-switches with the sidebar Dark/Light toggle since everything
 * reads from CSS vars defined in app/globals.css.
 */

type Tone = "ok" | "warn" | "error" | "info" | "neutral";

interface Row {
  tone: Tone;
  studioStatus: string;
  label: string;
  fgVar: string;
  bgVar: string;
}

const ROWS: Row[] = [
  {
    tone: "ok",
    studioStatus: "shipped",
    label: "SHIPPED",
    fgVar: "--status-ok-fg",
    bgVar: "--status-ok-bg",
  },
  {
    tone: "warn",
    studioStatus: "in-flight",
    label: "IN-FLIGHT",
    fgVar: "--status-warn-fg",
    bgVar: "--status-warn-bg",
  },
  {
    tone: "info",
    studioStatus: "concept",
    label: "CONCEPT",
    fgVar: "--status-info-fg",
    bgVar: "--status-info-bg",
  },
  {
    tone: "error",
    studioStatus: "shelved",
    label: "SHELVED",
    fgVar: "--status-error-fg",
    bgVar: "--status-error-bg",
  },
  {
    tone: "neutral",
    studioStatus: "draft",
    label: "DRAFT",
    fgVar: "--status-neutral-fg",
    bgVar: "--status-neutral-bg",
  },
];

export default function StatusPillsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · pills
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Status pills
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Five status tones × three pill forms. All swatches read from{" "}
          <code className="font-mono text-[11px] text-studio-ink">--status-*</code>{" "}
          CSS vars defined in{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            app/globals.css
          </code>
          ; flip the sidebar toggle to compare against the other theme.
        </p>
      </header>

      <div className="mb-1 grid grid-cols-[140px_140px_140px_140px_1fr] gap-4 border-b border-studio-edge pb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        <div>Studio status</div>
        <div>Filled</div>
        <div>Outlined</div>
        <div>Text only</div>
        <div>Tokens</div>
      </div>

      <div>
        {ROWS.map((row) => (
          <div
            key={row.tone}
            className="grid grid-cols-[140px_140px_140px_140px_1fr] items-center gap-4 py-3.5"
          >
            <div>
              <div className="font-sans text-[13px] font-medium text-studio-ink">
                {row.studioStatus}
              </div>
              <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
                tone: {row.tone}
              </div>
            </div>

            <div>
              <span
                className="inline-block rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
                style={{
                  color: `var(${row.fgVar})`,
                  background: `var(${row.bgVar})`,
                }}
              >
                {row.label}
              </span>
            </div>

            <div>
              <span
                className="inline-block rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
                style={{
                  color: `var(${row.fgVar})`,
                  borderColor: `var(${row.fgVar})`,
                }}
              >
                {row.label}
              </span>
            </div>

            <div>
              <span
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: `var(${row.fgVar})` }}
              >
                {row.label}
              </span>
            </div>

            <div className="flex flex-col gap-0.5 font-mono text-[10px] text-studio-ink-faint">
              <code>{row.fgVar}</code>
              <code>{row.bgVar}</code>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · usage
        </div>
        <pre className="overflow-x-auto rounded-md border border-studio-edge bg-studio-canvas-alt p-4 font-mono text-[12px] leading-[1.6] text-studio-ink">
{`import { StatusPill } from "@/components/StatusPill";

<StatusPill status="shipped" />              // filled (default)
<StatusPill status="in-flight" variant="outlined" />
<StatusPill tone="info" variant="text" label="EXPERIMENTAL" />`}
        </pre>
      </section>
    </main>
  );
}
