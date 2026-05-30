import { resolve } from "node:path";

import { parseScoutComposerRoute } from "@openscout/protocol";

import { ScoutCliError } from "./errors.ts";

type ContextRootOptions = {
  currentDirectory: string;
  args: string[];
};

type TargetableMessageOptions = ContextRootOptions & {
  agentName: string | null;
  targetLabel?: string;
  targetRef?: string;
  channel?: string;
  harness?: string;
  shouldSpeak: boolean;
  wake: boolean;
  message: string;
  messageFile?: string;
};

export type ScoutSetupCommandOptions = {
  currentDirectory: string;
  sourceRoots: string[];
};

export type ScoutAskCommandOptions = ContextRootOptions & {
  agentName: string | null;
  targetLabel?: string;
  targetRef?: string;
  projectPath?: string;
  channel?: string;
  harness?: string;
  timeoutSeconds?: number;
  replyMode?: "inline" | "notify" | "none";
  labels?: string[];
  message: string;
  promptFile?: string;
};

export type ScoutImplicitAskCommandOptions = ScoutAskCommandOptions;

export type ScoutWatchCommandOptions = ContextRootOptions & {
  agentName: string | null;
  channel?: string;
  conversationId?: string;
  since?: number;
  limit?: number;
  once: boolean;
};

export type ScoutChannelCommandOptions = ContextRootOptions & {
  channel?: string;
  latest?: number;
  markRead: boolean;
};

export type ScoutInboxCommandOptions = ContextRootOptions & {
  agentName: string | null;
  latest: number;
  since?: number;
};

export type ScoutLatestCommandOptions = ContextRootOptions & {
  agentId?: string;
  actorId?: string;
  channel?: string;
  conversationId?: string;
  limit: number;
  messages: boolean;
};

export type ScoutEnrollCommandOptions = ContextRootOptions & {
  agentName: string | null;
  task?: string;
};

export type ScoutCardCreateCommandOptions = ContextRootOptions & {
  projectPath: string;
  agentName?: string;
  displayName?: string;
  harness?: string;
  model?: string;
  reasoningEffort?: string;
  permissionProfile?: string;
  channelEnabled?: boolean;
  requesterId: string | null;
  noInput?: boolean;
  oneTimeUse?: boolean;
};

export type ScoutTuiCommandOptions = ContextRootOptions & {
  channel?: string;
  limit: number;
  intervalMs: number;
};

function missingFlagValue(flag: string): never {
  throw new ScoutCliError(`missing value for ${flag}`);
}

function unexpectedArgs(commandName: string, args: string[]): never {
  throw new ScoutCliError(`unexpected arguments for ${commandName}: ${args.join(" ")}`);
}

function parseFlagValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const current = args[index] ?? "";
  if (current === flag) {
    const value = args[index + 1];
    if (!value) {
      missingFlagValue(flag);
    }
    return { value, nextIndex: index + 1 };
  }

  const prefix = `${flag}=`;
  if (current.startsWith(prefix)) {
    return { value: current.slice(prefix.length), nextIndex: index };
  }

  missingFlagValue(flag);
}

function parseSinceTimestamp(value: string): number {
  const trimmed = value.trim();
  const duration = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (duration) {
    const amount = Number.parseFloat(duration[1] ?? "");
    const unit = (duration[2] ?? "").toLowerCase();
    const unitMs = unit === "ms"
      ? 1
      : unit === "s"
        ? 1_000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;
    return Date.now() - amount * unitMs;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1_000;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return parsedDate;
  }

  throw new ScoutCliError(`invalid since value: ${value}`);
}

function appendLabelValues(target: string[], value: string): void {
  for (const entry of value.split(",")) {
    const label = entry.trim();
    if (label && !target.includes(label)) {
      target.push(label);
    }
  }
}

function flagNameFor(current: string, flagNames: readonly string[]): string | null {
  return flagNames.find((flag) => current === flag || current.startsWith(`${flag}=`)) ?? null;
}

function resolveInputFilePath(
  currentDirectory: string,
  filePath: string,
): string {
  return resolve(currentDirectory, filePath);
}

function rejectMixedBodySources(kind: "message" | "question"): never {
  throw new ScoutCliError(
    kind === "message"
      ? "provide either an inline message or --message-file/--body-file, not both"
      : "provide either an inline question or --prompt-file/--body-file, not both",
  );
}

