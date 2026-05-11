import { randomUUID } from "node:crypto";

export type RangerAssistantMessageRole = "user" | "assistant";

export type RangerAssistantMessage = {
  id: string;
  role: RangerAssistantMessageRole;
  body: string;
  createdAt: number;
};

export type RangerAssistantSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messageCount: number;
};

export type RangerAssistantSession = RangerAssistantSessionSummary & {
  messages: RangerAssistantMessage[];
};

export type RangerAssistantConfig = {
  editable: true;
  model: string;
  systemPrompt: string;
};

export type RangerAssistantSessionState = {
  session: RangerAssistantSession;
  sessions: RangerAssistantSessionSummary[];
  config: RangerAssistantConfig;
};

export type RangerAssistantReply = RangerAssistantSessionState & {
  reply: RangerAssistantMessage;
  responseId: string | null;
};

export type RangerBriefStep = {
  id: string;
  label: string;
  route: Record<string, unknown>;
  narration: string;
  durationMs: number;
  snapshot: {
    capturedAt: number;
    expiresAt: number;
    source: "prepared" | "refreshed" | "live";
  };
};

export type RangerBriefAction = {
  label: string;
  route?: Record<string, unknown>;
  prompt?: string;
};

export type RangerBrief = {
  id: string;
  title: string;
  summary: string;
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  steps: RangerBriefStep[];
  recommendation: string;
  actions: RangerBriefAction[];
};

export type RangerAssistantContextSnapshot = {
  generatedAt: string;
  currentDirectory: string;
  currentRoute?: unknown;
  state: Record<string, unknown>;
};

export type RangerAssistantService = {
  getConfig: () => RangerAssistantConfig;
  updateConfig: (input: { model?: string | null; systemPrompt?: string | null }) => RangerAssistantConfig;
  getSessionState: () => RangerAssistantSessionState;
  resetSession: () => RangerAssistantSessionState;
  switchSession: (id: string) => RangerAssistantSessionState;
  respond: (input: { body: string; route?: unknown }) => Promise<RangerAssistantReply>;
  createBrief: (input: { route?: unknown; ttlMs?: number | null }) => Promise<RangerBrief>;
};

type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  previousResponseId: string | null;
  messages: RangerAssistantMessage[];
};

type OpenAIResponsePayload = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
  error?: unknown;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_SESSIONS = 12;
const MAX_MESSAGES_PER_SESSION = 40;
const DEFAULT_BRIEF_TTL_MS = 2 * 60_000;
const MAX_BRIEF_TTL_MS = 3 * 60_000;
const MIN_BRIEF_TTL_MS = 30_000;

const DEFAULT_SYSTEM_PROMPT = [
  "You are Ranger, the in-app OpenScout control-plane assistant.",
  "You are not a peer agent in the Scout fleet. You are the operator's direct loop inside the web app.",
  "Use the provided Scout state snapshot and current UI route to answer state questions quickly and concretely.",
  "When the operator asks for navigation, include a single fenced scout-ui JSON block after your human reply.",
  "Supported scout-ui actions are navigate, refresh, open-ranger, reminder, and ask-agent.",
  "For reminders, emit {\"type\":\"reminder\",\"body\":\"what to revisit\",\"delayMinutes\":3} or a dueAt epoch timestamp; reminders stay in the operator-side Ranger loop.",
  "When the operator explicitly asks you to ask, delegate to, or get an answer from a specific Scout agent, emit {\"type\":\"ask-agent\",\"targetLabel\":\"agent handle or selector\",\"body\":\"the exact request to send\"}; do not use ask-agent unless the operator clearly requested durable coordination.",
  "Supported navigate views include inbox, fleet, agents, sessions, mesh, broker, activity, settings, terminal, work, conversation, and ops.",
  "Do not create or imply durable Scout messages, work items, or agent asks unless the operator explicitly requests coordination.",
  "If durable coordination is needed, say that it should go through Scout broker records and be clear about the intended target.",
  "Keep answers concise unless the operator asks for minutiae.",
].join("\n");

