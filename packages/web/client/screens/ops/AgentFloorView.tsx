import "./agent-floor.css";

import { useCallback, useMemo, useState, type CSSProperties } from "react";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import { agentSpriteProps, SpriteAvatar } from "../../components/SpriteAvatar.tsx";
import { laneSnippetText, observeEventWallMs } from "../../lib/lane-observe.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ObserveEvent } from "../../lib/types.ts";
import {
  isAgentLaneLive,
  lanePrimaryLabel,
  type AgentLane,
} from "./agent-lanes-model.ts";

/**
 * AgentFloorView — the "floor" lane treatment, shared across surfaces. An
 * isometric plane where each agent keeps a LANE strip stacked along the
 * isometric Y and the other axis is TIME, anchored to wall-clock five-minute
 * slots: the leading slot is live; behind it, slots are MINTED — once their
 * five minutes pass they sit still until the next mint boundary.
 *
 * Identity reads in three layers (the "ledger × unroll" treatment): a compact
 * FLAG is always in-scene above each pad; hovering a flag, its lane, or its
 * LEDGER row unrolls the full nameplate (identity + recent-events readout)
 * while the other lanes flatten; hovering a tower projects that slot's
 * window readout. The ledger panel on the left stays the stable index as the
 * fleet grows past what the plane can hold. Clicking a lane or row opens the
 * host surface's trace detail. Which side history accumulates on is a
 * persisted preference (the legend control flips it).
 *
 * Theming: the component paints entirely from `--floor-*` inputs, which
 * default to the app-global tokens (`--bg`, `--ink`, `--dim`, `--accent`,
 * `--green`) in agent-floor.css — so it follows light/dark automatically.
 * A host surface with its own palette (e.g. the Scope instrument) reskins it
 * by overriding those inputs, not by touching the component.
 */

const BUCKET_MS = 5 * 60_000;
/** Minted (static) slots behind the live one — 6 × 5m = 30 min of past. */
const MINTED_SLOTS = 6;
const TOTAL_SLOTS = MINTED_SLOTS + 1;
const SLOT_MAX_BLOCKS = 8;
const MAX_FLOOR_LANES = 8;
const READOUT_EVENTS = 4;
const STRIP_BLOCKS = 10;

const LANE_PITCH = 132;
const STACK_SIZE = 56;
const STACK_STEP = 14;
const BLOCK_H = 12;
const SLAB_SIZE = 66;
const SLAB_H = 7;
const PAD_SIZE = 96;
const PAD_H = 12;
const BUCKET_DEPTH = 88;
const FRONT_APRON = 150;
const BACK_MARGIN = 48;
const EDGE_MARGIN = 24;
const MIN_PLANE_D = 480;
const FLAG_LIFT = 38;
const NAMEPLATE_LIFT = 92;

/** Which plane edge history drifts toward ("now" sits on the other side). */
type FloorOrientation = "past-left" | "past-right";

const FLOOR_ORIENT_STORAGE_KEY = "openscout:agent-floor-orient";

function readStoredOrientation(): FloorOrientation {
  try {
    const stored = localStorage.getItem(FLOOR_ORIENT_STORAGE_KEY);
    if (stored === "past-left" || stored === "past-right") return stored;
  } catch {
    // ignore storage failures
  }
  return "past-left";
}

function fmtSlotClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type FloorBlockKind = "tool" | "edit" | "msg";

type FloorSlot = {
  blocks: FloorBlockKind[];
  counts: Record<FloorBlockKind, number>;
  /** Tool name → call count, for the hover projection. */
  tools: Array<[string, number]>;
  total: number;
};

type FloorReadoutEntry = {
  kind: FloorBlockKind;
  label: string;
  at: number | null;
};

type FloorLaneSeries = {
  lane: AgentLane;
  live: boolean;
  /** Index 0 = the live slot, 1..MINTED_SLOTS = minted five-minute slots. */
  slots: FloorSlot[];
  counts: Record<FloorBlockKind, number>;
  /** Newest-first recent events for the unrolled nameplate. */
  readout: FloorReadoutEntry[];
  /** Chronological last blocks for the ledger mini strip. */
  strip: FloorBlockKind[];
  lastLabel: string | null;
  lastAt: number | null;
};

const EDIT_TOOL_RE = /^(edit|multi_?edit|write|apply_?patch|patch_apply|str_?replace|notebook_?edit|create_file)/i;

