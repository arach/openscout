#!/usr/bin/env bun
/**
 * `ds` — the design system CLI.
 *
 * Agent-facing query surface for the component registry that works with no
 * dev server running. Run with `bun scripts/ds.ts <command>` (wired up as
 * `bun run ds` in package.json).
 *
 * Uses relative imports rather than the `@/` path alias: that alias is a
 * `tsconfig.json` `paths` entry resolved by the TypeScript/Next.js compiler,
 * and does not resolve under a plain `bun run` of this file.
 */

import {
  allComponents,
  componentsByStatus,
  findComponents,
  getComponent,
  registryHealth,
} from "../lib/design-system/registry";
import { auditManifest, type AuditIssue, type ComponentStatus } from "../lib/design-system/manifest";
import { PORT_CONTRACT } from "../lib/design-system/port-contract";
import { portHashes, verifyManifest, verifyRegistry } from "../lib/design-system/verify.node";

const STATUSES: ComponentStatus[] = ["draft", "candidate", "graduated"];

function isStatus(value: string): value is ComponentStatus {
  return (STATUSES as string[]).includes(value);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ── arg parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  positionals: string[];
  json: boolean;
  status?: ComponentStatus;
  limit?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let json = false;
  let status: ComponentStatus | undefined;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--status") {
      const next = argv[++i];
      if (!next || !isStatus(next)) {
        fail(`--status must be one of: ${STATUSES.join(", ")}`);
      }
      status = next as ComponentStatus;
    } else if (arg.startsWith("--status=")) {
      const value = arg.slice("--status=".length);
      if (!isStatus(value)) {
        fail(`--status must be one of: ${STATUSES.join(", ")}`);
      }
      status = value as ComponentStatus;
    } else if (arg === "--limit") {
      const next = argv[++i];
      const parsed = next ? Number.parseInt(next, 10) : NaN;
      if (!next || Number.isNaN(parsed) || parsed <= 0) {
        fail("--limit must be a positive integer");
      }
      limit = parsed;
    } else if (arg.startsWith("--limit=")) {
      const value = arg.slice("--limit=".length);
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        fail("--limit must be a positive integer");
      }
      limit = parsed;
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, json, status, limit };
}

function fail(message: string): never {
  process.stderr.write(`ds: ${message}\n`);
  process.exit(1);
}

// ── output helpers ───────────────────────────────────────────────────────

function padCols(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i])))
      .join("  "),
  );
}

// ── commands ─────────────────────────────────────────────────────────────

function cmdList(args: ParsedArgs): number {
  const components = args.status ? componentsByStatus(args.status) : allComponents();

  if (args.json) {
    printJson({
      components: components.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        summary: m.summary,
      })),
    });
    return 0;
  }

  if (components.length === 0) {
    console.log(args.status ? `No components with status "${args.status}".` : "No components registered.");
    return 0;
  }

  const rows = components.map((m) => [m.id, m.name, m.status, m.summary]);
  for (const line of padCols(rows)) {
    console.log(line);
  }
  return 0;
}

function cmdFind(args: ParsedArgs): number {
  const query = args.positionals.join(" ").trim();
  if (!query) {
    fail("ds find requires a query, e.g. `ds find model picker`");
  }

  const limit = args.limit ?? 10;
  const hits = findComponents(query, limit);

  if (args.json) {
    printJson({
      query,
      hits: hits.map((hit) => ({
        id: hit.manifest.id,
        name: hit.manifest.name,
        status: hit.manifest.status,
        score: hit.score,
        matched: hit.matched,
        summary: hit.manifest.summary,
      })),
    });
    return 0;
  }

  if (hits.length === 0) {
    console.log(`No matches for "${query}".`);
    console.log("Try `ds list` to see everything registered.");
    return 0;
  }

  console.log(`${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":`);
  console.log("");
  const rows = hits.map((hit) => [
    hit.manifest.id,
    hit.manifest.name,
    hit.manifest.status,
    String(hit.score),
    hit.matched.join(","),
  ]);
  for (const line of padCols(rows)) {
    console.log(line);
  }
  console.log("");
  for (const hit of hits) {
    console.log(`${hit.manifest.id}: ${hit.manifest.summary}`);
  }
  return 0;
}

