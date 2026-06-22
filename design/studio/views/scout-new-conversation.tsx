"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import styles from "./scout-new-conversation.module.css";

/**
 * Scout — New Conversation modal.
 *
 * The implementation spec for the native `ScoutSessionComposer` sheet. The
 * shipping modal already uses the token system but reads stacked-and-boxy:
 * a plain header, two tall 48pt picker fields, and a message well with an
 * accent left-bar (which violates the no-left-bar-on-rounded rule). This study
 * rebuilds it in the shell token language:
 *
 *  - a refined header — accent mark + title + sub-identity + close;
 *  - a Project / Agent target. The Agent picker is the centrepiece: a
 *    type-to-filter combobox that lists your real agents grouped by project
 *    (project first → agent → model, harness inferred), with ghost-complete +
 *    ↑↓/⏎/⇥ keys and a Create "<name>" row when nothing matches. It meets four
 *    criteria — search, select harness, select model, create;
 *  - first-class Harness + Model selectors (linked: harness scopes the model
 *    list, model implies the harness) instead of a buried Options disclosure;
 *  - a Fresh / Continue toggle;
 *  - a consolidated two-zone message box (input top, toolbar bottom: Cancel ·
 *    ⌘↵ guide · mic · send) mirroring the conversation-stream composer — no
 *    left bar, no separate footer.
 *
 * Ports to apps/macos/Sources/Scout/ScoutSessionService.swift.
 */

type Target = "project" | "agent";
type Mode = "fresh" | "continue";

type AgentState = "live" | "idle" | "away";
type Agent = { name: string; model: string; project: string; state: AgentState };

const STATE_TINT: Record<AgentState, string> = {
  live: "var(--s-ok)",
  idle: "var(--s-dim)",
  away: "var(--s-warn)",
};

// A realistic multi-project roster — the picker is meant to scale to ~20 agents,
// so the dropdown groups them by project (project first), then agent, then the
// model (the harness is inferred from the model, so it isn't shown separately).
const AGENTS: Agent[] = [
  { name: "claude", model: "opus-4.8", project: "openscout", state: "live" },
  { name: "codex", model: "gpt-5.2", project: "openscout", state: "idle" },
  { name: "scout", model: "sonnet-4.6", project: "openscout", state: "live" },
  { name: "hudson", model: "opus-4.8", project: "hudson", state: "live" },
  { name: "kit", model: "haiku-4.5", project: "hudson", state: "idle" },
  { name: "talkie", model: "sonnet-4.6", project: "talkie", state: "away" },
  { name: "whisper", model: "gpt-5.2", project: "talkie", state: "idle" },
  { name: "premotion", model: "opus-4.8", project: "premotion", state: "idle" },
  { name: "reel", model: "sonnet-4.6", project: "premotion", state: "live" },
  { name: "lattices", model: "haiku-4.5", project: "lattices", state: "idle" },
  { name: "solver", model: "opus-4.8", project: "lattices", state: "idle" },
  { name: "studio", model: "sonnet-4.6", project: "studio", state: "live" },
  { name: "porter", model: "haiku-4.5", project: "studio", state: "idle" },
  { name: "muse", model: "opus-4.8", project: "studio", state: "away" },
];

// Harness → models. A model implies its harness (so the dropdown rows show only
// the model), but both are selectable here — pick a harness to scope the model
// list, or pick a model and the harness follows.
type Harness = { id: string; label: string; models: string[] };
const HARNESSES: Harness[] = [
  { id: "claude", label: "Claude", models: ["opus-4.8", "sonnet-4.6", "haiku-4.5"] },
  { id: "codex", label: "Codex", models: ["gpt-5.2", "gpt-5.1"] },
  { id: "gemini", label: "Gemini", models: ["gemini-3-pro", "gemini-3-flash"] },
];

function harnessForModel(model: string): string {
  return HARNESSES.find((h) => h.models.includes(model))?.id ?? "claude";
}

export default function ScoutNewConversationStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-new-conversation"
      title="Scout · New Conversation"
      blurb={
        <>
          The native &ldquo;New conversation&rdquo; modal, rebuilt in the shell
          token language. The Agent picker is a type-to-filter combobox over your
          real agents grouped by project (<code>project → agent → model</code>),
          meeting four criteria — <strong>search, select harness, select model,
          create</strong> — backed by first-class Harness + Model selectors and a
          consolidated two-zone message box (no left bar, no separate footer).
          Flip the target to see the Project layout. Ports to{" "}
          <code>ScoutSessionComposer</code>.
        </>
      }
    >
      <Stage />
    </ScoutStudyShell>
  );
}

