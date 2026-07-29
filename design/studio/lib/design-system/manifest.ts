/**
 * Component manifest — the schema the design studio uses to graduate a study
 * into a component the main project can adopt.
 *
 * Why this exists
 * ───────────────
 * The studio has ~50 components and ~120 studies. Some are one-off sketches
 * for a single view; a few are finished, interactive, and genuinely ready to be
 * dropped into `packages/web`. Nothing in the tree tells you which is which.
 * An agent asked "is there already a model picker?" has to read the folder and
 * guess, and the honest answer to "what props does it take" is "open the file".
 *
 * A manifest is the component's own answer to the questions somebody — human
 * or agent — asks before adopting it:
 *
 *   Is there a component for X?        → id, name, summary, keywords
 *   Is it finished?                    → status, and it has to be earned
 *   How do I use it?                   → import, props, slots, examples
 *   What happens in the ugly cases?    → states
 *   Can I drive it from a keyboard?    → keyboard, a11y
 *   Where does its data come from?     → data
 *   Is it already in prod, and synced?  → port
 *
 * Manifests live beside their component as `<Name>.manifest.ts`, never in a
 * central file. A sidecar changes in the same diff as the thing it describes;
 * a central registry drifts the first time somebody is in a hurry.
 *
 * `status: "graduated"` is not a label you write, it is a bar you clear —
 * `auditManifest()` below is the bar, and the registry refuses to call a
 * component graduated while it reports errors.
 */

export type ComponentStatus =
  /** A sketch. Lives in the studio, expect it to move under you. */
  | "draft"
  /** Complete and interactive, but the contract is still settling. */
  | "candidate"
  /** Contract is stable and documented. Safe to adopt. */
  | "graduated";

export type PortStatus =
  /** Studio only — no production counterpart yet. */
  | "none"
  /** Ported, but the production copy is missing capabilities. */
  | "partial"
  /** Ported and the contracts agree. */
  | "synced"
  /** Ported, then the two diverged. `drift` says how. */
  | "drifted";

export interface PropSpec {
  name: string;
  /** As written in the source, e.g. `"rail" | "bands"`. */
  type: string;
  required?: boolean;
  /** Literal default, as source. Omit when there is none. */
  default?: string;
  /** One sentence. What it changes, not what it is. */
  summary: string;
}

export interface SlotSpec {
  name: string;
  type: string;
  summary: string;
}

/**
 * A state worth knowing about before adoption: loading, empty, error,
 * disabled, over-long content. `trigger` has to be concrete enough to
 * reproduce — "pass status='loading'", not "while loading".
 */
export interface StateSpec {
  name: string;
  trigger: string;
  behavior: string;
}

export interface KeySpec {
  /** e.g. `"↑ / ↓"`, `"Enter"`, `"Escape"`. */
  keys: string;
  action: string;
  /** Where the binding applies, when it is not the whole component. */
  scope?: string;
}

export interface ExampleSpec {
  title: string;
  /** Copy-pasteable. The first example must run with no other setup. */
  code: string;
  summary?: string;
}

export interface DataSpec {
  /** Repo-relative module holding the data contract. */
  module: string;
  summary: string;
  /** Where the real thing comes from in production, if it differs. */
  production?: string;
}

export interface PortSpec {
  /** Repo-relative path of the production counterpart. */
  target?: string;
  status: PortStatus;
  /** One sentence per divergence, each naming both sides. */
  drift?: string[];
  notes?: string;
  /**
   * Short content hashes of the files this drift list was checked against,
   * keyed by repo-relative path. Drift is a claim about two files at one
   * moment, and nobody editing `packages/web` will think to update a studio
   * sidecar — so `ds verify` compares these and warns when the ground moved.
   * Regenerate with `bun run ds hashes <id>`.
   */
  verifiedAgainst?: Record<string, string>;
}

