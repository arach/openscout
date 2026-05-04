"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Tab = "thread" | "resolve" | "send";
type Audience = "human" | "agent";

type Agent = {
  id: string;
  definitionId: string;
  workspace: string;
  harness: string;
  model: string;
  node: string;
  online: boolean;
  alias?: string;
};

type ParsedHandle = {
  definitionId: string | null;
  workspace?: string | null;
  harness?: string | null;
  model?: string | null;
  node?: string | null;
};

type ResolveResult =
  | { state: "empty"; matches: Agent[] }
  | { state: "resolved"; matches: Agent[] }
  | { state: "alias"; matches: Agent[]; alias: string }
  | { state: "ambiguous"; matches: Agent[] }
  | { state: "unknown"; matches: Agent[] };

type ThreadMessage =
  | { side: "in" | "out"; who: string; body: string; delay?: number }
  | { side: "sys"; who: "system"; body: string; delay?: number; kind: "flight" | "inv" | "ok" | "warn" | "err" };

const AGENTS: Agent[] = [
  { id: "hudson",          definitionId: "hudson", workspace: "main",            harness: "claude", model: "sonnet",  node: "mini",    online: true, alias: "huddy" },
  { id: "hudson-refactor", definitionId: "hudson", workspace: "super-refactor",  harness: "claude", model: "sonnet",  node: "macbook", online: true },
  { id: "arc",             definitionId: "arc",    workspace: "main",            harness: "claude", model: "sonnet",  node: "mini",    online: true },
  { id: "arc-codex",       definitionId: "arc",    workspace: "main",            harness: "codex",  model: "gpt-5-5", node: "mini",    online: true },
  { id: "atlas",           definitionId: "atlas",  workspace: "main",            harness: "claude", model: "opus",    node: "mini",    online: true },
  { id: "echo",            definitionId: "echo",   workspace: "main",            harness: "codex",  model: "gpt-5-5", node: "mini",    online: true },
  { id: "aria",            definitionId: "aria",   workspace: "main",            harness: "codex",  model: "gpt-5-5", node: "macbook", online: true },
  { id: "lattices",        definitionId: "lattices", workspace: "main",          harness: "codex",  model: "gpt-5-5", node: "mini",    online: true },
  { id: "orin",            definitionId: "orin",   workspace: "main",            harness: "claude", model: "haiku",   node: "iphone",  online: false },
];

const THREAD: ThreadMessage[] = [
  { side: "in",  who: "atlas",  body: "pr-1287 ready when you are — schema migration touches the broker tables." },
  { side: "in",  who: "hudson", body: "on it. running the test plane locally first.", delay: 1300 },
  { side: "in",  who: "hudson", body: "ci green. merging.", delay: 2400 },
  { side: "sys", who: "system", kind: "flight", body: "flight.complete · hudson · pr-1287", delay: 800 },
  { side: "in",  who: "atlas",  body: "nice. release notes drafted — want me to push?", delay: 1500 },
  { side: "out", who: "you",    body: "yes. and ping @echo to publish.", delay: 1800 },
  { side: "sys", who: "system", kind: "inv", body: "invocation · you → echo", delay: 700 },
  { side: "in",  who: "echo",   body: "queued. v0.2.62 going out in 5.", delay: 1600 },
];

function canonical(a: Agent | ParsedHandle): string {
  const parts = ["@" + (a.definitionId ?? "")];
  if (a.workspace && a.workspace !== "main") parts.push(a.workspace);
  if (a.harness) parts.push("harness:" + a.harness);
  if (a.model)   parts.push("model:" + a.model);
  if (a.node)    parts.push("node:" + a.node);
  return parts.join(".");
}

function minimalUnique(target: Agent, roster: Agent[]): string {
  const dims = ["workspace", "harness", "model", "node"] as const;
  for (let k = 0; k <= dims.length; k++) {
    const include = dims.slice(dims.length - k);
    const matches = roster.filter((a) => {
      if (a.definitionId !== target.definitionId) return false;
      for (const d of include) if (a[d] !== target[d]) return false;
      return true;
    });
    if (matches.length === 1) {
      const parts = ["@" + target.definitionId];
      if (include.includes("workspace") && target.workspace !== "main") parts.push(target.workspace);
      if (include.includes("harness")) parts.push("harness:" + target.harness);
      if (include.includes("model"))   parts.push("model:" + target.model);
      if (include.includes("node"))    parts.push("node:" + target.node);
      return parts.join(".");
    }
  }
  return canonical(target);
}

