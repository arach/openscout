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
  retention: {
    activeLimit: number;
    archivedCount: number;
    totalCount: number;
  };
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
  observations?: RangerBriefObservation[];
  references?: RangerBriefReference[];
  durationMs: number;
  snapshot: {
    capturedAt: number;
    expiresAt: number;
    source: "prepared" | "refreshed" | "live";
  };
};

export type RangerBriefReference = {
  label: string;
  kind: string;
  route?: Record<string, unknown>;
  detail?: string;
};

export type RangerBriefObservation = {
  text: string;
  tone?: string;
  references: RangerBriefReference[];
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
  archiveSession: (id: string) => RangerAssistantSessionState;
  respond: (input: { body: string; route?: unknown }) => Promise<RangerAssistantReply>;
  createBrief: (input: { route?: unknown; ttlMs?: number | null; mode?: RangerBriefMode }) => Promise<RangerBrief>;
};

export type RangerBriefMode = "tour" | "fleet-home";

type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  previousResponseId: string | null;
  messages: RangerAssistantMessage[];
  archivedAt: number | null;
};

type OpenAIResponsePayload = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
  error?: unknown;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ACTIVE_SESSION_LIMIT = 8;
const MAX_ACTIVE_SESSION_LIMIT = 24;
const MAX_ARCHIVED_SESSIONS = 32;
const MAX_MESSAGES_PER_SESSION = 40;
const DEFAULT_BRIEF_TTL_MS = 2 * 60_000;
const MAX_BRIEF_TTL_MS = 30 * 60_000;
const MIN_BRIEF_TTL_MS = 30_000;