function classifyObserveEvent(event: ObserveEvent): FloorBlockKind | null {
  if (event.kind === "tool") {
    if (event.diff || (event.tool && EDIT_TOOL_RE.test(event.tool.trim()))) return "edit";
    return "tool";
  }
  if (event.kind === "message" || event.kind === "ask") return "msg";
  return null;
}

function buildFloorLane(lane: AgentLane, periodStart: number): FloorLaneSeries {
  const sessionStart = lane.observe?.metadata?.session?.sessionStart;
  const counts: Record<FloorBlockKind, number> = { tool: 0, edit: 0, msg: 0 };
  const slots: Array<{
    blocks: FloorBlockKind[];
    counts: Record<FloorBlockKind, number>;
    tools: Map<string, number>;
    total: number;
  }> = Array.from({ length: TOTAL_SLOTS }, () => ({
    blocks: [],
    counts: { tool: 0, edit: 0, msg: 0 },
    tools: new Map(),
    total: 0,
  }));
  const timeline: Array<{ kind: FloorBlockKind; label: string; at: number | null }> = [];
  let classified = 0;
  let last: { at: number | null; label: string } | null = null;

  for (const event of lane.observe?.events ?? []) {
    const kind = classifyObserveEvent(event);
    if (!kind) continue;
    const at = observeEventWallMs(event, sessionStart);
    // Wall-clock slot: 0 = the live period, k = the k-th minted five minutes.
    const slotIndex = at === null || at >= periodStart
      ? 0
      : Math.floor((periodStart - at) / BUCKET_MS) + 1;
    if (slotIndex >= TOTAL_SLOTS) continue;
    const slot = slots[slotIndex];
    slot.blocks.push(kind);
    slot.counts[kind] += 1;
    slot.total += 1;
    counts[kind] += 1;
    classified += 1;
    const toolName = kind === "msg" ? null : event.tool?.trim() || "tool";
    if (toolName) slot.tools.set(toolName, (slot.tools.get(toolName) ?? 0) + 1);
    timeline.push({
      kind,
      label: kind === "msg"
        ? laneSnippetText(event.text, 34, 1)
        : event.text.trim() || toolName || "tool",
      at,
    });
    last = {
      at,
      label: kind === "msg" ? "message" : event.tool?.trim() || "tool",
    };
  }

  return {
    lane,
    // "Session ready" placeholder observes report as live without any real
    // work — require at least one classifiable event so dormant-but-registered
    // agents don't glow at the now edge.
    live: isAgentLaneLive(lane.observe) && classified > 0,
    slots: slots.map((slot) => ({
      blocks: slot.blocks.slice(-SLOT_MAX_BLOCKS),
      counts: slot.counts,
      tools: [...slot.tools.entries()].sort((left, right) => right[1] - left[1]),
      total: slot.total,
    })),
    counts,
    readout: timeline.slice(-READOUT_EVENTS).reverse(),
    strip: timeline.slice(-STRIP_BLOCKS).map((entry) => entry.kind),
    lastLabel: last?.label ?? null,
    lastAt: last?.at ?? (lane.lastActiveAt || null),
  };
}

function countsLabel(counts: Record<FloorBlockKind, number>): string {
  const part = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`;
  return [
    part(counts.tool, "tool", "tools"),
    part(counts.edit, "edit", "edits"),
    part(counts.msg, "msg", "msgs"),
  ].join(" · ");
}

const READOUT_GLYPH: Record<FloorBlockKind, string> = {
  tool: "·",
  edit: "✎",
  msg: "◆",
};

function IsoBlock({ kind, z, size = STACK_SIZE, faceH = BLOCK_H, pad, live }: {
  kind: FloorBlockKind | "head" | "pad";
  z: number;
  size?: number;
  faceH?: number;
  pad?: boolean;
  live?: boolean;
}) {
  return (
    <span
      className={`agent-floor__block is-${kind}${pad ? " is-pedestal" : ""}${live ? " is-live" : ""}`}
      style={{ "--z": `${z}px`, "--bs": `${size}px`, "--bh": `${faceH}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="agent-floor__face is-left" />
      <span className="agent-floor__face is-right" />
      <span className="agent-floor__face is-top" />
    </span>
  );
}

