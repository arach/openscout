"use client";

import { useMemo, useState } from "react";

type AreaId = "home" | "agents" | "chat" | "search" | "ops";
type BeforeAreaId =
  | "fleet"
  | "agents"
  | "conversations"
  | "sessions"
  | "search"
  | "mesh"
  | "broker"
  | "ops";

type BeforeNavArea = {
  id: BeforeAreaId;
  label: string;
  purpose: string;
  contains: string[];
  routes: string[];
  movesTo: AreaId;
};

type NavArea = {
  id: AreaId;
  label: string;
  canonicalRoute: string;
  purpose: string;
  secondary: Array<{ label: string; route: string }>;
  absorbedBefore: string[];
};

type RouteCoverage = {
  beforeLabel: string;
  route: string;
  afterArea: AreaId;
  afterSurface: string;
};

const BEFORE_AREAS: BeforeNavArea[] = [
  {
    id: "fleet",
    label: "Fleet",
    purpose: "System overview.",
    contains: ["status", "motion", "attention", "activity"],
    routes: ["/", "/fleet", "/activity"],
    movesTo: "home",
  },
  {
    id: "agents",
    label: "Agents",
    purpose: "Worker directory.",
    contains: ["profiles", "observe", "message", "handoff"],
    routes: ["/agents", "/agents/:agentId"],
    movesTo: "agents",
  },
  {
    id: "conversations",
    label: "Conversations",
    purpose: "Readable threads.",
    contains: ["inbox", "DMs", "channels", "compose"],
    routes: ["/conversations", "/messages", "/channels", "/c/:conversationId"],
    movesTo: "chat",
  },
  {
    id: "sessions",
    label: "Sessions",
    purpose: "Harness evidence.",
    contains: ["sessions", "transcripts", "agent binding"],
    routes: ["/sessions"],
    movesTo: "agents",
  },
  {
    id: "search",
    label: "Search",
    purpose: "Knowledge lookup.",
    contains: ["query", "preview", "indexer"],
    routes: ["/search", "/search/indexer"],
    movesTo: "search",
  },
  {
    id: "mesh",
    label: "Mesh",
    purpose: "Machine reachability.",
    contains: ["machines", "paths", "peers"],
    routes: ["/mesh"],
    movesTo: "ops",
  },
  {
    id: "broker",
    label: "Broker",
    purpose: "Dispatch ledger.",
    contains: ["routing", "delivery", "failures", "thread handoff"],
    routes: ["/broker"],
    movesTo: "ops",
  },
  {
    id: "ops",
    label: "Ops",
    purpose: "Runtime control.",
    contains: ["control", "tail", "runtime", "plans"],
    routes: ["/ops", "/ops/tail", "/ops/atop", "/ops/plan"],
    movesTo: "ops",
  },
];

const AREAS: NavArea[] = [
  {
    id: "home",
    label: "Home",
    canonicalRoute: "/",
    purpose: "Status, motion, attention.",
    secondary: [
      { label: "Overview", route: "/" },
      { label: "Activity", route: "/activity" },
    ],
    absorbedBefore: ["Fleet", "Activity"],
  },
  {
    id: "agents",
    label: "Agents",
    canonicalRoute: "/agents",
    purpose: "Workers, sessions, configuration.",
    secondary: [
      { label: "Directory", route: "/agents" },
      { label: "Sessions", route: "/sessions" },
      { label: "Config", route: "/settings/agents" },
    ],
    absorbedBefore: ["Agents", "Sessions", "Settings"],
  },
  {
    id: "chat",
    label: "Chat",
    canonicalRoute: "/messages",
    purpose: "DMs, channels, threads.",
    secondary: [
      { label: "Messages", route: "/messages" },
      { label: "Channels", route: "/channels" },
      { label: "Thread", route: "/c/:conversationId" },
    ],
    absorbedBefore: ["Conversations", "Messages", "Channels"],
  },
  {
    id: "search",
    label: "Search",
    canonicalRoute: "/search",
    purpose: "Lookup and evidence.",
    secondary: [
      { label: "Knowledge", route: "/search" },
      { label: "Indexer", route: "/search/indexer" },
    ],
    absorbedBefore: ["Search"],
  },
  {
    id: "ops",
    label: "Ops",
    canonicalRoute: "/ops",
    purpose: "Control, dispatch, mesh, logs.",
    secondary: [
      { label: "Control", route: "/ops" },
      { label: "Dispatch", route: "/broker" },
      { label: "Mesh", route: "/mesh" },
      { label: "Logs", route: "/ops/tail" },
      { label: "Runtime", route: "/ops/atop" },
      { label: "Plans", route: "/ops/plan" },
    ],
    absorbedBefore: ["Mesh", "Broker", "Tail", "Runtime", "Plans"],
  },
];