export function createRangerAssistantService(input: {
  currentDirectory: string;
  loadContext: (route?: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;
  resolveApiKey?: () => Promise<string | null | undefined> | string | null | undefined;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): RangerAssistantService {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const sessions: StoredSession[] = [];
  let activeSessionId: string | null = null;
  let model = firstNonEmptyString(
    env.OPENSCOUT_RANGER_ASSISTANT_MODEL,
    env.OPENSCOUT_RANGER_MODEL,
    env.OPENAI_MODEL,
  ) ?? DEFAULT_MODEL;
  let systemPrompt = firstNonEmptyString(env.OPENSCOUT_RANGER_ASSISTANT_PROMPT)
    ?? DEFAULT_SYSTEM_PROMPT;

  const ensureSession = (): StoredSession => {
    const existing = activeSessionId
      ? sessions.find((session) => session.id === activeSessionId)
      : null;
    if (existing) return existing;

    const session = createSession(model);
    sessions.unshift(session);
    activeSessionId = session.id;
    pruneSessions(sessions);
    return session;
  };

  const snapshot = (): RangerAssistantSessionState => ({
    session: publicSession(ensureSession()),
    sessions: sessions.map(publicSessionSummary),
    config: { editable: true, model, systemPrompt },
  });
  const resolveApiKey = async (): Promise<string | undefined> =>
    firstNonEmptyString(
      env.OPENAI_API_KEY,
      await input.resolveApiKey?.(),
    );
  const contextSnapshot = async (route?: unknown): Promise<RangerAssistantContextSnapshot> => ({
    generatedAt: new Date().toISOString(),
    currentDirectory: input.currentDirectory,
    ...(route !== undefined ? { currentRoute: route } : {}),
    state: await input.loadContext(route),
  });

  return {
    getConfig: () => ({ editable: true, model, systemPrompt }),
    updateConfig: (next) => {
      const nextModel = next.model?.trim();
      const nextPrompt = next.systemPrompt?.trim();
      if (nextModel) model = nextModel;
      if (nextPrompt) systemPrompt = nextPrompt;
      return { editable: true, model, systemPrompt };
    },
    getSessionState: snapshot,
    resetSession: () => {
      const session = createSession(model);
      sessions.unshift(session);
      activeSessionId = session.id;
      pruneSessions(sessions);
      return snapshot();
    },
    switchSession: (id) => {
      const target = sessions.find((session) => session.id === id);
      if (!target) {
        throw new RangerAssistantError(`Ranger session "${id}" not found.`, 404);
      }
      activeSessionId = target.id;
      return snapshot();
    },
    respond: async ({ body, route }) => {
      const trimmed = body.trim();
      if (!trimmed) {
        throw new RangerAssistantError("body is required", 400);
      }

      const apiKey = await resolveApiKey();
      if (!apiKey) {
        throw new RangerAssistantError("An OpenAI API key is required for Ranger assistant. Add one in Settings > Credentials or set OPENAI_API_KEY.", 503);
      }

      const session = ensureSession();
      const context = await contextSnapshot(route);

      const response = await callOpenAIResponse({
        apiKey,
        baseUrl: firstNonEmptyString(env.OPENAI_BASE_URL, env.OPENSCOUT_OPENAI_BASE_URL)
          ?? DEFAULT_OPENAI_BASE_URL,
        fetchImpl,
        model,
        systemPrompt,
        previousResponseId: session.previousResponseId,
        body: trimmed,
        context,
      });
      const replyBody = response.text.trim();
      if (!replyBody) {
        throw new RangerAssistantError("Ranger returned an empty response.", 502);
      }

      const now = Date.now();
      const userMessage: RangerAssistantMessage = {
        id: `msg_${randomUUID()}`,
        role: "user",
        body: trimmed,
        createdAt: now,
      };
      const assistantMessage: RangerAssistantMessage = {
        id: `msg_${randomUUID()}`,
        role: "assistant",
        body: replyBody,
        createdAt: Date.now(),
      };

      session.messages.push(userMessage, assistantMessage);
      session.messages.splice(0, Math.max(0, session.messages.length - MAX_MESSAGES_PER_SESSION));
      session.updatedAt = assistantMessage.createdAt;
      session.model = model;
      session.previousResponseId = response.id ?? session.previousResponseId;
      if (session.title === "New Ranger Session") {
        session.title = titleFromRequest(trimmed);
      }

      return {
        ...snapshot(),
        reply: assistantMessage,
        responseId: response.id,
      };
    },
    createBrief: async ({ route, ttlMs }) => {
      const apiKey = await resolveApiKey();
      if (!apiKey) {
        throw new RangerAssistantError("An OpenAI API key is required for Ranger assistant. Add one in Settings > Credentials or set OPENAI_API_KEY.", 503);
      }

      const now = Date.now();
      const resolvedTtlMs = clampNumber(ttlMs ?? DEFAULT_BRIEF_TTL_MS, MIN_BRIEF_TTL_MS, MAX_BRIEF_TTL_MS);
      const context = await contextSnapshot(route);
      const response = await callOpenAIResponse({
        apiKey,
        baseUrl: firstNonEmptyString(env.OPENAI_BASE_URL, env.OPENSCOUT_OPENAI_BASE_URL)
          ?? DEFAULT_OPENAI_BASE_URL,
        fetchImpl,
        model,
        systemPrompt: briefSystemPrompt(systemPrompt),
        previousResponseId: null,
        body: briefOperatorRequest(resolvedTtlMs),
        context,
      });

      return parseBriefResponse(response.text, {
        preparedAt: now,
        ttlMs: resolvedTtlMs,
      });
    },
  };
}

export class RangerAssistantError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "RangerAssistantError";
  }
}

