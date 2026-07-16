#!/usr/bin/env bun

import { execFileSync, execSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hudsonFeatureEnvironment } from "./hudson-features";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "..", "..");
const distDir = resolve(appDir, "dist");
const bundleName = "ScoutMenu.app";
const bundlePath = resolve(distDir, bundleName);
const legacyBundlePaths = [
  resolve(distDir, "OpenScoutMenu.app"),
  resolve(distDir, "OpenScout Menu.app"),
];
const binaryDir = resolve(bundlePath, "Contents", "MacOS");
const binaryPath = resolve(binaryDir, "ScoutMenu");
const resourcesDir = resolve(bundlePath, "Contents", "Resources");
const infoPlistTemplate = resolve(appDir, "Info.plist");
const entitlementsPath = resolve(appDir, "ScoutMenu.entitlements");
const iconSource = resolve(repoRoot, "apps", "desktop", "public", "scout-menu-icon.png");
const packageJsonPath = resolve(repoRoot, "package.json");
const bundleIdentifier = "app.openscout.scout.menu";
const hudsonConfigPath = resolve(appDir, "hudson-package.json");

type Command =
  | "build"
  | "launch"
  | "start"
  | "restart"
  | "quit"
  | "stop"
  | "status"
  | "dmg"
  | "hud"
  | "tail"
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

HUD control (via scout:// URL scheme):
  bun apps/macos/bin/openscout-menu.ts hud state
  bun apps/macos/bin/openscout-menu.ts hud show|hide|toggle
  bun apps/macos/bin/openscout-menu.ts hud tail [compact|medium|large]
  bun apps/macos/bin/openscout-menu.ts hud tab <agents|activity|tail|sessions|assistant>
  bun apps/macos/bin/openscout-menu.ts hud size <compact|medium|large>
  bun apps/macos/bin/openscout-menu.ts hud task [top-left|top-right|bottom-left|bottom-right]
  bun apps/macos/bin/openscout-menu.ts hud capture [<out.png>]
  bun apps/macos/bin/openscout-menu.ts hud matrix [<dir>]

Tail mode control (separate persistent surface):
  bun apps/macos/bin/openscout-menu.ts tail state
  bun apps/macos/bin/openscout-menu.ts tail show|hide|toggle
  bun apps/macos/bin/openscout-menu.ts tail attach|float
  bun apps/macos/bin/openscout-menu.ts tail size <compact|medium|large>
  bun apps/macos/bin/openscout-menu.ts tail collapse|expand
  bun apps/macos/bin/openscout-menu.ts tail capture [<out.png>]

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
    execSync("pgrep -x ScoutMenu", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function quit(): boolean {
  try {
    execSync("pkill -x ScoutMenu", { stdio: "pipe" });
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
    console.log("Scout Menu is already running.");
    return;
  }

  spawn("open", [bundlePath], { detached: true, stdio: "ignore" }).unref();
  console.log(`Launched ${bundleName}.`);
}

type SigningIdentity = {
  signValue: string;
  label: string;
};

type CodeSigningIdentity = {
  hash: string;
  name: string;
  notBefore?: number;
  notAfter?: number;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseCodeSigningIdentities(output: string): CodeSigningIdentity[] {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      hash: match[1].toUpperCase(),
      name: match[2],
    }));
}

function certificateDates(pem: string): { notBefore?: number; notAfter?: number } {
  try {
    const output = execFileSync("openssl", ["x509", "-noout", "-startdate", "-enddate"], {
      input: pem,
      stdio: ["pipe", "pipe", "ignore"],
    }).toString("utf8");
    const notBeforeRaw = output.match(/^notBefore=(.+)$/m)?.[1];
    const notAfterRaw = output.match(/^notAfter=(.+)$/m)?.[1];
    return {
      notBefore: notBeforeRaw ? Date.parse(notBeforeRaw) : undefined,
      notAfter: notAfterRaw ? Date.parse(notAfterRaw) : undefined,
    };
  } catch {
    return {};
  }
}

