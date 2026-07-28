// Pure grading logic for the packages/web typecheck ratchet.
//
// Split out of typecheck.mjs so the decisions that make it a ratchet — what
// counts as a compiler that did not run, what counts as a regression, what
// `--update` is allowed to record — are testable without shelling out to a real
// compiler. typecheck.mjs owns the process: spawning tsc, reading and writing
// the baseline file, printing, exiting.

const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u;
/** A fatal tsc diagnostic with no file position: bad config, missing tsconfig, no inputs. */
const POSITIONLESS_ERROR_LINE = /^error (?<code>TS\d+): (?<message>.*)$/u;
/**
 * Anything that opens a diagnostic. tsc indents a diagnostic's continuation
 * lines, so an unindented line mentioning an error code is always a header —
 * which makes "every header parsed" a check the gate can enforce without
 * knowing tsc's output flavour. That is the property that matters: a header
 * this parser cannot read must fail the run, not vanish from the count.
 */
const ERROR_CODE_MENTION = /(?:^|\s)error TS\d+:/u;
const isDiagnosticHeader = (line) => /^\S/u.test(line) && ERROR_CODE_MENTION.test(line);
/** tsc's own tally, printed in pretty mode. Cross-checked when present. */
const FOUND_ERRORS_LINE = /^Found (?<count>\d+) errors?\b/u;

export function parseDiagnostics(output) {
  const diagnostics = [];
  const fatals = [];
  const unparseable = [];
  let reportedTotal = null;
  for (const rawLine of String(output ?? "").split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+$/u, "");
    const found = FOUND_ERRORS_LINE.exec(line);
    if (found?.groups) {
      reportedTotal = Number(found.groups.count);
      continue;
    }
    if (!isDiagnosticHeader(line)) continue;
    const match = ERROR_LINE.exec(line);
    if (match?.groups) {
      diagnostics.push({
        file: match.groups.file,
        code: match.groups.code,
        message: match.groups.message,
        line: Number(match.groups.line),
      });
      continue;
    }
    const positionless = POSITIONLESS_ERROR_LINE.exec(line);
    if (positionless?.groups) {
      fatals.push(`${positionless.groups.code}: ${positionless.groups.message}`);
      continue;
    }
    unparseable.push(line);
  }
  return { diagnostics, fatals, unparseable, reportedTotal };
}

/**
 * Why this compiler run cannot be graded, or null when it can.
 *
 * Every branch is a case where the previous runner printed "ok" for a compiler
 * that had checked nothing: a crash before any diagnostics, a config-level
 * fatal with no file position, a kill signal, output the parser only partly
 * read. Reporting zero errors for a run that type-checked nothing is the single
 * way a gate like this becomes worse than having no gate.
 */
export function compilerRunProblem(run, parsed) {
  if (run.signal) {
    return `tsc was killed by ${run.signal}; the type check did not complete.`;
  }
  if (parsed.fatals.length > 0) {
    return `tsc reported ${parsed.fatals.length} fatal diagnostic(s) with no file position, so the `
      + `project did not type-check:\n  ${parsed.fatals.join("\n  ")}`;
  }
  if (run.status !== 0 && parsed.diagnostics.length === 0) {
    return `tsc exited ${run.status} without emitting a parseable diagnostic. The type check did not `
      + "run; this is not a clean tree.";
  }
  if (run.status === 0 && parsed.diagnostics.length > 0) {
    return `tsc exited 0 while reporting ${parsed.diagnostics.length} error(s). Refusing to interpret `
      + "a contradictory run.";
  }
  if (parsed.unparseable.length > 0) {
    return `tsc emitted ${parsed.unparseable.length} diagnostic header(s) this gate cannot read, so `
      + `the error count is not trustworthy:\n  ${parsed.unparseable.slice(0, 10).join("\n  ")}`;
  }
  if (parsed.reportedTotal !== null && parsed.reportedTotal !== parsed.diagnostics.length) {
    return `tsc reported ${parsed.reportedTotal} error(s) but this gate parsed `
      + `${parsed.diagnostics.length}. Something in the output is unparseable; refusing to grade a `
      + "partial read.";
  }
  return null;
}

export function diagnosticKey(diagnostic) {
  return JSON.stringify([diagnostic.file, diagnostic.code, diagnostic.message]);
}

export function tally(diagnostics) {
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

/** Distinct diagnostics observed more often than the baseline allows. */
export function regressionsOf(diagnostics, observed, baseline) {
  const regressions = [];
  const reported = new Set();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (reported.has(key)) continue;
    if ((observed.get(key)?.count ?? 0) <= (baseline.get(key) ?? 0)) continue;
    reported.add(key);
    regressions.push(diagnostic);
  }
  return regressions;
}

/**
 * Entries the observed run would ADD to the baseline, or grow within it. The
 * baseline records pre-existing debt; anything here is a regression trying to
 * enter through the update path.
 */
export function baselineGrowth(observed, baseline) {
  const growth = [];
  for (const [key, entry] of observed) {
    const allowed = baseline.get(key) ?? 0;
    if (entry.count > allowed) growth.push({ ...entry, allowed });
  }
  return growth;
}

export function baselineTotalOf(baseline) {
  return [...baseline.values()].reduce((sum, count) => sum + count, 0);
}
