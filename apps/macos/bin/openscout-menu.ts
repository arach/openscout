#!/usr/bin/env bun

import { execSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "..", "..");
const distDir = resolve(appDir, "dist");
const bundleName = "OpenScoutMenu.app";
const bundlePath = resolve(distDir, bundleName);
const binaryDir = resolve(bundlePath, "Contents", "MacOS");
const binaryPath = resolve(binaryDir, "OpenScoutMenu");
const resourcesDir = resolve(bundlePath, "Contents", "Resources");
const infoPlistTemplate = resolve(appDir, "Info.plist");
const entitlementsPath = resolve(appDir, "OpenScoutMenu.entitlements");
const iconSource = resolve(repoRoot, "apps", "desktop", "public", "scout-icon.png");
const packageJsonPath = resolve(repoRoot, "package.json");
const bundleIdentifier = "com.openscout.menu";

type Command =
  | "build"
  | "launch"
  | "start"
  | "restart"
  | "quit"
  | "stop"
  | "status"
  | "dmg"
  | "help";

type CliOptions = {
  version?: string;
  signIdentity?: string;
  requireSigningIdentity: boolean;
};

function parseOptions(argv: string[]): { command: Command; options: CliOptions } {
  const [first, ...rest] = argv;
  const command = (first ?? "help") as Command;
  const options: CliOptions = {
    requireSigningIdentity: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index] ?? "";
    if (current === "--version") {
      options.version = rest[index + 1];
      index += 1;
      continue;
    }
    if (current.startsWith("--version=")) {
      options.version = current.slice("--version=".length);
      continue;
    }
    if (current === "--sign-identity") {
      options.signIdentity = rest[index + 1];
      index += 1;
      continue;
    }
    if (current.startsWith("--sign-identity=")) {
      options.signIdentity = current.slice("--sign-identity=".length);
      continue;
    }
    if (current === "--require-sign-identity") {
      options.requireSigningIdentity = true;
      continue;
    }
    throw new Error(`Unknown option: ${current}`);
  }

  return { command, options };
}

function printHelp(): void {
  console.log(`openscout-menu — OpenScout macOS helper

Usage:
  bun apps/macos/bin/openscout-menu.ts build [--version 0.2.16]
  bun apps/macos/bin/openscout-menu.ts launch
  bun apps/macos/bin/openscout-menu.ts restart
  bun apps/macos/bin/openscout-menu.ts quit
  bun apps/macos/bin/openscout-menu.ts status
  bun apps/macos/bin/openscout-menu.ts dmg [--version 0.2.16]

Options:
  --version <v>              Override bundle version (defaults to repo package.json version)
  --sign-identity <name>     Force a specific signing identity
  --require-sign-identity    Fail instead of falling back to ad-hoc signing
`);
}

function appVersion(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(execSync(`cat '${packageJsonPath}'`, { stdio: "pipe" }).toString("utf8")) as {
      version?: string;
    };
    if (parsed.version?.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // ignore
  }

  return "0.1.0";
}

