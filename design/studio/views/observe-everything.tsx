"use client";

/**
 * THESIS: Observe is one yield ledger, not a dashboard or raw event feed.
 * It refuses separate global, host, and voice products: scope is a predicate.
 * OWN-WORLD: Studio's flat hairlines, neutral planes, mono structure, and one
 * lime accent; state lives in tiny marks, never categorical cards.
 * STORY: See who is doing what, scan recent finished turns across every host,
 * narrow to a machine/harness, then open the exact evidence.
 * FIRST VIEWPORT: Reach and running count in chrome; Scope / Ledger / Evidence;
 * fixed project, actor/runtime, turn, and time columns arrange by recency or
 * project without a priority taxonomy.
 * FORM: Scope lens ledger, assigned surface form 4, seed 9ececf29.
 */

import {
  AudioLines,
  CircleAlert,
  FolderKanban,
  House,
  Laptop,
  MessageSquare,
  Monitor,
  MonitorUp,
  Network,
  Radar,
  ScanText,
  Settings2,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HarnessMark } from "@/components/HarnessMark";
import { StudyHeader } from "@/components/StudyHeader";
import styles from "./observe-everything.module.css";

type HostId = "mini" | "air" | "studio" | "mbp";
type HarnessId = "codex" | "claude";
type YieldState = "waiting" | "completed" | "failed";
type Provenance = "observed" | "recorded";
type Lens = "recent" | "projects";
type PreviewMode = "desktop" | "mobile";

type TranscriptLine = {
  at: string;
  text: string;
};

type YieldRow = {
  id: string;
  host: HostId;
  hostLabel: string;
  harness: HarnessId | null;
  harnessLabel: string;
  agent: string;
  project: string;
  subject: string;
  state: YieldState;
  age: string;
  provenance: Provenance;
  summary: string;
  address: string;
  transcript: TranscriptLine[];
};

const HOSTS: Array<{
  id: HostId;
  label: string;
  icon: typeof Monitor;
  stale?: boolean;
}> = [
  { id: "mini", label: "Arts Mac mini", icon: Monitor },
  { id: "air", label: "Air", icon: Laptop },
  { id: "studio", label: "Studio", icon: MonitorUp },
  { id: "mbp", label: "MacBook Pro", icon: Laptop, stale: true },
];

