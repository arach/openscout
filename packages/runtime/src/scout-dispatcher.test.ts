import { describe, expect, test } from "bun:test";

import type { AgentDefinition, AgentEndpoint } from "@openscout/protocol";

import {
  buildAgentLabelCandidates,
  buildDispatchEnvelope,
  resolveAgentLabel,
  type RuntimeSnapshot,
} from "./scout-dispatcher.js";

function makeAgent(input: {
  id: string;
  definitionId: string;
  workspaceQualifier?: string;
  nodeQualifier?: string;
  selector?: string;
  authorityNodeId?: string;
  homeNodeId?: string;
  metadata?: Record<string, unknown>;
}): AgentDefinition {
  return {
    id: input.id,
    kind: "agent",
    displayName: input.id,
    class: "general",
    capabilities: ["chat"],
    harness: "claude",
    wakePolicy: "on_demand",
    authorityNodeId: input.authorityNodeId ?? "node.local",
    homeNodeId: input.homeNodeId ?? input.authorityNodeId ?? "node.local",
    advertiseScope: "local",
    shareMode: "local",
    labels: [],
    metadata: {
      definitionId: input.definitionId,
      ...(input.workspaceQualifier ? { workspaceQualifier: input.workspaceQualifier } : {}),
      ...(input.nodeQualifier ? { nodeQualifier: input.nodeQualifier } : {}),
      ...(input.selector ? { selector: input.selector } : {}),
      ...(input.metadata ?? {}),
    },
  };
}

function makeSnapshot(agents: AgentDefinition[], endpoints: AgentEndpoint[] = []): RuntimeSnapshot {
  const agentMap: Record<string, AgentDefinition> = {};
  for (const agent of agents) agentMap[agent.id] = agent;
  const endpointMap: Record<string, AgentEndpoint> = {};
  for (const endpoint of endpoints) endpointMap[endpoint.id] = endpoint;
  return {
    agents: agentMap,
    endpoints: endpointMap,
    actors: {},
    nodes: {},
    conversations: {},
    bindings: {},
    flights: {},
    messages: [],
    deliveries: [],
    collaborations: {},
    collaborationEvents: [],
  } as unknown as RuntimeSnapshot;
}

function makeEndpoint(input: {
  id: string;
  agentId: string;
  harness: AgentEndpoint["harness"];
  model?: string;
}): AgentEndpoint {
  return {
    id: input.id,
    agentId: input.agentId,
    nodeId: "node.local",
    harness: input.harness,
    transport: input.harness === "codex" ? "codex_app_server" : "claude_stream_json",
    state: "idle",
    metadata: {
      ...(input.model ? { model: input.model } : {}),
    },
  };
}

const helpers = {
  isStale: () => false,
  homeEndpointFor: () => null,
};