async function callOpenAIResponse(input: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  model: string;
  systemPrompt: string;
  previousResponseId: string | null;
  body: string;
  context: RangerAssistantContextSnapshot;
}): Promise<{ id: string | null; text: string }> {
  const response = await input.fetchImpl(`${trimTrailingSlash(input.baseUrl)}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      instructions: input.systemPrompt,
      ...(input.previousResponseId ? { previous_response_id: input.previousResponseId } : {}),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Operator request:\n${input.body}`,
                "",
                "Current Scout control-plane snapshot:",
                JSON.stringify(input.context, null, 2),
              ].join("\n"),
            },
          ],
        },
      ],
    }),
  });

  const raw = await response.text();
  let parsed: OpenAIResponsePayload = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as OpenAIResponsePayload;
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    throw new RangerAssistantError(openAIErrorMessage(parsed) || raw || `OpenAI returned HTTP ${response.status}`, 502);
  }

  return {
    id: typeof parsed.id === "string" ? parsed.id : null,
    text: extractResponseText(parsed),
  };
}

function extractResponseText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function openAIErrorMessage(payload: OpenAIResponsePayload): string | null {
  const error = payload.error;
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error !== "object") return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function briefSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
    "",
    "One-minute brief mode:",
    "Return only a JSON object. Do not wrap it in markdown.",
    "The object must include title, summary, steps, recommendation, and actions.",
    "steps must contain 3 to 5 safe UI stops. Each step needs id, label, route, and narration.",
    "Use short spoken narration. Each step should be roughly 8 to 22 words.",
    "Use only these routes unless the snapshot strongly suggests a more specific safe route: fleet, ops tail, sessions, broker, mesh, activity, agents.",
    "Do not create durable Scout records or imply that work has been started.",
  ].join("\n");
}

function briefOperatorRequest(ttlMs: number): string {
  return [
    "Prepare a one-minute OpenScout control-plane brief for spoken narration.",
    `The prepared snapshot TTL is ${Math.round(ttlMs / 1000)} seconds.`,
    "Walk through only the relevant views, explain what matters at each stop, and finish with one recommended next action.",
    "Return this exact JSON shape:",
    JSON.stringify({
      title: "One-minute brief",
      summary: "One sentence overview.",
      steps: [
        {
          id: "fleet",
          label: "Fleet",
          route: { view: "fleet" },
          narration: "Fleet is quiet: nine available, none actively working.",
        },
      ],
      recommendation: "One concrete next action.",
      actions: [
        { label: "Open Ops Tail", route: { view: "ops", mode: "tail" } },
      ],
    }),
  ].join("\n");
}

