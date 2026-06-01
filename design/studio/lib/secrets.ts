/**
 * Server-side secret access.
 *
 * Reads secrets via the `secret` CLI (which uses the macOS keychain) so we
 * never touch dotenv files. Never log or echo the resolved value.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SECRET_BIN = path.join(homedir(), ".local", "bin", "secret");

const cache = new Map<string, string>();

export async function getSecret(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit;
  // Prefer ambient env if the dev server was started with `secret run … -- bun dev`.
  if (process.env[name]) {
    cache.set(name, process.env[name]!);
    return process.env[name]!;
  }
  const { stdout } = await execFileAsync(SECRET_BIN, ["get", name], {
    maxBuffer: 1024 * 64,
  });
  const value = stdout.trim();
  if (!value) throw new Error(`secret ${name} resolved to empty string`);
  cache.set(name, value);
  return value;
}
