/**
 * Agent identity — deterministic generative marks from an agent's name.
 *
 * One name in → one stable visual identity out. Nothing is stored and
 * nothing is random at call time: the name is hashed to a seed, the seed
 * drives a PRNG, and every visual parameter (hue, silhouette, eyes,
 * speckle, …) is pulled from that single stream. The same name always
 * produces the same creature/sigil/constellation/monogram, on every
 * surface and every run.
 *
 * Pure TypeScript on purpose — no React, no DOM, no studio tokens. The
 * same ~120 lines port to Swift (macOS `ScoutAgentHue` already ships an
 * FNV fallback; this is its richer sibling) so iOS / macOS / web can
 * share one identity system.
 *
 * Four engines off the SAME seed, so an agent's sprite, sigil,
 * constellation, and monogram all share its hue:
 *   - sprite        symmetric pixel-creature with eyes (the mascot)
 *   - sigil         single-tone geometric glyph (house-rule restraint)
 *   - constellation a small star-chart unique to the name
 *   - monogram      initials over a generative field
 */

// ── hash + prng ────────────────────────────────────────────────────────
// xmur3 → a well-mixed 32-bit seed from a string. mulberry32 → a fast,
// decent PRNG seeded by it. Together: name → repeatable [0,1) stream.

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Raw 32-bit seed — surfaced so cards can show "seed: 0x…". */
  seed: number;
  next: () => number;
  float: (min: number, max: number) => number;
  int: (min: number, max: number) => number;
  bool: (p?: number) => boolean;
  pick: <T>(arr: readonly T[]) => T;
}

/** Build a fresh deterministic stream for `key`. Each engine makes its
 *  own stream from the same name, and each pulls `hue` first, so the
 *  four engines stay color-matched for a given agent. */
