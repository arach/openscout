"use client";

/**
 * HudGlyphRail — left-edge structural rail for the HUD chrome study.
 *
 * Replaces the 220px persistent sidebar with a 48px vertical rail of
 * hand-drawn glyphs, one per studio bucket. The rail is structural
 * (not floating), so it gets a stronger glass treatment than the
 * floating capsules — denser back, hairline edge, slight saturation
 * bump.
 *
 * Hover surfaces a tooltip and shifts the glyph stroke to the scout
 * accent. Active state mounts a 2px scout-accent bar against the
 * inner edge and tints the bg with `bg-studio-canvas-alt`.
 *
 * Pure mock — no routing, no state, no nav data. The study consumes
 * the `active` prop to demo what selection looks like.
 */

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type Bucket =
  | "plans"
  | "engineering"
  | "foundations"
  | "studies"
  | "atoms"
  | "meta";

interface RailItem {
  id: Bucket;
  label: string;
  Glyph: (props: { className?: string }) => ReactElement;
}

const ITEMS: RailItem[] = [
  { id: "plans", label: "Plans", Glyph: PlansGlyph },
  { id: "engineering", label: "Engineering", Glyph: EngineeringGlyph },
  { id: "foundations", label: "Foundations", Glyph: FoundationsGlyph },
  { id: "studies", label: "Studies", Glyph: StudiesGlyph },
  { id: "atoms", label: "Atoms", Glyph: AtomsGlyph },
  { id: "meta", label: "Meta", Glyph: MetaGlyph },
];

export function HudGlyphRail({
  active,
  className,
}: {
  active?: Bucket;
  className?: string;
}): ReactElement {
  return (
    <aside
      aria-label="Studio navigation rail"
      className={cn(
        "absolute inset-y-0 left-0 z-20 flex w-12 flex-col items-center",
        // Structural glass — denser than the floating capsules, hairline edge.
        "border-r border-studio-edge",
        className,
      )}
      style={{
        background:
          "color-mix(in oklab, var(--studio-canvas) 88%, transparent)",
        backdropFilter: "blur(18px) saturate(150%)",
        WebkitBackdropFilter: "blur(18px) saturate(150%)",
      }}
    >
      {/* Brand mark — small mono SCOUT vertically. */}
      <BrandMark />

      {/* Glyph stack. */}
      <nav className="mt-3 flex flex-col items-center gap-1.5">
        {ITEMS.map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} />
        ))}
      </nav>

      {/* Spacer pushes the theme toggle to the bottom. */}
      <div className="flex-1" />

      <ThemeToggleMock />
    </aside>
  );
}

// ── Brand mark ───────────────────────────────────────────────────────

function BrandMark() {
  return (
    <div
      aria-hidden
      className="mt-3 grid h-7 w-7 place-items-center rounded-[3px]"
      style={{
        background: "var(--scout-accent-soft)",
      }}
    >
      {/* A tiny dot + concentric arc — the "SCOUT" mark in miniature. */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle
          cx="7"
          cy="7"
          r="1.3"
          fill="var(--scout-accent)"
        />
        <path
          d="M 3.2 7 A 3.8 3.8 0 0 1 10.8 7"
          stroke="var(--scout-accent)"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

// ── Button ───────────────────────────────────────────────────────────

function RailButton({
  item,
  active,
}: {
  item: RailItem;
  active: boolean;
}) {
  const { Glyph, label } = item;
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative grid h-9 w-9 place-items-center rounded-[4px] transition-colors",
          active
            ? "bg-studio-canvas-alt"
            : "hover:bg-studio-canvas-alt",
        )}
      >
        {/* Active accent bar — flush against the inner edge of the rail. */}
        {active ? (
          <span
            aria-hidden
            className="absolute left-[-2px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-[1px]"
            style={{ background: "var(--scout-accent)" }}
          />
        ) : null}

        <Glyph
          className={cn(
            "transition-colors",
            active
              ? "[--g:var(--scout-accent)]"
              : "[--g:var(--studio-ink-faint)] group-hover:[--g:var(--scout-accent)]",
          )}
        />
      </button>

      {/* Tooltip on hover — floating capsule, mono. */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-[44px] top-1/2 -translate-y-1/2",
          "rounded-[3px] border border-studio-edge px-2 py-1",
          "font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "whitespace-nowrap",
        )}
        style={{
          background:
            "color-mix(in oklab, var(--studio-canvas) 80%, transparent)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Theme toggle mock ────────────────────────────────────────────────

function ThemeToggleMock() {
  return (
    <div
      aria-hidden
      className="mb-3 flex h-6 w-9 items-center justify-center gap-1 rounded-full border border-studio-edge"
      style={{
        background:
          "color-mix(in oklab, var(--studio-canvas-alt) 70%, transparent)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--studio-ink-faint)" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--studio-ink)" }}
      />
    </div>
  );
}

// ── Glyphs ───────────────────────────────────────────────────────────
// Hand-drawn SVGs. Slightly imperfect line lengths, varied stroke
// terminations. The current stroke color is wired via the `--g` CSS
// var which the button toggles between ink-faint / scout-accent.

function GlyphFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--g, currentColor)"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Plans — three stacked horizontal lines, slightly uneven. */
function PlansGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <path d="M 3 4.5 L 13 4.5" />
        <path d="M 3 8 L 11 8" />
        <path d="M 3 11.5 L 12.5 11.5" />
      </GlyphFrame>
    </span>
  );
}

/** Engineering — circle with NE and SW notches (mech without being a gear). */
function EngineeringGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <circle cx="8" cy="8" r="4" />
        {/* NE notch */}
        <path d="M 11 5 L 13 3" />
        {/* SW notch */}
        <path d="M 5 11 L 3 13" />
      </GlyphFrame>
    </span>
  );
}

/** Foundations — square inset with smaller square (ground / base). */
function FoundationsGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <rect x="2.5" y="2.5" width="11" height="11" />
        <rect x="6" y="6" width="4" height="4" fill="var(--g, currentColor)" />
      </GlyphFrame>
    </span>
  );
}

/** Studies — triangle pointing up. */
function StudiesGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <path d="M 8 2.8 L 13.5 12.8 L 2.5 12.8 Z" />
      </GlyphFrame>
    </span>
  );
}

/** Atoms — center dot with one orbit ring. */
function AtomsGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <circle cx="8" cy="8" r="1.4" fill="var(--g, currentColor)" />
        <ellipse cx="8" cy="8" rx="5.4" ry="2.4" />
      </GlyphFrame>
    </span>
  );
}

/** Meta — single small dot, centered. */
function MetaGlyph({ className }: { className?: string }) {
  return (
    <span className={className}>
      <GlyphFrame>
        <circle cx="8" cy="8" r="1.8" fill="var(--g, currentColor)" />
      </GlyphFrame>
    </span>
  );
}
