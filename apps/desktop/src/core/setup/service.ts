import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import {
  DEFAULT_SCOUT_WEB_PORTAL_HOST,
  resolveConfiguredScoutWebHostname,
  resolveScoutWebNamedHostname,
} from "@openscout/runtime/local-config";
import { resolveOpenScoutLocalEdgeConfig } from "@openscout/runtime/local-edge";
import {
  initializeOpenScoutSetup,
  installScoutSkillToHarnesses,
  loadResolvedRelayAgents,
  writeOpenScoutSettings,
  type ProjectInventoryEntry,
  type ScoutSkillInstallReport,
} from "@openscout/runtime/setup";
import { loadHarnessCatalogSnapshot } from "@openscout/runtime/harness-catalog";
import type { BrokerServiceStatus } from "@openscout/runtime/broker-process-manager";
import {
  getRuntimeBrokerServiceStatus,
  runRuntimeBrokerService,
} from "../../app/host/runtime-service-client.ts";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import { withScoutCoreCommandLock } from "./command-lock.ts";
import {
  ensureScoutLocalEdgeDependencies,
  inspectScoutLocalEdgeDependencies,
  type ScoutLocalEdgeDependencyReport,
} from "./local-edge-dependencies.ts";

export type ScoutLocalEdgeDoctorReport = {
  state: "ready" | "degraded" | "missing";
  portalHost: string;
  nodeHost: string;
  caddyfilePath: string;
  dependency: ScoutLocalEdgeDependencyReport;
  dns: {
    portal: ScoutLocalEdgeHostResolution;
    node: ScoutLocalEdgeHostResolution;
  };
  listeners: {
    http: ScoutLocalEdgePortProbe;
    https: ScoutLocalEdgePortProbe;
  };
  hints: string[];
};

export type ScoutLocalEdgeHostResolution = {
  host: string;
  resolved: boolean;
  addresses: string[];
  error: string | null;
};

export type ScoutLocalEdgePortProbe = {
  port: number;
  listening: boolean;
};

export type ScoutDoctorReport = {
  currentDirectory: string;
  repoRoot: string;
  supportPaths: ReturnType<typeof resolveOpenScoutSupportPaths>;
  broker: BrokerServiceStatus;
  localEdge: ScoutLocalEdgeDoctorReport;
  setup: Awaited<ReturnType<typeof loadResolvedRelayAgents>>;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
};

export type ScoutSetupReport = {
  currentDirectory: string;
  setup: Awaited<ReturnType<typeof initializeOpenScoutSetup>>;
  broker: BrokerServiceStatus;
  brokerWarning: string | null;
  localEdge: ScoutLocalEdgeDependencyReport;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
  scoutSkill: ScoutSkillInstallReport;
};

export type ScoutRuntimesReport = {
  currentDirectory: string;
  harnessCatalogPath: string;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
};

export type ScoutProjectInventoryEntry = ProjectInventoryEntry;

export async function loadScoutDoctorReport(input: {
  currentDirectory: string;
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  onProjectInventoryEntry?: (entry: ProjectInventoryEntry) => void | Promise<void>;
}): Promise<ScoutDoctorReport> {
  return withScoutCoreCommandLock("doctor", async () => {
    const [broker, localEdge, setup, catalog] = await Promise.all([
      getRuntimeBrokerServiceStatus(),
      loadScoutLocalEdgeDoctorReport(input.env ?? process.env),
      loadResolvedRelayAgents({
        currentDirectory: input.currentDirectory,
        onProjectInventoryEntry: input.onProjectInventoryEntry,
      }),
      loadHarnessCatalogSnapshot(),
    ]);

    return {
      currentDirectory: input.currentDirectory,
      repoRoot: input.repoRoot,
      supportPaths: resolveOpenScoutSupportPaths(),
      broker,
      localEdge,
      setup,
      catalog,
    };
  });
}

