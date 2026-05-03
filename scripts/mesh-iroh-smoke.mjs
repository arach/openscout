#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bridgeManifest = resolve(repoRoot, "crates/openscout-iroh-bridge/Cargo.toml");
const bridgeBin = resolve(repoRoot, "crates/openscout-iroh-bridge/target/debug/openscout-iroh-bridge");
const runtimeBin = resolve(repoRoot, "packages/runtime/bin/openscout-runtime.mjs");
const defaultBrokerUrl = process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:65501";

const [, , command, ...args] = process.argv;

function usage(exitCode = 0) {
  console.log(`OpenScout Mesh Iroh smoke helper

Usage:
  bun scripts/mesh-iroh-smoke.mjs build-bridge
  bun scripts/mesh-iroh-smoke.mjs run-broker [-- broker args...]
  bun scripts/mesh-iroh-smoke.mjs inspect [--broker-url URL]
  bun scripts/mesh-iroh-smoke.mjs export-node [--broker-url URL] [--out FILE]
  bun scripts/mesh-iroh-smoke.mjs import-node --file FILE [--broker-url URL]

Two-machine loop before Cloudflare:
  1. On both machines: bun scripts/mesh-iroh-smoke.mjs build-bridge
  2. On both machines: bun scripts/mesh-iroh-smoke.mjs run-broker
  3. On both machines: bun scripts/mesh-iroh-smoke.mjs export-node --out node.json
  4. Copy each node.json to the other machine.
  5. On each machine: bun scripts/mesh-iroh-smoke.mjs import-node --file peer-node.json
  6. Run inspect on both machines and verify both nodes have iroh entrypoints.
`);
  process.exit(exitCode);
}

function parseOptions(argv) {
  const options = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (value?.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        options[key] = "true";
      } else {
        options[key] = next;
        index += 1;
      }
    } else {
      rest.push(value);
    }
  }
  return { options, rest };
}

function run(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: repoRoot,
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
    encoding: options.encoding,
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`);
  }
  return await response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`POST ${url} failed: ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`);
  }
  return await response.json();
}

function brokerUrlFrom(options) {
  return (options["broker-url"] ?? defaultBrokerUrl).replace(/\/$/, "");
}

function irohEntrypoints(node) {
  return (node.meshEntrypoints ?? []).filter((entrypoint) => entrypoint.kind === "iroh");
}

function summarizeNode(node) {
  const iroh = irohEntrypoints(node);
  const routes = [];
  if (node.brokerUrl) routes.push(`http=${node.brokerUrl}`);
  if (iroh.length > 0) routes.push(`iroh=${iroh.map((entrypoint) => entrypoint.endpointId).join(",")}`);
  return `${node.name} (${node.id}) [${routes.join(" ") || "no entrypoints"}]`;
}

async function buildBridge() {
  const cargo = process.env.CARGO ?? `${process.env.HOME ?? ""}/.cargo/bin/cargo`;
  run(cargo, ["build", "--manifest-path", bridgeManifest]);
  console.log("");
  console.log(`Bridge binary: ${bridgeBin}`);
  console.log(`Run broker env: OPENSCOUT_IROH_BRIDGE_BIN=${bridgeBin}`);
}

function runBroker(rest) {
  if (!existsSync(bridgeBin)) {
    console.error(`Missing bridge binary: ${bridgeBin}`);
    console.error("Run: bun scripts/mesh-iroh-smoke.mjs build-bridge");
    process.exit(1);
  }

  const env = {
    ...process.env,
    OPENSCOUT_IROH_BRIDGE_BIN: process.env.OPENSCOUT_IROH_BRIDGE_BIN ?? bridgeBin,
  };
  console.log(`OPENSCOUT_IROH_BRIDGE_BIN=${env.OPENSCOUT_IROH_BRIDGE_BIN}`);
  run(process.execPath, [runtimeBin, "broker", ...rest], { env });
}

async function inspect(options) {
  const brokerUrl = brokerUrlFrom(options);
  const health = await getJson(`${brokerUrl}/health`);
  const localNode = await getJson(`${brokerUrl}/v1/node`);
  const nodes = await getJson(`${brokerUrl}/v1/mesh/nodes`);

  console.log(`Broker: ${brokerUrl}`);
  console.log(`Node:   ${health.nodeId}`);
  console.log(`Mesh:   ${health.meshId}`);
  console.log("");
  console.log(`Local:  ${summarizeNode(localNode)}`);
  if (irohEntrypoints(localNode).length === 0) {
    console.log("Warning: local node has no Iroh entrypoint. Check OPENSCOUT_IROH_BRIDGE_BIN and bridge startup logs.");
  }
  console.log("");
  console.log("Known nodes:");
  for (const node of Object.values(nodes)) {
    console.log(`- ${summarizeNode(node)}`);
  }
}

async function exportNode(options) {
  const brokerUrl = brokerUrlFrom(options);
  const node = await getJson(`${brokerUrl}/v1/node`);
  const payload = `${JSON.stringify(node, null, 2)}\n`;
  if (options.out) {
    writeFileSync(resolve(process.cwd(), options.out), payload);
    console.log(`Wrote ${options.out}`);
  } else {
    process.stdout.write(payload);
  }
  if (irohEntrypoints(node).length === 0) {
    console.error("Warning: exported node has no Iroh entrypoint.");
  }
}

async function importNode(options) {
  if (!options.file) {
    throw new Error("import-node requires --file FILE");
  }
  const brokerUrl = brokerUrlFrom(options);
  const node = JSON.parse(readFileSync(resolve(process.cwd(), options.file), "utf8"));
  const result = await postJson(`${brokerUrl}/v1/nodes`, node);
  console.log(`Imported ${node.name} (${result.nodeId ?? node.id}) into ${brokerUrl}`);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    usage(0);
  }

  const { options, rest } = parseOptions(args);
  switch (command) {
    case "build-bridge":
      await buildBridge();
      break;
    case "run-broker":
      runBroker(rest);
      break;
    case "inspect":
      await inspect(options);
      break;
    case "export-node":
      await exportNode(options);
      break;
    case "import-node":
      await importNode(options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
