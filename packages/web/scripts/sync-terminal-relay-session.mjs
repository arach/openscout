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

  const directRoot = resolve(packageDirectory, "../../..", "hudson/packages/hudson-relay/src/relay");
  const directSessionPath = resolve(directRoot, "session.ts");
  const directTypesPath = resolve(directRoot, "types.ts");
  if (existsSync(directSessionPath) && existsSync(directTypesPath)) {
    return {
      sessionPath: directSessionPath,
      typesPath: directTypesPath,
    };
  }

  const commonGitDir = safeGit(["rev-parse", "--git-common-dir"], packageDirectory);
  if (!commonGitDir) {
    return null;
  }

  const commonRoot = resolve(packageDirectory, commonGitDir, "..");
  const worktreeSessionPath = resolve(
    commonRoot,
    "..",
    "hudson/packages/hudson-relay/src/relay/session.ts",
  );
  const worktreeTypesPath = resolve(
    commonRoot,
    "..",
    "hudson/packages/hudson-relay/src/relay/types.ts",
  );
  if (!existsSync(worktreeSessionPath) || !existsSync(worktreeTypesPath)) {
    return null;
  }

  return {
    sessionPath: worktreeSessionPath,
    typesPath: worktreeTypesPath,
  };
}

function stripTypeImport(source) {
  return source
    .replace(/^import type \{ SessionInitMessage, RelaySocket \} from ['"]\.\/types['"];\n\n/m, "")
    .trim();
}

function buildGeneratedContent(hudsonSource) {
  const typesSource = readFileSync(hudsonSource.typesPath, "utf8").trim();
  const sessionSource = stripTypeImport(
    readFileSync(hudsonSource.sessionPath, "utf8"),
  );

  const banner = [
    "// Generated from Hudson relay session/types.",
    "// Refresh with: node ./scripts/sync-terminal-relay-session.mjs",
    "",
  ].join("\n");

  return `${banner}${typesSource}\n\n${sessionSource}\n`;
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
