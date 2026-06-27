import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Rocket, Users } from "lucide-react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { api } from "../../lib/api.ts";
import type { LocalAgentConfigState, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { dirProjectHarnesses } from "../agents/model.ts";
import type { DirProject } from "../agents/model.ts";
import { NewAgentModal, type NewAgentExistingAgent } from "./NewAgentModal.tsx";
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
import { harnessOf, registryAgentsForProject } from "./model.ts";
import type { ProjectSessionEntry, RegistryAgentEntry } from "./model.ts";
import type { ReactNode } from "react";

type Navigate = (route: Route) => void;

function FacetSection({
  label,
  children,
  actions,
  wide,
}: {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className="av2-facet" data-wide={wide || undefined}>
      <header className="av2-facetHead">
        <span className="av2-facetLabel">{label}</span>
        {actions ? <div className="av2-facetActions">{actions}</div> : null}
      </header>
      <div className="av2-facetBody">{children}</div>
    </section>
  );
}

type ProjectWorkspaceView = "agents" | "files";

function ProjectWorkspaceToggle({
  value,
  fileCount,
  agentCount,
  onChange,
}: {
  value: ProjectWorkspaceView;
  fileCount: number;
  agentCount: number;
  onChange: (view: ProjectWorkspaceView) => void;
}) {
  return (
    <div className="av2-projectWorkspaceToggle" role="group" aria-label="Project workspace">
      <button
        type="button"
        className="av2-projectWorkspaceBtn"
        data-on={value === "agents" || undefined}
        aria-pressed={value === "agents"}
        onClick={() => onChange("agents")}
        title={`${agentCount} project agent${agentCount === 1 ? "" : "s"}`}
      >
        <Users size={12} strokeWidth={1.8} aria-hidden />
        <span>Agents</span>
        <span className="av2-projectWorkspaceCount">{agentCount}</span>
      </button>
      <button
        type="button"
        className="av2-projectWorkspaceBtn"
        data-on={value === "files" || undefined}
        aria-pressed={value === "files"}
        onClick={() => onChange("files")}
        title={`${fileCount} project file${fileCount === 1 ? "" : "s"}`}
      >
        <FileText size={12} strokeWidth={1.8} aria-hidden />
        <span>Files</span>
        <span className="av2-projectWorkspaceCount">{fileCount}</span>
      </button>
    </div>
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

export function ProjectOverview({
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
  navigate: Navigate;
  projectTitle: string;
  projectRoot: string | null;
  dirProject: DirProject | null;
  agentEntries: RegistryAgentEntry[];
  agentIdsKey: string;
  projectSessions: ProjectSessionEntry[];
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
  const harnesses = [
    ...new Set([
      ...(dirProject ? dirProjectHarnesses(dirProject) : agentEntries.map((e) => e.group.harness)),
      ...projectSessions.map((entry) => entry.harness),
    ].map((h) => harnessOf(h))),
  ];
  const branches = dirProject
    ? [...new Set(dirProject.agents.map((n) => n.row.branch).filter((b) => b && b !== "—"))]
    : [...new Set(agentEntries.flatMap((e) => e.group.branches))];
  const agentRows = agentOverviewRows(agentEntries, configs, projectSessions, Date.now());

  const repoArtifacts = useMemo(
    () => overview?.artifacts.filter((a) => a.kind !== "package" || a.relativePath === "package.json") ?? [],
    [overview?.artifacts],
  );
  const [workspaceView, setWorkspaceView] = useState<ProjectWorkspaceView>("agents");
  useEffect(() => {
    if (workspaceView === "agents" && agentRows.length === 0 && repoArtifacts.length > 0) {
      setWorkspaceView("files");
    } else if (workspaceView === "files" && repoArtifacts.length === 0 && agentRows.length > 0) {
      setWorkspaceView("agents");
    }
  }, [agentRows.length, repoArtifacts.length, workspaceView]);

  const displayRoot = overview?.root ?? projectRoot;
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const existingAgents = useMemo<NewAgentExistingAgent[]>(
    () =>
      agentEntries.map((entry) => ({
        name: entry.group.name,
        handle: entry.leadAgent.handle,
        harness: entry.leadAgent.harness,
      })),
    [agentEntries],
  );
  const launchBranches = useMemo(
    () => branches.filter((b): b is string => typeof b === "string" && b.length > 0 && b !== "—"),
    [branches],
  );

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
          <FacetSection label="New agent">
            <div className="av2-newAgentFacet">
              <button
                type="button"
                className="av2-newAgentBtn"
                disabled={!displayRoot}
                onClick={() => setNewAgentOpen(true)}
              >
                <Rocket size={13} strokeWidth={2} aria-hidden />
                New agent
              </button>
              <p className="av2-newAgentHint">
                {displayRoot
                  ? "A harnessed identity with an addressable handle for this project."
                  : "No project root resolved yet — cannot create an agent."}
              </p>
            </div>
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

          <FacetSection
            label="Workspace"
            wide
            actions={
              <ProjectWorkspaceToggle
                value={workspaceView}
                fileCount={repoArtifacts.length}
                agentCount={agentRows.length}
                onChange={setWorkspaceView}
              />
            }
          >
            <div className="av2-projectWorkspace" data-view={workspaceView}>
              {workspaceView === "files" ? (
                <ProjectRepoFrame
                  artifacts={repoArtifacts}
                  onOpen={openFilePreview}
                  onReveal={(path) => void revealPath(path)}
                />
              ) : (
                <ProjectAgentsFrame rows={agentRows} route={route} navigate={navigate} />
              )}
            </div>
          </FacetSection>
        </div>
      )}

      <NewAgentModal
        open={newAgentOpen}
        onClose={() => setNewAgentOpen(false)}
        projectTitle={projectTitle}
        projectRoot={displayRoot ?? null}
        primaryWt={mainWt}
        worktreeCount={repoProject?.worktrees.length ?? 0}
        branches={launchBranches}
        existingAgents={existingAgents}
        agentCount={agentEntries.length}
        sessionCount={sessionCount}
        route={route}
        navigate={navigate}
      />
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
  const projectTitle = agentEntries[0]?.projectTitle ?? dirProject?.slice.title ?? route.projectSlug ?? "project";
  return { agentEntries, agentIdsKey, dirProject, projectRoot, projectTitle };
}
