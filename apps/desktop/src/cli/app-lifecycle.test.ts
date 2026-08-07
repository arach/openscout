import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appBundlePathsForRoot,
  chooseLaunchdStartMethod,
  classifyProcesses,
  isRunning,
  launchAgentPlistPath,
  isSuperseded,
  LAUNCH_SERVICES_LAYERS,
  parseElapsedSeconds,
  parseProcessTable,
  planStop,
  SCOUT_LAUNCHD_LABEL,
  SUPERVISED_LAYERS,
  verifyTree,
} from "./app-lifecycle.ts";

const DIST = "/Users/dev/openscout/apps/macos/dist";
const OTHER_DIST = "/Users/dev/openscout-check/apps/macos/dist";
const paths = appBundlePathsForRoot(DIST);

/** Renders seconds the way `ps -o etime=` does: `[[dd-]hh:]mm:ss`. */
function etime(totalSeconds: number): string {
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600) % 24;
  const days = Math.floor(totalSeconds / 86_400);
  const base = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (days > 0) return `${days}-${String(hours).padStart(2, "0")}:${base}`;
  if (hours > 0) return `${hours}:${base}`;
  return base;
}

function line(pid: number, ppid: number, command: string, args: string, elapsed = 60): string {
  return `${String(pid).padStart(6)} ${String(ppid).padStart(6)} ${etime(elapsed).padStart(12)} ${command} ${args}`;
}

function healthyTable(): string {
  return [
    line(100, 1, "scoutd", "/usr/local/bin/scoutd supervise"),
    line(200, 100, "scout-base", "/repo/packages/runtime/bin/openscout-runtime.mjs base"),
    line(201, 100, "scoutd", "/usr/local/bin/scoutd probes serve"),
    line(300, 200, "scout-broker", "/repo/packages/runtime/bin/openscout-runtime.mjs broker"),
    line(301, 200, "scout-edge", "/repo/packages/runtime/bin/openscout-runtime.mjs edge"),
    line(400, 300, "scout-web", "/repo/packages/runtime/bin/openscout-runtime.mjs web"),
    line(500, 1, "Scout", `${DIST}/Scout.app/Contents/MacOS/Scout`),
    line(600, 500, "ScoutMenu", `${DIST}/Scout.app/Contents/Library/LoginItems/ScoutMenu.app/Contents/MacOS/ScoutMenu`),
  ].join("\n");
}

describe("parseProcessTable", () => {
  test("keys identity on argv[0], not the process name", () => {
    const [record] = parseProcessTable(line(42, 1, "Scout", "/somewhere/Scout.app/Contents/MacOS/Scout --hud", 900));
    expect(record).toMatchObject({
      pid: 42,
      ppid: 1,
      command: "Scout",
      executable: "/somewhere/Scout.app/Contents/MacOS/Scout",
      elapsedSeconds: 900,
    });
  });

  test("skips lines that are not process rows", () => {
    expect(parseProcessTable("PID PPID ELAPSED COMM ARGS\n\n  not a row")).toEqual([]);
  });

  test("reads every etime shape Darwin emits", () => {
    expect(parseElapsedSeconds("20:46")).toBe(20 * 60 + 46);
    expect(parseElapsedSeconds("1:02:03")).toBe(3_723);
    expect(parseElapsedSeconds("06-00:43:00")).toBe(6 * 86_400 + 43 * 60);
    expect(Number.isNaN(parseElapsedSeconds("garbage"))).toBe(true);
  });
});

describe("isSuperseded", () => {
  const binary = join(mkdtempSync(join(tmpdir(), "scout-lifecycle-")), "Scout");

  test("flags a process older than the binary it is running", () => {
    writeFileSync(binary, "#!/bin/sh\n");
    const now = Date.now();
    // Started ten minutes ago; the binary was written just now.
    const record = { ...parseProcessTable(line(1, 1, "Scout", binary, 600))[0]! };
    expect(isSuperseded(record, now)).toBe(true);
  });

  test("does not flag a process started after its binary was written", () => {
    writeFileSync(binary, "#!/bin/sh\n");
    const now = Date.now() + 600_000;
    const record = { ...parseProcessTable(line(1, 1, "Scout", binary, 60))[0]! };
    expect(isSuperseded(record, now)).toBe(false);
  });

  test("does not flag a binary it cannot stat", () => {
    const record = { ...parseProcessTable(line(1, 1, "Scout", "/nope/Scout", 600))[0]! };
    expect(isSuperseded(record, Date.now())).toBe(false);
  });
});

