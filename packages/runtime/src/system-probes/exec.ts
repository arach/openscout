import { spawn } from "node:child_process";

import type { ProbeCtx } from "./registry.js";

export type ExecProbeFileOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};

export type ExecProbeFileResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export class ProbeCommandError extends Error {
  code: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;

  constructor(message: string, options: { code: string; exitCode?: number | null; signal?: NodeJS.Signals | null }) {
    super(message);
    this.name = "ProbeCommandError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.signal = options.signal;
  }
}

const DEFAULT_STDOUT_CAP_BYTES = 1024 * 1024;
const DEFAULT_STDERR_CAP_BYTES = 128 * 1024;
const SIGKILL_DELAY_MS = 500;

function bufferByteLength(chunks: Buffer[]): number {
  return chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
}

function abortMessage(ctx: ProbeCtx): string {
  const reason = ctx.signal.reason;
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return `Probe ${ctx.probeId} aborted`;
}

export async function execProbeFile(
  ctx: ProbeCtx,
  file: string,
  args: readonly string[],
  options: ExecProbeFileOptions = {},
): Promise<ExecProbeFileResult> {
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_STDOUT_CAP_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_STDERR_CAP_BYTES;

  return await new Promise<ExecProbeFileResult>((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new ProbeCommandError(abortMessage(ctx), { code: "aborted" }));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const cleanup = () => {
      ctx.signal.removeEventListener("abort", onAbort);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      reject(error);
    };

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      ctx.signal.removeEventListener("abort", onAbort);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, SIGKILL_DELAY_MS);
      reject(new ProbeCommandError(abortMessage(ctx), { code: "timeout" }));
    };

    ctx.signal.addEventListener("abort", onAbort, { once: true });

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stdoutChunks.push(chunk);
      if (bufferByteLength(stdoutChunks) > maxStdoutBytes) {
        fail(new ProbeCommandError(
          `Probe ${ctx.probeId} stdout exceeded ${maxStdoutBytes} bytes`,
          { code: "output_cap" },
        ));
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stderrChunks.push(chunk);
      if (bufferByteLength(stderrChunks) > maxStderrBytes) {
        fail(new ProbeCommandError(
          `Probe ${ctx.probeId} stderr exceeded ${maxStderrBytes} bytes`,
          { code: "output_cap" },
        ));
      }
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const code = typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code?: unknown }).code)
        : "spawn";
      reject(new ProbeCommandError(error.message, { code }));
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        cleanup();
        return;
      }
      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode });
        return;
      }
      reject(new ProbeCommandError(
        `${file} exited with ${exitCode ?? signal ?? "unknown status"}`,
        { code: "exit", exitCode, signal },
      ));
    });
  });
}

export type ExecSystemFileOptions = ExecProbeFileOptions & {
  timeoutMs: number;
  probeId?: string;
};

export async function execSystemFile(
  file: string,
  args: readonly string[],
  options: ExecSystemFileOptions,
): Promise<ExecProbeFileResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new ProbeCommandError(
      `Command ${file} timed out after ${options.timeoutMs}ms`,
      { code: "timeout" },
    ));
  }, options.timeoutMs);
  try {
    return await execProbeFile({
      probeId: options.probeId ?? `imperative.${file}`,
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      startedAt: Date.now(),
    }, file, args, options);
  } finally {
    clearTimeout(timeout);
  }
}
