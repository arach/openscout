import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { api } from "../../lib/api.ts";
import type { LocalAgentConfigState, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { dirProjectHarnesses } from "../agents/model.ts";
import type { DirProject } from "../agents/model.ts";
import { ProjectAgentsFrame } from "./project-agents-frame.tsx";
import {
  agentOverviewRows,
  primaryWorktree,
  repoProjectForRoot,
  shortHomePath,
  worktreeLine,
  type ProjectOverviewPayload,
} from "./project-overview-helpers.ts";
import { ProjectRepoFrame } from "./project-repo-frame.tsx";
import type { RegistrySessionEntry } from "./model.ts";
import { harnessOf, registryAgentsForProject } from "./model.ts";
import type { RegistryAgentEntry } from "./model.ts";
import type { ReactNode } from "react";

type Navigate = (route: Route) => void;

function FacetSection({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className="av2-facet" data-wide={wide || undefined}>
      <header className="av2-facetHead">
        <span className="av2-facetLabel">{label}</span>
      </header>
      <div className="av2-facetBody">{children}</div>
    </section>
  );
}

function FacetMono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="av2-facetMono" title={title}>
      {children}
    </span>
  );
}

function WorktreeRow({
  wt,
  primary,
  onReveal,
  onDiff,
}: {
  wt: RepoWatchWorktree;
  primary?: boolean;
  onReveal: (path: string) => void;
  onDiff: (path: string) => void;
}) {
  return (
    <div className="av2-worktreeRow" data-primary={primary || undefined}>
      <div className="av2-worktreeCopy">
        <span className="av2-worktreeLine">{worktreeLine(wt)}</span>
        <span className="av2-worktreePath" title={wt.path}>
          {shortHomePath(wt.path)}
        </span>
      </div>
      <div className="av2-worktreeActs">
        <button type="button" className="av2-embedLaunch" data-primary onClick={() => onDiff(wt.path)}>
          diff
        </button>
        <button type="button" className="av2-embedLaunch" onClick={() => onReveal(wt.path)}>
          reveal
        </button>
      </div>
    </div>
  );
}

