"use client";

/**
 * Studio study: Dispatch inspector · "Ask another agent" composer.
 *
 * Ground truth is the ask/steer module at the foot of the web Dispatch
 * inspector — packages/web/client/screens/broker/BrokerScreen.tsx (the
 * `.sys-broker-forward` section) styled by
 * packages/web/client/screens/system-surfaces-redesign.css:1320-1629.
 *
 * The complaint: at the default 520px inspector the footer carries
 * `+ dispatch context included` · `SEND TO` · four <select>s · mic · Send on
 * ONE row. The shipped CSS "fixes" it by clamping the selects to
 * 70 / 68 / 82 / 66px with `overflow: hidden`, so every value ellipsizes:
 * "Action ⌄ / Acti… ⌄ / Default… ⌄ / Medi… ⌄". A prior engineering pass
 * measured ~391px of content in a ~263px group.
 *
 * The four selects, from the source, are:
 *   1 project  — "Any project" + every routable agent's projectRoot/cwd
 *   2 agent    — agents filtered to that project ("Scout" for the scoutbot id)
 *   3 model    — union of the project's agents' models, else "Default model"
 *   4 effort   — low · medium · high · xhigh
 *
 * Baseline below is a faithful reproduction (production tokens mapped onto
 * studio tokens), not a strawman. Treatments are studio only.
 */

import { useState } from "react";
import { ChevronDown, Command, MessageSquare, Mic, Plus, Sparkles } from "lucide-react";
import { AgentPresenceDot } from "@/components/AgentPresenceDot";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { MessageComposer, MessageComposerSelect } from "@/components/MessageComposer";

/* ── Fixture ──────────────────────────────────────────────────────────── */

const DISPATCH = {
  ref: "disp_8f2c41a9",
  state: "delivery failed",
  from: "orion-broker-repair",
  channel: "direct",
  latency: "12.4s",
  sent: "14:02:11",
  failed: "14:02:23",
  attempts: 4,
};

const PROJECTS = [
  { value: "", label: "Any project" },
  { value: "/Users/art/dev/openscout-staging", label: "openscout-staging" },
  {
    value: "/Users/art/dev/openscout-worktrees/terminal-durable-workspaces",
    label: "terminal-durable-workspaces",
  },
  { value: "/Users/art/dev/hudson", label: "arach/hudson" },
];

const AGENTS = [
  {
    value: "openscout-staging-hypatia-2",
    label: "openscout-staging-hypatia-2",
    model: "claude-opus-4-6",
  },
  { value: "codex.studio-craft-pass", label: "codex.studio-craft-pass", model: "gpt-5.2-codex" },
  { value: "orion-broker-repair", label: "orion-broker-repair", model: "claude-sonnet-4-6" },
  { value: "scout", label: "Scout", model: "claude-sonnet-4-6" },
];

const MODELS = [
  { value: "claude-opus-4-6", label: "claude-opus-4-6" },
  { value: "gpt-5.2-codex", label: "gpt-5.2-codex" },
  { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
];

const EFFORTS = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
];

/** Failure-path prompts — BrokerScreen.tsx:1061. */
const PROMPTS = ["Get a second opinion", "Propose a recovery plan", "Draft a follow-up"];

const DEFAULTS = {
  project: "/Users/art/dev/openscout-staging",
  agent: "openscout-staging-hypatia-2",
  model: "claude-opus-4-6",
  effort: "medium",
};

const WIDE = 520;
const NARROW = 380;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Renders the MessageComposer atom flush inside the inspector: the Instrument
 * idiom rules with hairlines and has no cards, and production already does the
 * same thing (`.sys-broker-forward .sys-broker-message-composer { border: 0;
 * border-radius: 0; background: transparent }`). Structure and behaviour stay
 * the atom's — only its standalone card chrome is dropped.
 */
const FLUSH_COMPOSER = cx(
  "!p-0",
  "[&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-b-0 [&>div]:bg-transparent",
  "[&_.canvas-tint]:bg-transparent",
);

/* ── Shared bits ──────────────────────────────────────────────────────── */

