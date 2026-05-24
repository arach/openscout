import { Bot, Crosshair } from "lucide-react";
import type { Route } from "../lib/types.ts";
import {
  BriefSequenceView,
  useBriefSequenceRuntime,
} from "../components/brief-sequence/index.tsx";
import { briefGenerationSequence } from "../components/brief-sequence/sample-sequence.ts";
import "../components/brief-sequence/brief-sequence.css";
import "./home-hero.css";

type HeartrateBucketView = { ts: number; count: number; value: number };

type GaugeTone = "ok" | "warn" | "err" | "dim";

export type ServiceGauge =
  | {
      id: string;
      label: string;
      kind: "quota";
      fill: number;
      usedLabel: string;
      capLabel: string;
      unitLabel: string;
      resetAt: number;
    }
  | {
      id: string;
      label: string;
      kind: "status";
      statusLabel: string;
      tone: GaugeTone;
    };

export type HomeHeroSignal = {
  id: string;
  label: string;
  value: string;
  tone?: GaugeTone;
  route?: Route;
  onClick?: () => void;
};

export type HomeHeroBriefReference = {
  id: string;
  kind: string;
  label: string;
  route?: Route;
  detail?: string;
};

export type HomeHeroBriefObservation = {
  id: string;
  text: string;
  tone?: string;
  references: HomeHeroBriefReference[];
};

export type HomeHeroProps = {
  now: Date;
  greeting: string;
  operatorName: string;
  syncLabel: string;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  briefRefreshing: boolean;
  onRefresh: () => void;
  onRegenerateBrief: () => void;
  onSpeakBrief?: () => void;
  briefSpeaking?: boolean;
  briefIsNew?: boolean;
  totalOperatorQueue: number;
  narrativeParts: string[];
  briefStatement: string | null;
  briefObservations: HomeHeroBriefObservation[];
  navigate: (route: Route) => void;
  opsEnabled: boolean;
  onReviewQueue: () => void;
  heartrate: HeartrateBucketView[];
  heartrateWindow: string;
  heartrateBucketLabel: string;
  serviceGauges: ServiceGauge[];
  systemSignals: HomeHeroSignal[];
};

