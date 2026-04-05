// tRPC v11 router for the Bridge server.
//
// Maps every JSON-RPC method from the legacy switch statement in server.ts
// to a typed tRPC procedure with Zod v4 input validation.
//
// Usage:
//   import { bridgeRouter, type BridgeRouter } from "./router.ts";

import { initTRPC, tracked, TRPCError } from "@trpc/server";
import { z } from "zod";

import { log } from "./log.ts";
import { resolveConfig } from "./config.ts";
import type { Bridge } from "./bridge.ts";
import type { SequencedEvent } from "./buffer.ts";
import type { SessionState } from "./state.ts";
import type { ActionBlock, Prompt } from "../protocol/index.ts";
import type { AgentHarness } from "@openscout/protocol";
import {
  createScoutSession,
  getScoutMobileActivity,
  getScoutMobileAgents,
  getScoutMobileHome,
  getScoutMobileSessionSnapshot,
  getScoutMobileSessions,
  getScoutMobileWorkspaces,
  sendScoutMobileMessage,
} from "../../../mobile/service.ts";

import { readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { execSync } from "child_process";
import { basename, isAbsolute, join, relative } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface BridgeContext {
  bridge: Bridge;
  cwd: string;
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<BridgeContext>().create();

// ---------------------------------------------------------------------------
// Middleware: logged — logs method name + timing
// ---------------------------------------------------------------------------

const logged = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  log.info("rpc:req", `-> ${type} ${path}`);
  const result = await next();
  const elapsed = Date.now() - start;
  if (result.ok) {
    log.info("rpc:res", `✓ ${path} (${elapsed}ms)`);
  } else {
    log.error("rpc:res", `✗ ${path} (${elapsed}ms)`);
  }
  return result;
});

const procedure = t.procedure.use(logged);

// ---------------------------------------------------------------------------
// Helpers (ported from server.ts)
// ---------------------------------------------------------------------------

function resolveMobileCurrentDirectory(): string {
  const config = resolveConfig();
  const configuredRoot = config.workspace?.root;
  if (!configuredRoot) return process.cwd();
  try {
    return resolveWorkspaceRoot(configuredRoot);
  } catch {
    return process.cwd();
  }
}

function resolveWorkspaceRoot(root: string): string {
  const expandedRoot = root.replace(/^~/, homedir());
  return realpathSync(expandedRoot);
}

function resolveWorkspacePath(root: string, requestedPath?: string): string {
  const normalizedRoot = resolveWorkspaceRoot(root);
  const expandedPath = requestedPath?.replace(/^~/, homedir());
  const candidate = expandedPath
    ? isAbsolute(expandedPath)
      ? expandedPath
      : join(normalizedRoot, expandedPath)
    : normalizedRoot;
  const resolvedCandidate = realpathSync(candidate);
  const rel = relative(normalizedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return resolvedCandidate;
  }
  throw new Error("Path escapes workspace root");
}

interface DirectoryEntry {
  name: string;
  path: string;
  markers: string[];
}

const MARKER_FILES: [string, string][] = [
  [".git", "git"],
  ["package.json", "node"],
  ["Package.swift", "swift"],
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
  ["pyproject.toml", "python"],
  ["setup.py", "python"],
  ["Gemfile", "ruby"],
  ["build.gradle", "java"],
  ["pom.xml", "java"],
  ["CMakeLists.txt", "cpp"],
  ["Makefile", "make"],
  [".xcodeproj", "xcode"],
];

