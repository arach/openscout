import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Command } from "@/lib/studio/command";
import {
  parseSessionCommand,
  type NormalizedRecord,
  type ParseSessionResult,
} from "@/lib/studio/commands/parse-session";
import { callMinimax, type MinimaxUsage } from "@/lib/llm/minimax";

export interface EnrichSessionInput {
  /** Absolute path to source JSONL. */
  path: string;
  /** Stable session id used for output directory. */
  sessionId: string;
  /** Cap on records considered. Matches the extract step's cap. */
  recordLimit?: number;
}

export interface EnrichedFile {
  name: string;
  path: string;
  bytes: number;
}

export interface EnrichSessionResult {
  outDir: string;
  files: EnrichedFile[];
  model: string;
  usage: MinimaxUsage;
  finishReason: string;
  promptChars: number;
  /** The reasoning content the model surfaced, for inspection. */
  reasoning: string;
  /** Latency of the LLM call itself, isolated from file write. */
  llmLatencyMs: number;
  error?: string;
}

const ROOT = path.join(tmpdir(), "scout-study", "qmd");
const DEFAULT_LIMIT = 1500;
const PROMPT_CHAR_CAP = 24_000;

export const enrichSessionCommand: Command<EnrichSessionInput, EnrichSessionResult> = {
  id: "enrich-session",
  label: "Enrich (LLM)",
  shell: ({ path: p, sessionId }) =>
    `scout enrich --source ${shellQuote(shrinkPath(p))} --out ${shellQuote(shrinkPath(path.join(ROOT, sessionId)))} --model MiniMax-M2`,
  run: async ({ path: filePath, sessionId, recordLimit }) => {
    const limit = recordLimit ?? DEFAULT_LIMIT;
    const parseRun = await parseSessionCommand.run({ path: filePath, limit });

    if (parseRun.error) {
      return emptyResult({ sessionId, parseRun, error: parseRun.error });
    }

    const outDir = path.join(ROOT, sessionId);
    await fs.mkdir(outDir, { recursive: true });

    try {
      const condensed = condenseForLlm(parseRun.records);
      const system = [
        "You are a careful technical analyst reading a transcript of a coding-agent session.",
        "Your job is to produce two short markdown documents about the session.",
        "Be specific and concrete; cite paths, commands, or file types when relevant.",
        "Never invent details that aren't in the transcript.",
      ].join(" ");
      const user = [
        "Below is a condensed transcript of a coding-agent session. Each line is one",
        "normalized event, prefixed with [NNNN] kind (tag) — detail.",
        "",
        "Produce exactly two top-level markdown sections, in this order:",
        "",
        "# Overview",
        "",
        "Two short paragraphs describing what this session was about: the user's goal,",
        "the area of the codebase touched, and what the agent ended up doing.",
        "",
        "# Decisions",
        "",
        "A bulleted list of concrete decisions made or unresolved questions. Each bullet",
        "should reference a specific event or file when possible. Include a final",
        '"## Follow-ups" subsection if there are loose threads.',
        "",
        "Transcript:",
        "```",
        condensed,
        "```",
      ].join("\n");

      const llm = await callMinimax({
        system,
        user,
        maxTokens: 4000,
        temperature: 0.2,
      });

      const content = llm.content || "";
      const { overview, decisions } = splitOverviewDecisions(content);

      const files: EnrichedFile[] = [];
      files.push(await writeFile(outDir, "overview.md", overview));
      files.push(await writeFile(outDir, "decisions.md", decisions));
      files.push(
        await writeFile(
          outDir,
          "_llm-call.json",
          JSON.stringify(
            {
              model: llm.model,
              usage: llm.usage,
              finishReason: llm.finishReason,
              latencyMs: llm.latencyMs,
              promptChars: user.length,
            },
            null,
            2,
          ),
        ),
      );

      return {
        outDir,
        files,
        model: llm.model,
        usage: llm.usage,
        finishReason: llm.finishReason,
        promptChars: user.length,
        reasoning: llm.reasoning,
        llmLatencyMs: llm.latencyMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await fs.writeFile(path.join(outDir, "_llm-error.txt"), msg);
      return emptyResult({ sessionId, parseRun, error: msg });
    }
  },
  cacheKey: ({ path: p, sessionId, recordLimit }) =>
    `${sessionId}::${p}::${recordLimit ?? DEFAULT_LIMIT}`,
  cacheTtlMs: 60 * 60 * 1000,
};

function emptyResult({
  sessionId,
  parseRun: _parseRun,
  error,
}: {
  sessionId: string;
  parseRun: ParseSessionResult;
  error: string;
}): EnrichSessionResult {
  return {
    outDir: path.join(ROOT, sessionId),
    files: [],
    model: "",
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    finishReason: "skipped",
    promptChars: 0,
    reasoning: "",
    llmLatencyMs: 0,
    error,
  };
}

function condenseForLlm(records: NormalizedRecord[]): string {
  const lines: string[] = [];
  for (const r of records) {
    const idx = String(r.i).padStart(4, "0");
    if (r.kind === "user_turn") {
      lines.push(`[${idx}] user — ${trim(r.text ?? "", 240)}`);
    } else if (r.kind === "assistant_turn") {
      lines.push(`[${idx}] assistant (${r.tag ?? ""}) — ${trim(r.text ?? "", 200)}`);
    } else if (r.kind === "command_or_tool" && r.tool) {
      lines.push(`[${idx}] tool ${r.tool.name} ${oneLineInput(r.tool.input)}`);
    } else if (r.kind === "observation" && r.result) {
      const out =
        typeof r.result.output === "string"
          ? r.result.output
          : JSON.stringify(r.result.output ?? "");
      lines.push(`[${idx}] result — ${trim(out, 140)}`);
    } else if (r.kind === "session_meta") {
      const model = r.meta?.model_provider ?? r.meta?.model ?? "?";
      const cwd = r.meta?.cwd ?? "?";
      lines.push(`[${idx}] meta model=${model} cwd=${trim(String(cwd), 80)}`);
    }
  }
  const joined = lines.join("\n");
  return joined.length > PROMPT_CHAR_CAP
    ? joined.slice(0, PROMPT_CHAR_CAP) + "\n… (transcript truncated)"
    : joined;
}

function splitOverviewDecisions(content: string): {
  overview: string;
  decisions: string;
} {
  const decisionsIdx = content.indexOf("# Decisions");
  if (decisionsIdx === -1) {
    return { overview: content.trim(), decisions: "# Decisions\n\n_not produced_\n" };
  }
  return {
    overview: content.slice(0, decisionsIdx).trim(),
    decisions: content.slice(decisionsIdx).trim(),
  };
}

async function writeFile(outDir: string, name: string, content: string): Promise<EnrichedFile> {
  const fullPath = path.join(outDir, name);
  await fs.writeFile(fullPath, content);
  const stat = await fs.stat(fullPath);
  return { name, path: fullPath, bytes: stat.size };
}

function oneLineInput(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {});
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 100 ? trimmed.slice(0, 97) + "…" : trimmed;
}

function trim(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
}

function shrinkPath(file: string): string {
  const home = process.env.HOME ?? "";
  return home && file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

function shellQuote(s: string): string {
  return /[^A-Za-z0-9_./~-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}
