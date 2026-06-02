import type { EntityRefs } from "../entity-refs/entity-ref-contract.ts";
import type { ListGroup, ListGroupKind, ListSortKeys } from "./list-contract.ts";

export type ListGroupBucket<Row, Meta extends Record<string, unknown>> = {
  key: string;
  kind: ListGroupKind;
  label: string;
  refs?: EntityRefs;
  rows: Row[];
  counts: Record<string, number>;
  sortKeys: ListSortKeys;
  meta: Meta;
};

export function createListBucket<Row, Meta extends Record<string, unknown>>(input: {
  key: string;
  kind: ListGroupKind;
  label: string;
  refs?: EntityRefs;
  counts?: Record<string, number>;
  sortKeys?: ListSortKeys;
  meta: Meta;
}): ListGroupBucket<Row, Meta> {
  return {
    key: input.key,
    kind: input.kind,
    label: input.label,
    refs: input.refs,
    rows: [],
    counts: input.counts ?? {},
    sortKeys: input.sortKeys ?? {},
    meta: input.meta,
  };
}

export function bucketMapToGroups<Row, Meta extends Record<string, unknown>>(
  buckets: Map<string, ListGroupBucket<Row, Meta>>,
): Array<ListGroup<Row, Meta>> {
  return Array.from(buckets.values()).map((bucket) => ({
    key: bucket.key,
    kind: bucket.kind,
    label: bucket.label,
    refs: bucket.refs,
    counts: bucket.counts,
    sortKeys: bucket.sortKeys,
    meta: bucket.meta,
    rows: bucket.rows,
  }));
}