function cmdShow(args: ParsedArgs): number {
  const id = args.positionals[0];
  if (!id) {
    fail("ds show requires a component id, e.g. `ds show runtime-picker`");
  }

  const manifest = getComponent(id);
  if (!manifest) {
    if (args.json) {
      printJson({ error: `no component "${id}"` });
    } else {
      console.log(`No component "${id}". Try \`ds list\` or \`ds find ${id}\`.`);
    }
    return 1;
  }

  if (args.json) {
    printJson(manifest);
    return 0;
  }

  const lines: string[] = [];
  const h1 = (text: string) => {
    lines.push("");
    lines.push(text);
    lines.push("=".repeat(text.length));
  };
  const h2 = (text: string) => {
    lines.push("");
    lines.push(text);
    lines.push("-".repeat(text.length));
  };

  h1(`${manifest.name} (${manifest.id})`);
  lines.push(`status: ${manifest.status}`);
  lines.push("");
  lines.push(manifest.summary);

  h2("When to use");
  for (const item of manifest.whenToUse) lines.push(`- ${item}`);

  h2("When not to use");
  if (manifest.whenNotToUse.length === 0) {
    lines.push("(not documented)");
  } else {
    for (const item of manifest.whenNotToUse) lines.push(`- ${item}`);
  }

  h2("Import");
  lines.push(`import { ${manifest.import.symbols.join(", ")} } from "${manifest.import.from}";`);

  h2("Props");
  if (manifest.props.length === 0) {
    lines.push("(no props documented)");
  } else {
    const rows = manifest.props.map((p) => [
      p.name,
      p.type,
      p.required ? "required" : (p.default ?? "-"),
      p.summary,
    ]);
    for (const line of padCols([["name", "type", "default", "summary"], ...rows])) {
      lines.push(line);
    }
  }

  if (manifest.slots?.length) {
    h2("Slots");
    const rows = manifest.slots.map((s) => [s.name, s.type, s.summary]);
    for (const line of padCols([["name", "type", "summary"], ...rows])) {
      lines.push(line);
    }
  }

  if (manifest.states?.length) {
    h2("States");
    for (const state of manifest.states) {
      lines.push(`- ${state.name} (trigger: ${state.trigger})`);
      lines.push(`  ${state.behavior}`);
    }
  }

  if (manifest.keyboard?.length) {
    h2("Keyboard");
    const rows = manifest.keyboard.map((k) => [k.keys, k.action, k.scope ?? "-"]);
    for (const line of padCols([["keys", "action", "scope"], ...rows])) {
      lines.push(line);
    }
  }

  if (manifest.a11y?.length) {
    h2("Accessibility");
    for (const note of manifest.a11y) lines.push(`- ${note}`);
  }

  if (manifest.data) {
    h2("Data contract");
    lines.push(`module: ${manifest.data.module}`);
    lines.push(manifest.data.summary);
    if (manifest.data.production) {
      lines.push(`production: ${manifest.data.production}`);
    }
  }

  if (manifest.dependencies) {
    h2("Dependencies");
    if (manifest.dependencies.components?.length) {
      lines.push(`components: ${manifest.dependencies.components.join(", ")}`);
    }
    if (manifest.dependencies.tokens?.length) {
      lines.push(`tokens: ${manifest.dependencies.tokens.join(", ")}`);
    }
    if (manifest.dependencies.packages?.length) {
      lines.push(`packages: ${manifest.dependencies.packages.join(", ")}`);
    }
  }

  h2("Examples");
  for (const example of manifest.examples) {
    lines.push("");
    lines.push(`${example.title}`);
    if (example.summary) lines.push(example.summary);
    lines.push(example.code);
  }

  if (manifest.atom) {
    h2("Atom route");
    lines.push(manifest.atom);
  }

  h2("Source");
  for (const file of manifest.source) lines.push(`- ${file}`);

  if (manifest.port) {
    h2("Port");
    lines.push(`status: ${manifest.port.status}`);
    if (manifest.port.target) lines.push(`target: ${manifest.port.target}`);
    if (manifest.port.notes) lines.push(manifest.port.notes);
    if (manifest.port.drift?.length) {
      lines.push("drift:");
      for (const item of manifest.port.drift) lines.push(`  - ${item}`);
    }
  }

  console.log(lines.join("\n").trim());
  return 0;
}

