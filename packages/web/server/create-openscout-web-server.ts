import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono, type Context } from "hono";
import type { ConversationKind } from "@openscout/protocol";

import {
  controlScoutWebPairingService,
  getScoutWebPairingState,
  refreshScoutWebPairingState,
  removeScoutPairingTrustedPeer,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "./pairing.ts";
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  relayEventStream,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import {
  queryAgents,
  queryActivity,
  queryBrokerDiagnostics,
  queryFleet,
  queryFlights,
  queryRecentMessages,
  queryWorkItems,
  queryWorkItemById,
  querySessions,
  querySessionById,
  queryFollowTarget,
  queryHeartrate,
} from "./db-queries.ts";
import {
  askScoutQuestion,
  sendScoutDirectMessage,
  sendScoutMessage,
} from "./core/broker/service.ts";
import { getScoutConversations } from "./core/conversations/service.ts";
import {
  loadAgentObservePayload,
  loadAgentObserveSummaries,
  loadSessionRefObservePayload,
} from "./core/observe/service.ts";
import {
  getTailDiscovery,
  snapshotRecentEvents,
} from "@openscout/runtime/tail";
import {
  announceMeshVisibility,
  controlTailscale,
  loadMeshStatus,
  type TailscaleControlAction,
} from "./core/mesh/service.ts";
import {
  loadOpenScoutWebShellState,
  type OpenScoutWebShellState,
} from "./runtime-summary.ts";
import { ensureOpenScoutVoxOrigins, synthesizeVoxSpeech } from "./vox.ts";
import {
  loadUserConfig,
  saveUserConfig,
  resolveOperatorName,
} from "@openscout/runtime/user-config";
import {
  DEFAULT_LOCAL_CONFIG,
  loadLocalConfig,
  localConfigExists,
  localConfigPath,
  writeLocalConfig,
} from "@openscout/runtime/local-config";
import {
  findNearestProjectRoot,
  initializeOpenScoutSetup,
  readOpenScoutSettings,
  writeOpenScoutSettings,
} from "@openscout/runtime/setup";
import { relayAgentRuntimeDirectory } from "@openscout/runtime/support-paths";
import { readSessionCatalogSync } from "@openscout/runtime/claude-stream-json";

function parseConversationKinds(value: string | undefined): ConversationKind[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind): kind is ConversationKind => (
      kind === "direct"
      || kind === "channel"
      || kind === "group_direct"
      || kind === "thread"
      || kind === "system"
    ));
}
import { buildHarnessResumeCommand, findHarnessEntry } from "@openscout/runtime/harness-catalog";
import {
  resolveOpenScoutWebRoutes,
  serializeOpenScoutWebBootstrap,
} from "../shared/runtime-config.js";
export type { ScoutWebAssetMode } from "./server-core.ts";

export type CreateOpenScoutWebServerOptions = {
  currentDirectory: string;
  shellStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  viteDevUrl?: string;
  staticRoot?: string;
  publicOrigin?: string;
  portalHost?: string;
  advertisedHost?: string;
  trustedHosts?: string[];
  trustedOrigins?: string[];
  runTerminalCommand?: (command: string) => Promise<void>;
  terminalRelayHealthcheck?: () => Promise<boolean>;
};

export type OpenScoutWebServer = {
  app: Hono;
  warmupCaches: () => Promise<void>;
};

