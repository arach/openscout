import builder from "electron-builder";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const { build, Platform } = builder;

export const SCOUT_GITHUB_RELEASE = {
  owner: "arach",
  repo: "openscout",
};

export async function writeAppUpdateConfiguration(resourcesPath) {
  const payload = [
    "provider: github",
    `owner: ${SCOUT_GITHUB_RELEASE.owner}`,
    `repo: ${SCOUT_GITHUB_RELEASE.repo}`,
    "updaterCacheDirName: scout-updater",
  ].join("\n");

  await fs.writeFile(path.join(resourcesPath, "app-update.yml"), `${payload}\n`, "utf8");
}

export async function buildMacUpdateArtifacts({
  projectRoot,
  appBundlePath,
  outputRoot,
  bundleId,
  productName,
  version,
}) {
  const artifactPaths = await build({
    projectDir: projectRoot,
    prepackaged: appBundlePath,
    publish: "never",
    targets: Platform.MAC.createTarget(["zip"]),
    config: {
      appId: bundleId,
      productName,
      directories: {
        output: outputRoot,
      },
      artifactName: "${productName}-${version}-mac-${arch}.${ext}",
      publish: [
        {
          provider: "github",
          owner: SCOUT_GITHUB_RELEASE.owner,
          repo: SCOUT_GITHUB_RELEASE.repo,
        },
      ],
      mac: {
        target: ["zip"],
      },
    },
  });

  const resolvedArtifacts = Array.from(artifactPaths);
  await writeLatestMacManifest(outputRoot, resolvedArtifacts, version);
  return resolvedArtifacts;
}

async function writeLatestMacManifest(outputRoot, artifactPaths, version) {
  const zipPath = artifactPaths.find((artifactPath) => artifactPath.endsWith(".zip"));
  if (!zipPath) {
    throw new Error("Unable to locate the macOS zip artifact for latest-mac.yml generation.");
  }

  const zipContents = await fs.readFile(zipPath);
  const zipStats = await fs.stat(zipPath);
  const sha512 = crypto.createHash("sha512").update(zipContents).digest("base64");
  const releaseDate = zipStats.mtime.toISOString();
  const zipFileName = path.basename(zipPath);
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${zipFileName}`,
    `    sha512: ${sha512}`,
    `    size: ${zipStats.size}`,
    `path: ${zipFileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
  ].join("\n");

  await fs.writeFile(path.join(outputRoot, "latest-mac.yml"), `${manifest}\n`, "utf8");
}
