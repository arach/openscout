import { describe, expect, test } from "bun:test";

import {
  collectOccupiedDefinitionIdsFromBrokerSnapshot,
  loadProvisionalAgentNamePool,
  resolveProvisionalAgentName,
} from "./provisional-agent-names.js";

describe("runtime provisional agent names", () => {
  test("collects occupied definition ids from broker agents", () => {
    const occupied = collectOccupiedDefinitionIdsFromBrokerSnapshot({
      agents: {
        "darwin.main.mini": {
          id: "darwin.main.mini",
          definitionId: "darwin",
          handle: "@darwin",
        },
      },
    });
    expect(occupied.has("darwin")).toBe(true);
  });

  test("honors explicit names and otherwise allocates from the pool", () => {
    expect(resolveProvisionalAgentName({
      explicitName: "alpha-reply",
      occupied: new Set(["darwin"]),
    })).toBe("alpha-reply");

    const allocated = resolveProvisionalAgentName({
      occupied: new Set(["darwin"]),
    });
    expect(allocated).not.toBe("darwin");
  });

  test("uses seed parts as a stable allocation offset", () => {
    const input = {
      occupied: new Set<string>(),
      seedParts: ["operator", "/Users/art/dev/openscout", "codex", 2],
    };
    const allocated = resolveProvisionalAgentName(input);
    expect(resolveProvisionalAgentName(input)).toBe(allocated);
    expect(loadProvisionalAgentNamePool()).toContain(allocated);
  });
});
