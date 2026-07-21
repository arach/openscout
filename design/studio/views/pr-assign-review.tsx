"use client";

/**
 * Studio study: Assign for review — really a MessageComposer with PR context.
 *
 * Shape (matches /atoms/message-composer sandwich):
 *   header  → PR identity + quiet routing chips (project · agent)
 *   body    → guidance draft (the product)
 *   toolbar → harness · model · effort · mic · Send
 *
 * Defaults: project from PR, runtime defaults, agent empty (one-time).
 * Studio only until ported to PullRequestAssignDialog.
 */

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  MessageComposer,
  MessageComposerSelect,
} from "@/components/MessageComposer";

type Project = {
  path: string;
  label: string;
  branch: string;
  affinity: "pr" | "related" | "outside";
};

type Agent = {
  id: string;
  handle: string;
  harness: string;
  model: string;
  state: "available" | "working" | "idle";
  hasSession: boolean;
  projectPath: string;
};

const PR = {
  number: 167,
  title: "Add summonable phone control deck",
  repo: "arach/hudson",
  head: "codex/hudson-phone-control-deck",
  base: "main",
  path: "/Users/art/dev/hudson",
};

const PROJECTS: Project[] = [
  {
    path: "/Users/art/dev/hudson",
    label: "arach/hudson",
    branch: "codex/hudson-phone-control-deck",
    affinity: "pr",
  },
  {
    path: "/Users/art/dev/hudson-worktrees/review",
    label: "arach/hudson",
    branch: "review/phone-deck",
    affinity: "related",
  },
  {
    path: "/Users/art/dev/openscout",
    label: "arach/openscout",
    branch: "main",
    affinity: "outside",
  },
];

const AGENTS: Agent[] = [
  {
    id: "a1",
    handle: "hudson-review",
    harness: "claude",
    model: "sonnet",
    state: "available",
    hasSession: true,
    projectPath: "/Users/art/dev/hudson",
  },
  {
    id: "a2",
    handle: "codex.main",
    harness: "codex",
    model: "gpt-5",
    state: "working",
    hasSession: true,
    projectPath: "/Users/art/dev/hudson",
  },
  {
    id: "a3",
    handle: "scout-ops",
    harness: "claude",
    model: "opus",
    state: "idle",
    hasSession: false,
    projectPath: "/Users/art/dev/openscout",
  },
];

const DEFAULT_GUIDANCE =
  `Please review #${PR.number}: ${PR.title}.\n\nSummarize the change, call out risks or test gaps, and recommend ship / revise / hold.`;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function shortPath(path: string): string {
  if (path.startsWith("/Users/")) return `~/${path.split("/").slice(3).join("/")}`;
  return path;
}

function affinityLabel(affinity: Project["affinity"]): string {
  if (affinity === "pr") return "this PR";
  if (affinity === "related") return "same repo";
  return "outside";
}