export interface ComponentManifest {
  /** Stable kebab-case key. This is what search matches and what URLs use. */
  id: string;
  name: string;
  status: ComponentStatus;
  /** One sentence: what it is and what it replaces. */
  summary: string;
  /**
   * What somebody would type looking for this, including the words we do NOT
   * use. An agent searching "dropdown" should still find a picker.
   */
  keywords: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  import: { from: string; symbols: string[] };
  props: PropSpec[];
  slots?: SlotSpec[];
  states?: StateSpec[];
  keyboard?: KeySpec[];
  a11y?: string[];
  data?: DataSpec;
  dependencies?: {
    components?: string[];
    /** CSS custom properties the component reads. Port blockers live here. */
    tokens?: string[];
    packages?: string[];
  };
  examples: ExampleSpec[];
  /** Studio route where it is exercised live. */
  atom?: string;
  /** Repo-relative source files, component first. */
  source: string[];
  port?: PortSpec;
}

// ── Audit ────────────────────────────────────────────────────────────────────

export interface AuditIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

/**
 * The graduation bar.
 *
 * Errors block `graduated`. Warnings never block anything — they are pressure,
 * not a gate, and `meetsStatus()` ignores them on purpose: a bar that fails on
 * advisory findings gets satisfied by writing noise to silence it rather than by
 * fixing anything. The rules encode what has actually bitten us
 * porting studio work into the web client: a component with no minimal example
 * gets adopted wrong, one with undocumented keyboard behaviour gets adopted
 * without it, and one whose token dependencies are unlisted gets adopted and
 * renders invisible against a different palette.
 */
export function auditManifest(manifest: ComponentManifest): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const error = (field: string, message: string) =>
    issues.push({ level: "error", field, message });
  const warn = (field: string, message: string) =>
    issues.push({ level: "warning", field, message });

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id)) {
    error("id", "must be kebab-case — it is used as a search key and a URL segment");
  }
  if (manifest.summary.trim().split(/\s+/).length < 5) {
    error("summary", "one full sentence, not a label");
  }
  if (manifest.keywords.length < 3) {
    warn("keywords", "under three keywords is hard to find; include synonyms we do not use");
  }
  if (manifest.whenToUse.length === 0) {
    error("whenToUse", "required — adoption starts here");
  }
  if (manifest.whenNotToUse.length === 0) {
    warn("whenNotToUse", "a component with no stated limits gets used where it does not fit");
  }
  if (manifest.props.length === 0) {
    warn("props", "no props documented");
  }
  for (const prop of manifest.props) {
    // Only literal unions and booleans are warned about. Those are the props
    // where the default is a fact the adopter cannot guess — `variant`
    // silently being "rail" changes the whole panel. A callback or an object
    // value has no meaningful default and demanding one just trains people to
    // write `default: "undefined"` to silence the audit.
    const needsDefault =
      !prop.required &&
      !prop.default &&
      (prop.type === "boolean" || (prop.type.includes('"') && prop.type.includes("|")));
    if (needsDefault) {
      warn(`props.${prop.name}`, "optional prop with a fixed option set but no documented default");
    }
    if (!prop.summary.trim()) {
      error(`props.${prop.name}`, "missing summary");
    }
  }
  if (manifest.examples.length === 0) {
    error("examples", "required — the first must run with no other setup");
  }
  if (manifest.source.length === 0) {
    error("source", "required");
  }
  if (!manifest.atom) {
    warn("atom", "no studio route — nobody can see it work before adopting it");
  }
  if (!manifest.port) {
    warn("port", "port status unstated; adoption cannot tell if prod already has this");
  }
  if (manifest.port?.status === "drifted" && !manifest.port.drift?.length) {
    error("port.drift", "marked drifted but the divergences are not named");
  }
  if (!manifest.states?.length) {
    warn("states", "loading, empty, error and disabled are where ports go wrong");
  }
  if (!manifest.dependencies?.tokens?.length) {
    warn(
      "dependencies.tokens",
      "unlisted token dependencies are the usual cause of a port rendering invisible",
    );
  }
  return issues;
}

