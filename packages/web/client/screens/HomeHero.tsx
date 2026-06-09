import { useState } from "react";
import type { Route } from "../lib/types.ts";
import "./home-hero.css";

type HeartrateBucketView = { ts: number; count: number; value: number };

type GaugeTone = "ok" | "warn" | "err" | "dim";

type ServiceQuotaHistoryPoint = {
  capturedAt: number;
  fill: number;
  usedLabel: string;
  resetAt?: number;
};

type ServiceQuotaWindowGauge = {
  label: string;
  fill: number;
  usedLabel: string;
  capLabel: string;
  unitLabel: string;
  resetAt: number;
  history?: ServiceQuotaHistoryPoint[];
};

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
      windows?: ServiceQuotaWindowGauge[];
    }
  | {
      id: string;
      label: string;
      kind: "status";
      statusLabel: string;
      windowLabel?: string;
      detailLabel?: string;
      tone: GaugeTone;
    };

export type HomeHeroProps = {
  now: Date;
  greeting: string;
  operatorName: string;
  syncLabel: string;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  totalOperatorQueue: number;
  narrativeParts: string[];
  navigate: (route: Route) => void;
  opsEnabled: boolean;
  onReviewQueue: () => void;
  heartrate: HeartrateBucketView[];
  heartrateWindow: string;
  heartrateBucketLabel: string;
  heartrateVisibleEventThreshold?: number;
  serviceGauges: ServiceGauge[];
};

const HEARTRATE_VISIBLE_EVENT_THRESHOLD = 3;
const HOME_SERVICE_GAUGE_LIMIT = 2;

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

function quotaWindows(g: Extract<ServiceGauge, { kind: "quota" }>): ServiceQuotaWindowGauge[] {
  return g.windows && g.windows.length > 0
    ? g.windows
    : [{
        label: formatLegacyQuotaLabel(g.unitLabel),
        fill: g.fill,
        usedLabel: g.usedLabel,
        capLabel: g.capLabel,
        unitLabel: g.unitLabel,
        resetAt: g.resetAt,
      }];
}

function formatLegacyQuotaLabel(label: string): string {
  switch (label) {
    case "weekly":
      return "7d";
    case "req/h":
      return "1h";
    default:
      return label || "quota";
  }
}

function buildTooltip(g: Extract<ServiceGauge, { kind: "quota" }>, now: Date): string {
  return quotaWindows(g)
    .map((window) => {
      const chip = formatResetChip(window.resetAt, now);
      const rel = formatResetRelative(window.resetAt, now);
      return `${window.label}: ${window.usedLabel} / ${window.capLabel} ${window.unitLabel} · resets ${chip.label} (in ${rel})`;
    })
    .join(" · ");
}

function quotaWindowMinutes(label: string): number | null {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)([mhd])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]?.toLowerCase()) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 24 * 60;
    default:
      return null;
  }
}

function splitQuotaWindows(windows: ServiceQuotaWindowGauge[]): {
  shortWindow: ServiceQuotaWindowGauge | null;
  longWindow: ServiceQuotaWindowGauge | null;
} {
  const sorted = [...windows].sort((a, b) =>
    (quotaWindowMinutes(a.label) ?? Number.MAX_SAFE_INTEGER) -
    (quotaWindowMinutes(b.label) ?? Number.MAX_SAFE_INTEGER),
  );
  const longWindow =
    sorted.find((window) => (quotaWindowMinutes(window.label) ?? 0) >= 24 * 60) ??
    (sorted.length > 1 ? sorted[sorted.length - 1]! : null);
  const shortWindow = sorted.find((window) => window !== longWindow) ?? null;
  return { shortWindow, longWindow };
}

function usageLabel(window: ServiceQuotaWindowGauge): string {
  if (window.capLabel === "100%" && window.usedLabel.endsWith("%")) {
    return window.usedLabel;
  }
  return `${window.usedLabel}/${window.capLabel}`;
}

function EmptyGaugeCell() {
  return <span className="hd-gauge-cell hd-gauge-cell--empty">—</span>;
}

