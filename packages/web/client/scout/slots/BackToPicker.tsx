import { useMemo } from "react";
import type { Route } from "../../lib/types.ts";
import {
  clearNavReturn,
  getNavReturn,
  type NavReturnSlot,
} from "../../lib/nav-return.ts";
import "./back-to-picker.css";

type Props = {
  slot: NavReturnSlot;
  /** Where to go when no returnTo was set (or when the user opens the detail directly). */
  fallback: Route;
  navigate: (route: Route) => void;
  /** Optional class so individual screens can tweak placement. */
  className?: string;
  /** Optional label override; otherwise derived from the destination. */
  label?: string;
};

function defaultLabel(route: Route): string {
  switch (route.view) {
    case "mesh":
      return "Back to mesh";
    case "ops":
      return "Back to ops";
    case "agents":
      return route.agentId ? "Back to agent" : "All agents";
    case "agents-v2":
      return route.agentId ? "Registry" : "All agents";
    case "messages":
      return "Back to conversations";
    case "conversation":
      return "Back to conversation";
    case "inbox":
      return "Back to inbox";
    case "sessions":
      return "Back to sessions";
    case "terminal":
      return "Terminal Control";
    case "channels":
      return "Back to conversations";
    case "fleet":
      return "Back to fleet";
    case "work":
      return "Back to work";
    case "broker":
      return "Back to broker";
    case "activity":
      return "Back to activity";
    default:
      return "Back";
  }
}

export function BackToPicker({ slot, fallback, navigate, className, label }: Props) {
  const returnTo = useMemo(() => getNavReturn(slot), [slot]);
  const target: Route = returnTo ?? fallback;
  const resolvedLabel = label ?? defaultLabel(target);
  return (
    <button
      type="button"
      className={`s-back-pill${className ? ` ${className}` : ""}`}
      onClick={() => {
        clearNavReturn(slot);
        navigate(target);
      }}
    >
      <span aria-hidden className="s-back-pill-glyph">←</span>
      <span>{resolvedLabel}</span>
    </button>
  );
}
