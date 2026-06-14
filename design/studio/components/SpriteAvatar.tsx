/**
 * SpriteAvatar — the production agent avatar.
 *
 * Wraps the deterministic sprite generator (lib/agent-identity.ts) in a
 * drop-in avatar: one `name` in, a stable little creature out. Geometry
 * is ratio-based so it reads from a 16px roster bullet up to a 160px hero
 * — at small sizes the glow drops and the eyes widen so the face still
 * lands. Optional `tile` (soft hue wash behind) and `corner` (a state
 * dot) match the existing avatar-with-corner pattern in AgentRow.
 *
 * This is the surface meant to port to SwiftUI: same name → same creature
 * on macOS / iOS, alongside the existing ScoutAgentHue path.
 */
"use client";

import { useMemo } from "react";
import { spriteFor, type SpriteOpts, type Tone } from "@/lib/agent-identity";

export interface SpriteAvatarProps {
  name: string;
  /** Pixel box (square). Default 32. */
  size?: number;
  /** Force the hue (curation / harness-tint). */
  hue?: number;
  /** Body lightness/chroma — the state-driven "range". */
  tone?: Tone;
  /** Reroll entropy — a different creature for the same name. */
  salt?: string;
  /** Full 0–359 spectrum instead of the curated wheel. */
  spectrum?: boolean;
  /** Soft hue wash tile behind the creature. */
  tile?: boolean;
  /** Drop-shadow bloom. Defaults on at ≥40px, off below. */
  glow?: boolean;
  /** A state dot in the corner (pass the color). */
  corner?: string;
  /** Pulse ring on the corner dot (working state). */
  cornerPulse?: boolean;
  className?: string;
}

export function SpriteAvatar({
  name,
  size = 32,
  hue,
  tone,
  salt,
  spectrum,
  tile = false,
  glow,
  corner,
  cornerPulse,
  className,
}: SpriteAvatarProps) {
  const opts: SpriteOpts = useMemo(
    () => ({ hue, salt, spectrum, tone }),
    [hue, salt, spectrum, tone?.l, tone?.c],
  );
  const sprite = useMemo(() => spriteFor(name, opts), [name, opts]);
  const showGlow = glow ?? size >= 40;

  // Tile padding scales with size; the creature sits inside it.
  const pad = tile ? Math.round(size * 0.16) : 0;
  const inner = size - pad * 2;

  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: tile ? Math.round(size * 0.26) : undefined,
        background: tile ? sprite.palette.soft : undefined,
      }}
    >
      <SpriteSvg sprite={sprite} px={inner} glow={showGlow} />
      {corner && (
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: Math.max(6, Math.round(size * 0.26)),
            height: Math.max(6, Math.round(size * 0.26)),
            borderRadius: "999px",
            background: corner,
            boxShadow: cornerPulse
              ? `0 0 0 2px var(--studio-surface), 0 0 0 4px color-mix(in oklab, ${corner} 32%, transparent)`
              : `0 0 0 2px var(--studio-surface)`,
          }}
        />
      )}
    </span>
  );
}

/** The raw SVG creature — ratio-based, so it's crisp at any px. */
export function SpriteSvg({
  sprite,
  px,
  glow = true,
}: {
  sprite: ReturnType<typeof spriteFor>;
  px: number;
  glow?: boolean;
}) {
  const { cells, size, palette } = sprite;
  const cell = px / size;
  // Below ~6px/cell, shrink the inter-pixel gap and fatten the pupils so
  // the face survives. Above it, a touch more gap + smaller pupils for
  // the clean "pixel art" read.
  const small = cell < 6;
  const gap = cell * (small ? 0.05 : 0.09);
  const radius = cell * (small ? 0.16 : 0.22);
  const pupil = cell * (small ? 0.26 : 0.19);

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      shapeRendering="geometricPrecision"
      style={{
        display: "block",
        filter: glow ? `drop-shadow(0 ${cell * 0.18}px ${cell * 0.6}px ${palette.glow})` : undefined,
      }}
    >
      {cells.flatMap((row, ri) =>
        row.map((c, ci) => {
          if (c === "off") return null;
          const x = ci * cell;
          const y = ri * cell;
          const key = `${ri}-${ci}`;
          if (c === "eye") {
            return (
              <g key={key}>
                <rect x={x + gap} y={y + gap} width={cell - gap * 2} height={cell - gap * 2} rx={radius} fill={palette.sclera} />
                <circle cx={x + cell / 2} cy={y + cell * 0.52} r={pupil} fill={palette.ink} />
              </g>
            );
          }
          const fill = c === "accent" ? palette.accent : c === "mouth" ? palette.ink : palette.body;
          return <rect key={key} x={x + gap} y={y + gap} width={cell - gap * 2} height={cell - gap * 2} rx={radius} fill={fill} />;
        }),
      )}
    </svg>
  );
}
