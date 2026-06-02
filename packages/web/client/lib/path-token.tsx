import { useScout } from "../scout/Provider.tsx";

/* ── Filepath detection ──────────────────────────────────────────────────
 *
 * Matches paths likely to be filesystem references:
 *   - absolute paths starting with `/` (e.g. `/Users/arach/...`)
 *   - home-relative paths starting with `~/`
 *   - rooted relative paths (`./foo`, `../foo`)
 *   - file-like tokens with a recognized extension and at least one `/`
 *     (e.g. `packages/web/client/app.css`)
 *
 * Tokens with surrounding whitespace boundaries are required so this never
 * eats things like `/release/v1/api` inside a sentence about API routes.
 */
const FILE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "md", "mdx", "txt", "log",
  "json", "jsonc", "yaml", "yml", "toml",
  "css", "scss", "html", "htm",
  "sh", "py", "rb", "go", "rs", "swift", "kt", "java", "c", "cpp", "h",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif",
  "env", "conf", "ini", "gitignore",
  "sql", "xml",
];

const EXT_PATTERN = FILE_EXTENSIONS.join("|");
const EXT_TAIL_RE = new RegExp(`\\.(?:${EXT_PATTERN})(?:$|[?#])`, "i");

// Known absolute-path prefixes — anything outside these is treated as a
// slug/logical identifier (e.g. `/deck/talkie/frames`) unless it ends in
// a known file extension. This avoids false-positives on prose paths.
const KNOWN_ABS_PREFIX = /^(?:\/Users\/|\/home\/|\/Volumes\/|\/var\/|\/etc\/|\/opt\/|\/tmp\/|\/private\/|\/mnt\/|\/Applications\/|\/usr\/|\/Library\/)/u;

const RAW_PATH_RE =
  /(?:^|[\s(\[`'"])((?:~\/|\.\/|\.\.\/|\/)[A-Za-z0-9._/\-]+|[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)(:\d+(?:-\d+)?)?/g;

export type PathRange = {
  /** First line (1-indexed). */
  start: number;
  /** Last line (1-indexed, inclusive). Absent when the ref points at a single line. */
  end?: number;
};

export type PathMatch = {
  /** Index in the source string where the matched token (path + optional range) starts. */
  start: number;
  /** Index just past the end of the matched token. */
  end: number;
  /** The path portion of the token, with any trailing prose punctuation stripped. */
  path: string;
  /** Parsed `:N` or `:N-M` suffix, if present. */
  range?: PathRange;
  /** Raw token as it appears in the source (path + ":start-end" suffix when present). */
  raw: string;
};

/** Does this token look like a real filesystem path (vs a slug/route)? */
function isFilesystemPath(token: string): boolean {
  // Home-relative or workspace-relative — always treat as a path.
  if (token.startsWith("~/") || token.startsWith("./") || token.startsWith("../")) {
    return true;
  }
  // Absolute path: must either start with a known FS prefix or end in a real ext.
  if (token.startsWith("/")) {
    return KNOWN_ABS_PREFIX.test(token) || EXT_TAIL_RE.test(token);
  }
  // Relative-looking token (e.g. `packages/web/foo.ts`): require an extension
  // and at least one path separator (already required by the regex).
  return EXT_TAIL_RE.test(token);
}

/** Parse a `:N` or `:N-M` suffix (with leading colon) into a structured range. */
function parseRangeSuffix(suffix: string | undefined): PathRange | undefined {
  if (!suffix) return undefined;
  const m = /^:(\d+)(?:-(\d+))?$/u.exec(suffix);
  if (!m) return undefined;
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start < 1) return undefined;
  if (m[2] === undefined) return { start };
  const end = Number(m[2]);
  if (!Number.isFinite(end) || end < start) return undefined;
  return { start, end };
}

/** Find all filepath-like tokens in the given text. Non-overlapping matches. */
export function findPathMatches(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  const re = new RegExp(RAW_PATH_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const capturedPath = m[1];
    if (!capturedPath) continue;
    const path = capturedPath.replace(/[.,;:!?]+$/u, "");
    if (!path || !isFilesystemPath(path)) continue;
    const range = parseRangeSuffix(m[2]);
    const rangeSuffix = range ? (m[2] ?? "") : "";
    const captureOffset = m[0].indexOf(capturedPath);
    if (captureOffset < 0) continue;
    const start = m.index + captureOffset;
    const end = start + path.length + rangeSuffix.length;
    const raw = path + rangeSuffix;
    out.push({ start, end, path, range, raw });
  }
  return out;
}

/** Crude check: does this path look like an image? */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|avif)(?:$|[?#])/iu.test(path);
}

/** Crude check: does this path look like a directory (trailing slash or no extension)? */
export function isDirectoryLikePath(path: string): boolean {
  if (path.endsWith("/")) return true;
  const last = path.split("/").pop() ?? "";
  return !last.includes(".") && !path.startsWith("./") && !path.startsWith("../");
}

/** Tiny inline icon for the path token. */
function PathIcon({ kind }: { kind: "file" | "image" | "dir" }) {
  if (kind === "dir") {
    return (
      <svg
        className="s-path-token-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M2 5a1 1 0 0 1 1-1h3.5l1.5 1.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg
        className="s-path-token-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <circle cx="6" cy="7" r="1" />
        <path d="m3 12 3.5-3 2.5 2 3-2.5L14 11" />
      </svg>
    );
  }
  return (
    <svg
      className="s-path-token-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
    </svg>
  );
}

/** Format a range as `start` or `start-end` for display. */
export function formatPathRange(range: PathRange | undefined): string {
  if (!range) return "";
  return range.end !== undefined ? `${range.start}-${range.end}` : String(range.start);
}

/** Clickable path token — opens the file preview overlay. */
export function PathToken({ path, range }: { path: string; range?: PathRange }) {
  const { openFilePreview } = useScout();
  const kind: "file" | "image" | "dir" = isImagePath(path)
    ? "image"
    : isDirectoryLikePath(path)
      ? "dir"
      : "file";
  const rangeLabel = formatPathRange(range);
  const display = rangeLabel ? `${path}:${rangeLabel}` : path;
  const title = rangeLabel ? `Open ${path} (lines ${rangeLabel})` : `Open ${path}`;
  return (
    <button
      type="button"
      className="s-path-token"
      data-path={path}
      data-range={rangeLabel || undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openFilePreview(path, range);
      }}
      title={title}
    >
      <PathIcon kind={kind} />
      {display}
    </button>
  );
}
