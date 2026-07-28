"use client";

/**
 * ASCII Render Lab — an instrument, not a mock.
 *
 * The premise, and the thing that separates this from every earlier attempt:
 * the ornament is a RENDER of real artwork, never a shape constructed inside
 * ASCII constraints.
 *
 *   svg art → rasterise → sample per cell → field filters → shimmer → quantise
 *
 * Source paths come from `design/logo-attempts/focused-03-wire-cube-mark.svg`.
 * Because step one rasterises, isometric and 30° edges antialias for free, so
 * no edge angle is off-limits the way it is when placing `╱` glyphs by hand —
 * which is exactly where hand-built hexagons kept collapsing into dashed
 * circles.
 *
 * Two rules are baked in rather than exposed, because they are findings, not
 * preferences (both inherited from `design/portal-studies/README.md`):
 *
 *   1. The shimmer modulates COVERAGE before quantisation, never brightness
 *      after. Modulating the field makes structure travel; modulating the
 *      output just eats holes in the thing it is meant to animate.
 *   2. Ordered dither, not random. A regular threshold lattice holds dots on
 *      their grid while the field moves underneath — random thresholding
 *      boils.
 *
 * Everything else is a knob. State lives in the URL hash, so any render is a
 * shareable link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── parameter spec ──────────────────────────────────────────────────────
   `r` marks params that need a re-rasterise/re-sample; the rest are
   per-frame and cost nothing to drag. */
type Kind = "n" | "sel" | "txt" | "chk";
type Item = [
  id: string,
  label: string,
  kind: Kind,
  def: string | number,
  range?: [number, number, number] | Record<string, string>,
  raster?: 1,
];

const SPEC: [string, Item[]][] = [
  ["Source", [
    ["art", "artwork", "sel", "twohex", {
      twohex: "two hexes (outer + echo)", cube: "wire cube (full)",
      outer: "outer hex only", inner: "inner hex only",
      rays: "depth rays only", tri: "three hexes",
    }, 1],
    ["stroke", "outer stroke", "n", 5, [0.5, 16, 0.5], 1],
    ["istroke", "inner stroke ×", "n", 1, [0.2, 3, 0.05], 1],
    ["inner", "inner scale", "n", 0.5, [0.15, 0.98, 0.01], 1],
    ["rot", "rotation", "n", 0, [-90, 90, 1], 1],
    ["irot", "inner rotation", "n", 0, [-90, 90, 1], 1],
    ["squash", "squash", "n", 1, [0.5, 1.6, 0.01], 1],
    ["sblur", "source blur", "n", 0, [0, 6, 0.25], 1],
  ]],
  ["Grid", [
    ["size", "font size", "n", 10, [4, 28, 1], 1],
    ["lh", "line height", "n", 1, [0.7, 2, 0.05], 1],
    ["track", "tracking", "n", 0, [-2, 8, 0.25], 1],
    ["boxw", "box width", "n", 260, [100, 620, 10], 1],
    ["boxh", "box height", "n", 240, [100, 620, 10], 1],
    ["font", "font", "sel", "ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace", {
      "ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace": "SF Mono",
      "Menlo,monospace": "Menlo",
      "'Courier New',monospace": "Courier",
      "'JetBrains Mono',ui-monospace,monospace": "JetBrains Mono",
      "'Andale Mono',monospace": "Andale Mono",
      "monospace": "system default",
    }, 1],
    ["weight", "font weight", "n", 400, [100, 900, 100], 1],
    ["ss", "supersample", "n", 3, [1, 6, 1], 1],
  ]],
  ["Field", [
    ["invert", "invert", "chk", 0],
    ["fblur", "field blur", "n", 0, [0, 3, 1]],
    ["edge", "edge mix", "n", 0, [0, 1, 0.05]],
    ["contrast", "contrast", "n", 1, [0.2, 3, 0.05]],
    ["gamma", "gamma", "n", 0.7, [0.2, 3, 0.05]],
    ["floor", "floor", "n", 0.09, [0, 0.8, 0.01]],
    ["ceil", "ceiling", "n", 1, [0.2, 1, 0.01]],
  ]],
  ["Texture", [
    ["glyphs", "glyph ramp (sparse → dense)", "txt", "·░"],
    ["dith", "dither", "sel", "none", {
      none: "none — glyph ramp", b2: "bayer 2×2", b4: "bayer 4×4",
      b8: "bayer 8×8", thr: "hard threshold",
    }],
    ["gain", "dither gain", "n", 1.2, [0.3, 3, 0.05]],
    ["grain", "grain", "n", 0, [0, 0.5, 0.01]],
    ["tones", "tones", "n", 5, [1, 5, 1]],
    ["lift", "tone lift", "n", 0, [0, 4, 1]],
    ["pal", "palette", "sel", "warm", {
      warm: "warm neutral", cool: "cool neutral", mono: "mono white",
      accent: "warm + accent tip", acc2: "accent ramp",
    }],
    ["bgc", "background", "sel", "#0a0a09", {
      "#0a0a09": "near-black warm", "#000000": "black",
      "#101113": "ink", "#f1efe9": "paper",
    }],
  ]],
  ["Shimmer", [
    ["mode", "mode", "sel", "off", {
      off: "off", sweep: "sweep — band travels", ripple: "ripple — rings from centre",
      scan: "scan — row by row", breathe: "breathe — whole field", orbit: "orbit — angular",
    }],
    ["amp", "amplitude", "n", 0.45, [0, 1, 0.02]],
    ["speed", "speed", "n", 0.5, [0.02, 3, 0.02]],
    ["wave", "wavelength", "n", 1, [0.08, 4, 0.04]],
    ["angle", "angle", "n", 120, [0, 360, 5]],
    ["sharp", "crest sharpness", "n", 2.5, [1, 8, 0.25]],
    ["phase", "phase", "n", 0, [0, 1, 0.01]],
    ["mod2", "2nd modulator", "n", 0, [0, 1, 0.02]],
    ["per2", "2nd period", "n", 2.7, [1.1, 6, 0.1]],
    ["fps", "fps cap", "n", 24, [6, 60, 2]],
  ]],
];

