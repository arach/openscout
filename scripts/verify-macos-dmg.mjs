#!/usr/bin/env node
import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function usage() {
  return `Usage:
  node scripts/verify-macos-dmg.mjs [dmg-path] [options]

Options:
  --skip-codesign         Verify DMG structure and bundle plists only.
`;
}

function parseArgs(argv) {
  const options = {
    dmgPath: "apps/macos/dist/OpenScout.dmg",
    skipCodesign: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--skip-codesign") {
      options.skipCodesign = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.dmgPath = arg;
  }

  options.dmgPath = path.resolve(repoRoot, options.dmgPath);
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error([
      `${[command, ...args].join(" ")} exited with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function plistValue(plistPath, key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]).trim();
}

function codesignIdentifier(bundlePath) {
  const output = run("codesign", ["-dv", "--verbose=4", bundlePath]);
  const match = output.match(/^Identifier=(.+)$/m);
  if (!match) {
    throw new Error(`Could not read codesign identifier for ${bundlePath}`);
  }
  return match[1].trim();
}

function verifyBundle(bundlePath, expectedIdentifier, { skipCodesign }) {
  const plistPath = path.join(bundlePath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) {
    throw new Error(`Missing Info.plist: ${plistPath}`);
  }

  const plistIdentifier = plistValue(plistPath, "CFBundleIdentifier");
  if (plistIdentifier !== expectedIdentifier) {
    throw new Error(`${path.basename(bundlePath)} plist identifier is ${plistIdentifier}; expected ${expectedIdentifier}`);
  }

  if (!skipCodesign) {
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundlePath]);
    const signatureIdentifier = codesignIdentifier(bundlePath);
    if (signatureIdentifier !== expectedIdentifier) {
      throw new Error(`${path.basename(bundlePath)} signature identifier is ${signatureIdentifier}; expected ${expectedIdentifier}`);
    }
  }

  console.log(`OK ${path.basename(bundlePath)} ${expectedIdentifier}`);
}

function verifyDmgFormat(dmgPath) {
  const imageInfo = run("hdiutil", ["imageinfo", dmgPath]);
  if (!/^Format:\s+UDZO$/m.test(imageInfo)) {
    throw new Error(`Expected UDZO DMG format for ${dmgPath}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.dmgPath)) {
    throw new Error(`DMG not found: ${options.dmgPath}`);
  }

  if (!options.skipCodesign) {
    run("codesign", ["--verify", "--verbose=2", options.dmgPath]);
  }
  verifyDmgFormat(options.dmgPath);

  const mountDir = mkdtempSync(path.join(os.tmpdir(), "openscout-dmg-"));
  let attached = false;
  try {
    run("hdiutil", ["attach", options.dmgPath, "-mountpoint", mountDir, "-readonly", "-nobrowse", "-quiet"]);
    attached = true;

    const appPath = path.join(mountDir, "OpenScout.app");
    const helperPath = path.join(appPath, "Contents", "Library", "LoginItems", "ScoutMenu.app");
    const applicationsPath = path.join(mountDir, "Applications");
    if (!existsSync(appPath)) {
      throw new Error("DMG is missing OpenScout.app");
    }
    if (!existsSync(helperPath)) {
      throw new Error("OpenScout.app is missing embedded ScoutMenu.app");
    }
    if (!existsSync(applicationsPath)) {
      throw new Error("DMG is missing Applications install target");
    }
    if (lstatSync(applicationsPath).isSymbolicLink()) {
      const target = readlinkSync(applicationsPath);
      if (target !== "/Applications") {
        throw new Error(`Applications symlink points to ${target}; expected /Applications`);
      }
    }

    verifyBundle(appPath, "app.openscout.scout", options);
    verifyBundle(helperPath, "app.openscout.scout.menu", options);
  } finally {
    if (attached) {
      run("hdiutil", ["detach", mountDir, "-quiet"]);
    }
    rmSync(mountDir, { recursive: true, force: true });
  }

  console.log(`macOS DMG verified: ${path.relative(repoRoot, options.dmgPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
