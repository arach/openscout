type LogoMarkProps = {
  size?: "sm" | "md";
};

/**
 * Scout product mark for site chrome.
 *
 * Uses the wire-cube silhouette on a dark app-icon plate (not the full
 * 1024px PNG), so the hexagon/cube still reads at header sizes.
 * Geometry matches design/studio scout-icon-treatments + favicon.svg.
 */
export function LogoMark({ size = "sm" }: LogoMarkProps) {
  const pixelSize = size === "md" ? 40 : 34;

  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: pixelSize, height: pixelSize }}
      aria-hidden
    >
      <svg
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 32 32"
        className="block"
        fill="none"
      >
        {/* App-icon plate */}
        <rect width="32" height="32" rx="7" fill="var(--site-logo-bg, #101112)" />
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="6.5"
          stroke="var(--site-logo-border, rgba(246, 244, 238, 0.24))"
          strokeWidth="1"
        />
        {/* Outer cube (hexagon face) */}
        <polygon
          points="16,5.8 25.1,11.1 25.1,21.7 16,27 6.9,21.7 6.9,11.1"
          stroke="var(--site-logo-ink, #f6f4ee)"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {/* Depth rays */}
        <path
          d="M16 5.8v21.2M6.9 11.1 16 16.4 25.1 11.1"
          stroke="var(--site-logo-ink, #f6f4ee)"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.58"
        />
        {/* Inner cube echo */}
        <polygon
          points="16,11.4 20.55,14 20.55,19.2 16,21.8 11.45,19.2 11.45,14"
          stroke="var(--site-logo-ink, #f6f4ee)"
          strokeWidth="1.4"
          strokeLinejoin="round"
          opacity="0.82"
        />
      </svg>
    </span>
  );
}
