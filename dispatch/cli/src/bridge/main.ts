#!/usr/bin/env bun
// Bridge entry point.
//
// Usage:
//   bun run bridge                                # defaults: port 7888, plaintext
//   bun run bridge -- --port 9000                 # custom port
//   bun run bridge -- --secure                    # enable Noise encryption on local WS
//   bun run bridge -- --relay ws://relay:7889     # connect outbound to relay
//   bun run bridge -- --pair                      # show QR code and wait for pairing
//   bun run bridge -- --relay ws://r:7889 --pair  # pair-only mode via relay
//
// Config file (~/.dispatch/config.json) is loaded first, CLI flags override.

import { Bridge } from "./bridge.ts";
import { startBridgeServer } from "./server.ts";
import { startFileServer, type FileServer } from "./fileserver.ts";
import { connectToRelay } from "./relay-client.ts";
import { resolveConfig, CONFIG_FILE } from "./config.ts";
import type { AdapterEntry } from "./config.ts";
import { printQRCode } from "./qr.ts";
import { createAdapter as createClaudeCode } from "../adapters/claude-code.ts";
import { createAdapter as createOpenAI } from "../adapters/openai-compat.ts";
import { createAdapter as createCodex } from "../adapters/codex.ts";
import { createAdapter as createPi } from "../adapters/pi.ts";
import { createAdapter as createOpenCode } from "../adapters/opencode.ts";
import { loadOrCreateIdentity, bytesToHex } from "../security/index.ts";
import { log } from "./log.ts";
import { homedir } from "os";
import type { AdapterFactory } from "../protocol/index.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = resolveConfig();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const identity = loadOrCreateIdentity();

// ---------------------------------------------------------------------------
// Adapter registry — hardcoded + config-driven
// ---------------------------------------------------------------------------

const adapters: Record<string, AdapterFactory> = {
  "claude-code": createClaudeCode,
  "codex": createCodex,
  "pi": createPi,
  "opencode": createOpenCode,
  "openai": createOpenAI,
};

// Auto-register adapters from config file.
// Config adapters map a name to { type, options }. The type must reference
// an existing built-in adapter (we use it as a factory with pre-baked options).
if (config.adapters) {
  for (const [name, entry] of Object.entries(config.adapters)) {
    registerConfigAdapter(name, entry);
  }
}

function registerConfigAdapter(name: string, entry: AdapterEntry): void {
  const baseFactory = adapters[entry.type];
  if (!baseFactory) {
    console.warn(`[bridge] config adapter "${name}" references unknown type "${entry.type}" — skipped`);
    return;
  }

  // Create a factory that merges the config-level options as defaults,
  // with per-session options overlaid on top.
  adapters[name] = (adapterConfig) => {
    const merged = {
      ...adapterConfig,
      options: { ...entry.options, ...adapterConfig.options },
    };
    return baseFactory(merged);
  };
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const bridge = new Bridge({
  port: config.port,
  adapters,
});

// ---------------------------------------------------------------------------
// Local WebSocket server (always runs)
// ---------------------------------------------------------------------------

const server = startBridgeServer(bridge, config.port, {
  secure: config.secure,
  identity: config.secure ? identity : undefined,
});

// ---------------------------------------------------------------------------
// Outbound relay connection (optional)
// ---------------------------------------------------------------------------

let relayConnection: ReturnType<typeof connectToRelay> | null = null;

if (config.relay) {
  relayConnection = connectToRelay(config.relay, identity, bridge, {
    secure: true, // Relay connections are always encrypted.
  });

  // Show the QR code prominently in the terminal.
  printQRCode(relayConnection.qrPayload);
}

// ---------------------------------------------------------------------------
// File server (independent HTTP — survives independently of bridge/relay)
// ---------------------------------------------------------------------------

const fileServer = startFileServer({ port: config.port + 2 });

// ---------------------------------------------------------------------------
// Pair-only mode: if --pair is set without --relay, we can't pair (need relay).
// If --pair + --relay, we've already shown the QR — just keep the process alive.
// ---------------------------------------------------------------------------

if (config.pair && !config.relay) {
  console.error("[bridge] --pair requires --relay <url> to generate a QR code");
  process.exit(1);
}

if (config.pair) {
  console.log("[bridge] pair mode — waiting for phone to scan QR code...");
  console.log("[bridge] press Ctrl+C to exit");
} else {
  printBanner();
}

// ---------------------------------------------------------------------------
// Auto-start sessions from config
// ---------------------------------------------------------------------------

if (config.sessions?.length) {
  console.log(`[bridge] auto-starting ${config.sessions.length} session(s)...`);
  for (const entry of config.sessions) {
    bridge.createSession(entry.adapter, {
      name: entry.name,
      cwd: entry.cwd?.replace(/^~/, homedir()),
      options: entry.options,
    }).then((session) => {
      console.log(`[bridge] session started: ${session.name} (${entry.adapter})`);
    }).catch((err) => {
      console.error(`[bridge] failed to start session "${entry.name}": ${err.message}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

function printBanner(): void {
  const idHex = bytesToHex(identity.publicKey).slice(0, 16);
  const mode = config.relay ? "local + relay" : "local";
  const encryption = config.secure ? "Noise (local)" : "plaintext (local)";
  const adapterNames = Object.keys(adapters);

  console.log("");
  console.log("  dispatch bridge");
  console.log("  ─────────────────────────────────");
  console.log(`  identity : ${idHex}...`);
  console.log(`  port     : ${config.port}`);
  console.log(`  mode     : ${mode}`);
  console.log(`  encrypt  : ${encryption}${config.relay ? " + Noise (relay)" : ""}`);
  console.log(`  adapters : ${adapterNames.join(", ")}`);
  console.log(`  files    : http://localhost:${config.port + 2}/`);
  console.log(`  log      : ${log.path}`);
  if (config.relay) {
    console.log(`  relay    : ${config.relay}`);
  }
  console.log("  ─────────────────────────────────");
  console.log("");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  console.log("\n[bridge] shutting down...");
  fileServer.stop();
  relayConnection?.disconnect();
  await bridge.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
