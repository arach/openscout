import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

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
  queryFleet,
  queryFlights,
  queryRecentMessages,
  queryWorkItems,
  queryWorkItemById,
  querySessions,
  querySessionById,
} from "./db-queries.ts";
import { sendScoutMessage } from "./core/broker/service.ts";
import { loadMeshStatus } from "./core/mesh/service.ts";
import { loadOpenScoutWebShellState, type OpenScoutWebShellState } from "./runtime-summary.ts";
import { loadUserConfig, saveUserConfig, resolveOperatorName } from "@openscout/runtime/user-config";
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
  writeOpenScoutSettings,
} from "@openscout/runtime/setup";

export type { ScoutWebAssetMode } from "./server-core.ts";

export type CreateOpenScoutWebServerOptions = {
  currentDirectory: string;
  shellStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  staticRoot?: string;
};

export type OpenScoutWebServer = {
  app: Hono;
  warmupCaches: () => Promise<void>;
};

function parseOptionalPositiveInt(value: string | undefined, fallback?: number): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inferDirectTargetAgentId(
  conversationId: string | undefined,
  session: { kind: string; agentId: string | null; participantIds: string[] } | null,
  senderId: string,
): string | null {
  if (session?.kind === "direct") {
    if (session.agentId) {
      return session.agentId;
    }

    const participants = session.participantIds.filter((participantId) => participantId.trim().length > 0);
    if (participants.length === 2) {
      const operatorCandidates = new Set([senderId.trim(), "operator"]);
      const nonOperatorParticipants = participants.filter((participantId) => !operatorCandidates.has(participantId));
      if (nonOperatorParticipants.length === 1) {
        return nonOperatorParticipants[0] ?? null;
      }

      const localSessionParticipant = nonOperatorParticipants.find((participantId) => participantId.startsWith("local-session-agent-"))
        ?? participants.find((participantId) => participantId.startsWith("local-session-agent-"));
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

function resolveBundledStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "client");
}

function resolveSourceStaticClientRoot(moduleUrl: string | URL = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../dist/client");
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

async function loadPairingState(currentDirectory: string, refresh: boolean): Promise<ScoutPairingState> {
  return refresh
    ? refreshScoutWebPairingState(currentDirectory)
    : getScoutWebPairingState(currentDirectory);
}

export async function createOpenScoutWebServer(
  options: CreateOpenScoutWebServerOptions,
): Promise<OpenScoutWebServer> {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const app = new Hono();
  const shellStateCache = createCachedSnapshot<OpenScoutWebShellState>(loadOpenScoutWebShellState, shellTtl);

  installScoutApiMiddleware(app, "openscout-web api");

  app.get("/api/health", (c) => c.json({
    ok: true,
    surface: "openscout-web",
    currentDirectory,
  }));
  app.get("/api/pairing-state", async (c) => c.json(await loadPairingState(currentDirectory, false)));
  app.get("/api/pairing-state/refresh", async (c) => c.json(await loadPairingState(currentDirectory, true)));
  app.post("/api/pairing/control", async (c) => {
    const { action } = await c.req.json() as { action: ScoutPairingControlAction };
    const result = await controlScoutWebPairingService(action, currentDirectory);
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
  app.get("/api/shell-state/refresh", async (c) => c.json(await shellStateCache.refresh()));

  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/fleet", (c) =>
    c.json(queryFleet({
      limit: parseOptionalPositiveInt(c.req.query("limit")),
      activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
    })));
  app.get("/api/messages", (c) =>
    c.json(
      queryRecentMessages(
        parseOptionalPositiveInt(c.req.query("limit"), 80) ?? 80,
        { conversationId: c.req.query("conversationId") || undefined },
      ),
    ));
  app.get("/api/work", (c) => {
    const agentId = c.req.query("agentId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(queryWorkItems({
      agentId: agentId || undefined,
      activeOnly,
    }));
  });
  app.get("/api/work/:id", (c) => {
    const detail = queryWorkItemById(c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/flights", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const collaborationRecordId = c.req.query("collaborationRecordId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(queryFlights({
      agentId: agentId || undefined,
      conversationId: conversationId || undefined,
      collaborationRecordId: collaborationRecordId || undefined,
      activeOnly,
    }));
  });

  app.get("/api/sessions", (c) => c.json(querySessions()));
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

  app.get("/api/user", (c) => {
    return c.json({ name: resolveOperatorName() });
  });

  app.get("/api/onboarding/state", async (c) => {
    const hasLocalConfig = localConfigExists();
    const projectRoot = await findNearestProjectRoot(currentDirectory).catch(() => null);
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
    const body = await c.req.json().catch(() => ({})) as {
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

    await writeOpenScoutSettings({
      discovery: {
        contextRoot,
        workspaceRoots: sourceRoots,
      },
      agents: { defaultHarness: harness },
    });

    const result = await initializeOpenScoutSetup({ currentDirectory: contextRoot });
    return c.json({ ok: true, projectConfigPath: result.currentProjectConfigPath });
  });

  app.post("/api/onboarding/init", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
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
    return c.json({ ok: true, localConfig: loadLocalConfig(), localConfigPath: localConfigPath() });
  });

  app.post("/api/user", async (c) => {
    const { name } = await c.req.json() as { name?: string };
    const config = loadUserConfig();
    if (name?.trim()) {
      config.name = name.trim();
    } else {
      delete config.name;
    }
    saveUserConfig(config);
    return c.json({ name: resolveOperatorName() });
  });

  app.post("/api/agents/:agentId/interrupt", async (c) => {
    const agentId = c.req.param("agentId");
    const { interruptLocalAgent } = await import("@openscout/runtime/local-agents");
    const result = await interruptLocalAgent(agentId);
    if (!result.ok) return c.json({ error: "Agent not found or not interruptible" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/send", async (c) => {
    const { body, conversationId } = await c.req.json() as { body: string; conversationId?: string };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const fallbackSenderId = "operator";
    const session = conversationId ? querySessionById(conversationId) : null;
    const directAgentId = inferDirectTargetAgentId(conversationId, session, fallbackSenderId);
    const senderId = inferDirectSenderId(session, fallbackSenderId, directAgentId);

    const result = await sendScoutMessage({
      senderId,
      body: body.trim(),
      explicitTargetAgentIds: directAgentId ? [directAgentId] : undefined,
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }

    return c.json(result);
  });

  app.get("/api/events", async (c) => {
    const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
    const brokerPort = process.env.OPENSCOUT_BROKER_PORT ?? "65535";
    const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  await registerScoutWebAssets(app, {
    assetMode: options.assetMode,
    staticRoot: resolveStaticRoot(options.staticRoot),
    viteConfigPath: resolve(dirname(fileURLToPath(import.meta.url)), "../vite.config.ts"),
  });

  const warmupCaches = () =>
    Promise.allSettled([
      shellStateCache.refresh(),
      loadPairingState(currentDirectory, true),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error("[openscout-web api] initial cache warmup failed:", message);
        }
      }
    });

  return { app, warmupCaches };
}
