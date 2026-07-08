#!/usr/bin/env node
/**
 * Sign a freshly built OpenScout DMG and prepend it to the Sparkle appcast.
 *
 * Usage:
 *   node scripts/update-appcast.mjs <version> <dmg-path> [--skip-if-placeholder]
 *
 * The enclosure URL reuses the immutable GitHub release-asset convention from
 * scripts/ship-release.mjs:
 *   https://github.com/<org>/<repo>/releases/download/v<version>/OpenScout-<version>.dmg
 *
 * HARD GUARD: refuses to sign anything while ScoutInfo.plist still carries the
 * SUPublicEDKey placeholder — a signed appcast against a fake key is worse than
 * no appcast. Run directly, the placeholder is a hard error (exit 1). The ship
 * lane passes --skip-if-placeholder so a not-yet-keyed checkout warns and skips
 * instead of aborting the whole release.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const PLIST_PATH = path.join(repoRoot, "apps/macos/ScoutInfo.plist");
const APPCAST_PATH = path.join(repoRoot, "apps/macos/appcast.xml");
const ARTIFACTS_DIR = path.join(repoRoot, "apps/macos/.build/artifacts");
const ED_KEY_PLACEHOLDER = "REPLACE-WITH-GENERATED-ED-KEY";
const RELEASE_DOWNLOAD_BASE = "https://github.com/arach/openscout/releases/download";
const MAX_ITEMS = 5;

function usage() {
  return `Usage:
  node scripts/update-appcast.mjs <version> <dmg-path> [--skip-if-placeholder]`;
}

function parseArgs(argv) {
  const options = { skipIfPlaceholder: false };
  const positionals = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--skip-if-placeholder") {
      options.skipIfPlaceholder = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }
  const [version, dmgPath] = positionals;
  if (!version || !dmgPath) {
    throw new Error(`Missing arguments.\n${usage()}`);
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Version must look like X.Y.Z, got: ${version}`);
  }
  return { version, dmgPath, ...options };
}

/** The maintainer pastes the real key into ScoutInfo.plist once (see runbook). */
function publicEdKey() {
  const plist = readFileSync(PLIST_PATH, "utf8");
  const match = plist.match(/<key>SUPublicEDKey<\/key>\s*<string>([^<]*)<\/string>/);
  return match ? match[1].trim() : null;
}

/** Recursively locate Sparkle's sign_update, skipping the legacy DSA copy. */
function findSignUpdate(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "old_dsa_scripts") continue;
      const found = findSignUpdate(full);
      if (found) return found;
    } else if (entry.name === "sign_update") {
      return full;
    }
  }
  return null;
}

function signDmg(signUpdate, dmgAbsPath) {
  const output = execFileSync(signUpdate, [dmgAbsPath], { encoding: "utf8" });
  const edSignature = output.match(/sparkle:edSignature="([^"]+)"/)?.[1];
  const length = output.match(/length="([^"]+)"/)?.[1];
  if (!edSignature || !length) {
    throw new Error(`Could not parse sign_update output:\n${output}`);
  }
  return { edSignature, length };
}

function buildItem({ version, edSignature, length }) {
  const url = `${RELEASE_DOWNLOAD_BASE}/v${version}/OpenScout-${version}.dmg`;
  const pubDate = new Date().toUTCString();
  return [
    "    <item>",
    `      <title>OpenScout ${version}</title>`,
    `      <pubDate>${pubDate}</pubDate>`,
    `      <sparkle:version>${version}</sparkle:version>`,
    `      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>`,
    `      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>`,
    `      <enclosure url="${url}" sparkle:version="${version}" sparkle:shortVersionString="${version}" sparkle:edSignature="${edSignature}" length="${length}" type="application/octet-stream" />`,
    "    </item>",
  ].join("\n");
}

function writeAppcast(newItem) {
  const appcast = readFileSync(APPCAST_PATH, "utf8");
  const existing = [...appcast.matchAll(/[ \t]*<item>[\s\S]*?<\/item>/g)].map((m) => m[0].replace(/^\s*\n/, ""));
  const shell = appcast.replace(/\s*<item>[\s\S]*?<\/item>/g, "");
  const kept = [newItem, ...existing].slice(0, MAX_ITEMS).join("\n");
  const result = shell.replace(/(\n)?[ \t]*<\/channel>/, `\n${kept}\n  </channel>`);
  writeFileSync(APPCAST_PATH, result);
}

function main() {
  const { version, dmgPath, skipIfPlaceholder } = parseArgs(process.argv.slice(2));

  const edKey = publicEdKey();
  if (!edKey || edKey === ED_KEY_PLACEHOLDER) {
    const message =
      "SUPublicEDKey in apps/macos/ScoutInfo.plist is still the placeholder " +
      `(${ED_KEY_PLACEHOLDER}). Run Sparkle's generate_keys once and paste the ` +
      "public key before signing an appcast.";
    if (skipIfPlaceholder) {
      console.warn(`Skipping appcast update: ${message}`);
      return;
    }
    throw new Error(message);
  }

  const dmgAbsPath = path.resolve(repoRoot, dmgPath);
  if (!existsSync(dmgAbsPath)) {
    throw new Error(`DMG not found: ${dmgPath}`);
  }

  const signUpdate = findSignUpdate(ARTIFACTS_DIR);
  if (!signUpdate) {
    throw new Error(
      `Could not find Sparkle's sign_update under ${path.relative(repoRoot, ARTIFACTS_DIR)}. ` +
        "Resolve the Sparkle SPM dependency first (build the macOS app).",
    );
  }

  const { edSignature, length } = signDmg(signUpdate, dmgAbsPath);
  writeAppcast(buildItem({ version, edSignature, length }));
  console.log(`Prepended OpenScout ${version} to apps/macos/appcast.xml (length ${length}).`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
