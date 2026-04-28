import "./terminal-screen.css";

import { useTerminalRelay, TerminalRelay } from "@hudson/sdk";
import { useScout } from "../scout/Provider.tsx";
import { actorColor } from "../lib/colors.ts";
import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../lib/runtime-config.ts";
import type { Route } from "../lib/types.ts";

export function TerminalScreen({
  agentId,
  navigate,
}: {
  agentId?: string;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const agent = agentId ? agents.find((a) => a.id === agentId) : null;
  const color = agent ? actorColor(agent.name) : "var(--accent)";

  const relay = useTerminalRelay({
    url: resolveScoutTerminalRelayUrl(),
    healthUrl: resolveScoutTerminalRelayHealthUrl(),
    autoConnect: true,
    sessionKey: agentId ? `scout-takeover-${agentId}` : "scout-takeover",
  });

  const back = () => {
    if (agentId) navigate({ view: "agents", agentId });
    else navigate({ view: "inbox" });
  };

  return (
    <div className="s-term">
      <div className="s-term-bar">
        <button className="s-term-back" onClick={back}>← Back</button>
        {agent && (
          <div className="s-term-agent">
            <div
              className="s-ops-avatar"
              style={{ "--size": "18px", background: color } as React.CSSProperties}
            >
              {agent.name[0]?.toUpperCase()}
            </div>
            <span className="s-term-agent-name">{agent.name}</span>
            {agent.handle && (
              <span className="s-term-agent-handle">@{agent.handle}</span>
            )}
          </div>
        )}
        <span className="s-term-label">TAKEOVER</span>
        <div className="s-term-status">
          <span
            className={`s-term-dot${relay.status === "connected" ? " s-term-dot--live" : relay.status === "connecting" ? " s-term-dot--connecting" : ""}`}
          />
          {relay.status === "connected"
            ? "LIVE"
            : relay.status === "connecting"
              ? "CONNECTING"
              : "OFFLINE"}
        </div>
      </div>
      <div className="s-term-body">
        <TerminalRelay relay={relay} fontSize={13} quiet />
      </div>
    </div>
  );
}
