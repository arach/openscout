"use client";

import { useEffect, useState } from "react";

type Severity = "sys" | "tool" | "warn" | "err" | "user";

type Row = {
  ts: string;
  pid: string;
  agent: string;
  harness: "scout" | "hudson" | "codex-gui" | "claude-cli" | "unattributed";
  repo: string;
  sev: Severity;
  body: string;
};

const stream: Row[] = [
  { ts: "09:31:12", pid: "32418", agent: "atlas",  harness: "scout",        repo: "openscout",  sev: "tool", body: "tool_use › edit landing/src/app/page.tsx" },
  { ts: "09:31:14", pid: "32418", agent: "atlas",  harness: "scout",        repo: "openscout",  sev: "sys",  body: "stream › 184 tokens · 0.42s ttft" },
  { ts: "09:31:16", pid: "47120", agent: "hudson", harness: "hudson",       repo: "docs",       sev: "tool", body: "tool_use › bash · pnpm typecheck" },
  { ts: "09:31:18", pid: "47120", agent: "hudson", harness: "hudson",       repo: "docs",       sev: "warn", body: "typescript › 2 unused imports in MeshView.tsx" },
  { ts: "09:31:21", pid: "—",     agent: "echo",   harness: "codex-gui",    repo: "scout-ios",  sev: "user", body: "user › regen the activity feed list" },
  { ts: "09:31:23", pid: "51904", agent: "echo",   harness: "codex-gui",    repo: "scout-ios",  sev: "tool", body: "apply_patch › Sources/Activity/Feed.swift" },
  { ts: "09:31:26", pid: "12733", agent: "ghost-1",harness: "unattributed", repo: "—",          sev: "sys",  body: "claude › cwd /tmp/scratch · 3d old · idle" },
  { ts: "09:31:28", pid: "32418", agent: "atlas",  harness: "scout",        repo: "openscout",  sev: "sys",  body: "compact › 24% context retained · 8.2k tokens" },
  { ts: "09:31:31", pid: "47120", agent: "hudson", harness: "hudson",       repo: "docs",       sev: "err",  body: "build › Cannot find module @openscout/protocol/v2" },
  { ts: "09:31:33", pid: "47120", agent: "hudson", harness: "hudson",       repo: "docs",       sev: "tool", body: "tool_use › bash · bun install --frozen-lockfile" },
  { ts: "09:31:36", pid: "51904", agent: "echo",   harness: "codex-gui",    repo: "scout-ios",  sev: "tool", body: "tool_use › xcodebuild · scheme Scout" },
  { ts: "09:31:38", pid: "32418", agent: "atlas",  harness: "scout",        repo: "openscout",  sev: "tool", body: "tool_use › edit landing/src/app/globals.css" },
];

const procs = [
  { agent: "atlas",   pid: "32418", harness: "scout",        repo: "openscout",  rate: 12, status: "active" },
  { agent: "hudson",  pid: "47120", harness: "hudson",       repo: "docs",       rate: 8,  status: "active" },
  { agent: "echo",    pid: "51904", harness: "codex-gui",    repo: "scout-ios",  rate: 6,  status: "active" },
  { agent: "ghost-1", pid: "12733", harness: "unattributed", repo: "—",          rate: 0,  status: "idle"   },
];

const WINDOW = 7;

export function TailFirehoseMock() {
  const [head, setHead] = useState(WINDOW - 1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = setInterval(() => setHead((h) => h + 1), 1100);
    return () => clearInterval(id);
  }, []);

  const start = Math.max(0, head - WINDOW + 1);
  const visible: (Row & { _idx: number })[] = [];
  for (let i = start; i <= head; i++) {
    visible.push({ ...stream[i % stream.length], _idx: i });
  }

  return (
    <div
      className="tail-mock"
      aria-label="Tail firehose — every coding agent on the machine, including unattributed sessions (canned demo)"
    >
      {/* top status strip */}
      <div className="tail-mock__strip">
        <span className="tail-mock__strip-cell tail-mock__strip-brand">TAIL</span>
        <span className="tail-mock__strip-cell">
          <span className="tail-mock__strip-dot" /> studio · solo
        </span>
        <span className="tail-mock__strip-cell">
          <b>4</b> agents
        </span>
        <span className="tail-mock__strip-cell">
          <b>26</b> lines/s
        </span>
        <span className="tail-mock__strip-cell tail-mock__strip-cell--warn">
          <b>1</b> unattributed
        </span>
        <span className="tail-mock__strip-cell tail-mock__strip-spacer" />
        <span className="tail-mock__strip-cell tail-mock__strip-cell--mute">/ filter</span>
        <span className="tail-mock__strip-cell tail-mock__strip-cell--mute">⏎ inspect</span>
      </div>

      {/* process register */}
      <div className="tail-mock__procs">
        <div className="tail-mock__proc-head">
          <span>agent</span>
          <span>pid</span>
          <span>harness</span>
          <span>repo</span>
          <span>rate</span>
        </div>
        {procs.map((p) => (
          <div
            key={p.agent}
            className={[
              "tail-mock__proc",
              p.status === "idle" ? "tail-mock__proc--idle" : "",
            ].join(" ")}
          >
            <span className="tail-mock__proc-agent">
              <span className="tail-mock__proc-mark" /> {p.agent}
            </span>
            <span className="tail-mock__proc-pid">{p.pid}</span>
            <span
              className={`tail-mock__tag tail-mock__tag--${p.harness}`}
            >
              {p.harness}
            </span>
            <span className="tail-mock__proc-repo">{p.repo}</span>
            <span className="tail-mock__proc-rate">
              <span
                className="tail-mock__proc-bar"
                style={{ width: `${Math.min(100, p.rate * 8)}%` }}
              />
              <span className="tail-mock__proc-rate-val">{p.rate}/s</span>
            </span>
          </div>
        ))}
      </div>

      {/* live stream */}
      <div className="tail-mock__stream">
        {visible.map((r) => (
          <div key={r._idx} className={`tail-mock__line tail-mock__line--${r.sev}`}>
            <span className="tail-mock__col-ts">{r.ts}</span>
            <span className="tail-mock__col-agent">{r.agent}</span>
            <span className={`tail-mock__col-tag tail-mock__tag tail-mock__tag--${r.harness}`}>
              {r.harness}
            </span>
            <span className="tail-mock__col-body">{r.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
