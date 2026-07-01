import type { ReactNode } from "react";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { AgentEssentialsGlyph } from "../agents/agent-essentials.tsx";
import type { LocalAgentConfigState, Route } from "../../lib/types.ts";
import { harnessOf, openProjectAgentConfig, openProjectAgentProfile, registryAgentSubline } from "./model.ts";
import type { AgentOverviewRow } from "./project-overview-helpers.ts";

export type FacetLaunch = {
  label: string;
  onClick: () => void;
  primary?: boolean;
};

export function FacetEmbed({
  title,
  subtitle,
  excerpt,
  loading,
  empty,
  launches,
  mono,
}: {
  title: string;
  subtitle?: string;
  excerpt?: string | null;
  loading?: boolean;
  empty?: string;
  launches: FacetLaunch[];
  mono?: boolean;
}) {
  return (
    <article className="av2-embed">
      <header className="av2-embedHead">
        <div className="av2-embedIdent">
          <span className="av2-embedTitle" title={subtitle ?? title}>
            {title}
          </span>
          {subtitle && subtitle !== title ? (
            <span className="av2-embedSub" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="av2-embedLaunches">
          {launches.map((launch) => (
            <button
              key={launch.label}
              type="button"
              className="av2-embedLaunch"
              data-primary={launch.primary || undefined}
              onClick={launch.onClick}
            >
              {launch.label}
            </button>
          ))}
        </div>
      </header>
      <div className="av2-embedBody">
        {loading ? (
          <span className="av2-embedLoading">Loading…</span>
        ) : excerpt ? (
          <pre className={`av2-embedPreview${mono ? " av2-embedPreview--mono" : ""}`}>{excerpt}</pre>
        ) : (
          <span className="av2-embedEmpty">{empty ?? "No preview on disk."}</span>
        )}
      </div>
    </article>
  );
}

export function FacetEmbedStack({ children }: { children: ReactNode }) {
  return <div className="av2-embedStack">{children}</div>;
}

export function AgentFacetEmbed({
  row,
  route,
  navigate,
  permissionLabel,
}: {
  row: AgentOverviewRow;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: (route: Route) => void;
  permissionLabel: (profile: LocalAgentConfigState["permissionProfile"]) => string;
}) {
  const leadAgent = row.entry.leadAgent;
  const config = row.config;
  const subline = registryAgentSubline(row.entry);
  const prompt =
    config?.systemPrompt?.trim()
    || config?.templateHint
    || "default template";
  const tools =
    config && config.capabilities.length > 0
      ? config.capabilities.join(", ")
      : null;

  const selectAgent = () =>
    navigate({
      ...route,
      selectedAgentId: row.agentId,
      agentId: undefined,
      sessionId: undefined,
    });

  return (
    <article
      className="av2-embed av2-embed--agent"
      data-selected={route.selectedAgentId === row.agentId || undefined}
    >
      <header className="av2-embedHead">
        <div className="av2-embedIdent">
          <span className="av2-embedTitle">@{row.handle}</span>
          <span className="av2-embedSub" title={subline}>
            {subline}
          </span>
        </div>
        {leadAgent.harness ? (
          <span className="av2-embedHarness" aria-hidden>
            <HarnessMark harness={harnessOf(leadAgent.harness)} size={11} />
          </span>
        ) : null}
        <div className="av2-embedLaunches">
          <button type="button" className="av2-embedLaunch" data-primary onClick={selectAgent}>
            peek
          </button>
          <button
            type="button"
            className="av2-embedLaunch"
            onClick={() => navigate(openProjectAgentConfig(route, row.agentId))}
          >
            config
          </button>
          <button
            type="button"
            className="av2-embedLaunch"
            onClick={() => navigate(openProjectAgentProfile(route, row.agentId))}
          >
            profile ↗
          </button>
        </div>
      </header>
      <div className="av2-embedBody">
        <AgentEssentialsGlyph
          agent={leadAgent}
          projectRoot={row.projectRoot}
          className="av2-embedGlyph"
        />
        {config ? (
          <>
            <pre className="av2-embedPreview av2-embedPreview--prompt" title={config.systemPrompt}>
              {prompt.length > 280 ? `${prompt.slice(0, 280)}…` : prompt}
            </pre>
            <dl className="av2-embedFacts">
              <div>
                <dt>permissions</dt>
                <dd>{permissionLabel(config.permissionProfile)}</dd>
              </div>
              <div>
                <dt>model</dt>
                <dd>{config.model ?? config.runtime.harness}</dd>
              </div>
              <div className="av2-embedFactsWide">
                <dt>tools</dt>
                <dd title={tools ?? undefined}>{tools ?? "—"}</dd>
              </div>
              <div>
                <dt>launch</dt>
                <dd title={config.launchArgs.join(" ") || undefined}>
                  {config.launchArgs.length > 0 ? config.launchArgs.join(" ") : "—"}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <span className="av2-embedEmpty">No local agent config on disk.</span>
        )}
      </div>
    </article>
  );
}