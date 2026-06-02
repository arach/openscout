import { queryAgents } from "../../db-queries.ts";
import type { WebAgent } from "../../db/types/web.ts";
import {
  buildEntityRefResolver,
  entityAgentStateRank,
  normalizeEntityAgentState,
} from "../entity-refs/entity-ref-resolver.ts";
import type { EntityRefs } from "../entity-refs/entity-ref-contract.ts";
import { createListBucket, bucketMapToGroups } from "./list-grouping.ts";
import { compareNumbersDesc, compareStrings, includesListQuery, normalizeListQuery } from "./list-sorting.ts";
import { createListResponse, type ListGroupKind, type ListQuery, type ListResponse } from "./list-contract.ts";

export type AgentListGroupMode = "none" | "agent" | "project";
export type AgentListSort = "recent" | "name" | "state";

export type AgentListRow = {
  id: string;
  name: string;
  state: string;
  updatedAt: number | null;
  harness: string | null;
  transport: string | null;
  project: string | null;
  branch: string | null;
  refs: EntityRefs;
};

type AgentListGroupMeta = {
  latestAt: number | null;
  bestStateRank: number;
  working: number;
  available: number;
  offline: number;
};

export function listAgents(input: {
  group?: string | null;
  sort?: string | null;
  rowSort?: string | null;
  q?: string | null;
  harness?: string | null;
  machineId?: string | null;
  limit?: number | null;
} = {}): ListResponse<AgentListRow, AgentListGroupMeta> {
  const group = normalizeAgentGroup(input.group);
  const sort = normalizeAgentSort(input.sort);
  const rowSort = normalizeAgentSort(input.rowSort ?? input.sort);
  const query = normalizeListQuery(input.q);
  const harness = input.harness?.trim() || null;
  const machineId = input.machineId?.trim() || null;
  const limit = typeof input.limit === "number" && input.limit > 0 ? Math.floor(input.limit) : null;
  const agents = queryAgents();
  const resolver = buildEntityRefResolver({ agents });

  const rows = agents
    .filter((agent) => !harness || agent.harness === harness)
    .filter((agent) => agentMatchesMachine(agent, machineId))
    .filter((agent) =>
      includesListQuery([
        agent.id,
        agent.name,
        agent.handle,
        agent.selector,
        agent.project,
        agent.projectRoot,
        agent.cwd,
        agent.branch,
        agent.harness,
        agent.transport,
      ], query)
    )
    .map((agent): AgentListRow => ({
      id: agent.id,
      name: agent.name,
      state: normalizeEntityAgentState(agent.state),
      updatedAt: agent.updatedAt,
      harness: agent.harness,
      transport: agent.transport,
      project: agent.project,
      branch: agent.branch,
      refs: resolver.forAgent(agent),
    }));

  const sortedRows = sortAgentRows(rows, rowSort);
  const limitedRows = limit ? sortedRows.slice(0, limit) : sortedRows;
  const groups = buildAgentGroups(limitedRows, group);
  groups.sort((left, right) => compareAgentGroups(left, right, sort));

  return createListResponse({
    kind: "agents",
    query: {
      group,
      sort,
      rowSort,
      q: input.q ?? null,
      limit,
      filters: { harness, machineId },
    } satisfies ListQuery,
    groups,
    totalRows: rows.length,
    truncated: limit !== null && rows.length > limitedRows.length,
    counts: {
      working: rows.filter((row) => row.state === "working").length,
      available: rows.filter((row) => row.state === "available").length,
      offline: rows.filter((row) => row.state === "offline").length,
    },
  });
}

function normalizeAgentGroup(value: string | null | undefined): AgentListGroupMode {
  return value === "agent" || value === "project" ? value : "none";
}

function normalizeAgentSort(value: string | null | undefined): AgentListSort {
  return value === "name" || value === "state" ? value : "recent";
}

function agentMatchesMachine(agent: WebAgent, machineId: string | null): boolean {
  if (!machineId) return true;
  return agent.authorityNodeId === machineId || agent.homeNodeId === machineId;
}

