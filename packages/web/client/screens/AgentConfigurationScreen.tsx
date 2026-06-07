import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cpu, KeyRound, RefreshCw, Server, Settings, Wrench } from "lucide-react";
import { EmptyState } from "../components/EmptyState.tsx";
import { api } from "../lib/api.ts";
import type {
  AgentConfigurationAgent,
  AgentConfigurationProvider,
  AgentConfigurationRuntime,
  AgentConfigurationState,
  Route,
} from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import { AgentsSubnav } from "./AgentsSubnav.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import "./system-surfaces-redesign.css";

function chipTone(value: string): string {
  switch (value) {
    case "ready":
    case "running":
    case "available":
    case "enabled":
      return "sys-chip-success";
    case "configured":
    case "installed":
    case "working":
      return "sys-chip-warning";
    case "missing":
    case "offline":
    case "not_ready":
    case "error":
      return "sys-chip-danger";
    default:
      return "sys-chip-neutral";
  }
}

function agentConfigStatusLabel(value: string): string {
  switch (value) {
    case "available":
    case "ready":
      return "ready";
    case "offline":
    case "not_ready":
      return "not ready";
    default:
      return value;
  }
}

function shortPath(value: string | null): string {
  if (!value) return "Not reported";
  return value.replace(/^\/Users\/[^/]+/, "~");
}

function displayCapabilities(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "No capabilities reported";
}

function RuntimeRow({ runtime }: { runtime: AgentConfigurationRuntime }) {
  return (
    <div className="agent-config-row">
      <div className="agent-config-row-main">
        <span className="agent-config-icon"><Cpu size={14} /></span>
        <div className="agent-config-row-copy">
          <div className="agent-config-row-title">{runtime.label}</div>
          <div className="agent-config-row-detail">{runtime.description}</div>
          <div className="agent-config-row-meta">{runtime.detail}</div>
        </div>
      </div>
      <div className="agent-config-row-side">
        <span className={`sys-chip ${chipTone(runtime.state)}`}>{runtime.state}</span>
        <span className="agent-config-row-meta">{runtime.binaryPath ?? runtime.loginCommand ?? runtime.source}</span>
      </div>
    </div>
  );
}

function ProviderRow({ provider }: { provider: AgentConfigurationProvider }) {
  return (
    <div className="agent-config-row">
      <div className="agent-config-row-main">
        <span className="agent-config-icon"><KeyRound size={14} /></span>
        <div className="agent-config-row-copy">
          <div className="agent-config-row-title">{provider.name}</div>
          <div className="agent-config-row-detail">{provider.protocol}</div>
          <code className="agent-config-code">{provider.baseUrl}</code>
          <div className="agent-config-row-meta">Keys: {provider.envKeys.join(", ")}</div>
          <div className="agent-config-row-meta">{provider.note}</div>
        </div>
      </div>
      <div className="agent-config-row-side">
        <span className={`sys-chip ${chipTone(provider.status)}`}>{provider.status}</span>
        <a className="agent-config-link" href={provider.docsUrl} target="_blank" rel="noreferrer">Docs</a>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  selected,
  navigate,
}: {
  agent: AgentConfigurationAgent;
  selected: boolean;
  navigate: (r: Route) => void;
}) {
  return (
    <button
      type="button"
      className={`agent-config-row agent-config-row-button${selected ? " agent-config-row-selected" : ""}`}
      onClick={() => navigate({ view: "settings", section: "agents", agentId: agent.id })}
    >
      <div className="agent-config-row-main">
        <span className="agent-config-icon"><Bot size={14} /></span>
        <div className="agent-config-row-copy">
          <div className="agent-config-row-title">{agent.name}</div>
          <div className="agent-config-row-detail">{agent.id}</div>
          <div className="agent-config-row-meta">
            {agent.harness ?? "unknown harness"} / {agent.transport ?? "unknown transport"}
            {agent.model ? ` / ${agent.model}` : ""}
          </div>
        </div>
      </div>
      <div className="agent-config-row-side">
        <span className={`sys-chip ${chipTone(agent.status)}`}>{agentConfigStatusLabel(agent.status)}</span>
        <span className="agent-config-row-meta">{shortPath(agent.projectRoot ?? agent.cwd)}</span>
      </div>
    </button>
  );
}

