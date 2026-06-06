import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  loadServiceBudgets,
  type ServiceGauge,
  type ServiceQuotaWindowGauge,
} from "./service-budgets.ts";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const SECRET_TIMEOUT_MS = 2_000;
const XAI_MODEL = "grok-4.20-0309-non-reasoning";

type GaugeTone = "ok" | "warn" | "err" | "dim";

export type HarnessQuotaState = "ready" | "weak" | "missing" | "error";
export type HarnessQuotaConfidence = "strong" | "medium" | "weak";
export type HarnessQuotaCategory = "local-harness" | "provider-api" | "assistant";

export type HarnessQuotaMetric = {
  label: string;
  value: string;
  detail?: string;
  tone?: GaugeTone;
};

export type HarnessQuotaLink = {
  label: string;
  href: string;
};

export type HarnessQuotaCard = {
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
  links?: HarnessQuotaLink[];
  error?: string;
};

export type HarnessQuotasResponse = {
  generatedAt: number;
  cards: HarnessQuotaCard[];
};

export type LoadHarnessQuotasOptions = {
  forceRefresh?: boolean;
};

type ResolvedSecret = {
  key: string;
  source: "env" | "secret";
  value: string;
};

type FetchJsonResult = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
};

type FlatValue = {
  path: string;
  key: string;
  value: number | string;
};

let cached: { value: HarnessQuotasResponse; expiresAt: number } | null = null;
let inflight: Promise<HarnessQuotasResponse> | null = null;

