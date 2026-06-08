#!/usr/bin/env bun
/**
 * hkit — HudsonKit build driver.
 *
 * Reads a declarative app manifest (`hkit.json`) that describes WHAT an app
 * wants — its scheme, target device, and which HudsonKit *features* it needs —
 * and does the rest: regenerates the Xcode project, resolves features into the
 * build env HudsonKit gates on, and runs xcodebuild / devicectl.
 *
 *   hkit build [manifest]   regenerate project + build the .app
 *   hkit run   [manifest]   build + install on device (+ --launch to start it)
 *   hkit gen   [manifest]   just (re)generate the Xcode project from project.yml
 *
 * The point: an app names a *feature* ("terminal"), never an env var. The
 * feature→mechanism mapping lives in the catalog below — today it emits the
 * `HUDSONKIT_WITH_*` env vars HudsonKit reads at SwiftPM manifest eval. When the
 * Xcode build path eventually learns to pass SwiftPM traits, only this catalog
 * and the emit step change; every app's hkit.json stays identical.
 *
 * Catalog note: this lives in openscout for now to prove the tool on its one
 * real consumer (Scout). It's meant to graduate into HudsonKit so hudson
 * owns the feature truth and ships `hkit` as an offering.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// --- Feature catalog: feature name -> build env HudsonKit gates on ------------
// HudsonTerminal (Termini/Ghostty SSH+PTY) and HudsonVoice (Vox/Parakeet) are
// optional backends wired as local-path deps; HudsonKit only declares them when
// these are set at manifest-eval time. See reference_scout_device_build.
const FEATURE_CATALOG: Record<string, { env: Record<string, string>; note: string }> = {
  terminal: { env: { HUDSONKIT_WITH_TERMINAL: "1" }, note: "HudsonTerminal — Termini SSH/PTY (Ghostty)" },
  voice: { env: { HUDSONKIT_WITH_VOICE: "1" }, note: "HudsonVoice — Vox/Parakeet dictation" },
};

interface Manifest {
  app: string;
  bundleId?: string;
  xcodeproj: string;
  xcodegen?: string;
  scheme: string;
  configuration?: string;
  features?: string[];
  derivedData?: string;
  destination?: string;
  device?: string;
}

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function die(msg: string): never {
  console.error(`${C.red("hkit:")} ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  console.log(C.dim(`$ ${cmd} ${args.join(" ")}`));
  const r = spawnSync(cmd, args, { stdio: "inherit", env, cwd });
  if (r.status !== 0) die(`${cmd} exited with ${r.status ?? r.signal}`);
}

function loadManifest(scriptDir: string, arg?: string): { manifest: Manifest; projectDir: string } {
  const path = arg
    ? isAbsolute(arg)
      ? arg
      : resolve(process.cwd(), arg)
    : join(scriptDir, "hkit.json");
  if (!existsSync(path)) die(`manifest not found: ${path}`);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    die(`could not parse ${path}: ${(e as Error).message}`);
  }
  for (const k of ["app", "xcodeproj", "scheme"] as const) {
    if (!manifest[k]) die(`manifest is missing required field "${k}"`);
  }
  return { manifest, projectDir: dirname(path) };
}

function resolveFeatureEnv(features: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of features) {
    const entry = FEATURE_CATALOG[f];
    if (!entry) {
      die(`unknown feature "${f}". known: ${Object.keys(FEATURE_CATALOG).join(", ")}`);
    }
    Object.assign(env, entry.env);
  }
  return env;
}

function generate(m: Manifest, projectDir: string) {
  const spec = m.xcodegen ?? "project.yml";
  console.log(C.bold(`▸ xcodegen`) + C.dim(`  ${spec} → ${m.xcodeproj}`));
  run("xcodegen", ["generate", "--spec", spec], process.env, projectDir);
}

function buildArgs(m: Manifest, derivedAbs: string): string[] {
  return [
    "-project", m.xcodeproj,
    "-scheme", m.scheme,
    "-configuration", m.configuration ?? "Debug",
    "-derivedDataPath", derivedAbs,
  ];
}

function build(
  m: Manifest,
  projectDir: string,
  featureEnv: Record<string, string>,
  opts: { gen: boolean; noSign?: boolean },
) {
  if (opts.gen) generate(m, projectDir);

  const config = m.configuration ?? "Debug";
  const derivedAbs = resolve(projectDir, m.derivedData ?? ".deriveddata/devphone");
  const env = { ...process.env, ...featureEnv };

  console.log(C.bold(`▸ build`) + C.dim(`  ${m.scheme} (${config})`));
  for (const [k, v] of Object.entries(featureEnv)) console.log(C.dim(`    env  ${k}=${v}`));

  // Feature-set smoothing: HudsonKit reads the feature env at SwiftPM manifest
  // eval, but xcodebuild caches resolution keyed on manifest *contents*, not the
  // env — so toggling features without a re-resolve can build stale. If the
  // feature signature changed since last build, force a package re-resolve
  // (non-destructive; doesn't nuke checkouts).
  const sigFile = join(derivedAbs, ".hkit-features");
  const sig = JSON.stringify({ features: m.features ?? [], config });
  if (existsSync(sigFile) && readFileSync(sigFile, "utf8") !== sig) {
    console.log(C.yellow("    feature set changed since last build → re-resolving packages"));
    run("xcodebuild", [...buildArgs(m, derivedAbs), "-resolvePackageDependencies"], env, projectDir);
  }

  // --no-sign: device-SDK compile+link without code signing — a fast "does it
  // build" check that doesn't need a valid Apple account / cert. The artifact is
  // unsigned and not installable.
  const signArgs = opts.noSign
    ? ["CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY="]
    : ["-allowProvisioningUpdates"];
  if (opts.noSign) console.log(C.yellow("    code signing disabled (--no-sign): artifact won't be installable"));

  run(
    "xcodebuild",
    [
      ...buildArgs(m, derivedAbs),
      "-destination", m.destination ?? "generic/platform=iOS",
      ...signArgs,
      "build",
    ],
    env,
    projectDir,
  );

  mkdirSync(derivedAbs, { recursive: true });
  writeFileSync(sigFile, sig);

  const appPath = join(derivedAbs, "Build", "Products", `${config}-iphoneos`, `${m.app}.app`);
  if (!existsSync(appPath)) die(`build succeeded but no app at ${appPath}`);
  console.log(C.green(`✓ built `) + C.dim(appPath));
  return appPath;
}

function install(m: Manifest, appPath: string, opts: { launch: boolean; device?: string }) {
  const device = opts.device ?? process.env.OPENSCOUT_IOS_DEVICE_ID ?? m.device;
  if (!device) die(`no device id (set "device" in the manifest, --device, or OPENSCOUT_IOS_DEVICE_ID)`);

  console.log(C.bold(`▸ install`) + C.dim(`  → ${device}`));
  run("xcrun", ["devicectl", "device", "install", "app", "--device", device, appPath], process.env, process.cwd());

  if (opts.launch) {
    if (!m.bundleId) die(`--launch needs "bundleId" in the manifest`);
    console.log(C.bold(`▸ launch`) + C.dim(`  ${m.bundleId}`));
    run("xcrun", ["devicectl", "device", "process", "launch", "--device", device, m.bundleId], process.env, process.cwd());
  }
  console.log(C.green(`✓ on device`));
}

function main() {
  const scriptDir = dirname(Bun.fileURLToPath?.(import.meta.url) ?? new URL(import.meta.url).pathname);
  const [command, ...rest] = process.argv.slice(2);

  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const positional = rest.filter((a) => !a.startsWith("--"));
  const deviceFlag = rest.find((a) => a.startsWith("--device="))?.split("=")[1];
  const gen = !flags.has("--no-gen");
  const launch = flags.has("--launch");
  const noSign = flags.has("--no-sign");

  const wantsHelp =
    !command || flags.has("--help") || ["help", "--help", "-h"].includes(command);
  if (wantsHelp) {
    console.log(`hkit — HudsonKit build driver

  hkit build [manifest]   regenerate project + build the .app
  hkit run   [manifest]   build + install on device
  hkit gen   [manifest]   just (re)generate the Xcode project

  flags: --no-gen  --no-sign  --launch  --device=<id>

manifest defaults to ./hkit.json next to this tool.
features: ${Object.keys(FEATURE_CATALOG).join(", ")}`);
    process.exit(command ? 0 : 1);
  }

  const { manifest, projectDir } = loadManifest(scriptDir, positional[0]);
  const features = manifest.features ?? [];
  const featureEnv = resolveFeatureEnv(features);

  console.log(
    C.bold(`hkit ${command}`) +
      C.dim(`  ${manifest.app}`) +
      (features.length ? C.cyan(`  [${features.join(", ")}]`) : ""),
  );
  for (const f of features) console.log(C.dim(`  · ${f.padEnd(9)} ${FEATURE_CATALOG[f].note}`));

  switch (command) {
    case "gen":
      generate(manifest, projectDir);
      break;
    case "build":
      build(manifest, projectDir, featureEnv, { gen, noSign });
      break;
    case "run": {
      const appPath = build(manifest, projectDir, featureEnv, { gen, noSign });
      install(manifest, appPath, { launch, device: deviceFlag });
      break;
    }
    default:
      die(`unknown command "${command}" (build | run | gen)`);
  }
}

main();