function parseOptionalPositiveInt(
  value: string | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function inferDirectTargetAgentId(
  conversationId: string | undefined,
  session: {
    kind: string;
    agentId: string | null;
    participantIds: string[];
  } | null,
  senderId: string,
): string | null {
  if (session?.kind === "direct") {
    if (session.agentId) {
      return session.agentId;
    }

    const participants = session.participantIds.filter(
      (participantId) => participantId.trim().length > 0,
    );
    if (participants.length === 2) {
      const operatorCandidates = new Set([senderId.trim(), "operator"]);
      const nonOperatorParticipants = participants.filter(
        (participantId) => !operatorCandidates.has(participantId),
      );
      if (nonOperatorParticipants.length === 1) {
        return nonOperatorParticipants[0] ?? null;
      }

      const localSessionParticipant =
        nonOperatorParticipants.find((participantId) =>
          participantId.startsWith("local-session-agent-"),
        ) ??
        participants.find((participantId) =>
          participantId.startsWith("local-session-agent-"),
        );
      if (localSessionParticipant) {
        return localSessionParticipant;
      }

      return participants[0] ?? null;
    }
  }

  if (conversationId?.startsWith("dm.operator.")) {
    const legacyAgentId = conversationId.slice("dm.operator.".length);
    return legacyAgentId || null;
  }

  return null;
}

function inferDirectSenderId(
  _session: { kind: string; participantIds: string[] } | null,
  _fallbackSenderId: string,
  _directTargetAgentId: string | null,
): string {
  // Web-originated sends must use the canonical operator actor id so direct
  // chats stay on one deterministic thread id.
  return "operator";
}

function channelNameFromConversationId(conversationId: string | undefined): string | null {
  if (!conversationId?.startsWith("channel.")) {
    return null;
  }
  const channel = conversationId.slice("channel.".length).trim();
  return channel || null;
}

function inferChannelName(
  conversationId: string | undefined,
  session: { kind: string } | null,
): string | null {
  if (session?.kind === "channel" || session?.kind === "system") {
    return channelNameFromConversationId(conversationId);
  }

  // Let direct channel URLs create or post to a channel even before the session
  // projection has caught up.
  return channelNameFromConversationId(conversationId);
}

function resolveConversationRouting(conversationId: string | undefined): {
  directAgentId: string | null;
  channel: string | null;
  senderId: string;
} {
  const fallbackSenderId = "operator";
  const session = conversationId ? querySessionById(conversationId) : null;
  const directAgentId = inferDirectTargetAgentId(
    conversationId,
    session,
    fallbackSenderId,
  );
  const senderId = inferDirectSenderId(
    session,
    fallbackSenderId,
    directAgentId,
  );
  const channel = directAgentId
    ? null
    : inferChannelName(conversationId, session);
  return { directAgentId, channel, senderId };
}

function buildAgentSessionCatalogPayload(input: {
  agentId: string;
  harness: string | null;
  cwd: string;
}) {
  const runtimeDir = relayAgentRuntimeDirectory(input.agentId);
  const catalog = readSessionCatalogSync(runtimeDir);
  const sessionId = catalog.activeSessionId;
  const harnessEntry = findHarnessEntry(input.harness);
  const resumeCommand = sessionId && harnessEntry
    ? buildHarnessResumeCommand(harnessEntry, sessionId, input.cwd)
    : null;
  return {
    ...catalog,
    agentId: input.agentId,
    harness: input.harness,
    resumeCommand,
  };
}

function resolveBundledStaticClientRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl.toString())), "client");
}