function parseContextRootPrefix(
  args: string[],
  defaultCurrentDirectory: string,
): ContextRootOptions {
  let currentDirectory = defaultCurrentDirectory;
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--context-root" || current.startsWith("--context-root=")) {
      const parsed = parseFlagValue(args, index, "--context-root");
      currentDirectory = resolve(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    rest.push(current);
  }

  return { currentDirectory, args: rest };
}

const SCOUT_MENTION_PATTERN = /(^|[\s([{'"`])@([A-Za-z0-9][A-Za-z0-9._/:-]*(?:#[A-Za-z0-9][A-Za-z0-9._/:-]*)?(?:\?[A-Za-z0-9][A-Za-z0-9._/:-]*)?)(?=$|[\s)\]}",.!?:;'"`])/g;

type MentionMatch = {
  label: string;
  start: number;
  end: number;
};

function extractMentionTargets(input: string): MentionMatch[] {
  const matches: MentionMatch[] = [];

  for (const match of input.matchAll(SCOUT_MENTION_PATTERN)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = match[2] ?? "";
    const start = match.index ?? 0;
    matches.push({
      label,
      start: start + prefix.length,
      end: start + fullMatch.length,
    });
  }

  return matches;
}

function stripMention(input: string, mention: MentionMatch): string {
  const before = input.slice(0, mention.start);
  const after = input.slice(mention.end);
  return `${before}${after}`.replace(/\s+/g, " ").trim();
}

type ComposerRoutedBody = {
  targetLabel?: string;
  targetRef?: string;
  projectPath?: string;
  channel?: string;
  message: string;
};

function mergeComposerChannel(
  existing: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!next) {
    return existing;
  }
  if (existing && existing !== next) {
    throw new ScoutCliError(`route channel ${next} conflicts with --channel ${existing}`);
  }
  return next;
}

function parseComposerRoutedBody(
  input: string,
  commandName: "ask" | "send",
  currentDirectory: string,
): ComposerRoutedBody | null {
  const parsed = parseScoutComposerRoute(input);
  if (!parsed.route) {
    const [diagnostic] = parsed.diagnostics;
    if (diagnostic) {
      throw new ScoutCliError(diagnostic.message);
    }
    return null;
  }

  const { target } = parsed.route;
  if (target.kind === "agent_label") {
    return {
      targetLabel: target.label,
      message: parsed.body,
    };
  }
  if (target.kind === "binding_ref") {
    return {
      targetLabel: `ref:${target.ref}`,
      targetRef: target.ref,
      message: parsed.body,
    };
  }
  if (target.kind === "session_id") {
    if (commandName === "send") {
      throw new ScoutCliError("send route operator must target an agent label, ref, channel, or broadcast");
    }
    return {
      targetLabel: `session:${target.sessionId}`,
      message: parsed.body,
    };
  }
  if (target.kind === "project_path") {
    if (commandName === "send") {
      throw new ScoutCliError("send route operator must target an agent label, ref, channel, or broadcast");
    }
    return {
      projectPath: resolveInputFilePath(currentDirectory, target.projectPath),
      message: parsed.body,
    };
  }
  if (target.kind === "channel") {
    if (commandName === "ask") {
      throw new ScoutCliError("ask route operator must target an agent label, ref, or project path");
    }
    return {
      channel: target.channel,
      message: parsed.body,
    };
  }
  if (target.kind === "broadcast") {
    if (commandName === "ask") {
      throw new ScoutCliError("ask route operator must target an agent label, ref, or project path");
    }
    return {
      channel: "shared",
      message: parsed.body,
    };
  }

  throw new ScoutCliError(
    `${commandName} route operator does not support agent id targets yet; use an agent label, ref, or project path`,
  );
}

export function parseSetupCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutSetupCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  const sourceRoots: string[] = [];

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--source-root" || current.startsWith("--source-root=")) {
      const value = parseFlagValue(parsed.args, index, "--source-root");
      sourceRoots.push(resolve(value.value));
      index = value.nextIndex;
      continue;
    }
    unexpectedArgs("setup", args);
  }

  return {
    currentDirectory: parsed.currentDirectory,
    sourceRoots,
  };
}

export function parseContextRootCommandOptions(
  commandName: string,
  args: string[],
  defaultCurrentDirectory: string,
): ContextRootOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  if (parsed.args.length > 0) {
    unexpectedArgs(commandName, args);
  }
  return parsed;
}

