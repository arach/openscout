export type CodexRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};

export type CodexResponse = {
  id: string | number;
  result?: unknown;
  error?: {
    message?: string;
    code?: string | number;
    data?: unknown;
  };
};

export type CodexNotification = {
  method: string;
  params?: Record<string, unknown>;
};

export type CodexServerRequest = {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type CodexErrorResponse = {
  code: number;
  message: string;
  data?: unknown;
};

export function parseCodexJsonLine(line: string): CodexResponse | CodexNotification | CodexServerRequest | null {
  try {
    return JSON.parse(line) as CodexResponse | CodexNotification | CodexServerRequest;
  } catch {
    return null;
  }
}

export function parseCodexJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function codexErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function buildUnsupportedCodexServerRequestError(message: CodexServerRequest): CodexErrorResponse {
  if (message.method === "item/tool/call") {
    const tool = typeof message.params?.tool === "string" ? message.params.tool : null;
    const toolLabel = tool ? `dynamic tool call \`${tool}\`` : "dynamic tool call";
    return {
      code: -32000,
      message: `${toolLabel} is not supported by openscout-runtime`,
    };
  }

  return {
    code: -32000,
    message: `Unsupported server request: ${message.method}`,
  };
}

export function isCodexResponse(message: unknown): message is CodexResponse {
  return Boolean(
    message
    && typeof message === "object"
    && "id" in message
    && ("result" in message || "error" in message),
  );
}

export function isCodexServerRequest(message: unknown): message is CodexServerRequest {
  return Boolean(
    message
    && typeof message === "object"
    && "id" in message
    && "method" in message
    && !("result" in message)
    && !("error" in message),
  );
}

export function isCodexNotification(message: unknown): message is CodexNotification {
  return Boolean(
    message
    && typeof message === "object"
    && "method" in message
    && !("id" in message),
  );
}

export function parseCodexMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function stringifyCodexValue(value: unknown): string {
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

export function extractCodexReasoningText(item: Record<string, unknown>): string {
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

export function extractCodexMessageText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function extractCodexUserMessageText(item: Record<string, unknown>): string {
  const text = extractCodexMessageText(item);
  if (text) {
    return text;
  }
  return typeof item.text === "string" ? item.text.trim() : "";
}
