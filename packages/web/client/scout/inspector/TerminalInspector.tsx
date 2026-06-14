import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, Route } from "../../lib/types.ts";

export function TerminalInspector() {
  const { route, agents, navigate } = useScout();
  if (route.view !== "terminal") return null;

  const agent = route.agentId
    ? agents.find((candidate) => candidate.id === route.agentId) ?? null
    : null;
  const mode = route.mode ?? "takeover";

  if (!agent) {
    return (
      <div className="flex h-full flex-col overflow-y-auto p-4 text-[11px]">
        <Section label="Terminal">
          <Row label="Mode" value={modeLabel(mode)} />
          {route.agentId && <Row label="Agent" value={route.agentId} />}
        </Section>
      </div>
    );
  }

  const tmuxSession = agent.transport === "tmux" ? agent.harnessSessionId : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-[11px] frame-scrollbar">
      <AgentHeader agent={agent} />

      <Section label="Terminal">
        <Row label="Mode" value={modeLabel(mode)} />
        <Row label="Backend" value={tmuxSession ? "tmux" : "pty"} />
        {tmuxSession && <Row label="Session" value={tmuxSession} />}
        <Row label="State" value={agentStateLabel(agent.state)} />
      </Section>

      <div className="grid grid-cols-2 gap-1.5">
        {tmuxSession && (
          <ModeButton
            active={mode === "observe"}
            label="Observe"
            onClick={() => navigate(terminalRoute(agent.id, "observe"))}
          />
        )}
        <ModeButton
          active={mode === "takeover"}
          label="Takeover"
          onClick={() => navigate(terminalRoute(agent.id, "takeover"))}
        />
        <ModeButton
          label="Profile"
          onClick={() => navigate({ view: "agents", agentId: agent.id, tab: "profile" })}
        />
        <ModeButton
          label="Trace"
          onClick={() => navigate({ view: "agents", agentId: agent.id, tab: "observe" })}
        />
      </div>

      <Section label="Agent">
        <Row label="Harness" value={agent.harness ?? "-"} />
        <Row label="Transport" value={agent.transport ?? "-"} />
        {agent.role && <Row label="Role" value={agent.role} />}
        {agent.handle && <Row label="Handle" value={`@${agent.handle}`} />}
        {agent.updatedAt && <Row label="Updated" value={timeAgo(agent.updatedAt)} />}
      </Section>

      {(agent.project || agent.branch || agent.cwd || agent.projectRoot) && (
        <Section label="Workspace">
          {agent.project && <Row label="Name" value={agent.project} />}
          {agent.branch && <Row label="Branch" value={agent.branch} />}
          {agent.cwd && <Row label="Cwd" value={agent.cwd} />}
          {!agent.cwd && agent.projectRoot && <Row label="Root" value={agent.projectRoot} />}
        </Section>
      )}
    </div>
  );
}

function terminalRoute(agentId: string, mode: "observe" | "takeover"): Route {
  return { view: "terminal", agentId, mode };
}

function modeLabel(mode: "observe" | "takeover"): string {
  return mode === "observe" ? "Read-only observe" : "Interactive takeover";
}

function AgentHeader({ agent }: { agent: Agent }) {
  return (
    <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={agent} placement="row" size={32} presence={false} />
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-snug text-[var(--scout-chrome-ink-strong)]">
            {agent.name}
          </div>
          {agent.handle && (
            <div className="truncate font-mono text-[10px] text-cyan-400/70">
              @{agent.handle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded border px-2 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${
        active
          ? "border-cyan-400/35 bg-cyan-400/[0.12] text-cyan-200"
          : "border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] text-[var(--scout-chrome-ink-soft)] hover:bg-[var(--scout-chrome-active)] hover:text-[var(--scout-chrome-ink)]"
      }`}
    >
      {label}
    </button>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <span className="truncate text-right text-[11px] font-mono text-[var(--scout-chrome-ink)]">
        {value}
      </span>
    </div>
  );
}
