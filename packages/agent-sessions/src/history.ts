import { basename, dirname } from "node:path";

import { StateTracker, type SessionState } from "./state.js";
import type {
  Action,
  Block,
  PairingEvent,
  QuestionOption,
  Session,
  Turn,
  TurnStatus,
} from "./protocol/index.js";

type TextualBlock = Extract<Block, { type: "text" | "reasoning" }>;

export type HistorySessionEvent = {
  capturedAt: number;
  event: PairingEvent;
};

export type SupportedHistoryAdapterType = "claude-code";
export type HistoryAdapterType = SupportedHistoryAdapterType | "codex" | "unknown";

export interface HistorySessionSnapshotInput {
  path: string;
  content: string;
  adapterType?: string | null;
  name?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  baseTimestampMs?: number | null;
}

export interface HistorySessionSnapshotResult {
  adapterType: HistoryAdapterType;
  lineCount: number;
  parsedLineCount: number;
  skippedLineCount: number;
  events: HistorySessionEvent[];
  snapshot: SessionState;
}

function decodeClaudeProjectsSlug(name: string): string | null {
  if (!name || !name.startsWith("-")) {
    return null;
  }

  const tail = name.slice(1);
  if (!tail) {
    return null;
  }

  return `/${tail.replace(/-/g, "/")}`;
}

function inferClaudeHistoryCwd(path: string): string | null {
  const parent = basename(dirname(path));
  return decodeClaudeProjectsSlug(parent);
}

function deriveHistoryName(path: string): string {
  const claudeCwd = inferClaudeHistoryCwd(path);
  if (claudeCwd) {
    return basename(claudeCwd) || claudeCwd;
  }

  const parent = basename(dirname(path));
  return parent || basename(path) || "History Session";
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value < 1e12 ? value * 1000 : value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function extractRecordTimestamp(record: Record<string, unknown>): number | null {
  const candidates = [
    record.timestamp,
    record.createdAt,
    record.created_at,
    record.updatedAt,
    record.updated_at,
    record.time,
    record.ts,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTimestamp(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        const item = entry as Record<string, unknown>;
        if (typeof item.text === "string") {
          return item.text;
        }
        if (typeof item.content === "string") {
          return item.content;
        }
        return stringifyUnknown(entry);
      })
      .filter(Boolean)
      .join("\n");
    return text || stringifyUnknown(content);
  }

  return stringifyUnknown(content);
}

function extractReasoningText(item: Record<string, unknown>): string {
  const summary = Array.isArray(item.summary) ? item.summary : [];
  const content = Array.isArray(item.content) ? item.content : [];

  const summaryText = summary
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.summary === "string") {
        return record.summary;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const contentText = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");

  return [summaryText, contentText].filter(Boolean).join("\n\n").trim();
}

function extractQuestionOptions(firstQuestion: Record<string, unknown>): QuestionOption[] {
  const options = Array.isArray(firstQuestion.options) ? firstQuestion.options : [];
  return options.map((option) => {
    if (typeof option === "string") {
      return { label: option };
    }

    const record = option as Record<string, unknown>;
    return {
      label: typeof record.label === "string" ? record.label : String(option),
      description: typeof record.description === "string" ? record.description : undefined,
    };
  });
}