export async function loadHarnessQuotas(
  options: LoadHarnessQuotasOptions = {},
): Promise<HarnessQuotasResponse> {
  const now = Date.now();
  if (options.forceRefresh) {
    cached = null;
  }
  if (!options.forceRefresh && cached && cached.expiresAt > now) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const budgetsPromise = loadServiceBudgets({ forceRefresh: options.forceRefresh });
    const [copilot, xai, cursor, minimax, budgets] = await Promise.all([
      loadCopilotQuotaCard(),
      loadXaiQuotaCard(),
      loadCursorQuotaCard(),
      loadMiniMaxQuotaCard(),
      budgetsPromise,
    ]);
    const cardForGauge = (id: "claude" | "codex", label: string, sourceLabel: string): HarnessQuotaCard =>
      serviceGaugeCard(id, label, sourceLabel, budgets.gauges.find((gauge) => gauge.id === id));
    const value: HarnessQuotasResponse = {
      generatedAt: Date.now(),
      cards: [
        copilot,
        xai,
        cursor,
        minimax,
        cardForGauge("claude", "Claude", "statusline + local sessions"),
        cardForGauge("codex", "Codex", "local session rate limits"),
      ],
    };
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearHarnessQuotasCache(): void {
  cached = null;
  inflight = null;
}

function serviceGaugeCard(
  id: "claude" | "codex",
  label: string,
  sourceLabel: string,
  gauge: ServiceGauge | undefined,
): HarnessQuotaCard {
  const now = Date.now();
  if (!gauge) {
    return {
      id,
      label,
      provider: label,
      category: "local-harness",
      state: "missing",
      confidence: "weak",
      summaryLabel: "No fresh local quota signal",
      summaryDetail: id === "claude"
        ? "Waiting for Claude statusline or recent transcript usage."
        : "Waiting for recent Codex rate-limit events.",
      updatedAt: now,
      sourceLabel,
      metrics: [],
    };
  }

  return {
    id,
    label,
    provider: label,
    category: "local-harness",
    state: "ready",
    confidence: "strong",
    summaryLabel: gauge.kind === "quota"
      ? `${gauge.usedLabel} ${gauge.unitLabel}`
      : gauge.statusLabel,
    summaryDetail: gauge.kind === "quota"
      ? "Quota windows from the harness transcript stream."
      : gauge.detailLabel ?? gauge.windowLabel ?? "Observed local status.",
    updatedAt: now,
    sourceLabel,
    gauges: [gauge],
    metrics: metricsFromServiceGauge(gauge),
  };
}

function metricsFromServiceGauge(gauge: ServiceGauge): HarnessQuotaMetric[] {
  if (gauge.kind === "status") {
    return [
      {
        label: gauge.windowLabel ?? "status",
        value: gauge.statusLabel,
        detail: gauge.detailLabel,
        tone: gauge.tone,
      },
    ];
  }
  return quotaWindows(gauge).map((window) => ({
    label: window.label,
    value: `${window.usedLabel}/${window.capLabel}`,
    detail: `resets ${formatDateTime(window.resetAt)}`,
    tone: gaugeTone(window.fill),
  }));
}

async function loadXaiQuotaCard(): Promise<HarnessQuotaCard> {
  const secretKeys = ["SCOUT_XAI_API_KEY", "XAI_API_KEY"];
  const secret = await resolveSecret(secretKeys);
  const now = Date.now();
  if (!secret) {
    return missingProviderCard({
      id: "xai",
      label: "xAI",
      provider: "xAI",
      sourceLabel: "API response headers",
      secretKeys,
      docsUrl: "https://docs.x.ai/docs/api-reference",
      dashboardUrl: "https://console.x.ai/",
      summaryDetail: "Set SCOUT_XAI_API_KEY to read live RPM/TPM headers.",
    });
  }

  const result = await fetchJson("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENSCOUT_XAI_QUOTA_MODEL?.trim() || XAI_MODEL,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 1,
      stream: false,
      temperature: 0,
    }),
  }).catch((error) => errorResult(error));

  if (!result.ok) {
    return providerErrorCard({
      id: "xai",
      label: "xAI",
      provider: "xAI",
      sourceLabel: `API probe via ${secret.key}`,
      secretKeys,
      docsUrl: "https://docs.x.ai/docs/api-reference",
      dashboardUrl: "https://console.x.ai/",
      error: summarizeHttpError("xAI", result),
    });
  }

  const requestLimit = headerNumber(result.headers, "x-ratelimit-limit-requests");
  const requestRemaining = headerNumber(result.headers, "x-ratelimit-remaining-requests");
  const tokenLimit = headerNumber(result.headers, "x-ratelimit-limit-tokens");
  const tokenRemaining = headerNumber(result.headers, "x-ratelimit-remaining-tokens");
  const usage = objectRecord(readRecord(result.body, "usage"));
  const promptTokens = numberValue(usage?.prompt_tokens ?? usage?.input_tokens);
  const completionTokens = numberValue(usage?.completion_tokens ?? usage?.output_tokens);
  const costTicks = numberValue(usage?.cost_in_usd_ticks);
  const gauges = [
    liveQuotaGauge("xai-requests", "requests", requestRemaining, requestLimit, "rpm"),
    liveQuotaGauge("xai-tokens", "tokens", tokenRemaining, tokenLimit, "tpm"),
  ].filter((gauge): gauge is ServiceGauge => gauge !== null);
  const metrics: HarnessQuotaMetric[] = [
    rateMetric("requests", requestRemaining, requestLimit, "requests/min"),
    rateMetric("tokens", tokenRemaining, tokenLimit, "tokens/min"),
    promptTokens !== null ? { label: "input tokens", value: formatWholeNumber(promptTokens), detail: "last probe" } : null,
    completionTokens !== null ? { label: "output tokens", value: formatWholeNumber(completionTokens), detail: "last probe" } : null,
    costTicks !== null
      ? { label: "probe cost", value: formatCurrency(costTicks / 10_000_000_000), detail: "provider-reported" }
      : null,
  ].filter((metric): metric is HarnessQuotaMetric => metric !== null);

  return {
    id: "xai",
    label: "xAI",
    provider: "xAI",
    category: "provider-api",
    state: "ready",
    confidence: gauges.length > 0 ? "strong" : "medium",
    summaryLabel: gauges.length > 0 ? "Live RPM/TPM" : "Probe succeeded",
    summaryDetail: "Account balance still lives in the xAI console; the API exposes live rate telemetry on responses.",
    updatedAt: now,
    sourceLabel: `API probe via ${secret.key}`,
    secretKeys,
    docsUrl: "https://docs.x.ai/docs/api-reference",
    dashboardUrl: "https://console.x.ai/",
    gauges,
    metrics,
  };
}

