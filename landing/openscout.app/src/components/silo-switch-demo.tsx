"use client";

import { useEffect, useState } from "react";

// The "before" state: agents siloed across separate terminal tabs. The active
// tab flips on its own — the eye chases it, context never sits still. The
// contrast with the calm mesh beside it is the whole point.
type Tab = {
  id: string;
  harness: string;
  lines: string[];
};

const TABS: Tab[] = [
  { id: "main", harness: "claude", lines: ["› running test plane…", "  142 passed · 0 failed"] },
  { id: "api", harness: "cursor", lines: ["✎ routes/agents.ts", "  + addressable peer lookup"] },
  { id: "ui", harness: "codex", lines: ["$ bun run build", "  done in 4.2s"] },
  { id: "refactor", harness: "claude", lines: ["› git rebase -i main", "  pick 9f2a1c broker tables"] },
  { id: "infra", harness: "codex", lines: ["$ terraform plan", "  ~ 3 to change, 1 to add"] },
];

export function SiloSwitchDemo() {
  const [active, setActive] = useState(0);
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
    const t = setInterval(() => setActive((a) => (a + 1) % TABS.length), 950);
    return () => clearInterval(t);
  }, [motion]);

  const tab = TABS[active];

  return (
    <div className="silo-switch">
      <div className="silo-switch__chrome">
        <span className="silo-switch__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="silo-switch__chrome-id">terminal · {TABS.length} tabs</span>
      </div>
      <div className="silo-switch__tabs" role="tablist" aria-label="agent terminals">
        {TABS.map((t, i) => (
          <span
            key={t.id}
            role="tab"
            aria-selected={i === active}
            className={`silo-switch__tab${i === active ? " is-active" : ""}`}
          >
            {t.harness} · {t.id}
          </span>
        ))}
      </div>
      <div className="silo-switch__screen" key={active}>
        {tab.lines.map((line, i) => (
          <div key={i} className="silo-switch__line">
            {line}
          </div>
        ))}
        <div className="silo-switch__cursor" aria-hidden>
          ▍
        </div>
      </div>
    </div>
  );
}
