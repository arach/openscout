import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const stagingDir = path.join(packageDir, "staging");
const currentStageDir = path.join(stagingDir, "v0-current");
const appliedStageDir = path.join(stagingDir, "v0-applied");
const packageJsonPath = path.join(packageDir, "package.json");

const DEPENDENCY_BLOCKLIST = new Set([
  "@tailwindcss/postcss",
  "@vercel/analytics",
  "autoprefixer",
  "next",
  "postcss",
  "react",
  "react-dom",
  "typescript",
]);

const STAGE_METADATA_FILES = new Set(["source-package.json", ".stage-source.json"]);

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = "stage";
  let sourceArg;

  if (["stage", "diff", "apply"].includes(args[0])) {
    mode = args.shift();
  }

  if (mode === "stage") {
    sourceArg = args[0];
  }

  return { mode, sourceArg };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listZipCandidates() {
  const downloadsDir = "/Users/arach/Downloads";
  const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
  const zipFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
      .map(async (entry) => {
        const fullPath = path.join(downloadsDir, entry.name);
        const stats = await fs.stat(fullPath);
        return { path: fullPath, mtimeMs: stats.mtimeMs };
      }),
  );

  return zipFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function resolveSourceInput(explicitSource) {
  if (explicitSource) {
    return explicitSource;
  }

  const candidates = await listZipCandidates();
  if (!candidates[0]) {
    throw new Error("No zip files found in /Users/arach/Downloads.");
  }

  return candidates[0].path;
}

async function extractZip(zipPath) {
  const extractDir = await fs.mkdtemp(path.join(tmpdir(), "openscout-v0-"));
  await execFile("unzip", ["-q", zipPath, "-d", extractDir]);
  return extractDir;
}

async function walkForFile(rootDir, relativePath, depth = 0) {
  if (depth > 5) return null;

  const candidate = path.join(rootDir, relativePath);
  if (await pathExists(candidate)) {
    return rootDir;
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const nested = await walkForFile(path.join(rootDir, entry.name), relativePath, depth + 1);
    if (nested) return nested;
  }

  return null;
}