/** Slab under a minted tower — its sides carry the tool/edit/msg mix. */
function SlotSlab({ slot }: { slot: FloorSlot }) {
  const total = Math.max(1, slot.total);
  const toolPct = (slot.counts.tool / total) * 100;
  const editPct = (slot.counts.edit / total) * 100;
  return (
    <span
      className="agent-floor__block agent-floor__slab"
      style={{
        "--z": "0px",
        "--bs": `${SLAB_SIZE}px`,
        "--bh": `${SLAB_H}px`,
        "--mix-a": `${toolPct.toFixed(1)}%`,
        "--mix-b": `${(toolPct + editPct).toFixed(1)}%`,
      } as CSSProperties}
      aria-hidden="true"
    >
      <span className="agent-floor__face is-left" />
      <span className="agent-floor__face is-right" />
      <span className="agent-floor__face is-top" />
    </span>
  );
}

function SlotPeek({ slot, slotIndex, periodStart }: {
  slot: FloorSlot;
  slotIndex: number;
  periodStart: number;
}) {
  const rangeLabel = slotIndex === 0
    ? `${fmtSlotClock(periodStart)} — now`
    : `${fmtSlotClock(periodStart - slotIndex * BUCKET_MS)} – ${fmtSlotClock(periodStart - (slotIndex - 1) * BUCKET_MS)}`;
  return (
    <span className="agent-floor__peek">
      <span className="agent-floor__peek-range">{rangeLabel}</span>
      <span className="agent-floor__peek-cols">
        <span className="agent-floor__peek-col">
          {slot.tools.slice(0, 3).map(([tool, count]) => (
            <span key={tool} className="agent-floor__peek-tool">
              {tool}{count > 1 ? ` ×${count}` : ""}
            </span>
          ))}
          {slot.tools.length === 0 ? (
            <span className="agent-floor__peek-tool is-empty">no tools</span>
          ) : null}
        </span>
        <span className="agent-floor__peek-col is-right">
          <span>{slot.counts.edit} edit{slot.counts.edit === 1 ? "" : "s"}</span>
          <span>{slot.counts.msg} msg{slot.counts.msg === 1 ? "" : "s"}</span>
        </span>
      </span>
    </span>
  );
}

function LaneActionLine({ series, restingLabel, lastAgo }: {
  series: FloorLaneSeries;
  restingLabel: string;
  lastAgo: string | null;
}) {
  return series.live ? (
    <>
      <span className="agent-floor__card-run">▸</span>
      <span className="agent-floor__card-tool">{series.lastLabel ?? "working"}</span>
      <span className="agent-floor__card-ago">{lastAgo ?? "now"}</span>
    </>
  ) : (
    <>
      <span className="agent-floor__card-pause">⏸</span>
      <span className="agent-floor__card-idle">
        {restingLabel}{lastAgo ? ` · ${lastAgo}` : ""}
      </span>
    </>
  );
}

function restingLabelFor(series: FloorLaneSeries): string {
  // Registry state may claim "working" while nothing observable has landed —
  // say "quiet", not "idle", but never claim live work we can't show.
  return /^(working|active|running|in_turn|in_flight)/i.test(series.lane.agent.state ?? "")
    ? "quiet"
    : "idle";
}

