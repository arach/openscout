// Mobile terminal provisioning — the I/O shell around the pure
// `provisionSshTerminalAccess` grant logic.
//
// The phone generates an SSH keypair locally (P256 / ecdsa-sha2-nistp256) and
// sends us its public key. We append it (idempotently, one managed line per
// device) to the Mac user's `~/.ssh/authorized_keys`, then hand back the
// reachable host / port / username so the phone can open a real PTY over SSH.
//
// Security posture: the device's public key is authorized for THIS Mac user.
// We never see or store the phone's private key. We also return the Mac's
// ed25519 host-key fingerprint so the phone pins it over the already-encrypted
// Noise bridge — closing the trust-on-first-use window (no unauthenticated
// first connection).

import { createHash } from "crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir, hostname, userInfo } from "os";
import { join } from "path";
import { execSystemFile } from "@openscout/runtime/system-probes";
import { provisionSshTerminalAccess } from "./ssh-terminal-access.ts";
import { log } from "./log.ts";

export interface MobileTerminalProvisionResult {
  host: string;
  port: number;
  username: string;
  /** SHA256:… of the Mac's host key, pinned by the phone before SSH auth. */
  hostKeyFingerprint: string;
}

export async function provisionMobileTerminalAccess(
  sshPublicKey: string,
  deviceId: string | undefined,
): Promise<MobileTerminalProvisionResult> {
  const id = deviceId?.trim() || "scout-ios-device";
  const sshDir = join(homedir(), ".ssh");
  const authorizedKeysPath = join(sshDir, "authorized_keys");
  const hostKeyFingerprint = readRequiredHostKeyFingerprint();

  const result = withAuthorizedKeysLock(sshDir, () => {
    if (!existsSync(sshDir)) {
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    }
    try {
      chmodSync(sshDir, 0o700);
    } catch {
      // best-effort; a pre-existing ~/.ssh may be owned with stricter perms
    }

    const existing = existsSync(authorizedKeysPath)
      ? readFileSync(authorizedKeysPath, "utf8")
      : "";

    const result = provisionSshTerminalAccess({
      authorizedKeys: existing,
      deviceId: id,
      sshPublicKey,
    });

    if (result.changed) {
      writeAuthorizedKeysAtomically(authorizedKeysPath, result.authorizedKeys);
      log.info(
        "terminal",
        `authorized SSH key for device ${id} (${result.grant.sshPublicKey.fingerprintSha256})`,
      );
    } else {
      log.info("terminal", `SSH key already authorized for device ${id}`);
    }

    try {
      chmodSync(authorizedKeysPath, 0o600);
    } catch {
      // best-effort
    }
    return result;
  });

  // Pre-warm the persistent `scout` tmux session HERE, in the Mac's GUI login
  // session (this runs inside the menu-app-spawned controller). The phone's
  // terminal command is `zsh -lc 'exec tmux new -A -s scout'`: when the session
  // doesn't exist it CREATES one, whose interactive pane sources ~/.zshrc, which
  // runs `security unlock-keychain` — a no-op when the login keychain is already
  // unlocked (GUI session) but a PASSWORD PROMPT over a bare SSH session. By
  // ensuring the session exists before the phone connects, every iOS connect
  // becomes a clean ATTACH (no new shell, no .zshrc, no keychain prompt).
  await ensureScoutTmuxSession();

  return {
    host: resolveReachableHost(),
    port: 22,
    username: userInfo().username,
    hostKeyFingerprint,
  };
}

/**
 * Idempotently ensure the persistent `scout` tmux session exists, created in
 * this (GUI-session) process so its shell init touches an already-unlocked
 * keychain. `zsh -lc` restores the login PATH (Homebrew `tmux` on
 * /opt/homebrew/bin) without sourcing the interactive ~/.zshrc itself (no -i);
 * the inner `tmux new-session` is what spawns the interactive pane. Best-effort:
 * if it fails the phone simply falls back to creating the session on connect
 * (today's behavior), so the terminal still works.
 */
async function ensureScoutTmuxSession(): Promise<void> {
  try {
    await execSystemFile("zsh", [
      "-lc",
      "tmux has-session -t scout 2>/dev/null || tmux new-session -d -s scout",
    ], {
      timeoutMs: 8_000,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 64 * 1024,
    });
    log.info("terminal", "ensured persistent `scout` tmux session (GUI session)");
  } catch (error) {
    log.warn(
      "terminal",
      `could not pre-create scout tmux session; phone will create on connect: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Best-effort LAN-reachable name for this Mac. We advertise `_oscout-pair._tcp`
 * over Bonjour, so the Mac's `<shortname>.local` resolves from the paired phone
 * (and from the iOS Simulator, which shares the host's resolver). The phone
 * prefers the host it already reached the bridge through (e.g. a Tailscale name
 * on a tailnet route), falling back to this `.local` for LAN.
 */
function resolveReachableHost(): string {
  const short = hostname().split(".")[0];
  return `${short}.local`;
}

/**
 * SHA256 fingerprint of the Mac's ed25519 host key, formatted exactly like
 * NIOSSH/Termini computes it (`SHA256:` + unpadded base64 of the digest over the
 * raw key blob). Throws if the public key can't be read so the phone never
 * falls back to trust-on-first-use. ed25519 because that's what NIOSSH negotiates
 * against modern macOS sshd.
 */
function readRequiredHostKeyFingerprint(): string {
  try {
    const pub = readFileSync("/etc/ssh/ssh_host_ed25519_key.pub", "utf8");
    const keyData = pub.trim().split(/\s+/)[1];
    if (!keyData) throw new Error("missing key data");
    const digest = createHash("sha256")
      .update(Buffer.from(keyData, "base64"))
      .digest("base64")
      .replace(/=+$/, "");
    return `SHA256:${digest}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot provision terminal without the Mac SSH ed25519 host-key fingerprint: ${detail}`);
  }
}

function writeAuthorizedKeysAtomically(path: string, contents: string): void {
  const tmpPath = `${path}.scout-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, contents, { mode: 0o600, flag: "wx" });
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

function withAuthorizedKeysLock<T>(sshDir: string, action: () => T): T {
  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  const lockPath = join(sshDir, ".scout-authorized-keys.lock");
  const deadline = Date.now() + 5_000;
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code !== "EEXIST" || Date.now() >= deadline) {
        throw error;
      }
      sleepSync(50);
    }
  }

  const lockFd = fd;
  if (lockFd === null) {
    throw new Error("Failed to acquire authorized_keys lock");
  }
  try {
    return action();
  } finally {
    try {
      closeSync(lockFd);
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

function sleepSync(milliseconds: number): void {
  const array = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(array, 0, 0, milliseconds);
}
