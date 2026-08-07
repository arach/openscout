/**
 * The OpenScout app lifecycle: one ownership model shared by status, stop,
 * start, and verify.
 *
 * Two supervision trees make up a running OpenScout:
 *
 *   launchd        -> scoutd -> base/probes -> broker/edge -> web
 *   LaunchServices -> Scout  -> embedded ScoutMenu -> pairing runtime
 *
 * They tear down differently and the difference is load-bearing. The launchd
 * tree is *supervised*: killing the broker directly only makes scoutd start a
 * new one, so the whole tree comes down with a single `launchctl bootout` and
 * per-process kills are a straggler sweep, never the primary move. The
 * LaunchServices tree has no supervisor, so it comes down leaf-first by hand.
 *
 * Identity here is an **executable path**, never a process name. Two checkouts
 * of this repo produce two `Scout.app` bundles whose processes are both named
 * `Scout` and share a bundle identifier, so `pkill -x Scout` in one worktree
 * reaches into the other, and a stale helper satisfies any identifier-based
 * "already running?" check. Path identity is what makes "ours" a decidable
 * question, and processes that match by name but not by path are reported as
 * foreign rather than killed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type ProcessRecord = {
  pid: number;
  ppid: number;
  command: string;
  args: string;
  /** argv[0] — the executable path, which is what we key identity on. */
  executable: string;
  /** Seconds since the process started, from `ps -o etimes=`. */
  elapsedSeconds: number;
};

export type LifecycleLayerName =
  | "scoutd"
  | "base"
  | "probes"
  | "broker"
  | "edge"
  | "web"
  | "app"
  | "menu"
  | "pairing";

/** Leaf-first. The launchd tree is bootout'd as a unit before its sweep. */
export const SUPERVISED_LAYERS: LifecycleLayerName[] = ["web", "edge", "broker", "probes", "base", "scoutd"];
export const LAUNCH_SERVICES_LAYERS: LifecycleLayerName[] = ["pairing", "menu", "app"];

export const SCOUT_LAUNCHD_LABEL = "app.openscout";

export type AppBundlePaths = {
  appBundlePath: string;
  menuBundlePath: string;
  /** Absolute path to the app binary. Resolved, never assumed from the bundle name. */
  appExecutable: string;
  menuExecutable: string;
};

export type LifecycleProcess = ProcessRecord & {
  layer: LifecycleLayerName;
  /**
   * True when the executable lives where this layer's owner is supposed to put
   * it. False means the right name in the wrong place — another worktree, a
   * replaced bundle, a build from three rebuilds ago.
   */
  canonical: boolean;
  /** Right path, older binary — the bundle was rebuilt under a live process. */
  superseded: boolean;
};

export type LifecycleTree = {
  layers: Record<LifecycleLayerName, LifecycleProcess[]>;
  /** Matched a layer by name but not by path. Reported, never killed. */
  foreign: LifecycleProcess[];
  expected: AppBundlePaths;
};

const EMPTY_LAYERS = (): Record<LifecycleLayerName, LifecycleProcess[]> => ({
  scoutd: [],
  base: [],
  probes: [],
  broker: [],
  edge: [],
  web: [],
  app: [],
  menu: [],
  pairing: [],
});

/**
 * `OpenScout.app` ships with `CFBundleExecutable = Scout` — the release bundle
 * is renamed but the binary is not — so the executable name has to be read,
 * not inferred from the bundle it lives in.
 */
export function readBundleExecutableName(bundlePath: string, fallback: string): string {
  const result = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleExecutable", join(bundlePath, "Contents", "Info.plist")],
    { encoding: "utf8" },
  );
  const name = (result.stdout ?? "").trim();
  return (result.status ?? 1) === 0 && name.length > 0 ? name : fallback;
}

export function resolveAppBundlePaths(appBundlePath: string): AppBundlePaths {
  const menuBundlePath = join(appBundlePath, "Contents", "Library", "LoginItems", "ScoutMenu.app");
  return {
    appBundlePath,
    menuBundlePath,
    appExecutable: join(appBundlePath, "Contents", "MacOS", readBundleExecutableName(appBundlePath, "Scout")),
    menuExecutable: join(menuBundlePath, "Contents", "MacOS", readBundleExecutableName(menuBundlePath, "ScoutMenu")),
  };
}

export function appBundlePathsForRoot(distDirectory: string): AppBundlePaths {
  return resolveAppBundlePaths(join(distDirectory, "Scout.app"));
}

/**
 * `ps -o etime=` reports `[[dd-]hh:]mm:ss`. Darwin has no `etimes`, so the
 * elapsed time has to be parsed rather than read as an integer.
 */
