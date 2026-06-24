import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type {
  Agent,
  AgentObservePayload,
  ObserveEvent,
  ObserveFile,
  SessionCatalogEntry,
} from "../../lib/types.ts";
import { pathLeaf } from "../agents/model.ts";
import { harnessOf } from "./model.ts";
import "./agents-v2-sheet.css";

type SessionStatus = "running" | "done" | "idle";

const FILE_MARK: Record<ObserveFile["state"], string> = {
  created: "+",
  modified: "~",
  read: "○",
};

function shortRef(id: string): string {
  const clean = id
    .replace(/\.jsonl$/, "")
    .replace(/^c\./, "")
    .replace(/^session[_:-]?/i, "");
  return clean.length <= 10 ? clean : `${clean.slice(0, 8)}…${clean.slice(-3)}`;
}

function tildePath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf("/");
  if (i < 0) return { dir: "", base: path };
  return { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

function fmtCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

function fmtTokens(n: number | undefined | null): string {
  if (!n || n <= 0) return "0";
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

function fmtDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function observeLogText(e: ObserveEvent): string {
  if (e.kind === "tool") {
    const what = e.arg?.trim() || e.text?.trim() || "";
    return `${e.tool ?? "tool"}${what ? ` ${what}` : ""}`.trim();
  }
  return e.text?.trim() || e.kind;
}

function sessionHeadline(events: ObserveEvent[], session: SessionCatalogEntry, agent: Agent): string {
  for (const e of events) {
    if ((e.kind === "message" || e.kind === "ask") && e.text?.trim()) {
      const text = e.text.trim();
      return text.length > 120 ? `${text.slice(0, 117)}…` : text;
    }
  }
  if (session.cwd) return pathLeaf(session.cwd);
  return agent.handle ? `@${agent.handle.replace(/^@+/, "")}` : agent.name;
}

function currentAction(events: ObserveEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.kind === "tool") {
      const text = observeLogText(e);
      if (text) return text;
    }
  }
  return null;
}

function laneStats(events: ObserveEvent[], files: ObserveFile[]) {
  let edits = 0;
  let reads = 0;
  let tools = 0;
  for (const e of events) {
    if (e.kind !== "tool") continue;
    tools += 1;
    const name = (e.tool ?? "").toLowerCase();
    if (name === "edit" || name === "write") edits += 1;
    if (name === "read") reads += 1;
  }
  return { tools, edits, reads, files: files.length, events: events.length };
}

function useCopyFlash() {
  const [hit, setHit] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const copy = useCallback((text: string, id: string) => {
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setHit(id);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHit(null), 1100);
    });
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { hit, copy };
}

function CopyDot({ value, id, hit, copy, label = "Copy" }: {
  value: string;
  id: string;
  hit: string | null;
  copy: (text: string, id: string) => void;
  label?: string;
}) {
  const ok = hit === id;
  return (
    <button
      type="button"
      className={`av2-sheet-copydot${ok ? " av2-sheet-copydot--ok" : ""}`}
      title={ok ? "Copied" : label}
      onClick={(e) => {
        e.stopPropagation();
        copy(value, id);
      }}
    >
      {ok ? "✓" : "⎘"}
    </button>
  );
}

function SecHead({
  id,
  label,
  count,
  actions,
}: {
  id: string;
  label: string;
  count?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="av2-sheet-sechead" id={id}>
      <span className="av2-sheet-sechead-label">{label}</span>
      {count ? <span className="av2-sheet-sechead-count">{count}</span> : null}
      <span className="av2-sheet-sechead-rule" />
      {actions ? <span className="av2-sheet-sechead-actions">{actions}</span> : null}
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="av2-sheet-kv">
      <span className="av2-sheet-kv-k">{label}</span>
      <span className="av2-sheet-kv-v">{children}</span>
    </div>
  );
}

