/* Project identity & normalization — the layer that collapses the broker's
   noisy, multi-source records into one stable project per repo.

   Kept dependency-free (no React, no sibling modules) so it stays pure and
   unit-testable. The live feed fragments one project into many: the same repo
   shows up under its cwd, under an agent-identity title, with node qualifiers
   ("openscout-185"), case variants, and null-cwd ghosts ("empty"). Everything
   here canonicalizes on the repo root and folds the rootless leftovers in. */

export type ProjectIdentity = {
  key: string;
  title: string;
  root: string | null;
  // Short, URL-facing identifier (`talkie`, `pi-scout`) — see slugifyProjectName.
  slug: string;
};

export function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function normalizeProjectRoot(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "") || null;
}

export function dirname(path: string): string | null {
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(0, idx) || "/" : null;
}

export function readableProjectTitle(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function worktreeFamilyFromRoot(root: string | null): { title: string; root: string | null } | null {
  if (!root) return null;
  const containerRoot = worktreeContainerFamilyRoot(root);
  if (containerRoot) {
    return {
      title: readableProjectTitle(basename(containerRoot) ?? "Unscoped"),
      root: containerRoot,
    };
  }

  const leaf = basename(root)?.trim().toLowerCase();
  if (!leaf || leaf === "~") return null;
  const match = leaf.match(/^(.+?)(?:-(?:parity|codex))?-c\d+$/);
  const family = match?.[1];
  if (!family) return null;
  const parent = dirname(root);
  return {
    title: readableProjectTitle(family),
    root: parent ? `${parent}/${family}` : family,
  };
}

function worktreeContainerFamilyRoot(root: string): string | null {
  const normalized = root.replace(/\/+$/, "");
  const siblingContainer = normalized.match(/^(.*)\/([^/]+)-worktrees(?:\/[^/]+)+$/);
  if (siblingContainer?.[1] && siblingContainer[2]) {
    return `${siblingContainer[1]}/${siblingContainer[2]}`;
  }

  const nestedContainer = normalized.match(/^(.*\/[^/]+)\/(?:\.worktrees|worktrees)(?:\/[^/]+)+$/);
  return nestedContainer?.[1] ?? null;
}

export function workspaceRootFromObservedPath(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) return null;

  const localDevMatch = value.match(/^(\/Users\/[^/]+\/dev\/[^/]+)/);
  if (localDevMatch?.[1]) return localDevMatch[1];

  const homeDevMatch = value.match(/^(~\/dev\/[^/]+)/);
  if (homeDevMatch?.[1]) return homeDevMatch[1];

  const claudeProjectMatch = value.match(/\.claude\/projects\/-Users-([^-]+)-dev-([^/]+)/);
  if (claudeProjectMatch?.[1] && claudeProjectMatch[2]) {
    const projectName = claudeProjectMatch[2].split("-packages-")[0] ?? claudeProjectMatch[2];
    return `/Users/${claudeProjectMatch[1]}/dev/${projectName}`;
  }

  return null;
}

// Canonicalize an absolute home path to its "~"-relative form so the SAME repo
// reported two ways — a session's absolute `workspaceRoot`
// ("/Users/art/dev/openscout") and an agent's "~"-relative `projectRoot`
// ("~/dev/openscout") — resolves to ONE root instead of splitting into two
// project tiles. Pure string transform (no env/home lookup), so it stays
// browser-safe; machine-scope already keeps distinct machines from colliding.
function collapseHomePrefix(path: string): string {
  const match = path.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
  if (!match) return path;
  const rest = match[1] ?? "";
  return rest ? `~${rest}` : "~";
}

// Strip a trailing pure-numeric node/clone qualifier from a repo dir so the
// numbered sibling collapses onto its base: "openscout-185" → "openscout".
// Digit-only by design — real variant siblings ("pomo-native", "pomo-tauri")
// keep their identity. Mirrors how projectSlug drops a trailing number off titles.
function stripNodeQualifier(path: string): string {
  const leaf = basename(path);
  if (!leaf) return path;
  const stripped = leaf.replace(/-\d+$/, "");
  if (stripped === leaf || !stripped) return path;
  const parent = dirname(path);
  return parent ? `${parent}/${stripped}` : stripped;
}

// Reduce any cwd / worktree / deep path to the canonical repo root, so every
// record for the same project keys identically. A bare home dir is not a project.
export function canonicalProjectRoot(root: string | null | undefined): string | null {
  const normalized = normalizeProjectRoot(root);
  if (!normalized) return null;
  const family = worktreeFamilyFromRoot(normalized);
  const base = family?.root ?? normalized;
  const observed = collapseHomePrefix(workspaceRootFromObservedPath(base) ?? base);
  const canonical = stripNodeQualifier(observed);
  if (
    canonical === "~" ||
    /^\/(Users|home)\/[^/]+$/.test(canonical) ||
    /^\/(Users|home)$/.test(canonical)
  ) {
    return null;
  }
  return canonical;
}

