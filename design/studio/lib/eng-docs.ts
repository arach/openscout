/**
 * Filesystem-backed reader for `docs/eng/*.md`.
 *
 * Unlike `plans/` (frontmatter-based), eng docs are plain markdown with
 * a `# Title` H1 and an SCO-conventional set of H2 sections:
 *
 *   # SCO-NNN: Title
 *
 *   ## Status
 *   Proposed. | Accepted (date). | Implemented. | Spike complete. | ...
 *
 *   ## Proposal ID
 *   `sco-NNN`
 *
 *   ## Intent
 *   …multi-paragraph summary…
 *
 *   ## Context | ## Proposal | …
 *
 * The loader extracts the H2 sections worth promoting into the page's
 * data-sheet header (Status, Intent, Proposal ID) and strips them from
 * the body so the article doesn't double-print.
 *
 * Family detection: docs sharing an SCO number (e.g. sco-039 has a
 * proposal + implementation-plan + review-2026-05-21) collapse under
 * one sidebar entry, with siblings surfaced as a "Related" row in the
 * data-sheet header of any one of them.
 */

import fs from "node:fs";
import path from "node:path";
import type { StudioPage, StudioStatus } from "./studio-pages";

const DOCS_ENG_DIR = path.resolve(process.cwd(), "..", "..", "docs", "eng");
const REPO_REL = "docs/eng";

export interface EngHeaderSection {
  /** Uppercase label rendered in the data-sheet grid. */
  label: string;
  /** Markdown body of the section, without the `##` heading. */
  body: string;
}

export interface EngSibling {
  slug: string;
  title: string;
  kind: "proposal" | "implementation-plan" | "review" | "other";
}

export interface EngDoc {
  slug: string;
  /** Display title (SCO prefix stripped). */
  title: string;
  /** Original H1 unchanged — for fallbacks. */
  rawTitle: string;
  /** `sco-NNN` if the filename starts with one, else null. */
  scoId: string | null;
  /** Family key used by sidebar grouping. */
  family: string;
  /** "proposal" | "implementation-plan" | "review" | "other" — derived from filename. */
  kind: EngSibling["kind"];
  status: StudioStatus;
  /** Freeform status text from the doc, lowercased ("proposed.", "spike complete (2026-05-23)."). */
  statusRaw: string;
  /** First substantive paragraph from `## Intent` (or first prose if no Intent). Used as the index card blurb. */
  blurb: string | null;
  /** ISO mtime. */
  updatedAt: string;
  /** Sections lifted into the data-sheet header (Summary, Intent, Proposal ID, Status detail). */
  headerSections: EngHeaderSection[];
  /** Other docs sharing the same SCO family, sorted by kind precedence. */
  siblings: EngSibling[];
  /** Markdown body with the lifted sections + the title line removed. */
  body: string;
  /** Path relative to repo root — surfaced as `source:` in the page strip. */
  repoRelPath: string;
}

/** Metadata-only variant for index/sidebar consumers. */
export type EngDocMeta = Omit<EngDoc, "body" | "headerSections">;

function isMarkdown(name: string): boolean {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  return name.endsWith(".md");
}

function extractRawTitle(body: string, fallback: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^#\s+(.+)$/.exec(trimmed);
    if (m) return m[1].trim();
    break;
  }
  return fallback;
}

function stripScoPrefix(title: string): {
  display: string;
  scoId: string | null;
} {
  const m = /^SCO-(\d+)\s*[:—-]\s*(.+)$/i.exec(title);
  if (!m) return { display: title, scoId: null };
  return {
    display: m[2].trim(),
    scoId: `sco-${m[1].padStart(3, "0").toLowerCase()}`,
  };
}

function familyFromFilename(filename: string): string {
  const m = /^(sco-\d{3})/.exec(filename);
  return m ? m[1] : filename.replace(/\.md$/, "");
}

