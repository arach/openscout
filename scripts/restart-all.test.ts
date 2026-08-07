import { describe, expect, test } from "bun:test";
import {
  legacyScoutServiceLabels,
  parseArgs,
} from "./restart-all.mjs";

// Process-ownership coverage moved with the model itself; the tree, the stop
// order, and the verification rules now live in
// apps/desktop/src/cli/app-lifecycle.ts and are tested alongside it. What stays
// here is what this script still owns: its own dev-only flags.
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

  test("recognizes supervisor labels replaced by the canonical service", () => {
    expect(legacyScoutServiceLabels("dev")).toEqual(["dev.openscout", "com.openscout"]);
    expect(legacyScoutServiceLabels("prod")).toEqual(["dev.openscout", "com.openscout"]);
    expect(legacyScoutServiceLabels("custom")).toEqual(["com.openscout.custom"]);
  });
});
