import { useMemo } from "react";
import { useScout } from "../scout/Provider.tsx";
import { resolveContentPane } from "../screens/resolve-panes.tsx";
import type { RegisteredSurface } from "./types.ts";
import { resolveEmbedChrome } from "./types.ts";

function routeMatchesSurfaceRoute(route: unknown, surfaceRoute: unknown): boolean {
  if (!route || typeof route !== "object" || !surfaceRoute || typeof surfaceRoute !== "object") {
    return false;
  }
  const current = route as Record<string, unknown>;
  return Object.entries(surfaceRoute as Record<string, unknown>)
    .every(([key, value]) => current[key] === value);
}

export function DiscoveredEmbedHost({ surface }: { surface: RegisteredSurface }) {
  const { route, navigate, agents } = useScout();
  const Screen = surface.Screen;
  const embed = surface.embed!;
  const shouldRenderSurface =
    typeof window === "undefined"
    || surface.embedPaths.includes(window.location.pathname)
    || routeMatchesSurfaceRoute(route, surface.route);

  const extraProps = useMemo(() => {
    if (!embed.resolveEmbedProps) return {};
    return embed.resolveEmbedProps(new URLSearchParams(window.location.search));
  }, [embed]);

  const chrome = resolveEmbedChrome(embed);
  const rootClassName = [
    embed.rootClassName,
    "s-discovered-embed",
    chrome.showSecondaryNav ? "" : "s-discovered-embed--lean",
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} data-scout-theme data-scout-surface={surface.id}>
      {shouldRenderSurface
        ? <Screen navigate={navigate} embedded {...extraProps} />
        : resolveContentPane(route, navigate, agents)}
    </div>
  );
}
