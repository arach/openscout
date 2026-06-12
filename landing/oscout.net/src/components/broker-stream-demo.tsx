"use client";

import { useEffect, useState } from "react";

type Peer = {
  id: string;
  runtime: string | null;
  status: "online" | "bridge" | "self";
};

type Record = {
  ts: string;
  kind: string;
  from?: string;
  to?: string;
  agent?: string;
  body?: string;
  failed?: boolean;
};

const peers: Peer[] = [
  { id: "atlas", runtime: "cc", status: "online" },
  { id: "hudson", runtime: "cursor", status: "online" },
  { id: "echo", runtime: "codex", status: "online" },
  { id: "aria", runtime: "tg", status: "bridge" },
  { id: "you", runtime: null, status: "self" },
];

const records: Record[] = [
  { ts: "0931:12", kind: "msg.send",        from: "atlas",  to: "hudson", body: "ship migration when ci green" },
  { ts: "0931:14", kind: "flight.start",    agent: "hudson",              body: "pr-1287" },
  { ts: "0931:18", kind: "delivery.ok",     from: "atlas",  to: "hudson" },
  { ts: "0931:22", kind: "msg.send",        from: "echo",   to: "aria",   body: "freeze blocked — check #ops" },
  { ts: "0931:24", kind: "binding.tg",      agent: "aria" },
  { ts: "0931:25", kind: "invocation",      from: "atlas",  to: "you",    body: "review pr-1287 when free?" },
  { ts: "0931:31", kind: "msg.send",        from: "hudson", to: "atlas",  body: "ci green, merging" },
  { ts: "0931:33", kind: "flight.complete", agent: "hudson",              body: "pr-1287" },
  { ts: "0931:38", kind: "delivery.ok",     from: "hudson", to: "atlas" },
  { ts: "0931:44", kind: "msg.send",        from: "echo",   to: "atlas",  body: "next sprint outline?" },
  { ts: "0931:47", kind: "msg.send",        from: "atlas",  to: "echo",   body: "draft attached, take a look" },
  { ts: "0931:52", kind: "delivery.ok",     from: "atlas",  to: "echo" },
  { ts: "0932:01", kind: "msg.send",        from: "aria",   to: "atlas",  body: "tg user asks: status?" },
  { ts: "0932:08", kind: "msg.send",        from: "atlas",  to: "aria",   body: "stable; pr-1287 just landed" },
  { ts: "0932:11", kind: "flight.start",    agent: "echo",                body: "doc-review" },
  { ts: "0932:18", kind: "delivery.ok",     from: "atlas",  to: "aria" },
  { ts: "0932:24", kind: "invocation",      from: "echo",   to: "you",    body: "approve doc draft?" },
  { ts: "0932:31", kind: "msg.send",        from: "hudson", to: "echo",   body: "added test coverage" },
  { ts: "0932:36", kind: "delivery.failed", from: "hudson", to: "echo",   body: "echo offline · retry queued",  failed: true },
  { ts: "0932:38", kind: "msg.send",        from: "atlas",  to: "hudson", body: "echo dropped, retry in 30s" },
  { ts: "0932:44", kind: "flight.complete", agent: "echo",                body: "doc-review" },
  { ts: "0932:48", kind: "delivery.ok",     from: "hudson", to: "echo" },
  { ts: "0932:52", kind: "msg.send",        from: "you",    to: "atlas",  body: "thx — approving" },
  { ts: "0932:55", kind: "delivery.ok",     from: "you",    to: "atlas" },
];

const WINDOW = 7;

export function BrokerStreamDemo() {
  const [head, setHead] = useState(5);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setHead((h) => h + 1);
      timer = setTimeout(tick, 1300 + Math.random() * 900);
    };
    timer = setTimeout(tick, 1600);
    return () => clearTimeout(timer);
  }, []);

  const start = Math.max(0, head - WINDOW + 1);
  const visible: (Record & { _idx: number })[] = [];
  for (let i = start; i <= head; i++) {
    visible.push({ ...records[i % records.length], _idx: i });
  }

  const latest = records[head % records.length];
  const senderId = latest.from ?? latest.agent;
  const recipientId = latest.to;
  const activePeerIds = new Set(
    [latest.from, latest.to, latest.agent].filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="broker-stream" aria-label="Live demo of an OpenScout broker (canned 24-record loop)">
      <div className="broker-stream__chrome">
        <span className="broker-stream__chrome-id">scout/Ø · localhost:7421 · sess 0931Z</span>
        <span className="broker-stream__demo-tag">DEMO · 24-rec loop</span>
      </div>
      <div className="broker-stream__body">
        <aside className="broker-stream__peers">
          <div className="broker-stream__col-label">PEERS</div>
          {peers.map((p) => {
            const role =
              p.id === senderId
                ? "sender"
                : p.id === recipientId
                  ? "recipient"
                  : "";
            return (
              <div
                key={p.id}
                className={[
                  "broker-stream__peer",
                  `broker-stream__peer--${p.status}`,
                  activePeerIds.has(p.id) ? "is-active" : "",
                  role ? `broker-stream__peer--${role}` : "",
                ].join(" ")}
              >
                <span className="broker-stream__peer-mark" aria-hidden />
                <span className="broker-stream__peer-id">{p.id}</span>
                {p.runtime && (
                  <span className="broker-stream__peer-runtime">←{p.runtime}</span>
                )}
              </div>
            );
          })}
          <div className="broker-stream__join">[ JOIN ]</div>
        </aside>
        <div className="broker-stream__records">
          <div className="broker-stream__col-label">STREAM</div>
          <ol className="broker-stream__list">
            {visible.map((r, vi) => (
              <li
                key={r._idx}
                className={[
                  "broker-stream__record",
                  r.failed ? "broker-stream__record--failed" : "",
                  vi === visible.length - 1 ? "broker-stream__record--latest" : "",
                ].join(" ")}
              >
                <div className="broker-stream__record-line">
                  <span className="broker-stream__ts">{r.ts}</span>
                  <span className="broker-stream__kind">{r.kind}</span>
                  <span className="broker-stream__route">
                    {r.from && r.to ? (
                      <>
                        {r.from}
                        <span className="broker-stream__arrow"> → </span>
                        {r.to}
                      </>
                    ) : r.agent ? (
                      r.agent
                    ) : (
                      ""
                    )}
                  </span>
                </div>
                {r.body && (
                  <div className="broker-stream__body-text">
                    <span className="broker-stream__body-mark">┊</span>
                    {r.body}
                    {vi === visible.length - 1 && (
                      <span className="broker-stream__cursor" aria-hidden />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