describe("resolveAgentLabel", () => {
  test("returns unparseable for empty input", () => {
    const snapshot = makeSnapshot([]);
    expect(resolveAgentLabel(snapshot, "", { helpers }).kind).toBe("unparseable");
    expect(resolveAgentLabel(snapshot, "   ", { helpers }).kind).toBe("unparseable");
  });

  test("returns unknown when no candidate matches", () => {
    const snapshot = makeSnapshot([makeAgent({ id: "arc.main", definitionId: "arc" })]);
    const result = resolveAgentLabel(snapshot, "@nobody", { helpers });
    expect(result.kind).toBe("unknown");
  });

  test("returns resolved when a single candidate matches", () => {
    const snapshot = makeSnapshot([makeAgent({ id: "arc.main", definitionId: "arc" })]);
    const result = resolveAgentLabel(snapshot, "@arc", { helpers });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.agent.id).toBe("arc.main");
    }
  });

  test("routes @scout to the stable OpenScout coordinator", () => {
    const snapshot = makeSnapshot([
      makeAgent({ id: "openscout.main.mini", definitionId: "openscout", nodeQualifier: "mini", workspaceQualifier: "main" }),
      makeAgent({ id: "ranger.main.mini", definitionId: "ranger", nodeQualifier: "mini", workspaceQualifier: "main" }),
    ]);
    const result = resolveAgentLabel(snapshot, "@scout", { helpers });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.agent.id).toBe("openscout.main.mini");
    }
  });

  test("routes @scout to the configured OpenScout project agent when the persona id changed", () => {
    const snapshot = makeSnapshot([
      makeAgent({
        id: "openscout.main.mini",
        definitionId: "openscout",
        nodeQualifier: "mini",
        workspaceQualifier: "main",
        metadata: {
          projectRoot: "/tmp/openscout",
          registrationSource: "manual",
          staleLocalRegistration: true,
        },
      }),
      makeAgent({
        id: "ranger.main.mini",
        definitionId: "ranger",
        nodeQualifier: "mini",
        workspaceQualifier: "main",
        metadata: {
          projectRoot: "/tmp/openscout",
          registrationSource: "manifest",
        },
      }),
    ]);
    const result = resolveAgentLabel(snapshot, "@scout", {
      helpers: {
        ...helpers,
        isStale: (agent) => agent?.metadata?.staleLocalRegistration === true,
      },
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.agent.id).toBe("ranger.main.mini");
    }
    const legacyResult = resolveAgentLabel(snapshot, "@openscout", {
      helpers: {
        ...helpers,
        isStale: (agent) => agent?.metadata?.staleLocalRegistration === true,
      },
    });
    expect(legacyResult.kind).toBe("resolved");
    if (legacyResult.kind === "resolved") {
      expect(legacyResult.agent.id).toBe("ranger.main.mini");
    }
  });

  test("returns ambiguous when multiple agents share the same label", () => {
    const snapshot = makeSnapshot([
      makeAgent({ id: "scoutie.main.mini", definitionId: "scoutie", nodeQualifier: "mini", workspaceQualifier: "main" }),
      makeAgent({ id: "scoutie.mini.main", definitionId: "scoutie", nodeQualifier: "mini", workspaceQualifier: "main" }),
    ]);
    const result = resolveAgentLabel(snapshot, "@scoutie", { helpers });
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((agent) => agent.id).sort()).toEqual([
        "scoutie.main.mini",
        "scoutie.mini.main",
      ]);
    }
  });

  test("local-authority preference collapses cross-node ambiguity", () => {
    const snapshot = makeSnapshot([
      makeAgent({ id: "hudson.local", definitionId: "hudson", authorityNodeId: "node.local" }),
      makeAgent({ id: "hudson.remote", definitionId: "hudson", authorityNodeId: "node.remote" }),
    ]);
    const result = resolveAgentLabel(snapshot, "@hudson", {
      preferLocalNodeId: "node.local",
      helpers,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.agent.id).toBe("hudson.local");
    }
  });

  test("skips stale local agents via helper predicate", () => {
    const fresh = makeAgent({ id: "arc.fresh", definitionId: "arc" });
    const stale = makeAgent({ id: "arc.stale", definitionId: "arc" });
    const snapshot = makeSnapshot([fresh, stale]);
    const result = resolveAgentLabel(snapshot, "@arc", {
      helpers: {
        ...helpers,
        isStale: (agent) => agent?.id === "arc.stale",
      },
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.agent.id).toBe("arc.fresh");
    }
  });

  test("resolves shorthand harness and model labels from endpoint metadata", () => {
    const codex55 = makeAgent({ id: "lattices.codex-55", definitionId: "lattices" });
    const codex54 = makeAgent({ id: "lattices.codex-54", definitionId: "lattices" });
    const claudeSonnet = makeAgent({ id: "lattices.sonnet", definitionId: "lattices" });
    const snapshot = makeSnapshot(
      [codex55, codex54, claudeSonnet],
      [
        makeEndpoint({ id: "endpoint.codex-55", agentId: codex55.id, harness: "codex", model: "gpt-5.5" }),
        makeEndpoint({ id: "endpoint.codex-54", agentId: codex54.id, harness: "codex", model: "gpt-5.4" }),
        makeEndpoint({ id: "endpoint.sonnet", agentId: claudeSonnet.id, harness: "claude", model: "claude-sonnet-4-6" }),
      ],
    );

    const codexResult = resolveAgentLabel(snapshot, "@lattices#codex?5.5", { helpers });
    expect(codexResult.kind).toBe("resolved");
    if (codexResult.kind === "resolved") {
      expect(codexResult.agent.id).toBe("lattices.codex-55");
    }

    const sonnetResult = resolveAgentLabel(snapshot, "@lattices#claude?sonnet", { helpers });
    expect(sonnetResult.kind).toBe("resolved");
    if (sonnetResult.kind === "resolved") {
      expect(sonnetResult.agent.id).toBe("lattices.sonnet");
    }
  });
});

describe("buildAgentLabelCandidates", () => {
  test("surfaces selector aliases from metadata", () => {
    const snapshot = makeSnapshot([
      makeAgent({ id: "hudson.main", definitionId: "hudson", selector: "@huddy" }),
    ]);
    const [candidate] = buildAgentLabelCandidates(snapshot, helpers);
    expect(candidate.aliases).toEqual(["@huddy"]);
    expect(candidate.definitionId).toBe("hudson");
  });
});

describe("buildDispatchEnvelope", () => {
  const snapshot = makeSnapshot([]);

  test("shapes ambiguous envelope with candidate summaries", () => {
    const arcMain = makeAgent({ id: "arc.main", definitionId: "arc", workspaceQualifier: "main" });
    const arcSuper = makeAgent({
      id: "arc.super",
      definitionId: "arc",
      workspaceQualifier: "super-refactor",
    });
    const envelope = buildDispatchEnvelope(
      { kind: "ambiguous", label: "@arc", candidates: [arcMain, arcSuper] },
      "@arc",
      "node.local",
      snapshot,
      helpers,
    );
    expect(envelope.kind).toBe("ambiguous");
    expect(envelope.askedLabel).toBe("@arc");
    expect(envelope.dispatcherNodeId).toBe("node.local");
    expect(envelope.candidates).toHaveLength(2);
    expect(envelope.candidates[0].agentId).toBe("arc.main");
    expect(envelope.candidates[0].workspace).toBe("main");
  });

  test("shapes unknown envelope with no candidates", () => {
    const envelope = buildDispatchEnvelope(
      { kind: "unknown", label: "@ghost" },
      "@ghost",
      "node.local",
      snapshot,
      helpers,
    );
    expect(envelope.kind).toBe("unknown");
    expect(envelope.candidates).toEqual([]);
    expect(envelope.detail).toContain("@ghost");
  });

  test("shapes unparseable envelope", () => {
    const envelope = buildDispatchEnvelope(
      { kind: "unparseable", label: "###" },
      "###",
      "node.local",
      snapshot,
      helpers,
    );
    expect(envelope.kind).toBe("unparseable");
    expect(envelope.askedLabel).toBe("###");
    expect(envelope.detail).toContain("###");
  });
});