function listDirectories(dirPath: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const name of readdirSync(dirPath)) {
    if (name.startsWith(".")) continue;
    if (name === "node_modules" || name === ".build" || name === "target") continue;
    const fullPath = join(dirPath, name);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
      const children = new Set(readdirSync(fullPath));
      const markers: string[] = [];
      const seen = new Set<string>();
      for (const [file, marker] of MARKER_FILES) {
        const found = file.startsWith(".")
          ? [...children].some((c) => c.endsWith(file))
          : children.has(file);
        if (found && !seen.has(marker)) {
          markers.push(marker);
          seen.add(marker);
        }
      }
      entries.push({ name, path: fullPath, markers });
    } catch {
      continue;
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function extractProjectName(filePath: string): string {
  const claudeMatch = filePath.match(/\.claude\/projects\/[^/]*-dev-([^/]+)/);
  if (claudeMatch?.[1]) return claudeMatch[1];
  const parts = filePath.split("/");
  return parts[parts.length - 2] || "unknown";
}

function detectAgent(filePath: string): string {
  if (filePath.includes(".claude")) return "claude-code";
  if (filePath.includes(".codex") || filePath.includes("codex")) return "codex";
  if (filePath.includes(".aider") || filePath.includes("aider")) return "aider";
  return "unknown";
}

interface DiscoveredSession {
  path: string;
  project: string;
  agent: string;
  modifiedAt: number;
  sizeBytes: number;
  lineCount: number;
}

async function discoverSessionFiles(
  maxAgeDays: number,
  limit: number,
): Promise<DiscoveredSession[]> {
  const home = homedir();
  const results: DiscoveredSession[] = [];

  const searchPaths = [
    { pattern: `${home}/.claude/projects`, agent: "claude-code" },
    { pattern: `${home}/.codex`, agent: "codex" },
    { pattern: `${home}/.openai-codex`, agent: "codex" },
  ];

  for (const { pattern, agent } of searchPaths) {
    try {
      statSync(pattern);
    } catch {
      continue;
    }
    try {
      const cmd = `find "${pattern}" -name subagents -prune -o -name "*.jsonl" -mtime -${maxAgeDays} -type f -print0 2>/dev/null | xargs -0 stat -f "%m %z %N" 2>/dev/null | sort -rn | head -${limit}`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
      if (!output) continue;
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        const firstSpace = line.indexOf(" ");
        const secondSpace = line.indexOf(" ", firstSpace + 1);
        if (firstSpace === -1 || secondSpace === -1) continue;
        const modifiedAt = parseInt(line.slice(0, firstSpace), 10) * 1000;
        const sizeBytes = parseInt(line.slice(firstSpace + 1, secondSpace), 10);
        const filePath = line.slice(secondSpace + 1);
        results.push({
          path: filePath,
          project: extractProjectName(filePath),
          agent,
          modifiedAt,
          sizeBytes,
          lineCount: 0,
        });
      }
    } catch {
      continue;
    }
  }

  const config = resolveConfig();
  if (config.workspace?.root) {
    const existingPaths = new Set(results.map((r) => r.path));
    try {
      const root = resolveWorkspaceRoot(config.workspace.root);
      const cmd = `find "${root}" -maxdepth 4 -name "*.jsonl" -mtime -${maxAgeDays} -type f -exec stat -f "%m %z %N" {} + 2>/dev/null`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
      if (output) {
        for (const line of output.split("\n")) {
          if (!line.trim()) continue;
          const firstSpace = line.indexOf(" ");
          const secondSpace = line.indexOf(" ", firstSpace + 1);
          if (firstSpace === -1 || secondSpace === -1) continue;
          const modifiedAt = parseInt(line.slice(0, firstSpace), 10) * 1000;
          const sizeBytes = parseInt(line.slice(firstSpace + 1, secondSpace), 10);
          const filePath = line.slice(secondSpace + 1);
          if (existingPaths.has(filePath)) continue;
          results.push({
            path: filePath,
            project: extractProjectName(filePath),
            agent: detectAgent(filePath),
            modifiedAt,
            sizeBytes,
            lineCount: 0,
          });
        }
      }
    } catch {}
  }

  results.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Async iterable adapter for bridge.onEvent()
// ---------------------------------------------------------------------------

/**
 * Converts the callback-based `bridge.onEvent(cb)` into an async iterable
 * that yields SequencedEvents. Respects AbortSignal for cleanup.
 */
function bridgeEventIterable(
  bridge: Bridge,
  signal?: AbortSignal,
): AsyncIterable<SequencedEvent> {
  return {
    [Symbol.asyncIterator]() {
      const buffer: SequencedEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const unsub = bridge.onEvent((event) => {
        if (done) return;
        buffer.push(event);
        if (resolve) {
          resolve();
          resolve = null;
        }
      });

      const cleanup = () => {
        done = true;
        unsub();
        // Wake up any pending next() so it can return { done: true }
        if (resolve) {
          resolve();
          resolve = null;
        }
      };

      signal?.addEventListener("abort", cleanup, { once: true });

      return {
        async next(): Promise<IteratorResult<SequencedEvent>> {
          while (true) {
            if (done) return { done: true, value: undefined };
            if (buffer.length > 0) {
              return { done: false, value: buffer.shift()! };
            }
            // Wait for next event
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
        },
        async return(): Promise<IteratorResult<SequencedEvent>> {
          cleanup();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-routers
// ---------------------------------------------------------------------------

// -- Session ----------------------------------------------------------------

const sessionRouter = t.router({
  create: procedure
    .input(
      z.object({
        adapterType: z.string(),
        name: z.string().optional(),
        cwd: z.string().optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.bridge.createSession(input.adapterType, {
        name: input.name,
        cwd: input.cwd,
        options: input.options,
      });
    }),

  list: procedure.query(({ ctx }) => {
    return ctx.bridge.listSessions();
  }),

  close: procedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.bridge.closeSession(input.sessionId);
      return { ok: true };
    }),

  snapshot: procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input, ctx }) => {
      const snapshot = ctx.bridge.getSessionSnapshot(input.sessionId);
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No session: ${input.sessionId}`,
        });
      }
      return snapshot;
    }),

  resume: procedure
    .input(
      z.object({
        sessionPath: z.string(),
        adapterType: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const sessionFilename = basename(input.sessionPath, ".jsonl");
      const parentDir = input.sessionPath.substring(
        0,
        input.sessionPath.lastIndexOf("/"),
      );
      const dirName = basename(parentDir);

      let cwd: string;
      if (dirName.startsWith("-")) {
        const candidate = "/" + dirName.slice(1).replace(/-/g, "/");
        try {
          statSync(candidate);
          cwd = candidate;
        } catch {
          const config = resolveConfig();
          cwd = config.workspace?.root
            ? resolveWorkspaceRoot(config.workspace.root)
            : process.cwd();
        }
      } else {
        cwd = process.cwd();
      }

      const adapterType = input.adapterType ?? "claude-code";
      const name = input.name ?? extractProjectName(input.sessionPath);

      return ctx.bridge.createSession(adapterType, {
        name,
        cwd,
        options: { resume: sessionFilename },
      });
    }),
});

// -- Mobile -----------------------------------------------------------------

const mobileRouter = t.router({
  home: procedure
    .input(
      z
        .object({
          workspaceLimit: z.number().optional(),
          agentLimit: z.number().optional(),
          sessionLimit: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getScoutMobileHome({
        currentDirectory: resolveMobileCurrentDirectory(),
        workspaceLimit: input?.workspaceLimit,
        agentLimit: input?.agentLimit,
        sessionLimit: input?.sessionLimit,
      });
    }),

  workspaces: procedure
    .input(
      z
        .object({
          query: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getScoutMobileWorkspaces(input, resolveMobileCurrentDirectory());
    }),

  agents: procedure
    .input(
      z
        .object({
          query: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getScoutMobileAgents(input, resolveMobileCurrentDirectory());
    }),

  sessions: procedure
    .input(
      z
        .object({
          query: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getScoutMobileSessions(input, resolveMobileCurrentDirectory());
    }),

  sessionSnapshot: procedure
    .input(
      z.object({
        conversationId: z.string().optional(),
        sessionId: z.string().optional(),
        beforeTurnId: z.string().nullable().optional(),
        limit: z.number().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      const conversationId = input.conversationId ?? input.sessionId;
      if (!conversationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "conversationId is required",
        });
      }
      return getScoutMobileSessionSnapshot(
        conversationId,
        {
          beforeTurnId: input.beforeTurnId ?? null,
          limit: typeof input.limit === "number" ? input.limit : null,
        },
        resolveMobileCurrentDirectory(),
      );
    }),

  createSession: procedure
    .input(
      z.object({
        workspaceId: z.string(),
        harness: z.string().optional() as z.ZodOptional<z.ZodType<AgentHarness>>,
        agentName: z.string().optional(),
        worktree: z.string().nullable().optional(),
        profile: z.string().nullable().optional(),
        branch: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return createScoutSession(
        input,
        resolveMobileCurrentDirectory(),
        ctx.deviceId,
      );
    }),

  sendMessage: procedure
    .input(
      z.object({
        agentId: z.string(),
        body: z.string(),
        clientMessageId: z.string().nullable().optional(),
        replyToMessageId: z.string().nullable().optional(),
        referenceMessageIds: z.array(z.string()).optional(),
        harness: z.string().optional() as z.ZodOptional<z.ZodType<AgentHarness>>,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return sendScoutMobileMessage(
        input,
        resolveMobileCurrentDirectory(),
        ctx.deviceId,
      );
    }),

  activity: procedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          actorId: z.string().optional(),
          conversationId: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getScoutMobileActivity(input);
    }),
});

// -- Workspace --------------------------------------------------------------

const workspaceRouter = t.router({
  info: procedure.query(() => {
    const config = resolveConfig();
    const configuredRoot = config.workspace?.root;
    if (!configuredRoot) {
      return { configured: false as const };
    }
    try {
      const root = resolveWorkspaceRoot(configuredRoot);
      return { configured: true as const, root };
    } catch (err: any) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err.message,
      });
    }
  }),

  list: procedure
    .input(z.object({ path: z.string().optional() }).optional())
    .query(({ input }) => {
      const config = resolveConfig();
      const configuredRoot = config.workspace?.root;
      if (!configuredRoot) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No workspace root configured",
        });
      }
      try {
        const root = resolveWorkspaceRoot(configuredRoot);
        const browsePath = resolveWorkspacePath(root, input?.path);
        const entries = listDirectories(browsePath);
        return { root, path: browsePath, entries };
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message,
        });
      }
    }),

  open: procedure
    .input(
      z.object({
        path: z.string(),
        adapter: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const config = resolveConfig();
      const configuredRoot = config.workspace?.root;
      if (!configuredRoot) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No workspace root configured",
        });
      }

      const root = resolveWorkspaceRoot(configuredRoot);
      const projectPath = resolveWorkspacePath(root, input.path);
      const stat = statSync(projectPath);
      if (!stat.isDirectory()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace target is not a directory",
        });
      }

      const adapterType = input.adapter ?? "claude-code";
      const name = input.name ?? basename(projectPath);

      return ctx.bridge.createSession(adapterType, {
        name,
        cwd: projectPath,
      });
    }),
});

// -- History ----------------------------------------------------------------

const historyRouter = t.router({
  discover: procedure
    .input(
      z
        .object({
          maxAge: z.number().optional(),
          limit: z.number().optional(),
          project: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const maxAgeDays = input?.maxAge ?? 14;
      const limit = input?.limit ?? 250;
      const projectFilter = input?.project;

      let sessions = await discoverSessionFiles(maxAgeDays, limit);
      if (projectFilter) {
        const filter = projectFilter.toLowerCase();
        sessions = sessions.filter((s) =>
          s.project.toLowerCase().includes(filter),
        );
      }
      return { sessions };
    }),

  search: procedure
    .input(
      z.object({
        query: z.string(),
        maxAge: z.number().optional(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const maxAge = input.maxAge ?? 14;
      const limit = input.limit ?? 50;

      const candidateLimit = Math.max(limit * 10, 1000);
      const sessions = await discoverSessionFiles(maxAge, candidateLimit);
      const matches: Array<{
        path: string;
        project: string;
        agent: string;
        matchCount: number;
        preview: string[];
      }> = [];

      for (const session of sessions) {
        try {
          const cmd = `grep -i -c "${input.query.replace(/"/g, '\\"')}" "${session.path}" 2>/dev/null`;
          const countStr = execSync(cmd, {
            encoding: "utf-8",
            timeout: 2000,
          }).trim();
          const count = parseInt(countStr, 10);
          if (count > 0) {
            const previewCmd = `grep -i -m 3 "${input.query.replace(/"/g, '\\"')}" "${session.path}" 2>/dev/null`;
            const previewLines = execSync(previewCmd, {
              encoding: "utf-8",
              timeout: 2000,
            })
              .trim()
              .split("\n")
              .slice(0, 3);

            matches.push({
              path: session.path,
              project: session.project,
              agent: session.agent,
              matchCount: count,
              preview: previewLines,
            });
          }
        } catch {}
      }

      matches.sort((a, b) => b.matchCount - a.matchCount);
      return { query: input.query, matches: matches.slice(0, limit) };
    }),

  read: procedure
    .input(z.object({ path: z.string() }))
    .query(({ input }) => {
      if (!input.path.endsWith(".jsonl")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only .jsonl files can be read",
        });
      }
      try {
        const content = readFileSync(input.path, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const trimmed = lines.length > 500 ? lines.slice(-500) : lines;
        return { path: input.path, lineCount: lines.length, lines: trimmed };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Cannot read file: ${err.message}`,
        });
      }
    }),
});

// -- Prompt -----------------------------------------------------------------

const promptRouter = t.router({
  send: procedure
    .input(
      z.object({
        sessionId: z.string(),
        text: z.string(),
        files: z.array(z.string()).optional(),
        images: z
          .array(z.object({ mimeType: z.string(), data: z.string() }))
          .optional(),
        providerOptions: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      log.info("prompt", `sending to session ${input.sessionId}`, {
        text: input.text?.slice(0, 80),
      });
      ctx.bridge.send(input as Prompt);
      log.info("prompt", "send() returned — adapter should be streaming");
      return { ok: true };
    }),
});

// -- Sync -------------------------------------------------------------------

const syncRouter = t.router({
  replay: procedure
    .input(z.object({ lastSeq: z.number() }))
    .query(({ input, ctx }) => {
      const events = ctx.bridge.replay(input.lastSeq);
      return { events };
    }),

  status: procedure.query(({ ctx }) => {
    return {
      currentSeq: ctx.bridge.currentSeq(),
      oldestBufferedSeq: ctx.bridge.oldestBufferedSeq(),
      sessionCount: ctx.bridge.listSessions().length,
    };
  }),
});

// ---------------------------------------------------------------------------
// Top-level router
// ---------------------------------------------------------------------------

export const bridgeRouter = t.router({
  // Sub-routers (grouped by domain)
  session: sessionRouter,
  mobile: mobileRouter,
  workspace: workspaceRouter,
  history: historyRouter,
  prompt: promptRouter,
  sync: syncRouter,

  // -- Top-level procedures (no sub-router grouping) -----------------------

  // bridge/status
  bridgeStatus: procedure.query(({ ctx }) => {
    const sessions = ctx.bridge.getSessionSummaries();
    return { sessions };
  }),

  // turn/interrupt
  turnInterrupt: procedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input, ctx }) => {
      ctx.bridge.interrupt(input.sessionId);
      return { ok: true };
    }),

  // action/decide
  actionDecide: procedure
    .input(
      z.object({
        sessionId: z.string(),
        turnId: z.string(),
        blockId: z.string(),
        version: z.number(),
        decision: z.enum(["approve", "deny"]),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const snapshot = ctx.bridge.getSessionSnapshot(input.sessionId);
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No session: ${input.sessionId}`,
        });
      }

      const turn = snapshot.turns.find((t) => t.id === input.turnId);
      if (!turn) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No turn: ${input.turnId}`,
        });
      }

      const blockState = turn.blocks.find((b) => b.block.id === input.blockId);
      if (!blockState || blockState.block.type !== "action") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No action block: ${input.blockId}`,
        });
      }

      const action = (blockState.block as ActionBlock).action;
      if (!action.approval || action.approval.version !== input.version) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stale approval version",
        });
      }

      ctx.bridge.decide(
        input.sessionId,
        input.blockId,
        input.decision,
        input.reason,
      );
      return { ok: true };
    }),

  // -- Subscription: events -------------------------------------------------

  events: procedure
    .input(z.object({ sessionId: z.string().optional() }).optional())
    .subscription(async function* ({ input, ctx, signal }) {
      for await (const event of bridgeEventIterable(ctx.bridge, signal)) {
        // Filter by sessionId if provided
        if (input?.sessionId) {
          const e = event.event as Record<string, unknown>;
          const eventSessionId =
            (e.sessionId as string) ??
            ((e.session as any)?.id as string | undefined);
          if (eventSessionId && eventSessionId !== input.sessionId) {
            continue;
          }
        }

        yield tracked(String(event.seq), {
          seq: event.seq,
          event: event.event,
          timestamp: event.timestamp,
        });
      }
    }),
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type BridgeRouter = typeof bridgeRouter;
