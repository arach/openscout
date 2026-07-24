import { describe, expect, test } from "bun:test";
import { parseArgs, parseProcessTable, verifyProcessOwnership } from "./restart-all.mjs";

describe("scout:up", () => {
  test("parses canonical lifecycle options", () => {
    expect(parseArgs(["bun", "restart-all.mjs", "--fresh", "--no-ios", "--web-port", "44000"])).toMatchObject({
      fresh: true,
      ios: false,
      verifyOnly: false,
      webPort: 44000,
    });
    expect(parseArgs(["bun", "restart-all.mjs", "--verify-only"])).toMatchObject({
      verifyOnly: true,
      ios: false,
    });
  });

  test("accepts only the canonical supervised process tree", () => {
    const menu = "/repo/apps/macos/dist/Scout.app/Contents/Library/LoginItems/ScoutMenu.app";
    const processes = parseProcessTable(`
  10 1 /repo/scoutd /repo/scoutd supervise
  11 10 scout-base scout-base /repo/openscout-runtime.mjs base
  12 10 /repo/scoutd /repo/scoutd probes serve
  13 11 scout-broker scout-broker run /repo/openscout-runtime.mjs broker
  14 11 scout-edge scout-edge run --config Caddyfile
  15 13 scout-web scout-web run /repo/packages/web/server/index.ts
  16 1 /Users/art/dev/o /repo/apps/macos/dist/Scout.app/Contents/MacOS/Scout
  17 1 /Users/art/dev/o ${menu}/Contents/MacOS/ScoutMenu
  18 17 bun bun /repo/packages/web/dist/pairing-runtime-controller.mjs
`);
    const verified = verifyProcessOwnership({
      pid: 10,
      scoutdState: { scoutdPid: 10, basePid: 11, probePid: 12 },
    }, processes, menu);
    expect(verified.web.pid).toBe(15);
    expect(verified.menu.pid).toBe(17);
    expect(verified.pairingControllers).toHaveLength(1);
  });

  test("fails closed when web is orphaned", () => {
    const menu = "/repo/apps/macos/dist/Scout.app/Contents/Library/LoginItems/ScoutMenu.app";
    const processes = parseProcessTable(`
  10 1 scoutd scoutd supervise
  11 10 scout-base scout-base runtime base
  12 10 scoutd scoutd probes serve
  13 11 scout-broker scout-broker runtime broker
  14 11 scout-edge scout-edge run
  15 1 scout-web scout-web run server
  16 1 Scout /repo/Scout
  17 1 ScoutMenu ${menu}/Contents/MacOS/ScoutMenu
`);
    expect(() => verifyProcessOwnership({
      pid: 10,
      scoutdState: { scoutdPid: 10, basePid: 11, probePid: 12 },
    }, processes, menu)).toThrow("scout-web pid 15 is owned by pid 1, expected 13");
  });
});
