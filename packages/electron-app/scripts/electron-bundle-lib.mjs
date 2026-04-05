import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const DEFAULT_SIGN_IDENTITY = "Developer ID Application: Arach Tchoupani (2U83JFPW66)";

export function readPackageMetadata(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const productName = packageJson.productName || "Scout";
  const bundleId = packageJson.bundleId || "com.scout.desktop";

  return {
    packageJson,
    productName,
    bundleId,
    bundleIconSource: path.join(projectRoot, "public", "scout.icns"),
    windowIconSource: path.join(projectRoot, "public", "scout-icon.png"),
  };
}

export function resolveElectronPackageDir(projectRoot) {
  const packageJsonPath = require.resolve("electron/package.json", {
    paths: [projectRoot],
  });
  return path.dirname(packageJsonPath);
}

export function resolveElectronAppSource(projectRoot) {
  return path.join(resolveElectronPackageDir(projectRoot), "dist", "Electron.app");
}

export async function readElectronVersion(appSourcePath) {
  const versionPath = path.join(path.dirname(appSourcePath), "version");
  return (await fs.readFile(versionPath, "utf8")).trim();
}

export async function copyAppBundle(sourceAppPath, destinationAppPath) {
  await fs.rm(destinationAppPath, { recursive: true, force: true });
  await fs.cp(sourceAppPath, destinationAppPath, { recursive: true });
}

export function setPlistValue(plistPath, key, value) {
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

export async function copyFileIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return false;
  }

  await fs.copyFile(sourcePath, destinationPath);
  return true;
}

export async function prepareAppBundleMetadata(appBundlePath, options) {
  const appContentsPath = path.join(appBundlePath, "Contents");
  const appResourcesPath = path.join(appContentsPath, "Resources");
  const plistPath = path.join(appContentsPath, "Info.plist");
  const executableSourcePath = path.join(appContentsPath, "MacOS", "Electron");
  const executableTargetPath = path.join(appContentsPath, "MacOS", options.executableName);

  if (options.executableName !== "Electron" && existsSync(executableSourcePath)) {
    await fs.rename(executableSourcePath, executableTargetPath);
  }

  setPlistValue(plistPath, "CFBundleDisplayName", options.displayName);
  setPlistValue(plistPath, "CFBundleName", options.displayName);
  setPlistValue(plistPath, "CFBundleExecutable", options.executableName);
  setPlistValue(plistPath, "CFBundleIdentifier", options.bundleId);

  if (options.iconName) {
    setPlistValue(plistPath, "CFBundleIconFile", path.basename(options.iconName, ".icns"));
  }

  if (options.bundleIconSource && options.iconName) {
    await copyFileIfPresent(options.bundleIconSource, path.join(appResourcesPath, options.iconName));
  }

  if (options.windowIconSource && options.windowIconName) {
    await copyFileIfPresent(options.windowIconSource, path.join(appResourcesPath, options.windowIconName));
  }
}

export function readIdentityOutput() {
  try {
    return execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

export function parseSigningIdentities(output) {
  return output
    .split("\n")
    .map((line) => {
      const match = line.match(/"(.+?)"/);
      return match?.[1]?.trim() || null;
    })
    .filter(Boolean);
}

export function resolveSigningIdentity(options = {}) {
  if (options.skipCodesign) {
    return null;
  }

  const identities = parseSigningIdentities(readIdentityOutput());
  const explicitIdentity = options.explicitIdentity?.trim() || "";
  if (explicitIdentity) {
    if (!identities.includes(explicitIdentity)) {
      throw new Error(`Requested signing identity not found: ${explicitIdentity}`);
    }
    return explicitIdentity;
  }

  if (identities.includes(DEFAULT_SIGN_IDENTITY)) {
    return DEFAULT_SIGN_IDENTITY;
  }

  return (
    identities.find((identity) => identity.startsWith("Developer ID Application:")) ||
    identities.find((identity) => identity.startsWith("Apple Development:")) ||
    null
  );
}

export function findImmediateChildren(rootPath, suffix) {
  if (!existsSync(rootPath)) {
    return [];
  }

  return execFileSync("find", [rootPath, "-maxdepth", "1", "-name", `*${suffix}`], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((entry) => entry !== rootPath);
}

export function normalizeFrameworks(frameworksPath) {
  for (const frameworkPath of findImmediateChildren(frameworksPath, ".framework")) {
    const versionA = path.join(frameworkPath, "Versions", "A");
    if (!existsSync(versionA)) {
      continue;
    }

    const currentLink = path.join(frameworkPath, "Versions", "Current");
    execFileSync("rm", ["-f", currentLink]);
    execFileSync("ln", ["-s", "A", currentLink]);

    const versionedEntries = execFileSync("find", [versionA, "-maxdepth", "1", "-mindepth", "1"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((entry) => path.basename(entry));

    const topEntries = execFileSync("find", [frameworkPath, "-maxdepth", "1", "-mindepth", "1"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((entry) => path.basename(entry));

    for (const entry of topEntries) {
      if (entry === "Versions") {
        continue;
      }

      const topLevelPath = path.join(frameworkPath, entry);
      execFileSync("rm", ["-rf", topLevelPath]);

      if (versionedEntries.includes(entry)) {
        execFileSync("ln", ["-s", `Versions/Current/${entry}`, topLevelPath]);
      }
    }
  }
}

export function findBundleMachOFiles(appPath) {
  const allFiles = execFileSync("find", [appPath, "-type", "f"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const machoFiles = [];

  for (let index = 0; index < allFiles.length; index += 100) {
    const batch = allFiles.slice(index, index + 100);
    const output = execFileSync("file", batch, { encoding: "utf8" });
    for (const line of output.split("\n")) {
      if (!line.includes("Mach-O")) {
        continue;
      }

      const filePath = line.split(":")[0]?.trim();
      if (filePath && !filePath.includes(".app/Contents/MacOS/")) {
        machoFiles.push(filePath);
      }
    }
  }

  return machoFiles;
}

export function codesignAppBundle(appPath, identity, options = {}) {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");
  const extraArgs = [];

  if (options.runtime) {
    extraArgs.push("--options", "runtime");
  }

  if (options.timestamp) {
    extraArgs.push("--timestamp");
  }

  normalizeFrameworks(frameworksPath);

  for (const file of findBundleMachOFiles(appPath)) {
    execFileSync("codesign", ["--force", "--sign", identity, ...extraArgs, file], {
      stdio: "inherit",
    });
  }

  for (const helper of findImmediateChildren(frameworksPath, ".app")) {
    execFileSync("codesign", ["--force", "--sign", identity, ...extraArgs, helper], {
      stdio: "inherit",
    });
  }

  for (const framework of findImmediateChildren(frameworksPath, ".framework")) {
    const versionedPath = path.join(framework, "Versions", "A");
    if (existsSync(versionedPath)) {
      execFileSync("codesign", ["--force", "--sign", identity, ...extraArgs, versionedPath], {
        stdio: "inherit",
      });
    }
    execFileSync("codesign", ["--force", "--sign", identity, ...extraArgs, framework], {
      stdio: "inherit",
    });
  }

  execFileSync("codesign", ["--force", "--sign", identity, ...extraArgs, appPath], {
    stdio: "inherit",
  });

  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
}
