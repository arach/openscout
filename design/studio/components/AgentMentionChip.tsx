/**
 * AgentMentionChip — inline `@agent` button form.
 *
 * Sits in prose flow ("…reviewed by @hudson and merged") or as a
 * standalone chip in an attendees row. Avatar dot + name only — no
 * state, no task. State surfaces are richer primitives (Row, Card).
 *
 * Hover lifts the border + background so the chip reads as interactive
 * without screaming.
 */
import { avatarColor } from "./AgentRow";

interface AgentMentionChipProps {
  agent: { name: string; handle?: string };
  size?: "sm" | "md";
}

export function AgentMentionChip({ agent, size = "md" }: AgentMentionChipProps) {
  const isSm = size === "sm";
  const dotPx = isSm ? 6 : 8;
  return (
    <button
      type="button"
      className={[
        "inline-flex items-baseline gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 align-baseline font-sans transition-colors hover:border-studio-edge-strong hover:bg-studio-canvas-alt",
        isSm ? "py-[1px] text-[11px]" : "py-[2px] text-[12.5px]",
      ].join(" ")}
    >
      <span
        className="self-center rounded-full"
        style={{
          width: dotPx,
          height: dotPx,
          background: avatarColor(agent.name),
        }}
      />
      <span className="font-medium text-studio-ink">
        @{agent.handle ?? agent.name.toLowerCase()}
      </span>
    </button>
  );
}