const DEFAULT_SYSTEM_PROMPT = [
  "You are Ranger, the in-app OpenScout control-plane assistant.",
  "You are not a peer agent in the Scout fleet. You are the operator's direct loop inside the web app.",
  "Use the provided Scout state snapshot and current UI route to answer state questions quickly and concretely.",
  "When the operator asks for navigation or UI actions, include a single fenced JSON block after your human reply.",
  "The fence language tag MUST be exactly `scout-ui` (open with ```scout-ui), never `json` or any other tag.",
  "Supported scout-ui actions are navigate, refresh, open-ranger, view-file, reminder, and ask-agent.",
  "When the operator wants to read a specific file (a spec, doc, transcript, or source file) and you know its absolute path, emit {\"type\":\"view-file\",\"path\":\"/abs/path/to/file.md\"} so the in-app preview opens automatically. Do not just narrate the path.",
  "For reminders, emit {\"type\":\"reminder\",\"body\":\"what to revisit\",\"delayMinutes\":3} or a dueAt epoch timestamp; reminders stay in the operator-side Ranger loop.",
  "When the operator explicitly asks you to ask, delegate to, or get an answer from a specific Scout agent, emit {\"type\":\"ask-agent\",\"targetLabel\":\"agent handle or selector\",\"body\":\"the exact request to send\"}; do not use ask-agent unless the operator clearly requested durable coordination.",
  "Supported navigate views include inbox, fleet, agents, sessions, mesh, broker, activity, settings, terminal, work, conversation, and ops.",
  "Do not create or imply durable Scout messages, work items, or agent asks unless the operator explicitly requests coordination.",
  "If durable coordination is needed, say that it should go through Scout broker records and be clear about the intended target.",
  "The operator's fleet INCLUDES organic harness sessions (Claude, Codex, etc.) listed under harnessActivity, not just registered Scout agents. Count harnessActivity.processes as active work and harnessActivity.transcripts as recent runs. If registered agents are idle but harnessActivity has running processes or recent transcripts, never say 'nothing is happening'. Frame it as: 'no Scout-registered agents are active, but N organic sessions are running.'",
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
  const activeSessionLimit = clampInteger(
    env.OPENSCOUT_RANGER_ACTIVE_SESSION_LIMIT,
    DEFAULT_ACTIVE_SESSION_LIMIT,
    1,
    MAX_ACTIVE_SESSION_LIMIT,
  );

  const activeSessions = (): StoredSession[] =>
    sessions
      .filter((session) => session.archivedAt === null)
      .sort(compareSessionsByUpdatedAt);

  const ensureSession = (): StoredSession => {
    const existing = activeSessionId
      ? sessions.find((session) => session.id === activeSessionId && session.archivedAt === null)
      : null;
    if (existing) return existing;

    const latest = activeSessions()[0];
    if (latest) {
      activeSessionId = latest.id;
      return latest;
    }

    return createAndActivateSession();
  };

  const createAndActivateSession = (): StoredSession => {
    const session = createSession(model);
    sessions.unshift(session);
    activeSessionId = session.id;
    enforceSessionRetention();
    return session;
  };

  const snapshot = (): RangerAssistantSessionState => ({
    session: publicSession(ensureSession()),
    sessions: activeSessions()
      .slice(0, activeSessionLimit)
      .map(publicSessionSummary),
    retention: {
      activeLimit: activeSessionLimit,
      archivedCount: sessions.filter((session) => session.archivedAt !== null).length,
      totalCount: sessions.length,
    },
    config: { editable: true, model, systemPrompt },
  });
  const enforceSessionRetention = (): void => {
    const active = activeSessions();
    const retainedIds = new Set(active.slice(0, activeSessionLimit).map((session) => session.id));
    const activeSession = activeSessionId
      ? active.find((session) => session.id === activeSessionId)
      : null;
    if (activeSession && !retainedIds.has(activeSession.id)) {
      const overflowId = [...retainedIds].at(-1);
      if (overflowId) retainedIds.delete(overflowId);
      retainedIds.add(activeSession.id);
    }

    const now = Date.now();
    for (const session of active) {
      if (!retainedIds.has(session.id)) {
        session.archivedAt = now;
        session.previousResponseId = null;
      }
    }

    const archived = sessions
      .filter((session) => session.archivedAt !== null)
      .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
    const archivedRetainedIds = new Set(archived.slice(0, MAX_ARCHIVED_SESSIONS).map((session) => session.id));
    for (let index = sessions.length - 1; index >= 0; index -= 1) {
      const session = sessions[index];
      if (session?.archivedAt !== null && !archivedRetainedIds.has(session.id)) {
        sessions.splice(index, 1);
      }
    }
  };
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
      createAndActivateSession();
      return snapshot();
    },
    switchSession: (id) => {
      const target = sessions.find((session) => session.id === id && session.archivedAt === null);
      if (!target) {
        throw new RangerAssistantError(`Ranger session "${id}" not found.`, 404);
      }
      activeSessionId = target.id;
      return snapshot();
    },
    archiveSession: (id) => {
      const target = sessions.find((session) => session.id === id && session.archivedAt === null);
      if (!target) {
        throw new RangerAssistantError(`Ranger session "${id}" not found.`, 404);
      }
      target.archivedAt = Date.now();
      target.previousResponseId = null;
      if (activeSessionId === target.id) {
        activeSessionId = null;
      }
      enforceSessionRetention();
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
      enforceSessionRetention();

      return {
        ...snapshot(),
        reply: assistantMessage,
        responseId: response.id,
      };
    },
    createBrief: async ({ route, ttlMs, mode = "tour" }) => {
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
        systemPrompt: briefSystemPrompt(systemPrompt, mode),
        previousResponseId: null,
        body: briefOperatorRequest(resolvedTtlMs, mode),
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
                JSON.stringify(input.context),
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

function briefSystemPrompt(basePrompt: string, mode: RangerBriefMode): string {
  const shared = [
    basePrompt,
    "",
    "One-minute brief mode:",
    "Return only a JSON object. Do not wrap it in markdown.",
    "The object must include title, summary, steps, recommendation, and actions.",
    "steps must contain 3 to 5 safe UI stops. Prefer 3 or 4 stops unless a fifth is genuinely useful. Each step needs id, label, route, and narration.",
    "Write for spoken briefing, not dashboard captions. Each narration should be one natural sentence, roughly 14 to 30 words.",
    "At each stop, say what changed or what matters, not just what the screen contains.",
    "Use light transitions when helpful, but do not repeat labels inside the narration.",
    "The recommendation should be a plain-spoken final beat: what to do next and why it matters.",
    "Use only these routes unless the snapshot strongly suggests a more specific safe route: fleet, ops tail, sessions, broker, mesh, activity, agents.",
    "Do not create durable Scout records or imply that work has been started.",
    "",
    "Fleet definition (important):",
    "The operator's fleet is NOT just the registered Scout agents. It also includes 'harnessActivity' — organic Claude, Codex, and other harness processes the operator runs locally that Scout observes via tail discovery but does not register as agents.",
    "When you summarize what's happening, ALWAYS count harnessActivity.processes as active work (these are real running sessions) and harnessActivity.transcripts as recent runs.",
    "If registered agents show 'none active' but harnessActivity has running processes or recent transcripts, the correct framing is: 'N organic sessions running outside Scout's registered agents.' Never say 'nothing is happening' when transcripts or processes exist.",
    "When relevant, recommend Ops > tail or Sessions as a step so the operator can see this organic activity.",
  ];

  if (mode === "fleet-home") {
    shared.push(
      "",
      "Fleet-home hero mode:",
      "For this mode, act as Ranger Brief Compiler: a Scout-aware context session that understands broker records, agent registrations, conversations, work items, invocations, flights, sessions, and observed harness transcripts.",
      "This output appears inside the Fleet home hero beside already-visible counters for active, available, queued, and offline agents.",
      "Do NOT use the Fleet narration to repeat those counters or say that many agents are available with zero active work. The UI already says that.",
      "Assume deterministic facts that deserve permanent UI, such as simple counts, online/offline status, and ordinary recency, will be shown elsewhere. Spend the brief on interpretation and cognitive assistance.",
      "Use LLM judgment over the snapshot. Start with briefingEvidence.agentLogMessages (last 50 observed agent-log events) and briefingEvidence.scoutChatter (last 50 Scout messages), then cross-check recentCompleted, activity, sessions, activeWork, activeRuns, operatorAttention, needsAttention, and harnessActivity.",
      "Derivation rule: messages and transcripts are evidence for meaning, but clickable references must be grounded in concrete IDs from the snapshot such as agentId, conversationId, workId/recordId, sessionId, invocationId, flightId, or activity id.",
      "Treat the brief as an attention layer, not a dashboard summary. Answer: what deserves the operator's next 30 seconds, what subtle signal could fall through the cracks, and what might they be forgetting?",
      "Priority order: (1) needs-you-now items: approvals, decisions, questions, failed checks, blocked work; (2) stale or hidden obligations: asks without replies, sessions idle after an error, repeated failures, ambiguous ownership; (3) material progress: ships, completed work, docs/code changes, verification results; (4) current work only when it has a deliverable, owner, or risk; (5) next best inspection point.",
      "If anything is waiting, blocked, failed, stale, needs human input, or looks risky, make that the first sentence and include owner plus next move when evidence supports it.",
      "If the system is idle, replay what recently happened and what is still worth checking: notable completed work, recent ships, changed docs/code, organic sessions/transcripts, unanswered questions, or old threads that look easy to forget. Prefer concrete titles, projects, agent names, outcomes, and time references from the snapshot.",
      "If there is genuinely no useful recent signal, say what to inspect next and why instead of padding with inventory counts.",
      "For the Fleet step narration, write 3 or 4 short sentences that can stand alone as the hero brief sheet. Each sentence should be a distinct observation, grouped by urgency rather than by agent.",
      "When an observation mentions an agent, session, conversation, work item, or open attention target, include a matching reference chip with a label and route using IDs from the snapshot. Do not say 'several places' without naming or linking the best 1 to 3 places.",
      "Avoid phrases like 'all agents are available', 'zero active', 'nothing is happening', or 'the fleet is quiet' unless immediately followed by the recent evidence that matters.",
      "Never copy the examples or schema placeholders. They demonstrate shape only.",
      "",
      "Fleet-home examples (shape only; do not reuse names, projects, or wording):",
      "Bad pattern: inventory counter sentence. Good pattern: Needs you now: approval or decision waiting, owner named, consequence stated.",
      "Bad pattern: generic idle/quiet sentence. Good pattern: Since the last window, shipped artifact plus verification state plus next review target.",
      "Bad pattern: no-active-agents sentence. Good pattern: Stale or hidden obligation: thread/session/question has not moved, why it matters, where to inspect.",
      "Bad pattern: agent-status sentence. Good pattern: Current work tied to deliverable, risk, or critical path.",
      "Bad pattern: raw transcript recap. Good pattern: Plain-language outcome, confidence level, and next best action.",
    );
  }

  return shared.join("\n");
}

function briefOperatorRequest(ttlMs: number, mode: RangerBriefMode): string {
  if (mode === "fleet-home") {
    return [
      "Prepare the Fleet home hero brief for written display and optional spoken narration.",
      `The prepared snapshot TTL is ${Math.round(ttlMs / 1000)} seconds.`,
      "The hero already has deterministic counters, so add judgment from the last 50 agent-log events and last 50 Scout messages.",
      "Focus on things requiring attention, subtle signals that could fall through the cracks, stale/hidden obligations, material progress with consequence, and useful next inspection points. Include things the operator may not pick up from a visual scan of the activity stream.",
      "Return one Fleet step whose narration is 3 or 4 short sentences. Do not include a UI tour.",
      "For that Fleet step, also include observations. Each observation has text, tone, and references. References are clickable targets; include concrete routes when the snapshot gives agentId, conversationId, workId, or sessionId.",
      "Return this exact JSON shape:",
      JSON.stringify({
        title: "Fleet home brief",
        summary: "One sentence editorial overview that does not repeat visible counters.",
        steps: [
          {
            id: "fleet-home",
            label: "Fleet",
            route: { view: "fleet" },
            narration: "<3-4 evidence-grounded sentences. Lead with needs-you-now, stale or hidden obligations, or risk when present; otherwise mention concrete recent work, confidence/verification, and a useful next inspection point. Do not copy this placeholder.>",
            observations: [
              {
                text: "<one evidence-grounded observation>",
                tone: "attention|progress|risk|context",
                references: [
                  { label: "<agent, work item, session, or conversation>", kind: "agent|work|conversation|session|activity|ops", route: { view: "agents", agentId: "<id>", tab: "observe" }, detail: "<optional why this target matters>" },
                ],
              },
            ],
          },
        ],
        recommendation: "One concrete next inspection or action.",
        actions: [
          { label: "Open Activity", route: { view: "activity" } },
        ],
      }),
    ].join("\n");
  }

  return [
    "Prepare a one-minute OpenScout control-plane brief for spoken narration.",
    `The prepared snapshot TTL is ${Math.round(ttlMs / 1000)} seconds.`,
    "Walk through only the relevant views, give the operator a moment to visually orient at each stop, and finish with one recommended next action.",
    "Make the script feel like a calm guided tour: overview, a few meaningful stops, then the final call.",
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
  const observations = normalizeBriefObservations(record.observations);
  const references = normalizeBriefReferences(record.references);
  return {
    id: stringField(record.id, `${String(route.view ?? "step")}-${index + 1}`).replace(/[^a-z0-9_-]/gi, "-").toLowerCase(),
    label,
    route,
    narration,
    ...(observations.length > 0 ? { observations } : {}),
    ...(references.length > 0 ? { references } : {}),
    durationMs: estimateNarrationDuration(narration),
    snapshot: {
      capturedAt,
      expiresAt,
      source: "prepared",
    },
  };
}

function normalizeBriefObservations(raw: unknown): RangerBriefObservation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const text = stringField(record.text, "").trim();
      if (!text) return null;
      const tone = typeof record.tone === "string" && record.tone.trim()
        ? record.tone.trim()
        : undefined;
      const references = normalizeBriefReferences(record.references);
      return {
        text,
        ...(tone ? { tone } : {}),
        references,
      };
    })
    .filter((entry): entry is RangerBriefObservation => Boolean(entry));
}

