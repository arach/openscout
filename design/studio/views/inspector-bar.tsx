/**
 * Inspector Bar — concept study.
 *
 * A side-by-side comparison of the eight current inspector variants
 * (Home, Agents, Sessions, Channel, Work, Mesh, Ops, Broker) reduced
 * to their structural skeleton, so the operator can see at a glance
 * which layouts are duplicating which sections.
 *
 * This is a static mock — no live data. The point is to settle on a
 * shared section vocabulary before refactoring code under
 * packages/web/client/scout/inspector/.
 */

type SectionKind =
  | "header"
  | "stat-grid"
  | "list"
  | "key-value"
  | "callout"
  | "actions"
  | "json";

interface InspectorMock {
  name: string;
  route: string;
  sections: { kind: SectionKind; label: string; note?: string }[];
  verdict: "Yes" | "Partial" | "No";
}

const VARIANTS: InspectorMock[] = [
  {
    name: "Home / Fleet",
    route: "/inbox · /fleet",
    verdict: "Partial",
    sections: [
      { kind: "header", label: "Online", note: "n agents" },
      { kind: "list", label: "agent rows" },
      { kind: "header", label: "Standby" },
      { kind: "list", label: "offline rows" },
    ],
  },
  {
    name: "Agents",
    route: "/agents · /agent-info",
    verdict: "Yes",
    sections: [
      { kind: "header", label: "Identity" },
      { kind: "callout", label: "State" },
      { kind: "stat-grid", label: "Presence (mesh viz)" },
      { kind: "list", label: "Incoming asks" },
      { kind: "key-value", label: "Identity detail" },
      { kind: "key-value", label: "Project" },
      { kind: "list", label: "Capabilities" },
    ],
  },
  {
    name: "Sessions",
    route: "/sessions · /conversation",
    verdict: "Partial",
    sections: [
      { kind: "header", label: "Title + kind" },
      { kind: "key-value", label: "Agent" },
      { kind: "key-value", label: "Workspace" },
      { kind: "stat-grid", label: "Activity" },
      { kind: "callout", label: "Preview" },
    ],
  },
  {
    name: "Channel",
    route: "/channels",
    verdict: "No",
    sections: [
      { kind: "header", label: "Channel summary" },
      { kind: "list", label: "Doing", note: "active runs/work" },
      { kind: "list", label: "Recent", note: "capped 6" },
    ],
  },
  {
    name: "Work",
    route: "/work",
    verdict: "Yes",
    sections: [
      { kind: "header", label: "Case header" },
      { kind: "key-value", label: "Case facts" },
      { kind: "list", label: "Timeline", note: "capped 5" },
      { kind: "key-value", label: "Routing" },
      { kind: "key-value", label: "Record" },
      { kind: "callout", label: "Hudson context" },
      { kind: "actions", label: "Open thread / Parent" },
    ],
  },
  {
    name: "Mesh",
    route: "/mesh",
    verdict: "Yes",
    sections: [
      { kind: "header", label: "Selection (peer/node/summary)" },
      { kind: "stat-grid", label: "Agent counts" },
      { kind: "key-value", label: "Detail grid" },
      { kind: "list", label: "Capabilities / Peers" },
      { kind: "actions", label: "Reach control" },
    ],
  },
  {
    name: "Ops",
    route: "/ops",
    verdict: "No",
    sections: [
      { kind: "callout", label: "Selected detail", note: "window event" },
      { kind: "stat-grid", label: "Ops context" },
      { kind: "list", label: "Queue" },
      { kind: "list", label: "Runs" },
      { kind: "list", label: "Agent pulse" },
    ],
  },
  {
    name: "Broker",
    route: "/broker",
    verdict: "Partial",
    sections: [
      { kind: "header", label: "Title + actions" },
      { kind: "key-value", label: "Detail grid" },
      { kind: "json", label: "Metadata dump" },
    ],
  },
];

const KIND_COLOR: Record<SectionKind, string> = {
  header: "#9CC9D6",
  "stat-grid": "#F5B95F",
  list: "#A0C0A0",
  "key-value": "#C4A0E0",
  callout: "#F09080",
  actions: "#3F9BB5",
  json: "#76767A",
};

export default function InspectorBarStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · inspector
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Inspector Bar
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Every right-rail inspector reduced to its section skeleton, color-coded
          by shape. The point is to see at a glance which inspectors duplicate
          which structures — and which ones the proposed Tier-1 atoms can collapse.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-studio-ink-faint">
        <span className="uppercase tracking-eyebrow">Legend</span>
        {(Object.keys(KIND_COLOR) as SectionKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: KIND_COLOR[k] }}
            />
            {k}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {VARIANTS.map((v) => (
          <InspectorMockCard key={v.name} variant={v} />
        ))}
      </div>
    </main>
  );
}

function InspectorMockCard({ variant }: { variant: InspectorMock }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="font-display text-[14px] font-medium tracking-tight text-studio-ink">
          {variant.name}
        </div>
        <Verdict v={variant.verdict} />
      </div>
      <div className="mb-3 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {variant.route}
      </div>
      <ul className="flex flex-col gap-1">
        {variant.sections.map((s, i) => (
          <li
            key={`${variant.name}-${i}`}
            className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-1"
            style={{
              background: `${KIND_COLOR[s.kind]}22`,
              borderLeft: `2px solid ${KIND_COLOR[s.kind]}`,
            }}
          >
            <span className="font-sans text-[11px] text-studio-ink">
              {s.label}
            </span>
            {s.note ? (
              <span className="font-mono text-[9px] text-studio-ink-faint">
                {s.note}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Verdict({ v }: { v: InspectorMock["verdict"] }) {
  const tone =
    v === "Yes"
      ? { bg: "#E2F0E5", fg: "#1F5A2E" }
      : v === "Partial"
        ? { bg: "#F5E6CC", fg: "#7A4A0E" }
        : { bg: "#F0DCDC", fg: "#8A3030" };
  return (
    <span
      className="rounded-[2px] px-1 py-px font-mono text-[8.5px] font-semibold tracking-[0.18em]"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {v.toUpperCase()}
    </span>
  );
}
