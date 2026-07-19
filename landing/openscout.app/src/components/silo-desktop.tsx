"use client";

import { useEffect, useState } from "react";

// The "Without Scout" picture: a cluttered desktop of separate agent tools —
// TUIs and IDE-like windows — cascaded and overlapping. Focus jumps
// between them on its own; only one is ever in front. That's the juggling.
type Win = {
  app: string;
  ctx: string;
  kind: "tui" | "ide";
  title: string;
};

// Lines stay short enough that the cascade occludes between words — a
// clipped identifier reads as a rendering bug in stills, not as clutter.
const WINDOWS: Win[] = [
  { app: "Codex", ctx: "TUI", kind: "tui", title: "plan · tests · edit" },
  { app: "Cursor", ctx: "IDE", kind: "ide", title: "agent pane · diff open" },
  { app: "pi", ctx: "TUI", kind: "tui", title: "reasoning · pending ask" },
  { app: "OpenCode", ctx: "IDE", kind: "ide", title: "worktree · diagnostics" },
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
        <span className="silo-desktop__bar-meta">⌘-tab</span>
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
              <div className={`silo-win__body silo-win__body--${w.kind}`}>
                {w.kind === "ide" ? (
                  <>
                    <div className="silo-win__ide-rail" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="silo-win__ide-main">
                      <div className="silo-win__ide-tabs" aria-hidden>
                        <span />
                        <span />
                      </div>
                      <div className="silo-win__ide-editor" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="silo-win__tui-head" aria-hidden>
                      <span />
                      <span />
                    </div>
                    <div className="silo-win__tui-rows" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                  </>
                )}
                <div className="silo-win__title">{w.title}</div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Caption strip mirrors the mesh figure's anatomy (chrome / stage /
          caption) so the two plates read as siblings; the meta line is the
          honest mirror of "scout + 5 peers · 2 mesh links". */}
      <div className="silo-desktop__caption">
        <span className="silo-desktop__caption-num">Silos</span>
        <span className="silo-desktop__caption-meta">
          {WINDOWS.length} tools · 0 shared links
        </span>
      </div>
    </div>
  );
}
