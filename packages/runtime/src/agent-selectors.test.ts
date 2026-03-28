import { describe, expect, test } from "bun:test";

import {
  extractAgentSelectors,
  formatAgentSelector,
  parseAgentSelector,
  resolveAgentSelector,
} from "@openscout/protocol";

describe("agent selector parsing", () => {
  test("parses bare, node-qualified, workspace-qualified, and fully-qualified selectors", () => {
    expect(parseAgentSelector("@fabric")).toEqual({
      raw: "fabric",
      label: "@fabric",
      definitionId: "fabric",
    });

    expect(parseAgentSelector("@fabric@laptop")).toEqual({
      raw: "fabric@laptop",
      label: "@fabric@laptop",
      definitionId: "fabric",
      nodeQualifier: "laptop",
    });

    expect(parseAgentSelector("@fabric#feature/x")).toEqual({
      raw: "fabric#feature/x",
      label: "@fabric#feature-x",
      definitionId: "fabric",
      workspaceQualifier: "feature-x",
    });

    expect(parseAgentSelector("@fabric@laptop#feature/x")).toEqual({
      raw: "fabric@laptop#feature/x",
      label: "@fabric@laptop#feature-x",
      definitionId: "fabric",
      nodeQualifier: "laptop",
      workspaceQualifier: "feature-x",
    });
  });

  test("extracts unique selectors from message text", () => {
    expect(extractAgentSelectors("Compare @fabric#main with @fabric@laptop#feature-x, then ping @hudson.")).toEqual([
      {
        raw: "fabric#main",
        label: "@fabric#main",
        definitionId: "fabric",
        workspaceQualifier: "main",
      },
      {
        raw: "fabric@laptop#feature-x",
        label: "@fabric@laptop#feature-x",
        definitionId: "fabric",
        nodeQualifier: "laptop",
        workspaceQualifier: "feature-x",
      },
      {
        raw: "hudson",
        label: "@hudson",
        definitionId: "hudson",
      },
    ]);
  });
});

describe("agent selector resolution", () => {
  const candidates = [
    {
      agentId: "fabric",
      definitionId: "fabric",
      nodeQualifier: "mac-mini",
      workspaceQualifier: "main",
      aliases: [formatAgentSelector({ definitionId: "fabric" })],
    },
    {
      agentId: "fabric-laptop",
      definitionId: "fabric",
      nodeQualifier: "laptop",
      workspaceQualifier: "feature-x",
    },
  ];

  test("prefers exact definition id for bare selectors", () => {
    const selector = parseAgentSelector("@fabric");
    expect(selector).not.toBeNull();
    expect(resolveAgentSelector(selector!, candidates)).toEqual(candidates[0]);
  });

  test("resolves qualified selectors to the matching instance candidate", () => {
    const selector = parseAgentSelector("@fabric@laptop#feature-x");
    expect(selector).not.toBeNull();
    expect(resolveAgentSelector(selector!, candidates)).toEqual(candidates[1]);
  });
});
