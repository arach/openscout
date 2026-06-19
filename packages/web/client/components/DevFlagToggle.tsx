import "./dev-flag-toggle.css";

import { useState } from "react";
import { Flag, SlidersHorizontal } from "lucide-react";

import { isScoutDevToolsAvailable, useScoutDevFlagControls } from "../lib/use-scout-dev-flags.ts";
import type { ScoutFlagBundle } from "../lib/scout-flags.ts";

const BUNDLE_LABELS: Record<ScoutFlagBundle, string> = {
  "light-prod": "lean",
  "max-pro": "max",
};

export function DevFlagToggle({
  onOpenPanel,
}: {
  onOpenPanel: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { activeBundle, applyBundle, toggleBundle, resetBundle } = useScoutDevFlagControls();

  if (!isScoutDevToolsAvailable()) {
    return null;
  }

  return (
    <div className="scout-dev-flag">
      <button
        type="button"
        className="chip chip--mono chip--caps chip--sm chip--warning"
        title={`Experience bundle: ${activeBundle}. Click to flip lean/max.`}
        onClick={toggleBundle}
      >
        {BUNDLE_LABELS[activeBundle]}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm btn--icon"
        title="Dev feature flags"
        aria-label="Dev feature flags"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Flag size={11} strokeWidth={1.8} />
      </button>
      {menuOpen && (
        <>
          <button
            type="button"
            className="scout-dev-flag-scrim"
            aria-label="Close dev flag menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="scout-dev-flag-menu">
            <div className="scout-dev-flag-menu-head">Dev flags</div>
            <button
              type="button"
              className="scout-dev-flag-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onOpenPanel();
              }}
            >
              <SlidersHorizontal size={12} />
              Open flag panel
            </button>
            <button
              type="button"
              className="scout-dev-flag-menu-item"
              onClick={() => {
                setMenuOpen(false);
                applyBundle("max-pro");
              }}
            >
              Max pro
            </button>
            <button
              type="button"
              className="scout-dev-flag-menu-item"
              onClick={() => {
                setMenuOpen(false);
                applyBundle("light-prod");
              }}
            >
              Lean launch
            </button>
            <button
              type="button"
              className="scout-dev-flag-menu-item scout-dev-flag-menu-item--muted"
              onClick={() => {
                setMenuOpen(false);
                resetBundle();
              }}
            >
              Reset overrides
            </button>
          </div>
        </>
      )}
    </div>
  );
}