function parseQuestionAnswer(content: unknown): string[] {
  const text = renderToolResultContent(content).trim();
  if (!text) {
    return [];
  }

  return text
    .split(/\s*,\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferHistoryAdapterType(path: string, adapterType?: string | null): HistoryAdapterType {
  const normalizedAdapter = adapterType?.trim();
  if (normalizedAdapter === "claude-code") {
    return "claude-code";
  }
  if (normalizedAdapter === "codex") {
    return "codex";
  }

  const normalizedPath = path.toLowerCase();
  if (normalizedPath.includes("/.claude/projects/")) {
    return "claude-code";
  }
  if (normalizedPath.includes("/.codex/") || normalizedPath.includes("/.openai-codex/")) {
    return "codex";
  }

  return "unknown";
}

export function supportsHistorySessionSnapshot(adapterType: string | null | undefined): boolean {
  return inferHistoryAdapterType("", adapterType ?? undefined) === "claude-code"
    || adapterType === "claude-code";
}

function buildBaseHistorySession(input: HistorySessionSnapshotInput, adapterType: HistoryAdapterType): Session {
  const cwd = input.cwd?.trim() || inferClaudeHistoryCwd(input.path) || undefined;

  return {
    id: input.sessionId?.trim() || `history:${input.path}`,
    name: input.name?.trim() || deriveHistoryName(input.path),
    adapterType,
    status: "idle",
    ...(cwd ? { cwd } : {}),
    providerMeta: {
      historyPath: input.path,
      historyAdapterType: adapterType,
      source: "external_history",
    },
  };
}

class ClaudeCodeHistoryParser {
  private readonly events: HistorySessionEvent[] = [];
  private currentTurn: Turn | null = null;
  private turnCounter = 0;
  private blockIndex = 0;
  private toolBlockMap = new Map<string, string>();
  private questionBlockMap = new Map<string, string>();
  private blockById = new Map<string, Block>();
  private activeStreamBlocks = new Map<number, TextualBlock>();
  private sawStreamTextThisTurn = false;

  constructor(
    private readonly session: Session,
    private readonly baseTimestampMs: number,
  ) {}

  parse(content: string): {
    events: HistorySessionEvent[];
    lineCount: number;
    parsedLineCount: number;
    skippedLineCount: number;
  } {
    const lines = content.split(/\r?\n/u);
    let parsedLineCount = 0;
    let skippedLineCount = 0;
    let lineCount = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }

      lineCount += 1;

      let record: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          skippedLineCount += 1;
          continue;
        }
        record = parsed as Record<string, unknown>;
      } catch {
        skippedLineCount += 1;
        continue;
      }

      const capturedAt = extractRecordTimestamp(record) ?? (this.baseTimestampMs + index);
      if (this.handleRecord(record, capturedAt)) {
        parsedLineCount += 1;
      } else {
        skippedLineCount += 1;
      }
    }

    return {
      events: this.events,
      lineCount,
      parsedLineCount,
      skippedLineCount,
    };
  }

  private handleRecord(record: Record<string, unknown>, capturedAt: number): boolean {
    const type = typeof record.type === "string" ? record.type : null;
    if (!type) {
      return false;
    }

    switch (type) {
      case "system":
        this.handleSystem(record, capturedAt);
        return true;
      case "user":
        this.startTurn(capturedAt);
        return true;
      case "assistant":
        this.handleAssistant(record, capturedAt);
        return true;
      case "tool_use":
        this.handleToolUse(record, capturedAt);
        return true;
      case "tool_result":
        this.handleToolResult(record, capturedAt);
        return true;
      case "stream_event":
        this.handleStreamEvent(record, capturedAt);
        return true;
      case "result":
        this.handleResult(record, capturedAt);
        return true;
      case "error":
        this.handleError(record, capturedAt);
        return true;
      default:
        return false;
    }
  }

  private handleSystem(record: Record<string, unknown>, capturedAt: number): void {
    if (record.subtype !== "init") {
      return;
    }

    let changed = false;
    const externalSessionId = typeof record.session_id === "string"
      ? record.session_id
      : typeof record.sessionId === "string"
        ? record.sessionId
        : null;
    if (externalSessionId) {
      const providerMeta = { ...(this.session.providerMeta ?? {}) };
      if (providerMeta.externalSessionId !== externalSessionId) {
        providerMeta.externalSessionId = externalSessionId;
        this.session.providerMeta = providerMeta;
        changed = true;
      }
    }

    if (typeof record.cwd === "string" && record.cwd.trim() && this.session.cwd !== record.cwd) {
      this.session.cwd = record.cwd;
      changed = true;
    }

    if (typeof record.model === "string" && record.model.trim() && this.session.model !== record.model) {
      this.session.model = record.model;
      changed = true;
    }

    if (changed) {
      this.emitEvent(capturedAt, {
        event: "session:update",
        session: { ...this.session },
      });
    }
  }

  private handleAssistant(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.ensureTurn(capturedAt);
    if (this.sawStreamTextThisTurn) {
      return;
    }

    const content = record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>).content
      : record.content;
    if (!Array.isArray(content)) {
      return;
    }

    for (const part of content) {
      const contentPart = part as Record<string, unknown>;
      const contentType = typeof contentPart.type === "string" ? contentPart.type : "";
      if (contentType === "thinking" || contentType === "reasoning") {
        const block = this.startBlock<Extract<Block, { type: "reasoning" }>>(turn, capturedAt, {
          type: "reasoning",
          text: typeof contentPart.thinking === "string"
            ? contentPart.thinking
            : typeof contentPart.text === "string"
              ? contentPart.text
              : "",
          status: "completed",
        });
        this.emitBlockEnd(capturedAt, turn, block, "completed");
      } else if (contentType === "text") {
        const block = this.startBlock<Extract<Block, { type: "text" }>>(turn, capturedAt, {
          type: "text",
          text: typeof contentPart.text === "string" ? contentPart.text : "",
          status: "completed",
        });
        this.emitBlockEnd(capturedAt, turn, block, "completed");
      }
    }
  }

  private handleStreamEvent(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.ensureTurn(capturedAt);
    const streamEvent = record.event;
    if (!streamEvent || typeof streamEvent !== "object") {
      return;
    }

    const eventRecord = streamEvent as Record<string, unknown>;
    const streamType = typeof eventRecord.type === "string" ? eventRecord.type : "";

    if (streamType === "message_start") {
      this.activeStreamBlocks.clear();
      this.sawStreamTextThisTurn = false;
      return;
    }

    if (streamType === "content_block_start") {
      const index = typeof eventRecord.index === "number" ? eventRecord.index : 0;
      const contentBlock = eventRecord.content_block;
      if (!contentBlock || typeof contentBlock !== "object") {
        return;
      }

      const contentRecord = contentBlock as Record<string, unknown>;
      const contentType = typeof contentRecord.type === "string" ? contentRecord.type : "";
      if (contentType !== "text" && contentType !== "thinking") {
        return;
      }

      const block = this.startBlock<TextualBlock>(turn, capturedAt, {
        type: contentType === "thinking" ? "reasoning" : "text",
        text: "",
        status: "streaming",
      }) as TextualBlock;

      this.activeStreamBlocks.set(index, block);
      this.sawStreamTextThisTurn = true;

      const initialText = contentType === "thinking"
        ? typeof contentRecord.thinking === "string" ? contentRecord.thinking : ""
        : typeof contentRecord.text === "string" ? contentRecord.text : "";
      this.appendTextDelta(capturedAt, turn, block, initialText);
      return;
    }

    if (streamType === "content_block_delta") {
      const index = typeof eventRecord.index === "number" ? eventRecord.index : 0;
      const block = this.activeStreamBlocks.get(index);
      const delta = eventRecord.delta;
      if (!block || !delta || typeof delta !== "object") {
        return;
      }

      const deltaRecord = delta as Record<string, unknown>;
      const deltaType = typeof deltaRecord.type === "string" ? deltaRecord.type : "";
      if (deltaType === "text_delta") {
        this.appendTextDelta(capturedAt, turn, block, typeof deltaRecord.text === "string" ? deltaRecord.text : "");
        return;
      }
      if (deltaType === "thinking_delta") {
        this.appendTextDelta(capturedAt, turn, block, typeof deltaRecord.thinking === "string" ? deltaRecord.thinking : "");
      }
      return;
    }

    if (streamType === "content_block_stop") {
      const index = typeof eventRecord.index === "number" ? eventRecord.index : 0;
      const block = this.activeStreamBlocks.get(index);
      if (!block) {
        return;
      }

      this.emitBlockEnd(capturedAt, turn, block, "completed");
      this.activeStreamBlocks.delete(index);
    }
  }

  private handleToolUse(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.ensureTurn(capturedAt);
    const toolName = typeof record.tool_name === "string"
      ? record.tool_name
      : typeof record.name === "string"
        ? record.name
        : "unknown";
    const toolCallId = typeof record.tool_use_id === "string"
      ? record.tool_use_id
      : typeof record.id === "string"
        ? record.id
        : `${turn.id}:tool:${this.blockIndex}`;

    if (toolName === "AskUserQuestion") {
      const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const firstQuestion = (questions[0] as Record<string, unknown> | undefined) ?? {};

      const block = this.startBlock<Extract<Block, { type: "question" }>>(turn, capturedAt, {
        id: `${turn.id}:question:${toolCallId}`,
        type: "question",
        header: typeof firstQuestion.header === "string" ? firstQuestion.header : undefined,
        question: typeof firstQuestion.question === "string" ? firstQuestion.question : "",
        options: extractQuestionOptions(firstQuestion),
        multiSelect: firstQuestion.multiSelect === true,
        questionStatus: "awaiting_answer",
        answer: undefined,
        status: "streaming",
      });

      this.toolBlockMap.set(toolCallId, block.id);
      this.questionBlockMap.set(toolCallId, block.id);
      return;
    }

    let action: Action;
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
      const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
      action = {
        kind: "file_change",
        path: typeof input.file_path === "string"
          ? input.file_path
          : typeof input.path === "string"
            ? input.path
            : "",
        diff: "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Bash") {
      const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
      action = {
        kind: "command",
        command: typeof input.command === "string" ? input.command : "",
        status: "running",
        output: "",
      };
    } else if (toolName === "Agent") {
      const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
      action = {
        kind: "subagent",
        agentId: toolCallId,
        agentName: typeof input.description === "string" ? input.description : undefined,
        prompt: typeof input.prompt === "string" ? input.prompt : undefined,
        status: "running",
        output: "",
      };
    } else {
      action = {
        kind: "tool_call",
        toolName,
        toolCallId,
        input: record.input,
        status: "running",
        output: "",
      };
    }

    const block = this.startBlock<Extract<Block, { type: "action" }>>(turn, capturedAt, {
      id: `${turn.id}:action:${toolCallId}`,
      type: "action",
      action,
      status: "streaming",
    });
    this.toolBlockMap.set(toolCallId, block.id);
  }

  private handleToolResult(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.ensureTurn(capturedAt);
    const toolCallId = typeof record.tool_use_id === "string"
      ? record.tool_use_id
      : typeof record.id === "string"
        ? record.id
        : "";
    if (!toolCallId) {
      return;
    }

    const questionBlockId = this.questionBlockMap.get(toolCallId);
    if (questionBlockId) {
      const answer = parseQuestionAnswer(record.content);
      this.emitEvent(capturedAt, {
        event: "block:question:answer",
        sessionId: this.session.id,
        turnId: turn.id,
        blockId: questionBlockId,
        questionStatus: "answered",
        ...(answer.length > 0 ? { answer } : {}),
      });
      const block = this.blockById.get(questionBlockId);
      if (block) {
        this.emitBlockEnd(capturedAt, turn, block, "completed");
      }
      this.questionBlockMap.delete(toolCallId);
      this.toolBlockMap.delete(toolCallId);
      return;
    }

    const blockId = this.toolBlockMap.get(toolCallId);
    if (!blockId) {
      return;
    }

    const output = renderToolResultContent(record.content);
    if (output) {
      this.emitEvent(capturedAt, {
        event: "block:action:output",
        sessionId: this.session.id,
        turnId: turn.id,
        blockId,
        output,
      });
    }

    const status = record.is_error === true ? "failed" : "completed";
    this.emitEvent(capturedAt, {
      event: "block:action:status",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId,
      status,
    });

    const block = this.blockById.get(blockId);
    if (block) {
      this.emitBlockEnd(capturedAt, turn, block, status === "failed" ? "failed" : "completed");
    }
    this.toolBlockMap.delete(toolCallId);
  }

  private handleResult(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.currentTurn;
    if (!turn) {
      return;
    }

    this.completeOpenStreamBlocks(capturedAt, turn);

    const denials = Array.isArray(record.permission_denials) ? record.permission_denials : [];
    for (const denial of denials) {
      const denialRecord = denial as Record<string, unknown>;
      if (denialRecord.tool_name !== "AskUserQuestion") {
        continue;
      }

      const input = denialRecord.tool_input && typeof denialRecord.tool_input === "object"
        ? denialRecord.tool_input as Record<string, unknown>
        : {};
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const firstQuestion = (questions[0] as Record<string, unknown> | undefined) ?? {};

      const block = this.startBlock<Extract<Block, { type: "question" }>>(turn, capturedAt, {
        type: "question",
        header: typeof firstQuestion.header === "string" ? firstQuestion.header : undefined,
        question: typeof firstQuestion.question === "string" ? firstQuestion.question : "",
        options: extractQuestionOptions(firstQuestion),
        multiSelect: firstQuestion.multiSelect === true,
        questionStatus: "denied",
        status: "completed",
      });
      this.emitBlockEnd(capturedAt, turn, block, "completed");
    }

    this.endTurn(record.subtype === "error" ? "failed" : "completed", capturedAt);
  }

  private handleError(record: Record<string, unknown>, capturedAt: number): void {
    const turn = this.ensureTurn(capturedAt);
    const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const message = typeof error.message === "string"
      ? error.message
      : typeof record.message === "string"
        ? record.message
        : "Unknown error";
    this.emitError(turn, capturedAt, message);
    this.endTurn("failed", capturedAt);
  }

  private startTurn(capturedAt: number): Turn {
    if (this.currentTurn) {
      this.endTurn("stopped", capturedAt);
    }

    this.turnCounter += 1;
    this.blockIndex = 0;
    this.toolBlockMap.clear();
    this.questionBlockMap.clear();
    this.blockById.clear();
    this.activeStreamBlocks.clear();
    this.sawStreamTextThisTurn = false;

    this.session.status = "active";
    this.emitEvent(capturedAt, {
      event: "session:update",
      session: { ...this.session },
    });

    const turn: Turn = {
      id: `history-turn-${this.turnCounter}`,
      sessionId: this.session.id,
      status: "started",
      startedAt: new Date(capturedAt).toISOString(),
      blocks: [],
    };
    this.currentTurn = turn;

    this.emitEvent(capturedAt, {
      event: "turn:start",
      sessionId: this.session.id,
      turn,
    });

    return turn;
  }

  private ensureTurn(capturedAt: number): Turn {
    return this.currentTurn ?? this.startTurn(capturedAt);
  }

  private endTurn(status: TurnStatus, capturedAt: number): void {
    const turn = this.currentTurn;
    if (!turn) {
      return;
    }

    turn.status = status;
    turn.endedAt = new Date(capturedAt).toISOString();
    this.emitEvent(capturedAt, {
      event: "turn:end",
      sessionId: this.session.id,
      turnId: turn.id,
      status,
    });

    this.currentTurn = null;
    this.toolBlockMap.clear();
    this.questionBlockMap.clear();
    this.blockById.clear();
    this.activeStreamBlocks.clear();
    this.sawStreamTextThisTurn = false;

    this.session.status = "idle";
    this.emitEvent(capturedAt, {
      event: "session:update",
      session: { ...this.session },
    });
  }

  private startBlock<T extends Block>(
    turn: Turn,
    capturedAt: number,
    partial: Omit<T, "turnId" | "index" | "id"> & { id?: string },
  ): T {
    const block = {
      ...partial,
      id: partial.id || `${turn.id}:block:${this.blockIndex}`,
      turnId: turn.id,
      index: this.blockIndex,
    } as T;
    this.blockIndex += 1;
    turn.blocks.push(block);
    this.blockById.set(block.id, block);

    this.emitEvent(capturedAt, {
      event: "block:start",
      sessionId: this.session.id,
      turnId: turn.id,
      block,
    });

    return block;
  }

  private appendTextDelta(capturedAt: number, turn: Turn, block: TextualBlock, text: string): void {
    if (!text) {
      return;
    }

    block.text += text;
    block.status = "streaming";
    this.emitEvent(capturedAt, {
      event: "block:delta",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      text,
    });
  }

  private emitBlockEnd(
    capturedAt: number,
    turn: Turn,
    block: Block,
    status: Block["status"],
  ): void {
    block.status = status;
    this.emitEvent(capturedAt, {
      event: "block:end",
      sessionId: this.session.id,
      turnId: turn.id,
      blockId: block.id,
      status,
    });
  }

  private completeOpenStreamBlocks(capturedAt: number, turn: Turn): void {
    for (const block of this.activeStreamBlocks.values()) {
      this.emitBlockEnd(capturedAt, turn, block, "completed");
    }
    this.activeStreamBlocks.clear();
  }

  private emitError(turn: Turn, capturedAt: number, message: string): void {
    const block = this.startBlock<Extract<Block, { type: "error" }>>(turn, capturedAt, {
      type: "error",
      message,
      status: "completed",
    });
    this.emitBlockEnd(capturedAt, turn, block, "completed");
  }

  private emitEvent(capturedAt: number, event: PairingEvent): void {
    this.events.push({
      capturedAt,
      event: structuredClone(event),
    });
  }
}

