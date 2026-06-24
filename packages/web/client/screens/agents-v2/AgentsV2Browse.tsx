import type { Route } from "../../lib/types.ts";
import "./agents-v2.css";
import { openAgentsV2Profile, registryAgentsForProject } from "./model.ts";
import { useAgentsV2Data } from "./useAgentsV2Data.ts";

type Navigate = (route: Route) => void;

function scopeRoute(
  base: Extract<Route, { view: "agents-v2" }>,
  patch: Partial<Extract<Route, { view: "agents-v2" }>>,
): Extract<Route, { view: "agents-v2" }> {
  const next: Extract<Route, { view: "agents-v2" }> = {
    ...base,
    ...patch,
    view: "agents-v2",
    agentId: undefined,
    selectedAgentId: undefined,
    sessionId: undefined,
  };
  if ("projectSlug" in patch) {
    delete next.harness;
    delete next.node;
    delete next.set;
    if (!patch.projectSlug) delete next.projectSlug;
  }
  if ("harness" in patch) {
    delete next.projectSlug;
    delete next.node;
    delete next.set;
    if (!patch.harness) delete next.harness;
  }
  if ("node" in patch) {
    delete next.projectSlug;
    delete next.harness;
    delete next.set;
    if (!patch.node) delete next.node;
  }
  if ("set" in patch) {
    delete next.projectSlug;
    delete next.harness;
    delete next.node;
    if (!patch.set) delete next.set;
  }
  return next;
}

export function AgentsV2Browse({
  route,
  navigate,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const showEphemeral = Boolean(route.showEphemeral);
  const { browseProjects, browseHarnesses, browseNodes, browseSets, registryAgents } =
    useAgentsV2Data(showEphemeral);

  const openProject = (slug: string) => {
    const scoped = registryAgentsForProject(registryAgents, slug, showEphemeral);
    if (scoped.length === 1) {
      navigate(openAgentsV2Profile({ ...route, projectSlug: slug }, scoped[0]!.leadAgent.id));
      return;
    }
    navigate(scopeRoute(route, { projectSlug: slug }));
  };

  const allSelected =
    !route.projectSlug && !route.harness && !route.node && !route.set;

  return (
    <div className="s-av2-browse">
      <div className="av2-browseSection">
        <div className="av2-browseHead">Browse</div>
        <button
          type="button"
          className="av2-browseItem"
          data-selected={allSelected || undefined}
          onClick={() => navigate(scopeRoute(route, { projectSlug: undefined, harness: undefined, node: undefined, set: undefined }))}
        >
          <span className="av2-browseLabel">All agents</span>
        </button>
      </div>

      <div className="av2-browseSection">
        <div className="av2-browseHead">Projects</div>
        {browseProjects.map((project) => (
          <button
            key={project.slug}
            type="button"
            className="av2-browseItem"
            data-selected={route.projectSlug === project.slug || undefined}
            title={project.slug}
            onClick={() => openProject(project.slug)}
          >
            <span className="av2-browseLabel">/{project.title}</span>
            {project.needsCount > 0 ? (
              <span className="av2-browseCount" data-needs>
                {project.needsCount}
              </span>
            ) : project.liveCount > 0 ? (
              <span className="av2-browseCount">{project.liveCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {browseHarnesses.length > 0 ? (
        <div className="av2-browseSection">
          <div className="av2-browseHead">Harnesses</div>
          {browseHarnesses.map((harness) => (
            <button
              key={harness.id}
              type="button"
              className="av2-browseItem"
              data-selected={route.harness === harness.id || undefined}
              onClick={() => navigate(scopeRoute(route, { harness: harness.id }))}
            >
              <span className="av2-browseLabel">{harness.label}</span>
              <span className="av2-browseCount">{harness.agentCount}</span>
            </button>
          ))}
        </div>
      ) : null}

      {browseNodes.length > 1 ? (
        <div className="av2-browseSection">
          <div className="av2-browseHead">Machines</div>
          {browseNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className="av2-browseItem"
              data-selected={route.node === node.id || undefined}
              onClick={() => navigate(scopeRoute(route, { node: node.id }))}
            >
              <span className="av2-browseLabel">{node.label}</span>
              <span className="av2-browseCount">{node.agentCount}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="av2-browseSection">
        <div className="av2-browseHead">Sets</div>
        {browseSets.map((set) => (
          <button
            key={set.id}
            type="button"
            className="av2-browseItem"
            data-selected={route.set === set.id || undefined}
            onClick={() => navigate(scopeRoute(route, { set: set.id }))}
          >
            <span className="av2-browseLabel">{set.label}</span>
            <span className="av2-browseCount">{set.count}</span>
          </button>
        ))}
      </div>

      <div className="av2-browseFoot">
        <button type="button" className="av2-browseLink" onClick={() => navigate({ view: "search" })}>
          Search agents & sessions →
        </button>
      </div>
    </div>
  );
}