function certificatesForName(name: string): Map<string, { notBefore?: number; notAfter?: number }> {
  const certificates = new Map<string, { notBefore?: number; notAfter?: number }>();
  try {
    const output = execFileSync("security", ["find-certificate", "-a", "-Z", "-p", "-c", name], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
    const certPattern =
      /SHA-1 hash:\s*([A-Fa-f0-9]{40})\s+(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g;
    for (const match of output.matchAll(certPattern)) {
      certificates.set(match[1].toUpperCase(), certificateDates(match[2]));
    }
  } catch {
    // Keep the identity selectable even when certificate metadata is unavailable.
  }
  return certificates;
}

function enrichSigningIdentities(identities: CodeSigningIdentity[]): CodeSigningIdentity[] {
  const certsByHash = new Map<string, { notBefore?: number; notAfter?: number }>();
  for (const name of new Set(identities.map((identity) => identity.name))) {
    for (const [hash, dates] of certificatesForName(name)) {
      certsByHash.set(hash, dates);
    }
  }
  return identities.map((identity) => ({
    ...identity,
    ...certsByHash.get(identity.hash),
  }));
}

function newestIdentity(identities: CodeSigningIdentity[]): CodeSigningIdentity | null {
  const enriched = enrichSigningIdentities(identities);
  return enriched
    .slice()
    .sort((left, right) =>
      (right.notBefore ?? 0) - (left.notBefore ?? 0)
      || (right.notAfter ?? 0) - (left.notAfter ?? 0)
    )[0] ?? null;
}

function describeIdentity(identity: CodeSigningIdentity): string {
  const shortHash = identity.hash.slice(0, 10);
  const validFrom = identity.notBefore ? `, valid from ${new Date(identity.notBefore).toISOString().slice(0, 10)}` : "";
  return `${identity.name} [${shortHash}...]${validFrom}`;
}

function resolveSigningIdentity(explicit?: string): SigningIdentity | null {
  const fromEnv = explicit?.trim()
    || process.env.OPENSCOUT_SIGN_IDENTITY?.trim()
    || process.env.OPENSCOUT_DEVELOPER_ID_APP?.trim();
  if (fromEnv) {
    return { signValue: fromEnv, label: fromEnv };
  }

  try {
    const identities = execSync("security find-identity -v -p codesigning", { stdio: "pipe" }).toString("utf8");
    const parsed = parseCodeSigningIdentities(identities);
    const developerId = newestIdentity(
      parsed.filter((identity) => identity.name.startsWith("Developer ID Application:")),
    );
    const appleDevelopment = newestIdentity(
      parsed.filter((identity) => identity.name.startsWith("Apple Development:")),
    );
    const selected = developerId ?? appleDevelopment;
    return selected
      ? { signValue: selected.hash, label: describeIdentity(selected) }
      : null;
  } catch {
    return null;
  }
}

function signBundle(options: CliOptions): void {
  const identity = resolveSigningIdentity(options.signIdentity);
  const entitlementsArgs = existsSync(entitlementsPath)
    ? ` --entitlements ${shellQuote(entitlementsPath)}`
    : "";

  if (!identity && options.requireSigningIdentity) {
    throw new Error("No signing identity found.");
  }

  if (identity) {
    console.log(`Signing with: ${identity.label}`);
    try {
      execSync(
        `codesign --force --deep --options runtime --timestamp --sign ${shellQuote(identity.signValue)}${entitlementsArgs} --identifier ${shellQuote(bundleIdentifier)} ${
          shellQuote(bundlePath)
        }`,
        { stdio: "inherit" },
      );
    } catch {
      throw new Error(
        `Signing with '${identity.label}' failed. Refusing to replace the stable app identity with an ad-hoc signature.`,
      );
    }
  } else {
    console.log("No local signing identity found. Using ad-hoc signature.");
    execSync(
      `codesign --force --sign -${entitlementsArgs} --identifier ${shellQuote(bundleIdentifier)} ${shellQuote(bundlePath)}`,
      { stdio: "inherit" },
    );
  }

  execSync(`codesign --verify --deep --strict ${shellQuote(bundlePath)}`, { stdio: "inherit" });
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
  const env = {
    ...process.env,
    ...hudsonFeatureEnvironment(hudsonConfigPath),
  };
  execSync("swift build -c release", {
    cwd: appDir,
    env,
    stdio: "inherit",
  });

  const binPath = execSync("swift build -c release --show-bin-path", {
    cwd: appDir,
    env,
    stdio: ["ignore", "pipe", "inherit"],
  }).toString("utf8").trim();

  return join(binPath, "ScoutMenu");
}

function writeBundle(version: string): void {
  const releaseBinary = releaseBinaryPath();
  if (!existsSync(releaseBinary)) {
    throw new Error(`Built binary not found at ${releaseBinary}`);
  }

  for (const legacyBundlePath of legacyBundlePaths) {
    rmSync(legacyBundlePath, { recursive: true, force: true });
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
  execSync(`touch '${bundlePath}'`, { stdio: "pipe" });
  // Signing must be the final bundle mutation. Keychain ACLs trust the stable
  // Developer ID requirement; an ad-hoc post-build signature is CDHash-bound
  // and makes every rebuild look like a different application.
  signBundle(options);
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
  // `hud` takes positional sub-args (action + optional name/path), so we
  // don't run it through parseOptions (which throws on unknown flags).
  const argv = process.argv.slice(2);
  if (argv[0] === "hud") {
    await runHudCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "tail") {
    await runTailCommand(argv.slice(1));
    return;
  }

  const { command, options } = parseOptions(argv);

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
        console.log("Scout Menu stopped.");
      } else {
        console.log("Scout Menu is not running.");
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

// ── HUD control via scout:// URL scheme ─────────────────────────────
//
// Actions are fired as URLs (`open -g scout://hud/<action>`); the app
// mirrors current state to /tmp/openscout-hud-state.json on every
// change. `capture` reads windowId from that file and shells out to
// screencapture; `matrix` walks the HUD tab/size grid for a polish review.

const HUD_STATE_PATH = "/tmp/openscout-hud-state.json";
const TAIL_STATE_PATH = "/tmp/openscout-tail-state.json";
const HUD_TABS = ["agents", "activity", "tail", "sessions", "assistant"] as const;
const HUD_SIZES = ["compact", "medium", "large"] as const;
const HUD_CAPTURE_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

type HudState = {
  visible: boolean;
  tab: string;
  size: string;
  windowId: number;
  ts: number;
};

type TailState = {
  visible: boolean;
  size: string;
  collapsed: boolean;
  placement: "attached" | "floating";
  windowId: number;
  ts: number;
};

function readHudState(): HudState {
  if (!existsSync(HUD_STATE_PATH)) {
    throw new Error(
      `${HUD_STATE_PATH} not found. Is Scout Menu running? Try \`launch\`.`,
    );
  }
  return JSON.parse(readFileSync(HUD_STATE_PATH, "utf8")) as HudState;
}

function fireHudURL(path: string): void {
  execFileSync(
    "open",
    ["-g", "-b", bundleIdentifier, `scout://hud/${path}`],
    { stdio: "inherit" },
  );
}

function readTailState(): TailState {
  if (!existsSync(TAIL_STATE_PATH)) {
    throw new Error(
      `${TAIL_STATE_PATH} not found. Is Scout running? Try \`tail show\`.`,
    );
  }
  return JSON.parse(readFileSync(TAIL_STATE_PATH, "utf8")) as TailState;
}

function fireTailURL(path: string): void {
  execSync(`open -g 'scout://tail/${path}'`, { stdio: "inherit" });
}

function captureHud(out: string): string {
  const state = readHudState();
  if (!state.visible || !state.windowId) {
    throw new Error("HUD not visible. Send `hud show` first.");
  }
  execSync(`screencapture -x -l${state.windowId} '${out}'`);
  return out;
}

function captureTail(out: string): string {
  const state = readTailState();
  if (!state.visible || !state.windowId) {
    throw new Error("Tail mode not visible. Send `tail show` first.");
  }
  execSync(`screencapture -x -l${state.windowId} '${out}'`);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runHudCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  switch (action) {
    case undefined:
    case "state": {
      console.log(JSON.stringify(readHudState(), null, 2));
      return;
    }
    case "show":
    case "hide":
    case "toggle": {
      fireHudURL(action);
      return;
    }
    case "tail": {
      const size = rest[0];
      if (size && !HUD_SIZES.includes(size as typeof HUD_SIZES[number])) {
        throw new Error(`hud tail [${HUD_SIZES.join("|")}]`);
      }
      fireHudURL(size ? `tail/${size}` : "tail");
      return;
    }
    case "tab": {
      const name = rest[0];
      if (!name || !HUD_TABS.includes(name as typeof HUD_TABS[number])) {
        throw new Error(`hud tab <${HUD_TABS.join("|")}>`);
      }
      fireHudURL(`tab/${name}`);
      return;
    }
    case "size": {
      const name = rest[0];
      if (!name || !HUD_SIZES.includes(name as typeof HUD_SIZES[number])) {
        throw new Error(`hud size <${HUD_SIZES.join("|")}>`);
      }
      fireHudURL(`size/${name}`);
      return;
    }
    case "task": {
      const corner = rest[0];
      if (corner && !HUD_CAPTURE_CORNERS.includes(corner as typeof HUD_CAPTURE_CORNERS[number])) {
        throw new Error(`hud task [${HUD_CAPTURE_CORNERS.join("|")}]`);
      }
      fireHudURL(corner ? `task/${corner}` : "task");
      return;
    }
    case "capture": {
      const out =
        rest[0] ?? `/tmp/openscout-hud-${Date.now()}.png`;
      console.log(captureHud(out));
      return;
    }
    case "matrix": {
      // LaunchServices dispatch for `open -g scout://...` adds ~1-2s of
      // latency per URL. Wait long enough that the state file update
      // observed for the current URL is the one we just fired, not a
      // backlog from previous fires.
      const dir = rest[0] ?? "/tmp/hud-shots";
      mkdirSync(dir, { recursive: true });
      console.log(`hud matrix → ${dir}`);
      fireHudURL("show");
      await sleep(1500);
      for (const tab of HUD_TABS) {
        for (const size of HUD_SIZES) {
          // Defensive re-show — if a global click or focus shift dismissed
          // the HUD between iterations, this brings it back without losing
          // the loop.
          if (!readHudState().visible) {
            fireHudURL("show");
            await sleep(1200);
          }
          fireHudURL(`tab/${tab}`);
          await sleep(1500);
          fireHudURL(`size/${size}`);
          await sleep(1500);
          const out = `${dir}/${tab}-${size}.png`;
          try {
            const state = readHudState();
            if (!state.visible) {
              fireHudURL("show");
              await sleep(1500);
              fireHudURL(`tab/${tab}`);
              fireHudURL(`size/${size}`);
              await sleep(1500);
            } else if (state.tab !== tab || state.size !== size) {
              console.error(
                `  ${tab}/${size} state mismatch — actual ${state.tab}/${state.size}; retrying once`,
              );
              fireHudURL(`tab/${tab}`);
              fireHudURL(`size/${size}`);
              await sleep(2000);
            }
            captureHud(out);
            console.log(`  ${tab}/${size} → ${out}`);
          } catch (e) {
            console.error(`  ${tab}/${size} FAILED: ${(e as Error).message}`);
          }
        }
      }
      return;
    }
    default:
      throw new Error(
        `Unknown hud action: ${action}. Try state, show, hide, toggle, tail, tab, size, task, capture, matrix.`,
      );
  }
}

async function runTailCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  switch (action) {
    case undefined:
    case "state": {
      console.log(JSON.stringify(readTailState(), null, 2));
      return;
    }
    case "show": {
      const size = rest[0];
      if (size && !HUD_SIZES.includes(size as typeof HUD_SIZES[number])) {
        throw new Error(`tail show [${HUD_SIZES.join("|")}]`);
      }
      fireTailURL(size ? `show/${size}` : "show");
      return;
    }
    case "hide":
    case "toggle":
    case "attach":
    case "float":
    case "collapse":
    case "expand": {
      fireTailURL(action);
      return;
    }
    case "size": {
      const name = rest[0];
      if (!name || !HUD_SIZES.includes(name as typeof HUD_SIZES[number])) {
        throw new Error(`tail size <${HUD_SIZES.join("|")}>`);
      }
      fireTailURL(`size/${name}`);
      return;
    }
    case "capture": {
      const out = rest[0] ?? `/tmp/openscout-tail-${Date.now()}.png`;
      console.log(captureTail(out));
      return;
    }
    default:
      throw new Error(
        `Unknown tail action: ${action}. Try state, show, hide, toggle, attach, float, size, collapse, expand, capture.`,
      );
  }
}

await main();
