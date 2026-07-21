"use client";

/**
 * Home · What's Moving — layout study
 *
 * Chosen direction: **Signal first, groupable.**
 *
 * The row is always the live signal (action headline). Agent + harness demote.
 * One age. One quiet Observe. Sort toggle flips presentation only:
 *   · Recent  — flat recency list (cross-project)
 *   · Grouped — same rows under project bands (path appears once per group)
 *
 * A · Control stays as the problem-flagged shipped card soup for contrast.
 */

import { useMemo, useState } from "react";
import styles from "./home-whats-moving.module.css";

type Take = "control" | "signal";
type SortMode = "recent" | "grouped";

const TAKES: { id: Take; label: string; note: string; badge?: "flag" | "rec" }[] = [
  {
    id: "control",
    label: "A · Control",
    note: "shipped card strip — button soup, dual ages",
    badge: "flag",
  },
  {
    id: "signal",
    label: "B · Signal first · groupable",
    note: "action is the row · Recent or Grouped",
    badge: "rec",
  },
];

type MovingItem = {
  id: string;
  name: string;
  harness: "codex" | "claude" | "kimi" | "grok";
  project: string;
  branch: string;
  action: string;
  last: string;
  age: string;
  live?: boolean;
  hue: string;
};

/** Fixture loosely matching the live home screenshot. */
const ITEMS: MovingItem[] = [
  {
    id: "1",
    name: "Codex 019f8272",
    harness: "codex",
    project: "openscout",
    branch: "main",
    action: "Turn complete",
    last: "48s",
    age: "9h",
    live: true,
    hue: "#7dd3c0",
  },
  {
    id: "2",
    name: "Kimi session",
    harness: "kimi",
    project: "openscout",
    branch: "main",
    action: "/var/Folders/…/Talkie Capture - Region - …",
    last: "57s",
    age: "9h",
    live: true,
    hue: "#8b9cf7",
  },
  {
    id: "3",
    name: "Claude 6225c6aa",
    harness: "claude",
    project: "lattices",
    branch: "main",
    action: "Native claude transcript discovered.",
    last: "1m",
    age: "1m",
    live: true,
    hue: "#e8a06a",
  },
  {
    id: "4",
    name: "Claude 55bc37a8",
    harness: "claude",
    project: "talkie",
    branch: "main",
    action: "Native claude transcript discovered.",
    last: "2m",
    age: "2m",
    live: true,
    hue: "#e8a06a",
  },
  {
    id: "5",
    name: "Codex 019f82bd",
    harness: "codex",
    project: "openscout",
    branch: "main",
    action: '{"risk_level":"low","user_authorization":"high","outcome":"allow"…',
    last: "3m",
    age: "10h",
    live: true,
    hue: "#7dd3c0",
  },
  {
    id: "6",
    name: "Claude 5075f5b8",
    harness: "claude",
    project: "openscout",
    branch: "main",
    action: "Both of Codex's blocking issues on PR #406 are fixed, verified…",
    last: "6m",
    age: "9h",
    live: true,
    hue: "#e8a06a",
  },
  {
    id: "7",
    name: "Grok 019f8263",
    harness: "grok",
    project: "openscout",
    branch: "main",
    action: "run_terminal_command · cd …/openscout && python3 - <<'P…",
    last: "6m",
    age: "12m",
    live: true,
    hue: "#c4a0f0",
  },
  {
    id: "8",
    name: "Claude 14bb3a0c",
    harness: "claude",
    project: "openscout-main",
    branch: "main",
    action: "Native claude transcript discovered.",
    last: "9m",
    age: "9m",
    hue: "#e8a06a",
  },
  {
    id: "9",
    name: "Claude 1d81ba7f",
    harness: "claude",
    project: "hudson",
    branch: "main",
    action: "Native claude transcript discovered.",
    last: "9m",
    age: "9m",
    hue: "#e8a06a",
  },
];

function mark(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "?";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}

function pathish(item: MovingItem): string {
  return `~/${item.project} · ${item.branch}`;
}

function groupByProject(items: MovingItem[]): Array<[string, MovingItem[]]> {
  const map = new Map<string, MovingItem[]>();
  for (const item of items) {
    const bucket = map.get(item.project) ?? [];
    bucket.push(item);
    map.set(item.project, bucket);
  }
  // Preserve recency order of first sighting of each project.
  return [...map.entries()];
}

