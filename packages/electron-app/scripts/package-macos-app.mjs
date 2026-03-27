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
const electronAppSource = path.join(projectRoot, "node_modules", "electron", "dist", "Electron.app");
const outputRoot = path.join(projectRoot, "dist", "macos");
const rootPackage = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
);

const productName = rootPackage.productName || "OpenScout";
const bundleId = rootPackage.bundleId || "com.openscout.desktop";
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

if (!existsSync(electronAppSource)) {
  throw new Error(`Electron.app not found at ${electronAppSource}`);
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

await fs.mkdir(appRuntimePath, { recursive: true });
await fs.mkdir(path.join(appRuntimePath, "dist"), { recursive: true });

await copyIntoBundle(path.join(projectRoot, "dist", "client"), path.join(appRuntimePath, "dist", "client"));
await copyIntoBundle(path.join(projectRoot, "dist", "electron"), path.join(appRuntimePath, "dist", "electron"));
await copyIntoBundle(path.join(projectRoot, "dist", "server"), path.join(appRuntimePath, "dist", "server"));
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

console.log(
  JSON.stringify(
    {
      appBundle: appBundlePath,
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
