import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDefaultBrokerUrl,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_URL,
  parseLaunchctlPrint,
  renderLaunchAgentPlist,
  resolveBundledRuntimeDirFromModuleDir,
  selectLastRelevantLogLine,
  type BrokerServiceConfig,
} from "./broker-process-manager";

const config: BrokerServiceConfig = {
  label: "dev.openscout",
  mode: "dev",
  uid: 501,
  domainTarget: "gui/501",
  serviceTarget: "gui/501/dev.openscout",
  launchAgentPath: "/Users/arach/Library/LaunchAgents/dev.openscout.plist",
  supportDirectory: "/Users/arach/Library/Application Support/OpenScout",
  runtimeDirectory: "/Users/arach/Library/Application Support/OpenScout/runtime",
  logsDirectory: "/Users/arach/Library/Application Support/OpenScout/logs/broker",
  stdoutLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stdout.log",
  stderrLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stderr.log",
  controlHome: "/Users/arach/.openscout/control-plane",
  runtimePackageDir: "/Users/arach/dev/openscout/packages/runtime",
  bunExecutable: "/Users/arach/.bun/bin/bun",
  brokerHost: DEFAULT_BROKER_HOST,
  brokerPort: DEFAULT_BROKER_PORT,
  brokerUrl: DEFAULT_BROKER_URL,
  brokerSocketPath: "/Users/arach/Library/Application Support/OpenScout/runtime/broker.sock",
  advertiseScope: "local",
};

describe("broker launch agent config", () => {
  test("renders a launch agent plist with the expected command and environment", () => {
    const plist = renderLaunchAgentPlist(config);

    expect(plist).toContain("<string>dev.openscout</string>");
    expect(plist).toContain("<string>/Users/arach/.bun/bin/bun</string>");
    expect(plist).toContain(
      "<string>/Users/arach/dev/openscout/packages/runtime/bin/openscout-runtime.mjs</string>",
    );
    expect(plist).toContain("<string>base</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain("<string>/Users/arach/dev/openscout/packages/runtime</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
    expect(plist).toContain("<key>OPENSCOUT_BROKER_URL</key>");
    expect(plist).toContain(`<string>${DEFAULT_BROKER_URL}</string>`);
    expect(plist).toContain("<key>OPENSCOUT_BROKER_SOCKET_PATH</key>");
    expect(plist).toContain("<string>/Users/arach/Library/Application Support/OpenScout/runtime/broker.sock</string>");
  });

  test("preserves optional web edge environment overrides", () => {
    const originalEdgeScheme = process.env.OPENSCOUT_WEB_EDGE_SCHEME;
    const originalPublicOrigin = process.env.OPENSCOUT_WEB_PUBLIC_ORIGIN;
    try {
      process.env.OPENSCOUT_WEB_EDGE_SCHEME = "both";
      process.env.OPENSCOUT_WEB_PUBLIC_ORIGIN = "https://scout.local";

      const plist = renderLaunchAgentPlist(config);

      expect(plist).toContain("<key>OPENSCOUT_WEB_EDGE_SCHEME</key>");
      expect(plist).toContain("<string>both</string>");
      expect(plist).toContain("<key>OPENSCOUT_WEB_PUBLIC_ORIGIN</key>");
      expect(plist).toContain("<string>https://scout.local</string>");
    } finally {
      if (originalEdgeScheme === undefined) {
        delete process.env.OPENSCOUT_WEB_EDGE_SCHEME;
      } else {
        process.env.OPENSCOUT_WEB_EDGE_SCHEME = originalEdgeScheme;
      }
      if (originalPublicOrigin === undefined) {
        delete process.env.OPENSCOUT_WEB_PUBLIC_ORIGIN;
      } else {
        process.env.OPENSCOUT_WEB_PUBLIC_ORIGIN = originalPublicOrigin;
      }
    }
  });

  test("resolves the package root from a bundled scout dist runtime module", () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-runtime-package-"));
    const packageRoot = join(root, "scout");
    const moduleDir = join(packageRoot, "dist", "runtime");

    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), "{}");
    writeFileSync(join(packageRoot, "bin", "openscout-runtime.mjs"), "");

    expect(resolveBundledRuntimeDirFromModuleDir(moduleDir)).toBe(packageRoot);
  });

  test("parses launchctl print output for pid and state", () => {
    const parsed = parseLaunchctlPrint(`
system/com.example.job = {
    active count = 1
    path = /Users/arach/Library/LaunchAgents/dev.openscout.plist
    type = LaunchAgent
    state = running

    program = /Users/arach/.bun/bin/bun
    arguments = {
        /Users/arach/.bun/bin/bun
    }

    pid = 12345
    last exit code = 0
}
`);

    expect(parsed.pid).toBe(12345);
    expect(parsed.launchdState).toBe("running");
    expect(parsed.lastExitStatus).toBe(0);
  });

  test("prefers informative runtime log lines over package script banners", () => {
    expect(
      selectLastRelevantLogLine([
        "$ bun run src/broker-daemon.ts",
        `[openscout-runtime] broker listening on ${DEFAULT_BROKER_URL}`,
      ]),
    ).toBe(`[openscout-runtime] broker listening on ${DEFAULT_BROKER_URL}`);

    expect(
      selectLastRelevantLogLine([
        "$ npm run broker",
      ]),
    ).toBe("$ npm run broker");

    expect(
      selectLastRelevantLogLine([
        "$ bun run src/broker-daemon.ts",
      ]),
    ).toBe("$ bun run src/broker-daemon.ts");
  });
});
