/**
 * Studio runnable command primitive.
 *
 * A `Command<I, O>` packages a server-side action: a copyable shell-equivalent
 * for display, a typed `run(input)` that actually executes, and an optional
 * cache key + TTL. Use `runCommand` instead of calling `command.run` directly
 * so caching + timing + error capture are centralized.
 *
 * Pair with `<CommandSurface>` (components/studio/CommandSurface.tsx) to render
 * the command line, run badge, and output via the renderer registry.
 */

export interface Command<Input, Output> {
  /** Stable id used in URLs and as the default cache namespace. */
  id: string;
  label: string;
  /** Copyable shell line. Display only — never executed. */
  shell: (input: Input) => string;
  /** Server-side execution. Uses fs/sqlite/etc, never spawns a shell. */
  run: (input: Input) => Promise<Output>;
  /** Defaults to JSON.stringify(input). */
  cacheKey?: (input: Input) => string;
  /** 0 or undefined disables caching. */
  cacheTtlMs?: number;
}

export interface CommandRun<Output> {
  output: Output;
  durationMs: number;
  cached: boolean;
  ranAt: number;
  error?: string;
}

interface CacheEntry {
  at: number;
  run: CommandRun<unknown>;
}

const cache = new Map<string, CacheEntry>();

function entryKey<I>(cmd: Command<I, unknown>, input: I): string {
  const inputKey = cmd.cacheKey ? cmd.cacheKey(input) : JSON.stringify(input);
  return `${cmd.id}::${inputKey}`;
}

export async function runCommand<I, O>(
  cmd: Command<I, O>,
  input: I,
  options?: { force?: boolean },
): Promise<CommandRun<O>> {
  const ttl = cmd.cacheTtlMs ?? 0;
  const key = entryKey(cmd, input);
  const now = Date.now();

  if (ttl > 0 && !options?.force) {
    const hit = cache.get(key);
    if (hit && now - hit.at < ttl) {
      return { ...(hit.run as CommandRun<O>), cached: true };
    }
  }

  const start = Date.now();
  try {
    const output = await cmd.run(input);
    const run: CommandRun<O> = {
      output,
      durationMs: Date.now() - start,
      cached: false,
      ranAt: start,
    };
    if (ttl > 0) cache.set(key, { at: now, run: run as CommandRun<unknown> });
    return run;
  } catch (err) {
    return {
      output: undefined as O,
      durationMs: Date.now() - start,
      cached: false,
      ranAt: start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Clear the in-process cache. Test/dev only. */
export function clearCommandCache(): void {
  cache.clear();
}