function normalizeBriefReferences(raw: unknown): RangerBriefReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const label = stringField(record.label, "").trim();
      if (!label) return null;
      const kind = stringField(record.kind, "reference").trim().replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
      const route = sanitizeBriefRoute(record.route);
      const detail = typeof record.detail === "string" && record.detail.trim()
        ? record.detail.trim()
        : undefined;
      return {
        label,
        kind,
        ...(route ? { route } : {}),
        ...(detail ? { detail } : {}),
      };
    })
    .filter((entry): entry is RangerBriefReference => Boolean(entry));
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
    case "broker":
    case "mesh":
    case "activity":
      return { view };
    case "agents":
      return {
        view,
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
        ...(record.tab === "observe" || record.tab === "message" || record.tab === "profile" ? { tab: record.tab } : {}),
      };
    case "sessions":
      return {
        view,
        ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
      };
    case "settings":
      return {
        view,
        ...(record.section === "agents" ? { section: record.section } : {}),
        ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
      };
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
    archivedAt: null,
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

function titleFromRequest(body: string): string {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 48) return singleLine || "Ranger Session";
  return `${singleLine.slice(0, 45).trimEnd()}...`;
}

function compareSessionsByUpdatedAt(left: StoredSession, right: StoredSession): number {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function clampInteger(value: string | undefined | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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
