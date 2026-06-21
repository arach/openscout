/**
 * DEPRECATED ALIAS — safe to delete this whole directory.
 *
 * This route was created in error during the macOS level-up assignment before
 * discovering that the canonical study already existed at
 * /studies/scout-macos-refresh (design/studio/app/studies/scout-macos-refresh).
 * The duplicate could not be removed in-session (destructive `rm` was not
 * granted), so it is neutralised here: it redirects to the canonical study and
 * is intentionally NOT listed in lib/studio-pages.ts.
 *
 * Cleanup: rm -rf design/studio/app/studies/scout-macos-levelup
 */
import { redirect } from "next/navigation";

export default function ScoutMacOSLevelUpAlias() {
  redirect("/studies/scout-macos-refresh");
}
