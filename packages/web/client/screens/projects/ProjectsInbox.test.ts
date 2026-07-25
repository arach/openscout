import { describe, expect, mock, test } from "bun:test";

import type { InboxSession } from "./projects-inbox-model.ts";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const session: InboxSession = {
  id: "pomo:session:test-session",
  kind: "session",
  projectSlug: "pomo",
  projectTitle: "Pomo",
  projectRoot: "/workspace/pomo",
  workspaceRoot: "/workspace/pomo",
  agentId: null,
  agentName: "Codex session",
  harness: "codex",
  branch: null,
  work: "Verify the sessions route",
  group: "recent",
  needs: false,
  working: false,
  lastActivityAt: 1_700_000_000_000,
  sessionCount: 1,
  contextPct: null,
  conversationId: null,
  sessionId: "test-session",
  route: { view: "sessions", sessionId: "test-session" },
};

mock.module("./useProjectsInbox.ts", () => ({
  refreshProjectsInbox: () => undefined,
  useProjectsInbox: () => ({
    model: {
      projects: [{
        slug: "pomo",
        title: "Pomo",
        root: "/workspace/pomo",
        agentCount: 0,
        sessionCount: 1,
        liveSessionCount: 0,
        worktreeCount: 0,
        worktrees: [],
        needs: 0,
        working: 0,
        threadCount: 1,
        lastActivityAt: session.lastActivityAt,
        branches: [],
      }],
      threads: [],
      sessions: [session],
    },
    nowMs: 1_700_000_060_000,
    loading: false,
    error: null,
  }),
}));
mock.module("../sessions/SessionRefScreen.tsx", () => ({
  SessionRefScreen: ({ sessionRef }: { sessionRef: string }) => createElement(
    "div",
    { "data-session-ref": sessionRef },
    `Resolved ${sessionRef}`,
  ),
}));

const { ProjectsInbox, ThreadRow } = await import("./ProjectsInbox.tsx");

describe("ProjectsInbox ThreadRow", () => {
  test("renders a project session row with its open affordance", () => {
    const html = renderToStaticMarkup(createElement(ThreadRow, {
      thread: session,
      crossProject: false,
      selected: false,
      cursor: false,
      nowMs: 1_700_000_060_000,
      onSelect: () => undefined,
      onOpen: () => undefined,
      rowRef: () => undefined,
    }));

    expect(html).toContain("Verify the sessions route");
    expect(html).toContain("Open");
    expect(html).toContain("lucide-chevron-right");
  });

  test("opens a scoped session deep link instead of leaving the index visible", () => {
    const html = renderToStaticMarkup(createElement(ProjectsInbox, {
      route: {
        view: "agents-v2",
        projectSlug: "pomo",
        indexView: "sessions",
        sessionId: "test-session",
      },
      navigate: () => undefined,
    }));

    expect(html).toContain('aria-label="Selected session"');
    expect(html).toContain('data-session-ref="test-session"');
    expect(html).toContain("Resolved test-session");
  });
});
