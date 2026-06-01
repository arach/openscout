#!/usr/bin/env bun

import { execSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "..", "..");
const distDir = resolve(appDir, "dist");
const bundleName = "Scout.app";
const bundlePath = resolve(distDir, bundleName);
const binaryDir = resolve(bundlePath, "Contents", "MacOS");
const binaryPath = resolve(binaryDir, "Scout");
const resourcesDir = resolve(bundlePath, "Contents", "Resources");
const infoPlistTemplate = resolve(appDir, "ScoutInfo.plist");
const iconSource = resolve(repoRoot, "apps", "desktop", "public", "scout-icon.png");
const packageJsonPath = resolve(repoRoot, "package.json");

type Command = "build" | "launch" | "start" | "restart" | "quit" | "stop" | "status" | "help";

function printHelp(): void {
  console.log(`scout-app — standalone Scout macOS app

Usage:
  bun apps/macos/bin/scout-app.ts build
  bun apps/macos/bin/scout-app.ts launch
  bun apps/macos/bin/scout-app.ts restart
  bun apps/macos/bin/scout-app.ts quit
  bun apps/macos/bin/scout-app.ts status
`);
}

function appVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    if (parsed.version?.trim()) return parsed.version.trim();
  } catch {
    // ignore
  }
  return "0.1.0";
}

function buildSwift(): string {
  execSync("swift build -c release --product Scout", {
    cwd: appDir,
    stdio: "inherit",
  });
  return execSync("swift build -c release --show-bin-path", {
    cwd: appDir,
    stdio: "pipe",
  }).toString("utf8").trim();
}

function writeIcon(): void {
  if (!existsSync(iconSource)) return;
  const iconset = resolve(distDir, "Scout.iconset");
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    const out = join(iconset, `icon_${size}x${size}.png`);
    execSync(`sips -z ${size} ${size} '${iconSource}' --out '${out}' >/dev/null`);
    if (size <= 512) {
      const retina = join(iconset, `icon_${size}x${size}@2x.png`);
      execSync(`sips -z ${size * 2} ${size * 2} '${iconSource}' --out '${retina}' >/dev/null`);
    }
  }

  execSync(`iconutil -c icns '${iconset}' -o '${join(resourcesDir, "AppIcon.icns")}'`);
  rmSync(iconset, { recursive: true, force: true });
  execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" '${join(bundlePath, "Contents", "Info.plist")}'`, {
    stdio: "ignore",
  });
}

function bundleApp(): void {
  const binPath = buildSwift();
  const builtBinary = join(binPath, "Scout");
  if (!existsSync(builtBinary)) {
    throw new Error(`Built Scout binary not found: ${builtBinary}`);
  }

  rmSync(bundlePath, { recursive: true, force: true });
  mkdirSync(binaryDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  cpSync(builtBinary, binaryPath);
  chmodSync(binaryPath, 0o755);
  cpSync(infoPlistTemplate, join(bundlePath, "Contents", "Info.plist"));

  const version = appVersion();
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);

  writeIcon();
  execSync(`codesign --force --deep --sign - '${bundlePath}'`, { stdio: "inherit" });
  console.log(`Built ${bundlePath}`);
}

function isRunning(): boolean {
  try {
    execSync("pgrep -x Scout", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function quit(): void {
  if (!isRunning()) return;
  execSync("pkill -x Scout", { stdio: "ignore" });
}

function launch(): void {
  if (!existsSync(bundlePath)) bundleApp();
  spawn("open", [bundlePath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

const command = (process.argv[2] ?? "help") as Command;

switch (command) {
  case "build":
    bundleApp();
    break;
  case "launch":
  case "start":
    launch();
    break;
  case "restart":
    quit();
    bundleApp();
    launch();
    break;
  case "quit":
  case "stop":
    quit();
    break;
  case "status":
    console.log(isRunning() ? "Scout is running." : "Scout is not running.");
    break;
  case "help":
    printHelp();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}
