import React from "react";

const BOOT_STEPS = [
  { label: "Connecting relay service" },
  { label: "Loading agent availability" },
  { label: "Loading activity history" },
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

const LOADER_MIN_H = "11rem";

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
  const completedCheckColor = dark ? "rgba(241,245,249,0.92)" : "rgba(15,23,42,0.82)";
  const completedCheckBg = dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)";
  const completedCheckBorder = dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)";
  const currentCheckBg = dark ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.035)";

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

      <div
        className="rounded-lg border overflow-hidden font-mono text-[11px] leading-[1.7] flex flex-col"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.termBg,
          color: colors.termFg,
          minHeight: LOADER_MIN_H,
        }}
      >
        <div className="flex flex-col flex-1 px-4 py-3 min-h-0">
          <div className="space-y-2 shrink-0">
            {BOOT_STEPS.map((step, i) => {
              const isVisible = i < visibleCount;
              const isCurrent = i === visibleCount - 1 && !allDone;
              return (
                <div
                  key={step.label}
                  className="os-boot-line flex items-center justify-between gap-3 min-h-[1.9em] rounded-md px-2"
                  style={{
                    backgroundColor: isVisible
                      ? (dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.035)")
                      : "transparent",
                    opacity: isVisible ? 1 : 0.38,
                  }}
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <span
                      className="os-boot-line-text min-w-0 truncate"
                      style={{
                        color: isVisible ? colors.termFg : colors.termFg,
                        opacity: isCurrent ? 1 : isVisible ? 0.72 : 0.45,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                  <div className="shrink-0 min-w-[1.25rem] flex justify-end">
                    {isVisible ? (
                      <span
                        className="os-boot-prompt inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[12px] font-semibold leading-none"
                        style={{
                          color: isCurrent ? colors.accent : completedCheckColor,
                          backgroundColor: isCurrent ? currentCheckBg : completedCheckBg,
                          borderColor: isCurrent ? "transparent" : completedCheckBorder,
                          opacity: isCurrent ? 1 : 0.95,
                        }}
                        aria-hidden
                      >
                        {isCurrent ? "…" : "✓"}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
