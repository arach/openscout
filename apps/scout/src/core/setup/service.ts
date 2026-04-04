import {
  initializeOpenScoutSetup,
  loadResolvedRelayAgents,
  writeOpenScoutSettings,
  type ProjectInventoryEntry,
} from "@openscout/runtime/setup";
import {
  brokerServiceStatus,
  startBrokerService,
} from "@openscout/runtime/broker-service";
import { loadHarnessCatalogSnapshot } from "@openscout/runtime/harness-catalog";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

export type ScoutDoctorReport = {
  currentDirectory: string;
  repoRoot: string;
  supportPaths: ReturnType<typeof resolveOpenScoutSupportPaths>;
  broker: Awaited<ReturnType<typeof brokerServiceStatus>>;
  setup: Awaited<ReturnType<typeof loadResolvedRelayAgents>>;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
};

export type ScoutSetupReport = {
  currentDirectory: string;
  setup: Awaited<ReturnType<typeof initializeOpenScoutSetup>>;
  broker: Awaited<ReturnType<typeof brokerServiceStatus>>;
  brokerWarning: string | null;
  catalog: Awaited<ReturnType<typeof loadHarnessCatalogSnapshot>>;
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
  const [broker, setup, catalog] = await Promise.all([
    brokerServiceStatus(),
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
}

export async function runScoutSetup(input: {
  currentDirectory: string;
  sourceRoots: string[];
}): Promise<ScoutSetupReport> {
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
  let broker = await brokerServiceStatus();
  let brokerWarning: string | null = null;
  try {
    broker = await startBrokerService();
  } catch (error) {
    brokerWarning = error instanceof Error ? error.message : String(error);
    broker = await brokerServiceStatus();
  }

  return {
    currentDirectory: input.currentDirectory,
    setup,
    broker,
    brokerWarning,
    catalog,
  };
}

export async function loadScoutRuntimesReport(currentDirectory: string): Promise<ScoutRuntimesReport> {
  return {
    currentDirectory,
    harnessCatalogPath: resolveOpenScoutSupportPaths().harnessCatalogPath,
    catalog: await loadHarnessCatalogSnapshot(),
  };
}
