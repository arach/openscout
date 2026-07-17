import { describe, expect, test } from "bun:test";

import {
  cleanHeadlineText,
  displaySnippet,
  groupHitsBySession,
  highlightParts,
  isMachineChunkTitle,
  KNOWLEDGE_SEARCH_DEFAULTS,
  matchReason,
  queryTerms,
  resultMomentHeadline,
  resultSessionGoal,
  resultRoutingContext,
  resultTurnLabel,
  type KnowledgeHit,
} from "./knowledge-search.ts";

function hit(input: {
  chunkId?: string;
  collectionId?: string;
  snippet?: string;
  title?: string;
  project?: string;
  harness?: string;
  sessionId?: string;
  recordRange?: [number, number];
  recordKind?: string[];
  documentKind?: string;
}): KnowledgeHit {
  const chunkId = input.chunkId ?? "chunk-1";
  const sessionId = input.sessionId ?? "sess-abcdef012345";
  return {
    id: `hit:${chunkId}`,
    collectionId: input.collectionId ?? "collection-1",
    documentId: `document-${chunkId}`,
    chunkId,
    title: input.title ?? "Session",
    snippet: input.snippet ?? "",
    score: 0,
    scoreSource: "fts",
    origin: "mechanical",
    ownership: "derived",
    freshness: "unknown",
    sourceRefs: input.recordRange
      ? [{
        kind: "harness_transcript",
        harness: input.harness ?? "codex",
        path: { root: "HOME", relPath: `.codex/${sessionId}.jsonl` },
        sessionId,
        recordRange: input.recordRange,
      }]
      : [],
    facets: {
      ...(input.project ? { project: input.project } : {}),
      ...(input.harness ? { harness: input.harness } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.documentKind ? { documentKind: input.documentKind } : {}),
      ...(input.recordKind ? { recordKind: input.recordKind } : {}),
    },
  };
}

describe("knowledge search helpers", () => {
  test("exposes smart defaults for indexing and search", () => {
    expect(KNOWLEDGE_SEARCH_DEFAULTS.days).toBe(3);
    expect(KNOWLEDGE_SEARCH_DEFAULTS.sessionLimit).toBeGreaterThan(0);
    expect(KNOWLEDGE_SEARCH_DEFAULTS.hitLimit).toBeGreaterThan(0);
    expect(KNOWLEDGE_SEARCH_DEFAULTS.debounceMs).toBeGreaterThan(0);
  });

  test("splits query terms and highlights only token-ish matches", () => {
    expect(queryTerms("embed /projects view")).toEqual(["embed", "/projects", "view"]);
    const prose = highlightParts("embed selected chunks for /projects", "embed /projects");
    expect(prose.some((part) => part.match && part.text.toLowerCase() === "embed")).toBe(true);
    expect(prose.some((part) => part.match && part.text === "/projects")).toBe(true);

    const pathNoise = highlightParts("see ~/.kimi-code/bin and kimi.com docs about Kimi", "kimi");
    expect(pathNoise.filter((part) => part.match).map((part) => part.text)).toEqual(["Kimi"]);
  });

  test("cleans event-window markers and path noise from snippets", () => {
    const dirty = "We should embed chunks - [0234] `assistant_turn` - {\"raw\":true}";
    expect(displaySnippet(hit({ snippet: dirty }), "embed")).toContain("We should embed chunks");
    expect(displaySnippet(hit({ snippet: dirty }), "embed")).not.toContain("assistant_turn");

    const pathy = "Updating adapter path to ~/.kimi-code/bin/kimi for Kimi discovery";
    const cleaned = displaySnippet(hit({ snippet: pathy }), "kimi");
    expect(cleaned.toLowerCase()).toContain("kimi discovery");
    expect(cleaned).not.toContain("~/.kimi");
    expect(matchReason(hit({ snippet: "embeddings provider", title: "Embeddings work" }), "embeddings")).toBe(
      "Matched “embeddings”",
    );
  });

  test("groups chunk hits into sessions and sorts moments by turn", () => {
    const groups = groupHitsBySession([
      hit({ chunkId: "late", collectionId: "s1", recordRange: [200, 249], title: "Events window 3" }),
      hit({ chunkId: "early", collectionId: "s1", recordRange: [40, 89], title: "Events window 1" }),
      hit({ chunkId: "c", collectionId: "s2", title: "Routing redesign", project: "openscout" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.moments.map((moment) => moment.chunkId)).toEqual(["early", "late"]);
    expect(groups[0]?.best.chunkId).toBe("late"); // ranking order preserved for best
    expect(groups[1]?.best.chunkId).toBe("c");
  });

  test("session goal vs moment headline", () => {
    expect(isMachineChunkTitle("Events window 3")).toBe(true);
    expect(resultSessionGoal(hit({ title: "Events window 3", project: "openscout" }))).toBe("openscout");
    expect(
      resultSessionGoal(hit({
        title: "Codex openscout Jul 16 at 5:42 PM - <recommended_plugins> Here is a list of plugins",
        project: "openscout",
      })),
    ).toContain("list of plugins");

    const moment = hit({
      title: "Codex openscout Jul 16 at 5:42 PM - Here is a list of plugins",
      snippet: "Adding native Kimi source for session details in the tail firehose.",
      recordKind: ["assistant_turn"],
      recordRange: [40, 89],
    });
    expect(resultMomentHeadline(moment, "kimi")).toContain("Kimi source");
    expect(resultMomentHeadline(moment, "kimi")).not.toContain("list of plugins");
  });

  test("strips harness/date noise from session titles", () => {
    expect(
      cleanHeadlineText(
        "Codex openscout Jul 16 at 5:37 PM - <recommended_plugins> Here is a list of plugins that are available but not inst…",
      ),
    ).toBe("Here is a list of plugins that are available but not inst…");
  });

  test("windows long snippets around the query match", () => {
    const long = `prefix noise ${"x ".repeat(80)} does kimi support acp style adapter ${"y ".repeat(80)} trailing`;
    const snippet = displaySnippet(hit({ snippet: long }), "kimi");
    expect(snippet.toLowerCase()).toContain("kimi");
    expect(snippet.length).toBeLessThan(long.length);
  });

  test("exposes agent, session, and turn routing context", () => {
    const entry = hit({
      harness: "codex",
      project: "openscout",
      sessionId: "mro0fyeu-h89xnv-extra",
      recordRange: [40, 89],
      documentKind: "events",
      recordKind: ["user_turn", "assistant_turn", "command_or_tool"],
      title: "Codex openscout Jul 16 at 5:37 PM - plugin list",
    });
    expect(resultTurnLabel(entry)).toBe("turns 40–89");
    expect(resultRoutingContext(entry)).toEqual({
      agent: "Codex",
      project: "openscout",
      session: "mro0fyeu",
      when: "Jul 16 at 5:37 PM",
      turn: "turns 40–89",
      role: "user · assistant · tool",
      where: "conversation",
    });
  });
});
