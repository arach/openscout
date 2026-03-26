"use client";

import { startTransition, useDeferredValue, useState } from "react";
import type { ComponentType } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  CirclePause,
  Clock3,
  Copy,
  FolderOpen,
  LayoutGrid,
  MessagesSquare,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import type { PlanRecord, PlanStatus } from "@/lib/plan-inventory";

type ViewKey = "all" | PlanStatus;

const STATUS_META: Record<
  PlanStatus,
  {
    badgeClass: string;
    barClass: string;
    dotClass: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
  }
> = {
  "awaiting-review": {
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    barClass: "bg-amber-500",
    dotClass: "bg-amber-500",
    icon: Clock3,
    label: "Awaiting Review",
  },
  "in-progress": {
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    barClass: "bg-emerald-500",
    dotClass: "bg-emerald-500",
    icon: Sparkles,
    label: "In Progress",
  },
  completed: {
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
    barClass: "bg-indigo-500",
    dotClass: "bg-indigo-500",
    icon: CheckCircle2,
    label: "Completed",
  },
  paused: {
    badgeClass: "border-stone-200 bg-stone-100 text-stone-600",
    barClass: "bg-stone-500",
    dotClass: "bg-stone-400",
    icon: CirclePause,
    label: "Paused",
  },
  draft: {
    badgeClass: "border-slate-200 bg-slate-100 text-slate-600",
    barClass: "bg-slate-500",
    dotClass: "bg-slate-400",
    icon: Bot,
    label: "Draft",
  },
};

const AGENT_TONES = [
  "border-emerald-200 bg-emerald-100 text-emerald-700",
  "border-rose-200 bg-rose-100 text-rose-700",
  "border-sky-200 bg-sky-100 text-sky-700",
  "border-violet-200 bg-violet-100 text-violet-700",
  "border-amber-200 bg-amber-100 text-amber-700",
] as const;

const RAIL_ITEMS: Array<{
  active?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
}> = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Sparkles, label: "Plans", active: true },
  { icon: MessagesSquare, label: "Relay" },
  { icon: TerminalSquare, label: "Runtime" },
];

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; code: string; language: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "task-list"; items: { checked: boolean; text: string }[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "rule" };

function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function buildSearchText(plan: PlanRecord): string {
  return [
    plan.agent,
    plan.id,
    plan.path,
    plan.status,
    plan.summary,
    plan.tags.join(" "),
    plan.title,
    plan.twin,
  ]
    .join(" ")
    .toLowerCase();
}

