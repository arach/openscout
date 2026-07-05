const SESSION_STATES = [
  {
    id: "referenced",
    title: "Referenced",
    summary: "Scout has a session handle or intent, but has not proven a harness context exists.",
    invariant: "No claim of usable context yet.",
    tone: "neutral",
  },
  {
    id: "materializing",
    title: "Materializing",
    summary: "Creating, importing, or loading the harness context for that session.",
    invariant: "A concrete context operation is in progress.",
    tone: "motion",
  },
  {
    id: "detached",
    title: "Detached",
    summary: "The session context exists, but no running harness is currently driving it.",
    invariant: "Context is valid; attachment is absent.",
    tone: "warn",
  },
  {
    id: "attaching",
    title: "Attaching",
    summary: "Scout is binding the existing context to a running harness.",
    invariant: "There is an attach / resume / start attempt.",
    tone: "motion",
  },
  {
    id: "attached",
    title: "Attached",
    summary: "A running harness is driving the session context and can accept a turn.",
    invariant: "Verified harness attachment exists.",
    tone: "good",
  },
  {
    id: "running_turn",
    title: "Running turn",
    summary: "The attached harness is processing one turn in this session.",
    invariant: "One active turn for this session attachment.",
    tone: "active",
  },
  {
    id: "needs_input",
    title: "Needs input",
    summary: "The running turn/session is paused on explicit operator input.",
    invariant: "There is a concrete blocker record.",
    tone: "danger",
  },
  {
    id: "blocked",
    title: "Blocked",
    summary: "Scout cannot create or attach the session without operator/config action.",
    invariant: "A concrete next action exists.",
    tone: "danger",
  },
  {
    id: "error",
    title: "Error",
    summary: "A session-level harness error occurred, but the session may be recoverable.",
    invariant: "Error belongs to the session/attachment, not merely a message.",
    tone: "danger",
  },
  {
    id: "unresolved",
    title: "Unresolved",
    summary: "The session handle cannot be found or mapped to a context.",
    invariant: "No valid context established.",
    tone: "dim",
  },
  {
    id: "invalid",
    title: "Invalid",
    summary: "The context cannot be used under the requested constraints.",
    invariant: "Exact resume / fork / reuse is not possible.",
    tone: "dim",
  },
  {
    id: "archived",
    title: "Archived",
    summary: "The session is intentionally retired from active routing.",
    invariant: "Terminal for active routing.",
    tone: "dim",
  },
] as const;

const FLOWS = [
  ["referenced", "materializing", "attached", "running_turn", "attached"],
  ["referenced", "materializing", "detached", "attaching", "attached"],
  ["attached", "running_turn", "needs_input", "running_turn", "attached"],
  ["detached", "attaching", "blocked", "attaching", "attached"],
  ["running_turn", "detached", "attaching", "attached"],
  ["referenced", "unresolved", "archived"],
  ["materializing", "invalid", "archived"],
] as const;

const BANNED = [
  "agent offline",
  "waiting for target",
  "queued until online",
  "message stored for later delivery",
  "no runnable endpoint",
];

const PREFERRED = [
  "session is not attached to a running harness",
  "attaching session to Codex",
  "session ready",
  "session running a turn",
  "session needs approval",
  "exact session cannot be resumed",
];

const stateById = new Map(SESSION_STATES.map((state) => [state.id, state]));

type StateId = typeof SESSION_STATES[number]["id"];

function state(id: StateId) {
  const value = stateById.get(id);
  if (!value) throw new Error(`Unknown state ${id}`);
  return value;
}