async function loadCursorQuotaCard(): Promise<HarnessQuotaCard> {
  const secretKeys = ["SCOUT_CURSOR_API_KEY", "CURSOR_API_KEY"];
  const secret = await resolveSecret(secretKeys);
  const now = Date.now();
  if (!secret) {
    return missingProviderCard({
      id: "cursor",
      label: "Cursor",
      provider: "Cursor",
      sourceLabel: "Admin API spend",
      secretKeys,
      docsUrl: "https://docs.cursor.com/en/account/teams/admin-api",
      dashboardUrl: "https://cursor.com/dashboard",
      summaryDetail: "Set SCOUT_CURSOR_API_KEY from Cursor Admin API keys.",
    });
  }

  const result = await fetchJson("https://api.cursor.com/teams/spend", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${secret.value}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page: 1, pageSize: 100 }),
  }).catch((error) => errorResult(error));

  if (!result.ok) {
    if (isCursorSoloAccountResponse(result)) {
      return {
        id: "cursor",
        label: "Cursor",
        provider: "Cursor",
        category: "assistant",
        state: "weak",
        confidence: "weak",
        summaryLabel: "Solo account source",
        summaryDetail: "Cursor's Admin API is team-scoped. Solo account usage remains dashboard-only.",
        updatedAt: now,
        sourceLabel: `Solo account via ${secret.key}`,
        secretKeys,
        docsUrl: "https://docs.cursor.com/en/account/teams/admin-api",
        dashboardUrl: "https://cursor.com/dashboard",
        metrics: [
          { label: "api key", value: "configured", detail: secret.key, tone: "ok" },
          { label: "quota source", value: "dashboard", detail: "solo account", tone: "dim" },
          { label: "team spend api", value: "not available", detail: "requires Team Admin API key", tone: "dim" },
        ],
      };
    }
    return providerErrorCard({
      id: "cursor",
      label: "Cursor",
      provider: "Cursor",
      sourceLabel: `Admin API via ${secret.key}`,
      secretKeys,
      docsUrl: "https://docs.cursor.com/en/account/teams/admin-api",
      dashboardUrl: "https://cursor.com/dashboard",
      error: summarizeHttpError("Cursor", result),
    });
  }

  const body = objectRecord(result.body);
  const memberSpend = Array.isArray(body?.teamMemberSpend) ? body.teamMemberSpend : [];
  const spendCents = sumNumberFields(memberSpend, "spendCents");
  const fastRequests = sumNumberFields(memberSpend, "fastPremiumRequests");
  const hardLimitDollars = sumNumberFields(memberSpend, "hardLimitOverrideDollars");
  const totalMembers = numberValue(body?.totalMembers) ?? memberSpend.length;
  const totalPages = numberValue(body?.totalPages);
  const cycleStart = numberValue(body?.subscriptionCycleStart);
  const resetAt = cycleStart ? addOneMonth(cycleStart) : nextCalendarMonth();
  const metrics: HarnessQuotaMetric[] = [
    { label: "spend", value: formatCurrency(spendCents / 100), detail: "current billing cycle" },
    { label: "fast requests", value: formatWholeNumber(fastRequests), detail: "team month-to-date" },
    { label: "members", value: formatWholeNumber(totalMembers), detail: totalPages ? `${totalPages} page${totalPages === 1 ? "" : "s"}` : undefined },
    cycleStart ? { label: "cycle start", value: formatDate(cycleStart) } : null,
    hardLimitDollars > 0
      ? { label: "member limits", value: formatCurrency(hardLimitDollars), detail: "sum of overrides" }
      : null,
  ].filter((metric): metric is HarnessQuotaMetric => metric !== null);

  const gauges = hardLimitDollars > 0
    ? [spendGauge("cursor-spend", "spend", spendCents / 100, hardLimitDollars, resetAt)]
    : [];

  return {
    id: "cursor",
    label: "Cursor",
    provider: "Cursor",
    category: "assistant",
    state: "ready",
    confidence: "strong",
    summaryLabel: `${formatCurrency(spendCents / 100)} cycle spend`,
    summaryDetail: `${formatWholeNumber(fastRequests)} fast premium requests`,
    updatedAt: now,
    sourceLabel: `Admin API via ${secret.key}`,
    secretKeys,
    docsUrl: "https://docs.cursor.com/en/account/teams/admin-api",
    dashboardUrl: "https://cursor.com/dashboard",
    gauges,
    metrics,
  };
}

function isCursorSoloAccountResponse(result: FetchJsonResult): boolean {
  if (result.status !== 401 && result.status !== 403) return false;
  const message = `${extractErrorMessage(result.body) ?? ""} ${result.text}`.toLowerCase();
  return message.includes("invalid team api key") || message.includes("team api key");
}