async function loadScoutLocalEdgeDoctorReport(env: NodeJS.ProcessEnv): Promise<ScoutLocalEdgeDoctorReport> {
  const dependency = inspectScoutLocalEdgeDependencies({ env });
  const nodeHost = env.OPENSCOUT_WEB_ADVERTISED_HOST?.trim()
    || (env.OPENSCOUT_WEB_LOCAL_NAME?.trim()
      ? resolveScoutWebNamedHostname(env.OPENSCOUT_WEB_LOCAL_NAME)
      : resolveConfiguredScoutWebHostname());
  const localEdgeConfig = resolveOpenScoutLocalEdgeConfig({
    portalHost: env.OPENSCOUT_WEB_PORTAL_HOST?.trim() || DEFAULT_SCOUT_WEB_PORTAL_HOST,
    nodeHost,
  });
  const portalHost = localEdgeConfig.portalHost;

  const [portalDns, nodeDns, http, https] = await Promise.all([
    resolveLocalEdgeHost(portalHost),
    resolveLocalEdgeHost(localEdgeConfig.nodeHost),
    probeTcpPort(80),
    probeTcpPort(443),
  ]);

  const hints: string[] = [];
  const caddyAvailable = dependency.status === "ready" || dependency.status === "installed";
  const httpsTrustReady = dependency.trust.status === "trusted" || dependency.trust.status === "installed";
  if (!caddyAvailable) {
    hints.push(dependency.detail);
  }
  if (https.listening && !httpsTrustReady) {
    hints.push(dependency.trust.detail);
  }
  if (!portalDns.resolved || !nodeDns.resolved || (!http.listening && !https.listening)) {
    hints.push("Start the local edge with `scout server edge`.");
  }

  const state = caddyAvailable
    && portalDns.resolved
    && nodeDns.resolved
    && (http.listening || https.listening)
    && (!https.listening || httpsTrustReady)
    ? "ready"
    : caddyAvailable || portalDns.resolved || nodeDns.resolved || http.listening || https.listening
      ? "degraded"
      : "missing";

  return {
    state,
    portalHost,
    nodeHost: localEdgeConfig.nodeHost,
    caddyfilePath: join(homedir(), ".scout", "local-edge", "Caddyfile"),
    dependency,
    dns: {
      portal: portalDns,
      node: nodeDns,
    },
    listeners: {
      http,
      https,
    },
    hints,
  };
}

async function resolveLocalEdgeHost(host: string): Promise<ScoutLocalEdgeHostResolution> {
  try {
    const entries = await withTimeout(lookup(host, { all: true }), 1_500);
    const addresses = [...new Set(entries.map((entry) => entry.address))];
    return {
      host,
      resolved: addresses.length > 0,
      addresses,
      error: null,
    };
  } catch (error) {
    return {
      host,
      resolved: false,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeTcpPort(port: number): Promise<ScoutLocalEdgePortProbe> {
  const listening = await new Promise<boolean>((resolve) => {
    const socket = new Socket();
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(350);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(port, "127.0.0.1");
  });

  return {
    port,
    listening,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runScoutSetup(input: {
  currentDirectory: string;
  sourceRoots: string[];
}): Promise<ScoutSetupReport> {
  return withScoutCoreCommandLock("setup", async () => {
    if (input.sourceRoots.length > 0) {
      await writeOpenScoutSettings({
        discovery: {
          workspaceRoots: input.sourceRoots,
        },
      }, {
        currentDirectory: input.currentDirectory,
      });
    }

    const setup = await initializeOpenScoutSetup({ currentDirectory: input.currentDirectory });
    const catalog = await loadHarnessCatalogSnapshot();
    const scoutSkill = await installScoutSkillToHarnesses();
    const localEdge = ensureScoutLocalEdgeDependencies();
    let broker = await getRuntimeBrokerServiceStatus();
    let brokerWarning: string | null = null;
    try {
      broker = await runRuntimeBrokerService("start");
    } catch (error) {
      brokerWarning = error instanceof Error ? error.message : String(error);
      broker = await getRuntimeBrokerServiceStatus();
    }

    // Trigger mesh discovery after broker is up so peers are found immediately
    if (broker.reachable && broker.brokerUrl) {
      try {
        await fetch(new URL("/v1/mesh/discover", broker.brokerUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Best-effort: broker may not support mesh or peers may not be ready yet
      }
    }

    return {
      currentDirectory: input.currentDirectory,
      setup,
      broker,
      brokerWarning,
      localEdge,
      catalog,
      scoutSkill,
    };
  });
}

export async function loadScoutRuntimesReport(currentDirectory: string): Promise<ScoutRuntimesReport> {
  return withScoutCoreCommandLock("runtimes", async () => ({
    currentDirectory,
    harnessCatalogPath: resolveOpenScoutSupportPaths().harnessCatalogPath,
    catalog: await loadHarnessCatalogSnapshot(),
  }));
}
