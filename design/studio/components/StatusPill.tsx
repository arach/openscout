import {
  StatusPill as ToneStatusPill,
  createStatusPalette,
  type StatusTone,
  type StatusPillVariant,
} from "studio/atoms";
import type { StudioStatus } from "@/lib/studio-pages";

/**
 * Status-pill atom — now an adapter over the shared `studio/atoms`
 * primitive. The status→{tone,label} mapping that used to live here is
 * bound via `createStatusPalette`; the pill rendering comes from the
 * shared package. Local API preserved: pass a domain `status` OR a raw
 * `tone` (status wins). Colors come from `--status-*` CSS vars.
 */

export type { StatusTone };

const palette = createStatusPalette<StudioStatus>({
  shipped: { tone: "ok", label: "SHIPPED" },
  "in-flight": { tone: "warn", label: "IN-FLIGHT" },
  concept: { tone: "info", label: "CONCEPT" },
  shelved: { tone: "error", label: "SHELVED" },
  draft: { tone: "neutral", label: "DRAFT" },
});

export const statusToTone = palette.statusToTone;
export const statusToLabel = palette.statusToLabel;
/** Status → CSS var for the fg color (sidebar status dots, etc.). */
export const statusToColor = palette.statusToColor;

export interface StatusPillProps {
  /** Either a domain status or a raw tone. Status wins if both passed. */
  status?: StudioStatus;
  tone?: StatusTone;
  /** Override the rendered label. */
  label?: string;
  variant?: StatusPillVariant;
  className?: string;
}

export function StatusPill({ status, tone, label, variant, className }: StatusPillProps) {
  if (status) {
    return (
      <palette.StatusPill
        status={status}
        label={label}
        variant={variant}
        className={className}
      />
    );
  }
  const resolved: StatusTone = tone ?? "neutral";
  return (
    <ToneStatusPill
      tone={resolved}
      label={label ?? resolved.toUpperCase()}
      variant={variant}
      className={className}
    />
  );
}
