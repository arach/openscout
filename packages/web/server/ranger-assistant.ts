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
  respond: (input: { body: string; route?: unknown; openaiApiKey?: string | null }) => Promise<RangerAssistantReply>;
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

const DEFAULT_SYSTEM_PROMPT = [
  "You are Ranger, the in-app OpenScout control-plane assistant.",
  "You are not a peer agent in the Scout fleet. You are the operator's direct loop inside the web app.",
  "Use the provided Scout state snapshot and current UI route to answer state questions quickly and concretely.",
  "When the operator asks for navigation, include a single fenced scout-ui JSON block after your human reply.",
  "Supported scout-ui actions are navigate, refresh, and open-ranger.",
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
    respond: async ({ body, route, openaiApiKey }) => {
      const trimmed = body.trim();
      if (!trimmed) {
        throw new RangerAssistantError("body is required", 400);
      }

      const apiKey = firstNonEmptyString(
        env.OPENAI_API_KEY,
        openAIKeyValue(openaiApiKey),
        await input.resolveApiKey?.(),
      );
      if (!apiKey) {
        throw new RangerAssistantError("An OpenAI API key is required for Ranger assistant. Add one in Settings > Credentials or set OPENAI_API_KEY.", 503);
      }

      const session = ensureSession();
      const context: RangerAssistantContextSnapshot = {
        generatedAt: new Date().toISOString(),
        currentDirectory: input.currentDirectory,
        ...(route !== undefined ? { currentRoute: route } : {}),
        state: await input.loadContext(route),
      };

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

function openAIKeyValue(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("sk-") ? trimmed : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