function Stage() {
  const [target, setTarget] = useState<Target>("agent");
  const [mode, setMode] = useState<Mode>("fresh");
  const [agent, setAgent] = useState<Agent | null>(AGENTS[0]);
  const [model, setModel] = useState("opus-4.8");
  const [harness, setHarness] = useState("claude");
  const isAgent = target === "agent";
  const agentName = agent?.name ?? "the agent";

  // Picking an existing agent fills its model + harness (still overridable).
  function selectAgent(a: Agent) {
    setAgent(a);
    setModel(a.model);
    setHarness(harnessForModel(a.model));
  }
  // Creating a new agent keeps whatever model + harness are currently set.
  function createAgent(name: string) {
    setAgent({ name, model, project: "new", state: "idle" });
  }

  const subtitle = isAgent
    ? mode === "continue"
      ? `Continue ${agentName} with full context`
      : `New conversation with ${agentName}`
    : "Start a new conversation in a project";

  return (
    <div className={styles.stage}>
      <div className={styles.backdrop} aria-hidden>
        <div className={styles.ghostRail} />
        <div className={styles.ghostBody}>
          <div className={styles.ghostList} />
          <div className={styles.ghostThread} />
        </div>
      </div>
      <div className={styles.scrim} aria-hidden />

      <div className={styles.modal} role="dialog" aria-label="New conversation">
        {/* Header */}
        <div className={styles.head}>
          <span className={styles.headMark}>
            <PlusBubbleGlyph />
          </span>
          <div className={styles.headText}>
            <div className={styles.title}>New conversation</div>
            <div className={styles.subtitle}>{subtitle}</div>
          </div>
          <button className={styles.closeBtn} aria-label="Close">
            <CloseGlyph />
          </button>
        </div>

        <div className={styles.sep} />

        {/* Target */}
        <section className={styles.section}>
          <div className={styles.label}>Target</div>
          <div className={styles.seg} role="tablist">
            <button
              role="tab"
              aria-selected={!isAgent}
              className={!isAgent ? styles.segOn : styles.segOff}
              onClick={() => setTarget("project")}
            >
              <FolderGlyph /> Project
            </button>
            <button
              role="tab"
              aria-selected={isAgent}
              className={isAgent ? styles.segOn : styles.segOff}
              onClick={() => setTarget("agent")}
            >
              <PersonGlyph /> Agent
            </button>
          </div>

          {isAgent ? (
            <>
              {/* Search existing agents — or create a new one */}
              <AgentCombobox
                selected={agent}
                model={model}
                harness={harness}
                onSelect={selectAgent}
                onCreate={createAgent}
              />

              {/* Model + harness — first-class selectors, not buried in Options */}
              <HarnessModelRow
                harness={harness}
                model={model}
                setHarness={setHarness}
                setModel={setModel}
              />

              {/* Fresh / Continue */}
              <div className={styles.seg}>
                <button
                  className={mode === "fresh" ? styles.segOn : styles.segOff}
                  onClick={() => setMode("fresh")}
                >
                  <SparkGlyph /> Fresh start
                </button>
                <button
                  className={mode === "continue" ? styles.segOn : styles.segOff}
                  onClick={() => setMode("continue")}
                >
                  <ResumeGlyph /> Continue
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.field}>
                <span className={styles.fieldIcon}>
                  <FolderGlyph />
                </span>
                <div className={styles.fieldText}>
                  <div className={styles.fieldTitle}>openscout</div>
                  <div className={styles.fieldDetail}>~/dev/openscout</div>
                </div>
                <span className={styles.spacer} />
                <span className={styles.chev}>
                  <ChevronGlyph />
                </span>
              </div>
              <HarnessModelRow
                harness={harness}
                model={model}
                setHarness={setHarness}
                setModel={setModel}
              />
            </>
          )}
        </section>

        {/* Message — consolidated two-zone box (input top / toolbar bottom),
            mirroring the conversation-stream composer. Cancel · guide · mic ·
            send all live in the bottom bar, so there's no separate footer. */}
        <section className={styles.section}>
          <div className={styles.label}>
            {mode === "continue" ? "Follow-up message" : "First message"}
          </div>
          <div className={`${styles.box} ${styles.boxFocus}`}>
            <div className={styles.boxField}>
              {isAgent
                ? `What should ${agentName} start on?`
                : "What should the new agent start on?"}
            </div>
            <div className={styles.boxBar}>
              <button className={styles.barCancel}>Cancel</button>
              <span className={styles.spacer} />
              <span className={styles.barHint}>
                <kbd>⌘↵</kbd> to start
              </span>
              <button className={styles.barIcon} aria-label="Dictate">
                <MicGlyph />
              </button>
              <button className={styles.barSend} aria-label="Start conversation">
                <ArrowUpGlyph />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Agent combobox — type-to-filter + suggest + dropdown ─────────────── */

function highlight(name: string, q: string): ReactNode {
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q);
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <strong className={styles.comboHi}>{name.slice(i, i + q.length)}</strong>
      {name.slice(i + q.length)}
    </>
  );
}

