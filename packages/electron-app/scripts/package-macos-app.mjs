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

const productName = rootPackage.productName || "OpenScout";
const bundleId = rootPackage.bundleId || "com.openscout.desktop";
const bundleIconSource = path.join(projectRoot, "public", "openscout.icns");
const windowIconSource = path.join(projectRoot, "public", "openscout-icon.png");
const bundleIconFile = "openscout.icns";
const windowIconFile = "openscout-icon.png";
const appBundlePath = path.join(outputRoot, `${productName}.app`);
const appContentsPath = path.join(appBundlePath, "Contents");
const appResourcesPath = path.join(appContentsPath, "Resources");
const appRuntimePath = path.join(appResourcesPath, "app");
const plistPath = path.join(appContentsPath, "Info.plist");
const signIdentity = process.env.CODESIGN_IDENTITY?.trim() || "-";
const shouldCodesign = process.env.SKIP_CODESIGN !== "1";
const shouldVerifySignature = process.env.CODESIGN_VERIFY === "1";

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
await copyIntoBundle(path.join(projectRoot, "..", "..", "dispatch", "cli", "bin"), path.join(appRuntimePath, "dispatch-cli", "bin"));
await copyIntoBundle(path.join(projectRoot, "..", "..", "dispatch", "cli", "dist"), path.join(appRuntimePath, "dispatch-cli", "dist"));
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
  execFileSync("codesign", ["--force", "--sign", signIdentity, appBundlePath], {
    stdio: "inherit",
  });
  if (shouldVerifySignature) {
    execFileSync("codesign", ["--verify", "--strict", appBundlePath], {
      stdio: "inherit",
    });
  }
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

console.log(
  JSON.stringify(
    {
      appBundle: appBundlePath,
      dmg: dmgPath,
      executable: path.join(appContentsPath, "MacOS", productName),
      appRuntime: appRuntimePath,
      codesigned: shouldCodesign,
      signatureVerified: shouldCodesign && shouldVerifySignature,
      signIdentity,
    },
    null,
    2,
  ),
);
