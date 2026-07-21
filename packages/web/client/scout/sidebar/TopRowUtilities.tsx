/**
 * Right-side utilities for the app-wide top row (SCO-087).
 *
 * Restores the utilities that briefly lived in the sidebar footer / the retired
 * top bar: machine scope (the single instance app-wide), a settings accelerator,
 * and the ⌘K command trigger. Rendered inside CenterPaneHeader's rightUtility
 * slot; the top row wrapper owns the drag region and marks this group no-drag.
 */
import { Command, Settings as SettingsIcon } from "lucide-react";
import { MachineScopeControl } from "../../components/MachineScopeControl.tsx";
import { useScout } from "../Provider.tsx";

export function TopRowUtilities({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette: () => void;
}) {
  const { openSettings } = useScout();
  return (
    <>
      <MachineScopeControl variant="nav" />
      <button
        type="button"
        className="scout-top-row-util"
        onClick={() => openSettings()}
        title="Settings"
        aria-label="Settings"
      >
        <SettingsIcon size={13} strokeWidth={1.6} aria-hidden />
      </button>
      <button
        type="button"
        className="scout-top-row-util"
        onClick={onOpenCommandPalette}
        title="Command palette (⌘K)"
        aria-label="Open command palette"
      >
        <Command size={13} strokeWidth={1.6} aria-hidden />
        <span className="scout-top-row-util-kbd">⌘K</span>
      </button>
    </>
  );
}