function cmdAudit(args: ParsedArgs): number {
  const health = registryHealth();
  const components = allComponents();
  const issuesById: Record<string, AuditIssue[]> = {};
  for (const manifest of components) {
    issuesById[manifest.id] = auditManifest(manifest);
  }

  const dishonest = health.filter((h) => !h.honest);
  const hasErrors = Object.values(issuesById).some((issues) =>
    issues.some((issue) => issue.level === "error"),
  );
  const exitCode = dishonest.length > 0 || hasErrors ? 1 : 0;

  if (args.json) {
    printJson({ health, issues: issuesById });
    return exitCode;
  }

  console.log(`Registry health: ${health.length} component${health.length === 1 ? "" : "s"}`);
  console.log("");
  const rows = health.map((h) => [
    h.id,
    h.status,
    h.honest ? "honest" : "DISHONEST",
    `${h.errors} error${h.errors === 1 ? "" : "s"}`,
    `${h.warnings} warning${h.warnings === 1 ? "" : "s"}`,
  ]);
  for (const line of padCols([["id", "status", "honesty", "errors", "warnings"], ...rows])) {
    console.log(line);
  }

  for (const manifest of components) {
    const issues = issuesById[manifest.id];
    if (issues.length === 0) continue;
    console.log("");
    console.log(`${manifest.id}:`);
    for (const issue of issues) {
      console.log(`  [${issue.level}] ${issue.field}: ${issue.message}`);
    }
  }

  console.log("");
  console.log(exitCode === 0 ? "OK" : "FAIL");
  return exitCode;
}

/**
 * `ds verify` — does the manifest tell the truth?
 *
 * `audit` checks a manifest against itself and can only prove it is incomplete.
 * This reads the files it describes and proves it is WRONG: a source path that
 * no longer exists, an export that was renamed, a prop that was deleted, a
 * drift list written against a version of production that has since moved.
 */
function cmdVerify(args: ParsedArgs): number {
  const manifests = allComponents();
  const perComponent = manifests.map((manifest) => ({
    id: manifest.id,
    issues: verifyManifest(manifest),
  }));
  const registryIssues = verifyRegistry(manifests);
  const errors =
    registryIssues.filter((issue) => issue.level === "error").length +
    perComponent.reduce(
      (total, entry) => total + entry.issues.filter((issue) => issue.level === "error").length,
      0,
    );

  if (args.json) {
    printJson({
      ok: errors === 0,
      errors,
      registry: registryIssues,
      components: Object.fromEntries(perComponent.map((e) => [e.id, e.issues])),
    });
    return errors === 0 ? 0 : 1;
  }

  console.log(`Verifying ${manifests.length} manifest(s) against the filesystem\n`);
  for (const issue of registryIssues) {
    console.log(`  [${issue.level}] ${issue.field}: ${issue.message}`);
  }
  for (const entry of perComponent) {
    if (entry.issues.length === 0) {
      console.log(`${entry.id}: ok`);
      continue;
    }
    console.log(`${entry.id}:`);
    for (const issue of entry.issues) {
      console.log(`  [${issue.level}] ${issue.field}: ${issue.message}`);
    }
  }
  console.log(errors === 0 ? "\nOK" : `\nFAILED — ${errors} error(s)`);
  return errors === 0 ? 0 : 1;
}

