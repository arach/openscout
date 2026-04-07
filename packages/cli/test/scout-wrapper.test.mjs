import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(testDirectory, "..");

test("scout wrapper exposes the new Scout CLI surface", () => {
  const output = execFileSync("bun", ["./bin/scout.mjs", "--help"], {
    cwd: packageDirectory,
    encoding: "utf8",
  });

  assert.match(output, /\bsetup\b/);
  assert.match(output, /\bpair\b/);
  assert.match(output, /\bserver\b/);
  assert.match(output, /Implicit ask:/);
  assert.match(output, /scout @agent your request/);
  assert.match(output, /Deprecated aliases:/);
  assert.match(output, /\binit\s+Deprecated alias for setup\b/);
  assert.doesNotMatch(output, /\bscout dev\b/);
});
