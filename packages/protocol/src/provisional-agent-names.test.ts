import { describe, expect, test } from "bun:test";

import {
  allocateProvisionalAgentName,
  collectOccupiedDefinitionIds,
  definitionIdFromOccupancyKey,
  isProvisionalAgentName,
  parseProvisionalAgentNamesJson,
  parseProvisionalAgentNamesText,
  PROVISIONAL_AGENT_NAMES,
} from "./provisional-agent-names.js";

describe("provisional agent names", () => {
  test("recognizes pool members", () => {
    expect(isProvisionalAgentName("feynman")).toBe(true);
    expect(isProvisionalAgentName("@Darwin")).toBe(true);
    expect(isProvisionalAgentName("openscout")).toBe(false);
  });

  test("extracts definition ids from qualified agent ids", () => {
    expect(definitionIdFromOccupancyKey("feynman.main.mini")).toBe("feynman");
    expect(definitionIdFromOccupancyKey("@mozart.harness:codex")).toBe("mozart");
    expect(definitionIdFromOccupancyKey("openscout-card-abc12345")).toBe("openscout-card-abc12345");
  });

  test("allocates the first free pool name", () => {
    const occupied = collectOccupiedDefinitionIds([
      "darwin.main.mini",
      "@newton",
    ]);
    const name = allocateProvisionalAgentName(occupied);
    expect(name).not.toBe("darwin");
    expect(name).not.toBe("newton");
    expect(POSITIONAL_AGENT_NAMES.has(name)).toBe(true);
  });

  test("falls back to suffixed pool names when the pool is full", () => {
    const occupied = new Set<string>(PROVISIONAL_AGENT_NAMES);
    expect(allocateProvisionalAgentName(occupied, { startIndex: 0 })).toBe(
      `${PROVISIONAL_AGENT_NAMES[0]}-2`,
    );
  });

  test("allocates from a custom pool when provided", () => {
    const occupied = new Set(["ada"]);
    expect(allocateProvisionalAgentName(occupied, { pool: ["ada", "grace"] })).toBe("grace");
  });

  test("parses json pool blobs", () => {
    expect(parseProvisionalAgentNamesText("# team\nada\n@grace\n")).toEqual(["ada", "grace"]);
    expect(parseProvisionalAgentNamesJson('["linus", "ada"]')).toEqual(["linus", "ada"]);
    expect(parseProvisionalAgentNamesJson('{"names":["curie","feynman"]}')).toEqual([
      "curie",
      "feynman",
    ]);
  });
});

const POSITIONAL_AGENT_NAMES = new Set<string>(PROVISIONAL_AGENT_NAMES);