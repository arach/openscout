import type { Command, CommandRun } from "@/lib/studio/command";

/**
 * Request-scoped trace of every command that ran for the current page render.
 *
 * The page handler builds entries explicitly (rather than via AsyncLocalStorage)
 * so the run summary can be rendered AFTER all commands have resolved, with
 * the full log in scope.
 */

export interface RunLlmCost {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface RunTrace {
  /** Copyable shell-equivalent for the run with bound input. */
  shell: string;
  /** One-line summary of the bound input. */
  input: string;
  /** One-line summary of the run output. */
  output: string;
  /** Cache key used for this run. */
  cacheKey: string;
}

export interface RunLogEntry {
  id: string;
  label: string;
  durationMs: number;
  cached: boolean;
  error?: string;
  llm?: RunLlmCost;
  trace?: RunTrace;
}

export interface RunLogSummary {
  /** Wall time this request actually spent in commands. Cached entries count as 0. */
  wallMs: number;
  /** Sum of durations as if nothing had been cached. Useful for "what this would have cost". */
  uncachedMs: number;
  ran: number;
  cached: number;
  errors: number;
  llm: {
    prompt: number;
    completion: number;
    reasoning: number;
    total: number;
    /** Rough $ estimate using a per-model rate table. May be 0 if model unknown. */
    estCostUsd: number;
  };
}

/**
 * Per-model token rates. Numbers are best-effort approximations and only used
 * for a rough budget display.
 */
const RATES: Record<string, { input: number; output: number }> = {
  // MiniMax-M2: ~$0.30 / 1M input, $1.20 / 1M output (approximate).
  "MiniMax-M2": { input: 0.30 / 1_000_000, output: 1.20 / 1_000_000 },
};

export function makeRunLogEntry<I, O>(
  cmd: Command<I, O>,
  input: I,
  run: CommandRun<O>,
  options?: {
    extractLlm?: (output: O) => RunLlmCost | undefined;
    summarizeInput?: (input: I) => string;
    summarizeOutput?: (output: O) => string;
  },
): RunLogEntry {
  const trace: RunTrace | undefined = run.error
    ? undefined
    : {
        shell: cmd.shell(input),
        input: options?.summarizeInput
          ? options.summarizeInput(input)
          : safeJson(input),
        output: options?.summarizeOutput
          ? options.summarizeOutput(run.output)
          : safeJson(run.output, 200),
        cacheKey: cmd.cacheKey ? cmd.cacheKey(input) : JSON.stringify(input),
      };
  return {
    id: cmd.id,
    label: cmd.label,
    durationMs: run.durationMs,
    cached: run.cached,
    error: run.error,
    llm:
      !run.error && options?.extractLlm ? options.extractLlm(run.output) : undefined,
    trace,
  };
}

function safeJson(value: unknown, max = 240): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) text = "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function summarizeRunLog(entries: RunLogEntry[]): RunLogSummary {
  const uncachedMs = entries.reduce((a, e) => a + e.durationMs, 0);
  const wallMs = entries.reduce((a, e) => a + (e.cached ? 0 : e.durationMs), 0);
  const ran = entries.filter((e) => !e.cached && !e.error).length;
  const cached = entries.filter((e) => e.cached).length;
  const errors = entries.filter((e) => e.error).length;
  let prompt = 0;
  let completion = 0;
  let reasoning = 0;
  let estCostUsd = 0;
  for (const e of entries) {
    if (!e.llm) continue;
    prompt += e.llm.promptTokens;
    completion += e.llm.completionTokens;
    reasoning += e.llm.reasoningTokens;
    const rate = RATES[e.llm.model];
    if (rate) {
      estCostUsd += e.llm.promptTokens * rate.input;
      estCostUsd += (e.llm.completionTokens + e.llm.reasoningTokens) * rate.output;
    }
  }
  return {
    wallMs,
    uncachedMs,
    ran,
    cached,
    errors,
    llm: {
      prompt,
      completion,
      reasoning,
      total: prompt + completion + reasoning,
      estCostUsd,
    },
  };
}