function Avatar({ item, size = 28 }: { item: MovingItem; size?: number }) {
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        background: item.hue,
        fontSize: size > 24 ? 11 : 10,
      }}
      aria-hidden
    >
      {mark(item.name)}
    </span>
  );
}

function Frame({
  children,
  count = ITEMS.length,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  count?: number;
  sort: SortMode;
  onSort: (mode: SortMode) => void;
}) {
  return (
    <div className={styles.frame}>
      <div className={styles.frameHead}>
        <div className={styles.frameTitle}>
          What&apos;s moving
          <em>
            {count} of {count + 11}
          </em>
        </div>
        <div className={styles.controls}>
          <div className={styles.seg} role="group" aria-label="Sort">
            <button
              type="button"
              className={sort === "recent" ? styles.segBtnOn : styles.segBtn}
              aria-pressed={sort === "recent"}
              onClick={() => onSort("recent")}
            >
              Recent
            </button>
            <button
              type="button"
              className={sort === "grouped" ? styles.segBtnOn : styles.segBtn}
              aria-pressed={sort === "grouped"}
              onClick={() => onSort("grouped")}
            >
              Grouped
            </button>
          </div>
          <div className={styles.seg} role="group" aria-label="Window">
            <span className={styles.segBtn}>5m</span>
            <span className={styles.segBtnOn}>30m</span>
            <span className={styles.segBtn}>4h</span>
            <span className={styles.segBtn}>24h</span>
          </div>
          <span className={styles.linkish}>open mesh ›</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function ControlTake({ sort, onSort }: { sort: SortMode; onSort: (m: SortMode) => void }) {
  return (
    <Frame sort={sort} onSort={onSort}>
      <div className={styles.controlList}>
        {ITEMS.map((item) => (
          <div key={item.id} className={styles.controlRow}>
            <div className={styles.ident}>
              <Avatar item={item} />
              <div className={styles.name}>{item.name}</div>
            </div>
            <div className={styles.meta}>
              {item.harness} · {pathish(item)}
            </div>
            <div className={styles.actionPill}>{item.action}</div>
            <div className={styles.ages}>
              <span className={styles.ageLast}>last {item.last}</span>
              <span className={styles.ageNew}>new {item.age}</span>
            </div>
            <div className={styles.btnSoup}>
              <button type="button" className={styles.btnGhost}>
                Profile
              </button>
              <button type="button" className={styles.btnPrimary}>
                Observe
              </button>
              <button type="button" className={styles.btnGhost} disabled>
                Terminal
              </button>
              <button type="button" className={styles.btnGhost}>
                Peek
              </button>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function SignalRow({
  item,
  grouped,
  selected,
  onSelect,
}: {
  item: MovingItem;
  grouped?: boolean;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  const who = grouped
    ? `${item.name} · ${item.harness}`
    : `${item.name} · ${item.harness} · ${item.project}`;

  return (
    <div className={styles.signalItem}>
      <button
        type="button"
        className={selected ? `${styles.signalRow} ${styles.signalRowOn}` : styles.signalRow}
        aria-pressed={selected}
        aria-controls={selected ? "signal-overlay" : undefined}
        onClick={() => onSelect(item.id)}
      >
        <span
          className={item.live ? styles.signalDot : styles.signalDotIdle}
          aria-hidden
        />
        <span className={styles.signalAction} title={item.action}>
          {item.action}
        </span>
        <span className={styles.signalWho} title={who}>
          <strong>{item.name}</strong>
          {" · "}
          {grouped ? item.harness : `${item.harness} · ${item.project}`}
        </span>
        <span className={styles.signalAge}>{item.last}</span>
      </button>
    </div>
  );
}

/** Fixed centered glass card — list never reflows. */
function SignalOverlay({
  item,
  onClose,
}: {
  item: MovingItem;
  onClose: () => void;
}) {
  return (
    <div
      className={styles.signalOverlayRoot}
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <aside
        id="signal-overlay"
        className={styles.signalOverlay}
        role="dialog"
        aria-modal="true"
        aria-label={`Details · ${item.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.overlayHead}>
          <div className={styles.overlayKicker}>
            {item.live ? <span className={styles.overlayLive}>Live</span> : null}
            <span>{item.last} ago</span>
          </div>
          <button
            type="button"
            className={styles.overlayClose}
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.overlayBody}>
          <p className={styles.overlayAction}>{item.action}</p>

          <dl className={styles.overlayMeta}>
            <div>
              <dt>Agent</dt>
              <dd>{item.name}</dd>
            </div>
            <div>
              <dt>Harness</dt>
              <dd>{item.harness}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>~/{item.project}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{item.branch}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>new {item.age}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.overlayActions}>
          <button type="button" className={styles.overlayPrimary}>
            Observe
          </button>
          <button type="button" className={styles.overlayGhost}>
            Profile
          </button>
          <button type="button" className={styles.overlayGhost}>
            Terminal
          </button>
          <button type="button" className={styles.overlayGhost}>
            Peek
          </button>
        </div>
      </aside>
    </div>
  );
}

function SignalTake({ sort, onSort }: { sort: SortMode; onSort: (m: SortMode) => void }) {
  const groups = useMemo(() => groupByProject(ITEMS), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ITEMS.find((item) => item.id === selectedId) ?? null;

  const toggle = (id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  };

  return (
    <Frame sort={sort} onSort={onSort}>
      <div className={styles.signalStage}>
        {sort === "recent" ? (
          <div className={styles.signalList}>
            {ITEMS.map((item) => (
              <SignalRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelect={toggle}
              />
            ))}
          </div>
        ) : (
          <div className={styles.signalGrouped}>
            {groups.map(([project, rows]) => (
              <section key={project} className={styles.signalGroup}>
                <header className={styles.projectBand}>
                  <span>~/{project}</span>
                  <span>
                    {rows.length} moving
                    {rows[0]?.branch ? ` · ${rows[0].branch}` : ""}
                  </span>
                </header>
                <div className={styles.signalList}>
                  {rows.map((item) => (
                    <SignalRow
                      key={item.id}
                      item={item}
                      grouped
                      selected={selectedId === item.id}
                      onSelect={toggle}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {selected ? (
          <SignalOverlay item={selected} onClose={() => setSelectedId(null)} />
        ) : null}
      </div>
    </Frame>
  );
}

export function HomeWhatsMovingStudy() {
  const [take, setTake] = useState<Take>("signal");
  const [sort, setSort] = useState<SortMode>("recent");

  return (
    <div className={styles.root}>
      <div className={styles.takes} role="tablist" aria-label="Layout takes">
        {TAKES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={take === t.id}
            className={take === t.id ? `${styles.take} ${styles.takeOn}` : styles.take}
            onClick={() => setTake(t.id)}
          >
            <span className={styles.takeId}>
              {t.label}
              {t.badge === "flag" ? (
                <span className={styles.flag}> · problem</span>
              ) : null}
              {t.badge === "rec" ? (
                <span className={styles.rec}> · chosen</span>
              ) : null}
            </span>
            <span className={styles.takeNote}>{t.note}</span>
          </button>
        ))}
      </div>

      {take === "control" ? (
        <ControlTake sort={sort} onSort={setSort} />
      ) : (
        <SignalTake sort={sort} onSort={setSort} />
      )}

      <ul className={styles.principles}>
        {take === "control" ? (
          <>
            <li>
              <strong>Problem.</strong> Four trailing actions per row compete with
              the action line; dual ages (last / new) rarely earn the width.
            </li>
            <li>
              <strong>Problem.</strong> Project path repeats on every card, so the
              eye never settles on what changed.
            </li>
          </>
        ) : (
          <>
            <li>
              <strong>One line always.</strong> List never expands or shifts.
            </li>
            <li>
              <strong>Fixed centered overlay.</strong> Selection opens a glass
              card dead-center over a light scrim. Click outside, ✕, or the row
              again to dismiss.
            </li>
            <li>
              <strong>Groupable.</strong> Same rows under project bands.
            </li>
          </>
        )}
      </ul>

      <div className={styles.delta}>
        <h3>· chosen</h3>
        <p>
          <strong style={{ color: "var(--studio-ink)" }}>
            Signal first, groupable
          </strong>
          {" — "}not two layouts. One row component; the Recent / Grouped control
          only changes whether project bands appear. Ready to port into{" "}
          <code style={{ fontSize: 12 }}>packages/web</code> home moving list.
        </p>
      </div>
    </div>
  );
}