export function makeRng(key: string): Rng {
  const seed = xmur3(key.trim().toLowerCase())();
  const next = mulberry32(seed);
  return {
    seed,
    next,
    float: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    bool: (p = 0.5) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// ── palette ────────────────────────────────────────────────────────────
// One hue per agent; lightness + chroma are fixed by role so every
// generated mark belongs to the same material family (nothing garish,
// nothing muddy). All values are absolute oklch, so they survive the
// studio's dark↔light flip unchanged.

export interface Palette {
  hue: number;
  body: string; // primary fill
  bodyDim: string; // shaded fill / mouth
  accent: string; // secondary fill (analogous, brighter)
  ink: string; // darkest — pupils, outlines
  sclera: string; // lightest — eye whites, monogram glyph
  glow: string; // soft drop-shadow (alpha)
  soft: string; // very dim tile wash (alpha)
}

/**
 * Tone — the "color range" knob. Lightness + chroma of the body, while
 * the hue stays put. This is how state drives the look without touching
 * identity: an active agent is bright and saturated; a dormant one fades
 * toward grey. Eyes (ink + sclera) keep their fixed contrast so the face
 * survives even at the greyest tone.
 */
export interface Tone {
  /** Body lightness (oklch L). Default 0.72. */
  l?: number;
  /** Body chroma (oklch C). Lower = greyer/calmer. Default 0.15. */
  c?: number;
}

export function paletteFromHue(hue: number, tone: Tone = {}): Palette {
  const h = ((hue % 360) + 360) % 360;
  const l = tone.l ?? 0.72;
  const c = tone.c ?? 0.15;
  const accentHue = (h + 38) % 360;
  const dim = Math.max(0.18, l - 0.12);
  const lift = Math.min(0.92, l + 0.1);
  return {
    hue: h,
    body: `oklch(${l} ${c} ${h})`,
    bodyDim: `oklch(${dim} ${Math.max(0, c - 0.02)} ${h})`,
    accent: `oklch(${lift} ${c + 0.01} ${accentHue})`,
    ink: `oklch(0.34 0.07 ${h})`,
    sclera: `oklch(0.96 0.02 ${h})`,
    glow: `oklch(${l} ${c} ${h} / 0.45)`,
    soft: `oklch(${l} ${c} ${h} / 0.12)`,
  };
}

/**
 * Curated hue wheel — twelve well-separated stops that all look good at
 * the fixed lightness/chroma in `paletteFromHue`. Snapping to anchors
 * (instead of the raw 0–359 spread) is what makes a whole fleet read as
 * one designed set: no muddy yellow-green neighbours, no two agents a
 * hair apart, every pairing harmonious. The raw spectrum stays available
 * via the `spectrum` option for anyone who wants maximum individuality.
 */
export const CURATED_HUES = [
  25, // ember (the crab)
  45, // amber
  95, // chartreuse
  125, // scout green
  158, // emerald
  188, // teal
  212, // cyan
  238, // blue
  266, // indigo
  292, // violet
  320, // magenta
  345, // rose
];

/** Pull one hue from the stream — curated wheel by default, full
 *  spectrum on request. Exactly one `next()` either way, so the trait
 *  rolls that follow are identical no matter which mode is chosen. */
function pickHue(rng: Rng, spectrum = false): number {
  const t = rng.next();
  return spectrum
    ? Math.floor(t * 360)
    : CURATED_HUES[Math.floor(t * CURATED_HUES.length)];
}

/** Initials for the monogram engine + dense fallbacks. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s\-_./]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const w = parts[0] ?? "?";
  return w.slice(0, 2).toUpperCase();
}

// ── engine 1 · sprite (pixel creature) ──────────────────────────────────
// A 7×7 grid, mirrored across the vertical axis so random fill reads as a
// living thing rather than noise. A forced eye-band + spine give it a
// face; antennae / legs / speckle are seeded traits that make each one a
// distinct little animal.

export type SpriteCell = "off" | "body" | "accent" | "eye" | "mouth";

export interface Sprite {
  size: number;
  cells: SpriteCell[][]; // [row][col]
  palette: Palette;
  traits: {
    antennae: boolean;
    legs: boolean;
    wideEyes: boolean;
    eyeRow: number;
    mouth: boolean;
  };
}

const SPRITE_SIZE = 7;

export interface SpriteOpts {
  /** Extra entropy — same name, a different creature. The "reroll until
   *  it looks right" knob, and the value an agent *keeps* once claimed.
   *  Store this one small field and the whole identity is reproducible. */
  salt?: string;
  /** Force the hue (harness-tint / curation). The silhouette still
   *  derives from the name, so only the colour changes. */
  hue?: number;
  /** Body lightness/chroma — the "range" driven by state. */
  tone?: Tone;
  /** Use the full 0–359 spectrum instead of the curated wheel. */
  spectrum?: boolean;
}

export function spriteFor(name: string, opts: SpriteOpts = {}): Sprite {
  const rng = makeRng(name + (opts.salt ? "#" + opts.salt : ""));
  const seededHue = pickHue(rng, opts.spectrum);
  const palette = paletteFromHue(opts.hue ?? seededHue, opts.tone);

  const density = rng.float(0.42, 0.62);
  const speckle = rng.float(0.14, 0.34);
  const antennae = rng.bool(0.5);
  const legs = rng.bool(0.62);
  const wideEyes = rng.bool(0.5);
  const eyeRow = rng.bool(0.5) ? 2 : 3;
  const mouth = rng.bool(0.6);

  const S = SPRITE_SIZE;
  const center = (S - 1) / 2; // 3
  const cells: SpriteCell[][] = Array.from({ length: S }, () =>
    Array.from({ length: S }, () => "off" as SpriteCell),
  );

  const set = (r: number, c: number, v: SpriteCell) => {
    cells[r][c] = v;
    cells[r][S - 1 - c] = v; // mirror
  };

  // Body: rows 1..5, generate the left half (cols 0..center). A strong
  // center spine keeps the creature connected; the rest is seeded fill,
  // with a little symmetric speckle in the accent tone for "markings".
  for (let r = 1; r <= 5; r++) {
    for (let c = 0; c <= center; c++) {
      const isSpine = c === center;
      const lit = isSpine ? rng.next() < 0.85 : rng.next() < density;
      if (lit) set(r, c, rng.next() < speckle ? "accent" : "body");
    }
  }

  // Face: force a solid eye-band so eyes always sit on a head, then drop
  // in a symmetric pair of eyes (sclera + pupil rendered downstream).
  for (let c = 1; c <= center; c++) set(eyeRow, c, "body");
  const eyeCol = wideEyes ? 1 : 2;
  set(eyeRow, eyeCol, "eye");

  // Mouth: a quiet dim cell (or three) two rows under the eyes.
  if (mouth && eyeRow + 2 < S) {
    set(eyeRow + 2, center, "mouth");
    if (rng.bool(0.4)) set(eyeRow + 2, center - 1, "mouth");
  }

  // Antennae: a thin pair poking out the top.
  if (antennae) {
    const ac = rng.bool() ? 1 : 2;
    set(0, ac, "body");
  }

  // Legs: a symmetric pair (or two) at the base.
  if (legs) {
    set(S - 1, 1, "body");
    if (rng.bool(0.5)) set(S - 1, center, "body");
  }

  return {
    size: S,
    cells,
    palette,
    traits: { antennae, legs, wideEyes, eyeRow, mouth },
  };
}

// ── engine 2 · sigil (geometric glyph) ──────────────────────────────────
// One tone, thin strokes — built for the "identity by name, single accent"
// house rule. A ring (sometimes broken into an arc), evenly-spaced spokes,
// a center mark, and one satellite dot. Rendered in a 100×100 viewBox.

export interface Sigil {
  palette: Palette;
  spokes: number;
  rotation: number; // radians
  innerMark: "dot" | "ring" | "square" | "none";
  gap: boolean; // ring is a broken arc
  satellite: number; // angle of the orbiting dot (radians)
  double: boolean; // second, smaller concentric ring
}

export function sigilFor(name: string): Sigil {
  const rng = makeRng(name);
  const hue = pickHue(rng);
  const palette = paletteFromHue(hue);
  return {
    palette,
    spokes: rng.int(3, 7),
    rotation: rng.float(0, Math.PI),
    innerMark: rng.pick(["dot", "ring", "square", "none"] as const),
    gap: rng.bool(0.4),
    satellite: rng.float(0, Math.PI * 2),
    double: rng.bool(0.45),
  };
}

// ── engine 3 · constellation (star-chart) ────────────────────────────────
// N nodes scattered on jittered angles + radii, linked into a ring with
// one chord. The first node is the "primary" (brighter, larger). Normalized
// 0..1 coordinates; scale to taste downstream.

export interface ConstellationNode {
  x: number;
  y: number;
  r: number;
}
export interface Constellation {
  palette: Palette;
  nodes: ConstellationNode[];
  links: [number, number][];
}

export function constellationFor(name: string): Constellation {
  const rng = makeRng(name);
  const hue = pickHue(rng);
  const palette = paletteFromHue(hue);

  const n = rng.int(4, 6);
  const nodes: ConstellationNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.45, 0.45);
    const rad = rng.float(0.24, 0.46);
    nodes.push({
      x: 0.5 + Math.cos(a) * rad,
      y: 0.5 + Math.sin(a) * rad,
      r: rng.float(0.028, 0.052),
    });
  }
  nodes[0].r = 0.08; // primary

  const links: [number, number][] = [];
  for (let i = 0; i < n; i++) links.push([i, (i + 1) % n]);
  links.push([0, rng.int(2, n - 1)]); // one chord across

  return { palette, nodes, links };
}