const YIELDS: YieldRow[] = [
  {
    id: "delivery",
    host: "mini",
    hostLabel: "Arts Mac mini",
    harness: "codex",
    harnessLabel: "Codex",
    agent: "merge-sweeper",
    project: "OpenScout",
    subject: "delivery campaign",
    state: "completed",
    age: "2m",
    provenance: "observed",
    summary: "Finished — merged PRs #538–#542 and verified main CI.",
    address: "scout://turn/mini/codex/session-delivery/turn-42",
    transcript: [
      { at: "14:38", text: "Prepared merge order and checked dependent patches." },
      { at: "14:40", text: "Merged #542; required checks are green." },
      { at: "14:41", text: "Finished — main is clean and the delivery campaign is complete." },
    ],
  },
  {
    id: "permission",
    host: "mini",
    hostLabel: "Arts Mac mini",
    harness: "claude",
    harnessLabel: "Claude",
    agent: "project-seneca",
    project: "OpenScout",
    subject: "broker restart safety",
    state: "waiting",
    age: "12m",
    provenance: "observed",
    summary: "Asked — restart the broker now, or preserve the active flight?",
    address: "scout://turn/mini/claude/session-restart/turn-18",
    transcript: [
      { at: "14:30", text: "The handoff path is verified; one live flight remains." },
      { at: "14:32", text: "I need your decision: restart now or preserve the active flight?" },
      { at: "14:32", text: "Waiting for operator input." },
    ],
  },
  {
    id: "nav",
    host: "air",
    hostLabel: "Air",
    harness: "codex",
    harnessLabel: "Codex",
    agent: "ios-nav",
    project: "Scout iOS",
    subject: "light-mode nav",
    state: "completed",
    age: "19m",
    provenance: "observed",
    summary: "Finished — tightened the liquid-glass pill and increased background separation.",
    address: "scout://turn/air/codex/session-ios-nav/turn-31",
    transcript: [
      { at: "14:19", text: "Compared the simulator with the signed-off Studio study." },
      { at: "14:22", text: "Adjusted material opacity, shadow spread, and selection width." },
      { at: "14:24", text: "Finished — the capture now matches the proposed nav geometry." },
    ],
  },
  {
    id: "hudson",
    host: "air",
    hostLabel: "Air",
    harness: "claude",
    harnessLabel: "Claude",
    agent: "hudson-build",
    project: "Hudson",
    subject: "keyboard integration",
    state: "failed",
    age: "24m",
    provenance: "observed",
    summary: "Failed — HudsonUIKeyboard is unavailable on this branch.",
    address: "scout://turn/air/claude/session-hudson/turn-11",
    transcript: [
      { at: "14:16", text: "Started the focused iOS build." },
      { at: "14:19", text: "xcodebuild failed: no such module HudsonUIKeyboard." },
      { at: "14:19", text: "Stopped — branch dependency is missing." },
    ],
  },
  {
    id: "observe",
    host: "studio",
    hostLabel: "Studio",
    harness: "claude",
    harnessLabel: "Claude · Kimi",
    agent: "observe-kimi",
    project: "OpenScout",
    subject: "Observe model",
    state: "completed",
    age: "36m",
    provenance: "observed",
    summary: "Finished — proposed exact turn refs shared by stream, scope, and voice.",
    address: "scout://turn/studio/kimi/session-observe/turn-07",
    transcript: [
      { at: "14:02", text: "Mapped the three modalities to one addressable object." },
      { at: "14:05", text: "Defined scout://turn/host/harness/session/turn." },
      { at: "14:07", text: "Finished — Scoutbot answers are citation lists, not free prose." },
    ],
  },
  {
    id: "release",
    host: "mini",
    hostLabel: "Arts Mac mini",
    harness: "codex",
    harnessLabel: "Codex",
    agent: "talkie-release",
    project: "Talkie",
    subject: "release notes",
    state: "waiting",
    age: "46m",
    provenance: "observed",
    summary: "Review — approve the App Store copy before submission.",
    address: "scout://turn/mini/codex/session-talkie-release/turn-29",
    transcript: [
      { at: "13:54", text: "Generated the release notes from merged changes." },
      { at: "13:58", text: "Copy is ready for review." },
      { at: "13:58", text: "Waiting for approval before submission." },
    ],
  },
  {
    id: "handoff",
    host: "mini",
    hostLabel: "Arts Mac mini",
    harness: null,
    harnessLabel: "Broker",
    agent: "scoutbot",
    project: "OpenScout",
    subject: "SCO-091 handoff",
    state: "completed",
    age: "53m",
    provenance: "recorded",
    summary: "Handoff — work item SCO-091 moved to session project-seneca.",
    address: "scout://record/mini/work/SCO-091/handoff-03",
    transcript: [
      { at: "13:49", text: "Resolved a compatible Opus runtime." },
      { at: "13:50", text: "Created invocation inv-msc2odlf-mn3io4." },
      { at: "13:50", text: "Scout recorded the handoff to project-seneca." },
    ],
  },
];

const CITED_IDS = ["delivery", "nav", "observe"];

function StateMark({ state }: { state: YieldState }) {
  if (state === "waiting") return <span className={styles.stateWaiting} aria-label="Waiting" />;
  if (state === "failed") return <span className={styles.stateFailed} aria-label="Failed" />;
  return <span className={styles.stateSettled} aria-label="Settled" />;
}

function ProvenanceMark({ value }: { value: Provenance }) {
  return (
    <span className={styles.provenance} data-kind={value}>
      {value === "recorded" ? "● Scout" : "◦ observed"}
    </span>
  );
}