export default function SessionHarnessStateStudy() {
  return (
    <main className="mx-auto max-w-[1180px] px-7 py-8 text-studio-ink">
      <header className="relative overflow-hidden rounded-[28px] border border-studio-edge bg-[radial-gradient(circle_at_18%_0%,rgba(90,169,255,0.20),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015))] px-8 py-7 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
        <div className="absolute right-8 top-7 rounded-full border border-studio-edge bg-studio-bg/50 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-studio-ink-faint">
          docs/eng/sco-079
        </div>
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · cross · session lifecycle
        </div>
        <h1 className="mt-3 max-w-3xl font-display text-[38px] font-medium leading-[0.96] tracking-tight text-studio-ink">
          Agent session state is context plus attachment.
        </h1>
        <p className="mt-4 max-w-2xl font-sans text-[14px] leading-relaxed text-studio-ink-muted">
          Agents are durable identities. The live thing is the harness attachment to a session context. This view separates session lifecycle from invocation delivery so “offline” and “queued” stop pretending to be session states.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Principle label="Agent" value="stateless address" />
          <Principle label="Session" value="harness context" />
          <Principle label="Attachment" value="driveable runtime" accent />
        </div>
      </header>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[24px] border border-studio-edge bg-studio-panel/60 p-5">
          <SectionHeader eyebrow="Primary machine" title="Agent session lifecycle" />
          <div className="mt-5 grid gap-4">
            <StateRail ids={["referenced", "materializing", "detached", "attaching", "attached", "running_turn"]} />
            <div className="grid gap-4 md:grid-cols-3">
              <StateCluster title="Context proof" ids={["referenced", "materializing", "unresolved", "invalid"]} />
              <StateCluster title="Harness attachment" ids={["detached", "attaching", "attached"]} />
              <StateCluster title="Turn pressure" ids={["running_turn", "needs_input", "blocked", "error", "archived"]} />
            </div>
          </div>
        </div>

        <aside className="rounded-[24px] border border-studio-edge bg-studio-panel/60 p-5">
          <SectionHeader eyebrow="Corrective lens" title="Detached is the key state" />
          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-300/[0.06] p-4">
            <div className="font-display text-[24px] leading-none tracking-tight text-amber-100">Detached</div>
            <p className="mt-3 text-[13px] leading-relaxed text-studio-ink-muted">
              The session context exists, but it is not currently attached to a running harness. This is not an agent status and not a message delivery state.
            </p>
          </div>
          <div className="mt-5 grid gap-3">
            <CopyColumn title="Stop saying" items={BANNED} bad />
            <CopyColumn title="Say instead" items={PREFERRED} />
          </div>
        </aside>
      </section>

      <section className="mt-8 rounded-[24px] border border-studio-edge bg-studio-panel/60 p-5">
        <SectionHeader eyebrow="Allowed paths" title="Common transitions" />
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {FLOWS.map((flow, index) => (
            <Flow key={index} ids={[...flow]} />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[24px] border border-studio-edge bg-studio-panel/60 p-5">
          <SectionHeader eyebrow="Boundary" title="Invocation is a consumer" />
          <p className="mt-4 text-[13px] leading-relaxed text-studio-ink-muted">
            Invocation state can say it is awaiting session attachment. It should not turn that into a session being queued or an agent being offline.
          </p>
          <div className="mt-5 rounded-2xl border border-studio-edge bg-black/20 p-4 font-mono text-[11px] leading-relaxed text-studio-ink-muted">
            invocation.awaiting_session_attachment
            <br />→ because session.state is detached / attaching / needs_input
          </div>
        </div>
        <div className="rounded-[24px] border border-studio-edge bg-studio-panel/60 p-5">
          <SectionHeader eyebrow="Implementation map" title="Legacy projection" />
          <div className="mt-5 grid gap-2">
            <Projection legacy="queued_until_online" next="invocation.awaiting_session_attachment" />
            <Projection legacy="no_runnable_endpoint" next="session.detached + reason=session_not_attached" />
            <Projection legacy="endpoint.state=offline" next="session.detached or session.stale" />
            <Projection legacy="flight.state=waking" next="session.attaching" />
            <Projection legacy="agent_offline" next="do not render; disambiguate session vs machine vs peer" />
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{eyebrow}</div>
      <h2 className="mt-1 font-display text-[24px] font-medium leading-none tracking-tight text-studio-ink">{title}</h2>
    </header>
  );
}

function Principle({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${accent ? "border-sky-300/35 bg-sky-300/[0.08]" : "border-studio-edge bg-black/15"}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint">{label}</div>
      <div className="mt-1 font-sans text-[14px] font-medium text-studio-ink">{value}</div>
    </div>
  );
}

function StateRail({ ids }: { ids: StateId[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-studio-edge bg-black/20 p-4">
      <div className="flex min-w-[760px] items-center gap-2">
        {ids.map((id, index) => (
          <div key={id} className="flex flex-1 items-center gap-2">
            <StateNode id={id} large />
            {index < ids.length - 1 ? <div className="h-px flex-1 bg-studio-edge-strong" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StateCluster({ title, ids }: { title: string; ids: StateId[] }) {
  return (
    <div className="rounded-2xl border border-studio-edge bg-black/15 p-4">
      <div className="mb-3 font-mono text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint">{title}</div>
      <div className="grid gap-2">
        {ids.map((id) => <StateNode key={id} id={id} />)}
      </div>
    </div>
  );
}

function StateNode({ id, large = false }: { id: StateId; large?: boolean }) {
  const current = state(id);
  return (
    <div className={`rounded-xl border p-3 ${toneClass(current.tone)} ${large ? "min-w-[118px]" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotClass(current.tone)}`} />
        <strong className="font-sans text-[12px] font-semibold text-studio-ink">{current.title}</strong>
      </div>
      {!large ? (
        <p className="mt-2 text-[11.5px] leading-snug text-studio-ink-muted">{current.summary}</p>
      ) : null}
    </div>
  );
}

function Flow({ ids }: { ids: StateId[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-studio-edge bg-black/15 p-3">
      {ids.map((id, index) => (
        <span key={`${id}-${index}`} className="flex items-center gap-2">
          <span className="rounded-full border border-studio-edge bg-studio-bg/70 px-2.5 py-1 font-mono text-[10px] text-studio-ink-muted">{id}</span>
          {index < ids.length - 1 ? <span className="text-studio-ink-faint">→</span> : null}
        </span>
      ))}
    </div>
  );
}

function CopyColumn({ title, items, bad = false }: { title: string; items: string[]; bad?: boolean }) {
  return (
    <div className="rounded-2xl border border-studio-edge bg-black/15 p-3">
      <div className={`font-mono text-[9px] uppercase tracking-[0.18em] ${bad ? "text-rose-200/75" : "text-emerald-200/75"}`}>{title}</div>
      <ul className="mt-2 grid gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12px] text-studio-ink-muted">
            <span className={bad ? "text-rose-300" : "text-emerald-300"}>{bad ? "×" : "✓"}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Projection({ legacy, next }: { legacy: string; next: string }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-studio-edge bg-black/15 p-3 md:grid-cols-[0.9fr_auto_1.2fr] md:items-center">
      <code className="font-mono text-[11px] text-rose-100/80">{legacy}</code>
      <span className="hidden text-studio-ink-faint md:block">→</span>
      <code className="font-mono text-[11px] text-emerald-100/85">{next}</code>
    </div>
  );
}

function toneClass(tone: string) {
  switch (tone) {
    case "good": return "border-emerald-300/25 bg-emerald-300/[0.07]";
    case "active": return "border-sky-300/30 bg-sky-300/[0.08]";
    case "motion": return "border-violet-300/25 bg-violet-300/[0.07]";
    case "warn": return "border-amber-300/30 bg-amber-300/[0.07]";
    case "danger": return "border-rose-300/30 bg-rose-300/[0.07]";
    case "dim": return "border-studio-edge bg-white/[0.025] opacity-80";
    default: return "border-studio-edge bg-black/15";
  }
}

function dotClass(tone: string) {
  switch (tone) {
    case "good": return "bg-emerald-300";
    case "active": return "bg-sky-300";
    case "motion": return "bg-violet-300";
    case "warn": return "bg-amber-300";
    case "danger": return "bg-rose-300";
    case "dim": return "bg-studio-ink-faint";
    default: return "bg-studio-ink-muted";
  }
}
