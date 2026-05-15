import type { Route } from "../lib/types.ts";
import "./home-hero.css";

type HeartrateBucketView = { ts: number; count: number; value: number };

export type HomeHeroProps = {
  now: Date;
  greeting: string;
  operatorName: string;
  syncLabel: string;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  activeCount: number;
  waitingCount: number;
  offlineCount: number;
  totalAgents: number;
  totalOperatorQueue: number;
  narrativeParts: string[];
  navigate: (route: Route) => void;
  opsEnabled: boolean;
  onReviewQueue: () => void;
  heartrate: HeartrateBucketView[];
  heartrateWindow: string;
  heartrateBucketLabel: string;
};

type GaugeTone = "ok" | "warn" | "err" | "dim";

type ServiceGauge =
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
  return `${g.usedLabel} / ${g.capLabel} ${g.unitLabel} · weekly · resets ${chip.label} (in ${rel})`;
}

// TODO(wire): pull from a /api/service-budgets endpoint. Each cell is the WEEKLY
// allocation for a service — the headline reading. Click → ops budgets view
// (multi-window detail, per-feature breakdown, rebalance suggestions).
function mockServiceGauges(now: Date): ServiceGauge[] {
  const t = now.getTime();
  return [
    {
      id: "codex",
      label: "codex",
      kind: "quota",
      fill: 0.55,
      usedLabel: "5.5M",
      capLabel: "10M",
      unitLabel: "tokens",
      resetAt: t + (3 * 86400 + 6 * 3600) * 1000,
    },
    {
      id: "claude",
      label: "claude",
      kind: "quota",
      fill: 0.71,
      usedLabel: "7.1M",
      capLabel: "10M",
      unitLabel: "tokens",
      resetAt: t + 4 * 3600 * 1000,
    },
    {
      id: "github",
      label: "github",
      kind: "quota",
      fill: 0.38,
      usedLabel: "190k",
      capLabel: "500k",
      unitLabel: "requests",
      resetAt: t + (6 * 86400 + 8 * 3600) * 1000,
    },
  ];
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

export default function HomeHero(props: HomeHeroProps) {
  const {
    now,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    onRefresh,
    activeCount,
    waitingCount,
    offlineCount,
    totalOperatorQueue,
    narrativeParts,
    navigate,
    opsEnabled,
    onReviewQueue,
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
  } = props;

  const ledePart =
    narrativeParts.find((p) => p.includes("need")) ?? narrativeParts[0] ?? "";
  const otherParts = narrativeParts.filter((p) => p !== ledePart);
  const leadsNeedsYou = ledePart.includes("need");
  const subline = otherParts.join(" · ");
  const syncTone = error ? "err" : "ok";
  const gauges = mockServiceGauges(now);

  return (
    <section className="hd">
      <div className="hd-topbar">
        <div className="hd-topbar-l">
          <span className="hd-mark" aria-hidden="true">◆</span>
          <span className="hd-mark-text">SCOUT</span>
          <span className="hd-sep">·</span>
          <span className="hd-mark-role">home</span>
        </div>
        <div className="hd-topbar-c" aria-label="weekly token budgets">
          <span className="hd-gauge-window">WEEKLY</span>
          <span className="hd-gauge-divider" aria-hidden="true" />
          {gauges.map((g, i) => (
            <span key={g.id} className="hd-gauge-wrap">
              {i > 0 && <span className="hd-gauge-divider" aria-hidden="true" />}
              <Gauge gauge={g} now={now} onClick={() => navigate({ view: "ops" })} />
            </span>
          ))}
        </div>
        <div className="hd-topbar-r">
          <span className="hd-meta">operator: {operatorName.toLowerCase()}</span>
          <span className="hd-sep">·</span>
          <span className="hd-meta">{formatClock(now)}</span>
          <span className={`hd-dot hd-dot--${syncTone}`} aria-hidden="true" />
          <span className={`hd-meta hd-meta--${syncTone}`}>{syncLabel}</span>
        </div>
      </div>

      <div className="hd-grid">
        <div className="hd-panel hd-panel--lede">
          <div className="hd-panel-title">
            <span>BRIEFING</span>
            <span className="hd-sep">·</span>
            <span>{formatDateChip(now)}</span>
          </div>

          {ledePart && (
            <h1 className={`hd-lede${leadsNeedsYou ? " hd-lede--warn" : ""}`}>
              {ledePart}.
            </h1>
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
            <button
              type="button"
              className="hd-btn"
              onClick={() => navigate({ view: "sessions" })}
            >
              [jump to thread]
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
          <div className="hd-stats">
            <div className="hd-stat">
              <span className="hd-stat-row">
                <span className="hd-stat-dot hd-stat-dot--ok" aria-hidden="true" />
                <span className="hd-stat-label">active</span>
              </span>
              <span className="hd-stat-val">{String(activeCount).padStart(2, "0")}</span>
            </div>
            <div className="hd-stat">
              <span className="hd-stat-row">
                <span className="hd-stat-dot hd-stat-dot--warn" aria-hidden="true" />
                <span className="hd-stat-label">waiting</span>
              </span>
              <span className="hd-stat-val">{String(waitingCount).padStart(2, "0")}</span>
            </div>
            <div className="hd-stat">
              <span className="hd-stat-row">
                <span className="hd-stat-dot hd-stat-dot--off" aria-hidden="true" />
                <span className="hd-stat-label">offline</span>
              </span>
              <span className="hd-stat-val">{String(offlineCount).padStart(2, "0")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