/** Panel heading. The single accent on each panel is the live presence dot. */
function AskHeading({ note }: { note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-2.5">
      <EyebrowLabel as="h3">Ask another agent</EyebrowLabel>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
        {note ?? "target working"}
        <AgentPresenceDot state="working" size="sm" />
      </span>
    </div>
  );
}

function PromptChips({ compact }: { compact?: boolean }) {
  return (
    <div className={cx("flex flex-wrap gap-1.5", compact ? "px-0" : "px-3 pb-2")}>
      {PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-studio-edge px-[9px] py-[5px] font-sans text-[10px] text-studio-ink-muted transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
        >
          <Sparkles size={11} aria-hidden />
          {prompt}
        </button>
      ))}
    </div>
  );
}

/** `+ dispatch context` marker — passive, never a control. */
function ContextMarker() {
  return (
    <span
      title={DISPATCH.ref}
      className="inline-flex min-w-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint"
    >
      <Plus size={9} strokeWidth={2.5} aria-hidden />
      <span className="truncate">dispatch context</span>
    </span>
  );
}

/* ── The inspector frame every panel is measured inside ───────────────── */

function InspectorFrame({
  width,
  caption,
  children,
}: {
  width: number;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
          {width}px
        </span>
        <span className="font-mono text-[9px] text-studio-ink-faint">{caption}</span>
      </div>
      <div
        style={{ width }}
        className="flex flex-col overflow-hidden rounded-[10px] border border-studio-edge bg-studio-surface"
      >
        {/* Enough of what sits above the ask module for the rhythm to read. */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-studio-ink-muted" aria-hidden />
          <strong className="font-sans text-[11px] font-medium text-studio-ink">
            {DISPATCH.state}
          </strong>
          <code className="truncate font-mono text-[10px] text-studio-ink-faint">
            {DISPATCH.ref}
          </code>
        </div>
        <dl className="grid grid-cols-4 gap-x-2 border-t border-studio-edge px-3 py-2">
          {[
            ["Channel", DISPATCH.channel],
            ["Latency", DISPATCH.latency],
            ["Sent", DISPATCH.sent],
            ["Failed", DISPATCH.failed],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-studio-ink-faint">
                {label}
              </dt>
              <dd className="truncate font-mono text-[10px] text-studio-ink-muted">{value}</dd>
            </div>
          ))}
        </dl>

        {children}

        {/* Ambient row that sits under the panel in the real inspector. */}
        <div className="flex items-center gap-1.5 border-t border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
          <Command size={9} aria-hidden />
          Command palette
          <span className="ml-auto normal-case tracking-normal">⌘K</span>
        </div>
      </div>
    </div>
  );
}