// Identity-collapsing slug: case/punctuation-insensitive, with a trailing
// node/number qualifier stripped — "Openscout 185" / "openscout-185" → "openscout".
export function projectSlug(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, "");
}

// Short, URL-facing project identifier. Stable + human-readable so the agents
// URL reads `?project=talkie` instead of `?project=root%3A%2FUsers%2Fart%2Fdev…`.
// Kebab-cased from the repo basename, with a trailing node/number qualifier
// stripped to mirror how projectSlug collapses "openscout-185" → "openscout".
export function slugifyProjectName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-\d+$/, "");
}

// Small, stable, dependency-free hash (FNV-1a → base36) used only to break a
// genuine slug collision. Not security-sensitive; just needs to be deterministic.
function slugHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Guarantee the URL slug is injective per canonical project: two distinct roots
// that share a basename ("…/dev/talkie" vs "…/work/talkie") must not collapse to
// one slug. Unique basenames keep their clean one-word slug; only the colliding
// ones get a short stable hash of their identity key appended. Same exact project
// → same slug; different path → different slug.
export function disambiguateProjectSlugs<T extends { slug: string; key: string }>(
  slices: T[],
): void {
  const counts = new Map<string, number>();
  for (const s of slices) counts.set(s.slug, (counts.get(s.slug) ?? 0) + 1);
  for (const s of slices) {
    if ((counts.get(s.slug) ?? 0) > 1) s.slug = `${s.slug}-${slugHash(s.key)}`;
  }
}

export function projectKeyFrom(root: string | null, title: string): string {
  const canonicalRoot = canonicalProjectRoot(root);
  if (canonicalRoot) return `root:${canonicalRoot}`;
  const slug = projectSlug(title);
  return `project:${slug || "unscoped"}`;
}

export function isTemporaryProjectRoot(root: string | null): boolean {
  return Boolean(root?.startsWith("/tmp/"));
}

export function projectIdentity(title: string | null | undefined, root: string | null | undefined): ProjectIdentity {
  const canonicalRoot = canonicalProjectRoot(root);
  const resolvedTitle = canonicalRoot
    ? readableProjectTitle(basename(canonicalRoot) ?? (title?.trim() || "Unscoped"))
    : (title?.trim() || "Unscoped");
  return {
    key: projectKeyFrom(canonicalRoot, resolvedTitle),
    title: resolvedTitle,
    root: canonicalRoot,
    slug: slugifyProjectName(basename(canonicalRoot) ?? resolvedTitle) || "unscoped",
  };
}

/* ── rootless reconciliation ──────────────────────────────────────────────
   Rootless records (a scout conversation with no cwd, a null-cwd transcript)
   must not mint their own projects. Fold them into the rooted project whose
   slug matches; drop the unattributable junk. We never fuzzy-merge two records
   that each carry a distinct repo root. Operates structurally on any slice with
   the fields below, so the heavy ProjectSlice type can stay in model.ts. */

export interface ReconcilableSlice {
  key: string;
  title: string;
  root: string | null;
  agents: unknown[];
  scoutSessions: unknown[];
  nativeSessions: unknown[];
  workflows: unknown[];
}

const JUNK_PROJECT_TITLES = new Set(["empty", "unknown", "unscoped", "untitled", "general"]);

function mergeProjectSlice<T extends ReconcilableSlice>(target: T, extra: T): void {
  target.agents.push(...extra.agents);
  target.scoutSessions.push(...extra.scoutSessions);
  target.nativeSessions.push(...extra.nativeSessions);
  target.workflows.push(...extra.workflows);
}

export function reconcileRootlessSlices<T extends ReconcilableSlice>(map: Map<string, T>): void {
  const rootedBySlug = new Map<string, T>();
  for (const slice of map.values()) {
    if (!slice.root) continue;
    const slug = projectSlug(basename(slice.root) ?? slice.title);
    if (slug && !rootedBySlug.has(slug)) rootedBySlug.set(slug, slice);
  }
  for (const [key, slice] of [...map.entries()]) {
    if (slice.root) continue;
    const slug = projectSlug(slice.title);
    const target = slug ? rootedBySlug.get(slug) : undefined;
    if (target) {
      mergeProjectSlice(target, slice);
      map.delete(key);
    } else if (
      !slug ||
      JUNK_PROJECT_TITLES.has(slice.title.trim().toLowerCase()) ||
      // a rootless slice with no agent and no conversation is an unplaceable
      // ghost (orphan home-dir transcripts) — not a project
      (slice.agents.length === 0 && slice.scoutSessions.length === 0)
    ) {
      map.delete(key);
    }
  }
}
