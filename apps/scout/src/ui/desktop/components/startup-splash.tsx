import { useEffect, useRef, useState } from "react";

const C = {
  bg: "var(--os-bg)",
  ink: "var(--os-ink)",
  muted: "var(--os-muted)",
  logoBg: "var(--os-logo-bg)",
  logoBorder: "var(--os-logo-border)",
};

const DISPLAY_MS = 1100;
const EXIT_MS = 320;

type Phase = "show" | "exit";

export function StartupSplashOverlay({
  dark,
  productName,
  onDismissed,
}: {
  dark: boolean;
  productName: string;
  onDismissed: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("show");
  const dismissed = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const showTimer = window.setTimeout(() => {
      setPhase("exit");
    }, DISPLAY_MS);

    const doneTimer = window.setTimeout(() => {
      if (!dismissed.current) {
        dismissed.current = true;
        onDismissed();
      }
    }, DISPLAY_MS + EXIT_MS);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(doneTimer);
    };
  }, [mounted, onDismissed]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center font-sans os-splash-root${dark ? " dark" : ""}`}
      style={{ backgroundColor: C.bg, color: C.ink }}
      aria-hidden
    >
      <div
        className={`flex flex-col items-center gap-6 px-8 ${phase === "exit" ? "os-splash-exit" : ""}`}
      >
        <div
          className="rounded-[22px] border overflow-hidden os-splash-logo-tile"
          style={{
            borderColor: C.logoBorder,
            backgroundColor: C.logoBg,
            boxShadow: dark
              ? "0 24px 80px rgba(0,0,0,0.45)"
              : "0 24px 80px rgba(15,23,42,0.10)",
          }}
        >
          <img
            src="/scout-icon.png"
            alt=""
            width={96}
            height={96}
            className="block h-[96px] w-[96px] rounded-[22px]"
            draggable={false}
          />
        </div>
        <div
          className="text-[22px] font-semibold tracking-tight os-splash-wordmark"
          style={{ color: C.ink }}
        >
          {productName}
        </div>
      </div>
    </div>
  );
}