function normalizeRequestHost(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .split(":")[0]
    ?.replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase() ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderScoutLocalPortal(input: {
  requestUrl: string;
  portalHost: string;
  nodeHost: string;
}): string {
  const url = new URL(input.requestUrl);
  const port = url.port ? `:${url.port}` : "";
  const nodeUrl = `${url.protocol}//${input.nodeHost}${port}/`;
  const portalHost = escapeHtml(input.portalHost);
  const nodeHost = escapeHtml(input.nodeHost);
  const escapedNodeUrl = escapeHtml(nodeUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scout Local</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080a07; color: #f5f1e8; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }
      main { width: min(760px, 100%); }
      .eyebrow { color: #a6e15e; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .12em; }
      h1 { margin: 14px 0 10px; font-size: clamp(34px, 7vw, 58px); line-height: .98; font-weight: 650; letter-spacing: 0; }
      p { max-width: 600px; margin: 0 0 28px; color: #aaa69b; line-height: 1.55; font-size: 16px; }
      .node { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; border: 1px solid #303729; color: #f5f1e8; text-decoration: none; padding: 18px 20px; background: #10130e; border-radius: 8px; }
      .node:hover { border-color: #a6e15e; background: #141810; }
      .node strong { display: block; font-size: 17px; font-weight: 620; letter-spacing: 0; }
      .node span { color: #aaa69b; font-size: 13px; }
      .open { color: #a6e15e; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; }
      @media (max-width: 520px) {
        body { padding: 22px; place-items: start center; }
        .node { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${portalHost}</div>
      <h1>Scout local</h1>
      <p>Registered machines on this local Scout mesh. Open a node to inspect agents, sessions, activity, and settings.</p>
      <a class="node" href="${escapedNodeUrl}">
        <span>
          <strong>${nodeHost}</strong>
          <span>Local web node</span>
        </span>
        <span class="open">Open</span>
      </a>
    </main>
  </body>
</html>`;
}

function resolveSourceStaticClientRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl.toString())), "../dist/client");
}

function resolveStaticRoot(staticRoot: string | undefined): string {
  const configured = staticRoot?.trim();
  if (configured) {
    return configured;
  }

  const bundled = resolveBundledStaticClientRoot(import.meta.url);
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }

  return resolveSourceStaticClientRoot(import.meta.url);
}

async function loadPairingState(
  currentDirectory: string,
  refresh: boolean,
): Promise<ScoutPairingState> {
  return refresh
    ? refreshScoutWebPairingState(currentDirectory)
    : getScoutWebPairingState(currentDirectory);
}

export async function createOpenScoutWebServer(
  options: CreateOpenScoutWebServerOptions,
): Promise<OpenScoutWebServer> {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const routes = resolveOpenScoutWebRoutes(process.env);
  ensureOpenScoutVoxOrigins();
  const app = new Hono();
  const shellStateCache = createCachedSnapshot<OpenScoutWebShellState>(
    loadOpenScoutWebShellState,
    shellTtl,
  );

  installScoutApiMiddleware(app, "openscout-web api", {
    trustedHosts: options.trustedHosts,
    trustedOrigins: options.trustedOrigins,
  });

  app.get(routes.bootstrapScriptPath, (c) =>
    new Response(serializeOpenScoutWebBootstrap(process.env), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      },
    }),
  );
  app.get(routes.healthPath, (c) =>
    c.json({
      ok: true,
      surface: "openscout-web",
      currentDirectory,
      advertisedHost: options.advertisedHost,
      portalHost: options.portalHost,
      publicOrigin: options.publicOrigin,
    }),
  );
  app.use("/", async (c, next) => {
    const portalHost = options.portalHost?.trim().toLowerCase();
    const nodeHost = options.advertisedHost?.trim().toLowerCase();
    const requestHost = normalizeRequestHost(c.req.header("host"));
    if (portalHost && nodeHost && requestHost === portalHost && portalHost !== nodeHost) {
      return new Response(
        renderScoutLocalPortal({
          requestUrl: c.req.url,
          portalHost,
          nodeHost,
        }),
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }
    return next();
  });
  app.get(routes.terminalRelayHealthPath, async (c) => {
    const ok = await (options.terminalRelayHealthcheck?.() ?? Promise.resolve(false));
    return c.json(
      {
        ok,
        surface: "openscout-terminal-relay",
      },
      ok ? 200 : 503,
    );
  });
  app.get("/api/pairing-state", async (c) =>
    c.json(await loadPairingState(currentDirectory, false)),
  );
  app.get("/api/pairing-state/refresh", async (c) =>
    c.json(await loadPairingState(currentDirectory, true)),
  );
  app.post("/api/pairing/control", async (c) => {
    const { action } = (await c.req.json()) as {
      action: ScoutPairingControlAction;
    };
    const result = await controlScoutWebPairingService(
      action,
      currentDirectory,
    );
    shellStateCache.invalidate();
    return c.json(result);
  });
  app.delete("/api/pairing/peers/:fingerprint", async (c) => {
    const fingerprint = c.req.param("fingerprint");
    const removed = removeScoutPairingTrustedPeer(fingerprint);
    if (!removed) {
      return c.json({ error: "Peer not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/api/shell-state", async (c) => c.json(await shellStateCache.get()));
  app.get("/api/shell-state/refresh", async (c) =>
    c.json(await shellStateCache.refresh()),
  );

  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/observe/agents", async (c) => {
    const ids = c.req.query("ids")
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return c.json(await loadAgentObserveSummaries(ids));
  });
  app.get("/api/agents/:id/observe", async (c) => {
    const payload = await loadAgentObservePayload(c.req.param("id"));
    return payload ? c.json(payload) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/agents/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentConfig } = await import("@openscout/runtime/local-agents");
    const config = await getLocalAgentConfig(agentId);
    return config ? c.json(config) : c.json({ error: "agent config not found" }, 404);
  });
  app.post("/api/agents/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const { getLocalAgentConfig, restartLocalAgent, updateLocalAgentConfig } =
      await import("@openscout/runtime/local-agents");
    const existing = await getLocalAgentConfig(agentId);
    if (!existing) {
      return c.json({ error: "agent config not found" }, 404);
    }

    const runtime = body.runtime && typeof body.runtime === "object"
      ? body.runtime as Record<string, unknown>
      : {};
    const model = hasOwn(body, "model")
      ? optionalString(body.model)?.trim() || null
      : existing.model;
    const nextConfig = await updateLocalAgentConfig(agentId, {
      runtime: {
        cwd: optionalString(runtime.cwd) ?? existing.runtime.cwd,
        harness: optionalString(runtime.harness) ?? existing.runtime.harness,
        transport: optionalString(runtime.transport) ?? existing.runtime.transport,
        sessionId: optionalString(runtime.sessionId) ?? existing.runtime.sessionId,
      },
      systemPrompt: optionalString(body.systemPrompt) ?? existing.systemPrompt,
      launchArgs: stringList(body.launchArgs, existing.launchArgs),
      model,
      capabilities: stringList(body.capabilities, existing.capabilities),
    });
    if (!nextConfig) {
      return c.json({ error: "agent config not found" }, 404);
    }

    let restarted = false;
    if (body.restart === true) {
      const restartedRecord = await restartLocalAgent(agentId);
      restarted = Boolean(restartedRecord);
    }
    shellStateCache.invalidate();
    const config = await getLocalAgentConfig(agentId);
    return c.json({ config: config ?? nextConfig, restarted });
  });
  app.get("/api/agents/:id/session-catalog", (c) => {
    const agentId = c.req.param("id");
    const agents = queryAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: "agent not found" }, 404);
    const cwd = agent.cwd ?? agent.projectRoot ?? ".";
    return c.json(buildAgentSessionCatalogPayload({ agentId, harness: agent.harness, cwd }));
  });
  app.get("/api/agents/:agentId/session/context", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentContextState } =
      await import("@openscout/runtime/local-agents");
    const context = await getLocalAgentContextState(agentId);
    if (!context) {
      return c.json({ error: "agent config not found" }, 404);
    }
    return c.json(context);
  });
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/broker", (c) =>
    c.json(
      queryBrokerDiagnostics({
        limit: parseOptionalPositiveInt(c.req.query("limit"), 120),
        windowMs: parseOptionalPositiveInt(c.req.query("windowMs")),
      }),
    ),
  );
  app.get("/api/heartrate", (c) => c.json(queryHeartrate()));
  app.get("/api/fleet", (c) =>
    c.json(
      queryFleet({
        limit: parseOptionalPositiveInt(c.req.query("limit")),
        activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
      }),
    ),
  );
  app.get("/api/messages", (c) =>
    c.json(
      queryRecentMessages(
        parseOptionalPositiveInt(c.req.query("limit"), 80) ?? 80,
        { conversationId: c.req.query("conversationId") || undefined },
      ),
    ),
  );
  const handleListWork = (c: Context) => {
    const agentId = c.req.query("agentId");
    const activeOnly = c.req.query("active") !== "false";
    const rawLimit = Number(c.req.query("limit"));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(250, Math.max(1, Math.floor(rawLimit)))
      : undefined;
    return c.json(
      queryWorkItems({
        agentId: agentId || undefined,
        activeOnly,
        limit,
      }),
    );
  };
  const handleWorkDetail = (c: Context) => {
    const workId = c.req.param("id");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
  };
  app.get("/api/work", handleListWork);
  app.get("/api/tasks", handleListWork);
  app.get("/api/work/:id", handleWorkDetail);
  app.get("/api/tasks/:id", handleWorkDetail);
  app.get("/api/flights", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const collaborationRecordId = c.req.query("collaborationRecordId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(
      queryFlights({
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        collaborationRecordId: collaborationRecordId || undefined,
        activeOnly,
      }),
    );
  });
  app.get("/api/follow", (c) =>
    c.json(
      queryFollowTarget({
        flightId: c.req.query("flightId") || undefined,
        invocationId: c.req.query("invocationId") || undefined,
        conversationId: c.req.query("conversationId") || undefined,
        workId: c.req.query("workId") || undefined,
        sessionId: c.req.query("sessionId") || undefined,
        targetAgentId: c.req.query("targetAgentId") || undefined,
      }),
    ),
  );
  app.get("/api/conversations", async (c) => {
    const rawLimit = Number(c.req.query("limit"));
    const rawKinds = c.req.query("kinds")?.trim();
    return c.json(await getScoutConversations({
      query: c.req.query("query") || undefined,
      limit: Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.floor(rawLimit))) : undefined,
      kinds: parseConversationKinds(rawKinds),
    }));
  });

  app.get("/api/sessions", (c) => c.json(querySessions()));
  app.get("/api/session-ref/:id", async (c) => {
    const refId = c.req.param("id");
    const conversation = querySessionById(refId);
    if (conversation) {
      return c.json({
        kind: "conversation",
        refId,
        conversationId: conversation.id,
        session: conversation,
      });
    }

    const harnessSession = querySessions(200).find((session) =>
      session.harnessSessionId === refId
      || (session.harnessSessionId?.endsWith(".jsonl") === true
        && session.harnessSessionId.slice(0, -".jsonl".length) === refId)
    );
    if (harnessSession?.agentId) {
      const payload = await loadSessionRefObservePayload(refId);
      if (payload) {
        return c.json({
          kind: "observe",
          refId,
          session: harnessSession,
          observe: payload,
        });
      }
    }

    const payload = await loadSessionRefObservePayload(refId);
    if (payload) {
      return c.json({
        kind: "observe",
        refId,
        session: null,
        observe: payload,
      });
    }

    return c.json({ error: "not found" }, 404);
  });
  app.get("/api/session/:id", (c) => {
    const session = querySessionById(c.req.param("id"));
    return session ? c.json(session) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/mesh", async (c) => {
    try {
      return c.json(await loadMeshStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/api/mesh/announce", async (c) => {
    try {
      return c.json(await announceMeshVisibility());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/api/mesh/tailscale", async (c) => {
    try {
      const { action } = (await c.req.json()) as {
        action: TailscaleControlAction;
      };
      return c.json(await controlTailscale(action));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/mesh/tailnet-probe", async (c) => {
    try {
      const { ip } = (await c.req.json()) as { ip: string };
      // Only allow Tailscale CGNAT range (100.64.0.0/10)
      const parts = ip.split(".");
      const oct1 = Number(parts[0]);
      const oct2 = Number(parts[1]);
      if (parts.length !== 4 || oct1 !== 100 || oct2 < 64 || oct2 > 127) {
        return c.json({ error: "IP is not in the Tailscale address range" }, 403);
      }

      const brokerUrl = `http://${ip}:65535`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const [homeRes, nodeRes] = await Promise.all([
          fetch(`${brokerUrl}/v1/home`, { signal: ac.signal }),
          fetch(`${brokerUrl}/v1/node`, { signal: ac.signal }),
        ]);
        clearTimeout(timer);
        const home = homeRes.ok ? await homeRes.json() : null;
        const node = nodeRes.ok ? await nodeRes.json() : null;
        return c.json({ reachable: true, home, node });
      } catch (fetchErr) {
        clearTimeout(timer);
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        return c.json({ reachable: false, error: msg });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/user", (c) => {
    const config = loadUserConfig();
    return c.json({
      name: resolveOperatorName(),
      handle: config.handle ?? "",
      pronouns: config.pronouns ?? "",
      hue: config.hue ?? 195,
      bio: config.bio ?? "",
      timezone: config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingHours: config.workingHours ?? "08:00 – 18:00",
      interruptThreshold: config.interruptThreshold ?? "blocking-only",
      batchWindow: config.batchWindow ?? 15,
      channel: config.channel ?? "here+mobile",
      verbosity: config.verbosity ?? "terse",
      tone: config.tone ?? "direct",
      quietHours: config.quietHours ?? "22:00 – 07:00",
    });
  });

  app.get("/api/onboarding/state", async (c) => {
    const hasLocalConfig = localConfigExists();
    const settings = await readOpenScoutSettings({ currentDirectory }).catch(() => null);
    const configuredContextRoot = settings?.discovery.contextRoot ?? null;
    const projectRoot = await findNearestProjectRoot(currentDirectory).catch(() => null)
      ?? await findNearestProjectRoot(configuredContextRoot ?? "").catch(() => null);
    const hasProjectConfig = projectRoot !== null;
    const userName = loadUserConfig().name?.trim() ?? "";
    return c.json({
      hasLocalConfig,
      hasProjectConfig,
      hasOperatorName: userName.length > 0,
      localConfigPath: localConfigPath(),
      localConfig: hasLocalConfig ? loadLocalConfig() : null,
      projectRoot,
      currentDirectory,
      contextRoot: configuredContextRoot,
      operatorName: userName || null,
      operatorNameSuggestion: resolveOperatorName(),
    });
  });

  app.delete("/api/onboarding/state", (c) => {
    try {
      rmSync(localConfigPath(), { force: true });
    } catch {
      /* already absent */
    }
    return c.json({ ok: true, localConfigPath: localConfigPath() });
  });

  app.post("/api/onboarding/project", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      contextRoot?: string;
      sourceRoots?: string[];
      defaultHarness?: "claude" | "codex";
    };
    const contextRoot = body.contextRoot?.trim();
    if (!contextRoot) {
      return c.json({ error: "contextRoot is required" }, 400);
    }
    const sourceRoots = (body.sourceRoots ?? [])
      .map((entry) => entry?.trim())
      .filter((entry): entry is string => Boolean(entry && entry.length > 0));
    const harness = body.defaultHarness === "codex" ? "codex" : "claude";

    try {
      await writeOpenScoutSettings({
        discovery: {
          contextRoot,
          workspaceRoots: sourceRoots,
        },
        agents: { defaultHarness: harness },
      });

      const result = await initializeOpenScoutSetup({
        currentDirectory: contextRoot,
      });
      return c.json({
        ok: true,
        projectConfigPath: result.currentProjectConfigPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[onboarding/project]", message);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/onboarding/init", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      host?: string;
      ports?: { broker?: number; web?: number; pairing?: number };
    };
    writeLocalConfig({
      version: 1,
      host: body.host ?? DEFAULT_LOCAL_CONFIG.host,
      ports: {
        broker: body.ports?.broker ?? DEFAULT_LOCAL_CONFIG.ports.broker,
        web: body.ports?.web ?? DEFAULT_LOCAL_CONFIG.ports.web,
        pairing: body.ports?.pairing ?? DEFAULT_LOCAL_CONFIG.ports.pairing,
      },
    });
    return c.json({
      ok: true,
      localConfig: loadLocalConfig(),
      localConfigPath: localConfigPath(),
    });
  });

  app.post("/api/user", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const config = loadUserConfig();

    const stringFields = [
      "name", "handle", "pronouns", "bio", "timezone",
      "workingHours", "interruptThreshold", "channel",
      "verbosity", "tone", "quietHours",
    ] as const;
    for (const key of stringFields) {
      if (key in body) {
        const val = body[key];
        if (typeof val === "string" && val.trim()) {
          (config as Record<string, unknown>)[key] = val.trim();
        } else {
          delete (config as Record<string, unknown>)[key];
        }
      }
    }
    if ("hue" in body && typeof body.hue === "number") {
      config.hue = body.hue;
    }
    if ("batchWindow" in body && typeof body.batchWindow === "number") {
      config.batchWindow = body.batchWindow;
    }

    saveUserConfig(config);
    return c.json({
      name: resolveOperatorName(),
      handle: config.handle ?? "",
      pronouns: config.pronouns ?? "",
      hue: config.hue ?? 195,
      bio: config.bio ?? "",
      timezone: config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingHours: config.workingHours ?? "08:00 – 18:00",
      interruptThreshold: config.interruptThreshold ?? "blocking-only",
      batchWindow: config.batchWindow ?? 15,
      channel: config.channel ?? "here+mobile",
      verbosity: config.verbosity ?? "terse",
      tone: config.tone ?? "direct",
      quietHours: config.quietHours ?? "22:00 – 07:00",
    });
  });

  app.post(routes.terminalRunPath, async (c) => {
    const body = await c.req.json<{ command?: string }>();
    if (!body.command) return c.json({ error: "missing command" }, 400);
    if (!options.runTerminalCommand) {
      return c.json({ error: "terminal relay is unavailable" }, 503);
    }
    try {
      await options.runTerminalCommand(body.command);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to queue command";
      return c.json({ error: message }, 503);
    }
    return c.json({ ok: true });
  });

  app.post("/api/agents/:agentId/interrupt", async (c) => {
    const agentId = c.req.param("agentId");
    const { interruptLocalAgent } =
      await import("@openscout/runtime/local-agents");
    const result = await interruptLocalAgent(agentId);
    if (!result.ok)
      return c.json({ error: "Agent not found or not interruptible" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/agents/:agentId/session/reset", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentConfig, restartLocalAgent } =
      await import("@openscout/runtime/local-agents");
    const config = await getLocalAgentConfig(agentId);
    if (!config) {
      return c.json({ error: "agent config not found" }, 404);
    }

    const restarted = await restartLocalAgent(agentId);
    if (!restarted) {
      return c.json({ error: "agent not found or not restartable" }, 404);
    }

    shellStateCache.invalidate();
    const runtimeDir = relayAgentRuntimeDirectory(agentId);
    const catalog = readSessionCatalogSync(runtimeDir);
    const sessionId = catalog.activeSessionId;
    const harnessEntry = findHarnessEntry(config.runtime.harness);
    const resumeCommand = sessionId && harnessEntry
      ? buildHarnessResumeCommand(harnessEntry, sessionId, config.runtime.cwd)
      : null;

    return c.json({
      ok: true,
      agentId,
      catalog: {
        ...catalog,
        agentId,
        harness: config.runtime.harness,
        resumeCommand,
      },
    });
  });

  app.post("/api/send", async (c) => {
    const { body, conversationId } = (await c.req.json()) as {
      body: string;
      conversationId?: string;
    };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const { directAgentId, channel, senderId } =
      resolveConversationRouting(conversationId);

    if (directAgentId) {
      const result = await sendScoutDirectMessage({
        agentId: directAgentId,
        body: body.trim(),
        currentDirectory,
        source: "scout-web",
      });
      return c.json(result);
    }

    const result = await sendScoutMessage({
      senderId,
      body: body.trim(),
      ...(channel ? { channel } : {}),
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }

    return c.json(result);
  });

  app.post("/api/ask", async (c) => {
    const { body, conversationId } = (await c.req.json()) as {
      body: string;
      conversationId?: string;
    };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const { directAgentId, senderId } =
      resolveConversationRouting(conversationId);
    if (!directAgentId) {
      return c.json(
        {
          error:
            "ask is only available in a direct conversation with one agent",
        },
        400,
      );
    }

    const result = await askScoutQuestion({
      senderId,
      targetLabel: directAgentId,
      targetAgentId: directAgentId,
      body: body.trim(),
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }
    if (result.unresolvedTarget) {
      return c.json(
        {
          error: `could not route ask to ${result.unresolvedTarget}`,
          targetDiagnostic: result.targetDiagnostic ?? null,
        },
        409,
      );
    }

    return c.json(result);
  });

  app.post("/api/voice/speak", async (c) => {
    const body = (await c.req.json()) as {
      text?: string;
      modelId?: string;
      voiceId?: string;
      speed?: number;
    };
    const text = body.text?.trim();
    if (!text) {
      return c.json({ error: "text is required" }, 400);
    }

    try {
      return c.json(await synthesizeVoxSpeech({
        text,
        modelId: body.modelId,
        voiceId: body.voiceId,
        speed: body.speed,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vox speech failed";
      return c.json({ error: message }, 503);
    }
  });

  app.get("/api/events", async (c) => {
    const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
    const brokerPort = process.env.OPENSCOUT_BROKER_PORT ?? "65535";
    const brokerUrl =
      process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  app.get("/api/tail/discover", async (c) => {
    const force = c.req.query("force") === "true";
    const snapshot = await getTailDiscovery(force);
    return c.json(snapshot);
  });

  app.get("/api/tail/recent", (c) => {
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 500) ?? 500;
    return c.json({ events: snapshotRecentEvents(limitParam) });
  });

  // /api/tail/stream removed — clients now subscribe to broker tail.events
  // directly via tRPC over WebSocket. See packages/web/client/lib/tail-events.ts.

  await registerScoutWebAssets(app, {
    assetMode: options.assetMode,
    staticRoot: resolveStaticRoot(options.staticRoot),
    viteDevUrl: options.viteDevUrl,
    defaultViteUrl: "http://127.0.0.1:5180",
  });

  const warmupCaches = () =>
    Promise.allSettled([
      shellStateCache.refresh(),
      loadPairingState(currentDirectory, true),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.error(
            "[openscout-web api] initial cache warmup failed:",
            message,
          );
        }
      }
    });

  return { app, warmupCaches };
}