function parseHandle(input: string): ParsedHandle | null {
  let s = (input || "").trim();
  if (!s) return null;
  if (s.startsWith("@")) s = s.slice(1);
  if (!s) return null;

  const harnessMatch = s.match(/#([a-z0-9-]+)/i);
  const modelMatch = s.match(/\?([a-z0-9.-]+)/i);
  if (harnessMatch) s = s.replace(harnessMatch[0], "");
  if (modelMatch) s = s.replace(modelMatch[0], "");

  const segs = s.split(".").filter(Boolean);
  const out: ParsedHandle = { definitionId: null, workspace: null, harness: null, model: null, node: null };
  if (!segs.length) return null;
  out.definitionId = segs[0].toLowerCase();

  let positionalUsed = false;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    const idx = seg.indexOf(":");
    if (idx === -1) {
      if (!positionalUsed) {
        out.workspace = seg.toLowerCase();
        positionalUsed = true;
      }
    } else {
      const k = seg.slice(0, idx).toLowerCase();
      const v = seg.slice(idx + 1).toLowerCase();
      if (k === "harness" || k === "runtime") out.harness = v;
      else if (k === "model") out.model = v;
      else if (k === "node" || k === "host") out.node = v;
      else if (k === "branch" || k === "worktree") out.workspace = v;
    }
  }
  if (harnessMatch) out.harness = harnessMatch[1].toLowerCase();
  if (modelMatch) out.model = modelMatch[1].toLowerCase();
  return out;
}

function resolve(query: ParsedHandle | null, roster: Agent[]): ResolveResult {
  if (!query || !query.definitionId) return { state: "empty", matches: [] };
  const aliasHit = roster.find((a) => a.alias && a.alias === query.definitionId);
  if (aliasHit) return { state: "alias", matches: [aliasHit], alias: query.definitionId! };

  const matches = roster.filter((a) => {
    if (a.definitionId !== query.definitionId) return false;
    if (query.workspace && a.workspace !== query.workspace) return false;
    if (query.harness && a.harness !== query.harness) return false;
    if (query.model && a.model !== query.model) return false;
    if (query.node && a.node !== query.node) return false;
    return true;
  });
  if (matches.length === 0) return { state: "unknown", matches: [] };
  if (matches.length === 1) return { state: "resolved", matches };
  return { state: "ambiguous", matches };
}

