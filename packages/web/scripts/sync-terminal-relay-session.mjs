#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const outputPath = resolve(packageDirectory, "server/terminal-relay-session.ts");
const checkOnly = process.argv.includes("--check");

function safeGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

function resolveHudsonRelaySource() {
  const configuredSession = process.env.HUDSON_RELAY_SESSION_PATH?.trim();
  const configuredTypes = process.env.HUDSON_RELAY_TYPES_PATH?.trim();
  if (configuredSession && configuredTypes) {
    return {
      sessionPath: resolve(configuredSession),
      typesPath: resolve(configuredTypes),
    };
  }

  const directHudsonRoot = resolve(packageDirectory, "../../..", "hudson");
  const directSource = resolveHudsonRelaySourceFromRoot(directHudsonRoot);
  if (directSource) return directSource;

  const commonGitDir = safeGit(["rev-parse", "--git-common-dir"], packageDirectory);
  if (!commonGitDir) {
    return null;
  }

  const commonRoot = resolve(packageDirectory, commonGitDir, "..");
  return resolveHudsonRelaySourceFromRoot(resolve(commonRoot, "..", "hudson"));
}

function resolveHudsonRelaySourceFromRoot(hudsonRoot) {
  for (const relayRoot of [
    "packages/services/hudson-relay/src/relay",
    "packages/hudson-relay/src/relay",
  ]) {
    const sourceRoot = resolve(hudsonRoot, relayRoot);
    const sessionPath = resolve(sourceRoot, "session.ts");
    const typesPath = resolve(sourceRoot, "types.ts");
    if (existsSync(sessionPath) && existsSync(typesPath)) {
      return { sessionPath, typesPath };
    }
  }
  return null;
}

function stripTypeImport(source) {
  return source
    .replace(/^import type \{ SessionInitMessage, RelaySocket \} from ['"]\.\/types['"];\n\n/m, "")
    .trim();
}

function buildGeneratedContent(hudsonSource) {
  const typesSource = applyOpenScoutRelayTypeCompatibility(
    readFileSync(hudsonSource.typesPath, "utf8").trim(),
  );
  const sessionSource = applyOpenScoutRelaySessionCompatibility(stripTypeImport(
    readFileSync(hudsonSource.sessionPath, "utf8"),
  ));

  const banner = [
    "// Generated from Hudson relay session/types.",
    "// Refresh with: node ./scripts/sync-terminal-relay-session.mjs",
    "",
  ].join("\n");

  return `${banner}${typesSource}\n\n${sessionSource}\n`;
}

function applyOpenScoutRelayTypeCompatibility(source) {
  if (source.includes("agent?: 'claude' | 'pi' | 'shell'")) {
    return source;
  }

  return source
    .replace(
      "/** CLI agent to spawn. 'claude' (default) or 'pi'. */",
      "/** CLI agent to spawn. 'claude' (default), 'pi', or 'shell'. */",
    )
    .replace("agent?: 'claude' | 'pi';", "agent?: 'claude' | 'pi' | 'shell';");
}

function applyOpenScoutRelaySessionCompatibility(source) {
  if (source.includes("function findShellBin()")) {
    return source;
  }

  const helpers = `function expandHomePath(value: string): string {
  const home = process.env.HOME || '/tmp';
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return value;
}

function isExecutablePath(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableInDirectories(name: string, directories: string[]): string | null {
  const seen = new Set<string>();
  for (const directory of directories) {
    if (!directory) continue;
    const normalizedDirectory = pathResolve(expandHomePath(directory));
    if (seen.has(normalizedDirectory)) continue;
    seen.add(normalizedDirectory);
    const candidate = join(normalizedDirectory, name);
    if (isExecutablePath(candidate)) return candidate;
  }
  return null;
}

function findExecutableOnPath(name: string): string | null {
  return findExecutableInDirectories(name, (process.env.PATH || '').split(pathDelimiter));
}`;

  const findClaudeBin = `/** Locate the claude binary, returning null if not found. */
function findClaudeBin(): string | null {
  for (const envKey of ['OPENSCOUT_CLAUDE_BIN', 'SCOUT_CLAUDE_BIN', 'CLAUDE_BIN']) {
    const explicit = process.env[envKey]?.trim();
    if (!explicit) continue;
    const expanded = expandHomePath(explicit);
    if (isExecutablePath(expanded)) return pathResolve(expanded);
    const foundOnPath = findExecutableOnPath(explicit);
    if (foundOnPath) return foundOnPath;
  }

  const home = process.env.HOME || '/tmp';
  return findExecutableInDirectories('claude', [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.bun', 'bin'),
  ]) ?? findExecutableOnPath('claude');
}`;

  const findShellBin = `/** Locate the user's shell, returning null if not found. */
function findShellBin(): string | null {
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}`;

  return source
    .replace(
      "import { existsSync, mkdirSync, writeFileSync } from 'fs';",
      "import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from 'fs';",
    )
    .replace(
      "import { join, dirname as pathDirname } from 'path';",
      "import { delimiter as pathDelimiter, join, dirname as pathDirname, resolve as pathResolve } from 'path';",
    )
    .replace(
      `/** Locate the claude binary, returning null if not found. */
function findClaudeBin(): string | null {
  return findBin('claude', 'CLAUDE_BIN');
}`,
      `${helpers}\n${findClaudeBin}`,
    )
    .replace(
      `/** Locate the pi binary, returning null if not found. */
function findPiBin(): string | null {
  return findBin('pi', 'PI_BIN');
}`,
      `/** Locate the pi binary, returning null if not found. */
function findPiBin(): string | null {
  return findBin('pi', 'PI_BIN');
}

${findShellBin}`,
    )
    .replace(
      "if (agent === 'pi') {\n    agentBin = findPiBin();",
      "if (agent === 'shell') {\n    agentBin = findShellBin();\n    if (!agentBin) {\n      const reason = 'Shell not found. Set SHELL or install zsh/bash/sh.';\n      console.error(`[relay] Session ${id} failed: ${reason}`);\n      send(ws, { type: 'session:error', error: reason });\n      return null;\n    }\n  } else if (agent === 'pi') {\n    agentBin = findPiBin();",
    )
    .replace(
      "const reason = 'Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code';",
      "const reason = 'Claude CLI not found. Install it with: curl -fsSL https://claude.ai/install.sh | bash';",
    )
    .replace(
      "if (agent === 'pi') {\n    agentArgs = ['--verbose'];",
      "if (agent === 'shell') {\n    agentArgs = [];\n  } else if (agent === 'pi') {\n    agentArgs = ['--verbose'];",
    );
}

const hudsonSource = resolveHudsonRelaySource();
if (!hudsonSource) {
  console.log("@openscout/web: Hudson relay source not found; skipping relay sync.");
  process.exit(0);
}

const nextContent = buildGeneratedContent(hudsonSource);
const currentContent = existsSync(outputPath)
  ? readFileSync(outputPath, "utf8")
  : null;

if (currentContent === nextContent) {
  console.log(`Terminal relay session already matches ${hudsonSource.sessionPath}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    "@openscout/web: terminal relay session snapshot is out of sync with Hudson.\n"
    + "Run: bun --cwd packages/web relay:sync",
  );
  process.exit(1);
}

writeFileSync(outputPath, nextContent, "utf8");
console.log(`Synced terminal relay session from ${hudsonSource.sessionPath}`);
