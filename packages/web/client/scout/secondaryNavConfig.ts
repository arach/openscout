import type { SecondaryNavGroup } from "../components/SecondaryNav.tsx";
import {
  projectAgentsSecondaryNav,
  projectChatSecondaryNav,
  projectOpsSecondaryNav,
  projectSearchSecondaryNav,
} from "./nav-destinations.ts";

// Agents is a top-level tab (Projects); its only remaining sub-page is the
// configuration surface. Directory (.deprecated) and Sessions left the subnav —
// the route stays alive, the nav entry does not.
export const AGENTS_SECONDARY_NAV: SecondaryNavGroup[] = projectAgentsSecondaryNav();

export const CHAT_SECONDARY_NAV: SecondaryNavGroup[] = projectChatSecondaryNav();

/** Search is a single surface; /search/indexer keeps resolving to the same page. */
export const SEARCH_SECONDARY_NAV: SecondaryNavGroup[] = projectSearchSecondaryNav();

export const OPS_SECONDARY_NAV: SecondaryNavGroup[] = projectOpsSecondaryNav();