function agentInitials(agent: string) {
  return agent
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function AgentIdentity({ agent, compact = false }: { agent: string; compact?: boolean }) {
  return (
    <span className={styles.agentIdentity} data-compact={compact}>
      <span className={styles.agentBadge} aria-hidden>{agentInitials(agent)}</span>
      <span className={styles.agentName}>{agent}</span>
    </span>
  );
}

function RuntimeIdentity({ item }: { item: YieldRow }) {
  return (
    <span className={styles.runtimeIdentity}>
      {item.harness ? (
        <HarnessMark harness={item.harness} size={11} title={null} />
      ) : (
        <Network aria-hidden />
      )}
      <span>{item.harnessLabel}</span>
    </span>
  );
}

function YieldButton({
  item,
  selected,
  ordinal,
  grouped = false,
  onSelect,
}: {
  item: YieldRow;
  selected: boolean;
  ordinal?: number;
  grouped?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.yieldRow}
      data-selected={selected}
      data-state={item.state}
      aria-pressed={selected}
      aria-label={`${item.state}, ${item.project}, ${item.agent}, ${item.harnessLabel}, ${item.hostLabel}, ${item.subject}. ${item.summary} ${item.age}. ${item.provenance}.`}
      onClick={onSelect}
    >
      <span className={styles.yieldLeading}>
        {ordinal ? <span className={styles.ordinal}>{ordinal}</span> : <StateMark state={item.state} />}
      </span>
      <span className={styles.yieldProject} data-grouped={grouped}>
        <strong>{grouped ? item.hostLabel : item.project}</strong>
        {!grouped ? <span>{item.hostLabel}</span> : null}
      </span>
      <span className={styles.yieldActor}>
        <AgentIdentity agent={item.agent} compact />
        <RuntimeIdentity item={item} />
      </span>
      <span className={styles.yieldWork}>
        <strong>{item.subject}</strong>
        <span>{item.summary}</span>
      </span>
      <span className={styles.yieldMeta}>
        <span>{item.age}</span>
        <ProvenanceMark value={item.provenance} />
      </span>
    </button>
  );
}