/** True when the manifest clears the bar for the status it claims. */
export function meetsStatus(manifest: ComponentManifest): boolean {
  if (manifest.status !== "graduated") return true;
  return !auditManifest(manifest).some((issue) => issue.level === "error");
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchHit {
  manifest: ComponentManifest;
  score: number;
  /** Which fields matched, so a caller can explain the hit. */
  matched: string[];
  /** Fraction of the query's content words that hit, 0–1. */
  coverage: number;
}

/**
 * Dropped before matching. An agent asking for "a dropdown for choosing which
 * model runs this" is describing a need in a sentence, not typing keywords, and
 * every one of these words would otherwise have to appear in a manifest for the
 * query to return anything.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "to", "in", "on", "with", "and", "or", "is",
  "are", "was", "be", "it", "this", "that", "which", "what", "how", "do", "does",
  "i", "we", "you", "my", "our", "can", "should", "would", "need", "want",
  "some", "any", "there", "here", "when", "where", "let", "lets", "me", "us",
  "component", "components", "ui", "widget", "thing", "something", "runs", "run",
  "using", "use", "used", "make", "get", "have", "has", "one", "way", "like",
]);

const FIELD_WEIGHTS: [keyof ComponentManifest | "keyword" | "text", number][] = [
  ["id", 12],
  ["name", 10],
  ["keyword", 8],
  ["summary", 4],
  ["text", 1],
];

/**
 * Coverage-weighted scoring.
 *
 * Not token-AND. Requiring every term to hit reads as principled and fails the
 * one query that matters: an agent describing a need in a sentence gets nothing
 * back, because no manifest contains the word "choosing". Instead, stopwords are
 * dropped, any remaining term that hits contributes its best field weight, and
 * the total is scaled by how much of the query was covered — so a precise query
 * still outranks a vague one without the vague one returning empty.
 *
 * Substring, not fuzzy: "picker" must not rank "Ticker" above the thing actually
 * called a picker. Trailing plurals are folded so "pickers" still finds it.
 */
export function searchManifests(
  manifests: ComponentManifest[],
  query: string,
): SearchHit[] {
  const raw = query.trim().toLowerCase().split(/[\s,/]+/).filter(Boolean);
  const terms = raw.filter((term) => term.length > 1 && !STOPWORDS.has(term));
  if (terms.length === 0) {
    return manifests.map((manifest) => ({
      manifest,
      score: 0,
      matched: [],
      coverage: 0,
    }));
  }

  const hits: SearchHit[] = [];
  for (const manifest of manifests) {
    const haystack = {
      id: manifest.id.toLowerCase(),
      name: manifest.name.toLowerCase(),
      keyword: manifest.keywords.join(" ").toLowerCase(),
      summary: manifest.summary.toLowerCase(),
      text: [
        ...manifest.whenToUse,
        ...manifest.whenNotToUse,
        ...manifest.props.map((prop) => `${prop.name} ${prop.summary}`),
        ...(manifest.states ?? []).map((state) => `${state.name} ${state.behavior}`),
        ...manifest.source,
      ]
        .join(" ")
        .toLowerCase(),
    } as Record<string, string>;

    let score = 0;
    const matched = new Set<string>();
    let hitTerms = 0;

    for (const term of terms) {
      // Fold a trailing plural so "pickers" and "models" still land.
      const variants = term.endsWith("s") && term.length > 3 ? [term, term.slice(0, -1)] : [term];
      let best = 0;
      let bestField = "";
      for (const [field, weight] of FIELD_WEIGHTS) {
        const text = haystack[field as string];
        if (!text) continue;
        for (const variant of variants) {
          if (!text.includes(variant)) continue;
          // Whole-word hits beat incidental substring hits.
          const exact = new RegExp(`\\b${escapeRegExp(variant)}\\b`).test(text);
          const value = exact ? weight * 1.5 : weight;
          if (value > best) {
            best = value;
            bestField = field as string;
          }
        }
      }
      if (best === 0) continue;
      score += best;
      hitTerms += 1;
      matched.add(bestField);
    }

    if (hitTerms === 0) continue;
    const coverage = hitTerms / terms.length;
    // Scaled, not gated: a query where every word landed beats one where two
    // words out of six did, but the vague one still comes back with something.
    score = score * (0.4 + 0.6 * coverage);
    // A graduated component outranks a draft at equal relevance.
    score += manifest.status === "graduated" ? 3 : manifest.status === "candidate" ? 1 : 0;
    hits.push({
      manifest,
      score: Math.round(score * 10) / 10,
      matched: [...matched],
      coverage: Math.round(coverage * 100) / 100,
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