function parseBriefResponse(
  raw: string,
  timing: { preparedAt: number; ttlMs: number },
): RangerBrief {
  const parsed = parseJsonObject(raw);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const expiresAt = timing.preparedAt + timing.ttlMs;
  const steps = normalizeBriefSteps(record.steps, timing.preparedAt, expiresAt);
  const fallbackSummary = raw.replace(/\s+/g, " ").trim();

  return {
    id: `brf_${randomUUID()}`,
    title: stringField(record.title, "One-minute brief"),
    summary: stringField(record.summary, fallbackSummary || "Ranger prepared a current control-plane brief."),
    preparedAt: timing.preparedAt,
    expiresAt,
    ttlMs: timing.ttlMs,
    steps: steps.length > 0 ? steps : fallbackBriefSteps(fallbackSummary, timing.preparedAt, expiresAt),
    recommendation: stringField(record.recommendation, fallbackSummary || "Start with the current ops view."),
    actions: normalizeBriefActions(record.actions),
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const candidates = [
    trimmed,
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter((candidate) => candidate.trim().startsWith("{") && candidate.trim().endsWith("}"));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function normalizeBriefSteps(raw: unknown, capturedAt: number, expiresAt: number): RangerBriefStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((entry, index) => normalizeBriefStep(entry, index, capturedAt, expiresAt))
    .filter((entry): entry is RangerBriefStep => Boolean(entry));
}

function normalizeBriefStep(
  raw: unknown,
  index: number,
  capturedAt: number,
  expiresAt: number,
): RangerBriefStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const route = sanitizeBriefRoute(record.route);
  const narration = stringField(record.narration, "").trim();
  if (!route || !narration) return null;
  const label = stringField(record.label, routeLabel(route));
  return {
    id: stringField(record.id, `${String(route.view ?? "step")}-${index + 1}`).replace(/[^a-z0-9_-]/gi, "-").toLowerCase(),
    label,
    route,
    narration,
    durationMs: estimateNarrationDuration(narration),
    snapshot: {
      capturedAt,
      expiresAt,
      source: "prepared",
    },
  };
}

function fallbackBriefSteps(summary: string, capturedAt: number, expiresAt: number): RangerBriefStep[] {
  const narration = summary || "I prepared a fresh control-plane snapshot. Start with Fleet, then check Ops Tail and Broker health.";
  return [
    {
      id: "fleet",
      label: "Fleet",
      route: { view: "fleet" },
      narration,
      durationMs: estimateNarrationDuration(narration),
      snapshot: { capturedAt, expiresAt, source: "prepared" },
    },
  ];
}

function normalizeBriefActions(raw: unknown): RangerBriefAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const label = stringField(record.label, "").trim();
      if (!label) return null;
      const route = sanitizeBriefRoute(record.route);
      const prompt = typeof record.prompt === "string" && record.prompt.trim()
        ? record.prompt.trim()
        : undefined;
      return {
        label,
        ...(route ? { route } : {}),
        ...(prompt ? { prompt } : {}),
      };
    })
    .filter((entry): entry is RangerBriefAction => Boolean(entry));
}

function sanitizeBriefRoute(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const view = typeof record.view === "string" ? record.view : "";
  switch (view) {
    case "fleet":
    case "agents":
    case "sessions":
    case "broker":
    case "mesh":
    case "activity":
    case "settings":
      return { view };
    case "ops":
      return {
        view: "ops",
        ...(record.mode === "tail" || record.mode === "atop" || record.mode === "agents"
          ? { mode: record.mode }
          : { mode: "tail" }),
      };
    case "conversation":
      return typeof record.conversationId === "string"
        ? { view, conversationId: record.conversationId }
        : null;
    case "work":
      return typeof record.workId === "string" ? { view, workId: record.workId } : null;
    default:
      return null;
  }
}

function routeLabel(route: Record<string, unknown>): string {
  if (route.view === "ops") return "Ops";
  return typeof route.view === "string"
    ? route.view.slice(0, 1).toUpperCase() + route.view.slice(1)
    : "Step";
}

function estimateNarrationDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return clampNumber(words * 360, 3500, 12_000);
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function createSession(model: string): StoredSession {
  const now = Date.now();
  return {
    id: `rgr_${randomUUID()}`,
    title: "New Ranger Session",
    createdAt: now,
    updatedAt: now,
    model,
    previousResponseId: null,
    messages: [],
  };
}

function publicSession(session: StoredSession): RangerAssistantSession {
  return {
    ...publicSessionSummary(session),
    messages: session.messages.slice(),
  };
}

function publicSessionSummary(session: StoredSession): RangerAssistantSessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    messageCount: session.messages.length,
  };
}

function pruneSessions(sessions: StoredSession[]): void {
  sessions.splice(MAX_SESSIONS);
}

function titleFromRequest(body: string): string {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 48) return singleLine || "Ranger Session";
  return `${singleLine.slice(0, 45).trimEnd()}...`;
}

function firstNonEmptyString(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