export function parseElapsedSeconds(value: string): number {
  const match = value.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return Number.NaN;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

export function parseProcessTable(output: string): ProcessRecord[] {
  return String(output).split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d:-]+)\s+(\S+)\s+(.*)$/);
    if (!match) return [];
    const args = match[5] ?? "";
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsedSeconds: parseElapsedSeconds(match[3] ?? ""),
      command: match[4] ?? "",
      args,
      executable: args.trim().split(/\s+/)[0] ?? "",
    }];
  });
}

export function readProcessTable(): ProcessRecord[] {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,etime=,comm=,args="], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Unable to inspect process ownership with ps.");
  }
  return parseProcessTable(result.stdout);
}

/**
 * True when the executable on disk is newer than the process running it.
 *
 * Path identity answers "is this process from the right bundle" but not "is it
 * from the current build of that bundle" — a rebuild writes a new binary at the
 * same path and the old process keeps running the old code, silently. This is
 * the same trap as a daemon that pins its modules at boot: the fix ships, the
 * process never picks it up, and nothing says so.
 */
export function isSuperseded(record: ProcessRecord, now: number = Date.now()): boolean {
  if (!record.executable || !Number.isFinite(record.elapsedSeconds)) return false;
  let modifiedAt: number;
  try {
    modifiedAt = statSync(record.executable).mtimeMs;
  } catch {
    // The binary was replaced out from under us or never existed at that path.
    return false;
  }
  const startedAt = now - record.elapsedSeconds * 1_000;
  // One second of slack: ps reports whole seconds, so a process started in the
  // same second as the write is not evidence of staleness.
  return modifiedAt > startedAt + 1_000;
}

function matchesName(record: ProcessRecord, name: string): boolean {
  return record.command === name
    || record.command.endsWith(`/${name}`)
    || record.executable.endsWith(`/${name}`);
}

/**
 * The iOS simulator runs its own copy of Scout with the same process name.
 * It is never part of the desktop tree and must never be reaped by it.
 */
function isSimulatorProcess(record: ProcessRecord): boolean {
  return record.args.includes("/Library/Developer/CoreSimulator/Devices/");
}

export function classifyProcesses(
  records: ProcessRecord[],
  expected: AppBundlePaths,
  now: number = Date.now(),
): LifecycleTree {
  const layers = EMPTY_LAYERS();
  const foreign: LifecycleProcess[] = [];

  const push = (record: ProcessRecord, layer: LifecycleLayerName, canonical: boolean) => {
    const entry: LifecycleProcess = {
      ...record,
      layer,
      canonical,
      superseded: canonical && isSuperseded(record, now),
    };
    if (canonical) layers[layer].push(entry);
    else foreign.push(entry);
  };

  const expectedApp = expected.appExecutable;
  const expectedMenu = expected.menuExecutable;

  for (const record of records) {
    if (isSimulatorProcess(record)) continue;

    if (record.args.includes("scoutd supervise")) {
      push(record, "scoutd", true);
      continue;
    }
    if (record.args.includes("scoutd probes serve")) {
      push(record, "probes", true);
      continue;
    }
    if (record.args.includes("pairing-runtime-controller")) {
      push(record, "pairing", true);
      continue;
    }
    if (matchesName(record, "scout-base")) {
      push(record, "base", true);
      continue;
    }
    if (matchesName(record, "scout-broker")) {
      push(record, "broker", true);
      continue;
    }
    if (matchesName(record, "scout-edge")) {
      push(record, "edge", true);
      continue;
    }
    if (matchesName(record, "scout-web")) {
      push(record, "web", true);
      continue;
    }
    // Bundled apps are the layers where two checkouts collide, so they are the
    // layers where the path has to agree, not just the name.
    if (matchesName(record, "ScoutMenu")) {
      push(record, "menu", record.executable === expectedMenu);
      continue;
    }
    if (matchesName(record, "Scout")) {
      push(record, "app", record.executable === expectedApp);
      continue;
    }
  }

  return { layers, foreign, expected };
}

export function readLifecycleTree(expected: AppBundlePaths): LifecycleTree {
  return classifyProcesses(readProcessTable(), expected);
}

export function layerProcesses(tree: LifecycleTree, layers: LifecycleLayerName[]): LifecycleProcess[] {
  return layers.flatMap((layer) => tree.layers[layer]);
}

export function isRunning(tree: LifecycleTree): boolean {
  return layerProcesses(tree, [...SUPERVISED_LAYERS, ...LAUNCH_SERVICES_LAYERS]).length > 0;
}

// --- stop -------------------------------------------------------------------