function QuotaUsageCell({ window }: { window: ServiceQuotaWindowGauge | null }) {
  if (!window) return <EmptyGaugeCell />;
  const windowPct = Math.round(window.fill * 100);
  const windowTone = gaugeTone(window.fill);
  return (
    <span className="hd-gauge-cell hd-gauge-cell--usage">
      <span className="hd-gauge-window-name">{window.label}</span>
      <span className="hd-gauge-bar" aria-hidden="true">
        <span className={`hd-gauge-bar-fill hd-gauge-bar-fill--${windowTone}`} style={{ width: `${windowPct}%` }} />
      </span>
      <span className="hd-gauge-window-used">{usageLabel(window)}</span>
    </span>
  );
}

function QuotaResetCell({
  window,
  now,
}: {
  window: ServiceQuotaWindowGauge | null;
  now: Date;
}) {
  if (!window) return <EmptyGaugeCell />;
  const chip = formatResetChip(window.resetAt, now);
  const rel = formatResetRelative(window.resetAt, now);
  return (
    <span className={`hd-gauge-cell hd-gauge-reset${chip.imminent ? " hd-gauge-reset--imminent" : ""}`}>
      ↻ {rel}
    </span>
  );
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
        className={`hd-gauge hd-gauge--status hd-gauge--${gauge.tone}${onClick ? " hd-gauge--interactive" : ""}`}
        aria-label={`${gauge.label} subscription usage`}
        {...interactiveProps}
      >
        <span className="hd-gauge-head">
          <span className="hd-gauge-label">{gauge.label}</span>
          <span className={`hd-gauge-dot hd-gauge-dot--${gauge.tone}`} aria-hidden="true" />
        </span>
        <EmptyGaugeCell />
        <EmptyGaugeCell />
        <span className="hd-gauge-cell hd-gauge-cell--usage hd-gauge-cell--status">
          <span className="hd-gauge-window-name">{gauge.windowLabel ?? "usage"}</span>
          <span className="hd-gauge-status">{gauge.statusLabel}</span>
        </span>
        <span className="hd-gauge-cell hd-gauge-reset">{gauge.detailLabel ?? "quota n/a"}</span>
      </Tag>
    );
  }
  const windows = quotaWindows(gauge);
  const { shortWindow, longWindow } = splitQuotaWindows(windows);
  const tone = gaugeTone(Math.max(...windows.map((window) => window.fill)));
  const pct = Math.round(Math.max(...windows.map((window) => window.fill)) * 100);
  return (
    <Tag
      className={`hd-gauge hd-gauge--${tone}${onClick ? " hd-gauge--interactive" : ""}`}
      title={buildTooltip(gauge, now)}
      aria-label={`${gauge.label} subscription usage`}
      {...interactiveProps}
    >
      <span className="hd-gauge-head">
        <span className="hd-gauge-label">{gauge.label}</span>
        <span className={`hd-gauge-pct hd-gauge-pct--${tone}`}>{pct}%</span>
      </span>
      <QuotaUsageCell window={shortWindow} />
      <QuotaResetCell window={shortWindow} now={now} />
      <QuotaUsageCell window={longWindow} />
      <QuotaResetCell window={longWindow} now={now} />
    </Tag>
  );
}

function compactNumberValue(label: string): number {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/u);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  switch (match[2]?.toLowerCase()) {
    case "m":
      return value * 1_000_000;
    case "k":
      return value * 1_000;
    default:
      return value;
  }
}

function gaugeUsageScore(gauge: ServiceGauge): number {
  if (gauge.kind === "quota") {
    return Math.max(gauge.fill, ...quotaWindows(gauge).map((window) => window.fill));
  }

  // Status gauges do not have a quota denominator. Treat nonzero observed usage
  // as noteworthy, but let any meaningfully-used quota window outrank it.
  return compactNumberValue(gauge.statusLabel) > 0 ? 0.01 : 0;
}

function topServiceGauges(gauges: ServiceGauge[]): ServiceGauge[] {
  return sortedServiceGauges(gauges)
    .slice(0, HOME_SERVICE_GAUGE_LIMIT);
}

