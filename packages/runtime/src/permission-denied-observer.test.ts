import { afterEach, describe, expect, test } from "bun:test";

import { __testing } from "./permission-denied-observer";
import type { TailEvent } from "./tail/types";

const { classifyDenial, rememberToolUses, resetToolCache } = __testing;

afterEach(() => {
  resetToolCache();
});

function tailEvent(partial: Partial<TailEvent> & Pick<TailEvent, "kind" | "raw">): TailEvent {
  return {
    id: partial.id ?? "evt-1",
    ts: partial.ts ?? 1_700_000_000_000,
    source: partial.source ?? "claude",
    sessionId: partial.sessionId ?? "session-a",
    pid: partial.pid ?? 1234,
    parentPid: partial.parentPid ?? null,
    project: partial.project ?? "openscout",
    cwd: partial.cwd ?? "/Users/arach/dev/openscout",
    harness: partial.harness ?? "unattributed",
    kind: partial.kind,
    summary: partial.summary ?? "",
    raw: partial.raw,
  };
}

const denialContent =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

describe("classifyDenial", () => {
  test("recognizes a canonical Claude denial tool_result", () => {
    const event = tailEvent({
      kind: "tool-result",
      raw: {
        type: "user",
        permissionMode: "default",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              is_error: true,
              content: denialContent,
            },
          ],
        },
      },
    });

    const result = classifyDenial(event);
    expect(result).not.toBeNull();
    expect(result?.toolUseId).toBe("toolu_abc");
    expect(result?.permissionMode).toBe("default");
    expect(result?.sessionId).toBe("session-a");
  });

  test("ignores tool_result errors that aren't permission denials", () => {
    const event = tailEvent({
      kind: "tool-result",
      raw: {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_xyz",
              is_error: true,
              content: "ENOENT: no such file or directory",
            },
          ],
        },
      },
    });

    expect(classifyDenial(event)).toBeNull();
  });

  test("ignores successful tool_result blocks", () => {
    const event = tailEvent({
      kind: "tool-result",
      raw: {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_ok",
              content: "ok",
            },
          ],
        },
      },
    });

    expect(classifyDenial(event)).toBeNull();
  });

  test("enriches with tool_name and input summary when the tool_use was previously remembered", () => {
    rememberToolUses(
      tailEvent({
        kind: "tool",
        raw: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_abc",
                name: "Bash",
                input: { command: "rm -rf /tmp/foo", description: "cleanup" },
              },
            ],
          },
        },
      }),
    );

    const result = classifyDenial(
      tailEvent({
        kind: "tool-result",
        raw: {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_abc",
                is_error: true,
                content: denialContent,
              },
            ],
          },
        },
      }),
    );

    expect(result?.toolName).toBe("Bash");
    expect(result?.toolInputSummary).toContain("rm -rf");
  });

  test("handles unknown tool_use_id gracefully", () => {
    const result = classifyDenial(
      tailEvent({
        kind: "tool-result",
        raw: {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_not_seen",
                is_error: true,
                content: denialContent,
              },
            ],
          },
        },
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.toolName).toBeNull();
    expect(result?.toolInputSummary).toBeNull();
  });
});
