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

export type ScoutDoctorReport = {
  currentDirectory: string;
  repoRoot: string;
  supportPaths: ReturnType<typeof resolveOpenScoutSupportPaths>;
  broker: BrokerServiceStatus;
  setup: Awaited<ReturnType<typeof loadResolvedRelayAgents>>;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
};

export type ScoutSetupReport = {
  currentDirectory: string;
  setup: Awaited<ReturnType<typeof initializeOpenScoutSetup>>;
  broker: BrokerServiceStatus;
  brokerWarning: string | null;
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
  onProjectInventoryEntry?: (entry: ProjectInventoryEntry) => void | Promise<void>;
}): Promise<ScoutDoctorReport> {
  return withScoutCoreCommandLock("doctor", async () => {
    const [broker, setup, catalog] = await Promise.all([
      getRuntimeBrokerServiceStatus(),
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
      setup,
      catalog,
    };
  });
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