function sortedServiceGauges(gauges: ServiceGauge[]): ServiceGauge[] {
  return gauges
    .map((gauge, index) => ({ gauge, index, score: gaugeUsageScore(gauge) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ gauge }) => gauge);
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
    totalOperatorQueue,
    narrativeParts,
    navigate,
    opsEnabled,
    onReviewQueue,
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
    heartrateVisibleEventThreshold = HEARTRATE_VISIBLE_EVENT_THRESHOLD,
    serviceGauges,
  } = props;
  const [showAllGauges, setShowAllGauges] = useState(false);

  const ledePart =
    narrativeParts.find((p) => p.includes("need")) ?? narrativeParts[0] ?? "";
  const displayLede = ledePart ? `${ledePart}.` : "Scout is waiting for a fresh snapshot.";
  const otherParts = narrativeParts.filter((p) => p !== ledePart);
  const leadsNeedsYou = ledePart.includes("need");
  const subline = otherParts.join(" · ");
  const syncTone = error ? "err" : "ok";
  const sortedGauges = sortedServiceGauges(serviceGauges);
  const compactGauges = topServiceGauges(serviceGauges);
  const gauges = showAllGauges ? sortedGauges : compactGauges;
  const hasHiddenGauges = serviceGauges.length > compactGauges.length;
  const showHeartrate = heartrate.reduce((total, bucket) => total + bucket.count, 0)
    >= heartrateVisibleEventThreshold;
  return (
    <section className="hd">
      <div className="hd-topbar">
        <div className="hd-topbar-l">
          <span className="hd-path">home</span>
          <span className="hd-path-sep">/</span>
          <span className="hd-path">fleet</span>
          <span className="hd-path-sep">/</span>
          <span className="hd-path hd-path--muted">{formatDateChip(now)}</span>
        </div>
        <div className="hd-topbar-r">
          <span className="hd-meta-label">operator</span>
          <span className="hd-meta hd-meta--operator">{operatorName.toLowerCase()}</span>
          <span className="hd-path-sep">/</span>
          <span className="hd-meta">{formatClock(now)}</span>
          <span className={`hd-dot hd-dot--${syncTone}`} aria-hidden="true" />
          <span className={`hd-meta hd-meta--${syncTone}`}>{syncLabel}</span>
        </div>
        {gauges.length > 0 && (
          <div className="hd-topbar-c" aria-label="service usage">
            <div className="hd-gauge-title-row">
              <span className="hd-gauge-window">SUBSCRIPTIONS</span>
              {hasHiddenGauges && (
                <button
                  type="button"
                  className="hd-gauge-toggle"
                  aria-expanded={showAllGauges}
                  onClick={() => setShowAllGauges((value) => !value)}
                >
                  [{showAllGauges ? "top 2" : `all ${serviceGauges.length}`}]
                </button>
              )}
            </div>
            <div className="hd-gauge-set">
              <div className="hd-gauge-table-head" aria-hidden="true">
                <span>service</span>
                <span>short window</span>
                <span>resets</span>
                <span>long window</span>
                <span>resets</span>
              </div>
              {gauges.map((g) => (
                <span key={g.id} className="hd-gauge-wrap">
                  <Gauge gauge={g} now={now} onClick={() => navigate({ view: "harnesses" })} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={`hd-grid${showHeartrate ? "" : " hd-grid--single"}`}>
        <div className="hd-panel hd-panel--lede">
          <div className="hd-panel-title">
            <span>STATUS</span>
            <span className="hd-sep">·</span>
            <span>{formatDateChip(now)}</span>
          </div>

          <p className={`hd-status-line${leadsNeedsYou ? " hd-status-line--warn" : ""}`}>
            {displayLede}
          </p>

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
              disabled={loading || refreshing}
              onClick={onRefresh}
            >
              [{refreshing ? "refreshing" : "r refresh"}]
            </button>
          </div>
        </div>

        {showHeartrate && (
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
          </div>
        )}
      </div>
    </section>
  );
}
