#!/usr/bin/env bun

import { execSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hudsonFeatureEnvironment } from "./hudson-features";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "..", "..");
const distDir = resolve(appDir, "dist");
const hudsonConfigPath = resolve(appDir, "hudson-package.json");
const bundleName = "Scout.app";
const bundlePath = resolve(distDir, bundleName);
const binaryDir = resolve(bundlePath, "Contents", "MacOS");
const binaryPath = resolve(binaryDir, "Scout");
const resourcesDir = resolve(bundlePath, "Contents", "Resources");
const frameworksDir = resolve(bundlePath, "Contents", "Frameworks");
const artifactsDir = resolve(appDir, ".build", "artifacts");
const infoPlistTemplate = resolve(appDir, "ScoutInfo.plist");
const iconSource = resolve(repoRoot, "apps", "desktop", "public", "scout-icon.png");
const packageJsonPath = resolve(repoRoot, "package.json");

type BuildMode = "dev" | "build";
type Command =
  | "dev"
  | "dev-build"
  | "build"
  | "build-restart"
  | "launch"
  | "start"
  | "restart"
  | "quit"
  | "stop"
  | "status"
  | "help";

function printHelp(): void {
  console.log(`scout-app — standalone Scout macOS app

Usage:
  bun apps/macos/bin/scout-app.ts dev            # local Hudson path + debug build + relaunch
  bun apps/macos/bin/scout-app.ts dev-build      # local Hudson path + debug build only
  bun apps/macos/bin/scout-app.ts build          # git Hudson + release build only
  bun apps/macos/bin/scout-app.ts build-restart  # git Hudson + release build + relaunch
  bun apps/macos/bin/scout-app.ts launch         # launch existing bundle
  bun apps/macos/bin/scout-app.ts restart        # alias: dev
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

function swiftConfiguration(mode: BuildMode): "debug" | "release" {
  return mode === "dev" ? "debug" : "release";
}

function modeLabel(mode: BuildMode): string {
  return mode === "dev" ? "dev" : "build";
}

function swiftBuildEnvironment(mode: BuildMode): NodeJS.ProcessEnv {
  const hudsonSource = mode === "dev" ? "path" : "git";
  return {
    ...process.env,
    ...hudsonFeatureEnvironment(hudsonConfigPath),
    OPENSCOUT_HUDSON_SOURCE: hudsonSource,
  };
}

function buildSwift(mode: BuildMode): string {
  const configuration = swiftConfiguration(mode);
  console.log(`Building Scout ${modeLabel(mode)} bundle...`);
  execSync(`swift build -c ${configuration} --product Scout`, {
    cwd: appDir,
    env: swiftBuildEnvironment(mode),
    stdio: "inherit",
  });
  return execSync(`swift build -c ${configuration} --show-bin-path`, {
    cwd: appDir,
    env: swiftBuildEnvironment(mode),
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

// The Scout binary links Sparkle as `@rpath/Sparkle.framework/...`, but SPM's
// XCFramework binary target neither embeds the framework in the product nor adds
// a reachable rpath — a bare bundle would dyld-crash at launch. Embed the macOS
// slice into Contents/Frameworks and point an @executable_path rpath at it. hkit
// will do the equivalent (plus inside-out re-signing) for notarized releases.
function sparkleFrameworkSource(): string | null {
  const xcframework = resolve(artifactsDir, "sparkle", "Sparkle", "Sparkle.xcframework");
  if (!existsSync(xcframework)) return null;
  const macosSlice = readdirSync(xcframework).find((name) => name.startsWith("macos"));
  if (!macosSlice) return null;
  const framework = resolve(xcframework, macosSlice, "Sparkle.framework");
  return existsSync(framework) ? framework : null;
}

function embedSparkleFramework(): void {
  const source = sparkleFrameworkSource();
  if (!source) {
    throw new Error(
      "Sparkle.framework artifact not found under .build/artifacts/sparkle. Resolve the Sparkle SPM dependency first.",
    );
  }
  mkdirSync(frameworksDir, { recursive: true });
  const dest = join(frameworksDir, "Sparkle.framework");
  rmSync(dest, { recursive: true, force: true });
  // ditto preserves the framework's Versions symlinks, resources, and nested
  // helper bundles (Autoupdate, Updater.app, Installer/Downloader XPC services).
  execSync(`ditto '${source}' '${dest}'`);
  execSync(`install_name_tool -add_rpath @executable_path/../Frameworks '${binaryPath}'`, {
    stdio: "ignore",
  });
}

function bundleApp(mode: BuildMode): void {
  const binPath = buildSwift(mode);
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

  // Bundled fonts (auto-registered at launch via ATSApplicationFontsPath=Fonts).
  // Space Grotesk is the Tail/Agents/Repos title face; it isn't a system font.
  const fontsSrc = resolve(appDir, "Resources", "Fonts");
  if (existsSync(fontsSrc)) {
    cpSync(fontsSrc, join(resourcesDir, "Fonts"), { recursive: true });
  }

  const version = appVersion();
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${version}" '${join(bundlePath, "Contents", "Info.plist")}'`);

  writeIcon();
  embedSparkleFramework();
  execSync(`codesign --force --deep --sign - '${bundlePath}'`, { stdio: "inherit" });
  console.log(`Built ${bundlePath} (${modeLabel(mode)})`);
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
  if (!existsSync(bundlePath)) bundleApp("dev");
  spawn("open", [bundlePath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function restart(mode: BuildMode): void {
  quit();
  bundleApp(mode);
  launch();
}

const command = (process.argv[2] ?? "help") as Command;

switch (command) {
  case "dev-build":
    bundleApp("dev");
    break;
  case "dev":
  case "restart":
    restart("dev");
    break;
  case "build":
    bundleApp("build");
    break;
  case "build-restart":
    restart("build");
    break;
  case "launch":
  case "start":
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