export function parseSendCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): TargetableMessageOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let targetLabel: string | undefined;
  let targetRef: string | undefined;
  let channel: string | undefined;
  let shouldSpeak = false;
  let wake = false;
  let harness: string | undefined;
  let messageFile: string | undefined;
  const messageParts: string[] = [];

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--to" || current.startsWith("--to=")) {
      const value = parseFlagValue(parsed.args, index, "--to");
      targetLabel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--ref" || current.startsWith("--ref=")) {
      const value = parseFlagValue(parsed.args, index, "--ref");
      targetRef = value.value.replace(/^ref:/, "");
      targetLabel = `ref:${targetRef}`;
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--harness" || current.startsWith("--harness=")) {
      const value = parseFlagValue(parsed.args, index, "--harness");
      harness = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--speak") {
      shouldSpeak = true;
      continue;
    }
    if (current === "--wake") {
      wake = true;
      continue;
    }
    const fileFlag = flagNameFor(current, ["--message-file", "--body-file"]);
    if (fileFlag) {
      if (messageFile) {
        throw new ScoutCliError("message file was provided more than once");
      }
      const value = parseFlagValue(parsed.args, index, fileFlag);
      messageFile = resolveInputFilePath(parsed.currentDirectory, value.value);
      index = value.nextIndex;
      continue;
    }
    messageParts.push(current);
  }

  let message = messageParts.join(" ").trim();
  if (!targetLabel && !targetRef) {
    const routed = parseComposerRoutedBody(message, "send", parsed.currentDirectory);
    if (routed) {
      targetLabel = routed.targetLabel;
      targetRef = routed.targetRef;
      channel = mergeComposerChannel(channel, routed.channel);
      message = routed.message;
    }
  }
  if (message && messageFile) {
    rejectMixedBodySources("message");
  }
  if (!message && !messageFile) {
    throw new ScoutCliError("no message provided");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    targetLabel,
    targetRef,
    channel,
    shouldSpeak,
    wake,
    harness,
    message,
    messageFile,
  };
}

export function parseAskCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutAskCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let targetLabel: string | null = null;
  let targetRef: string | undefined;
  let projectPath: string | undefined;
  let channel: string | undefined;
  let harness: string | undefined;
  let timeoutSeconds: number | undefined;
  let replyMode: ScoutAskCommandOptions["replyMode"];
  let promptFile: string | undefined;
  const labels: string[] = [];
  const messageParts: string[] = [];

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--to" || current.startsWith("--to=")) {
      const value = parseFlagValue(parsed.args, index, "--to");
      targetLabel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--ref" || current.startsWith("--ref=")) {
      const value = parseFlagValue(parsed.args, index, "--ref");
      targetRef = value.value.replace(/^ref:/, "");
      targetLabel = `ref:${targetRef}`;
      index = value.nextIndex;
      continue;
    }
    if (current === "--project" || current.startsWith("--project=")) {
      const value = parseFlagValue(parsed.args, index, "--project");
      projectPath = resolveInputFilePath(parsed.currentDirectory, value.value);
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--harness" || current.startsWith("--harness=")) {
      const value = parseFlagValue(parsed.args, index, "--harness");
      harness = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--timeout" || current.startsWith("--timeout=")) {
      const value = parseFlagValue(parsed.args, index, "--timeout");
      const parsedTimeout = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
        throw new ScoutCliError(`invalid timeout: ${value.value}`);
      }
      timeoutSeconds = parsedTimeout;
      index = value.nextIndex;
      continue;
    }
    if (current === "--reply-mode" || current.startsWith("--reply-mode=")) {
      const value = parseFlagValue(parsed.args, index, "--reply-mode");
      if (value.value !== "inline" && value.value !== "notify" && value.value !== "none") {
        throw new ScoutCliError(`invalid reply mode: ${value.value}`);
      }
      replyMode = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--no-wait") {
      replyMode = "none";
      continue;
    }
    if (current === "--notify") {
      replyMode = "notify";
      continue;
    }
    const labelFlag = flagNameFor(current, ["--label", "--labels"]);
    if (labelFlag) {
      const value = parseFlagValue(parsed.args, index, labelFlag);
      appendLabelValues(labels, value.value);
      index = value.nextIndex;
      continue;
    }
    const fileFlag = flagNameFor(current, ["--prompt-file", "--body-file"]);
    if (fileFlag) {
      if (promptFile) {
        throw new ScoutCliError("prompt file was provided more than once");
      }
      const value = parseFlagValue(parsed.args, index, fileFlag);
      promptFile = resolveInputFilePath(parsed.currentDirectory, value.value);
      index = value.nextIndex;
      continue;
    }
    messageParts.push(current);
  }

  let message = messageParts.join(" ").trim();
  if (!targetLabel) {
    const routed = parseComposerRoutedBody(message, "ask", parsed.currentDirectory);
    if (routed) {
      targetLabel = routed.targetLabel ?? null;
      targetRef = routed.targetRef;
      projectPath = routed.projectPath;
      channel = mergeComposerChannel(channel, routed.channel);
      message = routed.message;
    }
  }
  if (targetLabel && projectPath) {
    throw new ScoutCliError("provide either --to/--ref or --project, not both");
  }
  if (!targetLabel && !projectPath) {
    throw new ScoutCliError("--to <name> or --project <path> is required");
  }
  if (message && promptFile) {
    rejectMixedBodySources("question");
  }
  if (!message && !promptFile) {
    throw new ScoutCliError("no question provided");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    ...(targetLabel ? { targetLabel } : {}),
    targetRef,
    projectPath,
    channel,
    harness,
    timeoutSeconds,
    replyMode,
    ...(labels.length ? { labels } : {}),
    message,
    promptFile,
  };
}

