import { useMemo } from "react";
import { useScout } from "../scout/Provider.tsx";
import type { RegisteredSurface } from "./types.ts";
import { resolveEmbedChrome } from "./types.ts";

export function DiscoveredEmbedHost({ surface }: { surface: RegisteredSurface }) {
  const { navigate } = useScout();
  const Screen = surface.Screen;
  const embed = surface.embed!;

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
      <Screen navigate={navigate} embedded {...extraProps} />
    </div>
  );
}