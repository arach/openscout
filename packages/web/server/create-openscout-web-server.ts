import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono, type Context } from "hono";

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
  queryHeartrate,
} from "./db-queries.ts";
import {
  askScoutQuestion,
  sendScoutDirectMessage,
  sendScoutMessage,
} from "./core/broker/service.ts";
import {
  loadAgentObservePayload,
  loadAgentObserveSummaries,
} from "./core/observe/service.ts";
import {
  getTailDiscovery,
  snapshotRecentEvents,
} from "@openscout/tail";
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

function resolveConversationRouting(conversationId: string | undefined): {
  directAgentId: string | null;
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
  return { directAgentId, senderId };
}

function resolveBundledStaticClientRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl.toString())), "client");
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

  installScoutApiMiddleware(app, "openscout-web api");

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
    }),
  );
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
  app.get("/api/agents/:id/session-catalog", (c) => {
    const agentId = c.req.param("id");
    const agents = queryAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: "agent not found" }, 404);
    const runtimeDir = relayAgentRuntimeDirectory(agent.id);
    const catalog = readSessionCatalogSync(runtimeDir);
    const cwd = agent.cwd ?? agent.projectRoot ?? ".";
    const sessionId = catalog.activeSessionId;
    const harnessEntry = findHarnessEntry(agent.harness);
    const resumeCommand = sessionId && harnessEntry
      ? buildHarnessResumeCommand(harnessEntry, sessionId, cwd)
      : null;
    return c.json({ ...catalog, agentId, harness: agent.harness, resumeCommand });
  });
  app.get("/api/activity", (c) => c.json(queryActivity()));
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

  app.post("/api/send", async (c) => {
    const { body, conversationId } = (await c.req.json()) as {
      body: string;
      conversationId?: string;
    };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const { directAgentId, senderId } =
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
