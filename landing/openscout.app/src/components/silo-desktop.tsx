"use client";

import { useEffect, useState } from "react";

// The "Without Scout" picture: a cluttered desktop of separate tool windows —
// a terminal, an IDE, a harness CLI — cascaded and overlapping. Focus jumps
// between them on its own; only one is ever in front. That's the juggling.
type Win = {
  app: string;
  ctx: string;
  line: string;
};

const WINDOWS: Win[] = [
  { app: "Codex", ctx: "ui", line: "$ bun run build · 4.2s" },
  { app: "Cursor", ctx: "routes/agents.ts", line: "✎ addressablePeer(id) {" },
  { app: "pi", ctx: "repl", line: "› drafting migration plan" },
  { app: "OpenCode", ctx: "fix-tests", line: "● 3 files changed" },
];

export function SiloDesktop() {
  const [active, setActive] = useState(WINDOWS.length - 1);
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotion(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!motion) return;
    const t = setInterval(() => setActive((a) => (a + 1) % WINDOWS.length), 1300);
    return () => clearInterval(t);
  }, [motion]);

  return (
    <div className="silo-desktop">
      <div className="silo-desktop__bar">
        <span className="silo-desktop__bar-app">Desktop</span>
        <span className="silo-desktop__bar-meta">{WINDOWS.length} tools open · ⌘-tab</span>
      </div>
      <div className="silo-desktop__stage">
        {WINDOWS.map((w, i) => {
          const isActive = i === active;
          return (
            <div
              key={w.app}
              className={`silo-win${isActive ? " is-active" : ""}`}
              style={{
                left: `${7 + i * 11}%`,
                top: `${14 + i * 26}px`,
                zIndex: isActive ? WINDOWS.length + 1 : i + 1,
              }}
            >
              <div className="silo-win__chrome">
                <span className="silo-win__dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="silo-win__app">{w.app}</span>
                <span className="silo-win__ctx">{w.ctx}</span>
              </div>
              <div className="silo-win__body">
                <div className="silo-win__line">{w.line}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