export type StopStep =
  | { kind: "signal"; layer: LifecycleLayerName; pids: number[] }
  | { kind: "bootout"; label: string }
  | { kind: "sweep"; layers: LifecycleLayerName[]; pids: number[] };

/**
 * Leaf-first, with the supervised tree taken down as a unit.
 *
 * The LaunchServices apps go first and individually: nothing restarts them, and
 * the menu owns the pairing controllers, so the controllers have to be clear
 * before the menu is. Then one bootout collapses the entire launchd tree.
 * Anything still standing after that is a straggler, not a supervised child,
 * and only then is a direct kill correct.
 */
export type StopScope = "all" | "apps";

export function planStop(tree: LifecycleTree, scope: StopScope = "all"): StopStep[] {
  const steps: StopStep[] = [];

  for (const layer of LAUNCH_SERVICES_LAYERS) {
    const pids = tree.layers[layer].map((entry) => entry.pid);
    if (pids.length > 0) steps.push({ kind: "signal", layer, pids });
  }

  // `apps` exists for the build path: replacing the app bundle invalidates the
  // processes running from it, but says nothing about the launchd services, and
  // bouncing those would disconnect every agent for a rebuild that did not
  // touch them.
  if (scope === "apps") return steps;

  const supervised = layerProcesses(tree, SUPERVISED_LAYERS);
  if (supervised.length > 0) {
    steps.push({ kind: "bootout", label: SCOUT_LAUNCHD_LABEL });
    steps.push({
      kind: "sweep",
      layers: SUPERVISED_LAYERS,
      pids: supervised.map((entry) => entry.pid),
    });
  }

  return steps;
}

export function describeStopStep(step: StopStep): string {
  switch (step.kind) {
    case "signal":
      return `stop ${step.layer} (${step.pids.length} process${step.pids.length === 1 ? "" : "es"})`;
    case "bootout":
      return `bootout ${step.label}`;
    case "sweep":
      return `sweep supervised stragglers (${step.pids.length} candidate${step.pids.length === 1 ? "" : "s"})`;
  }
}

export type StopOutcome = {
  step: string;
  pids: number[];
  escalated: number[];
  survivors: number[];
};

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone, or not ours to signal. Liveness is re-checked either way.
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * TERM, wait for the process to actually go, then KILL what is left. Returns
 * the pids that needed escalation and the ones that survived both, so callers
 * can report honestly instead of assuming a fire-and-forget kill worked.
 */
export async function terminateProcesses(
  pids: number[],
  options: { graceMs?: number; pollMs?: number } = {},
): Promise<{ escalated: number[]; survivors: number[] }> {
  const graceMs = options.graceMs ?? 5_000;
  const pollMs = options.pollMs ?? 100;
  const escalated: number[] = [];

  const live = pids.filter(processAlive);
  for (const pid of live) signal(pid, "SIGTERM");

  const deadline = Date.now() + graceMs;
  let remaining = live.filter(processAlive);
  while (remaining.length > 0 && Date.now() < deadline) {
    await delay(pollMs);
    remaining = remaining.filter(processAlive);
  }

  for (const pid of remaining) {
    escalated.push(pid);
    signal(pid, "SIGKILL");
  }

  if (escalated.length > 0) {
    const killDeadline = Date.now() + 2_000;
    let stubborn = escalated.filter(processAlive);
    while (stubborn.length > 0 && Date.now() < killDeadline) {
      await delay(pollMs);
      stubborn = stubborn.filter(processAlive);
    }
    return { escalated, survivors: stubborn };
  }

  return { escalated, survivors: [] };
}

export function bootoutLaunchdJob(label: string, uid: number): { ok: boolean; detail: string } {
  const result = spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { encoding: "utf8" });
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  // "No such process" means the job was already unloaded, which is the state we
  // wanted anyway.
  const ok = (result.status ?? 1) === 0 || /No such process/i.test(detail);
  return { ok, detail };
}