async function loadMiniMaxQuotaCard(): Promise<HarnessQuotaCard> {
  const secretKeys = ["SCOUT_MINIMAX_API_KEY", "MINIMAX_API_KEY", "MINIMAX_TOKEN"];
  const secret = await resolveSecret(secretKeys);
  const now = Date.now();
  if (!secret) {
    return missingProviderCard({
      id: "minimax",
      label: "MiniMax",
      provider: "MiniMax",
      sourceLabel: "Token Plan remains API",
      secretKeys,
      docsUrl: "https://platform.minimax.io/docs/coding-plan/faq",
      dashboardUrl: "https://platform.minimax.io/subscribe/token-plan",
      summaryDetail: "Set SCOUT_MINIMAX_API_KEY or MINIMAX_API_KEY for Token Plan quotas.",
    });
  }

  const base = process.env.SCOUT_MINIMAX_TOKEN_PLAN_BASE_URL?.trim() || "https://www.minimax.io";
  const result = await fetchJson(`${base.replace(/\/+$/u, "")}/v1/token_plan/remains`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${secret.value}`,
      "Content-Type": "application/json",
    },
  }).catch((error) => errorResult(error));

  if (!result.ok) {
    return providerErrorCard({
      id: "minimax",
      label: "MiniMax",
      provider: "MiniMax",
      sourceLabel: `Token Plan via ${secret.key}`,
      secretKeys,
      docsUrl: "https://platform.minimax.io/docs/coding-plan/faq",
      dashboardUrl: "https://platform.minimax.io/subscribe/token-plan",
      error: summarizeHttpError("MiniMax", result),
    });
  }

  const known = miniMaxKnownQuota(result.body);
  if (known) {
    return {
      id: "minimax",
      label: "MiniMax",
      provider: "MiniMax",
      category: "provider-api",
      state: "ready",
      confidence: "strong",
      summaryLabel: known.summaryLabel,
      summaryDetail: "M2.7 uses a 5-hour rolling window; other MiniMax model quotas reset daily.",
      updatedAt: now,
      sourceLabel: `Token Plan via ${secret.key}`,
      secretKeys,
      docsUrl: "https://platform.minimax.io/docs/coding-plan/faq",
      dashboardUrl: "https://platform.minimax.io/subscribe/token-plan",
      gauges: known.gauges,
      metrics: known.metrics,
    };
  }

  const flat = flattenValues(result.body);
  const interestingNumbers = flat
    .filter((entry): entry is FlatValue & { value: number } =>
      typeof entry.value === "number"
      && Number.isFinite(entry.value)
      && quotaFieldPattern(entry.path)
      && !ignoredNumericFieldPattern(entry.path),
    )
    .slice(0, 8);
  const firstPlanText = flat.find((entry) =>
    typeof entry.value === "string" && /(plan|quota|model|tier|reset|expire)/iu.test(entry.path),
  );
  const gaugeSource = findRemainingTotalPair(interestingNumbers);
  const gauges = gaugeSource
    ? [remainingGauge("minimax-remains", "MiniMax", gaugeSource.remaining, gaugeSource.total, gaugeSource.resetAt)]
    : [];
  const metrics: HarnessQuotaMetric[] = interestingNumbers.length > 0
    ? interestingNumbers.slice(0, 6).map((entry) => ({
        label: metricLabel(entry.path),
        value: formatMetricNumber(entry.value, entry.path),
      }))
    : [{ label: "endpoint", value: "ready", detail: "response schema available" }];
  if (firstPlanText && typeof firstPlanText.value === "string") {
    metrics.unshift({
      label: metricLabel(firstPlanText.path),
      value: truncate(firstPlanText.value, 26),
    });
  }

  return {
    id: "minimax",
    label: "MiniMax",
    provider: "MiniMax",
    category: "provider-api",
    state: "ready",
    confidence: gauges.length > 0 ? "strong" : "medium",
    summaryLabel: gauges.length > 0 ? "Token Plan quota" : "Token Plan endpoint ready",
    summaryDetail: "M2.7 uses a 5-hour rolling window; other MiniMax model quotas reset daily.",
    updatedAt: now,
    sourceLabel: `Token Plan via ${secret.key}`,
    secretKeys,
    docsUrl: "https://platform.minimax.io/docs/coding-plan/faq",
    dashboardUrl: "https://platform.minimax.io/subscribe/token-plan",
    gauges,
    metrics,
  };
}

function miniMaxKnownQuota(body: unknown): {
  summaryLabel: string;
  gauges: ServiceGauge[];
  metrics: HarnessQuotaMetric[];
} | null {
  const root = objectRecord(body);
  const rows = Array.isArray(root?.model_remains) ? root.model_remains : null;
  if (!rows || rows.length === 0) return null;

  const gauges: ServiceGauge[] = [];
  const metrics: HarnessQuotaMetric[] = [];
  for (const row of rows.slice(0, 4)) {
    const record = objectRecord(row);
    if (!record) continue;
    const modelName = stringValue(record.model_name) ?? "model";
    const intervalTotal = numberValue(record.current_interval_total_count);
    const intervalUsed = numberValue(record.current_interval_usage_count);
    const intervalEnd = timestampMs(numberValue(record.end_time));
    const intervalRemainingPercent = numberValue(record.current_interval_remaining_percent);
    const weeklyTotal = numberValue(record.current_weekly_total_count);
    const weeklyUsed = numberValue(record.current_weekly_usage_count);
    const weeklyEnd = timestampMs(numberValue(record.weekly_end_time));
    const weeklyRemainingPercent = numberValue(record.current_weekly_remaining_percent);

    if (intervalTotal !== null && intervalUsed !== null && intervalTotal > 0) {
      gauges.push(usageCountGauge(
        `minimax-${modelName}-interval`,
        `${modelName} interval`,
        intervalUsed,
        intervalTotal,
        intervalEnd,
      ));
      metrics.push({
        label: `${modelName} interval`,
        value: `${formatWholeNumber(intervalUsed)}/${formatWholeNumber(intervalTotal)}`,
        detail: intervalEnd ? `resets ${formatDateTime(intervalEnd)}` : undefined,
        tone: intervalUsed / intervalTotal >= 0.75 ? "warn" : "ok",
      });
    } else if (intervalRemainingPercent !== null) {
      metrics.push({
        label: `${modelName} interval`,
        value: `${Math.round(intervalRemainingPercent)}%`,
        detail: "remaining",
        tone: intervalRemainingPercent <= 15 ? "warn" : "ok",
      });
    }

    if (weeklyTotal !== null && weeklyUsed !== null && weeklyTotal > 0) {
      gauges.push(usageCountGauge(
        `minimax-${modelName}-weekly`,
        `${modelName} weekly`,
        weeklyUsed,
        weeklyTotal,
        weeklyEnd,
      ));
      metrics.push({
        label: `${modelName} weekly`,
        value: `${formatWholeNumber(weeklyUsed)}/${formatWholeNumber(weeklyTotal)}`,
        detail: weeklyEnd ? `resets ${formatDateTime(weeklyEnd)}` : undefined,
        tone: weeklyUsed / weeklyTotal >= 0.75 ? "warn" : "ok",
      });
    } else if (weeklyRemainingPercent !== null) {
      metrics.push({
        label: `${modelName} weekly`,
        value: `${Math.round(weeklyRemainingPercent)}%`,
        detail: "remaining",
        tone: weeklyRemainingPercent <= 15 ? "warn" : "ok",
      });
    }
  }

  return {
    summaryLabel: `${rows.length} Token Plan model${rows.length === 1 ? "" : "s"}`,
    gauges,
    metrics: metrics.slice(0, 8),
  };
}

async function loadCopilotQuotaCard(): Promise<HarnessQuotaCard> {
  const tokenKeys = ["SCOUT_COPILOT_GITHUB_TOKEN", "SCOUT_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
  const orgKeys = ["SCOUT_COPILOT_ORG", "GITHUB_COPILOT_ORG", "GITHUB_ORG"];
  const token = await resolveSecret(tokenKeys);
  const org = resolvePlainValue(orgKeys);
  const now = Date.now();
  const secretKeys = [...tokenKeys, ...orgKeys];

  if (!token || !org) {
    return {
      id: "copilot",
      label: "Copilot",
      provider: "GitHub Copilot",
      category: "assistant",
      state: "weak",
      confidence: "weak",
      summaryLabel: "Dashboard-only source",
      summaryDetail: "Personal Copilot does not expose a quota balance API. Org metrics can be enabled separately.",
      updatedAt: now,
      sourceLabel: "GitHub Copilot metrics",
      secretKeys,
      docsUrl: "https://docs.github.com/rest/copilot/copilot-usage",
      dashboardUrl: "https://github.com/settings/copilot/features",
      metrics: [
        { label: "personal quota", value: "dashboard", detail: "manual source", tone: "dim" },
        { label: "org metrics", value: org ? org : "not configured", detail: token ? "token ready" : "needs token", tone: org && token ? "ok" : "dim" },
      ],
    };
  }

  const url = new URL(`https://api.github.com/orgs/${encodeURIComponent(org)}/copilot/metrics`);
  url.searchParams.set("per_page", "28");
  const result = await fetchJson(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token.value}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }).catch((error) => errorResult(error));

  if (!result.ok) {
    return providerErrorCard({
      id: "copilot",
      label: "Copilot",
      provider: "GitHub Copilot",
      sourceLabel: `GitHub org metrics for ${org}`,
      secretKeys,
      docsUrl: "https://docs.github.com/rest/copilot/copilot-usage",
      dashboardUrl: "https://github.com/settings/copilot/features",
      error: summarizeHttpError("GitHub Copilot", result),
    });
  }

  const days = Array.isArray(result.body) ? result.body : [];
  const latest = objectRecord(days[days.length - 1]);
  const activeUsers = numberValue(latest?.total_active_users);
  const engagedUsers = numberValue(latest?.total_engaged_users);
  const suggestions = sumNumberFields(days, "total_code_suggestions");
  const acceptances = sumNumberFields(days, "total_code_acceptances");
  const rawMetrics: Array<HarnessQuotaMetric | null> = [
    { label: "days", value: formatWholeNumber(days.length), detail: "latest response" },
    activeUsers !== null ? { label: "active users", value: formatWholeNumber(activeUsers), detail: "latest day" } : null,
    engagedUsers !== null ? { label: "engaged users", value: formatWholeNumber(engagedUsers), detail: "latest day" } : null,
    suggestions > 0 ? { label: "suggestions", value: formatWholeNumber(suggestions), detail: "response total" } : null,
    acceptances > 0 ? { label: "acceptances", value: formatWholeNumber(acceptances), detail: "response total" } : null,
  ];
  const metrics = rawMetrics.filter((metric): metric is HarnessQuotaMetric => metric !== null);

  return {
    id: "copilot",
    label: "Copilot",
    provider: "GitHub Copilot",
    category: "assistant",
    state: "ready",
    confidence: "medium",
    summaryLabel: activeUsers !== null
      ? `${formatWholeNumber(activeUsers)} active users`
      : "Org metrics ready",
    summaryDetail: "This is usage telemetry, not a personal quota balance.",
    updatedAt: now,
    sourceLabel: `GitHub org metrics for ${org}`,
    secretKeys,
    docsUrl: "https://docs.github.com/rest/copilot/copilot-usage",
    dashboardUrl: "https://github.com/settings/copilot/features",
    metrics,
  };
}

