/**
 * When sidebar chrome owns Ops/Chat secondary strips in CenterPaneHeader
 * (SCO-086), content screens must not re-render those strips.
 *
 * Legacy `?ff.nav.sidebar=off` path still owns in-content subnav.
 */
import { useOptionalFlag } from "hudsonkit/flags";

/** True when the screen should still render its own OpsSubnav / ChatSubnav. */
export function useContentOwnsSecondaryNav(): boolean {
  const sidebarChrome = useOptionalFlag("nav.sidebar", false);
  return !sidebarChrome;
}