export function parseImplicitAskCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutImplicitAskCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let channel: string | undefined;
  let harness: string | undefined;
  let timeoutSeconds: number | undefined;
  let replyMode: ScoutAskCommandOptions["replyMode"];
  let promptFile: string | undefined;
  const labels: string[] = [];
  const messageParts: string[] = [];

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--harness" || current.startsWith("--harness=")) {
      const value = parseFlagValue(parsed.args, index, "--harness");
      harness = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--timeout" || current.startsWith("--timeout=")) {
      const value = parseFlagValue(parsed.args, index, "--timeout");
      const parsedTimeout = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
        throw new ScoutCliError(`invalid timeout: ${value.value}`);
      }
      timeoutSeconds = parsedTimeout;
      index = value.nextIndex;
      continue;
    }
    if (current === "--reply-mode" || current.startsWith("--reply-mode=")) {
      const value = parseFlagValue(parsed.args, index, "--reply-mode");
      if (value.value !== "inline" && value.value !== "notify" && value.value !== "none") {
        throw new ScoutCliError(`invalid reply mode: ${value.value}`);
      }
      replyMode = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--no-wait") {
      replyMode = "none";
      continue;
    }
    if (current === "--notify") {
      replyMode = "notify";
      continue;
    }
    const labelFlag = flagNameFor(current, ["--label", "--labels"]);
    if (labelFlag) {
      const value = parseFlagValue(parsed.args, index, labelFlag);
      appendLabelValues(labels, value.value);
      index = value.nextIndex;
      continue;
    }
    const fileFlag = flagNameFor(current, ["--prompt-file", "--body-file"]);
    if (fileFlag) {
      if (promptFile) {
        throw new ScoutCliError("prompt file was provided more than once");
      }
      const value = parseFlagValue(parsed.args, index, fileFlag);
      promptFile = resolveInputFilePath(parsed.currentDirectory, value.value);
      index = value.nextIndex;
      continue;
    }
    messageParts.push(current);
  }

  const input = messageParts.join(" ").trim();
  if (!input) {
    throw new ScoutCliError("no question provided");
  }

  const routed = parseComposerRoutedBody(input, "ask", parsed.currentDirectory);
  if (routed) {
    const message = routed.message;
    if (message && promptFile) {
      rejectMixedBodySources("question");
    }
    if (!message && !promptFile) {
      throw new ScoutCliError("no question provided");
    }

    return {
      currentDirectory: parsed.currentDirectory,
      args: parsed.args,
      agentName,
      ...(routed.targetLabel ? { targetLabel: routed.targetLabel } : {}),
      targetRef: routed.targetRef,
      projectPath: routed.projectPath,
      channel: mergeComposerChannel(channel, routed.channel),
      harness,
      timeoutSeconds,
      replyMode,
      ...(labels.length ? { labels } : {}),
      message,
      promptFile,
    };
  }

  const mentions = extractMentionTargets(input);
  if (mentions.length === 0) {
    throw new ScoutCliError("implicit ask requires >> target or an @agent mention");
  }
  if (mentions.length > 1) {
    throw new ScoutCliError("implicit ask supports exactly one @agent mention");
  }

  const [target] = mentions;
  const message = stripMention(input, target);
  if (message && promptFile) {
    rejectMixedBodySources("question");
  }
  if (!message && !promptFile) {
    throw new ScoutCliError("no question provided");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    targetLabel: target.label,
    channel,
    harness,
    timeoutSeconds,
    replyMode,
    ...(labels.length ? { labels } : {}),
    message,
    promptFile,
  };
}