function FloorLaneStrip({ series, index, planeW, flip, periodStart, now, focused, dimmed, peekSlot, onFocus, onPeek, onOpen }: {
  series: FloorLaneSeries;
  index: number;
  planeW: number;
  /** true = past accumulates to the RIGHT (pads on the left edge). */
  flip: boolean;
  periodStart: number;
  now: number;
  focused: boolean;
  dimmed: boolean;
  peekSlot: number | null;
  onFocus: (laneId: string | null) => void;
  onPeek: (laneId: string, slotIndex: number | null) => void;
  onOpen: (lane: AgentLane) => void;
}) {
  const { lane, live, slots } = series;
  const agent = lane.agent;
  const name = lanePrimaryLabel(agent, lane.source);
  const sprite = agentSpriteProps(agent);
  const lastAgo = series.lastAt ? timeAgo(series.lastAt, now) : null;
  const restingLabel = restingLabelFor(series);

  const padX = flip
    ? (FRONT_APRON - PAD_SIZE) / 2
    : planeW - FRONT_APRON + (FRONT_APRON - PAD_SIZE) / 2;
  const padY = (LANE_PITCH - PAD_SIZE) / 2;
  const stackY = (LANE_PITCH - SLAB_SIZE) / 2;
  const slotX = (slotIndex: number) => {
    const inset = (BUCKET_DEPTH - SLAB_SIZE) / 2;
    return flip
      ? FRONT_APRON + slotIndex * BUCKET_DEPTH + inset
      : planeW - FRONT_APRON - (slotIndex + 1) * BUCKET_DEPTH + inset;
  };
  const flagZ = PAD_H + FLAG_LIFT + (index % 2) * 14;
  const nameplateZ = PAD_H + (live ? STACK_STEP : 0) + NAMEPLATE_LIFT;

  return (
    <button
      type="button"
      className={`agent-floor__lane${live ? " is-live" : ""}${index % 2 === 1 ? " is-alt" : ""}${focused ? " is-focus" : ""}${dimmed ? " is-dim" : ""}`}
      style={{ left: 0, top: index * LANE_PITCH, width: planeW, height: LANE_PITCH }}
      onClick={() => onOpen(lane)}
      onMouseEnter={() => onFocus(lane.id)}
      onMouseLeave={() => {
        onFocus(null);
        onPeek(lane.id, null);
      }}
      aria-label={`${name} — open timeline`}
    >
      <span className="agent-floor__lane-strip" aria-hidden="true" />

      {slots.map((slot, slotIndex) => {
        if (slot.total === 0) return null;
        const peeking = focused && peekSlot === slotIndex;
        const stackTopZ = SLAB_H + 2 + slot.blocks.length * STACK_STEP;
        return (
          <span
            key={slotIndex}
            className={`agent-floor__stack${slotIndex === 0 ? " is-now" : " is-minted"}${peeking ? " is-peeking" : ""}`}
            style={{ left: slotX(slotIndex), top: stackY }}
            onMouseEnter={() => onPeek(lane.id, slotIndex)}
          >
            <SlotSlab slot={slot} />
            <span
              className="agent-floor__stack-blocks"
              style={{ left: (SLAB_SIZE - STACK_SIZE) / 2, top: (SLAB_SIZE - STACK_SIZE) / 2 }}
            >
              {slot.blocks.map((kind, blockIndex) => (
                <IsoBlock key={blockIndex} kind={kind} z={SLAB_H + 2 + blockIndex * STACK_STEP} />
              ))}
            </span>
            {peeking ? (
              <span
                className="agent-floor__bb agent-floor__peek-anchor"
                style={{
                  left: SLAB_SIZE / 2,
                  top: SLAB_SIZE / 2,
                  "--z": `${stackTopZ + 46}px`,
                } as CSSProperties}
              >
                <SlotPeek slot={slot} slotIndex={slotIndex} periodStart={periodStart} />
              </span>
            ) : null}
          </span>
        );
      })}

      <span className="agent-floor__pad" style={{ left: padX, top: padY }} aria-hidden="true">
        <span className="agent-floor__ground" />
        <IsoBlock kind="pad" z={0} size={PAD_SIZE} faceH={PAD_H} pad />
        {live ? <IsoBlock kind="head" z={PAD_H + 2} size={STACK_SIZE} faceH={BLOCK_H} live /> : null}
      </span>

      {focused ? (
        <span
          className="agent-floor__bb agent-floor__card-anchor"
          style={{
            left: padX + PAD_SIZE / 2,
            top: padY + PAD_SIZE / 2,
            "--z": `${nameplateZ}px`,
          } as CSSProperties}
        >
          <span className="agent-floor__card">
            <span className="agent-floor__card-row">
              <SpriteAvatar name={agent.name} size={24} tile hue={sprite.hue} tone={sprite.tone} />
              <span className="agent-floor__card-name">{name}</span>
              <HarnessMark harness={agent.harness} size={12} className="agent-floor__card-mark" />
              <span className={`agent-floor__card-dot${live ? " is-live" : ""}`} />
            </span>
            <span className="agent-floor__card-counts">{countsLabel(series.counts)}</span>
            {series.readout.length > 0 ? (
              <span className="agent-floor__card-readout">
                {series.readout.map((entry, entryIndex) => (
                  <span key={entryIndex} className={`agent-floor__readout-row is-${entry.kind}`}>
                    <span className="agent-floor__readout-glyph">{READOUT_GLYPH[entry.kind]}</span>
                    <span className="agent-floor__readout-label">{entry.label}</span>
                    <span className="agent-floor__readout-ago">
                      {entry.at ? timeAgo(entry.at, now) : "now"}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="agent-floor__card-last">
                <LaneActionLine series={series} restingLabel={restingLabel} lastAgo={lastAgo} />
              </span>
            )}
          </span>
        </span>
      ) : (
        <span
          className="agent-floor__bb agent-floor__flag-anchor"
          style={{
            left: padX + PAD_SIZE / 2,
            top: padY + PAD_SIZE / 2,
            "--z": `${flagZ}px`,
          } as CSSProperties}
        >
          <span className="agent-floor__flag">
            <SpriteAvatar name={agent.name} size={14} tile hue={sprite.hue} tone={sprite.tone} />
            <span className="agent-floor__flag-name">{name}</span>
            <span className={`agent-floor__card-dot${live ? " is-live" : ""}`} />
          </span>
        </span>
      )}
    </button>
  );
}

export function AgentFloorView({ lanes, now, onOpenTrace }: {
  lanes: AgentLane[];
  now: number;
  onOpenTrace: (lane: AgentLane) => void;
}) {
  const [orientation, setOrientation] = useState<FloorOrientation>(readStoredOrientation);
  const [focusLaneId, setFocusLaneId] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ laneId: string; slot: number } | null>(null);
  const flip = orientation === "past-right";
  const flipOrientation = useCallback(() => {
    setOrientation((current) => {
      const next: FloorOrientation = current === "past-left" ? "past-right" : "past-left";
      try {
        localStorage.setItem(FLOOR_ORIENT_STORAGE_KEY, next);
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);
  const handleFocus = useCallback((laneId: string | null) => {
    setFocusLaneId(laneId);
    if (laneId === null) setPeek(null);
  }, []);
  const handlePeek = useCallback((laneId: string, slot: number | null) => {
    setPeek(slot === null ? null : { laneId, slot });
  }, []);

  // Slots anchor to wall-clock five-minute periods: minted towers hold still;
  // everything shifts one slot only when a new period mints.
  const periodStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;

  const { series, hidden, planeW, planeD, lanesStartY } = useMemo(() => {
    const sorted = [...lanes].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
    const built = sorted.map((lane) => buildFloorLane(lane, periodStart));
    // Most recent lane renders nearest the viewer (largest isometric Y).
    const shown = built.slice(0, MAX_FLOOR_LANES).reverse();
    const stripsH = shown.length * LANE_PITCH;
    const depth = Math.max(MIN_PLANE_D, stripsH + EDGE_MARGIN * 2);
    return {
      series: shown,
      hidden: built.slice(MAX_FLOOR_LANES),
      planeW: BACK_MARGIN + TOTAL_SLOTS * BUCKET_DEPTH + FRONT_APRON,
      planeD: depth,
      lanesStartY: (depth - stripsH) / 2,
    };
  }, [lanes, periodStart]);

  // Ledger lists most-recent first — the floor's shown lanes are reversed.
  const ledger = useMemo(() => [...series].reverse().concat(hidden), [series, hidden]);
  const liveCount = ledger.filter((entry) => entry.live).length;
  const seamX = (slotIndex: number) => (flip
    ? FRONT_APRON + slotIndex * BUCKET_DEPTH
    : planeW - FRONT_APRON - slotIndex * BUCKET_DEPTH);
  const ticksY = lanesStartY + series.length * LANE_PITCH + 26;

  return (
    <div className="agent-floor" data-live-count={liveCount} data-floor-orient={orientation}>
      <div className="agent-floor__body">
        <aside className="agent-floor__ledger" aria-label="Fleet ledger">
          <header className="agent-floor__ledger-head">
            <span className="agent-floor__ledger-title">fleet</span>
            <span className="agent-floor__ledger-meta">
              {ledger.length} lane{ledger.length === 1 ? "" : "s"} · {liveCount} live
            </span>
            <span className="agent-floor__ledger-trace">trace 30m</span>
          </header>
          <div className="agent-floor__ledger-rows">
            {ledger.map((entry) => {
              const agent = entry.lane.agent;
              const sprite = agentSpriteProps(agent);
              const lastAgo = entry.lastAt ? timeAgo(entry.lastAt, now) : null;
              return (
                <button
                  key={entry.lane.id}
                  type="button"
                  className={`agent-floor__ledger-row${focusLaneId === entry.lane.id ? " is-focus" : ""}`}
                  onClick={() => onOpenTrace(entry.lane)}
                  onMouseEnter={() => handleFocus(entry.lane.id)}
                  onMouseLeave={() => handleFocus(null)}
                >
                  <span className="agent-floor__ledger-id">
                    <SpriteAvatar name={agent.name} size={18} tile hue={sprite.hue} tone={sprite.tone} />
                    <span className="agent-floor__ledger-name">
                      {lanePrimaryLabel(agent, entry.lane.source)}
                    </span>
                    <HarnessMark harness={agent.harness} size={11} className="agent-floor__card-mark" />
                    <span className={`agent-floor__card-dot${entry.live ? " is-live" : ""}`} />
                  </span>
                  <span className="agent-floor__ledger-action">
                    <LaneActionLine
                      series={entry}
                      restingLabel={restingLabelFor(entry)}
                      lastAgo={lastAgo}
                    />
                  </span>
                  <span className="agent-floor__ledger-tally">
                    <span className="agent-floor__ledger-strip">
                      {entry.strip.map((kind, blockIndex) => (
                        <span key={blockIndex} className={`agent-floor__ledger-cell is-${kind}`} />
                      ))}
                    </span>
                    <span className="agent-floor__ledger-counts">{countsLabel(entry.counts)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <footer className="agent-floor__ledger-foot">
            rows and flags are linked — hover either to unroll
          </footer>
        </aside>

        <div className="agent-floor__viewport">
          <div className="agent-floor__stage">
            <div
              className="agent-floor__field"
              style={{
                width: planeW,
                height: planeD,
                left: -planeW / 2,
                top: -planeD / 2,
              }}
            >
              <div className="agent-floor__plane" />

              {Array.from({ length: TOTAL_SLOTS + 1 }, (_, slotIndex) => (
                <div
                  key={slotIndex}
                  className={`agent-floor__seam${slotIndex === 0 ? " is-front" : ""}`}
                  style={{ left: seamX(slotIndex) }}
                />
              ))}
              {Array.from({ length: TOTAL_SLOTS + 1 }, (_, slotIndex) => (
                <div
                  key={slotIndex}
                  className={`agent-floor__bb agent-floor__tick${slotIndex === 0 ? " is-now" : ""}`}
                  style={{ left: seamX(slotIndex), top: ticksY }}
                >
                  {slotIndex === 0 ? (
                    <>
                      <span className="agent-floor__tick-pulse" />
                      <span>now</span>
                    </>
                  ) : (
                    fmtSlotClock(periodStart - (slotIndex - 1) * BUCKET_MS)
                  )}
                </div>
              ))}

              <div
                className="agent-floor__lanes"
                style={{ left: 0, top: lanesStartY }}
                data-focus={focusLaneId !== null || undefined}
              >
                {series.map((entry, index) => (
                  <FloorLaneStrip
                    key={entry.lane.id}
                    series={entry}
                    index={index}
                    planeW={planeW}
                    flip={flip}
                    periodStart={periodStart}
                    now={now}
                    focused={focusLaneId === entry.lane.id}
                    dimmed={focusLaneId !== null && focusLaneId !== entry.lane.id}
                    peekSlot={peek?.laneId === entry.lane.id ? peek.slot : null}
                    onFocus={handleFocus}
                    onPeek={handlePeek}
                    onOpen={onOpenTrace}
                  />
                ))}
              </div>

              {hidden.length > 0 ? (
                <div
                  className="agent-floor__bb agent-floor__chip"
                  style={{
                    left: flip ? FRONT_APRON / 2 : planeW - FRONT_APRON / 2,
                    top: ticksY + 30,
                  }}
                >
                  +{hidden.length} more in the ledger
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <footer className="agent-floor__legend">
        <span className="agent-floor__legend-item">
          <span className="agent-floor__legend-swatch is-tool" />tool call
        </span>
        <span className="agent-floor__legend-item">
          <span className="agent-floor__legend-swatch is-edit" />file edit
        </span>
        <span className="agent-floor__legend-item">
          <span className="agent-floor__legend-swatch is-msg" />message
        </span>
        <span className="agent-floor__legend-item">
          <span className="agent-floor__legend-pulse" />live — pad glows
        </span>
        <button
          type="button"
          className="agent-floor__legend-flip"
          onClick={flipOrientation}
          title="Flip which side history accumulates on"
        >
          past {flip ? "→" : "←"}
        </button>
        <span className="agent-floor__legend-note">
          Towers mint every 5 min · hover a flag or row to unroll · hover a tower for its window · click for the timeline
        </span>
      </footer>
    </div>
  );
}
