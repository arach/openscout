export type TerminalTileDropEdge = "before" | "after";
export type TerminalTileDropAxis = "horizontal" | "vertical";

export type TerminalProjectDestination = {
  id: string;
  label: string;
  path: string;
  source: "configured" | "agent";
};

type ConfiguredTerminalProject = {
  id: string;
  title: string;
  root: string;
};

type ObservedTerminalProject = {
  id: string;
  name: string;
  project: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
};

export function resolveTerminalProjectDestinations(
  configuredProjects: readonly ConfiguredTerminalProject[],
  observedProjects: readonly ObservedTerminalProject[],
): TerminalProjectDestination[] {
  const observed = observedProjects
    .map((project, index) => {
      const path = normalizeTerminalProjectPath(project.projectRoot ?? project.cwd);
      if (!path) return null;
      return {
        id: `agent:${project.id}`,
        label: cleanTerminalProjectLabel(project.project) ?? basename(path) ?? project.name,
        path,
        source: "agent" as const,
        updatedAt: project.updatedAt ?? 0,
        index,
      };
    })
    .filter((project): project is NonNullable<typeof project> => project !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.index - right.index);

  const activityById = new Map<string, number>();
  for (const project of observed) {
    activityById.set(project.id.replace(/^agent:/u, ""), project.updatedAt);
  }

  const configured = configuredProjects
    .map((project, index) => {
      const path = normalizeTerminalProjectPath(project.root);
      if (!path) return null;
      return {
        id: `configured:${project.id}`,
        label: cleanTerminalProjectLabel(project.title) ?? basename(path) ?? path,
        path,
        source: "configured" as const,
        updatedAt: Math.max(
          activityById.get(project.id) ?? 0,
          ...observed.filter((candidate) => terminalProjectPathsMatch(candidate.path, path))
            .map((candidate) => candidate.updatedAt),
        ),
        index,
      };
    })
    .filter((project): project is NonNullable<typeof project> => project !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.index - right.index);

  const destinations: TerminalProjectDestination[] = [];
  const seenPaths: string[] = [];
  for (const project of [...configured, ...observed]) {
    if (seenPaths.some((path) => terminalProjectPathsMatch(path, project.path))) continue;
    seenPaths.push(project.path);
    destinations.push({
      id: project.id,
      label: project.label,
      path: project.path,
      source: project.source,
    });
  }
  return destinations;
}

export function terminalProjectCdCommand(path: string): string {
  if (path.startsWith("~/")) {
    return `cd -- ~/'${path.slice(2).replaceAll("'", "'\\''")}'`;
  }
  return `cd -- '${path.replaceAll("'", "'\\''")}'`;
}

function normalizeTerminalProjectPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || /[\0\r\n]/u.test(trimmed)) return null;
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/u, "");
}

function terminalProjectPathsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.startsWith("~/")) return right.endsWith(left.slice(1));
  if (right.startsWith("~/")) return left.endsWith(right.slice(1));
  return false;
}

function cleanTerminalProjectLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function basename(path: string): string | null {
  if (path === "/") return "/";
  return path.split("/").pop() || null;
}

export function terminalWorkspaceDropPlacement(
  point: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
  columnCount: number,
): { edge: TerminalTileDropEdge; axis: TerminalTileDropAxis } {
  if (columnCount > 1) {
    return {
      axis: "horizontal",
      edge: point.x < bounds.left + bounds.width / 2 ? "before" : "after",
    };
  }
  return {
    axis: "vertical",
    edge: point.y < bounds.top + bounds.height / 2 ? "before" : "after",
  };
}

export function moveTerminalWorkspaceItem<T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  destinationId: string,
  edge: TerminalTileDropEdge,
): T[] {
  if (sourceId === destinationId) return [...items];

  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const destinationIndex = items.findIndex((item) => item.id === destinationId);
  if (sourceIndex < 0 || destinationIndex < 0) return [...items];

  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return [...items];

  const adjustedDestination = next.findIndex((item) => item.id === destinationId);
  const insertionIndex = edge === "after" ? adjustedDestination + 1 : adjustedDestination;
  next.splice(Math.max(0, insertionIndex), 0, source);
  return next;
}
