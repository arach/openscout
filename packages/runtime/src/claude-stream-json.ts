import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SessionRequestOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs?: string[];
};

type InvocationOptions = SessionRequestOptions & {
  prompt: string;
  timeoutMs?: number;
};

type InterruptOptions = SessionRequestOptions;

type ActiveTurn = {
  id: string;
  output: string[];
  timer: NodeJS.Timeout | null;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
};

type ClaudeEvent =
  | { type: "system"; subtype?: string; session_id?: string; sessionId?: string }
  | { type: "assistant"; message?: { content?: Array<{ type?: string; text?: string }> }; content?: Array<{ type?: string; text?: string }> }
  | { type: "result"; subtype?: string; result?: string }
  | { type: "error"; error?: { message?: string }; message?: string };

function sessionKey(options: SessionRequestOptions): string {
  return `${options.agentName}:${options.sessionId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

class ClaudeStreamJsonSession {
  private readonly sessionStatePath: string;

  private readonly stdoutLogPath: string;

  private readonly stderrLogPath: string;

  private process: ChildProcessWithoutNullStreams | null = null;

  private lineBuffer = "";

  private activeTurn: ActiveTurn | null = null;

  private starting: Promise<void> | null = null;

  private claudeSessionId: string | null = null;

  private lastConfigSignature: string;

  constructor(private options: SessionRequestOptions) {
    this.sessionStatePath = join(options.runtimeDirectory, "claude-session-id.txt");
    this.stdoutLogPath = join(options.logsDirectory, "stdout.log");
    this.stderrLogPath = join(options.logsDirectory, "stderr.log");
    this.lastConfigSignature = this.configSignature(options);
  }

  matches(options: SessionRequestOptions): boolean {
    return this.lastConfigSignature === this.configSignature(options);
  }

  update(options: SessionRequestOptions): void {
    this.options = options;
    this.lastConfigSignature = this.configSignature(options);
  }

  isAlive(): boolean {
    return Boolean(this.process && !this.process.killed && this.process.exitCode === null);
  }

  async ensureOnline(): Promise<{ sessionId: string | null }> {
    await this.ensureStarted();
    return {
      sessionId: this.claudeSessionId,
    };
  }

  async invoke(prompt: string, timeoutMs = 5 * 60_000): Promise<{ output: string; sessionId: string | null }> {
    await this.ensureStarted();
    if (!this.process?.stdin) {
      throw new Error(`Claude stream-json session for ${this.options.agentName} is not running.`);
    }
    if (this.activeTurn) {
      throw new Error(`Claude stream-json session for ${this.options.agentName} already has an active turn.`);
    }

    const outputPromise = new Promise<string>((resolve, reject) => {
      const turn: ActiveTurn = {
        id: randomUUID(),
        output: [],
        timer: setTimeout(() => {
          void this.interrupt().catch(() => undefined);
          if (this.activeTurn?.id === turn.id) {
            this.activeTurn = null;
          }
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${this.options.agentName}.`));
        }, timeoutMs),
        resolve,
        reject,
      };
      this.activeTurn = turn;
    });

    const payload = JSON.stringify({
      type: "user",
      session_id: this.claudeSessionId ?? "",
      message: {
        role: "user",
        content: prompt,
      },
      parent_tool_use_id: null,
    }) + "\n";
    this.process.stdin.write(payload);

    const output = await outputPromise;

    return {
      output,
      sessionId: this.claudeSessionId,
    };
  }

  async interrupt(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
    }
  }

  async shutdown(options: { resetSession?: boolean } = {}): Promise<void> {
    const turn = this.activeTurn;
    this.activeTurn = null;
    if (turn) {
      if (turn.timer) {
        clearTimeout(turn.timer);
      }
      turn.reject(new Error(`Claude stream-json session for ${this.options.agentName} was shut down.`));
    }

    const child = this.process;
    this.process = null;
    this.starting = null;
    this.lineBuffer = "";

    if (child && !child.killed && child.exitCode === null) {
      child.kill();
    }

    if (options.resetSession) {
      this.claudeSessionId = null;
      await rm(this.sessionStatePath, { force: true });
    }
  }

  private configSignature(options: SessionRequestOptions): string {
    return JSON.stringify({
      cwd: options.cwd,
      sessionId: options.sessionId,
      systemPrompt: options.systemPrompt,
      launchArgs: Array.isArray(options.launchArgs) ? options.launchArgs : [],
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.isAlive()) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startSession();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startSession(): Promise<void> {
    await mkdir(this.options.runtimeDirectory, { recursive: true });
    await mkdir(this.options.logsDirectory, { recursive: true });
    await writeFile(join(this.options.runtimeDirectory, "prompt.txt"), this.options.systemPrompt);
    this.claudeSessionId = await readOptionalFile(this.sessionStatePath);

    const args = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      ...this.options.launchArgs ?? [],
    ];
    if (this.claudeSessionId) {
      args.push("--resume", this.claudeSessionId);
    }

    this.process = spawn("claude", args, {
      cwd: this.options.cwd,
      env: process.env,
    });

    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");

    this.process.stdout.on("data", (chunk: string) => {
      void appendFile(this.stdoutLogPath, chunk).catch(() => undefined);
      this.lineBuffer += chunk;
      const lines = this.lineBuffer.split("\n");
      this.lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.handleEvent(JSON.parse(trimmed) as ClaudeEvent);
      }
    });
    this.process.stderr.on("data", (chunk: string) => {
      void appendFile(this.stderrLogPath, chunk).catch(() => undefined);
    });

    this.process.on("exit", (code: number | null) => {
      if (code !== 0 && this.activeTurn) {
        const turn = this.activeTurn;
        this.activeTurn = null;
        if (turn.timer) {
          clearTimeout(turn.timer);
        }
        turn.reject(new Error(`Claude exited with code ${code}`));
      }
    });
  }

  private handleEvent(event: ClaudeEvent): void {
    if (event.type === "system" && event.subtype === "init") {
      const nextSessionId = event.session_id ?? event.sessionId ?? null;
      if (nextSessionId && nextSessionId !== this.claudeSessionId) {
        this.claudeSessionId = nextSessionId;
        void writeFile(this.sessionStatePath, `${nextSessionId}\n`);
      }
      return;
    }

    const turn = this.activeTurn;
    if (!turn) {
      return;
    }

    if (event.type === "assistant") {
      const content = event.message?.content ?? event.content ?? [];
      for (const part of content) {
        if (part.type === "text" && part.text) {
          turn.output.push(part.text);
        }
      }
      return;
    }

    if (event.type === "result") {
      this.activeTurn = null;
      if (turn.timer) {
        clearTimeout(turn.timer);
      }
      turn.resolve(turn.output.join("").trim());
      return;
    }

    if (event.type === "error") {
      this.activeTurn = null;
      if (turn.timer) {
        clearTimeout(turn.timer);
      }
      turn.reject(new Error(event.error?.message ?? event.message ?? "Unknown Claude error"));
    }
  }
}

