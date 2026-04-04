import { useEffect, useState } from "react";

const C = {
  bg: "var(--os-bg)",
  ink: "var(--os-ink)",
  muted: "var(--os-muted)",
  logoBg: "var(--os-logo-bg)",
  logoBorder: "var(--os-logo-border)",
};

const HOLD_MS = 1200;
const EXIT_MS = 380;

type Phase = "play" | "exit";

export function StartupSplashOverlay({
  dark,
  productName,
  onDismissed,
}: {
  dark: boolean;
  productName: string;
  onDismissed: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("play");

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setPhase("exit"), HOLD_MS);
    const doneTimer = window.setTimeout(() => onDismissed(), HOLD_MS + EXIT_MS);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDismissed]);

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center font-sans os-splash-root${dark ? " dark" : ""}`}
      style={{ backgroundColor: C.bg, color: C.ink }}
      aria-hidden
    >
      <div
        className={`flex flex-col items-center gap-8 px-8 ${phase === "exit" ? "os-splash-exit" : ""}`}
      >
        <div className="os-splash-logo-wrap">
          <div
            className="os-splash-logo-tile rounded-[28px] border overflow-hidden shadow-2xl"
            style={{
              borderColor: C.logoBorder,
              backgroundColor: C.logoBg,
              boxShadow: dark ? "0 32px 100px rgba(0,0,0,0.55)" : "0 32px 100px rgba(15,23,42,0.12)",
            }}
          >
            <img
              src="/icon.svg"
              alt=""
              width={120}
              height={120}
              className="block w-[120px] h-[120px] os-splash-logo-img"
              draggable={false}
            />
          </div>
          <div className="os-splash-ring" aria-hidden />
        </div>
        <div className="flex flex-col items-center gap-2 text-center os-splash-wordmark">
          <div
            className="text-[13px] font-mono uppercase tracking-[0.28em]"
            style={{ color: C.muted }}
          >
            OpenScout
          </div>
          <div className="text-[26px] font-semibold tracking-tight" style={{ color: C.ink }}>
            {productName}
          </div>
        </div>
      </div>
    </div>
  );
}
