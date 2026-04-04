import { describe, expect, test } from "bun:test";

import {
  constructAgentIdentity,
  extractAgentIdentities,
  formatAgentIdentity,
  parseAgentIdentity,
  parseAgentSelector,
  resolveAgentIdentity,
  resolveAgentSelector,
} from "./agent-identity.js";

describe("agent identity grammar", () => {
  test("parses bare, positional, and typed identities", () => {
    expect(parseAgentIdentity("@arc")).toEqual({
      raw: "arc",
      label: "@arc",
      definitionId: "arc",
    });

    expect(parseAgentIdentity("@arc.main")).toEqual({
      raw: "arc.main",
      label: "@arc.main",
      definitionId: "arc",
      workspaceQualifier: "main",
    });

    expect(parseAgentIdentity("@arc.main.profile:dev-browser.harness:claude")).toEqual({
      raw: "arc.main.profile:dev-browser.harness:claude",
      label: "@arc.main.profile:dev-browser.harness:claude",
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "dev-browser",
      harness: "claude",
    });

    expect(parseAgentIdentity("@arc.profile:dev.main")).toEqual({
      raw: "arc.profile:dev.main",
      label: "@arc.main.profile:dev",
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "dev",
    });

    expect(parseAgentIdentity("@arc.branch:super/refactor.persona:dev-browser.runtime:codex.node:mini")).toEqual({
      raw: "arc.branch:super/refactor.persona:dev-browser.runtime:codex.node:mini",
      label: "@arc.super-refactor.profile:dev-browser.harness:codex.node:mini",
      definitionId: "arc",
      workspaceQualifier: "super-refactor",
      profile: "dev-browser",
      harness: "codex",
      nodeQualifier: "mini",
    });
  });

  test("rejects invalid and legacy-shaped identities", () => {
    expect(parseAgentIdentity("")).toBeNull();
    expect(parseAgentIdentity("@arc.main.dev")).toBeNull();
    expect(parseAgentIdentity("@arc.profile:")).toBeNull();
    expect(parseAgentIdentity("@arc@mini#main")).toBeNull();
  });

  test("constructs canonical agent identities", () => {
    expect(constructAgentIdentity({
      definitionId: "Arc",
      workspaceQualifier: "Super Refactor",
      profile: "Dev Browser",
      harness: "Claude",
      nodeQualifier: "Mini.local",
    })).toEqual({
      raw: "arc.super-refactor.profile:dev-browser.harness:claude.node:mini-local",
      label: "@arc.super-refactor.profile:dev-browser.harness:claude.node:mini-local",
      definitionId: "arc",
      workspaceQualifier: "super-refactor",
      profile: "dev-browser",
      harness: "claude",
      nodeQualifier: "mini-local",
    });
  });

  test("formats canonical identities", () => {
    expect(formatAgentIdentity({
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "dev-browser",
      harness: "claude",
      nodeQualifier: "mini",
    })).toBe("@arc.main.profile:dev-browser.harness:claude.node:mini");
  });

  test("extracts unique identities from text", () => {
    expect(extractAgentIdentities(
      "Compare @arc.main.profile:dev-browser with @hudson, then ping @arc.main.profile:dev-browser.",
    )).toEqual([
      {
        raw: "arc.main.profile:dev-browser",
        label: "@arc.main.profile:dev-browser",
        definitionId: "arc",
        workspaceQualifier: "main",
        profile: "dev-browser",
      },
      {
        raw: "hudson",
        label: "@hudson",
        definitionId: "hudson",
      },
    ]);
  });

  test("keeps selector aliases as thin compatibility exports", () => {
    expect(parseAgentSelector("@arc.main.profile:dev")).toEqual({
      raw: "arc.main.profile:dev",
      label: "@arc.main.profile:dev",
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "dev",
    });
  });
});

describe("agent identity resolution", () => {
  const candidates = [
    {
      agentId: "arc.default",
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "base",
      harness: "codex",
      aliases: [formatAgentIdentity({ definitionId: "arc" })],
    },
    {
      agentId: "arc.browser",
      definitionId: "arc",
      workspaceQualifier: "main",
      profile: "dev-browser",
      harness: "codex",
    },
    {
      agentId: "arc.claude",
      definitionId: "arc",
      workspaceQualifier: "super-refactor",
      profile: "dev-browser",
      harness: "claude",
      nodeQualifier: "mini",
    },
  ];

  test("prefers explicit default aliases for bare identities", () => {
    const identity = parseAgentIdentity("@arc");
    expect(identity).not.toBeNull();
    expect(resolveAgentIdentity(identity!, candidates)).toEqual(candidates[0]);
  });

  test("resolves typed qualifiers to the matching concrete agent", () => {
    const identity = parseAgentIdentity("@arc.main.profile:dev-browser");
    expect(identity).not.toBeNull();
    expect(resolveAgentIdentity(identity!, candidates)).toEqual(candidates[1]);
  });

  test("resolves fully qualified identities including harness and node", () => {
    const identity = parseAgentIdentity("@arc.super-refactor.profile:dev-browser.harness:claude.node:mini");
    expect(identity).not.toBeNull();
    expect(resolveAgentIdentity(identity!, candidates)).toEqual(candidates[2]);
  });

  test("returns null for ambiguous non-default partial identities", () => {
    const identity = parseAgentIdentity("@arc.profile:dev-browser");
    expect(identity).not.toBeNull();
    expect(resolveAgentIdentity(identity!, candidates)).toBeNull();
  });

  test("keeps selector resolution aliases as thin compatibility exports", () => {
    const identity = parseAgentSelector("@arc.main.profile:dev-browser");
    expect(identity).not.toBeNull();
    expect(resolveAgentSelector(identity!, candidates)).toEqual(candidates[1]);
  });
});
