import "./agent-floor.css";

import { useMemo, type CSSProperties } from "react";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import { agentSpriteProps, SpriteAvatar } from "../../components/SpriteAvatar.tsx";
import { observeEventWallMs } from "../../lib/lane-observe.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ObserveEvent } from "../../lib/types.ts";
import {
  isAgentLaneLive,
  lanePrimaryLabel,
  type AgentLane,
} from "./agent-lanes-model.ts";

/**
 * AgentFloorView — the "floor" lane treatment, shared across surfaces. An
 * isometric plane where each agent keeps a LANE strip and the depth axis is
 * TIME: the agent's pad and identity card sit at the front ("now") and their
 * work recedes into the past as block stacks, one stack per five-minute
 * bucket over the last thirty minutes. Stack height reads as "how much work
 * happened then"; an empty strip reads as a quiet recent past. Live agents'
 * pads glow; clicking a lane opens the host surface's trace detail.
 *
 * Theming: the component paints entirely from `--floor-*` inputs, which
 * default to the app-global tokens (`--bg`, `--ink`, `--dim`, `--accent`,
 * `--green`) in agent-floor.css — so it follows light/dark automatically.
 * A host surface with its own palette (e.g. the Scope instrument) reskins it
 * by overriding those inputs, not by touching the component.
 */

/** The time axis covers the last 30 minutes in five-minute buckets. */
const FLOOR_TRACE_WINDOW_MS = 30 * 60_000;
const BUCKET_MS = 5 * 60_000;
const BUCKET_COUNT = 6;
const BUCKET_MAX_BLOCKS = 8;
const MAX_FLOOR_LANES = 8;

const LANE_PITCH = 132;
const STACK_SIZE = 56;
const STACK_STEP = 14;
const BLOCK_H = 12;
const PAD_SIZE = 96;
const PAD_H = 12;
const BUCKET_DEPTH = 88;
const FRONT_APRON = 150;
const BACK_MARGIN = 48;
const EDGE_MARGIN = 24;
const MIN_PLANE_W = 480;
const CARD_LIFT = 84;
const CARD_STAGGER = 42;

type FloorBlockKind = "tool" | "edit" | "msg";

