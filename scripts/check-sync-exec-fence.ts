import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

type AllowCategory = "boot" | "cli" | "build-script" | "test" | "imperative";
type AllowEntry = {
  path: string;
  symbol: "execFileSync" | "execSync" | "spawnSync" | "Bun.spawnSync";
  category: AllowCategory;
  reason: string;
  owner: string;
};

const ROOT = process.cwd();
const SCAN_ROOTS = ["packages", "apps"];
const SYMBOLS = ["execFileSync", "execSync", "spawnSync", "Bun.spawnSync"] as const;
const CATEGORIES = new Set<AllowCategory>(["boot", "cli", "build-script", "test", "imperative"]);

function normalizePath(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).join("/");
}

async function walk(directory: string, out: string[] = []): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === ".next") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/u.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function validateAllowlist(value: unknown): AllowEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("sync exec allowlist must be an array");
  }
  const entries: AllowEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new Error("allowlist entries must be objects");
    }
    const entry = raw as Partial<AllowEntry>;
    if (!entry.path || !entry.symbol || !entry.category || !entry.reason || !entry.owner) {
      throw new Error(`invalid allowlist entry: ${JSON.stringify(raw)}`);
    }
    if (!SYMBOLS.includes(entry.symbol)) {
      throw new Error(`invalid allowlist symbol ${entry.symbol} for ${entry.path}`);
    }
    if (!CATEGORIES.has(entry.category)) {
      throw new Error(`invalid allowlist category ${entry.category} for ${entry.path}`);
    }
    const normalized: AllowEntry = {
      path: normalizePath(entry.path),
      symbol: entry.symbol,
      category: entry.category,
      reason: entry.reason.trim(),
      owner: entry.owner.trim(),
    };
    const key = `${normalized.path}\u0000${normalized.symbol}`;
    if (seen.has(key)) {
      throw new Error(`duplicate allowlist entry for ${normalized.path} ${normalized.symbol}`);
    }
    seen.add(key);
    entries.push(normalized);
  }
  return entries;
}

function lineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const allowlistRaw = JSON.parse(await readFile(join(ROOT, "scripts", "sync-exec-allowlist.json"), "utf8")) as unknown;
const allowlist = validateAllowlist(allowlistRaw);
const allowed = new Set(allowlist.map((entry) => `${entry.path}\u0000${entry.symbol}`));

const files = (await Promise.all(SCAN_ROOTS.map((root) => walk(join(ROOT, root))))).flat();
const violations: string[] = [];
const observed = new Set<string>();

for (const file of files) {
  const rel = normalizePath(relative(ROOT, file));
  const source = await readFile(file, "utf8");
  for (const symbol of SYMBOLS) {
    const escaped = symbol.replace(".", "\\.");
    const pattern = new RegExp(`(?<![A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$])`, "gu");
    for (const match of source.matchAll(pattern)) {
      const key = `${rel}\u0000${symbol}`;
      observed.add(key);
      if (!allowed.has(key)) {
        violations.push(`${rel}:${lineNumber(source, match.index ?? 0)} uses ${symbol} without scripts/sync-exec-allowlist.json`);
      }
    }
  }
}

const stale = [...allowed].filter((key) => !observed.has(key));
if (stale.length > 0) {
  violations.push(
    ...stale.map((key) => {
      const [path, symbol] = key.split("\u0000");
      return `${path} allowlists ${symbol} but no matching usage was found`;
    }),
  );
}

if (violations.length > 0) {
  console.error("Sync exec fence failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(`Sync exec fence passed (${observed.size} allowlisted symbol/file pairs).`);