type Params = Record<string, string | number>;
const DEFAULTS: Params = {};
const KIND: Record<string, Kind> = {};
const RASTER = new Set<string>();
for (const [, items] of SPEC) {
  for (const [id, , kind, def, , r] of items) {
    DEFAULTS[id] = def;
    KIND[id] = kind;
    if (r) RASTER.add(id);
  }
}

const PALETTES: Record<string, string[]> = {
  warm: ["#2e2b27", "#474339", "#6b6558", "#968e7f", "#d5cdbd"],
  cool: ["#26282b", "#3b3f44", "#5c6167", "#8b9199", "#cfd4da"],
  mono: ["#2a2a2a", "#444444", "#6d6d6d", "#9c9c9c", "#ededed"],
  accent: ["#2e2b27", "#474339", "#6b6558", "#968e7f", "#a6e15e"],
  acc2: ["#1e2a1c", "#2f4227", "#486534", "#6d9448", "#a6e15e"],
};

/* ── source artwork ──────────────────────────────────────────────────── */
const OUTER = "M112 8 207 63v110l-95 55-95-55V63Z";
const RAYS = "M112 8v110M207 63l-95 55M17 63l95 55M112 228V118";
const CX = 112, CY = 118;

const echo = (s: number, rot: number, w: number) =>
  `<g transform="translate(${CX} ${CY}) rotate(${rot}) scale(${s}) translate(${-CX} ${-CY})"` +
  ` stroke-width="${w}"><path d="${OUTER}"/></g>`;

