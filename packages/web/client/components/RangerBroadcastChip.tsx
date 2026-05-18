import { Bot } from "lucide-react";

import {
  selectChipBroadcast,
  toggleRanger,
  useRangerBroadcastStore,
} from "../lib/ranger-broadcast-store.ts";
import type { BroadcastTier } from "../lib/types.ts";

import "./ranger-broadcast-chip.css";

function tierClass(tier: BroadcastTier): string {
  return `s-ranger-chip-dot s-ranger-chip-dot--${tier}`;
}

export function RangerBroadcastChip() {
  const snap = useRangerBroadcastStore();
  const broadcast = selectChipBroadcast(snap);
  const title = broadcast
    ? `${broadcast.text} — open Ranger`
    : "Toggle Ranger";

  return (
    <button
      type="button"
      className={`s-ranger-chip${broadcast ? " s-ranger-chip--active" : " s-ranger-chip--idle"}`}
      onClick={() => toggleRanger(broadcast ?? null)}
      title={title}
    >
      <Bot size={14} className="s-ranger-chip-icon" aria-hidden="true" />
      {broadcast && (
        <>
          <span className={tierClass(broadcast.tier)} aria-hidden="true" />
          <span className="s-ranger-chip-text">{broadcast.text}</span>
        </>
      )}
    </button>
  );
}