/** Quiet chip inside composer header — click opens a popover panel. */
function HeaderChip({
  label,
  value,
  open,
  onToggle,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1",
        "bg-studio-ink/[0.06] transition-colors",
        "hover:bg-studio-ink/[0.1]",
        open && "bg-studio-ink/[0.12] ring-1 ring-studio-ink/15",
      )}
    >
      <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] font-medium text-studio-ink">
        {value}
      </span>
      <ChevronDown
        size={10}
        strokeWidth={2}
        className={cx(
          "shrink-0 text-studio-ink-faint transition-transform",
          open && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}

export function PrAssignReviewStudy() {
  const [projectPath, setProjectPath] = useState(PROJECTS[0]!.path);
  const [harness, setHarness] = useState("claude");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("medium");
  const [agentId, setAgentId] = useState(""); // empty = one-time
  const [sessionMode, setSessionMode] = useState<"new" | "existing">("new");
  const [openMenu, setOpenMenu] = useState<"project" | "agent" | null>(null);
  const [guidance, setGuidance] = useState(DEFAULT_GUIDANCE);
  const [last, setLast] = useState<string | null>(null);

  const project = PROJECTS.find((p) => p.path === projectPath) ?? PROJECTS[0]!;
  const agent = AGENTS.find((a) => a.id === agentId) ?? null;

  const rankedAgents = useMemo(
    () =>
      [...AGENTS].sort((left, right) => {
        const lm = left.projectPath === projectPath ? 0 : 1;
        const rm = right.projectPath === projectPath ? 0 : 1;
        return lm - rm || left.handle.localeCompare(right.handle);
      }),
    [projectPath],
  );

  const pickProject = (path: string) => {
    setProjectPath(path);
    setOpenMenu(null);
  };

  const pickAgent = (id: string) => {
    setAgentId(id);
    const next = AGENTS.find((a) => a.id === id) ?? null;
    if (next) {
      setHarness(next.harness);
      setModel(next.model);
      setSessionMode(next.hasSession ? "existing" : "new");
    } else {
      setSessionMode("new");
    }
    setOpenMenu(null);
  };

  const header = (
    <div className="space-y-2">
      {/* PR identity — context, not form */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink-faint">
              Review
            </span>
            <span className="font-mono text-[11px] text-studio-ink-faint">
              #{PR.number}
            </span>
          </div>
          <div className="mt-0.5 truncate font-sans text-[13px] font-medium text-studio-ink">
            {PR.title}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-studio-ink-faint">
            {PR.repo} · {PR.head} → {PR.base}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-studio-ink-faint transition-colors hover:bg-studio-ink/[0.08] hover:text-studio-ink"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Routing chips — project + agent only; runtime lives in toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <HeaderChip
          label="Project"
          value={`${project.label} · ${project.branch}`}
          open={openMenu === "project"}
          onToggle={() => setOpenMenu((cur) => (cur === "project" ? null : "project"))}
        />
        <HeaderChip
          label="Agent"
          value={agent ? `@${agent.handle}` : "one-time"}
          open={openMenu === "agent"}
          onToggle={() => setOpenMenu((cur) => (cur === "agent" ? null : "agent"))}
        />
        {agent ? (
          <div className="inline-flex overflow-hidden rounded-full bg-studio-ink/[0.06] p-0.5">
            {(["new", "existing"] as const).map((mode) => {
              const blocked = mode === "existing" && !agent.hasSession;
              const active = sessionMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={blocked}
                  onClick={() => setSessionMode(mode)}
                  className={cx(
                    "rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors",
                    active
                      ? "bg-studio-surface text-studio-ink shadow-sm"
                      : "text-studio-ink-faint hover:text-studio-ink",
                    blocked && "cursor-not-allowed opacity-40",
                  )}
                  title={
                    blocked
                      ? "No live harness session"
                      : mode === "new"
                        ? "Fresh harness session"
                        : "Continue current session"
                  }
                >
                  {mode === "new" ? "new session" : "continue"}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Project picker */}
      {openMenu === "project" ? (
        <div className="rounded-lg border border-studio-edge bg-studio-canvas/60 p-1.5">
          <div className="mb-1 px-2 pt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
            Prefer this PR&apos;s repo · still flexible
          </div>
          <div className="max-h-44 space-y-0.5 overflow-y-auto">
            {PROJECTS.map((item) => {
              const active = item.path === projectPath;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => pickProject(item.path)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-studio-ink/[0.08]"
                      : "hover:bg-studio-ink/[0.05]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[12.5px] font-medium text-studio-ink">
                      {item.label}
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-studio-ink-faint">
                        · {item.branch}
                      </span>
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-studio-ink-faint">
                      {shortPath(item.path)}
                    </span>
                  </span>
                  <span
                    className={cx(
                      "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                      item.affinity === "pr" && "bg-emerald-500/15 text-emerald-400",
                      item.affinity === "related" && "bg-studio-ink/[0.08] text-studio-ink-faint",
                      item.affinity === "outside" && "bg-amber-500/12 text-amber-400/90",
                    )}
                  >
                    {affinityLabel(item.affinity)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Agent picker */}
      {openMenu === "agent" ? (
        <div className="rounded-lg border border-studio-edge bg-studio-canvas/60 p-1.5">
          <div className="mb-1 px-2 pt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-studio-ink-faint">
            Optional · default is a one-time reviewer
          </div>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => pickAgent("")}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                !agentId ? "bg-studio-ink/[0.08]" : "hover:bg-studio-ink/[0.05]",
              )}
            >
              <span className="grid h-7 w-7 place-items-center rounded-md bg-studio-ink/[0.08] font-mono text-[11px] text-studio-ink-faint">
                ·
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[12.5px] font-medium text-studio-ink">
                  One-time reviewer
                </span>
                <span className="block font-mono text-[10.5px] text-studio-ink-faint">
                  new session on {project.label}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-emerald-400/90">
                default
              </span>
            </button>
            {rankedAgents.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pickAgent(item.id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  item.id === agentId
                    ? "bg-studio-ink/[0.08]"
                    : "hover:bg-studio-ink/[0.05]",
                )}
              >
                <span className="grid h-7 w-7 place-items-center rounded-md bg-sky-500/15 font-mono text-[11px] font-bold text-sky-300">
                  {item.handle.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-sans text-[12.5px] font-medium text-studio-ink">
                    @{item.handle}
                  </span>
                  <span className="block font-mono text-[10.5px] text-studio-ink-faint">
                    {item.harness} · {item.model}
                    {item.projectPath === projectPath ? " · this project" : ""}
                  </span>
                </span>
                <span
                  className={cx(
                    "shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]",
                    item.state === "available"
                      ? "text-emerald-400/90"
                      : "text-studio-ink-faint",
                  )}
                >
                  {item.state}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Intent strip */}
      <div className="grid gap-3 rounded-md border border-studio-edge bg-studio-surface p-4 font-mono text-[11px] text-studio-ink-faint sm:grid-cols-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            Product
          </div>
          <div className="mt-1 leading-relaxed">
            The draft — what you want from the review.
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            Defaults
          </div>
          <div className="mt-1 leading-relaxed">
            Project from PR · claude · default · medium · no agent.
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
            Shell
          </div>
          <div className="mt-1 leading-relaxed">
            Same MessageComposer atom as chat / home.
          </div>
        </div>
      </div>

      {/* Live take — no custom dark dialog chrome; studio surface + composer */}
      <div className="mx-auto max-w-[560px]">
        <MessageComposer
          value={guidance}
          onChange={setGuidance}
          rows={5}
          placeholder="What do you want from this review?"
          showAttach={false}
          showDictation
          header={header}
          tools={
            <>
              <MessageComposerSelect
                label="Harness"
                value={harness}
                onChange={setHarness}
                options={[
                  { value: "claude", label: "claude" },
                  { value: "codex", label: "codex" },
                  { value: "pi", label: "pi" },
                ]}
              />
              <MessageComposerSelect
                label="Model"
                value={model}
                onChange={setModel}
                options={[
                  { value: "", label: "default" },
                  { value: "sonnet", label: "sonnet" },
                  { value: "opus", label: "opus" },
                  { value: "gpt-5", label: "gpt-5" },
                ]}
              />
              <MessageComposerSelect
                label="Effort"
                value={effort}
                onChange={setEffort}
                options={[
                  { value: "low", label: "low" },
                  { value: "medium", label: "medium" },
                  { value: "high", label: "high" },
                  { value: "xhigh", label: "xhigh" },
                ]}
              />
            </>
          }
          onSend={(text) => {
            setLast(
              [
                text.replace(/\s+/g, " ").slice(0, 72) + (text.length > 72 ? "…" : ""),
                project.label,
                harness,
                model || "default",
                effort,
                agent ? `@${agent.handle}/${sessionMode}` : "one-time",
              ].join(" · "),
            );
          }}
          demoUtterance="focus on the phone control deck interaction and any permission edges"
        />

        {last ? (
          <p className="mt-2 font-mono text-[11px] text-studio-ink-faint">
            last → <span className="text-studio-ink">{last}</span>
          </p>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-studio-ink-faint">
            Edit the brief · tweak runtime in the toolbar · Send assigns the review.
          </p>
        )}
      </div>

      {/* What changed vs previous study take */}
      <div className="grid gap-4 border-t border-studio-edge pt-6 md:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            · this take
          </div>
          <ul className="space-y-2 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            <li>
              <strong className="font-medium text-studio-ink">No custom dialog skin</strong>
              {" "}— studio surface + MessageComposer only.
            </li>
            <li>
              <strong className="font-medium text-studio-ink">Runtime</strong>
              {" "}is the designed toolbar pills (harness · model · effort), not a second form.
            </li>
            <li>
              <strong className="font-medium text-studio-ink">Project / agent</strong>
              {" "}are header chips that expand inline.
            </li>
            <li>
              <strong className="font-medium text-studio-ink">Agent</strong>
              {" "}defaults to one-time; session only appears after a pick.
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            · not yet
          </div>
          <ul className="space-y-2 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            <li>Production Repos still has the old form dialog.</li>
            <li>MessageComposer atom itself is unchanged — only used correctly here.</li>
            <li>Port only after this take feels right.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
