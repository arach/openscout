import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { scoutBrokerPaths } from "@openscout/protocol";

type LiteralRouteBranch = {
  method: string;
  path: string;
  line: number;
};

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function routerSource(fileName: string): string {
  return readFileSync(join(import.meta.dir, fileName), "utf8");
}

function brokerHttpRouterSource(): string {
  return routerSource("broker-http-router.ts");
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

function routePatternFromRegexSource(pattern: string): string {
  return pattern
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replaceAll("([^/]+)", ":id")
    .replaceAll("\\/", "/")
    .replaceAll("\\.", ".");
}

// Extracts every "METHOD path" route the router dispatches on, covering the
// dispatch shapes used in broker-http-router.ts and
// broker-http-entity-write-routes.ts:
//   - method === "M" && url.pathname === "P" (and the flipped order)
//   - method === "M" && (url.pathname === "P1" || url.pathname === "P2" || …)
//   - (url.pathname === "P1" || url.pathname === "P2") && method === "M"
//   - (method === "M1" || method === "M2") && url.pathname === "P"
//   - const xMatch = method === "M" [|| method === "M2"] ? url.pathname.match(/…/) : null
//   - method === "M" && url.pathname.startsWith("P")
// Param captures ([^/]+) are rendered as ":id".
function extractRouteInventory(source: string): Set<string> {
  const text = source.replace(/\s+/g, " ");
  const routes = new Set<string>();

  // const xMatch = method === "M" [|| method === "M2"] ? url.pathname.match(/…/) : null
  for (const match of text.matchAll(
    /method === "([A-Z]+)"(?: \|\| method === "([A-Z]+)")? \? url\.pathname\.match\(\/([^ ]+?)\/\) : null/g,
  )) {
    const path = routePatternFromRegexSource(match[3] ?? "");
    for (const method of [match[1], match[2]]) {
      if (method) routes.add(`${method} ${path}`);
    }
  }

  // method === "M" && (url.pathname === "P1" || url.pathname === "P2" || …)
  for (const match of text.matchAll(
    /method === "([A-Z]+)" && \(([^()]*url\.pathname === [^()]*)\)/g,
  )) {
    for (const path of (match[2] ?? "").matchAll(/url\.pathname === "([^"]+)"/g)) {
      routes.add(`${match[1]} ${path[1]}`);
    }
  }

  // (url.pathname === "P1" || url.pathname === "P2") && method === "M"
  for (const match of text.matchAll(
    /\((url\.pathname === "[^"]+"(?: \|\| url\.pathname === "[^"]+")*)\) && method === "([A-Z]+)"/g,
  )) {
    for (const path of (match[1] ?? "").matchAll(/url\.pathname === "([^"]+)"/g)) {
      routes.add(`${match[2]} ${path[1]}`);
    }
  }

  // (method === "M1" || method === "M2") && url.pathname === "P"
  for (const match of text.matchAll(
    /\(method === "([A-Z]+)" \|\| method === "([A-Z]+)"\) && url\.pathname === "([^"]+)"/g,
  )) {
    routes.add(`${match[1]} ${match[3]}`);
    routes.add(`${match[2]} ${match[3]}`);
  }

  // method === "M" && url.pathname === "P" (and the flipped order)
  for (const match of text.matchAll(/method === "([A-Z]+)" && url\.pathname === "([^"]+)"/g)) {
    routes.add(`${match[1]} ${match[2]}`);
  }
  for (const match of text.matchAll(/url\.pathname === "([^"]+)" && method === "([A-Z]+)"/g)) {
    routes.add(`${match[2]} ${match[1]}`);
  }

  // method === "M" && url.pathname.startsWith("P")
  for (const match of text.matchAll(
    /method === "([A-Z]+)" && url\.pathname\.startsWith\("([^"]+)"\)/g,
  )) {
    routes.add(`${match[1]} ${match[2]}:id`);
  }

  return routes;
}

