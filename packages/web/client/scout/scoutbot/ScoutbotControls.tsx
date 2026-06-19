import type { ReactNode } from "react";
import { Loader2, RefreshCw, Rocket, Settings } from "lucide-react";
import type { VoiceProbeState } from "./scoutbot-model.ts";

export function ScoutbotIconButton({
  icon,
  title,
  onClick,
  disabled,
  active,
  badge,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-1 rounded border p-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
          : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
      }`}
    >
      {icon}
      {badge && <span className="font-mono text-[8.5px] tracking-tight">{badge}</span>}
    </button>
  );
}

export function ScoutbotActionButton({
  icon,
  label,
  title,
  onClick,
  disabled,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-8 items-center justify-center gap-1.5 rounded border border-[var(--scout-chrome-border-soft)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)] transition-colors hover:bg-[var(--scout-chrome-hover)] disabled:cursor-not-allowed disabled:opacity-45 ${
        compact ? "w-8 shrink-0 px-0" : "min-w-0 flex-1 px-2"
      }`}
    >
      {icon}
      {!compact && <span className="truncate">{label}</span>}
    </button>
  );
}

export function VoxSetupPanel({
  issue,
  probeState,
  onLaunch,
  onRetry,
  onSettings,
}: {
  issue: string | null;
  probeState: VoiceProbeState;
  onLaunch: () => void;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const isBusy = probeState === "probing" || probeState === "launching";

  return (
    <div className="rounded border border-lime-300/25 bg-lime-300/[0.06] px-3 py-3 font-mono text-[10px] text-[var(--scout-chrome-ink)]">
      <div className="flex items-start gap-2">
        <Rocket size={14} className="mt-0.5 shrink-0 text-lime-300" />
        <div className="min-w-0">
          <div className="uppercase tracking-[0.14em] text-lime-200">Connect Vox</div>
          <p className="mt-1 leading-relaxed text-[var(--scout-chrome-ink-faint)]">
            Start Vox, then retry once the menu bar icon is visible.
          </p>
          {issue && (
            <p className="mt-2 break-words leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
              {issue}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <VoxSetupButton
          icon={probeState === "launching" ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
          label={probeState === "launching" ? "Opening" : "Launch Vox"}
          onClick={onLaunch}
          disabled={probeState === "probing"}
          title="Launch Vox"
        />
        <VoxSetupButton
          icon={probeState === "probing" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          label="Retry"
          onClick={onRetry}
          disabled={isBusy}
          title="Check Vox again"
        />
        <VoxSetupButton
          icon={<Settings size={12} />}
          label="Settings"
          onClick={onSettings}
          disabled={probeState === "probing"}
          title="Open Vox settings"
        />
      </div>
    </div>
  );
}

function VoxSetupButton({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-8 items-center justify-center gap-1.5 rounded border border-lime-300/20 px-2 text-[9px] uppercase tracking-[0.12em] text-lime-100 transition-colors hover:bg-lime-300/10 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {label}
    </button>
  );
}
