import { cn } from "@/lib/utils";

/**
 * Scout wire-cube mark — the product silhouette used on the studio landing
 * and sidebar. Geometry matches the packages/web sidebar mark and the
 * design/logo-attempts wire cube: outer hex/cube, depth rays, inner echo.
 */
export function ScoutMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      className={cn("block shrink-0 text-studio-ink", className)}
      fill="none"
    >
      {/* Outer cube face */}
      <polygon
        points="16,4.8 26.2,10.7 26.2,21.9 16,27.8 5.8,21.9 5.8,10.7"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.06"
      />
      {/* Depth rays */}
      <path
        d="M16 4.8v23M5.8 10.7 16 16.6 26.2 10.7"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.42"
      />
      {/* Inner cube echo */}
      <polygon
        points="16,11 21.1,14 21.1,19.6 16,22.6 10.9,19.6 10.9,14"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.14"
        opacity="0.9"
      />
    </svg>
  );
}