export function AgentsV2ProjectOverview({
  route,
  navigate,
  projectTitle,
  projectRoot,
  dirProject,
  agentEntries,
  agentIdsKey,
  projectSessions,
  sessionCount,
  indexViewToggle,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  projectTitle: string;
  projectRoot: string | null;
  dirProject: DirProject | null;
  agentEntries: RegistryAgentEntry[];
  agentIdsKey: string;
  projectSessions: RegistrySessionEntry[];
  sessionCount: number;
  indexViewToggle: ReactNode;
}) {
  const { openFilePreview } = useScout();
  const [overview, setOverview] = useState<ProjectOverviewPayload | null>(null);
  const [repoWatch, setRepoWatch] = useState<RepoWatchSnapshot | null>(null);
  const [configs, setConfigs] = useState<Map<string, LocalAgentConfigState | null>>(new Map());
  const [initialLoading, setInitialLoading] = useState(true);
  const loadedRootRef = useRef<string | null>(null);

  const revealPath = useCallback(async (path: string) => {
    await api("/api/file/reveal", {
      method: "POST",
      body: JSON.stringify({ path }),
    }).catch(() => undefined);
  }, []);

  const openDiff = useCallback(
    (path: string) => {
      navigate({ view: "repo-diff", path });
    },
    [navigate],
  );

  useEffect(() => {
    if (!projectRoot) {
      setInitialLoading(false);
      return;
    }

    const rootChanged = loadedRootRef.current !== projectRoot;
    if (rootChanged) {
      loadedRootRef.current = projectRoot;
      setInitialLoading(true);
    }

    let cancelled = false;
    void (async () => {
      const [overviewResult, repoResult] = await Promise.allSettled([
        api<ProjectOverviewPayload>(`/api/projects/overview?root=${encodeURIComponent(projectRoot)}`),
        api<RepoWatchSnapshot>("/api/repo-watch?includeLastCommit=1&native=0"),
      ]);
      if (cancelled) return;
      if (overviewResult.status === "fulfilled") setOverview(overviewResult.value);
      if (repoResult.status === "fulfilled") setRepoWatch(repoResult.value);
      setInitialLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    if (!agentIdsKey) {
      setConfigs(new Map());
      return;
    }

    const ids = agentIdsKey.split(",").filter(Boolean);
    let cancelled = false;
    void (async () => {
      const configEntries = await Promise.all(
        ids.map(async (agentId) => {
          const config = await api<LocalAgentConfigState>(
            `/api/agents/${encodeURIComponent(agentId)}/config`,
          ).catch(() => null);
          return [agentId, config] as const;
        }),
      );
      if (!cancelled) setConfigs(new Map(configEntries));
    })();

    return () => {
      cancelled = true;
    };
  }, [agentIdsKey]);

  const repoProject = useMemo(
    () => repoProjectForRoot(repoWatch, projectRoot ?? overview?.root ?? null),
    [overview?.root, projectRoot, repoWatch],
  );
  const mainWt = primaryWorktree(repoProject);
  const harnesses = dirProject ? dirProjectHarnesses(dirProject) : [...new Set(agentEntries.map((e) => e.group.harness))];
  const branches = dirProject
    ? [...new Set(dirProject.agents.map((n) => n.row.branch).filter((b) => b && b !== "—"))]
    : [...new Set(agentEntries.flatMap((e) => e.group.branches))];
  const agentRows = agentOverviewRows(agentEntries, configs, projectSessions, Date.now());

  const repoArtifacts = useMemo(
    () => overview?.artifacts.filter((a) => a.kind !== "package" || a.relativePath === "package.json") ?? [],
    [overview?.artifacts],
  );

  const displayRoot = overview?.root ?? projectRoot;

  return (
    <header className="av2-projectOverview">
      <div className="av2-projectOverviewTop">
        <AgentAvatar name={projectTitle} size={48} tile presence={false} />
        <div className="av2-projectOverviewIdent">
          <div className="av2-projectOverviewTitleRow">
            <h1 className="av2-indexTitle">
              <span className="av2-indexScopeKind">Project</span>
              <span className="av2-indexScopePath">/{projectTitle}</span>
            </h1>
            {indexViewToggle}
          </div>
          {displayRoot ? (
            <div className="av2-projectRootRow">
              <FacetMono title={displayRoot}>{shortHomePath(displayRoot)}</FacetMono>
              <button type="button" className="av2-facetJump" onClick={() => void revealPath(displayRoot)}>
                reveal
              </button>
              <button
                type="button"
                className="av2-facetJump"
                onClick={() => navigate({ view: "repos" })}
              >
                repos
              </button>
            </div>
          ) : null}
          <div className="av2-projectRegistration">
            <FacetMono>
              {agentEntries.length} agents · {sessionCount} sessions
              {harnesses.length > 0 ? ` · ${harnesses.map((h) => harnessOf(h)).join(", ")}` : ""}
              {branches.length > 0
                ? ` · ${branches.length === 1 ? branches[0] : `${branches.length} branches`}`
                : ""}
            </FacetMono>
          </div>
          {overview?.package ? (
            <div className="av2-projectPackage">
              <FacetMono title={overview.package.description ?? undefined}>
                {[
                  overview.package.name,
                  overview.package.version ? `v${overview.package.version}` : null,
                  overview.package.description,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </FacetMono>
            </div>
          ) : null}
        </div>
      </div>

      {initialLoading ? (
        <div className="av2-projectOverviewLoading">Loading repo facets…</div>
      ) : (
        <div className="av2-facetGrid">
          <FacetSection label="Project files" wide>
            <ProjectRepoFrame
              artifacts={repoArtifacts}
              onOpen={openFilePreview}
              onReveal={(path) => void revealPath(path)}
            />
          </FacetSection>

          <FacetSection label="Git & worktrees">
            {!repoProject ? (
              <span className="av2-facetEmpty">No repo-watch match for this root.</span>
            ) : (
              <div className="av2-worktreeStack">
                {mainWt ? (
                  <WorktreeRow
                    wt={mainWt}
                    primary
                    onReveal={(path) => void revealPath(path)}
                    onDiff={openDiff}
                  />
                ) : null}
                {repoProject.worktrees
                  .filter((wt) => wt.id !== mainWt?.id)
                  .slice(0, 6)
                  .map((wt) => (
                    <WorktreeRow
                      key={wt.id}
                      wt={wt}
                      onReveal={(path) => void revealPath(path)}
                      onDiff={openDiff}
                    />
                  ))}
              </div>
            )}
          </FacetSection>

          <FacetSection label="Agents" wide>
            <ProjectAgentsFrame rows={agentRows} route={route} navigate={navigate} />
          </FacetSection>
        </div>
      )}
    </header>
  );
}

export function useProjectOverviewContext(
  route: Extract<Route, { view: "agents-v2" }>,
  registryAgents: RegistryAgentEntry[],
  projects: DirProject[],
  showEphemeral: boolean,
) {
  const agentEntries = useMemo(
    () => registryAgentsForProject(registryAgents, route.projectSlug ?? "", showEphemeral),
    [registryAgents, route.projectSlug, showEphemeral],
  );
  const agentIdsKey = useMemo(
    () => agentEntries.map((entry) => entry.leadAgent.id).sort().join(","),
    [agentEntries],
  );
  const dirProject = projects.find((p) => p.slice.slug === route.projectSlug) ?? null;
  const projectRoot = dirProject?.slice.root ?? agentEntries[0]?.projectRoot ?? null;
  const projectTitle = agentEntries[0]?.projectTitle ?? route.projectSlug ?? "project";
  return { agentEntries, agentIdsKey, dirProject, projectRoot, projectTitle };
}