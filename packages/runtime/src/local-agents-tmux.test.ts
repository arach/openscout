import { describe, expect, test } from "bun:test";

import {
  buildTmuxDispatchStrategy,
  buildTmuxLaunchShellCommand,
  buildTmuxPasteBufferArgs,
  tmuxPaneTailContainsPromptFragment,
  tmuxPaneTailShowsReadyComposer,
} from "./local-agents";

function paneTail(lines: string[]): string {
  return lines.join("\n");
}

const brokerAskPrompt =
  "New broker ask from operator. Task: please refactor the dispatch path so it submits the prompt.";

describe("tmux prompt delivery", () => {
  test("quotes launch scripts with spaces", () => {
    expect(buildTmuxLaunchShellCommand("/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"))
      .toBe('exec bash "/Users/arach/Library/Application Support/OpenScout/runtime/agents/spectator/launch.sh"');
  });

  test("pastes prompts as bracketed raw input before sending one submit key", () => {
    expect(buildTmuxPasteBufferArgs("openscout-prompt-test", "relay-agent")).toEqual([
      "paste-buffer",
      "-dpr",
      "-b",
      "openscout-prompt-test",
      "-t",
      "relay-agent",
    ]);

    const claudeStrategy = buildTmuxDispatchStrategy("claude", brokerAskPrompt);
    const piStrategy = buildTmuxDispatchStrategy("pi", brokerAskPrompt);
    expect(claudeStrategy.pre).toBeUndefined();
    expect(claudeStrategy.submit).toEqual(["Enter"]);
    expect(piStrategy.submit).toEqual(["Enter"]);
  });

  test("verifier treats a composer-held prompt as not submitted", () => {
    const strategy = buildTmuxDispatchStrategy("claude", brokerAskPrompt);
    const stuckTail = paneTail([
      "╭──────────────────────────────────────────────────────────────────╮",
      "│ > New broker ask from operator. Task: please refactor the        │",
      "│   dispatch path so it submits the prompt.                        │",
      "╰──────────────────────────────────────────────────────────────────╯",
    ]);

    expect(strategy.verify(stuckTail)).toBe(false);
  });

  test("verifier treats a collapsed Claude pasted-text composer as not submitted", () => {
    const strategy = buildTmuxDispatchStrategy("claude", brokerAskPrompt);
    const stuckTail = paneTail([
      "───────────────────────────── openscout-card-relay-agent ──",
      "❯ [Pasted text #1]",
      "────────────────────────────────────────────────────────────────────────────────",
      "  ~/dev/openscout   feat/web-design-system  Opus 4.8 (1M context)",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)",
    ]);

    expect(strategy.verify(stuckTail)).toBe(false);
  });

  test("pi verifier does not apply Claude-specific collapsed pasted-text heuristics", () => {
    const strategy = buildTmuxDispatchStrategy("pi", brokerAskPrompt);
    const piTail = paneTail([
      "───────────────────────────── openscout-card-relay-agent ──",
      "❯ [Pasted text #1]",
      "────────────────────────────────────────────────────────────────────────────────",
      "  ~/dev/openscout   model ready",
    ]);

    expect(strategy.verify(piTail)).toBe(true);
  });

  test("verifier treats an empty composer after harness activity as submitted", () => {
    const strategy = buildTmuxDispatchStrategy("claude", brokerAskPrompt);
    const submittedTail = paneTail([
      "● Reading file...",
      "  packages/runtime/src/local-agents.ts",
      "╭──────────────────────────────────────────────────────────────────╮",
      "│ >                                                                │",
      "╰──────────────────────────────────────────────────────────────────╯",
    ]);

    expect(strategy.verify(submittedTail)).toBe(true);
  });
});

