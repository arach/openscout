import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const runtimePackages = [
  "express",
  "lucide-react",
  "motion",
  "react",
  "react-dom",
  "react-markdown",
];

const projectRoot = process.cwd();
const electronAppSourceCandidates = [
  path.join(projectRoot, "node_modules", "electron", "dist", "Electron.app"),
  path.join(projectRoot, "..", "..", "node_modules", "electron", "dist", "Electron.app"),
];
const electronAppSource = electronAppSourceCandidates.find((candidate) => existsSync(candidate));
const outputRoot = path.join(projectRoot, "dist", "macos");
const rootPackage = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
);

const productName = rootPackage.productName || "Scout";
const bundleId = rootPackage.bundleId || "com.scout.desktop";
const bundleIconSource = path.join(projectRoot, "public", "scout.icns");
const windowIconSource = path.join(projectRoot, "public", "scout-icon.png");
const bundleIconFile = "scout.icns";
const windowIconFile = "scout-icon.png";
const appBundlePath = path.join(outputRoot, `${productName}.app`);
const appContentsPath = path.join(appBundlePath, "Contents");
const appResourcesPath = path.join(appContentsPath, "Resources");
const appRuntimePath = path.join(appResourcesPath, "app");
const plistPath = path.join(appContentsPath, "Info.plist");
const signIdentity = process.env.CODESIGN_IDENTITY?.trim() || "Developer ID Application: Arach Tchoupani (2U83JFPW66)";
const shouldCodesign = process.env.SKIP_CODESIGN !== "1";
const shouldNotarize = process.env.SKIP_NOTARIZE !== "1";
const notaryProfile = process.env.NOTARY_PROFILE?.trim() || "notarytool";

async function copyIntoBundle(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Expected bundle resource at ${source}`);
  }

  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
}

async function copyFileIntoBundle(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Expected bundle resource at ${source}`);
  }

  await fs.copyFile(source, destination);
}

function setPlistValue(key, value) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath], {
      stdio: "ignore",
    });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plistPath], {
      stdio: "ignore",
    });
  }
}

if (!electronAppSource) {
  throw new Error(`Electron.app not found in any expected location: ${electronAppSourceCandidates.join(", ")}`);
}

await fs.mkdir(outputRoot, { recursive: true });
await fs.rm(appBundlePath, { recursive: true, force: true });
await fs.cp(electronAppSource, appBundlePath, { recursive: true });

await fs.rename(
  path.join(appContentsPath, "MacOS", "Electron"),
  path.join(appContentsPath, "MacOS", productName),
);

setPlistValue("CFBundleDisplayName", productName);
setPlistValue("CFBundleName", productName);
setPlistValue("CFBundleExecutable", productName);
setPlistValue("CFBundleIdentifier", bundleId);
setPlistValue("CFBundleIconFile", path.basename(bundleIconFile, ".icns"));

await copyFileIntoBundle(bundleIconSource, path.join(appResourcesPath, bundleIconFile));
await copyFileIntoBundle(windowIconSource, path.join(appResourcesPath, windowIconFile));

await fs.mkdir(appRuntimePath, { recursive: true });
await fs.mkdir(path.join(appRuntimePath, "dist"), { recursive: true });

await copyIntoBundle(path.join(projectRoot, "dist", "client"), path.join(appRuntimePath, "dist", "client"));
await copyIntoBundle(path.join(projectRoot, "dist", "electron"), path.join(appRuntimePath, "dist", "electron"));
await copyIntoBundle(path.join(projectRoot, "dist", "server"), path.join(appRuntimePath, "dist", "server"));
await copyIntoBundle(path.join(projectRoot, "..", "cli", "bin"), path.join(appRuntimePath, "cli", "bin"));
await copyIntoBundle(path.join(projectRoot, "..", "cli", "dist"), path.join(appRuntimePath, "cli", "dist"));
await fs.copyFile(
  path.join(projectRoot, "dist", "index.js"),
  path.join(appRuntimePath, "dist", "index.js"),
);