function missingProviderCard(input: {
  id: string;
  label: string;
  provider: string;
  sourceLabel: string;
  secretKeys: string[];
  docsUrl?: string;
  dashboardUrl?: string;
  summaryDetail?: string;
}): HarnessQuotaCard {
  return {
    id: input.id,
    label: input.label,
    provider: input.provider,
    category: "provider-api",
    state: "missing",
    confidence: "weak",
    summaryLabel: "Key not configured",
    summaryDetail: input.summaryDetail,
    updatedAt: Date.now(),
    sourceLabel: input.sourceLabel,
    secretKeys: input.secretKeys,
    docsUrl: input.docsUrl,
    dashboardUrl: input.dashboardUrl,
    metrics: [],
  };
}

function providerErrorCard(input: {
  id: string;
  label: string;
  provider: string;
  sourceLabel: string;
  secretKeys: string[];
  docsUrl?: string;
  dashboardUrl?: string;
  error: string;
}): HarnessQuotaCard {
  return {
    id: input.id,
    label: input.label,
    provider: input.provider,
    category: "provider-api",
    state: "error",
    confidence: "weak",
    summaryLabel: "Quota probe failed",
    summaryDetail: input.error,
    updatedAt: Date.now(),
    sourceLabel: input.sourceLabel,
    secretKeys: input.secretKeys,
    docsUrl: input.docsUrl,
    dashboardUrl: input.dashboardUrl,
    error: input.error,
    metrics: [{ label: "error", value: truncate(input.error, 48), tone: "err" }],
  };
}