describe("tmux Claude readiness detection", () => {
  const cases: Array<{ name: string; tail: string; ready: boolean }> = [
    {
      name: "boot splash before composer",
      ready: false,
      tail: paneTail([
        "Claude Code v2.1.143",
        "Opus 4.7 (1M context) with xhigh effort",
        "~/dev/openscout",
      ]),
    },
    {
      name: "inline ready composer",
      ready: true,
      tail: paneTail([
        " ▐▛███▜▌   Claude Code v2.1.143",
        "▝▜█████▛▘  Opus 4.7 (1M context) with xhigh effort",
        " openscout-relay-agent ",
        "──",
        "❯ Try \"edit broker-daemon.ts to...\"",
        "────────────────────────────────────────────────────────────────────────────────",
        "  Opus 4.7 (1M context) │ main",
        "  -- INSERT -- ⏵⏵ bypass permissions on",
      ]),
    },
    {
      name: "boxed ready composer",
      ready: true,
      tail: paneTail([
        "╭──────────────────────────────────────────────────────────────────╮",
        "│ >                                                                │",
        "╰──────────────────────────────────────────────────────────────────╯",
      ]),
    },
    {
      name: "collapsed pasted text in inline composer",
      ready: false,
      tail: paneTail([
        "───────────────────────────── openscout-card-relay-agent ──",
        "❯ [Pasted text #1]",
        "────────────────────────────────────────────────────────────────────────────────",
        "  ~/dev/openscout   feat/web-design-system  Opus 4.8 (1M context)",
        "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)",
      ]),
    },
    {
      name: "held text in inline composer",
      ready: false,
      tail: paneTail([
        "❯ New broker ask from operator. Task: please refactor the dispatch path",
        "────────────────────────────────────────────────────────────────────────────────",
        "  Sonnet 4.6 │ ⎇ main │ ~/dev/openscout",
        "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)",
      ]),
    },
    {
      name: "ready composer with Claude status-line effort marker",
      ready: true,
      tail: paneTail([
        "▐▛███▜▌   Claude Code v2.1.143",
        "▝▜█████▛▘  Sonnet 4.6 with high effort · Claude Max",
        " ui-dead-code-review-card-relay-agent ──",
        "❯ ",
        "────────────────────────────────────────────────────────────────────────────────",
        "  Sonnet 4.6 │ ⎇ sco-050-backend │ session-id │ ~/dev/openscout",
        "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · gh auth login",
        "                                                                      0 tokens",
        "                                                              ● high · /effort",
      ]),
    },
    {
      name: "active tool output below composer",
      ready: false,
      tail: paneTail([
        "❯ New broker ask from operator. Task: inspect the dispatch path",
        "",
        "⏺ Read(packages/runtime/src/local-agents.ts)",
        "  ⎿  Read 40 lines",
      ]),
    },
  ];

  for (const entry of cases) {
    test(entry.name, () => {
      expect(tmuxPaneTailShowsReadyComposer(entry.tail)).toBe(entry.ready);
    });
  }
});

describe("tmux prompt-fragment detection", () => {
  const cases: Array<{ name: string; tail: string; containsPrompt: boolean }> = [
    {
      name: "boxed composer still contains prompt",
      containsPrompt: true,
      tail: paneTail([
        "╭──────────────────────────────────────────────────────────────────╮",
        "│ > New broker ask from operator. Task: please refactor the        │",
        "│   dispatch path so it submits the prompt.                        │",
        "╰──────────────────────────────────────────────────────────────────╯",
      ]),
    },
    {
      name: "inline composer still contains prompt",
      containsPrompt: true,
      tail: paneTail([
        "❯ New broker ask from operator. Task: please refactor the",
        "  dispatch path so it submits the prompt.",
      ]),
    },
    {
      name: "empty boxed composer after submission",
      containsPrompt: false,
      tail: paneTail([
        "● Reading file...",
        "  packages/runtime/src/local-agents.ts",
        "╭──────────────────────────────────────────────────────────────────╮",
        "│ >                                                                │",
        "╰──────────────────────────────────────────────────────────────────╯",
      ]),
    },
    {
      name: "submitted prompt text remains in transcript above idle composer",
      containsPrompt: false,
      tail: paneTail([
        "  New broker ask from operator. Task: please refactor the dispatch",
        "  path so it submits the prompt.",
        "",
        "⏺ Read(/Users/arach/dev/openscout/packages/runtime/src/local-agents.ts)",
        "  ⎿  Read 30 lines",
        "",
        "───────────────────────────── openscout-review-relay-agent ──",
        "❯ ",
        "────────────────────────────────────────────────────────────────────────────────",
        "  Sonnet 4.6 │ ⎇ main │ ~/dev/openscout",
        "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)",
      ]),
    },
    {
      name: "active harness output is not a stuck composer",
      containsPrompt: false,
      tail: paneTail([
        "New broker ask from operator. Task: please refactor the dispatch path so it submits the prompt.",
        "",
        "⏺ Grep(pattern: \"sendTmuxPrompt\")",
        "  ⎿  Found 2 files",
      ]),
    },
    {
      name: "empty pane tail is not stuck",
      containsPrompt: false,
      tail: "",
    },
  ];

  for (const entry of cases) {
    test(entry.name, () => {
      expect(tmuxPaneTailContainsPromptFragment(entry.tail, brokerAskPrompt)).toBe(entry.containsPrompt);
    });
  }
});