type FloorLaneSeries = {
  lane: AgentLane;
  live: boolean;
  /** Index 0 = the 0–5m bucket, blocks in chronological order. */
  buckets: FloorBlockKind[][];
  counts: Record<FloorBlockKind, number>;
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

function buildFloorLane(lane: AgentLane, now: number): FloorLaneSeries {
  const sessionStart = lane.observe?.metadata?.session?.sessionStart;
  const counts: Record<FloorBlockKind, number> = { tool: 0, edit: 0, msg: 0 };
  const buckets: FloorBlockKind[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  let classified = 0;
  let last: { at: number | null; label: string } | null = null;

  for (const event of lane.observe?.events ?? []) {
    const kind = classifyObserveEvent(event);
    if (!kind) continue;
    const at = observeEventWallMs(event, sessionStart);
    const age = at === null ? 0 : Math.max(0, now - at);
    if (age >= FLOOR_TRACE_WINDOW_MS) continue;
    counts[kind] += 1;
    classified += 1;
    buckets[Math.min(BUCKET_COUNT - 1, Math.floor(age / BUCKET_MS))].push(kind);
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
    buckets: buckets.map((bucket) => bucket.slice(-BUCKET_MAX_BLOCKS)),
    counts,
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

function FloorLaneStrip({ series, index, planeD, onOpen }: {
  series: FloorLaneSeries;
  index: number;
  planeD: number;
  onOpen: (lane: AgentLane) => void;
}) {
  const { lane, live, buckets } = series;
  const agent = lane.agent;
  const name = lanePrimaryLabel(agent, lane.source);
  const sprite = agentSpriteProps(agent);
  const lastAgo = series.lastAt ? timeAgo(series.lastAt) : null;
  // Registry state may claim "working" while nothing observable has landed —
  // say "quiet", not "idle", but never claim live work we can't show.
  const restingLabel = /^(working|active|running|in_turn|in_flight)/i.test(agent.state ?? "")
    ? "quiet"
    : "idle";

  const padX = (LANE_PITCH - PAD_SIZE) / 2;
  const padY = planeD - FRONT_APRON + (FRONT_APRON - PAD_SIZE) / 2;
  const stackX = (LANE_PITCH - STACK_SIZE) / 2;
  const cardZ = PAD_H + 4 + (live ? STACK_STEP : 0) + CARD_LIFT + (index % 3) * CARD_STAGGER;

  return (
    <button
      type="button"
      className={`agent-floor__lane${live ? " is-live" : ""}${index % 2 === 1 ? " is-alt" : ""}`}
      style={{ left: index * LANE_PITCH, top: 0, width: LANE_PITCH, height: planeD }}
      onClick={() => onOpen(lane)}
      aria-label={`${name} — open timeline`}
    >
      <span className="agent-floor__lane-strip" aria-hidden="true" />

      {buckets.map((blocks, bucketIndex) => {
        if (blocks.length === 0) return null;
        const top = planeD - FRONT_APRON - (bucketIndex + 1) * BUCKET_DEPTH
          + (BUCKET_DEPTH - STACK_SIZE) / 2;
        return (
          <span
            key={bucketIndex}
            className="agent-floor__stack"
            style={{ left: stackX, top }}
            aria-hidden="true"
          >
            {blocks.map((kind, blockIndex) => (
              <IsoBlock key={blockIndex} kind={kind} z={blockIndex * STACK_STEP} />
            ))}
          </span>
        );
      })}

      <span className="agent-floor__pad" style={{ left: padX, top: padY }} aria-hidden="true">
        <span className="agent-floor__ground" />
        <IsoBlock kind="pad" z={0} size={PAD_SIZE} faceH={PAD_H} pad />
        {live ? <IsoBlock kind="head" z={PAD_H + 2} size={STACK_SIZE} faceH={BLOCK_H} live /> : null}
      </span>

      <span
        className="agent-floor__bb agent-floor__card-anchor"
        style={{
          left: LANE_PITCH / 2,
          top: padY + PAD_SIZE / 2,
          "--z": `${cardZ}px`,
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
          <span className="agent-floor__card-last">
            {live ? (
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
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

export function AgentFloorView({ lanes, now, onOpenTrace }: {
  lanes: AgentLane[];
  now: number;
  onOpenTrace: (lane: AgentLane) => void;
}) {
  const { series, overflow, planeW, planeD, lanesStartX } = useMemo(() => {
    const sorted = [...lanes].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
    const shown = sorted.slice(0, MAX_FLOOR_LANES).map((lane) => buildFloorLane(lane, now));
    const stripsW = shown.length * LANE_PITCH;
    const width = Math.max(MIN_PLANE_W, stripsW + EDGE_MARGIN * 2);
    return {
      series: shown,
      overflow: Math.max(0, lanes.length - shown.length),
      planeW: width,
      planeD: BACK_MARGIN + BUCKET_COUNT * BUCKET_DEPTH + FRONT_APRON,
      lanesStartX: (width - stripsW) / 2,
    };
  }, [lanes, now]);

  const liveCount = series.filter((entry) => entry.live).length;
  const seamY = (bucketIndex: number) =>
    planeD - FRONT_APRON - bucketIndex * BUCKET_DEPTH;

  return (
    <div className="agent-floor" data-live-count={liveCount}>
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

            {Array.from({ length: BUCKET_COUNT + 1 }, (_, bucketIndex) => (
              <div
                key={bucketIndex}
                className={`agent-floor__seam${bucketIndex === 0 ? " is-front" : ""}`}
                style={{ top: seamY(bucketIndex) }}
              />
            ))}
            {Array.from({ length: BUCKET_COUNT + 1 }, (_, bucketIndex) => (
              <div
                key={bucketIndex}
                className={`agent-floor__bb agent-floor__tick${bucketIndex === 0 ? " is-now" : ""}`}
                style={{ left: lanesStartX - 34, top: seamY(bucketIndex) }}
              >
                {bucketIndex === 0 ? (
                  <>
                    <span className="agent-floor__tick-pulse" />
                    <span>now</span>
                  </>
                ) : (
                  `${bucketIndex * 5}m`
                )}
              </div>
            ))}

            <div className="agent-floor__lanes" style={{ left: lanesStartX, top: 0 }}>
              {series.map((entry, index) => (
                <FloorLaneStrip
                  key={entry.lane.id}
                  series={entry}
                  index={index}
                  planeD={planeD}
                  onOpen={onOpenTrace}
                />
              ))}
            </div>

            {overflow > 0 ? (
              <div
                className="agent-floor__bb agent-floor__chip"
                style={{ left: planeW - 36, top: planeD - FRONT_APRON - BUCKET_DEPTH }}
              >
                +{overflow} more agent{overflow === 1 ? "" : "s"}
              </div>
            ) : null}
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
        <span className="agent-floor__legend-note">
          Each agent keeps a lane · stacks step back in 5-min buckets over the last 30 min · click a lane for its timeline
        </span>
      </footer>
    </div>
  );
}
