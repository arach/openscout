import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { PageStatusBar } from "../components/PageStatusBar.tsx";
import { api } from "../lib/api.ts";
import type { Route } from "../lib/types.ts";
import type { ServiceGauge } from "./HomeHero.tsx";
import "./harness-central.css";

type GaugeTone = "ok" | "warn" | "err" | "dim";
type HarnessQuotaState = "ready" | "weak" | "missing" | "error";
type HarnessQuotaConfidence = "strong" | "medium" | "weak";
type HarnessQuotaCategory = "local-harness" | "provider-api" | "assistant";

type HarnessQuotaMetric = {
  label: string;
  value: string;
  detail?: string;
  tone?: GaugeTone;
};

type HarnessQuotaCard = {
  id: string;
  label: string;
  provider: string;
  category: HarnessQuotaCategory;
  state: HarnessQuotaState;
  confidence: HarnessQuotaConfidence;
  summaryLabel: string;
  summaryDetail?: string;
  updatedAt: number;
  sourceLabel: string;
  secretKeys?: string[];
  docsUrl?: string;
  dashboardUrl?: string;
  gauges?: ServiceGauge[];
  metrics?: HarnessQuotaMetric[];
  error?: string;
};

type HarnessQuotasResponse = {
  generatedAt: number;
  cards: HarnessQuotaCard[];
};

type HarnessCentralScreenProps = {
  navigate: (route: Route) => void;
};

type Meter = {
  key: string;
  name: string;
  fill: number;
  tone: GaugeTone;
  usedLabel: string;
  capLabel: string;
  reset: string;
  rolling: boolean;
};

type StatusLine = {
  key: string;
  label: string;
  statusLabel: string;
  detail?: string;
  tone: GaugeTone;
};

const STATE_LABELS: Record<HarnessQuotaState, string> = {
  ready: "ready",
  weak: "manual",
  missing: "unset",
  error: "error",
};

// weak / missing sources stay deliberately quiet — they carry no live alarm,
// only an "open the dashboard" hint. Errors are the one loud state.
const STATE_DOT: Record<HarnessQuotaState, string> = {
  ready: "success",
  weak: "neutral",
  missing: "neutral",
  error: "danger",
};

const STATE_RANK: Record<HarnessQuotaState, number> = {
  ready: 0,
  weak: 1,
  missing: 2,
  error: 3,
};

const CATEGORY_ORDER: HarnessQuotaCategory[] = [
  "local-harness",
  "provider-api",
  "assistant",
];

const CATEGORY_META: Record<HarnessQuotaCategory, { label: string; note: string }> = {
  "local-harness": {
    label: "Local harnesses",
    note: "Observed from session transcripts & statusline",
  },
  "provider-api": {
    label: "Provider APIs",
    note: "Live limits & quotas from provider endpoints",
  },
  assistant: {
    label: "Assistants",
    note: "Spend & usage — some sources are dashboard-only",
  },
};

const MAX_METERS_PER_CELL = 3;