function sortAgentRows(rows: AgentListRow[], sort: AgentListSort): AgentListRow[] {
  return [...rows].sort((left, right) => {
    switch (sort) {
      case "name":
        return compareStrings(left.name, right.name) || compareNumbersDesc(left.updatedAt, right.updatedAt);
      case "state":
        return entityAgentStateRank(left.refs.agent?.state ?? "unknown")
          - entityAgentStateRank(right.refs.agent?.state ?? "unknown")
          || compareNumbersDesc(left.updatedAt, right.updatedAt)
          || compareStrings(left.name, right.name);
      case "recent":
      default:
        return compareNumbersDesc(left.updatedAt, right.updatedAt) || compareStrings(left.name, right.name);
    }
  });
}

function buildAgentGroups(rows: AgentListRow[], group: AgentListGroupMode) {
  const buckets = new Map<string, ReturnType<typeof createListBucket<AgentListRow, AgentListGroupMeta>>>();
  for (const row of rows) {
    const bucketInfo = agentGroupInfo(row, group);
    let bucket = buckets.get(bucketInfo.key);
    if (!bucket) {
      bucket = createListBucket<AgentListRow, AgentListGroupMeta>({
        key: bucketInfo.key,
        kind: bucketInfo.kind,
        label: bucketInfo.label,
        refs: bucketInfo.refs,
        counts: { total: 0 },
        sortKeys: { name: bucketInfo.label, recent: 0, stateRank: 9 },
        meta: {
          latestAt: null,
          bestStateRank: 9,
          working: 0,
          available: 0,
          offline: 0,
        },
      });
      buckets.set(bucketInfo.key, bucket);
    }

    bucket.rows.push(row);
    bucket.counts.total = (bucket.counts.total ?? 0) + 1;
    const state = row.refs.agent?.state ?? "unknown";
    const rank = entityAgentStateRank(state);
    bucket.meta.bestStateRank = Math.min(bucket.meta.bestStateRank, rank);
    bucket.meta.latestAt = Math.max(bucket.meta.latestAt ?? 0, row.updatedAt ?? 0) || null;
    bucket.sortKeys.recent = bucket.meta.latestAt ?? 0;
    bucket.sortKeys.stateRank = bucket.meta.bestStateRank;
    if (state === "working") bucket.meta.working += 1;
    else if (state === "available") bucket.meta.available += 1;
    else bucket.meta.offline += 1;
  }
  return bucketMapToGroups(buckets);
}

function agentGroupInfo(row: AgentListRow, group: AgentListGroupMode): {
  key: string;
  kind: ListGroupKind;
  label: string;
  refs?: EntityRefs;
} {
  if (group === "project") {
    const project = row.refs.project;
    if (project) {
      return {
        key: project.key,
        kind: "project",
        label: project.title,
        refs: { ...row.refs, agent: null, conversation: null, flight: null },
      };
    }
    return { key: "project:unscoped", kind: "project", label: "Unscoped" };
  }

  if (group === "agent") {
    return {
      key: `agent-name:${row.name.trim().toLowerCase() || row.id}`,
      kind: "agent",
      label: row.name,
      refs: { ...row.refs, project: null, conversation: null, flight: null },
    };
  }

  return { key: "all", kind: "none", label: "Agents" };
}

function compareAgentGroups(
  left: { label: string; sortKeys: Record<string, string | number | boolean | null> },
  right: { label: string; sortKeys: Record<string, string | number | boolean | null> },
  sort: AgentListSort,
): number {
  switch (sort) {
    case "name":
      return compareStrings(left.label, right.label);
    case "state":
      return Number(left.sortKeys.stateRank ?? 9) - Number(right.sortKeys.stateRank ?? 9)
        || Number(right.sortKeys.recent ?? 0) - Number(left.sortKeys.recent ?? 0)
        || compareStrings(left.label, right.label);
    case "recent":
    default:
      return Number(right.sortKeys.recent ?? 0) - Number(left.sortKeys.recent ?? 0)
        || compareStrings(left.label, right.label);
  }
}