function quotaWindows(gauge: Extract<ServiceGauge, { kind: "quota" }>): ServiceQuotaWindowGauge[] {
  return gauge.windows && gauge.windows.length > 0
    ? gauge.windows
    : [{
        label: gauge.unitLabel,
        fill: gauge.fill,
        usedLabel: gauge.usedLabel,
        capLabel: gauge.capLabel,
        unitLabel: gauge.unitLabel,
        resetAt: gauge.resetAt,
      }];
}

function liveQuotaGauge(
  id: string,
  label: string,
  remaining: number | null,
  limit: number | null,
  unitLabel: string,
): ServiceGauge | null {
  if (remaining === null || limit === null || limit <= 0) return null;
  const used = Math.max(0, limit - remaining);
  const fill = Math.max(0, Math.min(1, used / limit));
  const resetAt = Date.now() + 60_000;
  return {
    id,
    label,
    kind: "quota",
    fill,
    usedLabel: formatCompact(used),
    capLabel: formatCompact(limit),
    unitLabel,
    resetAt,
    windows: [{
      label: "1m",
      fill,
      usedLabel: formatCompact(used),
      capLabel: formatCompact(limit),
      unitLabel,
      resetAt,
    }],
  };
}

function spendGauge(id: string, label: string, used: number, cap: number, resetAt: number): ServiceGauge {
  const fill = cap > 0 ? Math.max(0, Math.min(1, used / cap)) : 0;
  return {
    id,
    label,
    kind: "quota",
    fill,
    usedLabel: formatCurrency(used),
    capLabel: formatCurrency(cap),
    unitLabel: "cycle",
    resetAt,
    windows: [{
      label: "cycle",
      fill,
      usedLabel: formatCurrency(used),
      capLabel: formatCurrency(cap),
      unitLabel: "spend",
      resetAt,
    }],
  };
}

