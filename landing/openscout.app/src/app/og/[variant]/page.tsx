import type { Metadata } from "next";
import { LogoMark } from "@/components/logo-mark";
import { ScoutConsole } from "@/components/scout-console";

/**
 * OG-card compositor — not a public page.
 *
 * Renders each social card at exactly 1200×630 using the real site
 * components (LogoMark, ScoutConsole) and site CSS, so the cards can't
 * drift from the brand. Regenerate the PNGs with headless Chrome:
 *
 *   chrome --headless --window-size=1200,630 --force-device-scale-factor=2 \
 *     --virtual-time-budget=20000 --screenshot=public/og.png \
 *     http://localhost:3002/og/home
 *
 * Variants: home → og.png, docs → og-docs.png,
 * privacy → og-privacy.png, inventory → og-inventory.png
 */

const VARIANTS = {
  home: {
    headline: "One place for all your agents.",
    sub: "Local-first. Neutral by design.",
    foot: "open source · apache-2.0 · runs on your machine",
  },
  docs: {
    headline: "Scout Docs.",
    sub: "Quickstart, architecture, agents, protocol.",
    foot: "openscout.app/docs",
  },
  privacy: {
    headline: "Local-first, by default.",
    sub: "Your code, prompts, and history stay on your machine.",
    foot: "openscout.app/privacy",
  },
  inventory: {
    headline: "Plan inventory.",
    sub: "Recent agent plans, ready to branch into follow-up work.",
    foot: "openscout.app",
  },
} as const;

type Variant = keyof typeof VARIANTS;

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OgCard({
  params,
}: {
  params: Promise<{ variant: string }>;
}) {
  const { variant } = await params;
  const spec = VARIANTS[(variant in VARIANTS ? variant : "home") as Variant];

  return (
    <div
      style={{
        width: 1200,
        height: 630,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        background: "#ffffff",
        color: "#111110",
      }}
    >
      {/* Left column — mark, headline, footer strip */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 0 48px 64px",
          width: 620,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LogoMark size="md" />
          <span style={{ fontSize: 26, fontWeight: 650, letterSpacing: "-0.02em" }}>
            Scout
          </span>
        </div>

        <div>
          <div
            style={{
              fontSize: 58,
              lineHeight: 1.06,
              fontWeight: 650,
              letterSpacing: "-0.035em",
              textWrap: "balance",
            }}
          >
            {spec.headline}
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize: 27,
              lineHeight: 1.3,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "rgba(17, 17, 16, 0.52)",
              maxWidth: 480,
            }}
          >
            {spec.sub}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 15,
            letterSpacing: "0.04em",
            color: "rgba(17, 17, 16, 0.55)",
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              background: "#d43d2a",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {spec.foot}
        </div>
      </div>

      {/* Right column — the real console, scaled down and bled off-canvas */}
      <div style={{ position: "relative", flex: 1 }}>
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 4,
            width: 760,
            transform: "scale(0.74)",
            transformOrigin: "top left",
          }}
        >
          <ScoutConsole audience="human" />
        </div>
      </div>
    </div>
  );
}