/** `ds hashes <id>` — regenerate the `port.verifiedAgainst` block to paste in. */
function cmdHashes(args: ParsedArgs): number {
  const id = args.positionals[0];
  if (!id) fail("ds hashes: expected a component id");
  const manifest = getComponent(id);
  if (!manifest) fail(`ds hashes: no component "${id}"`);

  const hashes = portHashes(manifest);
  if (args.json) {
    printJson(hashes);
    return 0;
  }
  console.log(`verifiedAgainst: {`);
  for (const [path, hash] of Object.entries(hashes)) {
    console.log(`  "${path}": "${hash}",`);
  }
  console.log(`},`);
  return 0;
}

/**
 * `ds port` — what has to change for a studio component to run in the web
 * client. Not per-component: the gap is a property of the two trees, and a
 * component's own manifest already carries the part that IS specific to it
 * (`port.status` and `port.drift`, printed by `ds show`).
 */
function cmdPort(args: ParsedArgs): number {
  if (args.json) {
    printJson(PORT_CONTRACT);
    return 0;
  }

  console.log(`Porting ${PORT_CONTRACT.from} -> ${PORT_CONTRACT.to}\n`);
  console.log(`  shared token root   ${PORT_CONTRACT.sharedRoot}`);
  console.log(
    `  workspace-linked    ${PORT_CONTRACT.workspaceLinked ? "yes" : "no — the studio is outside the root workspaces globs"}`,
  );
  console.log(`  working precedent   ${PORT_CONTRACT.precedent}\n`);

  console.log("Steps");
  for (const [index, step] of PORT_CONTRACT.steps.entries()) {
    console.log(`\n  ${index + 1}. [${step.kind}] ${step.title}`);
    console.log(`     ${step.rationale}`);
    if (step.example) {
      console.log(`     from: ${step.example.from}`);
      console.log(`     to:   ${step.example.to}`);
    }
  }

  console.log("\nToken map");
  const rows = [["studio", "web", "shared root", "note"]];
  for (const token of PORT_CONTRACT.tokens) {
    rows.push([token.studio, token.web, token.root ?? "—", token.note ?? ""]);
  }
  for (const line of padCols(rows)) console.log(`  ${line}`);
  console.log("");
  return 0;
}

const USAGE = `ds — query the OpenScout design studio component registry

Usage:
  ds list [--status draft|candidate|graduated] [--json]
  ds find <query...> [--json] [--limit N]
  ds show <id> [--json]
  ds audit [--json]
  ds port [--json]
  ds verify [--json]
  ds hashes <id> [--json]
  ds help

Commands:
  list    List every registered component (id, name, status, summary).
  find    Ranked search by keyword. Multi-word queries do not need quotes,
          and a plain-English sentence works — stopwords are dropped and
          results are ranked by how much of the query matched.
  show    Full manifest for one component: props, states, keyboard, a11y,
          data contract, dependencies, examples, source, port status.
  audit   Run the registry health check and per-component manifest audit.
          Exits 1 if any component is dishonest about its status or has
          an error-level issue; exits 0 otherwise. Safe to use as a CI gate.
  port    The studio -> packages/web port contract: what is mechanical, what
          needs a decision, and the studio/web token map.
  verify  Check every manifest against the files it describes: source paths
          exist, claimed exports are exported, documented props are real,
          recorded port hashes still match. Exits 1 on any error. "audit"
          proves a manifest is incomplete; "verify" proves it is wrong.
  hashes  Print a fresh port.verifiedAgainst block for one component.

Examples:
  ds list --status graduated
  ds find model picker
  ds find "dropdown for choosing which model runs this"
  ds show runtime-picker --json
  ds audit
  ds port
  ds verify
  ds hashes runtime-picker
`;

function main(): number {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "-h" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 0;
  }

  const args = parseArgs(rest);

  switch (command) {
    case "list":
      return cmdList(args);
    case "find":
      return cmdFind(args);
    case "show":
      return cmdShow(args);
    case "audit":
      return cmdAudit(args);
    case "port":
      return cmdPort(args);
    case "verify":
      return cmdVerify(args);
    case "hashes":
      return cmdHashes(args);
    default:
      process.stderr.write(`ds: unknown command "${command}"\n\n`);
      process.stderr.write(USAGE);
      return 1;
  }
}

process.exit(main());
