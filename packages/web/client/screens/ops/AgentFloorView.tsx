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
 * isometric plane with three recency bands (front = live/now, mid = 5–30 min,
 * back = 30 min–4 h). Each lane is a tower of stacked blocks, one per recent
 * trace event, so tower height reads as "how much work happened in the last
 * 30 minutes". Live lanes carry a glowing head block; clicking a tower opens
 * the host surface's trace detail.
 *
 * Theming: the component paints entirely from `--floor-*` inputs, which
 * default to the app-global tokens (`--bg`, `--ink`, `--dim`, `--accent`,
 * `--green`) in agent-floor.css — so it follows light/dark automatically.
 * A host surface with its own palette (e.g. the Scope instrument) reskins it
 * by overriding those inputs, not by touching the component.
 */

/** Blocks always read the last 30 minutes, independent of the lane horizon. */
const FLOOR_TRACE_WINDOW_MS = 30 * 60_000;
const NOW_BAND_MS = 5 * 60_000;
const MAX_TOWER_BLOCKS = 8;
const MAX_TOWERS_PER_BAND = 5;

const PLINTH = 150;
const BLOCK_STEP = 17;
const STACK_BASE_Z = 16;
const CARD_LIFT = 78;
const MIN_PLANE = 640;

type FloorBlockKind = "tool" | "edit" | "msg";