function remainingGauge(
  id: string,
  label: string,
  remaining: number,
  total: number,
  resetAt: number | null,
): ServiceGauge {
  const used = Math.max(0, total - remaining);
  const fill = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const resolvedResetAt = resetAt ?? Date.now() + 5 * 3600 * 1000;
  return {
    id,
    label,
    kind: "quota",
    fill,
    usedLabel: formatCompact(used),
    capLabel: formatCompact(total),
    unitLabel: "quota",
    resetAt: resolvedResetAt,
    windows: [{
      label: "plan",
      fill,
      usedLabel: formatCompact(used),
      capLabel: formatCompact(total),
      unitLabel: "quota",
      resetAt: resolvedResetAt,
    }],
  };
}

function usageCountGauge(
  id: string,
  label: string,
  used: number,
  total: number,
  resetAt: number | null,
): ServiceGauge {
  const fill = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const resolvedResetAt = resetAt ?? Date.now() + 5 * 3600 * 1000;
  return {
    id,
    label,
    kind: "quota",
    fill,
    usedLabel: formatWholeNumber(used),
    capLabel: formatWholeNumber(total),
    unitLabel: "requests",
    resetAt: resolvedResetAt,
    windows: [{
      label: label.includes("weekly") ? "7d" : "window",
      fill,
      usedLabel: formatWholeNumber(used),
      capLabel: formatWholeNumber(total),
      unitLabel: "requests",
      resetAt: resolvedResetAt,
    }],
  };
}

function rateMetric(
  label: string,
  remaining: number | null,
  limit: number | null,
  detail: string,
): HarnessQuotaMetric | null {
  if (remaining === null || limit === null) return null;
  return {
    label: `remaining ${label}`,
    value: formatCompact(remaining),
    detail: `of ${formatCompact(limit)} ${detail} limit`,
    tone: remaining / Math.max(1, limit) < 0.15 ? "warn" : "ok",
  };
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchJsonResult> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body,
    text,
  };
}

function errorResult(error: unknown): FetchJsonResult {
  const message = error instanceof Error ? error.message : "request failed";
  return {
    ok: false,
    status: 0,
    headers: new Headers(),
    body: { error: { message } },
    text: message,
  };
}

