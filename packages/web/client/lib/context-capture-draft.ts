import type { CaptureDeliveryMode } from "./session-start.ts";

export type ContextCaptureDraftSeed = {
  agentId?: string;
  conversationId?: string;
  message?: string;
  files?: File[];
  attachmentFeedback?: string;
  preferExistingChat?: boolean;
};

export type ContextCaptureDraft = {
  agentId?: string;
  conversationId?: string;
  message: string;
  files: File[];
  attachmentFeedback: string | null;
  mode: CaptureDeliveryMode;
  projectPath: string;
  projectQuery: string;
};

export function contextCaptureDraftHasContent(
  draft: Pick<ContextCaptureDraft, "message" | "files"> | null | undefined,
): boolean {
  return Boolean(draft && (draft.message.trim().length > 0 || draft.files.length > 0));
}

function fileKey(file: File): string {
  return [file.name, file.type, file.size, file.lastModified].join(":");
}

function mergeFiles(current: readonly File[], incoming: readonly File[]): File[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((file) => {
    const key = fileKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Reopen New Chat from its last unsent state. A fresh launch context may
 * refine the target or add captures, but it must not erase typed text or
 * previously attached files merely because the sheet was closed.
 */
export function mergeContextCaptureDraft(
  current: ContextCaptureDraft | null,
  seed: ContextCaptureDraftSeed,
): ContextCaptureDraft {
  return {
    ...(seed.agentId ?? current?.agentId ? { agentId: seed.agentId ?? current?.agentId } : {}),
    ...(seed.conversationId ?? current?.conversationId
      ? { conversationId: seed.conversationId ?? current?.conversationId }
      : {}),
    message: seed.message ?? current?.message ?? "",
    files: mergeFiles(current?.files ?? [], seed.files ?? []),
    attachmentFeedback: seed.attachmentFeedback ?? current?.attachmentFeedback ?? null,
    mode: seed.preferExistingChat === undefined
      ? current?.mode ?? "new-session"
      : seed.preferExistingChat
        ? "existing-chat"
        : "new-session",
    projectPath: current?.projectPath ?? "",
    projectQuery: current?.projectQuery ?? "",
  };
}

export function dictationBlocksContextCaptureClose(
  state: "idle" | "starting" | "recording" | "processing" | null | undefined,
): boolean {
  return state === "starting" || state === "recording" || state === "processing";
}