const COVERAGE: RouteCoverage[] = [
  { beforeLabel: "Fleet", route: "/", afterArea: "home", afterSurface: "Overview" },
  { beforeLabel: "Fleet legacy", route: "/fleet", afterArea: "home", afterSurface: "Overview" },
  { beforeLabel: "Activity", route: "/activity", afterArea: "home", afterSurface: "Activity" },
  { beforeLabel: "Agents", route: "/agents", afterArea: "agents", afterSurface: "Directory" },
  { beforeLabel: "Agent detail", route: "/agents/:agentId", afterArea: "agents", afterSurface: "Detail" },
  { beforeLabel: "Sessions", route: "/sessions", afterArea: "agents", afterSurface: "Sessions" },
  { beforeLabel: "Agent config", route: "/settings/agents", afterArea: "agents", afterSurface: "Config" },
  { beforeLabel: "Messages", route: "/messages", afterArea: "chat", afterSurface: "Messages" },
  { beforeLabel: "Conversations", route: "/conversations", afterArea: "chat", afterSurface: "Messages" },
  { beforeLabel: "Channels", route: "/channels", afterArea: "chat", afterSurface: "Channels" },
  { beforeLabel: "Conversation", route: "/c/:conversationId", afterArea: "chat", afterSurface: "Thread" },
  { beforeLabel: "Search", route: "/search", afterArea: "search", afterSurface: "Knowledge" },
  { beforeLabel: "Indexer", route: "/search/indexer", afterArea: "search", afterSurface: "Indexer" },
  { beforeLabel: "Ops", route: "/ops", afterArea: "ops", afterSurface: "Control" },
  { beforeLabel: "Broker", route: "/broker", afterArea: "ops", afterSurface: "Dispatch" },
  { beforeLabel: "Mesh", route: "/mesh", afterArea: "ops", afterSurface: "Mesh" },
  { beforeLabel: "Tail", route: "/ops/tail", afterArea: "ops", afterSurface: "Logs" },
  { beforeLabel: "Runtime", route: "/ops/atop", afterArea: "ops", afterSurface: "Runtime" },
  { beforeLabel: "Plans", route: "/ops/plan", afterArea: "ops", afterSurface: "Plans" },
  { beforeLabel: "Work detail", route: "/work/:workId", afterArea: "ops", afterSurface: "Work" },
];

const AREA_BY_ID = new Map(AREAS.map((area) => [area.id, area]));
const BEFORE_BY_ID = new Map(BEFORE_AREAS.map((area) => [area.id, area]));
const BEFORE_BY_LABEL = new Map(BEFORE_AREAS.map((area) => [area.label, area]));
const AREA_BY_LABEL = new Map(AREAS.map((area) => [area.label, area]));

function liveHref(route: string): string | null {
  return route.includes(":") ? null : `http://127.0.0.1:3200${route}`;
}