async function resolveSecret(keys: readonly string[]): Promise<ResolvedSecret | null> {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, source: "env", value };
  }

  for (const key of keys) {
    const value = await readSecretValue(key);
    if (value) return { key, source: "secret", value };
  }

  return null;
}

function resolvePlainValue(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

async function readSecretValue(key: string): Promise<string | null> {
  const candidates = [
    process.env.OPENSCOUT_SECRET_BIN?.trim() || "",
    join(homedir(), ".local", "bin", "secret"),
    "secret",
  ].filter(Boolean);
  for (const command of candidates) {
    try {
      const { stdout } = await execFileAsync(command, ["get", key], {
        timeout: SECRET_TIMEOUT_MS,
        maxBuffer: 4096,
      });
      const value = stdout.trim();
      if (value) return value;
    } catch {
      continue;
    }
  }
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRecord(value: unknown, key: string): unknown {
  return objectRecord(value)?.[key];
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function headerNumber(headers: Headers, key: string): number | null {
  return numberValue(headers.get(key));
}

function summarizeHttpError(provider: string, result: FetchJsonResult): string {
  const message = extractErrorMessage(result.body) || result.text.trim();
  const suffix = message ? `: ${truncate(message, 160)}` : "";
  return result.status > 0
    ? `${provider} API ${result.status}${suffix}`
    : `${provider} request failed${suffix}`;
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") return value;
  const object = objectRecord(value);
  if (!object) return null;
  const direct = object.message;
  if (typeof direct === "string") return direct;
  const error = objectRecord(object.error);
  if (typeof error?.message === "string") return error.message;
  if (typeof object.error === "string") return object.error;
  return null;
}

function sumNumberFields(value: unknown, fieldName: string): number {
  let total = 0;
  const visit = (entry: unknown): void => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    const record = entry as Record<string, unknown>;
    const direct = numberValue(record[fieldName]);
    if (direct !== null) total += direct;
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(value);
  return total;
}

function flattenValues(value: unknown, prefix = "", out: FlatValue[] = []): FlatValue[] {
  if (typeof value === "number" || typeof value === "string") {
    out.push({ path: prefix || "value", key: prefix.split(".").pop() || "value", value });
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.slice(0, 16).forEach((entry, index) => {
      flattenValues(entry, prefix ? `${prefix}.${index}` : String(index), out);
    });
    return out;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    flattenValues(nested, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function quotaFieldPattern(path: string): boolean {
  return /(remain|remaining|used|usage|total|limit|quota|credit|balance|request|token|reset|expire)/iu.test(path);
}

function ignoredNumericFieldPattern(path: string): boolean {
  return /(^|\.)(code|status|status_code|err_code|errno|http_status)$/iu.test(path);
}

function findRemainingTotalPair(
  entries: Array<FlatValue & { value: number }>,
): { remaining: number; total: number; resetAt: number | null } | null {
  const remaining = entries.find((entry) => /(remain|remaining|available|left)/iu.test(entry.path));
  const total = entries.find((entry) =>
    /(total|limit|quota|max)/iu.test(entry.path)
    && !/(remain|remaining|available|left)/iu.test(entry.path)
    && entry.value >= (remaining?.value ?? 0),
  );
  if (!remaining || !total || total.value <= 0) return null;
  const resetEntry = entries.find((entry) => /(reset|expire|expires|end)/iu.test(entry.path));
  return {
    remaining: remaining.value,
    total: total.value,
    resetAt: timestampMs(resetEntry?.value ?? null),
  };
}

function timestampMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > 1_000_000_000_000) return value;
  if (value > 1_000_000_000) return value * 1000;
  return null;
}

function metricLabel(path: string): string {
  const parts = path
    .split(".")
    .filter((part) => !/^\d+$/u.test(part))
    .slice(-2);
  return (parts.join(" ") || path)
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase())
    .slice(0, 28);
}

function gaugeTone(fill: number): GaugeTone {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}

function formatMetricNumber(value: number, path: string): string {
  if (/(cost|spend|balance|credit|usd|dollar)/iu.test(path)) {
    return formatCurrency(value);
  }
  return formatCompact(value);
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) {
    return `$${value.toFixed(5)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function addOneMonth(ms: number): number {
  const date = new Date(ms);
  date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

function nextCalendarMonth(): number {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}