export function kickstartLaunchdJob(label: string, uid: number): { ok: boolean; detail: string } {
  const result = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`], { encoding: "utf8" });
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: (result.status ?? 1) === 0, detail };
}

export function launchdJobLoaded(label: string, uid: number): boolean {
  const result = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], { stdio: "ignore" });
  return (result.status ?? 1) === 0;
}

export function launchAgentPlistPath(label: string, home: string): string {
  return join(home, "Library", "LaunchAgents", `${label}.plist`);
}

export function bootstrapLaunchdJob(plistPath: string, uid: number): { ok: boolean; detail: string } {
  const result = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { encoding: "utf8" });
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  // Already bootstrapped is the state we wanted.
  const ok = (result.status ?? 1) === 0 || /already bootstrapped|Operation already in progress/i.test(detail);
  return { ok, detail };
}

/**
 * Brings the launchd job up, whichever state it is in.
 *
 * `bootout` pairs with `bootstrap`, not with `kickstart`: booting a job out
 * *unloads it from the domain*, so a subsequent kickstart fails with "Could not
 * find service ... in domain for user". Kickstart only restarts a job that is
 * still loaded. Stop uses bootout, so start has to bootstrap from the plist —
 * checking first, because kickstart is the cheaper path when the job is loaded.
 */
export type LaunchdStartMethod = "kickstart" | "bootstrap" | "unavailable";

export function chooseLaunchdStartMethod(input: { loaded: boolean; plistExists: boolean }): LaunchdStartMethod {
  if (input.loaded) return "kickstart";
  return input.plistExists ? "bootstrap" : "unavailable";
}

export function startLaunchdJob(
  label: string,
  uid: number,
  home: string,
): { ok: boolean; detail: string; method: LaunchdStartMethod } {
  const plistPath = launchAgentPlistPath(label, home);
  const method = chooseLaunchdStartMethod({
    loaded: launchdJobLoaded(label, uid),
    plistExists: existsSync(plistPath),
  });

  switch (method) {
    case "kickstart":
      return { ...kickstartLaunchdJob(label, uid), method };
    case "bootstrap":
      return { ...bootstrapLaunchdJob(plistPath, uid), method };
    case "unavailable":
      return {
        ok: false,
        detail: `launchd job ${label} is not loaded and no plist exists at ${plistPath}`,
        method,
      };
  }
}

// --- verify -----------------------------------------------------------------

export type VerifyProblem = {
  layer: LifecycleLayerName | "launchd";
  message: string;
};

/**
 * Every layer must hold exactly one process, owned by the layer above it. This
 * is the assertion set `scripts/restart-all.mjs` has always made; it lives here
 * now so stop and start can consult the same definition of "correct" that
 * verification does.
 */
export function verifyTree(tree: LifecycleTree): VerifyProblem[] {
  const problems: VerifyProblem[] = [];

  const single = (layer: LifecycleLayerName): LifecycleProcess | null => {
    const found = tree.layers[layer];
    if (found.length === 0) {
      problems.push({ layer, message: `no ${layer} process is running` });
      return null;
    }
    if (found.length > 1) {
      problems.push({
        layer,
        message: `expected exactly one ${layer} process, found ${found.length} (pids ${found.map((entry) => entry.pid).join(", ")})`,
      });
      return null;
    }
    return found[0] ?? null;
  };

  const ownedBy = (child: LifecycleProcess | null, parent: LifecycleProcess | null, layer: LifecycleLayerName) => {
    if (!child || !parent) return;
    if (child.ppid !== parent.pid) {
      problems.push({
        layer,
        message: `${layer} pid ${child.pid} is owned by pid ${child.ppid}, expected ${parent.pid}`,
      });
    }
  };

  const scoutd = single("scoutd");
  if (scoutd && scoutd.ppid !== 1) {
    problems.push({ layer: "scoutd", message: `scoutd pid ${scoutd.pid} is not owned by launchd (ppid ${scoutd.ppid})` });
  }

  const base = single("base");
  const probes = single("probes");
  ownedBy(base, scoutd, "base");
  ownedBy(probes, scoutd, "probes");

  const broker = single("broker");
  const edge = single("edge");
  ownedBy(broker, base, "broker");
  ownedBy(edge, base, "edge");

  const web = single("web");
  ownedBy(web, broker, "web");

  const app = single("app");
  const menu = single("menu");

  for (const controller of tree.layers.pairing) {
    if (menu && controller.ppid !== menu.pid) {
      problems.push({
        layer: "pairing",
        message: `pairing controller pid ${controller.pid} is not owned by ScoutMenu pid ${menu.pid}`,
      });
    }
  }

  for (const stray of tree.foreign) {
    problems.push({
      layer: stray.layer,
      message: `${stray.layer} pid ${stray.pid} is running from an unexpected bundle: ${stray.executable}`,
    });
  }

  for (const stale of layerProcesses(tree, [...SUPERVISED_LAYERS, ...LAUNCH_SERVICES_LAYERS])) {
    if (!stale.superseded) continue;
    problems.push({
      layer: stale.layer,
      message: `${stale.layer} pid ${stale.pid} is running a superseded build — ${stale.executable} was rebuilt after it started; restart to pick it up`,
    });
  }

  void app;
  return problems;
}