// The checked-in broker HTTP route inventory ("METHOD path", sorted). This is
// the wire contract served by broker-http-router.ts +
// broker-http-entity-write-routes.ts. If a test run diffs against this list,
// a route was added, dropped, or renamed: update the list only when the change
// is intentional, and remember mesh (/v1/mesh/*) and A2A paths are external
// contracts consumed by peer brokers and outside clients.
const expectedRouteInventory = [
  "DELETE /v1/endpoints/:id",
  "GET /.host-info",
  "GET /.well-known/agent-card.json",
  "GET /health",
  "GET /v1/a2a/agent-card.json",
  "GET /v1/a2a/agents/:id/agent-card.json",
  "GET /v1/activity",
  "GET /v1/agent-cards",
  "GET /v1/broker/messages",
  "GET /v1/capabilities",
  "GET /v1/capabilities/availability",
  "GET /v1/collaboration/events",
  "GET /v1/collaboration/records",
  "GET /v1/conversations/:id/read-cursors",
  "GET /v1/conversations/:id/thread-events",
  "GET /v1/conversations/:id/thread-snapshot",
  "GET /v1/deliveries",
  "GET /v1/delivery-attempts",
  "GET /v1/events",
  "GET /v1/events/stream",
  "GET /v1/home",
  "GET /v1/inbox",
  "GET /v1/inbox/stream",
  "GET /v1/invocations/:id",
  "GET /v1/invocations/:id/lifecycle",
  "GET /v1/invocations/:id/stream",
  "GET /v1/mesh/nodes",
  "GET /v1/messages",
  "GET /v1/missions/:id/log",
  "GET /v1/node",
  "GET /v1/pairing/sessions",
  "GET /v1/repo-watch/snapshot",
  "GET /v1/repo-watch/warm",
  "GET /v1/roles/assignments",
  "GET /v1/roles/catalog",
  "GET /v1/snapshot",
  "GET /v1/tail/discover",
  "GET /v1/tail/recent",
  "GET /v1/thread-watches/:id/stream",
  "GET /v1/topology/snapshot",
  "GET /v1/web/status",
  "OPTIONS /v1/web/restart",
  "OPTIONS /v1/web/start",
  "OPTIONS /v1/web/status",
  "POST /a2a",
  "POST /v1/a2a/agents/:id/rpc",
  "POST /v1/a2a/rpc",
  "POST /v1/actors",
  "POST /v1/agent-cards",
  "POST /v1/agents",
  "POST /v1/bindings",
  "POST /v1/collaboration/events",
  "POST /v1/collaboration/records",
  "POST /v1/collaboration/records/:id/invoke",
  "POST /v1/commands",
  "POST /v1/conversations",
  "POST /v1/conversations/:id/read-cursors",
  "POST /v1/deliver",
  "POST /v1/deliveries/claim",
  "POST /v1/deliveries/status",
  "POST /v1/delivery-attempts",
  "POST /v1/durable-actions",
  "POST /v1/durable-actions/:id/heartbeat",
  "POST /v1/endpoints",
  "POST /v1/flights",
  "POST /v1/inbox/ack",
  "POST /v1/inbox/claim",
  "POST /v1/inbox/nack",
  "POST /v1/invocations",
  "POST /v1/local-sessions/attach",
  "POST /v1/local-sessions/detach",
  "POST /v1/local-sessions/ensure",
  "POST /v1/mesh/collaboration/events",
  "POST /v1/mesh/collaboration/records",
  "POST /v1/mesh/discover",
  "POST /v1/mesh/invocations",
  "POST /v1/mesh/messages",
  "POST /v1/messages",
  "POST /v1/missions/:id/log",
  "POST /v1/nodes",
  "POST /v1/pairing/attach",
  "POST /v1/pairing/detach",
  "POST /v1/rendezvous/match",
  "POST /v1/repo-watch/warm",
  "POST /v1/roles/assignments",
  "POST /v1/roles/assignments/:id/revoke",
  "POST /v1/thread-watches/close",
  "POST /v1/thread-watches/open",
  "POST /v1/thread-watches/renew",
  "POST /v1/topology/nudge",
  "POST /v1/web/restart",
  "POST /v1/web/start",
];

function liveRouteInventory(): string[] {
  const routes = new Set<string>([
    ...extractRouteInventory(brokerHttpRouterSource()),
    ...extractRouteInventory(routerSource("broker-http-entity-write-routes.ts")),
  ]);
  return [...routes].sort();
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

  test("checked-in inventory stays sorted for readable diffs", () => {
    expect(expectedRouteInventory).toEqual([...expectedRouteInventory].sort());
  });

  test("matches the checked-in route inventory snapshot", () => {
    expect(liveRouteInventory()).toEqual(expectedRouteInventory);
  });

  test("every scoutBrokerPaths entry points at a live route", () => {
    const livePaths = new Set(
      liveRouteInventory().map((route) => route.split(" ")[1]),
    );
    const clientPaths = [scoutBrokerPaths.health, ...Object.values(scoutBrokerPaths.v1)];

    const dead = clientPaths.filter((path) => !livePaths.has(path));
    expect(dead).toEqual([]);
  });
});
