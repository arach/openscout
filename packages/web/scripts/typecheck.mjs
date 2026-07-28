#!/usr/bin/env node
// Typecheck packages/web against a checked-in baseline of known errors.
//
// `bun build` strips types without checking them and the root `check` script
// never ran tsc here, so this package accumulated standing type debt (see
// docs/eng/terminal-durable-workspaces-assessment.md). Blocking on a clean
// tree would mean fixing ~100 unrelated errors before any other work; not
// checking at all is what let a held branch land a broken barrel export and
// dead casts. So: run the compiler for real, allow exactly the errors recorded
// in typecheck-baseline.json, and fail on anything new.
//
//   node scripts/typecheck.mjs            # gate
//   node scripts/typecheck.mjs --update   # re-record the baseline
//
// Baseline entries are keyed by file + code + message, never by line, so
// unrelated edits above a known error do not trip the gate.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(packageRoot, "typecheck-baseline.json");
const update = process.argv.includes("--update");

const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u;

function runTsc() {
  const result = spawnSync(
    join(packageRoot, "node_modules", ".bin", "tsc"),
    ["--noEmit", "-p", "tsconfig.json"],
    { cwd: packageRoot, encoding: "utf8" },
  );
  if (result.error) {
    console.error(`[web:check] could not run tsc: ${result.error.message}`);
    process.exit(1);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function parseDiagnostics(output) {
  const diagnostics = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const match = ERROR_LINE.exec(rawLine.trim());
    if (!match?.groups) continue;
    diagnostics.push({
      file: match.groups.file,
      code: match.groups.code,
      message: match.groups.message,
      line: Number(match.groups.line),
    });
  }
  return diagnostics;
}

function diagnosticKey(diagnostic) {
  return JSON.stringify([diagnostic.file, diagnostic.code, diagnostic.message]);
}

function tally(diagnostics) {
  const entries = new Map();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const entry = entries.get(key);
    if (entry) {
      entry.count += 1;
      continue;
    }
    entries.set(key, {
      file: diagnostic.file,
      code: diagnostic.code,
      message: diagnostic.message,
      count: 1,
    });
  }
  return entries;
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    const counts = new Map();
    for (const entry of parsed.errors ?? []) {
      counts.set(diagnosticKey(entry), entry.count ?? 1);
    }
    return counts;
  } catch {
    return new Map();
  }
}

function writeBaseline(diagnostics) {
  const errors = [...tally(diagnostics).values()].sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  );
  const note = "Known packages/web type errors that predate the typecheck gate. "
    + "Never add to this file by hand: fix the error instead. Regenerate with "
    + "`node scripts/typecheck.mjs --update` only when the count goes DOWN.";
  writeFileSync(
    baselinePath,
    `${JSON.stringify({
      note,
      total: errors.reduce((sum, entry) => sum + entry.count, 0),
      errors,
    }, null, 2)}\n`,
  );
  return errors.length;
}

const diagnostics = parseDiagnostics(runTsc());

if (update) {
  const distinct = writeBaseline(diagnostics);
  console.log(`[web:check] recorded ${diagnostics.length} error(s) across ${distinct} baseline entries`);
  process.exit(0);
}

const baseline = readBaseline();
const observed = tally(diagnostics);
const regressions = [];
const reported = new Set();
for (const diagnostic of diagnostics) {
  const key = diagnosticKey(diagnostic);
  if (reported.has(key)) continue;
  if ((observed.get(key)?.count ?? 0) <= (baseline.get(key) ?? 0)) continue;
  reported.add(key);
  regressions.push(diagnostic);
}

if (regressions.length > 0) {
  console.error(`[web:check] ${regressions.length} new type error(s) not in typecheck-baseline.json:\n`);
  for (const diagnostic of regressions) {
    console.error(`  ${diagnostic.file}:${diagnostic.line} ${diagnostic.code}: ${diagnostic.message}`);
  }
  console.error("\nFix them. The baseline records pre-existing debt only and must never grow.");
  process.exit(1);
}

const baselineTotal = [...baseline.values()].reduce((sum, count) => sum + count, 0);
if (diagnostics.length < baselineTotal) {
  console.log(
    `[web:check] ok - ${diagnostics.length} baselined error(s) left, down from ${baselineTotal}. `
      + "Run `node scripts/typecheck.mjs --update` to lock in the improvement.",
  );
} else {
  console.log(`[web:check] ok - no new type errors (${diagnostics.length} baselined)`);
}