describe("classifyProcesses", () => {
  test("maps a healthy suite onto every layer", () => {
    const tree = classifyProcesses(parseProcessTable(healthyTable()), paths);
    expect(tree.layers.scoutd.map((entry) => entry.pid)).toEqual([100]);
    expect(tree.layers.base.map((entry) => entry.pid)).toEqual([200]);
    expect(tree.layers.probes.map((entry) => entry.pid)).toEqual([201]);
    expect(tree.layers.broker.map((entry) => entry.pid)).toEqual([300]);
    expect(tree.layers.edge.map((entry) => entry.pid)).toEqual([301]);
    expect(tree.layers.web.map((entry) => entry.pid)).toEqual([400]);
    expect(tree.layers.app.map((entry) => entry.pid)).toEqual([500]);
    expect(tree.layers.menu.map((entry) => entry.pid)).toEqual([600]);
    expect(tree.foreign).toEqual([]);
    expect(verifyTree(tree)).toEqual([]);
  });

  test("a Scout from another worktree is foreign, not ours", () => {
    const table = `${healthyTable()}\n${line(900, 1, "Scout", `${OTHER_DIST}/Scout.app/Contents/MacOS/Scout`)}`;
    const tree = classifyProcesses(parseProcessTable(table), paths);

    expect(tree.layers.app.map((entry) => entry.pid)).toEqual([500]);
    expect(tree.foreign.map((entry) => entry.pid)).toEqual([900]);
    // The whole point: a foreign process is never a stop candidate.
    const stopped = planStop(tree).flatMap((step) => (step.kind === "bootout" ? [] : step.pids));
    expect(stopped).not.toContain(900);
  });

  test("a stale menu from a replaced bundle does not satisfy the menu layer", () => {
    const stale = line(
      700,
      1,
      "ScoutMenu",
      `${OTHER_DIST}/Scout.app/Contents/Library/LoginItems/ScoutMenu.app/Contents/MacOS/ScoutMenu`,
    );
    const tree = classifyProcesses(parseProcessTable(stale), paths);

    expect(tree.layers.menu).toEqual([]);
    expect(tree.foreign.map((entry) => entry.layer)).toEqual(["menu"]);
    expect(verifyTree(tree).some((problem) => /unexpected bundle/.test(problem.message))).toBe(true);
  });

  test("ignores the iOS simulator's copy of Scout", () => {
    const sim = line(
      800,
      1,
      "Scout",
      "/Users/dev/Library/Developer/CoreSimulator/Devices/ABC/data/Containers/Bundle/Application/X/Scout.app/Scout",
    );
    const tree = classifyProcesses(parseProcessTable(sim), paths);
    expect(tree.layers.app).toEqual([]);
    expect(tree.foreign).toEqual([]);
  });

  test("reports an empty machine as not running", () => {
    expect(isRunning(classifyProcesses([], paths))).toBe(false);
    expect(isRunning(classifyProcesses(parseProcessTable(healthyTable()), paths))).toBe(true);
  });
});

describe("planStop", () => {
  test("takes the LaunchServices tree down leaf-first, then bootouts the supervised tree", () => {
    const table = `${healthyTable()}\n${line(650, 600, "bun", "/repo/pairing-runtime-controller.ts")}`;
    const tree = classifyProcesses(parseProcessTable(table), paths);
    const steps = planStop(tree);

    expect(steps.map((step) => (step.kind === "signal" ? step.layer : step.kind))).toEqual([
      ...LAUNCH_SERVICES_LAYERS,
      "bootout",
      "sweep",
    ]);

    // Pairing controllers are owned by the menu, so they clear before it does.
    const signalled = steps.flatMap((step) => (step.kind === "signal" ? [{ layer: step.layer, pids: step.pids }] : []));
    expect(signalled[0]).toEqual({ layer: "pairing", pids: [650] });
    expect(signalled[1]).toEqual({ layer: "menu", pids: [600] });
    expect(signalled[2]).toEqual({ layer: "app", pids: [500] });
  });

  test("never signals supervised layers before the bootout", () => {
    const tree = classifyProcesses(parseProcessTable(healthyTable()), paths);
    const steps = planStop(tree);
    const bootoutIndex = steps.findIndex((step) => step.kind === "bootout");
    const supervisedPids = new Set(SUPERVISED_LAYERS.flatMap((layer) => tree.layers[layer].map((e) => e.pid)));

    for (const step of steps.slice(0, bootoutIndex)) {
      if (step.kind === "signal") {
        for (const pid of step.pids) expect(supervisedPids.has(pid)).toBe(false);
      }
    }

    const bootout = steps[bootoutIndex];
    expect(bootout).toEqual({ kind: "bootout", label: SCOUT_LAUNCHD_LABEL });
  });

  test("sweeps supervised stragglers only after the bootout", () => {
    const tree = classifyProcesses(parseProcessTable(healthyTable()), paths);
    const steps = planStop(tree);
    const sweep = steps.at(-1);
    expect(sweep?.kind).toBe("sweep");
    if (sweep?.kind === "sweep") {
      expect(sweep.pids.sort()).toEqual([100, 200, 201, 300, 301, 400]);
    }
  });

  test("plans nothing for a machine with nothing running", () => {
    expect(planStop(classifyProcesses([], paths))).toEqual([]);
  });

  test("the apps scope never touches the launchd tree", () => {
    const tree = classifyProcesses(parseProcessTable(healthyTable()), paths);
    const steps = planStop(tree, "apps");

    expect(steps.every((step) => step.kind === "signal")).toBe(true);
    expect(steps.map((step) => (step.kind === "signal" ? step.layer : step.kind))).toEqual(["menu", "app"]);
    // A rebuild must not bounce the services every agent is connected through.
    expect(steps.some((step) => step.kind === "bootout" || step.kind === "sweep")).toBe(false);
  });
});