function gaugeTone(fill: number): GaugeTone {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatResetChip(resetAt: number, now: Date): { label: string; imminent: boolean } {
  const diffMs = resetAt - now.getTime();
  const sameDay =
    new Date(resetAt).toDateString() === now.toDateString();
  const reset = new Date(resetAt);
  const hh = String(reset.getHours()).padStart(2, "0");
  const mm = String(reset.getMinutes()).padStart(2, "0");
  const imminent = diffMs > 0 && diffMs < 6 * 3600 * 1000;
  if (sameDay) {
    return { label: `${hh}:${mm}`, imminent };
  }
  return { label: `${SHORT_WEEKDAY[reset.getDay()]} ${hh}:${mm}`, imminent };
}

function formatResetRelative(resetAt: number, now: Date): string {
  const diffSec = Math.max(0, Math.floor((resetAt - now.getTime()) / 1000));
  if (diffSec >= 86400) {
    const d = Math.floor(diffSec / 86400);
    const h = Math.floor((diffSec % 86400) / 3600);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (diffSec >= 3600) {
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.max(1, Math.floor(diffSec / 60))}m`;
}

function buildTooltip(g: Extract<ServiceGauge, { kind: "quota" }>, now: Date): string {
  const chip = formatResetChip(g.resetAt, now);
  const rel = formatResetRelative(g.resetAt, now);
  return `${g.usedLabel} / ${g.capLabel} ${g.unitLabel} · resets ${chip.label} (in ${rel})`;
}

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const segs: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return segs.join(" ");
}

function HeartrateGraph({ buckets }: { buckets: HeartrateBucketView[] }) {
  const W = 372;
  const H = 70;
  const top = 6;
  const bottom = 56;
  const labelY = 67;
  const N = buckets.length;
  const allZero = N < 2 || buckets.every((b) => b.count === 0);

  if (allZero) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
        <line x1="0" y1={bottom} x2={W} y2={bottom} stroke="var(--border)" />
        <text
          x={W / 2}
          y={H / 2 + 2}
          textAnchor="middle"
          fill="var(--dim)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          letterSpacing="0.18em"
        >
          NO SIGNAL
        </text>
      </svg>
    );
  }

  const stepX = W / (N - 1);
  const points = buckets.map((b, i) => ({
    x: i * stepX,
    y: bottom - Math.max(0, Math.min(1, b.value)) * (bottom - top),
  }));
  const path = buildSmoothPath(points);
  const areaPath = `${path} L ${W} ${bottom} L 0 ${bottom} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      <defs>
        <linearGradient id="hrdFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={top} x2={W} y2={top} stroke="var(--border)" opacity="0.18" />
      <line x1="0" y1={(top + bottom) / 2} x2={W} y2={(top + bottom) / 2} stroke="var(--border)" opacity="0.22" />
      <line x1="0" y1={bottom} x2={W} y2={bottom} stroke="var(--border)" />
      <path d={areaPath} fill="url(#hrdFill)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={points[N - 1].x} cy={points[N - 1].y} r="2.5" fill="var(--accent)" />
      <text x="0" y={labelY} fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">7d</text>
      <text x={W / 2} y={labelY} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">3d</text>
      <text x={W} y={labelY} textAnchor="end" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">now</text>
    </svg>
  );
}

function formatDateChip(d: Date): string {
  const wk = d.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const mo = d.toLocaleDateString([], { month: "short" }).toUpperCase();
  const day = String(d.getDate()).padStart(2, "0");
  return `${wk} ${day} ${mo}`;
}

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function splitBriefStatements(value: string): string[] {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return [];

  const sentenceParts = compact.match(/[^.!?]+[.!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [];
  const parts = sentenceParts.length > 1
    ? sentenceParts
    : compact.split(/\s+[;:]\s+|\s+—\s+/).map((part) => part.trim()).filter(Boolean);

  return parts.slice(0, 4).map((part) => /[.!?]$/.test(part) ? part : `${part}.`);
}

function fallbackBriefObservations(value: string): HomeHeroBriefObservation[] {
  return splitBriefStatements(value).map((text, index) => ({
    id: `fallback-${index + 1}`,
    text,
    references: [],
  }));
}

function Gauge({
  gauge,
  now,
  onClick,
}: {
  gauge: ServiceGauge;
  now: Date;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "span";
  const interactiveProps = onClick
    ? { type: "button" as const, onClick }
    : {};

  if (gauge.kind === "status") {
    return (
      <Tag
        className={`hd-gauge hd-gauge--${gauge.tone}${onClick ? " hd-gauge--interactive" : ""}`}
        {...interactiveProps}
      >
        <span className="hd-gauge-label">{gauge.label}</span>
        <span className={`hd-gauge-dot hd-gauge-dot--${gauge.tone}`} aria-hidden="true" />
        <span className="hd-gauge-status">{gauge.statusLabel}</span>
      </Tag>
    );
  }
  const tone = gaugeTone(gauge.fill);
  const pct = Math.round(gauge.fill * 100);
  const chip = formatResetChip(gauge.resetAt, now);
  return (
    <Tag
      className={`hd-gauge hd-gauge--${tone}${onClick ? " hd-gauge--interactive" : ""}`}
      title={buildTooltip(gauge, now)}
      {...interactiveProps}
    >
      <span className="hd-gauge-label">{gauge.label}</span>
      <span className="hd-gauge-bar" aria-hidden="true">
        <span className="hd-gauge-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="hd-gauge-pct">{pct}%</span>
      {chip.imminent && (
        <span className="hd-gauge-reset hd-gauge-reset--imminent">
          ↻ {chip.label}
        </span>
      )}
    </Tag>
  );
}

function SystemSignalStack({
  signals,
  navigate,
}: {
  signals: HomeHeroSignal[];
  navigate: (route: Route) => void;
}) {
  if (signals.length === 0) return null;
  return (
    <div className="hd-signal-stack" aria-label="system signals">
      {signals.map((signal) => {
        const content = (
          <>
            <span className={`hd-signal-led hd-signal-led--${signal.tone ?? "dim"}`} aria-hidden="true" />
            <span className="hd-signal-copy">
              <span className="hd-signal-label">{signal.label}</span>
              <span className="hd-signal-value">{signal.value}</span>
            </span>
          </>
        );
        const signalRoute = signal.route;
        const handleClick = signal.onClick ?? (signalRoute ? () => navigate(signalRoute) : undefined);
        if (handleClick) {
          return (
            <button
              key={signal.id}
              type="button"
              className="hd-signal-row hd-signal-row--button"
              onClick={handleClick}
            >
              {content}
            </button>
          );
        }
        return (
          <div key={signal.id} className="hd-signal-row">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function BriefReferenceChips({
  references,
  navigate,
}: {
  references: HomeHeroBriefReference[];
  navigate: (route: Route) => void;
}) {
  if (references.length === 0) return null;
  return (
    <span className="hd-brief-refs" aria-label="brief references">
      {references.slice(0, 4).map((ref) => {
        const content = (
          <>
            <span className="hd-brief-ref-kind">{ref.kind}</span>
            <span className="hd-brief-ref-label">{ref.label}</span>
          </>
        );
        if (ref.route) {
          return (
            <button
              key={ref.id}
              type="button"
              className="hd-brief-ref hd-brief-ref--button"
              title={ref.detail}
              onClick={() => navigate(ref.route as Route)}
            >
              {content}
            </button>
          );
        }
        return (
          <span key={ref.id} className="hd-brief-ref" title={ref.detail}>
            {content}
          </span>
        );
      })}
    </span>
  );
}

export default function HomeHero(props: HomeHeroProps) {
  const {
    now,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    briefRefreshing,
    onRefresh,
    onRegenerateBrief,
    onSpeakBrief,
    briefSpeaking = false,
    briefIsNew = false,
    totalOperatorQueue,
    narrativeParts,
    briefStatement,
    briefObservations,
    navigate,
    opsEnabled,
    onReviewQueue,
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
    serviceGauges,
    systemSignals,
  } = props;

  const spokenBrief = briefStatement?.trim() || "";
  const ledePart =
    narrativeParts.find((p) => p.includes("need")) ?? narrativeParts[0] ?? "";
  const displayLede = spokenBrief || (ledePart ? `${ledePart}.` : "");
  const observations = briefObservations.length > 0
    ? briefObservations
    : fallbackBriefObservations(displayLede);
  const otherParts = spokenBrief
    ? narrativeParts
    : narrativeParts.filter((p) => p !== ledePart);
  const leadsNeedsYou = !spokenBrief && ledePart.includes("need");
  const subline = otherParts.join(" · ");
  const syncTone = error ? "err" : "ok";
  const gauges = serviceGauges;
  const briefSheetVisible = briefRefreshing || observations.length > 0;
  const { runtime: sequenceRuntime } = useBriefSequenceRuntime(briefGenerationSequence, {
    active: briefRefreshing,
    speed: 3,
  });
  return (
    <section className="hd">
      <div className="hd-topbar">
        <div className="hd-topbar-l">
          <span className="hd-mark" aria-hidden="true">◆</span>
          <span className="hd-mark-text">SCOUT</span>
          <span className="hd-sep">·</span>
          <span className="hd-mark-role">home</span>
        </div>
        {gauges.length > 0 && (
          <div className="hd-topbar-c" aria-label="service usage">
            <span className="hd-gauge-window">USAGE</span>
            <span className="hd-gauge-divider" aria-hidden="true" />
            {gauges.map((g, i) => (
              <span key={g.id} className="hd-gauge-wrap">
                {i > 0 && <span className="hd-gauge-divider" aria-hidden="true" />}
                <Gauge gauge={g} now={now} onClick={() => navigate({ view: "ops" })} />
              </span>
            ))}
          </div>
        )}
        <div className="hd-topbar-r">
          <span className="hd-meta">operator: {operatorName.toLowerCase()}</span>
          <span className="hd-sep">·</span>
          <span className="hd-meta">{formatClock(now)}</span>
          <span className={`hd-dot hd-dot--${syncTone}`} aria-hidden="true" />
          <span className={`hd-meta hd-meta--${syncTone}`}>{syncLabel}</span>
        </div>
      </div>

      <div className="hd-grid">
        <div
          className="hd-panel hd-panel--lede"
          data-brief-refreshing={briefRefreshing || undefined}
        >
          <div className="hd-panel-title">
            <Bot className="hd-brief-ranger-glyph" size={12} aria-hidden="true" />
            <span>BRIEFING</span>
            <span className="hd-sep">·</span>
            <span>{formatDateChip(now)}</span>
            <button
              type="button"
              className="hd-brief-archive-link"
              onClick={() => navigate({ view: "briefings" })}
            >
              view archive
            </button>
          </div>

          {briefSheetVisible && (
            <div
              className="hd-brief-sheet"
              data-brief-refreshing={briefRefreshing || undefined}
              aria-busy={briefRefreshing || undefined}
            >
              {briefRefreshing ? (
                <div className="hd-brief-seq" aria-busy="true">
                  <BriefSequenceView runtime={sequenceRuntime} />
                </div>
              ) : (
                <div className="hd-brief-copy">
                {observations.map((observation, index) => (
                  <p
                    key={observation.id || `${observation.text}-${index}`}
                    className={`hd-brief-line${leadsNeedsYou && index === 0 ? " hd-brief-line--warn" : ""}`}
                  >
                    <Crosshair className="hd-brief-icon" size={14} strokeWidth={1.7} aria-hidden="true" />
                    <span className="hd-brief-line-body">
                      <span>{observation.text}</span>
                      <BriefReferenceChips references={observation.references} navigate={navigate} />
                    </span>
                  </p>
                ))}
                </div>
              )}
            </div>
          )}

          {subline.length > 0 && (
            <p className="hd-sub">{subline}.</p>
          )}

          {error && (
            <p className="hd-sub hd-sub--err">sync: {error}</p>
          )}

          <div className="hd-actions">
            {totalOperatorQueue > 0 && (
              <button
                type="button"
                className="hd-btn hd-btn--primary"
                onClick={onReviewQueue}
              >
                [review queue · {totalOperatorQueue}]
              </button>
            )}
            {opsEnabled && (
              <button
                type="button"
                className="hd-btn"
                onClick={() => navigate({ view: "ops" })}
              >
                [open ops]
              </button>
            )}
            {onSpeakBrief && (
              <button
                type="button"
                className={`hd-btn${briefIsNew && !briefSpeaking ? " hd-btn--primary" : ""}`}
                onClick={onSpeakBrief}
                title={briefSpeaking ? "Stop reading the brief" : briefIsNew ? "Read the new brief aloud" : "Replay the brief"}
              >
                [{briefSpeaking ? "■ stop" : briefIsNew ? "▸ speak brief" : "▸ replay"}]
              </button>
            )}
            <button
              type="button"
              className="hd-btn"
              disabled={briefRefreshing}
              onClick={onRegenerateBrief}
            >
              [{briefRefreshing ? "briefing" : "new brief"}]
            </button>
            <button
              type="button"
              className="hd-btn"
              disabled={loading || refreshing}
              onClick={onRefresh}
            >
              [{refreshing ? "refreshing" : "r refresh"}]
            </button>
          </div>
        </div>

        <div className="hd-panel hd-panel--hr">
          <div className="hd-panel-title">
            <span>HEART-RATE</span>
            <span className="hd-sep">·</span>
            <span>{heartrateWindow}</span>
            {heartrateBucketLabel ? (
              <>
                <span className="hd-sep">·</span>
                <span>{heartrateBucketLabel}</span>
              </>
            ) : null}
          </div>
          <HeartrateGraph buckets={heartrate} />
          <SystemSignalStack signals={systemSignals} navigate={navigate} />
        </div>
      </div>
    </section>
  );
}