export function parseWatchCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutWatchCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let channel: string | undefined;
  let conversationId: string | undefined;
  let since: number | undefined;
  let limit: number | undefined;
  let once = false;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--conversation" || current.startsWith("--conversation=")) {
      const value = parseFlagValue(parsed.args, index, "--conversation");
      conversationId = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--since" || current.startsWith("--since=")) {
      const value = parseFlagValue(parsed.args, index, "--since");
      since = parseSinceTimestamp(value.value);
      index = value.nextIndex;
      continue;
    }
    if (current === "--limit" || current.startsWith("--limit=")) {
      const value = parseFlagValue(parsed.args, index, "--limit");
      const parsedLimit = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new ScoutCliError(`invalid limit: ${value.value}`);
      }
      limit = parsedLimit;
      index = value.nextIndex;
      continue;
    }
    if (current === "--once") {
      once = true;
      continue;
    }
    unexpectedArgs("watch", args);
  }

  if (channel && conversationId) {
    throw new ScoutCliError("provide either --channel or --conversation, not both");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    channel,
    conversationId,
    since,
    limit,
    once,
  };
}

export function parseChannelCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutChannelCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let channel: string | undefined;
  let latest: number | undefined;
  let markRead = false;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--latest" || current.startsWith("--latest=")) {
      const value = parseFlagValue(parsed.args, index, "--latest");
      const parsedLimit = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new ScoutCliError(`invalid latest count: ${value.value}`);
      }
      latest = parsedLimit;
      index = value.nextIndex;
      continue;
    }
    if (current === "--mark-read" || current === "--read" || current === "--clear") {
      markRead = true;
      continue;
    }
    if (!current.startsWith("-") && !channel) {
      channel = current;
      continue;
    }
    unexpectedArgs("channel", args);
  }

  if (latest && markRead) {
    throw new ScoutCliError("provide either --latest or --mark-read, not both");
  }

  if (channel && !latest && !markRead) {
    throw new ScoutCliError("channel name is only valid with --latest or --mark-read");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    channel,
    latest,
    markRead,
  };
}

export function parseInboxCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutInboxCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let latest = 10;
  let since: number | undefined;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--latest" || current.startsWith("--latest=") || current === "--limit" || current.startsWith("--limit=")) {
      const flag = current === "--limit" || current.startsWith("--limit=") ? "--limit" : "--latest";
      const value = parseFlagValue(parsed.args, index, flag);
      const parsedLimit = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new ScoutCliError(`invalid latest count: ${value.value}`);
      }
      latest = parsedLimit;
      index = value.nextIndex;
      continue;
    }
    if (current === "--since" || current.startsWith("--since=")) {
      const value = parseFlagValue(parsed.args, index, "--since");
      since = parseSinceTimestamp(value.value);
      index = value.nextIndex;
      continue;
    }
    unexpectedArgs("inbox", args);
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    latest,
    since,
  };
}

export function parseLatestCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutLatestCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentId: string | undefined;
  let actorId: string | undefined;
  let channel: string | undefined;
  let conversationId: string | undefined;
  let limit = 12;
  let messages = false;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--agent" || current.startsWith("--agent=")) {
      const value = parseFlagValue(parsed.args, index, "--agent");
      agentId = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--actor" || current.startsWith("--actor=")) {
      const value = parseFlagValue(parsed.args, index, "--actor");
      actorId = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--conversation" || current.startsWith("--conversation=")) {
      const value = parseFlagValue(parsed.args, index, "--conversation");
      conversationId = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--limit" || current.startsWith("--limit=")) {
      const value = parseFlagValue(parsed.args, index, "--limit");
      const parsedLimit = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new ScoutCliError(`invalid limit: ${value.value}`);
      }
      limit = parsedLimit;
      index = value.nextIndex;
      continue;
    }
    if (current === "--messages") {
      messages = true;
      continue;
    }
    unexpectedArgs("latest", args);
  }

  if (channel && conversationId) {
    throw new ScoutCliError("provide either --channel or --conversation, not both");
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentId,
    actorId,
    channel,
    conversationId,
    limit,
    messages,
  };
}