const sessions = new Map<string, ClaudeStreamJsonSession>();

function getOrCreateSession(options: SessionRequestOptions): ClaudeStreamJsonSession {
  const key = sessionKey(options);
  const existing = sessions.get(key);
  if (existing) {
    if (existing.matches(options)) {
      return existing;
    }
    void existing.shutdown({ resetSession: false });
    sessions.delete(key);
  }

  const session = new ClaudeStreamJsonSession(options);
  sessions.set(key, session);
  return session;
}

export async function ensureClaudeStreamJsonAgentOnline(options: SessionRequestOptions): Promise<{ sessionId: string | null }> {
  const session = getOrCreateSession(options);
  session.update(options);
  return session.ensureOnline();
}

export async function invokeClaudeStreamJsonAgent(options: InvocationOptions): Promise<{ output: string; sessionId: string | null }> {
  const session = getOrCreateSession(options);
  session.update(options);
  return session.invoke(options.prompt, options.timeoutMs);
}

export async function interruptClaudeStreamJsonAgent(options: InterruptOptions): Promise<void> {
  const session = sessions.get(sessionKey(options));
  if (!session) {
    return;
  }
  session.update(options);
  await session.interrupt();
}

export function isClaudeStreamJsonAgentAlive(options: SessionRequestOptions): boolean {
  const session = sessions.get(sessionKey(options));
  return Boolean(session?.isAlive());
}

export async function shutdownClaudeStreamJsonAgent(
  options: SessionRequestOptions,
  shutdownOptions: { resetSession?: boolean } = {},
): Promise<void> {
  const key = sessionKey(options);
  const session = sessions.get(key);
  if (!session) {
    if (shutdownOptions.resetSession) {
      await rm(join(options.runtimeDirectory, "claude-session-id.txt"), { force: true });
    }
    return;
  }

  sessions.delete(key);
  await session.shutdown(shutdownOptions);
}
