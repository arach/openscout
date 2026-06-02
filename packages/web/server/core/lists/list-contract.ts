import type { EntityRefs } from "../entity-refs/entity-ref-contract.ts";

export type ListGroupKind =
  | "none"
  | "project"
  | "agent"
  | "channel"
  | "state"
  | "status"
  | "kind"
  | "day"
  | "machine";

export type ListSortDirection = "asc" | "desc";

export type ListQuery = {
  scope?: string | null;
  group?: string | null;
  sort?: string | null;
  rowSort?: string | null;
  q?: string | null;
  limit?: number | null;
  cursor?: string | null;
  filters?: Record<string, string | null | undefined>;
};

export type ListSortKeys = Record<string, string | number | boolean | null>;

export type ListGroup<Row, Meta extends Record<string, unknown> = Record<string, unknown>> = {
  key: string;
  kind: ListGroupKind;
  label: string;
  refs?: EntityRefs;
  counts: Record<string, number>;
  sortKeys: ListSortKeys;
  meta: Meta;
  rows: Row[];
};

export type ListResponse<
  Row,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  schema: "openscout.list.v1";
  kind: string;
  generatedAt: number;
  query: ListQuery;
  summary: {
    totalRows: number;
    totalGroups: number;
    truncated: boolean;
    counts: Record<string, number>;
  };
  groups: Array<ListGroup<Row, Meta>>;
};

export function createListResponse<
  Row,
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(input: {
  kind: string;
  query: ListQuery;
  groups: Array<ListGroup<Row, Meta>>;
  totalRows?: number;
  truncated?: boolean;
  counts?: Record<string, number>;
}): ListResponse<Row, Meta> {
  const totalRows = input.totalRows ?? input.groups.reduce((sum, group) => sum + group.rows.length, 0);
  return {
    schema: "openscout.list.v1",
    kind: input.kind,
    generatedAt: Date.now(),
    query: input.query,
    summary: {
      totalRows,
      totalGroups: input.groups.length,
      truncated: input.truncated ?? false,
      counts: input.counts ?? {},
    },
    groups: input.groups,
  };
}