function TreatmentRow({
  children,
}: {
  children: (width: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <InspectorFrame width={WIDE} caption="default inspector">
        {children(WIDE)}
      </InspectorFrame>
      <InspectorFrame width={NARROW} caption="narrow">
        {children(NARROW)}
      </InspectorFrame>
    </div>
  );
}

/* ── Baseline — faithful reproduction of what ships today ─────────────── */

/**
 * Production select: no border, mono 9px, clamped and ellipsized. The clamps
 * are the shipped values (`system-surfaces-redesign.css:1512-1515`).
 */
function BaselineSelect({
  label,
  clamp,
  options,
  value,
  onChange,
  strong,
}: {
  label: string;
  clamp: number;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (next: string) => void;
  strong?: boolean;
}) {
  return (
    <label className="relative inline-flex min-w-0 shrink items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ maxWidth: clamp }}
        className={cx(
          "h-7 min-w-0 appearance-none truncate border-0 bg-transparent pl-0.5 pr-3.5",
          "font-mono text-[9px] outline-none",
          strong ? "text-studio-ink" : "text-studio-ink-muted",
        )}
      >
        {options.map((option) => (
          <option key={option.value || "__any__"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={8}
        className="pointer-events-none absolute right-0 shrink-0 text-studio-ink-faint"
        aria-hidden
      />
    </label>
  );
}

function BaselinePanel() {
  const [draft, setDraft] = useState("");
  const [project, setProject] = useState(DEFAULTS.project);
  const [agent, setAgent] = useState(DEFAULTS.agent);
  const [model, setModel] = useState(DEFAULTS.model);
  const [effort, setEffort] = useState(DEFAULTS.effort);
  const accentRule = { borderColor: "color-mix(in oklab, var(--scout-accent) 42%, transparent)" };

  return (
    <section className="border-t border-studio-edge">
      <div className="flex flex-col gap-2 px-3 pb-2 pt-3">
        <div className="flex items-start gap-2">
          <span className="mt-[3px] shrink-0 text-studio-ink-faint" aria-hidden>
            <MessageSquare size={12} />
          </span>
          <div className="min-w-0">
            <span className="block font-sans text-[12px] text-studio-ink">Ask another agent</span>
            <small className="block font-sans text-[11px] leading-snug text-studio-ink-faint">
              Send a custom request with the full dispatch context attached.
            </small>
          </div>
        </div>
        <PromptChips compact />
      </div>

      {/* Accent hairline top and bottom — the focused state the panel was
          reviewed in, and two thirds of the accent this panel spends. */}
      <div className="border-t" style={accentRule}>
        <label
          htmlFor={`baseline-request-${DISPATCH.ref}`}
          className="block px-3 pt-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink-faint"
        >
          Request
        </label>
        <textarea
          id={`baseline-request-${DISPATCH.ref}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What should openscout-staging-hypatia-2 investigate or do?"
          className="block h-[76px] w-full resize-none border-0 bg-transparent px-3 pb-2 pt-1 font-sans text-[11px] leading-normal text-studio-ink outline-none placeholder:text-studio-ink-faint"
        />
        <div className="border-t" style={accentRule} />
        <footer className="flex min-h-10 items-center gap-1.5 px-3 py-2">
          <div className="flex min-w-0 shrink items-center gap-1.5">
            <button
              type="button"
              aria-label="Attach files"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-studio-edge text-studio-ink-muted"
            >
              <Plus size={16} aria-hidden />
            </button>
            <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-muted">
              Dispatch context included
            </span>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
              Send to
            </span>
            <BaselineSelect
              label="Project target"
              clamp={70}
              options={PROJECTS}
              value={project}
              onChange={setProject}
            />
            <BaselineSelect
              label="Agent target"
              clamp={68}
              strong
              options={AGENTS}
              value={agent}
              onChange={setAgent}
            />
            <BaselineSelect
              label="Model target"
              clamp={82}
              options={MODELS}
              value={model}
              onChange={setModel}
            />
            <BaselineSelect
              label="Reasoning effort"
              clamp={66}
              options={EFFORTS}
              value={effort}
              onChange={setEffort}
            />
            <button
              type="button"
              aria-label="Dictate"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-studio-edge text-studio-ink-muted"
            >
              <Mic size={13} aria-hidden />
            </button>
          </div>

          <button
            type="button"
            aria-label="Send"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-studio-canvas"
            style={{ background: "var(--scout-accent)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 12h16M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </footer>
      </div>
    </section>
  );
}

/* ── A · Routing owns the toolbar line ────────────────────────────────── */

function TreatmentA() {
  const [draft, setDraft] = useState("");
  const [project, setProject] = useState(DEFAULTS.project);
  const [agent, setAgent] = useState(DEFAULTS.agent);
  const [model, setModel] = useState(DEFAULTS.model);
  const [effort, setEffort] = useState(DEFAULTS.effort);
  const agentLabel = AGENTS.find((item) => item.value === agent)?.label ?? agent;

  return (
    <section className="border-t border-studio-edge">
      <AskHeading />
      <PromptChips />
      <MessageComposer
        value={draft}
        onChange={setDraft}
        rows={3}
        density="compact"
        placeholder={`What should ${agentLabel} investigate or do?`}
        showAttach
        className={FLUSH_COMPOSER}
        header={
          // The two settings you set once — project (derived from the agent in
          // production) and effort — ride the line that already exists.
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <MessageComposerSelect
              label="Project target"
              value={project}
              onChange={setProject}
              options={PROJECTS}
              size="sm"
            />
            <MessageComposerSelect
              label="Reasoning effort"
              value={effort}
              onChange={setEffort}
              options={EFFORTS}
              size="sm"
            />
            <ContextMarker />
          </div>
        }
        tools={
          // The two you actually choose per send own the toolbar, with room to
          // spell the longest agent id out.
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 [&>label]:max-w-[240px]">
            <MessageComposerSelect
              label="Agent target"
              value={agent}
              onChange={(next) => {
                setAgent(next);
                const picked = AGENTS.find((item) => item.value === next);
                if (picked) setModel(picked.model);
              }}
              options={AGENTS}
            />
            <MessageComposerSelect
              label="Model target"
              value={model}
              onChange={setModel}
              options={MODELS}
            />
          </div>
        }
      />
    </section>
  );
}

/* ── B · One readout, routing on demand ───────────────────────────────── */

/** Instrument stat row whose value happens to be editable. */
function RoutingStatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-studio-edge py-1 first:border-t-0">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TreatmentB({ narrow, startOpen }: { narrow: boolean; startOpen?: boolean }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(Boolean(startOpen));
  const [project, setProject] = useState(DEFAULTS.project);
  const [agent, setAgent] = useState(DEFAULTS.agent);
  const [model, setModel] = useState(DEFAULTS.model);
  const [effort, setEffort] = useState(DEFAULTS.effort);
  const agentLabel = AGENTS.find((item) => item.value === agent)?.label ?? agent;

  return (
    <section className="border-t border-studio-edge">
      <AskHeading />
      <PromptChips />
      <MessageComposer
        value={draft}
        onChange={setDraft}
        rows={3}
        density="compact"
        placeholder={`What should ${agentLabel} investigate or do?`}
        showAttach
        className={FLUSH_COMPOSER}
        header={
          <div className="space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className="focus-ring ink-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors"
              >
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
                  to
                </span>
                <span className="min-w-0 font-mono text-[11px] text-studio-ink">{agentLabel}</span>
                {/* At 380 the resting readout keeps the identity and sheds the
                    model rather than ellipsizing the agent id. */}
                {narrow ? null : (
                  <span className="shrink-0 font-mono text-[11px] text-studio-ink-faint">
                    · {model}
                  </span>
                )}
                <ChevronDown
                  size={10}
                  strokeWidth={2}
                  aria-hidden
                  className={cx(
                    "shrink-0 text-studio-ink-faint transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open ? null : <ContextMarker />}
            </div>

            {open ? (
              <div className="pb-0.5">
                <RoutingStatRow label="Project">
                  <MessageComposerSelect
                    label="Project target"
                    value={project}
                    onChange={setProject}
                    options={PROJECTS}
                    size="sm"
                  />
                </RoutingStatRow>
                <RoutingStatRow label="Agent">
                  <MessageComposerSelect
                    label="Agent target"
                    value={agent}
                    onChange={(next) => {
                      setAgent(next);
                      const picked = AGENTS.find((item) => item.value === next);
                      if (picked) setModel(picked.model);
                    }}
                    options={AGENTS}
                    size="sm"
                  />
                </RoutingStatRow>
                <RoutingStatRow label="Model">
                  <MessageComposerSelect
                    label="Model target"
                    value={model}
                    onChange={setModel}
                    options={MODELS}
                    size="sm"
                  />
                </RoutingStatRow>
                <RoutingStatRow label="Effort">
                  <MessageComposerSelect
                    label="Reasoning effort"
                    value={effort}
                    onChange={setEffort}
                    options={EFFORTS}
                    size="sm"
                  />
                </RoutingStatRow>
              </div>
            ) : null}
          </div>
        }
      />
    </section>
  );
}

/* ── C · Routing first, chips only while the draft is cold ────────────── */

function TreatmentC({ narrow }: { narrow: boolean }) {
  const [draft, setDraft] = useState("");
  const [project, setProject] = useState(DEFAULTS.project);
  const [agent, setAgent] = useState(DEFAULTS.agent);
  const [model, setModel] = useState(DEFAULTS.model);
  const [effort, setEffort] = useState(DEFAULTS.effort);
  const agentLabel = AGENTS.find((item) => item.value === agent)?.label ?? agent;

  const cell = (label: string, control: React.ReactNode) => (
    <div className="min-w-0">
      <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
        {label}
      </div>
      <div className="-ml-2.5 mt-px min-w-0 [&>label]:max-w-full">{control}</div>
    </div>
  );

  return (
    <section className="border-t border-studio-edge">
      <AskHeading note={`${DISPATCH.attempts} attempts · working`} />

      {/* Routing reads as an instrument band above the request: who before
          what. Nothing here is allowed to clip, so the band grows a row
          instead — two columns at 520, a four-row stack at 380. */}
      <div
        className={cx(
          "grid gap-x-3 gap-y-1.5 border-b border-studio-edge px-3 pb-2 pt-1",
          narrow ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {cell(
          "Project",
          <MessageComposerSelect
            label="Project target"
            value={project}
            onChange={setProject}
            options={PROJECTS}
            size="sm"
          />,
        )}
        {cell(
          "Agent",
          <MessageComposerSelect
            label="Agent target"
            value={agent}
            onChange={(next) => {
              setAgent(next);
              const picked = AGENTS.find((item) => item.value === next);
              if (picked) setModel(picked.model);
            }}
            options={AGENTS}
            size="sm"
          />,
        )}
        {cell(
          "Model",
          <MessageComposerSelect
            label="Model target"
            value={model}
            onChange={setModel}
            options={MODELS}
            size="sm"
          />,
        )}
        {cell(
          "Effort",
          <MessageComposerSelect
            label="Reasoning effort"
            value={effort}
            onChange={setEffort}
            options={EFFORTS}
            size="sm"
          />,
        )}
      </div>

      <MessageComposer
        value={draft}
        onChange={setDraft}
        rows={3}
        density="compact"
        placeholder={`Ask ${agentLabel} about ${DISPATCH.ref}…`}
        showAttach
        className={FLUSH_COMPOSER}
        // The chips are a cold-start aid. Once there is a draft they have
        // nothing left to offer, so they leave.
        header={draft.trim() ? undefined : <PromptChips compact />}
        tools={
          <span className="shrink-0 px-1">
            <ContextMarker />
          </span>
        }
      />
    </section>
  );
}

/* ── Notes ────────────────────────────────────────────────────────────── */

const NOTES: Array<{ id: string; title: string; costs: string; buys: string }> = [
  {
    id: "Baseline",
    title: "As it ships",
    costs:
      "Six controls plus two labels share one 263px row, so every routing value ellipsizes and none of the four selects is a reliable target.",
    buys: "One row of height, and nothing else. The accent is spent three times — two hairlines and the Send fill — on no live signal at all.",
  },
  {
    id: "A",
    title: "Routing owns the toolbar line",
    costs:
      "Routing is split across two lines, not given one: project and effort are demoted to the context line, and at 380px the remaining pair still wraps below the attach button.",
    buys:
      "Dropping the redundant `SEND TO` label and clearing the context marker off the toolbar leaves ~420px for ~360px of chips, so the longest agent id and the full model name both read at 520px. No new interaction to learn.",
  },
  {
    id: "B",
    title: "One readout, routing on demand",
    costs:
      "Project and effort are invisible at rest and changing either is a click away — wrong if you re-route on most sends. At 380px the readout sheds the model to keep the agent id whole.",
    buys:
      "At rest the composer is a field plus one line that names the target. Expanded, routing is four labelled stat rows — a full line per value, so nothing truncates at any width.",
  },
  {
    id: "C",
    title: "Routing first, chips while cold",
    costs:
      "Routing takes a permanent band even on the many sends that never change it — ~68px at 520 and ~120px at 380 — and the panel no longer opens on the request field.",
    buys:
      "The panel reads who → what → send, and no routing value is ever clipped: the band grows a row instead (two columns at 520, a four-row stack at 380). The prompt chips leave once you have a draft.",
  },
];

/* ── Study ────────────────────────────────────────────────────────────── */

export function DispatchAskComposerStudy() {
  return (
    <div className="space-y-10">
      {/* What the controls actually are, from the source. */}
      <div className="grid gap-3 border-y border-studio-edge py-4 font-mono text-[11px] text-studio-ink-faint sm:grid-cols-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            The four selects
          </div>
          <div className="mt-1 leading-relaxed">
            project · agent · model · effort. Agent is filtered by project; model is the union of
            that project&apos;s agents&apos; models; effort is low·medium·high·xhigh.
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            The measurement
          </div>
          <div className="mt-1 leading-relaxed">
            ~391px of routing content in a ~263px group at the 520px inspector. Shipped CSS clamps
            the selects to 70/68/82/66px and hides the overflow.
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            Accent rule
          </div>
          <div className="mt-1 leading-relaxed">
            One emerald per panel, on a live signal. Treatments move it off the Send button and the
            focus hairlines and onto the target agent&apos;s presence.
          </div>
        </div>
      </div>

      <section id="baseline" className="scroll-mt-6 space-y-3">
        <div className="max-w-prose">
          <EyebrowLabel as="h2">Baseline · as it ships</EyebrowLabel>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            Faithful reproduction of the shipped module, drawn with studio tokens: same control
            inventory, same clamps, same accent spend. Open the selects — they work; you just
            cannot read them.
          </p>
        </div>
        <TreatmentRow>{() => <BaselinePanel />}</TreatmentRow>
      </section>

      <section id="treatment-a" className="scroll-mt-6 space-y-3">
        <div className="max-w-prose">
          <EyebrowLabel as="h2">A · Routing owns the toolbar line</EyebrowLabel>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            The smallest honest fix. <strong className="font-medium text-studio-ink">Send to</strong>{" "}
            goes — the chips sit next to Send, so the direction is already obvious — and the
            explainer is deleted because the placeholder names the agent. The two settings you set
            once (project · effort) join the context marker on the line above; the two you choose
            per send (agent · model) own the toolbar and finally have room to spell out.
          </p>
        </div>
        <TreatmentRow>{() => <TreatmentA />}</TreatmentRow>
      </section>

      <section id="treatment-b" className="scroll-mt-6 space-y-3">
        <div className="max-w-prose">
          <EyebrowLabel as="h2">B · One readout, routing on demand</EyebrowLabel>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            Routing collapses to a single readout — <code className="font-mono">to …hypatia-2 ·
            claude-opus-4-6</code> — and the composer keeps a field and one line. Click the readout
            and routing unfolds as labelled stat rows; the values get a full line each and never
            truncate.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <InspectorFrame width={WIDE} caption="default inspector · at rest">
            <TreatmentB narrow={false} />
          </InspectorFrame>
          <InspectorFrame width={NARROW} caption="narrow · at rest">
            <TreatmentB narrow />
          </InspectorFrame>
          <InspectorFrame width={WIDE} caption="default inspector · routing open">
            <TreatmentB narrow={false} startOpen />
          </InspectorFrame>
        </div>
      </section>

      <section id="treatment-c" className="scroll-mt-6 space-y-3">
        <div className="max-w-prose">
          <EyebrowLabel as="h2">C · Routing first, chips while cold</EyebrowLabel>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            The vertical rhythm re-cut. Routing becomes an instrument band at the top — who before
            what — the request body is the panel&apos;s centre, and the prompt chips stop paying
            rent once you have typed anything. Two columns at 520px; at 380px the band stacks to
            four rows rather than clipping a single value.
          </p>
        </div>
        <TreatmentRow>{(width) => <TreatmentC narrow={width === NARROW} />}</TreatmentRow>
      </section>

      <section className="border-t border-studio-edge pt-6">
        <EyebrowLabel as="h2" className="mb-3">
          Design notes
        </EyebrowLabel>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {NOTES.map((note) => (
            <div key={note.id} className="min-w-0">
              <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink">
                {note.id} · {note.title}
              </div>
              <dl className="mt-2 space-y-2 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-muted">
                    Costs
                  </dt>
                  <dd className="mt-0.5">{note.costs}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-muted">
                    Buys
                  </dt>
                  <dd className="mt-0.5">{note.buys}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