function Ghost({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`av2-sheet-ghost${primary ? " av2-sheet-ghost--primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function FileRow({
  file,
  idx,
  hit,
  copy,
}: {
  file: ObserveFile;
  idx: string;
  hit: string | null;
  copy: (text: string, id: string) => void;
}) {
  const { dir, base } = splitPath(file.path);
  const mark = FILE_MARK[file.state];
  return (
    <div className="av2-sheet-frow">
      <span className={`av2-sheet-fstate av2-sheet-fstate--${file.state}`} aria-hidden>
        {mark}
      </span>
      <span className="av2-sheet-fpath" title={file.path}>
        <span className="av2-sheet-fdir">{dir}</span>
        <span className="av2-sheet-fbase">{base}</span>
      </span>
      <span className="av2-sheet-ftouches">×{file.touches}</span>
      <CopyDot value={file.path} id={`f-${idx}`} hit={hit} copy={copy} label="Copy path" />
    </div>
  );
}

export function AgentsV2SessionDetail({
  agent,
  session,
  active,
  onContinue,
  onResume,
  onObserve,
  onTakeover,
  onTrace,
  canObserve,
  canTakeover,
}: {
  agent: Agent;
  session: SessionCatalogEntry;
  active: boolean;
  onContinue: () => void;
  onResume: () => void;
  onObserve: () => void;
  onTakeover: () => void;
  onTrace: () => void;
  canObserve: boolean;
  canTakeover: boolean;
}) {
  const { hit, copy } = useCopyFlash();
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [phase, setPhase] = useState<"loading" | "loaded">("loading");
  const [readOpen, setReadOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const load = useCallback(async () => {
    if (!active) {
      setObserve(null);
      setPhase("loaded");
      return;
    }
    setPhase("loading");
    const payload = await api<AgentObservePayload>(
      `/api/agents/${encodeURIComponent(agent.id)}/observe`,
    ).catch(() => null);
    setObserve(payload);
    setPhase("loaded");
  }, [active, agent.id]);

  useEffect(() => {
    setObserve(null);
    setReadOpen(false);
    setTranscriptOpen(false);
    void load();
  }, [load, session.id]);

  useBrokerEvents(() => {
    if (active) void load();
  });

  const status: SessionStatus = active ? "running" : session.endedAt ? "done" : "idle";
  const harness = session.harness ?? agent.harness ?? "session";
  const modelRaw = session.model ?? agent.model;
  const model =
    modelRaw && modelRaw.startsWith(`${harness}-`)
      ? modelRaw.slice(harness.length + 1)
      : modelRaw ?? "—";
  const branch = agent.branch?.trim() || (session.cwd ? pathLeaf(session.cwd) : "—");
  const cwd = session.cwd ?? agent.cwd ?? agent.projectRoot ?? "—";
  const events = observe?.data.events ?? [];
  const files = observe?.data.files ?? [];
  const usage = observe?.data.metadata?.usage;
  const sessionMeta = observe?.data.metadata?.session;
  const headline = sessionHeadline(events, session, agent);
  const nowCmd = active ? currentAction(events) : null;
  const turns = sessionMeta?.turnCount ?? usage?.assistantMessages ?? null;
  const ctxUsed = usage?.contextInputTokens ?? 0;
  const ctxTotal = usage?.contextWindowTokens ?? 0;
  const pct = ctxTotal > 0 ? Math.min(100, Math.round((ctxUsed / ctxTotal) * 100)) : null;
  const stats = useMemo(() => laneStats(events, files), [events, files]);
  const hasTrace = active && observe != null;
  const duration = fmtDuration(session.startedAt, session.endedAt);
  const handle = agent.handle?.trim().replace(/^@+/, "") || agent.name;

  const createdFiles = files.filter((f) => f.state === "created");
  const modifiedFiles = files.filter((f) => f.state === "modified");
  const readFiles = files.filter((f) => f.state === "read");
  const changedCount = createdFiles.length + modifiedFiles.length;

  const logLines = events.slice(-10).map((e) => ({
    t: e.at ?? e.t ? timeAgo(e.at ?? e.t) : "",
    text: observeLogText(e),
    kind: e.kind,
  }));

  const statusLabel =
    status === "running" ? "working" : status === "done" ? "ended" : "idle";

  return (
    <aside className="av2-sheet">
      <header className="av2-sheet-head">
        <AgentAvatar agent={agent} size={34} tile presence={active} />
        <div className="av2-sheet-ident">
          <span className="av2-sheet-name" title={headline}>
            {headline}
            <CopyDot value={headline} id="headline" hit={hit} copy={copy} />
          </span>
          <span className="av2-sheet-sub">
            {active ? <span className="av2-sheet-working-dot" aria-hidden /> : null}
            {statusLabel}
            {active ? " · now" : session.endedAt ? ` · ${timeAgo(session.endedAt)}` : ` · ${timeAgo(session.startedAt)}`}
            {turns != null ? ` · turn #${turns}` : ""}
          </span>
        </div>
        <span className="av2-sheet-harness" title={harness}>
          <HarnessMark harness={harnessOf(harness)} size={14} />
          <span>{harness}</span>
        </span>
      </header>

      {hasTrace ? (
        <nav className="av2-sheet-anchor" aria-label="Session sections">
          <a className="av2-sheet-anchor-link" href="#av2-sec-runtime">
            Runtime
          </a>
          <a className="av2-sheet-anchor-link" href="#av2-sec-usage">
            Usage
          </a>
          <a className="av2-sheet-anchor-link" href="#av2-sec-files">
            Files <span className="av2-sheet-anchor-n">{changedCount}</span>
          </a>
          <a className="av2-sheet-anchor-link" href="#av2-sec-transcript">
            Trace
          </a>
          <span className="av2-sheet-anchor-spacer" />
          {pct != null ? <span className="av2-sheet-anchor-ctx">{pct}% ctx</span> : null}
        </nav>
      ) : null}

      <div className="av2-sheet-scroll">
        {phase === "loading" ? (
          <div className="av2-sheet-loading">Loading session…</div>
        ) : (
          <>
            {nowCmd ? (
              <section className="av2-sheet-now">
                <div className="av2-sheet-now-action">
                  <span className="av2-sheet-now-prompt" aria-hidden>
                    ❯
                  </span>
                  <span className="av2-sheet-now-cmd" title={nowCmd}>
                    {nowCmd}
                  </span>
                  <CopyDot value={nowCmd} id="now" hit={hit} copy={copy} label="Copy command" />
                </div>
                <div className="av2-sheet-statstrip">
                  {(
                    [
                      ["tools", stats.tools],
                      ["edits", stats.edits],
                      ["reads", stats.reads],
                      ["files", stats.files],
                      ["events", stats.events],
                    ] as const
                  ).map(([label, n]) => (
                    <span className="av2-sheet-stat" key={label}>
                      <b>{n}</b> {label}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="av2-sheet-actions">
              <Ghost primary onClick={active ? onContinue : onResume}>
                {active ? "Steer session" : "Resume session"}
              </Ghost>
              {active ? (
                <>
                  <Ghost onClick={onTrace}>Open trace</Ghost>
                  <Ghost onClick={onObserve} disabled={!canObserve}>
                    Observe
                  </Ghost>
                  <Ghost onClick={onTakeover} disabled={!canTakeover}>
                    Take over
                  </Ghost>
                </>
              ) : null}
            </section>

            <SecHead id="av2-sec-runtime" label="Runtime" />
            <div className="av2-sheet-kvgrid">
              <KV label="agent">
                <span className="av2-sheet-cval">@{handle}</span>
              </KV>
              <KV label="model">
                <span className="av2-sheet-cval">{model}</span>
              </KV>
              <KV label="branch">
                <span className="av2-sheet-cval">
                  {branch}
                  <CopyDot value={branch} id="branch" hit={hit} copy={copy} />
                </span>
              </KV>
              <KV label="cwd">
                <span className="av2-sheet-cval" title={cwd}>
                  {tildePath(cwd)}
                  <CopyDot value={cwd} id="cwd" hit={hit} copy={copy} />
                </span>
              </KV>
              <KV label="session">
                <span className="av2-sheet-cval" title={session.id}>
                  #{shortRef(session.id)}
                  <CopyDot value={session.id} id="session" hit={hit} copy={copy} />
                </span>
              </KV>
              <KV label="span">
                <span className="av2-sheet-cval">{active ? `${duration} · live` : duration}</span>
              </KV>
            </div>

            {hasTrace ? (
              <>
                <SecHead id="av2-sec-usage" label="Usage" />
                <div className="av2-sheet-usage">
                  {(
                    [
                      ["in", fmtCount(usage?.inputTokens)],
                      ["out", fmtCount(usage?.outputTokens)],
                      ["cache rd", fmtCount(usage?.cacheReadInputTokens)],
                      ["cache wr", fmtCount(usage?.cacheCreationInputTokens)],
                      ["total", fmtCount(usage?.totalTokens)],
                    ] as const
                  ).map(([label, value]) => (
                    <span className="av2-sheet-ucell" key={label}>
                      <span className="av2-sheet-ucell-n">{value}</span>
                      <span className="av2-sheet-ucell-l">{label}</span>
                    </span>
                  ))}
                  <span className="av2-sheet-ucell av2-sheet-ucell--ctx">
                    <span className="av2-sheet-ucell-n">{pct ?? 0}%</span>
                    <span className="av2-sheet-ucell-l">context</span>
                    {pct != null ? (
                      <span className="av2-sheet-ctxbar" aria-hidden>
                        <span className="av2-sheet-ctxbar-fill" style={{ width: `${pct}%` }} />
                      </span>
                    ) : null}
                  </span>
                </div>

                <SecHead
                  id="av2-sec-files"
                  label="Files"
                  count={`${changedCount} changed · ${readFiles.length} read`}
                />
                {files.length === 0 ? (
                  <div className="av2-sheet-empty">No files touched yet.</div>
                ) : (
                  <>
                    {createdFiles.length > 0 ? (
                      <div className="av2-sheet-filegroup">
                        <div className="av2-sheet-fglabel">
                          <span className="av2-sheet-fgmark av2-sheet-fgmark--new" aria-hidden />
                          NEW <span className="av2-sheet-fgn">{createdFiles.length}</span>
                        </div>
                        {createdFiles.map((f, i) => (
                          <FileRow key={f.path} file={f} idx={`new-${i}`} hit={hit} copy={copy} />
                        ))}
                      </div>
                    ) : null}
                    {modifiedFiles.length > 0 ? (
                      <div className="av2-sheet-filegroup">
                        <div className="av2-sheet-fglabel">
                          <span className="av2-sheet-fgmark av2-sheet-fgmark--mod" aria-hidden />
                          MODIFIED <span className="av2-sheet-fgn">{modifiedFiles.length}</span>
                        </div>
                        {modifiedFiles.map((f, i) => (
                          <FileRow key={f.path} file={f} idx={`mod-${i}`} hit={hit} copy={copy} />
                        ))}
                      </div>
                    ) : null}
                    {readFiles.length > 0 ? (
                      <div className="av2-sheet-filegroup">
                        <button
                          type="button"
                          className="av2-sheet-fglabel av2-sheet-fglabel--btn"
                          onClick={() => setReadOpen((open) => !open)}
                        >
                          <span className="av2-sheet-fgcaret" data-open={readOpen || undefined} aria-hidden>
                            ▸
                          </span>
                          <span className="av2-sheet-fgmark av2-sheet-fgmark--read" aria-hidden />
                          READ <span className="av2-sheet-fgn">{readFiles.length}</span>
                          {!readOpen ? <span className="av2-sheet-fghint">collapsed</span> : null}
                        </button>
                        {readOpen
                          ? readFiles.map((f, i) => (
                              <FileRow key={f.path} file={f} idx={`read-${i}`} hit={hit} copy={copy} />
                            ))
                          : null}
                      </div>
                    ) : null}
                  </>
                )}

                <SecHead
                  id="av2-sec-transcript"
                  label="Trace"
                  count={turns != null ? `${turns} turns` : `${events.length} events`}
                  actions={
                    <Ghost onClick={() => setTranscriptOpen((open) => !open)}>
                      {transcriptOpen ? "Collapse" : "Expand"}
                    </Ghost>
                  }
                />
                {transcriptOpen ? (
                  <div className="av2-sheet-log">
                    {logLines.length === 0 ? (
                      <div className="av2-sheet-empty">No activity captured yet.</div>
                    ) : (
                      logLines.map((line, i) => (
                        <div key={i} className="av2-sheet-log-line" data-kind={line.kind}>
                          <span className="av2-sheet-log-t">{line.t}</span>
                          <span className="av2-sheet-log-text">{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="av2-sheet-log-preview">
                    {logLines.slice(-3).map((line, i) => (
                      <div key={i} className="av2-sheet-log-line" data-kind={line.kind}>
                        <span className="av2-sheet-log-t">{line.t}</span>
                        <span className="av2-sheet-log-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="av2-sheet-empty av2-sheet-empty--trace">
                {active
                  ? "No live trace for this session yet."
                  : "Prior session — resume to reopen and inspect its work trace."}
              </div>
            )}

            <footer className="av2-sheet-foot">
              session <span className="av2-sheet-foot-id">{shortRef(session.id)}</span>
              {hasTrace ? ` · ${stats.events} events` : ""}
              {active ? " · live" : ""}
            </footer>
          </>
        )}
      </div>
    </aside>
  );
}