function isRunning(): boolean {
  try {
    execSync("pgrep -x OpenScoutMenu", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function quit(): boolean {
  try {
    execSync("pkill -x OpenScoutMenu", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function launch(): void {
  if (!existsSync(bundlePath)) {
    throw new Error(`Bundle not found at ${bundlePath}. Run the build command first.`);
  }

  if (isRunning()) {
    console.log("OpenScout Menu is already running.");
    return;
  }

  spawn("open", [bundlePath], { detached: true, stdio: "ignore" }).unref();
  console.log(`Launched ${bundleName}.`);
}

function resolveSigningIdentity(explicit?: string): string | null {
  const fromEnv = explicit?.trim()
    || process.env.OPENSCOUT_SIGN_IDENTITY?.trim()
    || process.env.OPENSCOUT_DEVELOPER_ID_APP?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const identities = execSync("security find-identity -v -p codesigning", { stdio: "pipe" }).toString("utf8");
    return identities.match(/"(Developer ID Application:[^"]+)"/)?.[1]
      ?? identities.match(/"(Apple Development:[^"]+)"/)?.[1]
      ?? null;
  } catch {
    return null;
  }
}

function signBundle(options: CliOptions): void {
  const identity = resolveSigningIdentity(options.signIdentity);
  const entitlementsArgs = existsSync(entitlementsPath)
    ? ` --entitlements '${entitlementsPath}'`
    : "";

  if (!identity && options.requireSigningIdentity) {
    throw new Error("No signing identity found.");
  }

  if (identity) {
    console.log(`Signing with: ${identity}`);
    try {
      execSync(
        `codesign --force --options runtime --timestamp --sign '${identity}'${entitlementsArgs} --identifier ${bundleIdentifier} '${bundlePath}'`,
        { stdio: "inherit" },
      );
    } catch {
      if (options.requireSigningIdentity) {
        throw new Error(`Signing with '${identity}' failed.`);
      }
      console.log(`Signing with '${identity}' failed. Falling back to ad-hoc.`);
      execSync(
        `codesign --force --sign -${entitlementsArgs} --identifier ${bundleIdentifier} '${bundlePath}'`,
        { stdio: "inherit" },
      );
    }
  } else {
    console.log("No local signing identity found. Using ad-hoc signature.");
    execSync(
      `codesign --force --sign -${entitlementsArgs} --identifier ${bundleIdentifier} '${bundlePath}'`,
      { stdio: "inherit" },
    );
  }

  execSync(`codesign --verify --deep --strict '${bundlePath}'`, { stdio: "inherit" });
}

function buildIconIfPossible(): void {
  if (!existsSync(iconSource)) {
    return;
  }

  try {
    execSync("which sips", { stdio: "pipe" });
    execSync("which iconutil", { stdio: "pipe" });
  } catch {
    return;
  }

  const iconsetDir = join(tmpdir(), `openscout-menu-icon-${Date.now()}.iconset`);
  mkdirSync(iconsetDir, { recursive: true });
  const sizes = [16, 32, 128, 256, 512];

  try {
    for (const size of sizes) {
      const oneX = join(iconsetDir, `icon_${size}x${size}.png`);
      const twoX = join(iconsetDir, `icon_${size}x${size}@2x.png`);
      execSync(`sips -z ${size} ${size} '${iconSource}' --out '${oneX}'`, { stdio: "pipe" });
      execSync(`sips -z ${size * 2} ${size * 2} '${iconSource}' --out '${twoX}'`, { stdio: "pipe" });
    }

    const iconFile = join(resourcesDir, "AppIcon.icns");
    execSync(`iconutil -c icns '${iconsetDir}' -o '${iconFile}'`, { stdio: "pipe" });
    execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" '${join(bundlePath, "Contents", "Info.plist")}'`, {
      stdio: "pipe",
    });
  } catch {
    // Skip custom icon if conversion fails.
  } finally {
    rmSync(iconsetDir, { recursive: true, force: true });
  }
}

function releaseBinaryPath(): string {
  execSync("swift build -c release", {
    cwd: appDir,
    stdio: "inherit",
  });

  const binPath = execSync("swift build -c release --show-bin-path", {
    cwd: appDir,
    stdio: ["ignore", "pipe", "inherit"],
  }).toString("utf8").trim();

  return join(binPath, "OpenScoutMenu");
}

function writeBundle(version: string): void {
  const releaseBinary = releaseBinaryPath();
  if (!existsSync(releaseBinary)) {
    throw new Error(`Built binary not found at ${releaseBinary}`);
  }

  rmSync(bundlePath, { recursive: true, force: true });
  mkdirSync(binaryDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  cpSync(releaseBinary, binaryPath);
  chmodSync(binaryPath, 0o755);
  cpSync(infoPlistTemplate, join(bundlePath, "Contents", "Info.plist"));

  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);

  buildIconIfPossible();
}

function build(options: CliOptions): void {
  const version = appVersion(options.version);
  mkdirSync(distDir, { recursive: true });
  writeBundle(version);
  signBundle(options);
  execSync(`touch '${bundlePath}'`, { stdio: "pipe" });
  console.log(`Built ${bundlePath}`);
}

function status(): void {
  console.log(`Bundle: ${existsSync(bundlePath) ? bundlePath : "missing"}`);
  if (isRunning()) {
    console.log("State: running");
  } else {
    console.log("State: stopped");
  }
}

function buildDMG(options: CliOptions): void {
  const script = resolve(appDir, "scripts", "build-dmg.sh");
  if (!existsSync(script)) {
    throw new Error(`DMG script not found at ${script}`);
  }

  const version = appVersion(options.version);
  const env = {
    ...process.env,
    VERSION: version,
  };

  if (options.signIdentity?.trim()) {
    env.OPENSCOUT_SIGN_IDENTITY = options.signIdentity.trim();
  }

  execSync(`'${script}'`, {
    cwd: appDir,
    stdio: "inherit",
    env,
  });
}

async function main(): Promise<void> {
  const { command, options } = parseOptions(process.argv.slice(2));

  switch (command) {
    case "build":
      build(options);
      break;
    case "launch":
    case "start":
      if (!existsSync(bundlePath)) {
        build(options);
      }
      launch();
      break;
    case "restart":
      quit();
      build(options);
      launch();
      break;
    case "quit":
    case "stop":
      if (quit()) {
        console.log("OpenScout Menu stopped.");
      } else {
        console.log("OpenScout Menu is not running.");
      }
      break;
    case "status":
      status();
      break;
    case "dmg":
      buildDMG(options);
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

await main();