const runtimeDependencies = Object.fromEntries(
  runtimePackages.map((name) => {
    const version = rootPackage.dependencies?.[name];
    if (!version) {
      throw new Error(`Missing runtime dependency version for ${name} in package.json`);
    }

    return [name, version];
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
  // Fix Electron Framework structure for proper code signing.
  // Electron ships a flat framework layout which Apple considers "unsealed."
  // We restructure it into the canonical Versions/A + symlinks layout.
  const frameworksPath = path.join(appContentsPath, "Frameworks");
  // Fix all .framework bundles — ensure proper Versions/A + symlinks structure
  const allFrameworks = execFileSync("find", [frameworksPath, "-name", "*.framework", "-maxdepth", "1"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

  for (const fwPath of allFrameworks) {
    const versionA = path.join(fwPath, "Versions", "A");
    if (!existsSync(versionA)) continue;

    // Ensure Versions/Current -> A relative symlink
    const currentLink = path.join(fwPath, "Versions", "Current");
    await fs.rm(currentLink, { force: true });
    await fs.symlink("A", currentLink);

    // Get all entries in Versions/A to know what symlinks we need
    const versionedEntries = await fs.readdir(versionA);

    // Remove all top-level items except Versions, recreate as relative symlinks
    const topEntries = await fs.readdir(fwPath);
    for (const entry of topEntries) {
      if (entry === "Versions") continue;
      const topLevel = path.join(fwPath, entry);
      await fs.rm(topLevel, { recursive: true, force: true });

      // Only symlink if it exists in Versions/A
      if (versionedEntries.includes(entry)) {
        await fs.symlink(`Versions/Current/${entry}`, topLevel);
      }
    }
  }

  // Sign inside-out: frameworks first, then helpers, then the main app

  // 1. Sign all Mach-O binaries and libraries in the entire bundle
  // Use `file` to find every Mach-O binary, then sign each one
  const allBundleFiles = execFileSync("find", [appBundlePath, "-type", "f"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

  const machoFiles = [];
  // Check files in batches using `file` command
  for (let i = 0; i < allBundleFiles.length; i += 100) {
    const batch = allBundleFiles.slice(i, i + 100);
    const out = execFileSync("file", batch, { encoding: "utf8" });
    for (const line of out.split("\n")) {
      if (line.includes("Mach-O")) {
        const filePath = line.split(":")[0].trim();
        if (filePath && !filePath.includes(".app/Contents/MacOS/")) {
          machoFiles.push(filePath);
        }
      }
    }
  }

  for (const file of machoFiles) {
    execFileSync("codesign", ["--force", "--sign", signIdentity, "--options", "runtime", "--timestamp", file], { stdio: "inherit" });
  }

  // 2. Sign helper apps
  const helpers = execFileSync("find", [frameworksPath, "-name", "*.app", "-maxdepth", "1"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  for (const helper of helpers) {
    execFileSync("codesign", ["--force", "--sign", signIdentity, "--options", "runtime", "--timestamp", helper], { stdio: "inherit" });
  }

  // 4. Sign the Electron Framework (sign the versioned bundle to avoid "unsealed contents" error)
  const frameworks = execFileSync("find", [frameworksPath, "-name", "*.framework", "-maxdepth", "1"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  for (const fw of frameworks) {
    const versionedPath = path.join(fw, "Versions", "A");
    if (existsSync(versionedPath)) {
      execFileSync("codesign", ["--force", "--sign", signIdentity, "--options", "runtime", "--timestamp", versionedPath], { stdio: "inherit" });
    }
    execFileSync("codesign", ["--force", "--sign", signIdentity, "--options", "runtime", "--timestamp", fw], { stdio: "inherit" });
  }

  // 5. Sign the main app bundle
  execFileSync("codesign", [
    "--force", "--sign", signIdentity,
    "--options", "runtime",
    "--timestamp",
    appBundlePath,
  ], { stdio: "inherit" });

  execFileSync("codesign", ["--verify", "--deep", "--strict", appBundlePath], {
    stdio: "inherit",
  });
}

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
      executable: path.join(appContentsPath, "MacOS", productName),
      appRuntime: appRuntimePath,
      codesigned: shouldCodesign,
      notarized,
      signIdentity,
    },
    null,
    2,
  ),
);