export default function NavigationTaxonomyPage() {
  const [selectedBeforeId, setSelectedBeforeId] = useState<BeforeAreaId>("broker");
  const [selectedId, setSelectedId] = useState<AreaId>("ops");
  const selectedBefore = BEFORE_BY_ID.get(selectedBeforeId) ?? BEFORE_AREAS[0];
  const selected = AREA_BY_ID.get(selectedId) ?? AREAS[0];
  const selectedCoverage = useMemo(
    () => COVERAGE.filter((route) => route.afterArea === selected.id),
    [selected.id],
  );

  return (
    <main className="mx-auto max-w-page px-7 py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            studies / web
          </div>
          <h1 className="mt-1 font-display text-[30px] font-medium leading-none text-studio-ink">
            Navigation map
          </h1>
        </div>
        <div className="flex gap-2">
          <Metric label="Before" value={String(BEFORE_AREAS.length)} />
          <Metric label="After" value={String(AREAS.length)} />
          <Metric label="Routes" value={String(COVERAGE.length)} />
        </div>
      </header>

      <section className="mb-5 space-y-3">
        <NavLayer
          title="Before"
          primary={BEFORE_AREAS.map((area) => area.label)}
          secondary={selectedBefore.routes}
          selectedPrimary={selectedBefore.label}
          onPrimarySelect={(label) => {
            const area = BEFORE_BY_LABEL.get(label);
            if (area) setSelectedBeforeId(area.id);
          }}
        />
        <NavLayer
          title="After"
          primary={AREAS.map((area) => area.label)}
          secondary={selected.secondary.map((surface) => surface.label)}
          selectedPrimary={selected.label}
          onPrimarySelect={(label) => {
            const area = AREA_BY_LABEL.get(label);
            if (area) setSelectedId(area.id);
          }}
        />
      </section>

      <OldNewMap
        selectedBeforeId={selectedBefore.id}
        selectedAfterId={selected.id}
        onSelect={(beforeArea) => {
          setSelectedBeforeId(beforeArea.id);
          setSelectedId(beforeArea.movesTo);
        }}
      />

      <section className="mb-5 grid gap-5 xl:grid-cols-2">
        <BeforeDetails area={selectedBefore} />
        <AfterDetails area={selected} />
      </section>

      <section>
        <RouteMap selected={selected} rows={selectedCoverage} onSelect={setSelectedId} />
      </section>
    </main>
  );
}