export function inferHistorySessionAdapterType(
  path: string,
  adapterType?: string | null,
): HistoryAdapterType {
  return inferHistoryAdapterType(path, adapterType);
}

export function supportsHistorySessionSnapshotForPath(
  path: string,
  adapterType?: string | null,
): boolean {
  return inferHistoryAdapterType(path, adapterType) === "claude-code";
}

export function createHistorySessionSnapshot(
  input: HistorySessionSnapshotInput,
): HistorySessionSnapshotResult {
  const adapterType = inferHistoryAdapterType(input.path, input.adapterType);
  if (adapterType !== "claude-code") {
    throw new Error(`History snapshot is not supported for adapter type "${adapterType}".`);
  }

  const session = buildBaseHistorySession(input, adapterType);
  const baseTimestampMs = normalizeTimestamp(input.baseTimestampMs) ?? Date.now();
  const parser = new ClaudeCodeHistoryParser(session, baseTimestampMs);
  const replay = parser.parse(input.content);

  const tracker = new StateTracker();
  tracker.createSession(session.id, session);
  for (const entry of replay.events) {
    tracker.trackEvent(session.id, entry.event, entry.capturedAt);
  }

  const snapshot = tracker.getSessionState(session.id);
  if (!snapshot) {
    throw new Error("Failed to reconstruct session snapshot from history.");
  }

  return {
    adapterType,
    lineCount: replay.lineCount,
    parsedLineCount: replay.parsedLineCount,
    skippedLineCount: replay.skippedLineCount,
    events: replay.events,
    snapshot,
  };
}
