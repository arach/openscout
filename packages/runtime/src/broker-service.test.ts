import { describe, expect, test } from "bun:test";

import {
  buildDefaultBrokerUrl,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_URL,
  parseLaunchctlPrint,
  renderLaunchAgentPlist,
  selectLastRelevantLogLine,
  type BrokerServiceConfig,
} from "./broker-service";

const config: BrokerServiceConfig = {
  label: "dev.openscout.broker",
  mode: "dev",
  uid: 501,
  domainTarget: "gui/501",
  serviceTarget: "gui/501/dev.openscout.broker",
  launchAgentPath: "/Users/arach/Library/LaunchAgents/dev.openscout.broker.plist",
  supportDirectory: "/Users/arach/Library/Application Support/OpenScout",
  logsDirectory: "/Users/arach/Library/Application Support/OpenScout/logs/broker",
  stdoutLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stdout.log",
  stderrLogPath: "/Users/arach/Library/Application Support/OpenScout/logs/broker/stderr.log",
  controlHome: "/Users/arach/.openscout/control-plane",
  runtimePackageDir: "/Users/arach/dev/openscout/packages/runtime",
  bunExecutable: "/Users/arach/.bun/bin/bun",
  brokerHost: DEFAULT_BROKER_HOST,
  brokerPort: DEFAULT_BROKER_PORT,
  brokerUrl: DEFAULT_BROKER_URL,
};

describe("broker launch agent config", () => {
  test("renders a launch agent plist with the expected command and environment", () => {
    const plist = renderLaunchAgentPlist(config);

    expect(plist).toContain("<string>dev.openscout.broker</string>");
    expect(plist).toContain("<string>/Users/arach/.bun/bin/bun</string>");
    expect(plist).toContain("<string>--cwd</string>");
    expect(plist).toContain("<string>/Users/arach/dev/openscout/packages/runtime</string>");
    expect(plist).toContain("<string>broker</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
    expect(plist).toContain("<key>OPENSCOUT_BROKER_URL</key>");
    expect(plist).toContain(`<string>${DEFAULT_BROKER_URL}</string>`);
  });

  test("parses launchctl print output for pid and state", () => {
    const parsed = parseLaunchctlPrint(`
system/com.example.job = {
    active count = 1
    path = /Users/arach/Library/LaunchAgents/dev.openscout.broker.plist
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