function progressRatio(plan: PlanRecord): number {
  if (plan.stepsTotal === 0) {
    return plan.status === "completed" ? 1 : 0;
  }

  return plan.stepsCompleted / plan.stepsTotal;
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const isTask = (line: string) => /^\s*[-*]\s+\[([ xX])\]\s+/.test(line);
  const isBullet = (line: string) => /^\s*[-*]\s+/.test(line) && !isTask(line);
  const isOrdered = (line: string) => /^\s*\d+\.\s+/.test(line);
  const isHeading = (line: string) => /^\s*#{1,3}\s+/.test(line);
  const isCodeFence = (line: string) => /^\s*```/.test(line);
  const isBlockQuote = (line: string) => /^\s*>/.test(line);

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed === "---") {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (isCodeFence(trimmed)) {
      const language = trimmed.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !isCodeFence(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        code: codeLines.join("\n"),
        language,
      });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isBlockQuote(trimmed)) {
      const quoteLines: string[] = [];

      while (index < lines.length && isBlockQuote(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    if (isTask(trimmed)) {
      const items: { checked: boolean; text: string }[] = [];

      while (index < lines.length && isTask(lines[index])) {
        const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);

        if (match) {
          items.push({
            checked: match[1].toLowerCase() === "x",
            text: match[2].trim(),
          });
        }

        index += 1;
      }

      blocks.push({ type: "task-list", items });
      continue;
    }

    if (isBullet(trimmed)) {
      const items: string[] = [];

      while (index < lines.length && isBullet(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }

      blocks.push({ type: "bullet-list", items });
      continue;
    }

    if (isOrdered(trimmed)) {
      const items: string[] = [];

      while (index < lines.length && isOrdered(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, "").trim());
        index += 1;
      }

      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const paragraphLines: string[] = [];

    while (
      index < lines.length &&
      lines[index].trim() &&
      !isHeading(lines[index]) &&
      !isCodeFence(lines[index]) &&
      !isBlockQuote(lines[index]) &&
      !isTask(lines[index]) &&
      !isBullet(lines[index]) &&
      !isOrdered(lines[index]) &&
      lines[index].trim() !== "---"
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function StatusBadge({ status }: { status: PlanStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${meta.badgeClass}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function ToolbarAction({
  command,
  label,
}: {
  command: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      onClick={copy}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--shell-line)] bg-white px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-dim)] transition hover:border-[var(--shell-line-strong)] hover:text-[var(--shell-ink)]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--shell-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function MarkdownReader({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="space-y-5">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h2 key={blockIndex} className="text-[1.65rem] font-semibold tracking-[-0.03em] text-[var(--shell-ink)]">
                {block.text}
              </h2>
            );
          }

          if (block.level === 2) {
            return (
              <h3
                key={blockIndex}
                className="pt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shell-dim)]"
              >
                {block.text}
              </h3>
            );
          }

          return (
            <h4 key={blockIndex} className="text-[15px] font-semibold text-[var(--shell-ink)]">
              {block.text}
            </h4>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={blockIndex} className="text-[14px] leading-7 text-[var(--shell-copy)]">
              {block.text}
            </p>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={blockIndex}
              className="border-l-2 border-[var(--shell-accent)] pl-4 text-[14px] leading-6 text-[var(--shell-copy)]"
            >
              {block.text}
            </blockquote>
          );
        }

        if (block.type === "rule") {
          return <div key={blockIndex} className="h-px bg-[var(--shell-line)]" />;
        }

        if (block.type === "code") {
          return (
            <div key={blockIndex} className="overflow-hidden rounded-xl border border-[#1e2228] bg-[#171a1f]">
              <div className="border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                {block.language || "text"}
              </div>
              <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-6 text-white/90">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "bullet-list") {
          return (
            <ul key={blockIndex} className="space-y-3">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-[14px] leading-7 text-[var(--shell-copy)]">
                  <span className="mt-[0.75rem] h-1.5 w-1.5 rounded-full bg-[var(--shell-accent)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={blockIndex} className="space-y-3">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-[14px] leading-7 text-[var(--shell-copy)]">
                  <span className="font-mono text-[11px] text-[var(--shell-dim)]">{itemIndex + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <ul key={blockIndex} className="space-y-3">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-3 text-[14px] leading-7 text-[var(--shell-copy)]">
                <span
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    item.checked
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-[var(--shell-line)] bg-white text-transparent"
                  }`}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className={item.checked ? "text-[var(--shell-dim)] line-through" : "text-[var(--shell-copy)]"}>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export function PlanInventoryScreen({ plans }: { plans: PlanRecord[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const deferredQuery = useDeferredValue(query);
  const [selectedSlug, setSelectedSlug] = useState(plans[0]?.slug ?? "");

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredPlans = plans.filter((plan) => {
    if (view !== "all" && plan.status !== view) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return buildSearchText(plan).includes(normalizedQuery);
  });

  const resolvedSelectedSlug = filteredPlans.some((plan) => plan.slug === selectedSlug)
    ? selectedSlug
    : filteredPlans[0]?.slug ?? "";

  const selectedPlan =
    filteredPlans.find((plan) => plan.slug === resolvedSelectedSlug) ||
    filteredPlans[0] ||
    null;

  const views: { count: number; key: ViewKey; label: string }[] = [
    { key: "all", label: "Recent", count: plans.length },
    { key: "awaiting-review", label: "Awaiting Review", count: plans.filter((plan) => plan.status === "awaiting-review").length },
    { key: "in-progress", label: "In Progress", count: plans.filter((plan) => plan.status === "in-progress").length },
    { key: "completed", label: "Completed", count: plans.filter((plan) => plan.status === "completed").length },
    { key: "paused", label: "Paused", count: plans.filter((plan) => plan.status === "paused").length },
  ];

  const agentNames = [...new Set(plans.map((plan) => plan.agent))];
  const nowLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

  return (
    <div className="min-h-screen bg-[#edf1f4] p-3 text-[var(--shell-ink)] md:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1680px] flex-col overflow-hidden rounded-[24px] border border-[var(--shell-line)] bg-[var(--shell-bg)] shadow-[0_28px_70px_rgba(22,27,34,0.16)]">
        <header className="flex items-center justify-between border-b border-[var(--shell-line)] bg-white px-4 py-2.5 md:px-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--shell-line)] bg-[#fbfcfd] px-2.5 py-1">
              <span className="rounded bg-[#24272d] px-1.5 py-1 text-[10px] text-white">&gt;_</span>
              <span className="text-sm font-semibold">OpenScout</span>
            </div>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Helper Running
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Broker Running
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Mesh {agentNames.length} Peers
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[52px] flex-col justify-between border-r border-[var(--shell-line)] bg-[#f7f8fa] px-2 py-3 md:flex">
            <nav className="space-y-1">
              {RAIL_ITEMS.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.label}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                      item.active
                        ? "border-[#ced9ff] bg-[#eef3ff] text-[var(--shell-accent)]"
                        : "border-transparent bg-transparent text-[var(--shell-dim)] hover:border-[var(--shell-line)] hover:bg-white"
                    }`}
                    aria-label={item.label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </nav>

            <button
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-transparent text-[var(--shell-dim)] transition hover:border-[var(--shell-line)] hover:bg-white"
              aria-label="Settings"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </aside>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-[var(--shell-line)] bg-[#f8f9fb] lg:border-b-0 lg:border-r">
              <div className="border-b border-[var(--shell-line)] px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-[1.4rem] font-semibold tracking-[-0.03em] text-[var(--shell-ink)]">Plans</h1>
                    <p className="mt-1 text-sm text-[var(--shell-dim)]">
                      {plans.length} files · {agentNames.length} agents
                    </p>
                  </div>
                  <div className="rounded-md border border-[var(--shell-line)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-dim)]">
                    Read Only
                  </div>
                </div>

                <label className="mt-4 flex items-center gap-3 rounded-lg border border-[var(--shell-line)] bg-white px-3 py-2.5">
                  <Search className="h-4 w-4 text-[var(--shell-dim)]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter plans..."
                    className="w-full bg-transparent text-sm text-[var(--shell-ink)] outline-none placeholder:text-[var(--shell-muted)]"
                  />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <div className="border-b border-[var(--shell-line)] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shell-dim)]">Views</p>
                  <div className="mt-3 space-y-1.5">
                    {views.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setView(item.key)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
                          view === item.key
                            ? "border-[#ced9ff] bg-white text-[var(--shell-ink)]"
                            : "border-transparent text-[var(--shell-dim)] hover:border-[var(--shell-line)] hover:bg-white"
                        }`}
                      >
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em]">{item.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-b border-[var(--shell-line)] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shell-dim)]">Inventory</p>
                  <div className="mt-3 space-y-2">
                    {filteredPlans.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[var(--shell-line-strong)] bg-white px-4 py-6 text-center">
                        <p className="text-sm leading-6 text-[var(--shell-dim)]">No plans matched that filter.</p>
                      </div>
                    ) : (
                      filteredPlans.map((plan, index) => {
                        const selected = plan.slug === selectedPlan?.slug;
                        const tone = AGENT_TONES[index % AGENT_TONES.length];

                        return (
                          <button
                            key={plan.slug}
                            onClick={() => startTransition(() => setSelectedSlug(plan.slug))}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selected
                                ? "border-[#ced9ff] bg-white shadow-[0_8px_18px_rgba(91,132,255,0.10)]"
                                : "border-[var(--shell-line)] bg-white/70 hover:border-[var(--shell-line-strong)] hover:bg-white"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold ${tone}`}
                              >
                                {plan.agent.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-semibold text-[var(--shell-ink)]">{plan.title}</div>
                                <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-[var(--shell-dim)]">
                                  <span className="truncate">{plan.agent}</span>
                                  <span className="font-mono uppercase tracking-[0.14em]">{formatShortDate(plan.updatedAt)}</span>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[plan.status].dotClass}`} />
                                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-dim)]">
                                    {STATUS_META[plan.status].label}
                                  </span>
                                </div>
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgba(15,23,42,0.08)]">
                                  <div
                                    className={`h-full ${STATUS_META[plan.status].barClass}`}
                                    style={{ width: `${Math.max(progressRatio(plan) * 100, progressRatio(plan) > 0 ? 10 : 0)}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shell-dim)]">Agents</p>
                  <div className="mt-3 space-y-2">
                    {agentNames.map((agent, index) => {
                      const tone = AGENT_TONES[index % AGENT_TONES.length];
                      const agentPlans = plans.filter((plan) => plan.agent === agent);
                      const active = agentPlans.some((plan) => plan.status === "in-progress" || plan.status === "awaiting-review");

                      return (
                        <div key={agent} className="flex items-center justify-between rounded-lg border border-[var(--shell-line)] bg-white px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-semibold ${tone}`}>
                              {agent.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-[var(--shell-ink)]">{agent}</div>
                              <div className="text-[11px] text-[var(--shell-dim)]">{agentPlans.length} plan files</div>
                            </div>
                          </div>
                          <span
                            className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                              active ? "text-emerald-600" : "text-[var(--shell-muted)]"
                            }`}
                          >
                            {active ? "On" : "Off"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>

            <main className="flex min-h-0 flex-col bg-white">
              <div className="flex items-center justify-between border-b border-[var(--shell-line)] px-5 py-3 md:px-6">
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className="rounded-md border border-[var(--shell-line)] bg-[var(--shell-panel)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
                    {selectedPlan ? selectedPlan.id : "No Plan"}
                  </span>
                  <div className="truncate text-sm font-semibold text-[var(--shell-ink)]">
                    {selectedPlan ? selectedPlan.title : "Plan Reader"}
                  </div>
                </div>
                <div className="hidden items-center gap-4 md:flex font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
                  <span>{filteredPlans.length} visible</span>
                  <span>Reader active</span>
                </div>
              </div>

              {selectedPlan ? (
                <>
                  <div className="border-b border-[var(--shell-line)] bg-[#fbfcfd] px-5 py-5 md:px-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-md border text-[13px] font-semibold ${AGENT_TONES[0]}`}>
                            {selectedPlan.agent.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
                              @{selectedPlan.twin}
                            </p>
                            <h2 className="truncate text-[1.8rem] font-semibold tracking-[-0.035em] text-[var(--shell-ink)]">
                              {selectedPlan.title}
                            </h2>
                          </div>
                        </div>
                        <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[var(--shell-dim)]">
                          {selectedPlan.summary}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={selectedPlan.status} />
                        <ToolbarAction
                          command={`openscout relay send --as scout "@${selectedPlan.twin} Review ${selectedPlan.id} in ${selectedPlan.path} and answer follow-up questions."`}
                          label="Ask Twin"
                        />
                        <ToolbarAction
                          command={`$EDITOR ${selectedPlan.path}`}
                          label="Open In Editor"
                        />
                        <ToolbarAction command={selectedPlan.path} label="Copy Path" />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_220px_minmax(0,1fr)_220px]">
                      <div className="rounded-lg border border-[var(--shell-line)] bg-white px-3 py-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Agent</div>
                        <div className="mt-1 text-sm font-medium text-[var(--shell-ink)]">{selectedPlan.agent}</div>
                      </div>
                      <div className="rounded-lg border border-[var(--shell-line)] bg-white px-3 py-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Checklist</div>
                        <div className="mt-1 text-sm font-medium text-[var(--shell-ink)]">
                          {selectedPlan.stepsCompleted}/{selectedPlan.stepsTotal} complete
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--shell-line)] bg-white px-3 py-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Source</div>
                        <div className="mt-1 truncate font-mono text-[12px] text-[var(--shell-copy)]">
                          {selectedPlan.path}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--shell-line)] bg-white px-3 py-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Updated</div>
                        <div className="mt-1 text-sm font-medium text-[var(--shell-ink)]">{formatLongDate(selectedPlan.updatedAt)}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedPlan.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-[var(--shell-line)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-dim)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto px-5 py-5 md:px-6">
                    <div className="mx-auto max-w-4xl rounded-[20px] border border-[var(--shell-line)] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                      <div className="mb-5 flex items-center justify-between border-b border-[var(--shell-line)] pb-4">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Markdown Preview</p>
                          <p className="mt-1 text-sm text-[var(--shell-dim)]">Simple reader for plan content. Editing stays in your local tools.</p>
                        </div>
                        <span className="hidden md:inline-flex items-center gap-2 rounded-md border border-[var(--shell-line)] bg-[#fbfcfd] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">
                          <FolderOpen className="h-3.5 w-3.5" />
                          {selectedPlan.path}
                        </span>
                      </div>

                      <MarkdownReader markdown={selectedPlan.markdown} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
                  <div className="max-w-md">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)]">Nothing Selected</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[var(--shell-ink)]">Add markdown plans and they show up here automatically.</h2>
                    <p className="mt-3 text-sm leading-6 text-[var(--shell-dim)]">
                      The inventory reads directly from <code className="rounded bg-[#f5f7fa] px-1.5 py-0.5 font-mono text-[12px]">plans/</code> and{" "}
                      <code className="rounded bg-[#f5f7fa] px-1.5 py-0.5 font-mono text-[12px]">.openscout/plans/</code>.
                    </p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--shell-line)] bg-white px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shell-dim)] md:px-5">
          <div className="flex items-center gap-3">
            <span>Relay</span>
            <span className="flex items-center gap-1.5 text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Running
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>{plans.length} Plans Indexed</span>
            <span>OpenScout {nowLabel}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