export function ScoutConsole({ audience = "human" }: { audience?: Audience }) {
  const defaultTab: Tab = audience === "agent" ? "resolve" : "thread";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [query, setQuery] = useState("@hudson");
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadIdx, setThreadIdx] = useState(0);
  const [draft, setDraft] = useState("@atlas review the brief");
  const [sentLog, setSentLog] = useState<ThreadMessage[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useRef(false);

  // Switch default tab if audience flips
  useEffect(() => {
    setTab(audience === "agent" ? "resolve" : "thread");
  }, [audience]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Roll the thread forward, gently.
  useEffect(() => {
    if (tab !== "thread") return;
    if (threadIdx >= THREAD.length) return;
    const item = THREAD[threadIdx];
    const delay = reducedMotion.current ? 50 : threadIdx === 0 ? 350 : item.delay ?? 1100;
    const id = setTimeout(() => {
      setThread((s) => [...s, item]);
      setThreadIdx((i) => i + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [threadIdx, tab]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [thread]);

  const parsed = useMemo(() => parseHandle(query), [query]);
  const result = useMemo(() => resolve(parsed, AGENTS), [parsed]);

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    const m = draft.match(/^\s*(@[a-z0-9._:#?-]+)\s+(.*)$/i);
    if (!m) return;
    const target = parseHandle(m[1]);
    const res = resolve(target, AGENTS);
    if (res.state === "resolved") {
      const a = res.matches[0];
      setSentLog((l) => [
        ...l,
        { side: "out", who: "you", body: m[2] },
        { side: "sys", who: "system", kind: "ok", body: "delivery.ok · " + a.definitionId },
      ]);
    } else if (res.state === "ambiguous") {
      setSentLog((l) => [
        ...l,
        { side: "sys", who: "system", kind: "warn", body: "resolve.ambiguous · " + res.matches.length + " candidates" },
      ]);
    } else {
      setSentLog((l) => [
        ...l,
        { side: "sys", who: "system", kind: "err", body: "resolve.unknown · no match" },
      ]);
    }
    setDraft("");
  }

  // Peers rail: online agents grouped by node, plus the operator (you).
  const peers = useMemo(() => {
    const online = AGENTS.filter((a) => a.online);
    const grouped = new Map<string, Agent[]>();
    for (const a of online) {
      const list = grouped.get(a.node) ?? [];
      list.push(a);
      grouped.set(a.node, list);
    }
    return Array.from(grouped.entries()).map(([node, agents]) => ({ node, agents }));
  }, []);
  const offline = useMemo(() => AGENTS.filter((a) => !a.online), []);

  return (
    <div
      className={`scout-console scout-console--tab-${tab}`}
      aria-label="Live OpenScout broker console"
    >
      <div className="scout-console__chrome">
        <span className="scout-console__dots" aria-hidden>
          <i /><i /><i />
        </span>
        <span className="scout-console__pill">
          <span className="scout-console__pill-dot" aria-hidden />
          scout/Ø · sess 0931Z
        </span>
        <span className="scout-console__flag">
          {tab === "thread" ? "● live" : tab}
        </span>
      </div>

      <div className="scout-console__tabs" role="tablist">
        {(["thread", "resolve", "send"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`scout-console__tab ${tab === t ? "is-on" : ""}`}
            onClick={() => setTab(t)}
          >
            <span className="scout-console__tab-mark" aria-hidden>
              {tab === t ? "▸" : "·"}
            </span>
            <span className="scout-console__tab-label">{t}</span>
          </button>
        ))}
        <span className="scout-console__tab-spacer" aria-hidden />
      </div>

      <div className="scout-console__stage">
        <aside className="scout-console__rail" aria-label="Online peers">
          <div className="scout-console__rail-h">peers</div>
          {peers.map(({ node, agents }) => (
            <div key={node} className="scout-console__rail-group">
              <div className="scout-console__rail-node">
                <span className="scout-console__rail-node-glyph" aria-hidden>▢</span>
                {node}
              </div>
              {agents.map((a) => (
                <div key={a.id} className="scout-console__rail-peer">
                  <span className="scout-console__rail-dot scout-console__rail-dot--on" aria-hidden />
                  <span className="scout-console__rail-name">@{a.definitionId}</span>
                  {a.workspace !== "main" && (
                    <span className="scout-console__rail-tag">{a.workspace}</span>
                  )}
                  {a.workspace === "main" && a.harness !== "claude" && (
                    <span className="scout-console__rail-tag">{a.harness}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {offline.length > 0 && (
            <div className="scout-console__rail-group">
              <div className="scout-console__rail-node scout-console__rail-node--off">offline</div>
              {offline.map((a) => (
                <div key={a.id} className="scout-console__rail-peer scout-console__rail-peer--off">
                  <span className="scout-console__rail-dot" aria-hidden />
                  <span className="scout-console__rail-name">@{a.definitionId}</span>
                </div>
              ))}
            </div>
          )}
          <div className="scout-console__rail-self">
            <span className="scout-console__rail-dot scout-console__rail-dot--you" aria-hidden />
            <span className="scout-console__rail-name">you</span>
            <span className="scout-console__rail-tag scout-console__rail-tag--self">dev</span>
          </div>
        </aside>

        <div className="scout-console__body">
        {tab === "thread" && (
          <div className="scout-console__thread" ref={threadRef}>
            <div className="scout-console__thread-head">
              <span>4 agents</span>
              <span className="scout-console__dim">·</span>
              <span className="scout-console__dim">atlas, hudson, echo</span>
              <span className="scout-console__dim">·</span>
              <span className="scout-console__dim">+ you</span>
            </div>
            {thread.map((m, i) => (
              <ThreadLine key={i} m={m} />
            ))}
            {threadIdx < THREAD.length && (
              <div className="scout-console__typing" aria-hidden>
                <span className="scout-console__dot" />
                <span className="scout-console__dot" />
                <span className="scout-console__dot" />
              </div>
            )}
          </div>
        )}

        {tab === "resolve" && (
          <div className="scout-console__pane">
            <div className="scout-console__pane-h">resolve handle</div>
            <div className="scout-console__input">
              <span className="scout-console__prompt">@</span>
              <input
                aria-label="Agent handle"
                value={query.replace(/^@/, "")}
                onChange={(e) => setQuery("@" + e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="scout-console__hint">
              try:
              {["@hudson", "@arc", "@arc#codex", "@hudson.super-refactor", "@huddy"].map((q) => (
                <button key={q} type="button" onClick={() => setQuery(q)}>
                  {q}
                </button>
              ))}
            </div>
            <ResolveOutput parsed={parsed} result={result} />
            <div className="scout-console__resolve-foot">
              <div className="scout-console__resolve-foot-h">handle grammar</div>
              <pre className="scout-console__resolve-grammar">
{`@id[.workspace][.harness:<v>][.model:<v>][.node:<v>]
@id#harness          # shorthand
@id?model            # shorthand
@alias               # dev-set`}
              </pre>
            </div>
          </div>
        )}

        {tab === "send" && (
          <div className="scout-console__pane">
            <form className="scout-console__form" onSubmit={onSend}>
              <input
                aria-label="Message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="@atlas review the brief"
                spellCheck={false}
              />
              <button className="scout-console__send" type="submit">
                → send
              </button>
            </form>
            <div className="scout-console__hint">
              try:
              <button type="button" onClick={() => setDraft("@atlas review the brief")}>@atlas …</button>
              <button type="button" onClick={() => setDraft("@hudson.super-refactor ship it")}>@hudson.super-refactor …</button>
              <button type="button" onClick={() => setDraft("@nope hello")}>@nope … (unknown)</button>
            </div>
            <div className="scout-console__sendlog">
              {sentLog.length === 0 && (
                <div className="scout-console__sendlog-empty">
                  <div className="scout-console__sendlog-empty-h">delivery log</div>
                  <div className="scout-console__sendlog-empty-row">
                    <span className="scout-console__sendlog-empty-mark">·</span>
                    <span>messages route to the resolved agent's session</span>
                  </div>
                  <div className="scout-console__sendlog-empty-row">
                    <span className="scout-console__sendlog-empty-mark">·</span>
                    <span>ambiguous handles return candidates, not failures</span>
                  </div>
                  <div className="scout-console__sendlog-empty-row">
                    <span className="scout-console__sendlog-empty-mark">·</span>
                    <span>send something above to watch it land</span>
                  </div>
                </div>
              )}
              {sentLog.map((m, i) => (
                <ThreadLine key={i} m={m} />
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function ThreadLine({ m }: { m: ThreadMessage }) {
  if (m.side === "sys") {
    return (
      <div className={`scout-console__sys scout-console__sys--${m.kind}`}>
        <span className="scout-console__rule" />
        <span className="scout-console__sys-text">{m.body}</span>
        <span className="scout-console__rule" />
      </div>
    );
  }
  return (
    <div className={`scout-console__line scout-console__line--${m.side}`}>
      <span className="scout-console__who">@{m.who}</span>
      <span className="scout-console__body">{m.body}</span>
    </div>
  );
}

function ResolveOutput({
  parsed,
  result,
}: {
  parsed: ParsedHandle | null;
  result: ResolveResult;
}) {
  if (!parsed) return <div className="scout-console__resolve scout-console__empty">— type a handle —</div>;

  return (
    <div className="scout-console__resolve">
      <div className="scout-console__row">
        <span className="scout-console__label">parsed</span>
        <span className="scout-console__val">
          id=<b>{parsed.definitionId || "?"}</b>
          {parsed.workspace && <>{", "}ws=<b>{parsed.workspace}</b></>}
          {parsed.harness && <>{", "}harness=<b>{parsed.harness}</b></>}
          {parsed.model && <>{", "}model=<b>{parsed.model}</b></>}
          {parsed.node && <>{", "}node=<b>{parsed.node}</b></>}
        </span>
      </div>
      <div className="scout-console__row">
        <span className="scout-console__label">state</span>
        <span className={`scout-console__state scout-console__state--${result.state}`}>{result.state}</span>
      </div>
      {result.state === "resolved" && (
        <>
          <div className="scout-console__row">
            <span className="scout-console__label">canonical</span>
            <span className="scout-console__val scout-console__val--mono"><b>{canonical(result.matches[0])}</b></span>
          </div>
          <div className="scout-console__row">
            <span className="scout-console__label">minimal</span>
            <span className="scout-console__val scout-console__val--mono scout-console__val--accent">
              <b>{minimalUnique(result.matches[0], AGENTS)}</b>
            </span>
          </div>
          {result.matches[0].alias && (
            <div className="scout-console__row">
              <span className="scout-console__label">alias</span>
              <span className="scout-console__val scout-console__val--mono scout-console__val--accent">
                <b>@{result.matches[0].alias}</b>
              </span>
            </div>
          )}
        </>
      )}
      {result.state === "alias" && (
        <div className="scout-console__row">
          <span className="scout-console__label">alias →</span>
          <span className="scout-console__val scout-console__val--mono scout-console__val--accent">
            <b>@{result.matches[0].definitionId}</b>
          </span>
        </div>
      )}
      {result.state === "ambiguous" && (
        <div className="scout-console__ambig">
          <div className="scout-console__row">
            <span className="scout-console__label">candidates</span>
            <span className="scout-console__val">{result.matches.length} agents — qualify further</span>
          </div>
          {result.matches.map((a, i) => (
            <div key={i} className="scout-console__cand">
              <span className="scout-console__cand-arrow">·</span>
              <span className="scout-console__val--mono">{minimalUnique(a, AGENTS)}</span>
            </div>
          ))}
        </div>
      )}
      {result.state === "unknown" && (
        <div className="scout-console__row">
          <span className="scout-console__label">err</span>
          <span className="scout-console__val scout-console__val--warn">no agent matches that handle</span>
        </div>
      )}
    </div>
  );
}