export default function ObserveEverythingStudy() {
  const [host, setHost] = useState<HostId | "all">("all");
  const [harness, setHarness] = useState<HarnessId | "all">("all");
  const [lens, setLens] = useState<Lens>("recent");
  const [preview, setPreview] = useState<PreviewMode>("desktop");
  const [selectedId, setSelectedId] = useState("delivery");
  const [voice, setVoice] = useState(false);
  const [mobileEvidence, setMobileEvidence] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  const scoped = useMemo(() => {
    let rows = YIELDS.filter((item) => {
      if (host !== "all" && item.host !== host) return false;
      if (harness !== "all" && item.harness !== harness) return false;
      return true;
    });
    if (voice) rows = rows.filter((item) => CITED_IDS.includes(item.id));
    return rows;
  }, [harness, host, voice]);

  const projectGroups = useMemo(() => {
    const groups = new Map<string, YieldRow[]>();
    for (const item of scoped) {
      const rows = groups.get(item.project) ?? [];
      rows.push(item);
      groups.set(item.project, rows);
    }
    return Array.from(groups.entries());
  }, [scoped]);
  const selected = scoped.find((item) => item.id === selectedId) ?? scoped[0] ?? null;
  const reportingHostCount = HOSTS.filter((item) => !item.stale).length;

  useEffect(() => {
    if (!scoped.length || scoped.some((item) => item.id === selectedId)) return;
    setSelectedId(scoped[0].id);
  }, [scoped, selectedId]);

  useEffect(() => {
    if (!voice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const ordinal = Number(event.key);
      if (ordinal < 1 || ordinal > CITED_IDS.length) return;
      setSelectedId(CITED_IDS[ordinal - 1]);
      setMobileEvidence(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voice]);

  const selectedHost = HOSTS.find((candidate) => candidate.id === host);
  const scopeTitle = voice
    ? "Scoutbot › Since lunch"
    : host === "all"
      ? "All hosts"
      : harness === "all"
        ? selectedHost?.label ?? "All hosts"
        : `${selectedHost?.label ?? host} › ${harness.charAt(0).toUpperCase()}${harness.slice(1)}`;

  function chooseHost(nextHost: HostId | "all") {
    setHost(nextHost);
    setHarness("all");
    setVoice(false);
    setMobileEvidence(false);
    setActionNotice("");
  }

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    setHost("all");
    setHarness("all");
    setLens("recent");
    setMobileEvidence(false);
    setActionNotice("");
  }

  function selectYield(id: string) {
    setSelectedId(id);
    setMobileEvidence(true);
    setActionNotice("");
  }

  function choosePreview(nextPreview: PreviewMode) {
    setPreview(nextPreview);
    setMobileEvidence(false);
  }

  async function copyAddress() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.address);
      setActionNotice("Copied the exact turn address.");
    } catch {
      setActionNotice("Copy is unavailable here; the exact address remains visible above.");
    }
  }

  return (
    <div className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · cross · observe" title="Observe everything">
        One ledger across every host Scout can reach. The stable row is a session&apos;s
        latest meaningful yield. Fixed project, agent, and harness identity makes
        the list fast to scan; recency, project, host, harness, and Scoutbot are
        alternate views of the same evidence. Illustrative fixture.
      </StudyHeader>

      <section className={styles.study} aria-label="Observe everything interactive study">
        <div className={styles.previewToolbar}>
          <div>
            <strong>Responsive preview</strong>
            <span>{preview === "desktop" ? "full three-pane control room" : "390px · list → evidence transition"}</span>
          </div>
          <div className={styles.previewModes} role="group" aria-label="Preview width">
            <button type="button" data-selected={preview === "desktop"} onClick={() => choosePreview("desktop")}>
              <Monitor aria-hidden />
              <span>Desktop</span>
              <em>fluid</em>
            </button>
            <button type="button" data-selected={preview === "mobile"} onClick={() => choosePreview("mobile")}>
              <Smartphone aria-hidden />
              <span>Mobile</span>
              <em>390</em>
            </button>
          </div>
        </div>

        <div className={styles.previewStage} data-viewport={preview}>
          <div className={styles.previewShell}>
            <div className={styles.frame} data-mobile-evidence={mobileEvidence}>
          <nav className={styles.productRail} aria-label="Scout navigation">
            <div className={styles.productMark} role="img" aria-label="Scout"><Sparkles aria-hidden /></div>
            <button type="button" aria-label="Home"><House aria-hidden /></button>
            <button type="button" className={styles.navActive} aria-label="Observe"><Radar aria-hidden /></button>
            <button type="button" aria-label="Projects"><FolderKanban aria-hidden /></button>
            <button type="button" aria-label="Comms"><MessageSquare aria-hidden /></button>
            <span className={styles.navSpacer} />
            <button type="button" aria-label="Settings"><Settings2 aria-hidden /></button>
          </nav>

          <div className={styles.product}>
            <header className={styles.productHeader}>
              <div className={styles.productTitle}>
                <strong>Observe</strong>
                <span>Who is doing what, everywhere</span>
              </div>
              <div className={styles.reach}>
                <span className={styles.reachDot} />
                <span>{reportingHostCount} of {HOSTS.length} hosts reporting</span>
                <span>·</span>
                <span>9 running</span>
              </div>
              <button
                type="button"
                className={styles.voiceButton}
                aria-label="Ask Scoutbot"
                aria-pressed={voice}
                onClick={toggleVoice}
              >
                <AudioLines aria-hidden />
                <span>Ask Scoutbot</span>
              </button>
            </header>

            <div className={styles.productBody}>
              <aside className={styles.scopePane} aria-label="Observation scope">
                <div className={styles.paneLabel}>Scope</div>
                <button
                  type="button"
                  className={styles.scopeButton}
                  data-selected={host === "all" && !voice}
                  onClick={() => chooseHost("all")}
                >
                  <Network aria-hidden />
                  <span>All hosts</span>
                  <em>{HOSTS.length}</em>
                </button>
                {HOSTS.map((hostItem) => {
                  const Icon = hostItem.icon;
                  const count = YIELDS.filter((item) => item.host === hostItem.id).length;
                  const isSelected = host === hostItem.id && !voice;
                  const harnesses = Array.from(
                    new Set(
                      YIELDS
                        .filter((item) => item.host === hostItem.id && item.provenance === "observed")
                        .map((item) => item.harness)
                        .filter((value): value is HarnessId => value !== null),
                    ),
                  );
                  return (
                    <div className={styles.scopeGroup} key={hostItem.id}>
                      <button
                        type="button"
                        className={styles.scopeButton}
                        data-selected={isSelected && harness === "all"}
                        data-stale={hostItem.stale}
                        onClick={() => chooseHost(hostItem.id)}
                      >
                        <Icon aria-hidden />
                        <span>{hostItem.label}</span>
                        {hostItem.stale ? <i aria-label="Host stale" /> : <em>{count}</em>}
                      </button>
                      {isSelected && harnesses.length ? (
                        <div className={styles.harnessBranch}>
                          {harnesses.map((harnessId) => (
                            <button
                              type="button"
                              key={harnessId}
                              data-selected={harness === harnessId}
                              onClick={() => setHarness(harnessId)}
                            >
                              <span>{harnessId.charAt(0).toUpperCase()}{harnessId.slice(1)}</span>
                              <em>{YIELDS.filter((item) => item.host === hostItem.id && item.harness === harnessId && item.provenance === "observed").length}</em>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className={styles.reachNote}>
                  <strong>Reach is part of the answer.</strong>
                  <span>MacBook Pro last seen 14m ago</span>
                </div>
              </aside>

              <section className={styles.ledgerPane} aria-label="Recent meaningful turns">
                <div className={styles.ledgerHeader}>
                  <div>
                    <strong>{scopeTitle}</strong>
                    <span>
                      {voice
                        ? "3 exact turns · spoken in this order"
                        : lens === "recent"
                          ? `${scoped.length} sessions · newest first`
                          : `${projectGroups.length} projects · ${scoped.length} sessions`}
                    </span>
                  </div>
                  {!voice ? (
                    <div className={styles.lens} role="group" aria-label="Ledger arrangement">
                      <button type="button" data-selected={lens === "recent"} onClick={() => setLens("recent")}>Recent</button>
                      <button type="button" data-selected={lens === "projects"} onClick={() => setLens("projects")}>Projects</button>
                    </div>
                  ) : null}
                </div>

                {voice ? (
                  <div className={styles.voiceAnswer} aria-live="polite">
                    <AudioLines aria-hidden />
                    <span><strong>Illustrative answer: three things since lunch.</strong> Press 2 or choose a cited row to inspect its exact evidence.</span>
                    <button type="button" onClick={toggleVoice}>Clear</button>
                  </div>
                ) : null}

                {scoped.length ? (
                  <div className={styles.ledgerColumns} aria-hidden>
                    <span />
                    <span>{lens === "projects" && !voice ? "Host" : "Project / host"}</span>
                    <span>Agent / harness</span>
                    <span>Latest meaningful turn</span>
                    <span>When</span>
                  </div>
                ) : null}

                {scoped.length && (lens === "recent" || voice) ? (
                  <div className={styles.ledgerSection} data-flat={!voice}>
                    {voice ? <div className={styles.sectionLabel}>Answer <span>{scoped.length}</span></div> : null}
                    {scoped.map((item) => (
                      <YieldButton
                        key={item.id}
                        item={item}
                        selected={selectedId === item.id}
                        ordinal={voice ? CITED_IDS.indexOf(item.id) + 1 : undefined}
                        onSelect={() => selectYield(item.id)}
                      />
                    ))}
                  </div>
                ) : null}

                {!voice && lens === "projects" ? projectGroups.map(([project, rows]) => (
                  <div className={styles.ledgerSection} key={project}>
                    <div className={styles.projectLabel}>
                      <strong>{project}</strong>
                      <span>{rows.length} {rows.length === 1 ? "session" : "sessions"} · latest {rows[0].age}</span>
                    </div>
                    {rows.map((item) => (
                      <YieldButton
                        key={item.id}
                        item={item}
                        selected={selectedId === item.id}
                        grouped
                        onSelect={() => selectYield(item.id)}
                      />
                    ))}
                  </div>
                )) : null}

                {!scoped.length ? (
                  <div className={styles.empty}>Nothing moved in this scope. Coverage: {reportingHostCount} of {HOSTS.length} hosts reporting.</div>
                ) : null}
              </section>

              <aside className={styles.evidencePane} aria-label="Selected turn evidence">
                <div className={styles.evidenceHeader}>
                  <ScanText aria-hidden />
                  <strong>Evidence</strong>
                  {selected ? <ProvenanceMark value={selected.provenance} /> : null}
                  <button type="button" className={styles.closeEvidence} aria-label="Close evidence" onClick={() => setMobileEvidence(false)}>
                    <X aria-hidden />
                  </button>
                </div>
                {selected ? (
                  <div className={styles.evidenceBody}>
                    <div className={styles.evidenceIntro}>
                      <span>Latest meaningful turn · {selected.age}</span>
                      <h2>{selected.subject}</h2>
                      <p>{selected.summary}</p>
                    </div>
                    <div className={styles.evidenceContext}>
                      <div>
                        <span>Project</span>
                        <strong>{selected.project}</strong>
                      </div>
                      <div>
                        <span>Agent</span>
                        <AgentIdentity agent={selected.agent} />
                      </div>
                      <div>
                        <span>Harness</span>
                        <RuntimeIdentity item={selected} />
                      </div>
                      <div>
                        <span>Host</span>
                        <strong>{selected.hostLabel}</strong>
                      </div>
                    </div>
                    <div className={styles.transcript}>
                      {selected.transcript.map((line, index) => (
                        <div key={`${line.at}-${index}`} data-anchor={index === selected.transcript.length - 1}>
                          <time>{line.at}</time>
                          <span>{line.text}</span>
                        </div>
                      ))}
                    </div>
                    <code className={styles.turnAddress}>{selected.address}</code>
                    <div className={styles.evidenceActions}>
                      <button type="button" className={styles.primaryAction} onClick={() => setActionNotice("Turn target anchored with context above and below.")}>Show turn target</button>
                      <button type="button" onClick={copyAddress}>Copy address</button>
                    </div>
                    {actionNotice ? <div className={styles.actionNotice} role="status">{actionNotice}</div> : null}
                  </div>
                ) : (
                  <div className={styles.evidenceEmpty}>
                    <CircleAlert aria-hidden />
                    <strong>No evidence in this scope</strong>
                    <p>The selected host has not reported a meaningful turn. Coverage remains explicit; Scout does not reuse evidence from another host.</p>
                  </div>
                )}
              </aside>
            </div>
          </div>
            </div>
          </div>
        </div>

        <div className={styles.contract} role="region" aria-label="Observe interaction contract">
          <div><span>IDENTITY</span><strong>project · agent · harness</strong><p>Fixed columns expose the actor and work before the turn summary asks for attention.</p></div>
          <div><span>ARRANGE</span><strong>recent ↔ projects</strong><p>State stays on the row; it never becomes the architecture or silently reorders the ledger.</p></div>
          <div><span>VOICE</span><strong>ordered refs[]</strong><p>Every spoken clause maps to a numbered row and exact turn address.</p></div>
          <div><span>RESPOND</span><strong>three panes ↔ pushed detail</strong><p>The 390px container keeps the same filters and rows; selection replaces the ledger with evidence.</p></div>
        </div>

        <div className={styles.boundaryCheck}>
          <div>
            <span>Canonical direction · unified overview</span>
            <strong>Observe becomes the CHANGED filter on the Agents / Projects model.</strong>
            <p>The proposed iOS overview uses the same project tree, agent rows, host scope, and PROJECT / RECENT arrangement. CHANGED only filters to unread state changes; it does not introduce another inventory.</p>
          </div>
          <Link href="/studies/scout-ios-agents?t=unified-quiet">Open unified overview <span aria-hidden>→</span></Link>
        </div>
      </section>
    </div>
  );
}
