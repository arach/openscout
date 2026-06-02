export function compareStrings(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").toLowerCase().localeCompare((right ?? "").toLowerCase());
}

export function compareNumbersDesc(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  return (right ?? 0) - (left ?? 0);
}

export function normalizeListQuery(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function includesListQuery(fields: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(query));
}
