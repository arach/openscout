/**
 * InspectorSection — proposed Tier-1 atom from the inspector-bar audit.
 *
 * Renders three concrete examples side by side so we can argue about
 * spacing, label tracking, and the count chip before any code under
 * packages/web/client/scout/inspector/ is touched.
 *
 * This is a vanilla-Tailwind preview. The real atom would live in
 * packages/web/client/scout/inspector/atoms/InspectorSection.tsx and
 * compile against ctx-panel.css tokens; here we're just sketching the
 * visual contract.
 */

import type { ReactNode } from "react";

interface Props {
  label: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}

function InspectorSection({ label, count, action, children }: Props) {
  return (
    <section className="px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline gap-2">
        <div className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-studio-ink-faint">
          {label}
        </div>
        {typeof count === "number" ? (
          <span className="rounded-[3px] bg-studio-canvas-alt px-1.5 py-px font-mono text-[9.5px] text-studio-ink">
            {count}
          </span>
        ) : null}
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

export default function InspectorSectionAtomPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · atoms · inspector-section
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          InspectorSection
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Replaces the private <code className="font-mono text-[11px] text-studio-ink">Section({"{"} label, children {"}"})</code> components
          duplicated across Home/Agents/Sessions, plus the manual{" "}
          <code className="font-mono text-[11px] text-studio-ink">ctx-panel-section</code> markup
          used by Channel/Ops.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Panel title="Label only">
          <InspectorSection label="Doing">
            <Row name="Hudson" detail="reviewing PR #214" />
            <Row name="Scout" detail="indexing channel.shared" />
          </InspectorSection>
        </Panel>

        <Panel title="Label + count">
          <InspectorSection label="Queue" count={3}>
            <Row name="ops-bot" detail="needs ack" tone="warn" />
            <Row name="cody" detail="awaiting decision" tone="warn" />
            <Row name="hudson" detail="re-attempt" tone="warn" />
          </InspectorSection>
        </Panel>

        <Panel title="Label + count + action">
          <InspectorSection
            label="Recent"
            count={6}
            action={
              <button
                type="button"
                className="rounded-[3px] px-1.5 py-px font-mono text-[9.5px] text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink"
              >
                clear
              </button>
            }
          >
            <Row name="qb-agent" detail="finished triage" />
            <Row name="scout" detail="finished index" />
            <Row name="hudson" detail="cancelled run" />
          </InspectorSection>
        </Panel>
      </div>

      <div className="mt-12 max-w-prose border-t border-studio-edge pt-5">
        <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          · props
        </div>
        <pre className="font-mono text-[11.5px] leading-relaxed text-studio-ink">
{`interface Props {
  label: string;
  count?: number;
  action?: ReactNode;   // optional trailing slot
  children: ReactNode;
}`}
        </pre>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </div>
      <div className="rounded-md border border-studio-edge bg-studio-surface">
        {children}
      </div>
    </div>
  );
}

function Row({
  name,
  detail,
  tone,
}: {
  name: string;
  detail: string;
  tone?: "warn";
}) {
  return (
    <div
      className={`flex items-baseline gap-2 border-t border-studio-edge px-3 py-2 first:border-t-0 ${
        tone === "warn" ? "bg-[var(--status-warn-bg)]" : ""
      }`}
    >
      <span className="font-sans text-[12.5px] font-medium text-studio-ink">
        {name}
      </span>
      <span className="font-sans text-[11.5px] text-studio-ink-faint">
        {detail}
      </span>
    </div>
  );
}