// ── engine 4 · monogram (initials + field) ───────────────────────────────
// The calm, immediately-shippable one: initials in the display face over a
// seeded backdrop. Field type + gradient angle come from the same stream.

export interface Monogram {
  palette: Palette;
  initials: string;
  field: "gradient" | "dots" | "rings" | "grid";
  angle: number; // degrees, for the gradient
}

export function monogramFor(name: string): Monogram {
  const rng = makeRng(name);
  const hue = pickHue(rng);
  const palette = paletteFromHue(hue);
  return {
    palette,
    initials: initials(name),
    field: rng.pick(["gradient", "dots", "rings", "grid"] as const),
    angle: rng.int(0, 359),
  };
}

// ── convenience ──────────────────────────────────────────────────────────

export type EngineId = "sprite" | "sigil" | "constellation" | "monogram";

export interface Identity {
  name: string;
  palette: Palette;
  sprite: Sprite;
  sigil: Sigil;
  constellation: Constellation;
  monogram: Monogram;
}

/** All four engines for one name, plus the shared palette. */
export function identityFor(name: string): Identity {
  return {
    name,
    palette: paletteFromHue(pickHue(makeRng(name))),
    sprite: spriteFor(name),
    sigil: sigilFor(name),
    constellation: constellationFor(name),
    monogram: monogramFor(name),
  };
}
