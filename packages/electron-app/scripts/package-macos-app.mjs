import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  codesignAppBundle,
  copyAppBundle,
  prepareAppBundleMetadata,
  readPackageMetadata,
  resolveElectronAppSource,
} from "./electron-bundle-lib.mjs";
import {
  buildMacUpdateArtifacts,
  writeAppUpdateConfiguration,
} from "./electron-updater-lib.mjs";

const projectRoot = process.cwd();

// Workspace packages are no longer bundled into the app.
// @openscout/runtime and @openscout/protocol are resolved by tsup at build time
// and bundled into dist/electron/main.js. The broker binary is sourced from
// the user's globally installed @openscout/runtime (via npm/scout CLI).
const outputRoot = path.join(projectRoot, "dist", "macos");
const { packageJson: rootPackage, productName, bundleId, bundleIconSource, windowIconSource } = readPackageMetadata(projectRoot);
const electronAppSource = resolveElectronAppSource(projectRoot);
const bundleIconFile = "scout.icns";
const windowIconFile = "scout-icon.png";
const appBundlePath = path.join(outputRoot, `${productName}.app`);
const appContentsPath = path.join(appBundlePath, "Contents");
const appResourcesPath = path.join(appContentsPath, "Resources");
const appRuntimePath = path.join(appResourcesPath, "app");
const appEntitlementsPath = path.join(projectRoot, "entitlements.mac.plist");
const helperEntitlementsPath = path.join(projectRoot, "entitlements.mac.inherit.plist");
const signIdentity = process.env.CODESIGN_IDENTITY?.trim() || "Developer ID Application: Arach Tchoupani (2U83JFPW66)";
const shouldCodesign = process.env.SKIP_CODESIGN !== "1";
const shouldNotarize = process.env.SKIP_NOTARIZE !== "1";
const notaryProfile = process.env.NOTARY_PROFILE?.trim() || "notarytool";
const appVersion = rootPackage.version;

async function copyIntoBundle(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Expected bundle resource at ${source}`);
  }

  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
}


if (!existsSync(electronAppSource)) {
  throw new Error("Electron.app not found in installed dependencies.");
}

await fs.mkdir(outputRoot, { recursive: true });
await copyAppBundle(electronAppSource, appBundlePath);
await prepareAppBundleMetadata(appBundlePath, {
  displayName: productName,
  executableName: productName,
  bundleId,
  bundleIconSource,
  windowIconSource,
  iconName: bundleIconFile,
  windowIconName: windowIconFile,
});

await fs.mkdir(appRuntimePath, { recursive: true });
await fs.mkdir(path.join(appRuntimePath, "dist"), { recursive: true });
await writeAppUpdateConfiguration(appResourcesPath);

await copyIntoBundle(path.join(projectRoot, "dist", "client"), path.join(appRuntimePath, "dist", "client"));
await copyIntoBundle(path.join(projectRoot, "dist", "electron"), path.join(appRuntimePath, "dist", "electron"));
await copyIntoBundle(path.join(projectRoot, "dist", "server"), path.join(appRuntimePath, "dist", "server"));
await fs.copyFile(
  path.join(projectRoot, "dist", "index.js"),
  path.join(appRuntimePath, "dist", "index.js"),
);

const runtimeDependencies = Object.fromEntries(
  Object.entries(rootPackage.dependencies ?? {}).filter(([name, version]) => {
    if (!version) {
      throw new Error(`Missing runtime dependency version for ${name} in package.json`);
    }

    return !name.startsWith("@openscout/");
  }),
);

await fs.writeFile(
  path.join(appRuntimePath, "package.json"),
  JSON.stringify(
    {
      name: rootPackage.name,
      private: true,
      type: "module",
      main: "dist/electron/main.js",
      dependencies: runtimeDependencies,
    },
    null,
    2,
  ) + "\n",
);

execFileSync("bun", ["install", "--production"], {
  cwd: appRuntimePath,
  stdio: "inherit",
  env: process.env,
});


if (shouldCodesign) {
  codesignAppBundle(appBundlePath, signIdentity, {
    runtime: true,
    timestamp: true,
    appEntitlementsPath,
    helperEntitlementsPath,
  });
}

let appNotarized = false;
if (shouldCodesign && shouldNotarize) {
  console.log("Zipping app bundle for notarization...");
  const appZipPath = path.join(outputRoot, `${productName}.app.zip`);
  await fs.rm(appZipPath, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", appBundlePath, appZipPath], { stdio: "inherit" });

  console.log("Submitting app bundle for notarization...");
  execFileSync("xcrun", [
    "notarytool", "submit", appZipPath,
    "--keychain-profile", notaryProfile,
    "--wait",
  ], { stdio: "inherit" });

  await fs.rm(appZipPath, { force: true });

  console.log("Stapling app bundle notarization ticket...");
  execFileSync("xcrun", ["stapler", "staple", appBundlePath], { stdio: "inherit" });
  appNotarized = true;
}

const shouldBuildUpdates = process.env.SCOUT_BUILD_UPDATES !== "0";
const updateArtifacts = shouldBuildUpdates
  ? await buildMacUpdateArtifacts({
      projectRoot,
      appBundlePath,
      outputRoot,
      bundleId,
      productName,
      version: appVersion,
    })
  : [];

const dmgPath = path.join(outputRoot, `${productName}.dmg`);
await fs.rm(dmgPath, { force: true });

const createDmgArgs = [
  "--volname", productName,
  "--window-pos", "200", "120",
  "--window-size", "600", "400",
  "--icon-size", "100",
  "--icon", `${productName}.app`, "150", "190",
  "--app-drop-link", "450", "190",
];

if (existsSync(bundleIconSource)) {
  createDmgArgs.push("--volicon", bundleIconSource);
}

createDmgArgs.push(dmgPath, appBundlePath);

execFileSync("create-dmg", createDmgArgs, { stdio: "inherit" });

let notarized = false;
if (shouldCodesign && shouldNotarize) {
  console.log("Submitting DMG for notarization...");
  execFileSync("xcrun", [
    "notarytool", "submit", dmgPath,
    "--keychain-profile", notaryProfile,
    "--wait",
  ], { stdio: "inherit" });

  console.log("Stapling notarization ticket...");
  execFileSync("xcrun", ["stapler", "staple", dmgPath], { stdio: "inherit" });
  notarized = true;
}

console.log(
  JSON.stringify(
    {
      appBundle: appBundlePath,
      dmg: dmgPath,
      updateArtifacts,
      executable: path.join(appContentsPath, "MacOS", productName),
      appRuntime: appRuntimePath,
      codesigned: shouldCodesign,
      appNotarized,
      notarized,
      signIdentity,
    },
    null,
    2,
  ),
);
