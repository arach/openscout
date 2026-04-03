#!/usr/bin/env bun

import { dispatchPaths, loadDispatchConfig, resolvedDispatchConfig } from "./config";
import { bytesToHex, loadOrCreateIdentity, trustedPeerCount } from "./security";

const [, , command = "help"] = process.argv;

switch (command) {
  case "start":
    await start();
    break;
  case "supervise":
    await (await import("./supervisor")).runDispatchSupervisor();
    break;
  case "pair":
    await (await import("./pair")).runPairMode();
    break;
  case "relay":
    await startRelayOnly();
    break;
  case "config":
    printConfig();
    break;
  case "status":
    printStatus();
    break;
  case "help":
  case "--help":
  case "-h":
  default:
    printHelp();
    break;
}

function printHelp() {
  console.log(`dispatch

Usage:
  bun dispatch/cli/src/main.ts start
  bun dispatch/cli/src/main.ts supervise
  bun dispatch/cli/src/main.ts pair
  bun dispatch/cli/src/main.ts relay
  bun dispatch/cli/src/main.ts config
  bun dispatch/cli/src/main.ts status
`);
}

function printConfig() {
  console.log(JSON.stringify(loadDispatchConfig(), null, 2));
}

function printStatus() {
  const config = resolvedDispatchConfig();
  const paths = dispatchPaths();
  const identity = loadOrCreateIdentity();
  console.log(JSON.stringify({
    relay: config.relay,
    secure: config.secure,
    port: config.port,
    workspaceRoot: config.workspaceRoot,
    sessionCount: config.sessions.length,
    identityFingerprint: bytesToHex(identity.publicKey).slice(0, 16),
    trustedPeerCount: trustedPeerCount(),
    paths,
  }, null, 2));
}

async function start() {
  const config = resolvedDispatchConfig();
  const relayPort = config.port + 1;
  const { startManagedRelay } = await import("./relay-runtime");
  const { runPairMode } = await import("./pair");
  let relay;
  try {
    relay = startManagedRelay(relayPort);
  } catch (error) {
    console.error(formatDispatchStartError(error, relayPort));
    process.exit(1);
  }

  const shutdown = () => {
    relay.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await runPairMode({
      relayUrl: relay.relayUrl,
      onShutdown() {
        relay.stop();
      },
    });
  } catch (error) {
    console.error(formatDispatchStartError(error, relayPort));
    relay.stop();
    process.exit(1);
  }
}

async function startRelayOnly() {
  const config = resolvedDispatchConfig();
  const relayPort = config.port + 1;
  const { startManagedRelay } = await import("./relay-runtime");
  let relay;
  try {
    relay = startManagedRelay(relayPort);
  } catch (error) {
    console.error(formatDispatchStartError(error, relayPort));
    process.exit(1);
  }

  const shutdown = () => {
    relay.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function formatDispatchStartError(error: unknown, relayPort: number) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE|address already in use/i.test(detail)) {
    return `Dispatch could not start because port ${relayPort} is already in use. Stop the other Dispatch process and try again.`;
  }
  return detail;
}