function kindFromFilename(filename: string): EngSibling["kind"] {
  if (/-implementation-plan\.md$/i.test(filename)) return "implementation-plan";
  if (/-review(-|\.)/i.test(filename)) return "review";
  if (/-proposal\.md$/i.test(filename)) return "proposal";
  return "other";
}

const KIND_RANK: Record<EngSibling["kind"], number> = {
  proposal: 0,
  other: 1,
  "implementation-plan": 2,
  review: 3,
};

/** Walk the body, find every `## Heading`, classify, lift, strip.
 *  Returns header sections in the configured display order (not source
 *  order) and the body stripped of those sections. */
/** Sections worth lifting into the header data sheet. Kept narrow on
 *  purpose — only short, prose-shaped sections promote cleanly.
 *  Goal/Decision/etc. often contain tables, bullet lists, or multi-
 *  paragraph specs that need the body's full reading width. */
const HEADER_PATTERNS: Array<{ label: string; match: RegExp }> = [
  { label: "Status", match: /^status(?:\s|$)/i },
  { label: "Summary", match: /^(summary|intent|overview|tldr|tl;dr)\s*$/i },
];

interface H2Match {
  start: number;
  bodyStart: number;
  text: string;
}

function findH2Headings(input: string): H2Match[] {
  const re = /^##\s+(.+?)\s*$/gm;
  const out: H2Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const lineEnd = input.indexOf("\n", m.index);
    out.push({
      start: m.index,
      bodyStart: lineEnd === -1 ? input.length : lineEnd + 1,
      text: m[1],
    });
  }
  return out;
}

function labelFor(headingText: string): string | null {
  for (const p of HEADER_PATTERNS) {
    if (p.match.test(headingText.trim())) return p.label;
  }
  return null;
}

interface SectionMatch {
  start: number;
  bodyStart: number;
  end: number;
  label: string;
}

function splitOutHeaderSections(input: string): {
  headerSections: EngHeaderSection[];
  rest: string;
} {
  const headings = findH2Headings(input);
  const matched: SectionMatch[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const next = headings[i + 1];
    const label = labelFor(h.text);
    if (!label) continue;
    matched.push({
      start: h.start,
      bodyStart: h.bodyStart,
      end: next ? next.start : input.length,
      label,
    });
  }

  if (matched.length === 0) return { headerSections: [], rest: input };

  let rest = "";
  let cursor = 0;
  for (const m of matched) {
    rest += input.slice(cursor, m.start);
    cursor = m.end;
  }
  rest += input.slice(cursor);
  rest = rest.replace(/^\s*\n+/, "").replace(/\n{3,}/g, "\n\n");

  const order = new Map(
    HEADER_PATTERNS.map((p, i) => [p.label, i] as const),
  );
  matched.sort(
    (a, b) =>
      (order.get(a.label) ?? Infinity) - (order.get(b.label) ?? Infinity),
  );

  const headerSections: EngHeaderSection[] = matched.map((m) => ({
    label: m.label,
    body: input.slice(m.bodyStart, m.end).trim(),
  }));

  return { headerSections, rest };
}

function mapStatus(raw: string): StudioStatus {
  const r = raw.toLowerCase();
  if (!r) return "draft";
  if (/supersed|deprecat|shelved|abandon|withdraw/.test(r)) return "shelved";
  if (/implement|ship|complete|accept|done|landed|merged/.test(r))
    return "shipped";
  if (/in[\s-]?flight|in[\s-]?progress|building|underway|active/.test(r))
    return "in-flight";
  if (/spike|sketch|concept|explorator/.test(r)) return "concept";
  if (/propos|draft|review/.test(r)) return "draft";
  return "draft";
}

