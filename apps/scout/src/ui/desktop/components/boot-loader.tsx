import React from "react";

const BOOT_STEPS = [
  { label: "Resolving workspace root", detail: "~/.openscout" },
  { label: "Loading project manifest", detail: "project.json" },
  { label: "Scanning runtimes", detail: "claude, codex" },
  { label: "Connecting relay service", detail: "broker-service" },
  { label: "Reading agent registry", detail: "local-agents" },
  { label: "Checking environment", detail: "PATH, node, bun" },
  { label: "Building shell state", detail: "sessions, plans" },
];

/** Steady cadence: first beat slightly longer, then even spacing (no random jumps). */
function stepDelay(visibleCount: number) {
  if (visibleCount === 0) return 420;
  return 195 + Math.min(visibleCount, 5) * 12;
}

type BootLoaderColors = {
  border: string;
  termBg: string;
  termFg: string;
  accent: string;
};

type BootLoaderStyles = {
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
};

/** Inner min height: ~7 log lines + padding + cursor row — avoids vertical resize as lines appear. */
const TERMINAL_MIN_H = "13.75rem";

/** Matches wave width — keeps step count and “Finishing up” on one vertical rhythm when crossfading. */
const FOOTER_LEAD_W = "w-[3.25rem]";

/** Sliding layered wave — lives below the terminal panel (not inside the bordered log). */
function BootLoaderWaveSvg({ color }: { color: string }) {
  const spline = "0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 14 32 4"
      preserveAspectRatio="none"
      className="h-[6px] w-[3.25rem] shrink-0 overflow-visible"
      style={{ color }}
      aria-hidden
    >
      <path opacity={0.8} fill="currentColor" d="M2 14 V18 H6 V14z">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 24 0; 0 0"
          dur="2s"
          begin="0s"
          repeatCount="indefinite"
          keySplines={spline}
          calcMode="spline"
        />
      </path>
      <path opacity={0.5} fill="currentColor" d="M0 14 V18 H8 V14z">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 24 0; 0 0"
          dur="2s"
          begin="0.1s"
          repeatCount="indefinite"
          keySplines={spline}
          calcMode="spline"
        />
      </path>
      <path opacity={0.25} fill="currentColor" d="M0 14 V18 H8 V14z">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 24 0; 0 0"
          dur="2s"
          begin="0.2s"
          repeatCount="indefinite"
          keySplines={spline}
          calcMode="spline"
        />
      </path>
    </svg>
  );
}

export function BootLoader({
  dark,
  C: colors,
  s: styles,
}: {
  dark: boolean;
  C: BootLoaderColors;
  s: BootLoaderStyles;
}) {
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    if (visibleCount >= BOOT_STEPS.length) return;
    const delay = stepDelay(visibleCount);
    const timer = setTimeout(() => setVisibleCount((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  const allDone = visibleCount >= BOOT_STEPS.length;
  const dimCheck = dark ? "rgba(255,255,255,0.34)" : "rgba(15,23,42,0.35)";

  return (
    <div className="w-full max-w-[440px] os-fade-up">
      {/* Logo + title */}
      <div className="flex items-center gap-3 mb-6">
        <img
          src="/scout-icon.png"
          alt="Scout"
          className="w-9 h-9 rounded-lg shrink-0"
          style={{
            boxShadow: `0 2px 8px ${dark ? "rgba(0,0,0,0.4)" : "rgba(15,23,42,0.08)"}`,
          }}
        />
        <div className="min-w-0">
          <div
            className="text-[15px] font-semibold tracking-tight"
            style={styles.inkText}
          >
            Scout
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.18em]"
            style={styles.mutedText}
          >
            Initializing
          </div>
        </div>
      </div>

      {/* Boot log — fixed vertical frame; lines from top, cursor anchored bottom */}
      <div
        className="rounded-lg border overflow-hidden font-mono text-[11px] leading-[1.7] flex flex-col"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.termBg,
          color: colors.termFg,
          minHeight: TERMINAL_MIN_H,
        }}
      >
        <div className="flex flex-col flex-1 px-3 py-2.5 min-h-0">
          <div className="space-y-px shrink-0">
            {BOOT_STEPS.slice(0, visibleCount).map((step, i) => {
              const isCurrent = i === visibleCount - 1 && !allDone;
              return (
                <div
                  key={step.label}
                  className="os-boot-line flex items-center gap-2 min-h-[1.7em]"
                >
                  <span
                    className="os-boot-prompt w-[10px] shrink-0 text-center tabular-nums"
                    style={{
                      color: isCurrent ? colors.accent : dimCheck,
                      opacity: isCurrent ? 1 : 0.85,
                    }}
                    aria-hidden
                  >
                    {isCurrent ? ">" : "✓"}
                  </span>
                  <span
                    className="os-boot-line-text min-w-0 truncate"
                    style={{ opacity: isCurrent ? 1 : 0.52 }}
                  >
                    {step.label}
                  </span>
                  <span
                    className="os-boot-line-text shrink-0"
                    style={{ opacity: isCurrent ? 0.35 : 0.22 }}
                  >
                    {step.detail}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex-1 min-h-[6px]" aria-hidden />
          <div className="shrink-0 min-h-[1.25rem] flex items-center gap-2 pt-0.5">
            <span
              className="os-boot-cursor-row inline-flex items-center"
              style={{ opacity: allDone ? 0 : 1 }}
              aria-hidden={allDone}
            >
              <span
                className="os-boot-cursor inline-block w-[6px] h-[13px] rounded-[1px]"
                style={{ backgroundColor: colors.accent }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* Status below the terminal — inset-x-3 matches terminal px-3 so captions line up with log text */}
      <div className="relative mt-5 h-5">
        <div
          className="os-boot-footer-track absolute inset-x-3 top-0 bottom-0 flex items-center gap-3 min-w-0"
          style={{
            opacity: allDone ? 0 : 1,
            transform: allDone ? "translateY(2px)" : "translateY(0)",
            pointerEvents: allDone ? "none" : "auto",
          }}
        >
          <div className={`${FOOTER_LEAD_W} shrink-0`} aria-hidden />
          <span
            className="text-[10px] font-mono tabular-nums tracking-tight leading-none"
            style={styles.mutedText}
          >
            {visibleCount} of {BOOT_STEPS.length}
          </span>
        </div>
        <div
          className="os-boot-footer-track absolute inset-x-3 top-0 bottom-0 flex items-center gap-3 min-w-0"
          style={{
            opacity: allDone ? 1 : 0,
            transform: allDone ? "translateY(0)" : "translateY(-2px)",
            pointerEvents: allDone ? "auto" : "none",
          }}
        >
          <div
            className={`os-boot-footer-lead ${FOOTER_LEAD_W} shrink-0 flex items-center justify-center`}
            aria-hidden
          >
            <div className="os-boot-wait-wave-wrap">
              <BootLoaderWaveSvg color={colors.accent} />
            </div>
            <div className="os-boot-wait-static-row">
              {[0.8, 0.5, 0.25].map((o, i) => (
                <span
                  key={i}
                  className="w-[3px] h-1 rounded-[1px]"
                  style={{ backgroundColor: colors.accent, opacity: o }}
                />
              ))}
            </div>
          </div>
          <span
            className="text-[10px] font-mono tracking-tight leading-none truncate"
            style={styles.mutedText}
          >
            Finishing up
          </span>
        </div>
      </div>
    </div>
  );
}