export function HarnessCentralScreen({ navigate }: HarnessCentralScreenProps) {
  const [snapshot, setSnapshot] = useState<HarnessQuotasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const suffix = forceRefresh ? "?refresh=1" : "";
      const next = await api<HarnessQuotasResponse>(`/api/harness-quotas${suffix}`);
      setSnapshot(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load harness quotas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const counts = useMemo(() => {
    const cards = snapshot?.cards ?? [];
    return {
      total: cards.length,
      ready: cards.filter((card) => card.state === "ready").length,
      live: cards.filter((card) => (card.gauges?.length ?? 0) > 0).length,
      attention: cards.filter((card) => card.state === "error").length,
    };
  }, [snapshot]);

  const groups = useMemo(() => {
    const cards = snapshot?.cards ?? [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      cards: cards
        .filter((card) => card.category === category)
        .sort((left, right) => STATE_RANK[left.state] - STATE_RANK[right.state]),
    })).filter((group) => group.cards.length > 0);
  }, [snapshot]);

  return (
    <div className="hc">
      <div className="hc-scroll">
        <header className="hc-header">
          <div className="hc-title-block">
            <div className="hc-kicker">ops / harnesses</div>
            <h1 className="hc-title">Harness Central</h1>
            <p className="hc-sub">Quota &amp; rate watch across every coding harness on this node.</p>
          </div>
          <div className="hc-actions">
            <button type="button" className="hc-btn" onClick={() => navigate({ view: "ops" })}>
              Ops
            </button>
            <button
              type="button"
              className="hc-btn hc-btn--primary"
              disabled={loading || refreshing}
              onClick={() => void load(true)}
            >
              {refreshing ? <Loader2 size={14} className="hc-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
        </header>

        <section className="hc-summary" aria-label="quota source summary">
          <Stat value={String(counts.total)} label="sources" />
          <span className="hc-summary-div" aria-hidden="true" />
          <Stat value={String(counts.live)} label="live signals" tone="ok" />
          <Stat value={String(counts.ready)} label="ready" />
          <Stat
            value={String(counts.attention)}
            label="attention"
            tone={counts.attention > 0 ? "err" : undefined}
          />
          <span className="hc-summary-spacer" />
          <Stat value={snapshot ? formatRelative(snapshot.generatedAt) : "--"} label="updated" muted />
        </section>

        {error ? (
          <div className="hc-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="hc-table" aria-busy={loading} role="table" aria-label="Harness quota sources">
          <div className="hc-thead" role="row">
            <span>Source</span>
            <span>Signal</span>
            <span>Quota &amp; limits</span>
            <span>Links</span>
          </div>
          {loading && !snapshot
            ? Array.from({ length: 6 }, (_, index) => <QuotaSkeleton key={index} />)
            : groups.map((group) => (
                <Fragment key={group.category}>
                  <div className="hc-group" role="row">
                    <span className="hc-group-label">{CATEGORY_META[group.category].label}</span>
                    <span className="hc-group-count">{group.cards.length}</span>
                    <span className="hc-group-note">{CATEGORY_META[group.category].note}</span>
                  </div>
                  {group.cards.map((card) => (
                    <QuotaRow key={card.id} card={card} />
                  ))}
                </Fragment>
              ))}
        </section>
      </div>
      <PageStatusBar />
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
  muted,
}: {
  value: string;
  label: string;
  tone?: GaugeTone;
  muted?: boolean;
}) {
  return (
    <div className={`hc-stat${muted ? " hc-stat--muted" : ""}`}>
      <span className={`hc-stat-value${tone ? ` hc-stat-value--${tone}` : ""}`}>{value}</span>
      <span className="hc-stat-label">{label}</span>
    </div>
  );
}

function QuotaRow({ card }: { card: HarnessQuotaCard }) {
  const links = [
    card.dashboardUrl ? { label: "Dashboard", href: card.dashboardUrl } : null,
    card.docsUrl ? { label: "Docs", href: card.docsUrl } : null,
  ].filter((entry): entry is { label: string; href: string } => entry !== null);

  return (
    <article className={`hc-row hc-row--${card.state}`} role="row">
      <div className="hc-cell hc-cell--src" role="cell">
        <div className="hc-src-name">{card.label}</div>
        <div className="hc-src-from" title={card.sourceLabel}>{card.sourceLabel}</div>
      </div>

      <div className="hc-cell hc-cell--signal" role="cell">
        <div className="hc-signal-top">
          <span className={`dot dot--${STATE_DOT[card.state]}`} aria-hidden="true" />
          <span className={`hc-state hc-state--${card.state}`}>{STATE_LABELS[card.state]}</span>
          <span className={`hc-conf hc-conf--${card.confidence}`}>{card.confidence}</span>
        </div>
        <div className="hc-signal-label">{card.summaryLabel}</div>
        {card.summaryDetail ? <p className="hc-signal-detail">{card.summaryDetail}</p> : null}
      </div>

      <div className="hc-cell hc-cell--quota" role="cell">
        <QuotaCell card={card} />
      </div>

      <div className="hc-cell hc-cell--links" role="cell">
        {links.length > 0 ? (
          links.map((link) => (
            <a key={link.href} className="hc-link" href={link.href} target="_blank" rel="noreferrer">
              <ExternalLink size={11} />
              {link.label}
            </a>
          ))
        ) : (
          <span className="hc-empty">—</span>
        )}
      </div>
    </article>
  );
}

function QuotaCell({ card }: { card: HarnessQuotaCard }) {
  const statuses = statusLinesFromCard(card);
  const meters = metersFromCard(card);

  if (statuses.length === 0 && meters.length === 0) {
    return <QuietCell card={card} />;
  }

  const shown = meters.slice(0, MAX_METERS_PER_CELL);
  const overflow = meters.length - shown.length;

  return (
    <div className="hc-meters">
      {statuses.map((status) => (
        <div key={status.key} className={`hc-status-line hc-status-line--${status.tone}`}>
          <span className={`dot dot--${dotToneFor(status.tone)}`} aria-hidden="true" />
          <span className="hc-status-name">{status.label}</span>
          <span className="hc-status-value">{status.statusLabel}</span>
          {status.detail ? <span className="hc-status-detail">{status.detail}</span> : null}
        </div>
      ))}
      {shown.map((meter) => (
        <MeterRow key={meter.key} meter={meter} />
      ))}
      {overflow > 0 ? <div className="hc-meter-more">+{overflow} more window{overflow === 1 ? "" : "s"}</div> : null}
    </div>
  );
}

function MeterRow({ meter }: { meter: Meter }) {
  const pct = Math.round(meter.fill * 100);
  // percentage-based windows (Claude/Codex) already read as "39%" — don't append "/100%"
  const used = meter.capLabel === "100%" && meter.usedLabel.endsWith("%")
    ? meter.usedLabel
    : `${meter.usedLabel}/${meter.capLabel}`;
  return (
    <div className="hc-meter">
      <span className="hc-meter-name" title={meter.name}>{meter.name}</span>
      <span className="hc-meter-bar" aria-hidden="true">
        <span className={`hc-meter-fill hc-meter-fill--${meter.tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="hc-meter-used">{used}</span>
      <span className={`hc-meter-reset${meter.rolling ? " hc-meter-reset--rolling" : ""}`}>
        {meter.reset}
      </span>
    </div>
  );
}

function QuietCell({ card }: { card: HarnessQuotaCard }) {
  if (card.state === "error" && card.error) {
    return <p className="hc-quiet hc-quiet--error">{card.error}</p>;
  }
  const notes = (card.metrics ?? []).slice(0, 3);
  if (notes.length === 0) {
    return <span className="hc-quiet">Dashboard-only source</span>;
  }
  return (
    <dl className="hc-notes">
      {notes.map((note) => (
        <div key={`${note.label}:${note.value}`} className={`hc-note${note.tone ? ` hc-note--${note.tone}` : ""}`}>
          <dt className="hc-note-key">{note.label}</dt>
          <dd className="hc-note-val">
            {note.value}
            {note.detail ? <span className="hc-note-detail">{note.detail}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function QuotaSkeleton() {
  return (
    <div className="hc-row hc-row--skeleton" role="row">
      <div className="hc-skel hc-skel--title" />
      <div className="hc-skel hc-skel--wide" />
      <div className="hc-skel" />
      <div className="hc-skel hc-skel--short" />
    </div>
  );
}

function metersFromCard(card: HarnessQuotaCard): Meter[] {
  const out: Meter[] = [];
  for (const gauge of card.gauges ?? []) {
    if (gauge.kind !== "quota") continue;
    const windows = gauge.windows && gauge.windows.length > 0
      ? gauge.windows
      : [{
          label: gauge.unitLabel,
          fill: gauge.fill,
          usedLabel: gauge.usedLabel,
          capLabel: gauge.capLabel,
          unitLabel: gauge.unitLabel,
          resetAt: gauge.resetAt,
        }];
    const multi = windows.length > 1;
    windows.forEach((window, index) => {
      const rolling = window.unitLabel === "rpm" || window.unitLabel === "tpm";
      out.push({
        key: `${gauge.id}:${window.label}:${index}`,
        name: multi ? window.label : gauge.label,
        fill: clamp01(window.fill),
        tone: fillTone(window.fill),
        usedLabel: window.usedLabel,
        capLabel: window.capLabel,
        rolling,
        reset: rolling ? "rolling" : `↻ ${formatRelative(window.resetAt)}`,
      });
    });
  }
  // most-constrained first so the tightest window is always visible in a capped cell
  return out.sort((left, right) => right.fill - left.fill);
}

function statusLinesFromCard(card: HarnessQuotaCard): StatusLine[] {
  const out: StatusLine[] = [];
  for (const gauge of card.gauges ?? []) {
    if (gauge.kind !== "status") continue;
    out.push({
      key: gauge.id,
      label: gauge.windowLabel ?? gauge.label,
      statusLabel: gauge.statusLabel,
      detail: gauge.detailLabel,
      tone: gauge.tone,
    });
  }
  return out;
}

function dotToneFor(tone: GaugeTone): string {
  switch (tone) {
    case "ok":
      return "success";
    case "warn":
      return "warning";
    case "err":
      return "danger";
    default:
      return "neutral";
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function fillTone(fill: number): GaugeTone {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "" : " ago";
  if (abs >= 86400_000) return `${Math.round(abs / 86400_000)}d${suffix}`;
  if (abs >= 3600_000) return `${Math.round(abs / 3600_000)}h${suffix}`;
  if (abs >= 60_000) return `${Math.max(1, Math.round(abs / 60_000))}m${suffix}`;
  return diff >= 0 ? "now" : "just now";
}
