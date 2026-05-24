import type { StudioStatus } from "@/lib/studio-pages";

/**
 * Single status-pill atom. Replaces the inline pill markup that was
 * duplicated in PageStrip, EngDocHeader, and the eng index.
 *
 * Three variants:
 *   filled    — colored bg + matching fg, the bordered chip form
 *   outlined  — transparent bg, colored fg + matching outline
 *   text      — just colored mono caps, no bg, no border
 *
 * All colors come from `--status-*` CSS vars and switch with the
 * active theme. Pass either a `StudioStatus` (which maps to the
 * appropriate tone) or a raw `tone` if the status taxonomy doesn't
 * apply (e.g. info pills for FYI notices).
 */

export type StatusTone = "ok" | "warn" | "error" | "info" | "neutral";

const STATUS_TO_TONE: Record<StudioStatus, StatusTone> = {
  shipped: "ok",
  "in-flight": "warn",
  concept: "info",
  shelved: "error",
  draft: "neutral",
};

const STATUS_LABEL: Record<StudioStatus, string> = {
  shipped: "SHIPPED",
  "in-flight": "IN-FLIGHT",
  concept: "CONCEPT",
  shelved: "SHELVED",
  draft: "DRAFT",
};

export function statusToTone(status: StudioStatus): StatusTone {
  return STATUS_TO_TONE[status];
}

export function statusToLabel(status: StudioStatus): string {
  return STATUS_LABEL[status];
}

export interface StatusPillProps {
  /** Either a domain status or a raw tone. Status wins if both passed. */
  status?: StudioStatus;
  tone?: StatusTone;
  /** Override the rendered label. Defaults to STATUS_LABEL[status] or tone uppercased. */
  label?: string;
  variant?: "filled" | "outlined" | "text";
  className?: string;
}

export function StatusPill({
  status,
  tone,
  label,
  variant = "filled",
  className,
}: StatusPillProps) {
  const resolvedTone: StatusTone = status ? STATUS_TO_TONE[status] : (tone ?? "neutral");
  const resolvedLabel =
    label ?? (status ? STATUS_LABEL[status] : resolvedTone.toUpperCase());

  const fg = `var(--status-${resolvedTone}-fg)`;
  const bg = `var(--status-${resolvedTone}-bg)`;

  const base =
    "inline-block rounded-[3px] font-mono text-[9px] font-semibold tracking-[0.18em]";

  if (variant === "text") {
    return (
      <span
        className={[base, "px-0", className].filter(Boolean).join(" ")}
        style={{ color: fg }}
      >
        {resolvedLabel}
      </span>
    );
  }

  if (variant === "outlined") {
    return (
      <span
        className={[base, "border px-1.5 py-0.5", className].filter(Boolean).join(" ")}
        style={{ color: fg, borderColor: fg }}
      >
        {resolvedLabel}
      </span>
    );
  }

  return (
    <span
      className={[base, "px-1.5 py-0.5", className].filter(Boolean).join(" ")}
      style={{ color: fg, background: bg }}
    >
      {resolvedLabel}
    </span>
  );
}