function art(p: Params): string {
  const w = Number(p.stroke), iw = Number(p.stroke) * Number(p.istroke);
  const inner = Number(p.inner), irot = Number(p.irot);
  const body =
    p.art === "outer" ? `<path d="${OUTER}"/>`
    : p.art === "inner" ? echo(inner, irot, iw)
    : p.art === "rays" ? `<path d="${RAYS}"/>`
    : p.art === "twohex" ? `<path d="${OUTER}"/>${echo(inner, irot, iw)}`
    : p.art === "tri" ? `<path d="${OUTER}"/>${echo(inner, irot, iw)}${echo(inner * inner, irot * 2, iw)}`
    : `<path d="${OUTER}"/><path d="${RAYS}"/>${echo(inner, irot, iw)}`;
  const sq = Number(p.squash);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 236">` +
    `<g transform="rotate(${p.rot} ${CX} ${CY}) translate(0 ${CY * (1 - sq)}) scale(1 ${sq})"` +
    ` fill="none" stroke="#fff" stroke-width="${w}"` +
    ` stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}

/* ── pipeline ────────────────────────────────────────────────────────── */
type Field = number[][];

function cellBox(p: Params) {
  const el = document.createElement("pre");
  el.style.cssText =
    `position:absolute;visibility:hidden;margin:0;white-space:pre;` +
    `font-family:${p.font};font-size:${p.size}px;line-height:${p.lh};` +
    `letter-spacing:${p.track}px;font-weight:${p.weight}`;
  el.textContent = "x".repeat(40) + "\nx";
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.remove();
  return { CW: r.width / 40, CH: r.height / 2 };
}

function rasterise(svg: string, W: number, H: number, ss: number, blur: number) {
  return new Promise<ImageData>((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(W * ss));
      c.height = Math.max(1, Math.round(H * ss));
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
      if (blur > 0) g.filter = `blur(${blur * ss}px)`;
      const s = Math.min(c.width / img.width, c.height / img.height) * 0.96;
      g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2,
        img.width * s, img.height * s);
      res(g.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function sample(img: ImageData, COLS: number, ROWS: number, CW: number, CH: number, ss: number): Field {
  const f: Field = [];
  for (let y = 0; y < ROWS; y++) {
    const row: number[] = [];
    for (let x = 0; x < COLS; x++) {
      const x0 = Math.floor(x * CW * ss), x1 = Math.max(x0 + 1, Math.floor((x + 1) * CW * ss));
      const y0 = Math.floor(y * CH * ss), y1 = Math.max(y0 + 1, Math.floor((y + 1) * CH * ss));
      let s = 0, n = 0;
      for (let py = y0; py < y1 && py < img.height; py++)
        for (let px = x0; px < x1 && px < img.width; px++) { s += img.data[(py * img.width + px) * 4]; n++; }
      row.push(n ? s / n / 255 : 0);
    }
    f.push(row);
  }
  return f;
}

const at = (f: Field, x: number, y: number) => (f[y] && f[y][x] != null ? f[y][x] : 0);
const norm = (f: Field): Field => {
  let m = 0;
  f.forEach((r) => r.forEach((v) => { if (v > m) m = v; }));
  return m ? f.map((r) => r.map((v) => v / m)) : f;
};

function boxBlur(f: Field, r: number): Field {
  if (!r) return f;
  return f.map((row, y) => row.map((_, x) => {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { s += at(f, x + dx, y + dy); n++; }
    return s / n;
  }));
}

function sobel(f: Field): Field {
  return f.map((row, y) => row.map((_, x) => {
    const gx = -at(f, x - 1, y - 1) - 2 * at(f, x - 1, y) - at(f, x - 1, y + 1)
      + at(f, x + 1, y - 1) + 2 * at(f, x + 1, y) + at(f, x + 1, y + 1);
    const gy = -at(f, x - 1, y - 1) - 2 * at(f, x, y - 1) - at(f, x + 1, y - 1)
      + at(f, x - 1, y + 1) + 2 * at(f, x, y + 1) + at(f, x + 1, y + 1);
    return Math.hypot(gx, gy);
  }));
}

/** Ordered Bayer, built recursively. */
function bayer(order: number): number[][] {
  let m = [[0]];
  while (m.length < order) {
    const n = m.length;
    const o: number[][] = Array.from({ length: n * 2 }, () => new Array(n * 2).fill(0));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = m[y][x] * 4;
      o[y][x] = v; o[y][x + n] = v + 2; o[y + n][x] = v + 3; o[y + n][x + n] = v + 1;
    }
    m = o;
  }
  const d = m.length * m.length;
  return m.map((r) => r.map((v) => (v + 0.5) / d));
}
const MATS: Record<string, number[][]> = { b2: bayer(2), b4: bayer(4), b8: bayer(8) };
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function shimmer(x: number, y: number, COLS: number, ROWS: number, t: number, p: Params) {
  if (p.mode === "off") return 1;
  const nx = (x / (COLS - 1)) * 2 - 1, ny = (y / (ROWS - 1)) * 2 - 1;
  const w = Math.max(0.05, Number(p.wave));
  const a = (Number(p.angle) * Math.PI) / 180;
  let u: number;
  switch (p.mode) {
    case "sweep": u = (nx * Math.cos(a) + ny * Math.sin(a)) / w - t; break;
    case "ripple": u = Math.hypot(nx, ny) / w - t; break;
    case "scan": u = ny / w - t; break;
    case "orbit": u = Math.atan2(ny, nx) / (Math.PI * 2) / w - t; break;
    default: u = -t;
  }
  let c = Math.cos((u + Number(p.phase)) * Math.PI * 2) * 0.5 + 0.5;
  c = Math.pow(c, Number(p.sharp));
  const m2 = Number(p.mod2);
  if (m2 > 0) {
    const per2 = Number(p.per2);
    const c2 = Math.cos((u / per2 - t / per2) * Math.PI * 2) * 0.5 + 0.5;
    c = c * (1 - m2) + c * c2 * m2 * 2;
  }
  const amp = Number(p.amp);
  return 1 - amp + amp * c * 2;
}

const STILL = 0.42;

/* ── component ───────────────────────────────────────────────────────── */
export function AsciiRenderLab() {
  const [P, setP] = useState<Params>(() => ({ ...DEFAULTS }));
  const [paused, setPaused] = useState(false);
  const [meta, setMeta] = useState("");
  const [ghost, setGhost] = useState("");

  const pRef = useRef(P);
  pRef.current = P;
  const baseRef = useRef<Field | null>(null);
  const dimsRef = useRef({ COLS: 0, ROWS: 0 });
  const layersRef = useRef<(HTMLPreElement | null)[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  /* hash → state, once on mount */
  useEffect(() => {
    const o: Params = {};
    new URLSearchParams(window.location.hash.slice(1)).forEach((v, k) => {
      if (!(k in DEFAULTS)) return;
      o[k] = typeof DEFAULTS[k] === "number" ? parseFloat(v) : v;
    });
    if (Object.keys(o).length) setP((prev) => ({ ...prev, ...o }));
  }, []);

  /* state → hash */
  useEffect(() => {
    const d = Object.entries(P).filter(([k, v]) => String(v) !== String(DEFAULTS[k]));
    const q = new URLSearchParams(d as [string, string][]).toString();
    window.history.replaceState(null, "", q ? `#${q}` : window.location.pathname);
  }, [P]);

  const draw = useCallback((t: number) => {
    const p = pRef.current;
    const base = baseRef.current;
    if (!base) return;
    const { COLS, ROWS } = dimsRef.current;

    let f = base;
    if (p.invert) f = f.map((r) => r.map((v) => 1 - v));
    if (Number(p.fblur)) f = boxBlur(f, Number(p.fblur));
    const edge = Number(p.edge);
    if (edge > 0) {
      const e = norm(sobel(f));
      f = f.map((r, y) => r.map((v, x) => v * (1 - edge) + e[y][x] * edge));
    }

    const glyphs = [...(String(p.glyphs) || "·")];
    const mat = MATS[String(p.dith)];
    const out = [0, 1, 2, 3, 4].map(() =>
      Array.from({ length: ROWS }, () => new Array(COLS).fill(" ")));

    const contrast = Number(p.contrast), ceil = Number(p.ceil), gamma = Number(p.gamma);
    const floor = Number(p.floor), gain = Number(p.gain), grain = Number(p.grain);
    const tones = Math.max(1, Number(p.tones)), lift = Number(p.lift);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let v = f[y][x] * shimmer(x, y, COLS, ROWS, t, p);
        v = (v - 0.5) * contrast + 0.5;
        v = Math.max(0, Math.min(1, v)) / Math.max(0.01, ceil);
        v = Math.pow(Math.max(0, Math.min(1, v)), gamma);
        const g = grain ? (hash(x, y) - 0.5) * grain : 0;

        let ch: string;
        if (p.dith === "none") {
          if (v + g <= floor) continue;
          ch = glyphs[Math.min(glyphs.length - 1, Math.floor(v * glyphs.length))];
        } else {
          const thr = mat ? mat[y % mat.length][x % mat.length] : 0.5;
          if (!(v * gain + g > thr)) continue;
          ch = glyphs[glyphs.length - 1];
        }
        const step = Math.min(tones - 1, Math.floor(v * tones));
        const tone = tones === 1 ? 4 : Math.round(lift + (step * (4 - lift)) / (tones - 1));
        out[Math.max(0, Math.min(4, tone))][y][x] = ch;
      }
    }
    layersRef.current.forEach((el, i) => {
      if (el) el.textContent = out[i].map((r) => r.join("")).join("\n");
    });
  }, []);

  /* rasterise + sample whenever a source/grid param moves */
  const rasterKey = useMemo(
    () => [...RASTER].map((k) => `${k}:${P[k]}`).join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...RASTER].map((k) => P[k]),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = pRef.current;
      const { CW, CH } = cellBox(p);
      const COLS = Math.max(3, Math.round(Number(p.boxw) / CW));
      const ROWS = Math.max(3, Math.round(Number(p.boxh) / CH));
      const svg = art(p);
      const img = await rasterise(svg, COLS * CW, ROWS * CH, Number(p.ss), Number(p.sblur));
      if (cancelled) return;
      baseRef.current = norm(sample(img, COLS, ROWS, CW, CH, Number(p.ss)));
      dimsRef.current = { COLS, ROWS };
      setGhost("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
      draw(STILL);
    })();
    return () => { cancelled = true; };
  }, [rasterKey, draw]);

  /* animation */
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const run = () => {
      cancelAnimationFrame(rafRef.current);
      if (P.mode !== "off" && !paused && !reduce.matches) {
        const loop = (ts: number) => {
          rafRef.current = requestAnimationFrame(loop);
          if (ts - lastRef.current < 1000 / Number(pRef.current.fps)) return;
          lastRef.current = ts;
          draw(STILL + (ts / 1000) * Number(pRef.current.speed));
        };
        rafRef.current = requestAnimationFrame(loop);
      } else {
        draw(STILL);
      }
    };
    run();
    reduce.addEventListener("change", run);
    return () => {
      cancelAnimationFrame(rafRef.current);
      reduce.removeEventListener("change", run);
    };
  }, [P, paused, draw]);

  useEffect(() => {
    const g = [...(String(P.glyphs) || "·")].length;
    setMeta(
      `${dimsRef.current.COLS}×${dimsRef.current.ROWS} · ${g} glyph${g > 1 ? "s" : ""}` +
      ` · ${P.tones} tone${Number(P.tones) > 1 ? "s" : ""}` +
      ` · ${P.dith === "none" ? "ramp" : P.dith} · ${P.mode}`,
    );
  }, [P, ghost]);

  const set = (id: string, value: string | number) => setP((prev) => ({ ...prev, [id]: value }));

  const randomise = () => {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    setP((prev) => ({
      ...prev,
      dith: pick(["none", "b2", "b4", "b8"]),
      glyphs: pick(["·", "·░", "·:░", ".·░", "·∙░", "·-░"]),
      gamma: +(0.4 + Math.random() * 1.2).toFixed(2),
      contrast: +(0.7 + Math.random() * 1.3).toFixed(2),
      tones: 1 + Math.floor(Math.random() * 5),
      lift: Math.floor(Math.random() * 3),
      mode: pick(["sweep", "ripple", "scan", "breathe", "orbit"]),
      amp: +(0.2 + Math.random() * 0.7).toFixed(2),
      wave: +(0.3 + Math.random() * 1.6).toFixed(2),
      sharp: +(1 + Math.random() * 4).toFixed(2),
      angle: Math.floor(Math.random() * 72) * 5,
    }));
  };

  const pal = PALETTES[String(P.pal)] ?? PALETTES.warm;
  const toneVars = Object.fromEntries(pal.map((c, i) => [`--lab-t${i}`, c])) as React.CSSProperties;

  return (
    <div className="arl" style={toneVars}>
      <style>{CSS}</style>

      <aside className="arl-rail">
        <div className="arl-head">
          <p>ascii render lab</p>
          <div className="arl-acts">
            <button type="button" onClick={() => setPaused((v) => !v)}>
              {paused ? "play" : "pause"}
            </button>
            <button type="button" onClick={randomise}>randomise</button>
            <button type="button" onClick={() => setP({ ...DEFAULTS })}>reset</button>
          </div>
        </div>

        {SPEC.map(([group, items]) => (
          <details key={group} open>
            <summary>{group}</summary>
            <div className="arl-body">
              {items.map(([id, label, kind, , range]) => {
                if (kind === "chk") {
                  return (
                    <label className="arl-chk" key={id}>
                      <input
                        type="checkbox"
                        checked={!!P[id]}
                        onChange={(e) => set(id, e.target.checked ? 1 : 0)}
                      />
                      <span>{label}</span>
                    </label>
                  );
                }
                return (
                  <div className="arl-p" key={id}>
                    <div className="arl-lab">
                      <span>{label}</span>
                      {kind === "n" && <output>{P[id]}</output>}
                    </div>
                    {kind === "n" ? (
                      <input
                        type="range"
                        min={(range as number[])[0]}
                        max={(range as number[])[1]}
                        step={(range as number[])[2]}
                        value={Number(P[id])}
                        onChange={(e) => set(id, parseFloat(e.target.value))}
                      />
                    ) : kind === "sel" ? (
                      <select value={String(P[id])} onChange={(e) => set(id, e.target.value)}>
                        {Object.entries(range as Record<string, string>).map(([v, t]) => (
                          <option key={v} value={v}>{t}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        spellCheck={false}
                        value={String(P[id])}
                        onChange={(e) => set(id, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </aside>

      <main className="arl-stage-wrap" style={{ background: String(P.bgc) }}>
        <div className="arl-stage" aria-hidden>
          {[0, 1, 2, 3, 4].map((t) => (
            <pre
              key={t}
              ref={(el) => { layersRef.current[t] = el; }}
              style={{
                color: `var(--lab-t${t})`,
                fontFamily: String(P.font),
                fontSize: `${P.size}px`,
                lineHeight: String(P.lh),
                letterSpacing: `${P.track}px`,
                fontWeight: Number(P.weight),
              }}
            />
          ))}
        </div>
        <div className="arl-meta">{meta}</div>
        {ghost && <img className="arl-ghost" src={ghost} alt="" aria-hidden />}
      </main>
    </div>
  );
}

const CSS = `
.arl{display:grid;grid-template-columns:288px minmax(0,1fr);
  border:1px solid #1e1d1a;border-radius:8px;overflow:hidden;height:760px;
  --lab-ink:#f1ece1;--lab-ink2:#a49d90;--lab-ink3:#6f6960;
  --lab-edge:#1e1d1a;--lab-edge2:#33312c;--lab-accent:#a6e15e;
  font-family:Inter,ui-sans-serif,system-ui,sans-serif}

.arl-rail{background:#0e0d0c;border-right:1px solid var(--lab-edge);
  overflow-y:auto;padding-bottom:40px;scrollbar-width:thin}
.arl-head{position:sticky;top:0;z-index:2;background:#0e0d0c;padding:14px 15px 12px;
  border-bottom:1px solid var(--lab-edge)}
.arl-head p{margin:0;font-family:var(--font-mono,ui-monospace),monospace;font-size:10px;
  letter-spacing:.17em;text-transform:uppercase;color:var(--lab-ink2)}
.arl-acts{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.arl button{font-family:var(--font-mono,ui-monospace),monospace;font-size:9px;
  letter-spacing:.11em;text-transform:uppercase;background:#0a0a09;color:var(--lab-ink2);
  border:1px solid var(--lab-edge2);border-radius:3px;padding:6px 9px;cursor:pointer}
.arl button:hover{color:var(--lab-ink);border-color:var(--lab-ink3)}

.arl details{border-bottom:1px solid var(--lab-edge)}
.arl summary{cursor:pointer;list-style:none;padding:10px 15px;
  font-family:var(--font-mono,ui-monospace),monospace;font-size:9px;letter-spacing:.17em;
  text-transform:uppercase;color:var(--lab-ink3);display:flex;justify-content:space-between;
  align-items:center}
.arl summary::-webkit-details-marker{display:none}
.arl summary::after{content:'+';color:var(--lab-edge2);font-size:11px}
.arl details[open] summary::after{content:'–'}
.arl details[open] summary{color:var(--lab-ink2)}
.arl-body{padding:2px 15px 14px}

.arl-p{margin:0 0 10px}
.arl-lab{display:flex;justify-content:space-between;align-items:baseline;gap:8px;
  margin-bottom:3px}
.arl-lab span{font-size:11px;color:var(--lab-ink2)}
.arl-lab output{font-family:var(--font-mono,ui-monospace),monospace;font-size:10px;
  color:var(--lab-ink3);font-variant-numeric:tabular-nums}
.arl select,.arl input[type=text]{width:100%;background:#0a0a09;color:var(--lab-ink);
  border:1px solid var(--lab-edge2);border-radius:3px;padding:5px 7px;
  font-family:var(--font-mono,ui-monospace),monospace;font-size:11px}

/* Hairline track + small neutral thumb. The stock accent-color fill turns every
   slider into a green bar, which spends the one rationed hue on chrome. */
.arl input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:14px;
  margin:0;background:transparent;cursor:pointer}
.arl input[type=range]::-webkit-slider-runnable-track{height:1px;background:var(--lab-edge2)}
.arl input[type=range]::-moz-range-track{height:1px;background:var(--lab-edge2)}
.arl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;
  border-radius:50%;background:var(--lab-ink3);margin-top:-4px;transition:background 120ms}
.arl input[type=range]::-moz-range-thumb{width:9px;height:9px;border:0;border-radius:50%;
  background:var(--lab-ink3)}
.arl input[type=range]:hover::-webkit-slider-thumb{background:var(--lab-ink2)}
.arl input[type=range]:active::-webkit-slider-thumb{background:var(--lab-accent)}
.arl-chk{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--lab-ink2);
  cursor:pointer;margin:0 0 10px}
.arl-chk input{accent-color:var(--lab-accent);width:13px;height:13px;margin:0}
.arl :focus-visible{outline:1px solid var(--lab-accent);outline-offset:2px}

.arl-stage-wrap{display:grid;place-items:center;position:relative;overflow:hidden}
.arl-stage{position:relative;user-select:none}
.arl-stage pre{margin:0;white-space:pre}
.arl-stage pre + pre{position:absolute;inset:0}
.arl-meta{position:absolute;left:22px;bottom:18px;
  font-family:var(--font-mono,ui-monospace),monospace;font-size:10px;letter-spacing:.07em;
  color:var(--lab-ink3)}
.arl-ghost{position:absolute;right:22px;bottom:16px;width:72px;height:72px;opacity:.4}

@media (max-width: 900px){
  .arl{grid-template-columns:1fr;height:auto}
  .arl-rail{max-height:340px}
  .arl-stage-wrap{min-height:420px}
}
`;
