import Link from "next/link";
import { EngMarkdown } from "@/components/EngMarkdown";
import { StatusPill } from "@/components/StatusPill";
import { type EngDoc } from "@/lib/eng-docs";

/**
 * Unified data-sheet header for an SCO engineering doc.
 *
 * One bordered container. Every line — identifier, status, title,
 * lifted section bodies (Summary, Goal, Decision), related siblings —
 * is a row in the same two-column grid. The label column has a fixed
 * width so the eye runs straight down it; the value column types each
 * kind of data as appropriate (identifier mono, title display, prose
 * via EngMarkdown).
 *
 * Rows render only when the underlying field is present.
 */
export function EngDocHeader({ doc }: { doc: EngDoc }) {
  const scoLabel = doc.scoId?.toUpperCase() ?? null;
  // Status is rendered as its own row from the pre-parsed pill + raw
  // text; everything else (Summary/Intent) renders in source order.
  const renderedSections = doc.headerSections.filter(
    (s) => s.label !== "Status",
  );

  return (
    <div className="-mx-7 border-y border-studio-edge bg-studio-canvas">
      <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge">
        {scoLabel ? (
          <DataRow label="Proposal">
            <span className="font-mono text-[12.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
              {scoLabel}
            </span>
            {doc.kind !== "proposal" && doc.kind !== "other" ? (
              <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-studio-ink-faint">
                · {kindLabel(doc.kind)}
              </span>
            ) : null}
          </DataRow>
        ) : null}

        <DataRow label="Status">
          <div className="flex flex-wrap items-baseline gap-2">
            <StatusPill status={doc.status} />
            {doc.statusRaw ? (
              <span className="font-mono text-[11px] text-studio-ink-faint">
                {doc.statusRaw}
              </span>
            ) : null}
          </div>
        </DataRow>

        <DataRow label="Title">
          <h1 className="m-0 font-display text-[22px] font-medium leading-tight tracking-tight text-studio-ink">
            {doc.title}
          </h1>
        </DataRow>

        {renderedSections.map((section) => (
          <DataRow key={section.label} label={section.label}>
            <EngMarkdown body={section.body} fromSlug={doc.slug} compact />
          </DataRow>
        ))}

        {doc.siblings.length > 0 ? (
          <DataRow label="Related">
            <ul className="m-0 flex flex-col gap-1.5">
              {doc.siblings.map((s) => (
                <li key={s.slug} className="flex items-baseline gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint min-w-[110px]">
                    {kindLabel(s.kind)}
                  </span>
                  <Link
                    href={`/eng/${s.slug}`}
                    className="font-sans text-[13px] text-studio-ink underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink"
                  >
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </DataRow>
        ) : null}
      </div>
    </div>
  );
}

function kindLabel(kind: EngDoc["kind"]): string {
  switch (kind) {
    case "proposal":
      return "Proposal";
    case "implementation-plan":
      return "Impl. plan";
    case "review":
      return "Review";
    case "other":
      return "Note";
  }
}

function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-6 px-7 py-3">
      <div className="pt-[3px] font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
