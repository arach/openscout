import { describe, expect, test } from "bun:test";

import { renderSendCommandHelp } from "./send.ts";

describe("renderSendCommandHelp", () => {
  test("documents tell semantics and closed routing choices", () => {
    const help = renderSendCommandHelp();

    expect(help).toContain("Tell or update another agent or an explicit channel.");
    expect(help).toContain("one explicit @agent + no channel   -> DM");
    expect(help).toContain("multiple targets + no channel      -> error");
    expect(help).toContain("Use `scout ask` when the meaning is \"do this and get back to me.\"");
  });
});