function SelectedAgentPanel({
  agent,
  navigate,
}: {
  agent: AgentConfigurationAgent | null;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  if (!agent) {
    return (
      <div className="sys-panel agent-config-detail-panel">
        <div className="sys-section-head">
          <div>
            <h3 className="sys-section-title">Agent Details</h3>
            <p className="sys-section-subtitle">Select an agent to inspect runtime, model, and tool context.</p>
          </div>
        </div>
        <div className="sys-list-empty">
          <h3>No agent selected</h3>
          <p>Choose an agent from the configuration roster.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sys-panel agent-config-detail-panel">
      <div className="sys-section-head">
        <div>
          <h3 className="sys-section-title">{agent.name}</h3>
          <p className="sys-section-subtitle">{agent.id}</p>
        </div>
        <div className="sys-page-actions">
          <button
            type="button"
            className="s-btn"
            onClick={() => navigate({ view: "agents", agentId: agent.id })}
          >
            Open Agent
          </button>
          <button
            type="button"
            className="s-btn"
            onClick={() => openContent(navigate, { view: "conversation", conversationId: agent.conversationId }, { returnTo: route })}
          >
            Open DM
          </button>
        </div>
      </div>

      <div className="agent-config-detail-grid">
        <div>
          <span className="agent-config-label">Status</span>
          <span className={`sys-chip ${chipTone(agent.status)}`}>{agentConfigStatusLabel(agent.status)}</span>
        </div>
        <div>
          <span className="agent-config-label">Harness</span>
          <strong>{agent.harness ?? "Not reported"}</strong>
        </div>
        <div>
          <span className="agent-config-label">Transport</span>
          <strong>{agent.transport ?? "Not reported"}</strong>
        </div>
        <div>
          <span className="agent-config-label">Model</span>
          <strong>{agent.model ?? "Not reported"}</strong>
        </div>
        <div className="agent-config-detail-wide">
          <span className="agent-config-label">Project</span>
          <code>{shortPath(agent.projectRoot)}</code>
        </div>
        <div className="agent-config-detail-wide">
          <span className="agent-config-label">Capabilities</span>
          <span>{displayCapabilities(agent.capabilities)}</span>
        </div>
      </div>
    </div>
  );
}

export function AgentConfigurationScreen({
  navigate,
  selectedAgentId,
}: {
  navigate: (r: Route) => void;
  selectedAgentId?: string;
}) {
  const { route } = useScout();
  const [snapshot, setSnapshot] = useState<AgentConfigurationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (mode: "initial" | "manual" = "initial") => {
    const requestId = ++requestIdRef.current;
    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const next = await api<AgentConfigurationState>("/api/agent-config/snapshot");
      if (requestId !== requestIdRef.current) return;
      setSnapshot(next);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAgent = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.agents.find((agent) => agent.id === selectedAgentId)
      ?? snapshot.agents[0]
      ?? null;
  }, [selectedAgentId, snapshot]);

  const providers = snapshot?.providers ?? [];

  const metrics = snapshot ? [
    { label: "Runtimes", value: String(snapshot.runtimes.length), detail: `${snapshot.runtimes.filter((runtime) => runtime.state === "ready").length} ready` },
    { label: "BYOK", value: String(providers.length), detail: `${providers.filter((provider) => provider.status === "configured").length} configured` },
    { label: "Agents", value: String(snapshot.agents.length), detail: `${snapshot.agents.filter((agent) => agentConfigStatusLabel(agent.status) !== "not ready").length} ready` },
    { label: "Broker", value: snapshot.broker.label, detail: snapshot.broker.nodeId ?? "No node id" },
  ] : [];

  return (
    <div className="s-secondary-nav-shell">
      <div className="s-secondary-nav-bar">
        <AgentsSubnav activeRoute={route} navigate={navigate} />
      </div>
      <div className="s-secondary-nav-body s-secondary-nav-body--scroll">
        <div className="sys-surface-page sys-surface-page-wide">
          <PageHeader
            title="Agent Configuration"
            subtitle="Runtimes, agents, project inventory, delivery bridges, and the missing tool/provider surfaces in one control plane."
            syncNote={
              snapshot
                ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : undefined
            }
            actions={
              <button
                type="button"
                className="s-btn"
                disabled={loading || refreshing}
                onClick={() => void load("manual")}
              >
                <RefreshCw size={13} />
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            }
          />

      {snapshot && (
        <div className="sys-stat-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="sys-stat-card">
              <span className="sys-stat-label">{metric.label}</span>
              <strong className="sys-stat-value">{metric.value}</strong>
              <span className="sys-stat-detail">{metric.detail}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="sys-banner sys-banner-warning">
          <strong>Configuration snapshot failed.</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !snapshot && (
        <EmptyState
          title="Loading configuration"
          body="Reading Scout settings, runtime readiness, broker agents, and project inventory."
        />
      )}

      {snapshot && (
        <>
          <div className="agent-config-layout">
            <div className="sys-panel">
              <div className="sys-section-head">
                <div>
                  <h3 className="sys-section-title">Runtimes</h3>
                  <p className="sys-section-subtitle">Harness readiness replaces provider auth for the current local-first posture.</p>
                </div>
                <Settings size={15} />
              </div>
              <div className="agent-config-list">
                {snapshot.runtimes.map((runtime) => <RuntimeRow key={runtime.id} runtime={runtime} />)}
              </div>
            </div>

            <div className="sys-panel">
              <div className="sys-section-head">
                <div>
                  <h3 className="sys-section-title">BYOK Providers</h3>
                  <p className="sys-section-subtitle">OpenAI-compatible vendors OpenScout can discover from local environment configuration.</p>
                </div>
                <KeyRound size={15} />
              </div>
              <div className="agent-config-list">
                {providers.map((provider) => <ProviderRow key={provider.id} provider={provider} />)}
              </div>
            </div>
          </div>

          <div className="agent-config-layout agent-config-layout-primary">
            <div className="sys-panel">
              <div className="sys-section-head">
                <div>
                  <h3 className="sys-section-title">Agents</h3>
                  <p className="sys-section-subtitle">Broker-visible endpoints with runtime, model, and source state.</p>
                </div>
                <Bot size={15} />
              </div>
              <div className="agent-config-list agent-config-list-scroll">
                {snapshot.agents.length === 0 ? (
                  <div className="sys-list-empty">
                    <h3>No agents registered</h3>
                    <p>Run setup or start a local agent to populate this roster.</p>
                  </div>
                ) : (
                  snapshot.agents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      selected={agent.id === selectedAgent?.id}
                      navigate={navigate}
                    />
                  ))
                )}
              </div>
            </div>

            <SelectedAgentPanel agent={selectedAgent} navigate={navigate} />
          </div>

          <div className="agent-config-layout">
            <div className="sys-panel">
              <div className="sys-section-head">
                <div>
                  <h3 className="sys-section-title">Tools & Context</h3>
                  <p className="sys-section-subtitle">The next model boundary to make first-class.</p>
                </div>
                <Wrench size={15} />
              </div>
              <p className="agent-config-copy">{snapshot.toolContext.note}</p>
              <div className="agent-config-chip-row">
                <span className="sys-chip sys-chip-neutral">{snapshot.toolContext.mcpServerCount} MCP servers</span>
                <span className="sys-chip sys-chip-warning">loadouts pending</span>
              </div>
            </div>

            <div className="sys-panel">
              <div className="sys-section-head">
                <div>
                  <h3 className="sys-section-title">Broker & Delivery</h3>
                  <p className="sys-section-subtitle">Control-plane state and bridges that route attention back to you.</p>
                </div>
                <Server size={15} />
              </div>
              <div className="agent-config-detail-grid">
                <div>
                  <span className="agent-config-label">Broker</span>
                  <span className={`sys-chip ${snapshot.broker.healthy ? "sys-chip-success" : "sys-chip-danger"}`}>
                    {snapshot.broker.label}
                  </span>
                </div>
                <div>
                  <span className="agent-config-label">Messages</span>
                  <strong>{snapshot.broker.messageCount}</strong>
                </div>
                {snapshot.integrations.map((integration) => (
                  <div key={integration.id} className="agent-config-detail-wide">
                    <span className="agent-config-label">{integration.name}</span>
                    <span>{integration.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Known Missing Pieces</h3>
                <p className="sys-section-subtitle">The configuration model is now visible; these are the next root-cause surfaces to build.</p>
              </div>
            </div>
            <div className="agent-config-gap-list">
              {snapshot.gaps.map((gap) => <span key={gap}>{gap}</span>)}
            </div>
          </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