function firstStatusLine(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function extractBlurb(intentBody: string, fallbackBody: string): string | null {
  const source = intentBody.trim() || fallbackBody;
  for (const paragraph of source.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (/^##\s+/.test(trimmed)) break;
    if (/^[>*\-`|]/.test(trimmed)) continue;
    if (/^```/.test(trimmed)) continue;
    const para = trimmed.replace(/\s+/g, " ");
    return para.length > 240 ? para.slice(0, 237) + "…" : para;
  }
  return null;
}

function stripTitleLine(raw: string): string {
  return raw.replace(/^#\s+.*?\n+/, "");
}

interface ParsedDoc {
  slug: string;
  filename: string;
  rawTitle: string;
  title: string;
  scoId: string | null;
  family: string;
  kind: EngSibling["kind"];
  status: StudioStatus;
  statusRaw: string;
  blurb: string | null;
  updatedAt: string;
  headerSections: EngHeaderSection[];
  body: string;
}

function parseDoc(filename: string, raw: string, mtime: Date): ParsedDoc {
  const slug = filename.replace(/\.md$/, "");
  const rawTitle = extractRawTitle(raw, slug);
  const { display, scoId: scoFromTitle } = stripScoPrefix(rawTitle);
  const scoId =
    scoFromTitle ?? (/^sco-(\d{3})/.exec(filename)?.[0] ?? null);
  const family = familyFromFilename(filename);
  const kind = kindFromFilename(filename);

  const stripped = stripTitleLine(raw);
  const { headerSections, rest } = splitOutHeaderSections(stripped);

  const statusSection = headerSections.find((s) => s.label === "Status");
  const intentSection = headerSections.find((s) => s.label === "Summary");

  const statusRaw = statusSection ? firstStatusLine(statusSection.body) : "";
  const status = mapStatus(statusRaw);
  const blurb = extractBlurb(intentSection?.body ?? "", rest);

  return {
    slug,
    filename,
    rawTitle,
    title: display,
    scoId,
    family,
    kind,
    status,
    statusRaw,
    blurb,
    updatedAt: mtime.toISOString(),
    headerSections,
    body: rest,
  };
}

function readParsed(filename: string): ParsedDoc | null {
  const filePath = path.join(DOCS_ENG_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    return parseDoc(filename, raw, stat.mtime);
  } catch {
    return null;
  }
}

/** All parsed docs — kept private; consumers go through `listEngDocs`
 *  / `getEngDoc` which package metadata or full doc shapes. */
function readAllParsed(): ParsedDoc[] {
  if (!engDocsDirExists()) return [];
  const files = fs
    .readdirSync(DOCS_ENG_DIR)
    .filter(isMarkdown)
    .filter((f) => f.toLowerCase() !== "readme.md");
  const out: ParsedDoc[] = [];
  for (const f of files) {
    const p = readParsed(f);
    if (p) out.push(p);
  }
  return out;
}

function familyMap(docs: ParsedDoc[]): Map<string, ParsedDoc[]> {
  const m = new Map<string, ParsedDoc[]>();
  for (const d of docs) {
    const list = m.get(d.family) ?? [];
    list.push(d);
    m.set(d.family, list);
  }
  for (const list of m.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return a.slug.localeCompare(b.slug);
    });
  }
  return m;
}

function buildSiblings(self: ParsedDoc, family: ParsedDoc[]): EngSibling[] {
  return family
    .filter((d) => d.slug !== self.slug)
    .map((d) => ({ slug: d.slug, title: d.title, kind: d.kind }));
}

function scoNum(slug: string): number | null {
  const m = /^sco-(\d{3})/.exec(slug);
  return m ? Number(m[1]) : null;
}

export function engDocsDirExists(): boolean {
  try {
    return fs.statSync(DOCS_ENG_DIR).isDirectory();
  } catch {
    return false;
  }
}

/** Sorted SCO-numbered first (ascending), then notes alphabetically. */
export function listEngDocs(): EngDocMeta[] {
  const parsed = readAllParsed();
  const families = familyMap(parsed);

  const metas: EngDocMeta[] = parsed.map((d) => {
    const siblings = buildSiblings(d, families.get(d.family) ?? []);
    return {
      slug: d.slug,
      title: d.title,
      rawTitle: d.rawTitle,
      scoId: d.scoId,
      family: d.family,
      kind: d.kind,
      status: d.status,
      statusRaw: d.statusRaw,
      blurb: d.blurb,
      updatedAt: d.updatedAt,
      siblings,
      repoRelPath: `${REPO_REL}/${d.slug}.md`,
    };
  });

  return metas.sort((a, b) => {
    const aNum = scoNum(a.slug);
    const bNum = scoNum(b.slug);
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return a.slug.localeCompare(b.slug);
    }
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return a.slug.localeCompare(b.slug);
  });
}

export function getEngDoc(slug: string): EngDoc | null {
  const parsed = readParsed(`${slug}.md`);
  if (!parsed) return null;
  const allParsed = readAllParsed();
  const families = familyMap(allParsed);
  const siblings = buildSiblings(parsed, families.get(parsed.family) ?? []);
  return {
    slug: parsed.slug,
    title: parsed.title,
    rawTitle: parsed.rawTitle,
    scoId: parsed.scoId,
    family: parsed.family,
    kind: parsed.kind,
    status: parsed.status,
    statusRaw: parsed.statusRaw,
    blurb: parsed.blurb,
    updatedAt: parsed.updatedAt,
    headerSections: parsed.headerSections,
    siblings,
    body: parsed.body,
    repoRelPath: `${REPO_REL}/${parsed.slug}.md`,
  };
}

export function getEngReadme(): string | null {
  if (!engDocsDirExists()) return null;
  try {
    return fs.readFileSync(path.join(DOCS_ENG_DIR, "README.md"), "utf8");
  } catch {
    return null;
  }
}

/** Status palette — fg/bg point at CSS vars that auto-switch with
 *  the active theme (see `app/globals.css`). Consumers should pass the
 *  returned strings into inline `style` (`color: tone.fg`,
 *  `background: tone.bg`) so the colors track the theme without a
 *  re-render. The accent dot uses the same fg color for a halo. */
export function statusPalette(status: StudioStatus): {
  fg: string;
  bg: string;
  label: string;
} {
  switch (status) {
    case "shipped":
      return { fg: "var(--status-ok-fg)", bg: "var(--status-ok-bg)", label: "SHIPPED" };
    case "in-flight":
      return { fg: "var(--status-warn-fg)", bg: "var(--status-warn-bg)", label: "IN-FLIGHT" };
    case "concept":
      return { fg: "var(--status-info-fg)", bg: "var(--status-info-bg)", label: "CONCEPT" };
    case "shelved":
      return { fg: "var(--status-error-fg)", bg: "var(--status-error-bg)", label: "SHELVED" };
    case "draft":
      return { fg: "var(--status-neutral-fg)", bg: "var(--status-neutral-bg)", label: "DRAFT" };
  }
}

/** Convert eng metas → StudioPage entries the sidebar can render.
 *  Only "primary" docs (proposal or the only-doc-for-the-family) get
 *  promoted; sibling implementation-plans + reviews show up inside the
 *  EngDocHeader's Related row instead of cluttering the sidebar. */
export function engDocsToStudioPages(metas: EngDocMeta[]): StudioPage[] {
  // First doc per family wins (KIND_RANK already sorted proposal first).
  const seen = new Set<string>();
  const out: StudioPage[] = [];
  for (const d of metas) {
    if (seen.has(d.family)) continue;
    seen.add(d.family);
    out.push({
      href: `/eng/${d.slug}`,
      label: d.scoId ? `${d.scoId.toUpperCase()} · ${d.title}` : d.title,
      bucket: "eng",
      family: d.family,
      status: d.status,
      source: [d.repoRelPath],
      blurb: d.blurb ?? undefined,
      updatedAt: d.updatedAt,
    });
  }
  return out;
}