type FloorTower = {
  lane: AgentLane;
  live: boolean;
  blocks: FloorBlockKind[];
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

function buildTower(lane: AgentLane, now: number): FloorTower {
  const sessionStart = lane.observe?.metadata?.session?.sessionStart;
  const cutoff = now - FLOOR_TRACE_WINDOW_MS;
  const counts: Record<FloorBlockKind, number> = { tool: 0, edit: 0, msg: 0 };
  const recent: Array<{ kind: FloorBlockKind; at: number | null; label: string }> = [];

  for (const event of lane.observe?.events ?? []) {
    const kind = classifyObserveEvent(event);
    if (!kind) continue;
    const at = observeEventWallMs(event, sessionStart);
    if (at !== null && at < cutoff) continue;
    counts[kind] += 1;
    recent.push({
      kind,
      at,
      label: kind === "msg" ? "message" : event.tool?.trim() || "tool",
    });
  }

  const last = recent.at(-1);
  return {
    lane,
    live: isAgentLaneLive(lane.observe),
    blocks: recent.slice(-MAX_TOWER_BLOCKS).map((entry) => entry.kind),
    counts,
    lastLabel: last?.label ?? null,
    lastAt: last?.at ?? (lane.lastActiveAt || null),
  };
}

/** 0 = front (now), 1 = 5–30 min, 2 = 30 min–4 h. */
function towerBand(tower: FloorTower, now: number): 0 | 1 | 2 {
  if (tower.live) return 0;
  const age = now - (tower.lane.lastActiveAt || 0);
  if (age <= NOW_BAND_MS) return 0;
  if (age <= FLOOR_TRACE_WINDOW_MS) return 1;
  return 2;
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

function TowerBlock({ kind, z, live }: {
  kind: FloorBlockKind | "head";
  z: number;
  live?: boolean;
}) {
  return (
    <span
      className={`agent-floor__block is-${kind}${live ? " is-live" : ""}`}
      style={{ "--z": `${z}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="agent-floor__face is-left" />
      <span className="agent-floor__face is-right" />
      <span className="agent-floor__face is-top" />
    </span>
  );
}

function FloorTowerFigure({ tower, x, y, onOpen }: {
  tower: FloorTower;
  x: number;
  y: number;
  onOpen: (lane: AgentLane) => void;
}) {
  const { lane, live, blocks } = tower;
  const agent = lane.agent;
  const name = lanePrimaryLabel(agent, lane.source);
  const sprite = agentSpriteProps(agent);
  const stackCount = blocks.length + (live ? 1 : 0);
  const cardZ = STACK_BASE_Z + stackCount * BLOCK_STEP + CARD_LIFT;
  const lastAgo = tower.lastAt ? timeAgo(tower.lastAt) : null;

  return (
    <button
      type="button"
      className={`agent-floor__tower${live ? " is-live" : ""}`}
      style={{ left: x, top: y }}
      onClick={() => onOpen(lane)}
      aria-label={`${name} — open timeline`}
    >
      <span className="agent-floor__ground" aria-hidden="true" />
      <span className="agent-floor__face agent-floor__plinth-left" aria-hidden="true" />
      <span className="agent-floor__face agent-floor__plinth-right" aria-hidden="true" />
      <span className="agent-floor__face agent-floor__plinth-top" aria-hidden="true" />
      <span className="agent-floor__stack" aria-hidden="true">
        {blocks.map((kind, index) => (
          <TowerBlock key={index} kind={kind} z={index * BLOCK_STEP} />
        ))}
        {live ? <TowerBlock kind="head" z={blocks.length * BLOCK_STEP} live /> : null}
      </span>
      <span
        className="agent-floor__bb agent-floor__card-anchor"
        style={{ "--z": `${cardZ}px` } as CSSProperties}
      >
        <span className="agent-floor__card">
          <span className="agent-floor__card-row">
            <SpriteAvatar name={agent.name} size={24} tile hue={sprite.hue} tone={sprite.tone} />
            <span className="agent-floor__card-name">{name}</span>
            <HarnessMark harness={agent.harness} size={12} className="agent-floor__card-mark" />
            <span className={`agent-floor__card-dot${live ? " is-live" : ""}`} />
          </span>
          <span className="agent-floor__card-counts">{countsLabel(tower.counts)}</span>
          <span className="agent-floor__card-last">
            {live ? (
              <>
                <span className="agent-floor__card-run">▸</span>
                <span className="agent-floor__card-tool">{tower.lastLabel ?? "working"}</span>
                <span className="agent-floor__card-ago">{lastAgo ?? "now"}</span>
              </>
            ) : (
              <>
                <span className="agent-floor__card-pause">⏸</span>
                <span className="agent-floor__card-idle">
                  idle{lastAgo ? ` · ${lastAgo}` : ""}
                </span>
              </>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

const BAND_RANGE_LABEL = ["", "5 – 30 min", "30 min – 4 h"] as const;

export function AgentFloorView({ lanes, now, onOpenTrace }: {
  lanes: AgentLane[];
  now: number;
  onOpenTrace: (lane: AgentLane) => void;
}) {
  const { bands, overflow, plane } = useMemo(() => {
    const grouped: FloorTower[][] = [[], [], []];
    for (const lane of lanes) {
      const tower = buildTower(lane, now);
      grouped[towerBand(tower, now)].push(tower);
    }
    for (const band of grouped) {
      band.sort((left, right) => right.lane.lastActiveAt - left.lane.lastActiveAt);
    }
    const overflowCounts = grouped.map((band) => Math.max(0, band.length - MAX_TOWERS_PER_BAND));
    const shown = grouped.map((band) => band.slice(0, MAX_TOWERS_PER_BAND));
    const maxCount = Math.max(1, ...shown.map((band) => band.length));
    const planeSize = Math.max(MIN_PLANE, 40 + maxCount * (PLINTH + 40));
    return { bands: shown, overflow: overflowCounts, plane: planeSize };
  }, [lanes, now]);

  const bandDepth = plane / 3;
  const towerXY = (bandIndex: number, index: number, count: number): { x: number; y: number } => {
    const usable = plane - PLINTH - 32;
    const x = count <= 1
      ? (plane - PLINTH) / 2
      : 16 + (index * usable) / (count - 1);
    const bandTop = (2 - bandIndex) * bandDepth;
    const y = bandTop + bandDepth / 2 - PLINTH / 2 + (index % 2 === 0 ? -14 : 14);
    return { x, y };
  };

  const liveCount = bands[0].filter((tower) => tower.live).length;

  return (
    <div className="agent-floor" data-live-count={liveCount}>
      <div className="agent-floor__viewport">
        <div className="agent-floor__stage">
          <div
            className="agent-floor__field"
            style={{
              width: plane,
              height: plane,
              left: -plane / 2,
              top: -plane / 2,
            }}
          >
            <div className="agent-floor__plane" />
            <div className="agent-floor__seam is-front" style={{ top: bandDepth * 2 }} />
            <div className="agent-floor__seam is-back" style={{ top: bandDepth }} />

            <div
              className="agent-floor__bb agent-floor__band-label is-now"
              style={{ left: 0.13 * plane, top: plane - 40 }}
            >
              <span className="agent-floor__band-pulse" />
              <span>now — live</span>
            </div>
            <div
              className="agent-floor__bb agent-floor__band-label"
              style={{ left: 0.94 * plane, top: 0.61 * plane }}
            >
              {BAND_RANGE_LABEL[1]}
            </div>
            {bands[2].length === 0 ? (
              <div
                className="agent-floor__bb agent-floor__band-empty"
                style={{ left: 0.52 * plane, top: 0.15 * plane }}
              >
                <span className="agent-floor__band-range">{BAND_RANGE_LABEL[2]}</span>
                {" · nothing this old"}
              </div>
            ) : (
              <div
                className="agent-floor__bb agent-floor__band-label"
                style={{ left: 0.13 * plane, top: 0.28 * plane }}
              >
                {BAND_RANGE_LABEL[2]}
              </div>
            )}

            {[2, 1, 0].map((bandIndex) =>
              bands[bandIndex].map((tower, index) => {
                const { x, y } = towerXY(bandIndex, index, bands[bandIndex].length);
                return (
                  <FloorTowerFigure
                    key={tower.lane.id}
                    tower={tower}
                    x={x}
                    y={y}
                    onOpen={onOpenTrace}
                  />
                );
              }))}

            {overflow.map((count, bandIndex) =>
              count > 0 ? (
                <div
                  key={bandIndex}
                  className="agent-floor__bb agent-floor__band-empty"
                  style={{
                    left: 0.85 * plane,
                    top: (2 - bandIndex) * bandDepth + bandDepth / 2,
                  }}
                >
                  +{count} earlier
                </div>
              ) : null)}
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
          <span className="agent-floor__legend-pulse" />live — top block glows
        </span>
        <span className="agent-floor__legend-note">
          Tower height = last 30 min of work · agents drift back a band as they go quiet · click a tower for the timeline
        </span>
      </footer>
    </div>
  );
}