export function parseEnrollCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutEnrollCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let agentName: string | null = null;
  let task: string | undefined;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--task") {
      task = parsed.args.slice(index + 1).join(" ").trim() || undefined;
      break;
    }
    if (current.startsWith("--task=")) {
      task = current.slice("--task=".length).trim() || undefined;
      continue;
    }
    unexpectedArgs("enroll", args);
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    agentName,
    task,
  };
}

export function parseCardCreateCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutCardCreateCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let projectPath: string | null = null;
  let agentName: string | undefined;
  let displayName: string | undefined;
  let harness: string | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  let permissionProfile: string | undefined;
  let channelEnabled: boolean | undefined;
  let requesterId: string | null = null;
  let noInput = false;
  let oneTimeUse = false;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--name" || current.startsWith("--name=")) {
      const value = parseFlagValue(parsed.args, index, "--name");
      agentName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--display-name" || current.startsWith("--display-name=")) {
      const value = parseFlagValue(parsed.args, index, "--display-name");
      displayName = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--harness" || current.startsWith("--harness=")) {
      const value = parseFlagValue(parsed.args, index, "--harness");
      harness = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--model" || current.startsWith("--model=")) {
      const value = parseFlagValue(parsed.args, index, "--model");
      model = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--reasoning-effort" || current.startsWith("--reasoning-effort=")) {
      const value = parseFlagValue(parsed.args, index, "--reasoning-effort");
      reasoningEffort = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--effort" || current.startsWith("--effort=")) {
      const value = parseFlagValue(parsed.args, index, "--effort");
      reasoningEffort = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--permission-profile" || current.startsWith("--permission-profile=")) {
      const value = parseFlagValue(parsed.args, index, "--permission-profile");
      permissionProfile = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--channel-enabled" || current === "--enable-channel") {
      channelEnabled = true;
      continue;
    }
    if (current === "--no-channel" || current === "--channel-disabled") {
      channelEnabled = false;
      continue;
    }
    if (current === "--as" || current.startsWith("--as=")) {
      const value = parseFlagValue(parsed.args, index, "--as");
      requesterId = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--path" || current.startsWith("--path=")) {
      const value = parseFlagValue(parsed.args, index, "--path");
      if (projectPath) {
        throw new ScoutCliError("project path was provided more than once");
      }
      projectPath = resolve(value.value);
      index = value.nextIndex;
      continue;
    }
    if (current === "--no-input") {
      noInput = true;
      continue;
    }
    if (current === "--one-time") {
      oneTimeUse = true;
      continue;
    }
    if (current.startsWith("--")) {
      unexpectedArgs("card create", args);
    }
    if (projectPath) {
      throw new ScoutCliError(`unexpected arguments for card create: ${args.join(" ")}`);
    }
    projectPath = resolve(current);
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    projectPath: projectPath ?? parsed.currentDirectory,
    agentName,
    displayName,
    harness,
    model,
    reasoningEffort,
    permissionProfile,
    channelEnabled,
    requesterId,
    noInput,
    oneTimeUse,
  };
}

export function parseTuiCommandOptions(
  args: string[],
  defaultCurrentDirectory: string,
): ScoutTuiCommandOptions {
  const parsed = parseContextRootPrefix(args, defaultCurrentDirectory);
  let channel: string | undefined;
  let limit = 12;
  let intervalMs = 1_500;

  for (let index = 0; index < parsed.args.length; index += 1) {
    const current = parsed.args[index] ?? "";
    if (current === "--channel" || current.startsWith("--channel=")) {
      const value = parseFlagValue(parsed.args, index, "--channel");
      channel = value.value;
      index = value.nextIndex;
      continue;
    }
    if (current === "--limit" || current.startsWith("--limit=")) {
      const value = parseFlagValue(parsed.args, index, "--limit");
      const parsedLimit = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new ScoutCliError(`invalid limit: ${value.value}`);
      }
      limit = parsedLimit;
      index = value.nextIndex;
      continue;
    }
    if (current === "--interval" || current.startsWith("--interval=")) {
      const value = parseFlagValue(parsed.args, index, "--interval");
      const parsedInterval = Number.parseInt(value.value, 10);
      if (!Number.isFinite(parsedInterval) || parsedInterval < 250) {
        throw new ScoutCliError(`invalid interval: ${value.value}`);
      }
      intervalMs = parsedInterval;
      index = value.nextIndex;
      continue;
    }
    unexpectedArgs("tui", args);
  }

  return {
    currentDirectory: parsed.currentDirectory,
    args: parsed.args,
    channel,
    limit,
    intervalMs,
  };
}