function AgentCombobox({
  selected,
  model,
  harness,
  onSelect,
  onCreate,
}: {
  selected: Agent | null;
  model: string;
  harness: string;
  onSelect: (a: Agent) => void;
  onCreate: (name: string) => void;
}) {
  // Default to the open + empty roster — the "start typing to filter your agents"
  // discovery state, grouped by project.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? AGENTS.filter(
        (a) => a.name.toLowerCase().includes(q) || a.project.toLowerCase().includes(q),
      )
    : AGENTS;

  // Group the matches by project (project first), preserving first-seen order.
  const groups: { project: string; agents: Agent[] }[] = [];
  for (const a of filtered) {
    let g = groups.find((g) => g.project === a.project);
    if (!g) {
      g = { project: a.project, agents: [] };
      groups.push(g);
    }
    g.agents.push(a);
  }
  const flat = groups.flatMap((g) => g.agents); // render order = keyboard order
  const top = flat[0];
  const ghost = q && top && top.name.toLowerCase().startsWith(q) ? top.name.slice(query.length) : "";
  const exact = AGENTS.some((a) => a.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exact; // offer "Create" when no exact match
  const createIndex = flat.length; // the create row sits just past the agents
  const maxIndex = flat.length - 1 + (canCreate ? 1 : 0);
  const dotState = (selected ?? top)?.state ?? "idle";

  function choose(a: Agent) {
    onSelect(a);
    setQuery("");
    setOpen(false);
  }
  function create() {
    if (!query.trim()) return;
    onCreate(query.trim());
    setQuery("");
    setOpen(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, maxIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (hi < flat.length && flat[hi]) {
        e.preventDefault();
        choose(flat[hi]);
      } else if (canCreate) {
        e.preventDefault();
        create();
      }
    } else if ((e.key === "Tab" || e.key === "ArrowRight") && ghost && top) {
      e.preventDefault();
      choose(top);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // When closed with a selection and nothing typed, the input shows the agent
  // name as its value so the field reads as the current pick.
  const inputValue = !open && selected && !query ? selected.name : query;
  let flatIndex = -1;

  return (
    <div className={styles.combo}>
      <div className={`${styles.comboField} ${open ? styles.comboFieldOpen : ""}`}>
        <span className={styles.stateDot} style={{ background: STATE_TINT[dotState] }} />
        <div className={styles.comboInputWrap}>
          {ghost && open && (
            <div className={styles.comboGhost} aria-hidden>
              <span className={styles.comboGhostTyped}>{query}</span>
              {ghost}
            </div>
          )}
          <input
            className={styles.comboInput}
            value={inputValue}
            placeholder={selected ? "Search agents…" : "Search or create an agent…"}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHi(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            spellCheck={false}
          />
        </div>
        {ghost && open ? (
          <span className={styles.comboTab}>⇥</span>
        ) : selected && !open ? (
          // project first, model (harness inferred) second
          <span className={styles.comboMeta}>
            {selected.project} · {model}
          </span>
        ) : null}
        <button
          className={`${styles.comboCaret} ${open ? styles.comboCaretOpen : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle agent list"
        >
          <ChevronGlyph />
        </button>
      </div>

      {open && (
        <div className={styles.comboMenu} role="listbox">
          {flat.length === 0 && !canCreate ? (
            <div className={styles.comboEmpty}>No agents match “{query}”</div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.project} className={styles.comboGroup}>
                  <div className={styles.comboGroupLabel}>
                    <span className={styles.tokDot} />
                    {g.project}
                    <span className={styles.comboGroupCount}>{g.agents.length}</span>
                  </div>
                  {g.agents.map((a) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isSel =
                      selected?.name === a.name && selected?.project === a.project;
                    return (
                      <button
                        key={`${a.project}/${a.name}`}
                        role="option"
                        aria-selected={idx === hi}
                        className={`${styles.comboRow} ${idx === hi ? styles.comboRowActive : ""}`}
                        onMouseEnter={() => setHi(idx)}
                        onClick={() => choose(a)}
                      >
                        <span
                          className={styles.stateDot}
                          style={{ background: STATE_TINT[a.state] }}
                        />
                        <span className={styles.comboName}>{highlight(a.name, q)}</span>
                        <span className={styles.comboRowMeta}>{a.model}</span>
                        <span className={styles.spacer} />
                        {isSel && (
                          <span className={styles.comboCheck}>
                            <CheckGlyph />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {canCreate && (
                <button
                  role="option"
                  aria-selected={hi === createIndex}
                  className={`${styles.comboCreate} ${hi === createIndex ? styles.comboCreateActive : ""}`}
                  onMouseEnter={() => setHi(createIndex)}
                  onClick={create}
                >
                  <span className={styles.comboCreateIcon}>
                    <PlusGlyph />
                  </span>
                  <span className={styles.comboCreateText}>
                    Create <strong>&ldquo;{query.trim()}&rdquo;</strong>
                  </span>
                  <span className={styles.spacer} />
                  <span className={styles.comboRowMeta}>
                    {model} · {harness}
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Harness + model selectors (first-class, linked) ──────────────────── */

function HarnessModelRow({
  harness,
  model,
  setHarness,
  setModel,
}: {
  harness: string;
  model: string;
  setHarness: (id: string) => void;
  setModel: (m: string) => void;
}) {
  const [openH, setOpenH] = useState(false);
  const [openM, setOpenM] = useState(false);
  const h = HARNESSES.find((x) => x.id === harness) ?? HARNESSES[0];

  function pickHarness(id: string) {
    setHarness(id);
    const nh = HARNESSES.find((x) => x.id === id) ?? HARNESSES[0];
    if (!nh.models.includes(model)) setModel(nh.models[0]); // keep the pair valid
    setOpenH(false);
  }
  function pickModel(m: string) {
    setModel(m);
    setHarness(harnessForModel(m)); // model implies harness
    setOpenM(false);
  }

  return (
    <div className={styles.configRow}>
      {/* Model — primary; lists every model grouped by harness, picking one
          sets the harness too (the harness is inferred from the model). */}
      <div className={styles.configChip}>
        <button
          className={`${styles.configField} ${openM ? styles.configFieldOpen : ""}`}
          onClick={() => {
            setOpenM((o) => !o);
            setOpenH(false);
          }}
        >
          <span className={styles.configKey}>Model</span>
          <span className={styles.configVal}>
            {model}
            <ChevronGlyph />
          </span>
        </button>
        {openM && (
          <div className={styles.configMenu} role="listbox">
            {HARNESSES.map((x) => (
              <div key={x.id} className={styles.configGroup}>
                <div className={styles.configGroupLabel}>{x.label}</div>
                {x.models.map((m) => (
                  <button
                    key={m}
                    className={`${styles.configOption} ${m === model ? styles.configOptionActive : ""}`}
                    onClick={() => pickModel(m)}
                  >
                    {m}
                    {m === model && (
                      <>
                        <span className={styles.spacer} />
                        <span className={styles.comboCheck}>
                          <CheckGlyph />
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Harness — secondary override; scopes the model list */}
      <div className={styles.configChip}>
        <button
          className={`${styles.configField} ${openH ? styles.configFieldOpen : ""}`}
          onClick={() => {
            setOpenH((o) => !o);
            setOpenM(false);
          }}
        >
          <span className={styles.configKey}>Harness</span>
          <span className={styles.configVal}>
            <span className={styles.harnessDot} />
            {h.label}
            <ChevronGlyph />
          </span>
        </button>
        {openH && (
          <div className={styles.configMenu} role="listbox">
            {HARNESSES.map((x) => (
              <button
                key={x.id}
                className={`${styles.configOption} ${x.id === harness ? styles.configOptionActive : ""}`}
                onClick={() => pickHarness(x.id)}
              >
                <span className={styles.harnessDot} />
                {x.label}
                <span className={styles.spacer} />
                <span className={styles.configOptionDim}>{x.models.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Glyphs ─────────────────────────────────────────────────────────── */

function PlusBubbleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
      <path d="M12 8v6M9 11h6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </svg>
  );
}

function ResumeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12a8 8 0 1 1 2.3 5.6" />
      <path d="M4 19v-4h4" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function ArrowUpGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