async function ensureCleanDirectory(dirPath) {
  if (await pathExists(dirPath)) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyTree(sourceDir, destDir) {
  if (!(await pathExists(sourceDir))) {
    return;
  }

  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

async function removeEmptyParentDirs(startDir) {
  let currentDir = startDir;
  while (currentDir.startsWith(packageDir) && currentDir !== packageDir) {
    const entries = await fs.readdir(currentDir).catch(() => []);
    if (entries.length > 0) {
      break;
    }
    await fs.rmdir(currentDir).catch(() => {});
    currentDir = path.dirname(currentDir);
  }
}

function mergeDependencyMap(target = {}, incoming = {}) {
  const next = { ...target };
  for (const [name, version] of Object.entries(incoming)) {
    if (DEPENDENCY_BLOCKLIST.has(name)) continue;
    if (!(name in next)) {
      next[name] = version;
    }
  }
  return next;
}

async function mergePackageDependenciesFrom(sourcePackageJsonPath) {
  if (!(await pathExists(sourcePackageJsonPath))) {
    return;
  }

  const [targetPackageJson, sourcePackageJson] = await Promise.all([
    fs.readFile(packageJsonPath, "utf8"),
    fs.readFile(sourcePackageJsonPath, "utf8"),
  ]);

  const target = JSON.parse(targetPackageJson);
  const source = JSON.parse(sourcePackageJson);

  target.dependencies = mergeDependencyMap(target.dependencies, source.dependencies);
  target.devDependencies = mergeDependencyMap(target.devDependencies, source.devDependencies);

  await fs.writeFile(packageJsonPath, `${JSON.stringify(target, null, 2)}\n`);
}

async function writeStageSnapshot(sourceRoot, sourceInput, targetRoot) {
  const sourcePage = path.join(sourceRoot, "app", "page.tsx");
  const sourceGlobals = path.join(sourceRoot, "app", "globals.css");
  const sourcePackageJson = path.join(sourceRoot, "package.json");

  if (!(await pathExists(sourcePage))) {
    throw new Error(`Could not locate app/page.tsx inside ${sourceRoot}`);
  }

  if (!(await pathExists(sourceGlobals))) {
    throw new Error(`Could not locate app/globals.css inside ${sourceRoot}`);
  }

  await ensureCleanDirectory(targetRoot);
  await fs.mkdir(path.join(targetRoot, "src"), { recursive: true });
  await fs.copyFile(sourcePage, path.join(targetRoot, "src", "app.tsx"));
  await fs.copyFile(sourceGlobals, path.join(targetRoot, "src", "index.css"));

  await copyTree(path.join(sourceRoot, "components"), path.join(targetRoot, "src", "components"));
  await copyTree(path.join(sourceRoot, "hooks"), path.join(targetRoot, "src", "hooks"));
  await copyTree(path.join(sourceRoot, "lib"), path.join(targetRoot, "src", "lib"));
  await copyTree(path.join(sourceRoot, "public"), path.join(targetRoot, "public"));

  const componentsJsonPath = path.join(sourceRoot, "components.json");
  if (await pathExists(componentsJsonPath)) {
    await fs.copyFile(componentsJsonPath, path.join(targetRoot, "components.json"));
  }

  if (await pathExists(sourcePackageJson)) {
    await fs.copyFile(sourcePackageJson, path.join(targetRoot, "source-package.json"));
  }

  await fs.writeFile(
    path.join(targetRoot, ".stage-source.json"),
    `${JSON.stringify({ sourceInput, sourceRoot, importedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

async function listManagedFiles(rootDir, baseDir = rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      files = files.concat(await listManagedFiles(fullPath, baseDir));
      continue;
    }
    if (STAGE_METADATA_FILES.has(relativePath)) continue;
    if (entry.name === ".stage-source.json") continue;
    files.push(relativePath);
  }
  return files.sort();
}

async function readFileBuffer(filePath) {
  return fs.readFile(filePath).catch(() => null);
}

async function computeStageDiff(fromDir, toDir) {
  const [fromFiles, toFiles] = await Promise.all([
    listManagedFiles(fromDir),
    listManagedFiles(toDir),
  ]);

  const fileSet = new Set([...fromFiles, ...toFiles]);
  const added = [];
  const modified = [];
  const removed = [];

  for (const relativePath of [...fileSet].sort()) {
    const fromPath = path.join(fromDir, relativePath);
    const toPath = path.join(toDir, relativePath);
    const [fromBuffer, toBuffer] = await Promise.all([readFileBuffer(fromPath), readFileBuffer(toPath)]);

    if (!fromBuffer && toBuffer) {
      added.push(relativePath);
      continue;
    }

    if (fromBuffer && !toBuffer) {
      removed.push(relativePath);
      continue;
    }

    if (fromBuffer && toBuffer && !fromBuffer.equals(toBuffer)) {
      modified.push(relativePath);
    }
  }

  return { added, modified, removed };
}

async function copyManagedFile(relativePath, fromRoot, toRoot) {
  const sourcePath = path.join(fromRoot, relativePath);
  const destPath = path.join(toRoot, relativePath);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(sourcePath, destPath);
}

async function applyCurrentStageToLive() {
  if (!(await pathExists(currentStageDir))) {
    throw new Error("No staged upstream UI found. Run stage first.");
  }

  const hasAppliedBaseline = await pathExists(appliedStageDir);
  const currentFiles = await listManagedFiles(currentStageDir);
  const diff = hasAppliedBaseline
    ? await computeStageDiff(appliedStageDir, currentStageDir)
    : {
        added: currentFiles,
        modified: [],
        removed: [],
      };

  for (const relativePath of [...diff.added, ...diff.modified]) {
    await copyManagedFile(relativePath, currentStageDir, packageDir);
  }

  for (const relativePath of diff.removed) {
    const livePath = path.join(packageDir, relativePath);
    await fs.rm(livePath, { force: true }).catch(() => {});
    await removeEmptyParentDirs(path.dirname(livePath));
  }

  await mergePackageDependenciesFrom(path.join(currentStageDir, "source-package.json"));
  await ensureCleanDirectory(appliedStageDir);
  for (const relativePath of currentFiles) {
    await copyManagedFile(relativePath, currentStageDir, appliedStageDir);
  }

  for (const metaFile of STAGE_METADATA_FILES) {
    const sourceMetaPath = path.join(currentStageDir, metaFile);
    if (await pathExists(sourceMetaPath)) {
      await fs.copyFile(sourceMetaPath, path.join(appliedStageDir, metaFile));
    }
  }

  const sourceInfoPath = path.join(currentStageDir, ".stage-source.json");
  if (await pathExists(sourceInfoPath)) {
    await fs.copyFile(sourceInfoPath, path.join(appliedStageDir, ".stage-source.json"));
  }

  const summary = hasAppliedBaseline
    ? `${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed`
    : `${currentFiles.length} files seeded as initial upstream baseline`;

  console.log("Applied upstream delta from previous imported baseline to live wired package.");
  console.log(`Summary: ${summary}`);
  console.log(`Previous imported baseline: ${appliedStageDir}`);
  console.log(`New imported upstream: ${currentStageDir}`);
}

async function printStageDiff() {
  if (!(await pathExists(currentStageDir))) {
    throw new Error("No staged upstream UI found. Run stage first.");
  }

  if (!(await pathExists(appliedStageDir))) {
    console.log("No previous imported upstream baseline yet. Run apply once to establish it.");
    return;
  }

  console.log("Diffing previous imported upstream baseline -> newly staged upstream UI.");
  console.log(`FROM ${appliedStageDir}`);
  console.log(`TO   ${currentStageDir}`);

  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "--no-index", "--no-ext-diff", "--", appliedStageDir, currentStageDir],
      { cwd: packageDir, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout) {
      process.stdout.write(stdout);
    }
  } catch (error) {
    if (error.code === 1) {
      if (error.stdout) {
        process.stdout.write(error.stdout);
      }
      return;
    }
    throw error;
  }
}

async function stageSource(sourceArg) {
  const sourceInput = await resolveSourceInput(sourceArg);
  const extractionRoot = sourceInput.endsWith(".zip") ? await extractZip(sourceInput) : sourceInput;
  const sourceRoot = await walkForFile(extractionRoot, path.join("app", "page.tsx"));

  if (!sourceRoot) {
    throw new Error(`Could not locate app/page.tsx inside ${sourceInput}`);
  }

  await writeStageSnapshot(sourceRoot, sourceInput, currentStageDir);
  console.log(`Staged newly imported upstream UI from ${sourceInput}`);
  console.log(`Staged upstream path: ${currentStageDir}`);
  console.log(`Previous imported baseline path: ${appliedStageDir}`);
}

async function main() {
  const { mode, sourceArg } = parseArgs();

  if (mode === "stage") {
    await stageSource(sourceArg);
    return;
  }

  if (mode === "diff") {
    await printStageDiff();
    return;
  }

  if (mode === "apply") {
    await applyCurrentStageToLive();
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
