import type {
  MissionBrief,
  MissionTreeNode,
  PlanChange,
  PlanRisk,
  ToolTickerItem,
} from "./types.ts";

export function getMockMission(): MissionBrief {
  return {
    title: "Ship Hudson SDK 0.3",
    goal: "Hudson SDK 0.3 reaches consumer apps (Premotion first) with a stable public API, clean upgrade path from 0.2.x, and docs good enough that a new agent can integrate without human help.",
    rationale: "Premotion is blocked on API churn. 0.2.x has shipped the two breaking fixes already as 0.2.0-1. The shape of the final 0.3 API is clear from the last three days of consumer feedback.",
    deadline: "Friday",
    confidence: 0.72,
    lastReproposedMinsAgo: 4,
  };
}

export function getMockTree(): MissionTreeNode {
  return {
    id: "root",
    kind: "mission",
    title: "Ship Hudson SDK 0.3",
    state: "inflight",
    confidence: 0.72,
    children: [
      {
        id: "t1",
        kind: "phase",
        title: "Stabilize API surface",
        state: "inflight",
        confidence: 0.85,
        children: [
          {
            id: "t1a",
            kind: "task",
            title: "Freeze public API surface",
            why: "0.2.0-1 shipped the two breaking fixes; API is now stable",
            state: "done",
            confidence: 1,
          },
          {
            id: "t1b",
            kind: "task",
            title: "Audit breaking changes since 0.2.0",
            why: "Need a clear changelog for consumers",
            state: "done",
            assignee: "hudson",
            confidence: 1,
          },
          {
            id: "t1c",
            kind: "task",
            title: "Publish 0.2.0-1 with consumer fixes",
            why: "Unblocks Premotion immediately",
            state: "done",
            assignee: "hudson",
            confidence: 1,
          },
        ],
      },
      {
        id: "t2",
        kind: "phase",
        title: "Consumer integration",
        state: "inflight",
        confidence: 0.6,
        children: [
          {
            id: "t2a",
            kind: "task",
            title: "Integrate Hudson SDK into Next.js app router",
            why: "Premotion's web app is the first consumer",
            state: "inflight",
            assignee: "premotion",
            confidence: 0.5,
            detail: "resolving @hudsonsdk/sdk imports",
            progress: 0.4,
          },
          {
            id: "t2b",
            kind: "task",
            title: "Validate scout 0.2.51 report against current checkout",
            why: "Ensures the SDK report matches the actual binary",
            state: "inflight",
            assignee: "scout",
            confidence: 0.7,
            detail: "awaiting operator review",
            progress: 0.6,
          },
          {
            id: "t2c",
            kind: "task",
            title: "New agent onboarding experience report",
            why: "Tests whether a fresh agent can integrate without help",
            state: "done",
            assignee: "opensearch",
            confidence: 1,
          },
        ],
      },
      {
        id: "t3",
        kind: "phase",
        title: "Identity & trust",
        state: "stuck",
        confidence: 0.3,
        children: [
          {
            id: "t3a",
            kind: "task",
            title: "Resolve cross-workspace identity model",
            why: "Blocking all of phase 3. Oldest unresolved ask.",
            state: "stuck",
            assignee: "quill",
            stuckMins: 128,
            detail: "blocked on operator decision for 2h 08m",
          },
          {
            id: "t3b",
            kind: "task",
            title: "Implement trust propagation across workspaces",
            why: "Depends on identity model decision",
            state: "proposed",
            confidence: 0,
          },
        ],
      },
      {
        id: "t4",
        kind: "phase",
        title: "Release",
        state: "proposed",
        confidence: 0,
        children: [
          {
            id: "t4a",
            kind: "task",
            title: "Cut 0.3 release with changelog",
            state: "proposed",
          },
          {
            id: "t4b",
            kind: "task",
            title: "Publish to npm registry",
            state: "proposed",
          },
        ],
      },
    ],
  };
}

export function getMockChanges(): PlanChange[] {
  return [
    {
      id: "c1",
      kind: "split",
      summary: 'Split "consumer integration" into integration + doc-the-pattern',
      why: "Premotion's integration is surfacing patterns other consumers will need. Doc task deserves its own owner.",
      status: "pending",
      minsAgo: 4,
    },
    {
      id: "c2",
      kind: "demote",
      summary: 'Demoted "identity model" from committed to stuck',
      why: "Quill has been blocked on operator decision for 2h 08m. No forward motion possible until trust model is chosen.",
      status: "pending",
      minsAgo: 18,
    },
    {
      id: "c3",
      kind: "unassign",
      summary: 'Unassigned Quill from "prototype identity handshake"',
      why: "Task is blocked upstream. Quill can be redeployed to doc work while waiting.",
      status: "pending",
      minsAgo: 31,
    },
  ];
}

export function getMockRisks(): PlanRisk[] {
  return [
    {
      id: "r1",
      title: "Identity RFC blocker",
      detail: "Blocking all of phase 3. Oldest unresolved ask.",
      severity: "high",
    },
    {
      id: "r2",
      title: "Next.js 15 upgrade scope",
      detail: "Premotion's upgrade may surface new breaking changes in the SDK.",
      severity: "med",
    },
  ];
}

export function getMockToolTicker(): ToolTickerItem[] {
  return [
    { agent: "hudson", tool: "pnpm test", result: "42 passing" },
    { agent: "premotion", tool: "read packages/cli/bin/scout.mjs", result: "4.2kb" },
    { agent: "scout", tool: "git diff v0.2.51", result: "+12 -8" },
    { agent: "hudson", tool: "pnpm build sdk", result: "ok" },
    { agent: "quill", tool: "read rfcs/rfc-identity.md", result: "8.1kb" },
    { agent: "scout", tool: "claude.complete", result: "234 tokens" },
    { agent: "premotion", tool: "edit next.config.js", result: "+2 lines" },
    { agent: "opensearch", tool: "md lint docs/", result: "0 issues" },
    { agent: "hudson", tool: "tsc --noEmit", result: "ok" },
  ];
}
