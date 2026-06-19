import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type LiteralRouteBranch = {
  method: string;
  path: string;
  line: number;
};

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function brokerHttpRouterSource(): string {
  return readFileSync(join(import.meta.dir, "broker-http-router.ts"), "utf8");
}

function literalRouteBranches(source: string): LiteralRouteBranch[] {
  const branches: LiteralRouteBranch[] = [];
  const patterns = [
    /method\s*===\s*"([A-Z]+)"\s*&&\s*url\.pathname\s*===\s*"([^"]+)"/g,
    /url\.pathname\s*===\s*"([^"]+)"\s*&&\s*method\s*===\s*"([A-Z]+)"/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const method = pattern === patterns[0] ? match[1] : match[2];
      const path = pattern === patterns[0] ? match[2] : match[1];
      if (!method || !path) continue;
      branches.push({
        method,
        path,
        line: lineNumberAt(source, match.index ?? 0),
      });
    }
  }

  return branches;
}

describe("broker HTTP route inventory", () => {
  test("does not define duplicate exact literal method/path branches", () => {
    const byRoute = new Map<string, LiteralRouteBranch[]>();

    for (const branch of literalRouteBranches(brokerHttpRouterSource())) {
      const key = `${branch.method} ${branch.path}`;
      byRoute.set(key, [...(byRoute.get(key) ?? []), branch]);
    }

    const duplicates = [...byRoute.entries()]
      .filter(([, branches]) => branches.length > 1)
      .map(([route, branches]) => `${route} at lines ${branches.map((branch) => branch.line).join(", ")}`);

    expect(duplicates).toEqual([]);
  });
});
