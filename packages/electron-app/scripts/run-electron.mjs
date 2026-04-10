import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  codesignAppBundle,
  copyAppBundle,
  prepareAppBundleMetadata,
  readElectronVersion,
  readPackageMetadata,
  resolveElectronAppSource,
  resolveSigningIdentity,
} from "./electron-bundle-lib.mjs";

async function readStamp(stampPath) {
  if (!existsSync(stampPath)) {
    return null;
  }

  try {
    return JSON.parse(await fs.readFile(stampPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeStamp(stampPath, stamp) {
  await fs.writeFile(stampPath, JSON.stringify(stamp, null, 2) + "\n");
}

async function prepareDevApp(projectRoot) {
  const bundleMetadata = readPackageMetadata(projectRoot);
  const sourceAppPath = resolveElectronAppSource(projectRoot);
  if (!existsSync(sourceAppPath)) {
    throw new Error(`Electron.app not found at ${sourceAppPath}`);
  }

  const devRoot = path.join(projectRoot, "dist", "dev");
  const displayName = bundleMetadata.productName;
  const executableName = displayName;
  const bundleId = `${bundleMetadata.bundleId}.dev`;
  const targetAppPath = path.join(devRoot, `${displayName}.app`);
  const stampPath = path.join(devRoot, "electron-stamp.json");
  const sourceRealPath = await fs.realpath(sourceAppPath);
  const sourceVersion = await readElectronVersion(sourceAppPath);
  const signIdentity = resolveSigningIdentity({
    skipCodesign: process.env.SKIP_DEV_CODESIGN === "1",
    explicitIdentity: process.env.DEV_CODESIGN_IDENTITY?.trim() || process.env.CODESIGN_IDENTITY?.trim() || "",
  });
  const desiredStamp = {
    sourceRealPath,
    sourceVersion,
    signIdentity,
    displayName,
    executableName,
    bundleId,
  };
  const currentStamp = await readStamp(stampPath);

  const isCurrent =
    existsSync(targetAppPath) &&
    currentStamp?.sourceRealPath === desiredStamp.sourceRealPath &&
    currentStamp?.sourceVersion === desiredStamp.sourceVersion &&
    currentStamp?.signIdentity === desiredStamp.signIdentity &&
    currentStamp?.displayName === desiredStamp.displayName &&
    currentStamp?.executableName === desiredStamp.executableName &&
    currentStamp?.bundleId === desiredStamp.bundleId;

  if (!isCurrent) {
    await fs.mkdir(devRoot, { recursive: true });
    await copyAppBundle(sourceAppPath, targetAppPath);
    await prepareAppBundleMetadata(targetAppPath, {
      displayName,
      executableName,
      bundleId,
      bundleIconSource: bundleMetadata.bundleIconSource,
      windowIconSource: bundleMetadata.windowIconSource,
      iconName: "scout.icns",
      windowIconName: "scout-icon.png",
    });

    if (signIdentity) {
      codesignAppBundle(targetAppPath, signIdentity);
    }

    await writeStamp(stampPath, desiredStamp);
  }

  return path.join(targetAppPath, "Contents", "MacOS", executableName);
}

async function main() {
  const projectRoot = process.cwd();
  const electronExecutable = await prepareDevApp(projectRoot);
  const electronArgs = process.argv.slice(2);

  if (electronArgs.length === 0) {
    throw new Error("Expected at least one Electron argument.");
  }

  const child = spawn(electronExecutable, electronArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

await main();