describe("chooseLaunchdStartMethod", () => {
  // `bootout` unloads the job from the domain, so the start half of a stop/start
  // cycle has to bootstrap from the plist. Kickstarting a booted-out job fails
  // with "Could not find service ... in domain for user" and leaves the whole
  // supervised tree down.
  test("bootstraps after a bootout, because the job is no longer loaded", () => {
    expect(chooseLaunchdStartMethod({ loaded: false, plistExists: true })).toBe("bootstrap");
  });

  test("kickstarts a job that is still loaded", () => {
    expect(chooseLaunchdStartMethod({ loaded: true, plistExists: true })).toBe("kickstart");
  });

  test("reports unavailable rather than pretending when there is no plist", () => {
    expect(chooseLaunchdStartMethod({ loaded: false, plistExists: false })).toBe("unavailable");
  });

  test("resolves the LaunchAgents plist path", () => {
    expect(launchAgentPlistPath("app.openscout", "/Users/dev")).toBe(
      "/Users/dev/Library/LaunchAgents/app.openscout.plist",
    );
  });
});

describe("verifyTree", () => {
  test("flags a duplicate broker", () => {
    const table = `${healthyTable()}\n${line(302, 200, "scout-broker", "/repo/packages/runtime/bin/openscout-runtime.mjs broker")}`;
    const tree = classifyProcesses(parseProcessTable(table), paths);
    expect(verifyTree(tree).some((problem) => problem.layer === "broker" && /found 2/.test(problem.message))).toBe(true);
  });

  test("flags a broker that is not owned by base", () => {
    const table = healthyTable().replace(
      line(300, 200, "scout-broker", "/repo/packages/runtime/bin/openscout-runtime.mjs broker"),
      line(300, 1, "scout-broker", "/repo/packages/runtime/bin/openscout-runtime.mjs broker"),
    );
    const tree = classifyProcesses(parseProcessTable(table), paths);
    expect(verifyTree(tree).some((problem) => /owned by pid 1, expected 200/.test(problem.message))).toBe(true);
  });

  test("fails closed when web is orphaned from the broker", () => {
    const table = healthyTable().replace(
      line(400, 300, "scout-web", "/repo/packages/runtime/bin/openscout-runtime.mjs web"),
      line(400, 1, "scout-web", "/repo/packages/runtime/bin/openscout-runtime.mjs web"),
    );
    const tree = classifyProcesses(parseProcessTable(table), paths);
    expect(verifyTree(tree).some((problem) =>
      problem.layer === "web" && /owned by pid 1, expected 300/.test(problem.message)
    )).toBe(true);
  });

  test("flags scoutd that launchd does not own", () => {
    const table = healthyTable().replace(
      line(100, 1, "scoutd", "/usr/local/bin/scoutd supervise"),
      line(100, 55, "scoutd", "/usr/local/bin/scoutd supervise"),
    );
    const tree = classifyProcesses(parseProcessTable(table), paths);
    expect(verifyTree(tree).some((problem) => /not owned by launchd/.test(problem.message))).toBe(true);
  });

  test("flags a pairing controller adopted away from the menu", () => {
    const table = `${healthyTable()}\n${line(650, 1, "bun", "/repo/pairing-runtime-controller.ts")}`;
    const tree = classifyProcesses(parseProcessTable(table), paths);
    expect(verifyTree(tree).some((problem) => problem.layer === "pairing")).toBe(true);
  });
});