function NavLayer({
  title,
  primary,
  secondary,
  selectedPrimary,
  onPrimarySelect,
}: {
  title: string;
  primary: string[];
  secondary: string[];
  selectedPrimary: string;
  onPrimarySelect?: (label: string) => void;
}) {
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)]">
        <div>
          <div className="font-display text-[24px] font-medium text-studio-ink">{title}</div>
        </div>
        <div className="space-y-3">
          <div className="grid gap-2 lg:grid-cols-[82px_minmax(0,1fr)] lg:items-center">
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              Primary
            </div>
            <div className="flex flex-wrap gap-2">
              {primary.map((label) => {
                const active = label === selectedPrimary;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onPrimarySelect?.(label)}
                    className={`rounded border px-3 py-2 font-mono text-[11px] uppercase tracking-ch ${
                      active
                        ? "border-scout-accent bg-scout-accent-soft text-studio-ink"
                        : "border-studio-edge bg-studio-canvas-alt text-studio-ink-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2 lg:grid-cols-[82px_minmax(0,1fr)] lg:items-center">
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              Secondary
            </div>
            <div className="flex flex-wrap gap-2">
              {secondary.map((label) => (
                <span
                  key={label}
                  className="rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] text-studio-ink-muted"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OldNewMap({
  selectedBeforeId,
  selectedAfterId,
  onSelect,
}: {
  selectedBeforeId: BeforeAreaId;
  selectedAfterId: AreaId;
  onSelect: (area: BeforeNavArea) => void;
}) {
  return (
    <section className="mb-5 rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        Old to new
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {BEFORE_AREAS.map((area) => {
          const target = AREA_BY_ID.get(area.movesTo);
          const selected = area.id === selectedBeforeId;
          const sameTarget = !selected && area.movesTo === selectedAfterId;

          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onSelect(area)}
              className={`grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2 rounded border px-3 py-2 text-left ${
                selected
                  ? "border-scout-accent bg-scout-accent-soft"
                  : sameTarget
                    ? "border-scout-accent/35 bg-scout-accent-soft/35"
                  : "border-studio-edge bg-studio-canvas-alt"
              }`}
            >
              <span className="truncate font-mono text-[10px] uppercase tracking-ch text-studio-ink">
                {area.label}
              </span>
              <span className="text-center font-mono text-[12px] text-studio-ink-faint">-&gt;</span>
              <span className="truncate font-mono text-[10px] uppercase tracking-ch text-scout-accent">
                {target?.label ?? area.movesTo}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function BeforeDetails({ area }: { area: BeforeNavArea }) {
  const target = AREA_BY_ID.get(area.movesTo);

  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
            Before
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium text-studio-ink">
            {area.label}
          </h2>
        </div>
        <div className="rounded border border-scout-accent/40 bg-scout-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-ch text-studio-ink">
          to {target?.label ?? area.movesTo}
        </div>
      </div>
      <p className="mt-3 font-sans text-[13px] text-studio-ink-muted">{area.purpose}</p>
      <ChipSet items={area.contains} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-studio-edge pt-4">
        {area.routes.map((route) => (
          <RouteOnlyChip key={route} route={route} />
        ))}
      </div>
    </section>
  );
}

function AfterDetails({ area }: { area: NavArea }) {
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-scout-accent">
            After
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium text-studio-ink">
            {area.label}
          </h2>
        </div>
        <code className="font-mono text-[10px] text-studio-ink-faint">
          {area.canonicalRoute}
        </code>
      </div>
      <p className="mt-3 font-sans text-[13px] text-studio-ink-muted">{area.purpose}</p>
      <ChipSet items={area.absorbedBefore} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-studio-edge pt-4">
        {area.secondary.map((item) => (
          <RouteChip key={item.route} label={item.label} route={item.route} />
        ))}
      </div>
    </section>
  );
}

function RouteMap({
  selected,
  rows,
  onSelect,
}: {
  selected: NavArea;
  rows: RouteCoverage[];
  onSelect: (id: AreaId) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas px-4 py-3">
        <div>
          <h2 className="font-display text-[20px] font-medium text-studio-ink">Details</h2>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
            {selected.label}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {AREAS.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => onSelect(area.id)}
              className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-ch ${
                area.id === selected.id
                  ? "border-scout-accent bg-scout-accent-soft text-studio-ink"
                  : "border-studio-edge bg-studio-canvas-alt text-studio-ink-muted"
              }`}
            >
              {area.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[140px_170px_minmax(140px,1fr)] border-b border-studio-edge bg-studio-canvas-alt px-4 py-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <div>Before</div>
        <div>Route</div>
        <div>Now</div>
      </div>
      <div>
        {rows.map((row) => {
          const href = liveHref(row.route);
          return (
            <div
              key={`${row.beforeLabel}:${row.route}`}
              className="grid grid-cols-[140px_170px_minmax(140px,1fr)] items-center border-b border-studio-edge/70 px-4 py-3 text-[12px]"
            >
              <div className="font-sans font-medium text-studio-ink">{row.beforeLabel}</div>
              <div>
                {href ? (
                  <a
                    href={href}
                    className="font-mono text-[11px] text-scout-accent underline-offset-4 hover:underline"
                  >
                    {row.route}
                  </a>
                ) : (
                  <code className="font-mono text-[11px] text-studio-ink-muted">{row.route}</code>
                )}
              </div>
              <div className="font-sans text-studio-ink-muted">{row.afterSurface}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RouteChip({ label, route }: { label: string; route: string }) {
  const href = liveHref(route);
  const content = (
    <>
      <span className="font-sans text-[12px] text-studio-ink">{label}</span>
      <code className="font-mono text-[10px] text-studio-ink-faint">{route}</code>
    </>
  );

  if (!href) {
    return (
      <span className="inline-flex items-baseline gap-2 rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1">
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      className="inline-flex items-baseline gap-2 rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1 hover:border-scout-accent"
    >
      {content}
    </a>
  );
}

function RouteOnlyChip({ route }: { route: string }) {
  const href = liveHref(route);
  if (!href) {
    return (
      <code className="rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] text-studio-ink-faint">
        {route}
      </code>
    );
  }

  return (
    <a
      href={href}
      className="rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] text-studio-ink-faint hover:border-scout-accent"
    >
      {route}
    </a>
  );
}

function ChipSet({ items }: { items: string[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1 font-mono text-[10px] uppercase tracking-ch text-studio-ink-muted"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 rounded-md border border-studio-edge bg-studio-surface px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="mt-1 font-display text-[22px] leading-none text-studio-ink">{value}</div>
    </div>
  );
}
