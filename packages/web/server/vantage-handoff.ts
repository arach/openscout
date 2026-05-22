import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildScoutVantagePlan,
  type ScoutVantagePlan,
  type ScoutVantageNativeSession,
  type TmuxSession,
} from "@openscout/runtime/vantage-plan";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { loadScoutBrokerContext } from "./core/broker/service.ts";

const execFileAsync = promisify(execFile);
const VANTAGE_BROKER_CONTEXT_TIMEOUT_MS = 2_000;

export type OpenScoutVantageHandoffInput = {
  currentDirectory: string;
  agentId?: string | null;
  agentIds?: readonly string[];
  nativeSessionIds?: readonly string[];
  nativeSessions?: readonly ScoutVantageNativeSession[];
  launch?: boolean;
  now?: Date;
  broker?: Awaited<ReturnType<typeof loadScoutBrokerContext>>;
  tmuxSessions?: readonly TmuxSession[];
};

export type OpenScoutVantageHandoff = {
  ok: true;
  schema: "openscout.vantage.handoff.v1";
  handoffId: string;
  handoffPath: string;
  setupPath: string;
  openUrl: string;
  plan: ScoutVantagePlan;
  launch: {
    attempted: boolean;
    ok: boolean;
    error: string | null;
  };
};

export async function createOpenScoutVantageHandoff(
  input: OpenScoutVantageHandoffInput,
): Promise<OpenScoutVantageHandoff> {
  const broker = input.broker === undefined
    ? await loadVantageBrokerContext()
    : input.broker;
  const nativeSessions = [...(input.nativeSessions ?? [])];
  if (input.tmuxSessions === undefined) {
    ensureNativeTailTmuxSessions(nativeSessions);
  }
  const tmuxSessions = input.tmuxSessions ?? readTmuxSessions();
  const selectedAgentIds = uniqueIds(input.agentIds ?? []);
  const selectedNativeSessionIds = uniqueIds(
    input.nativeSessionIds ?? nativeSessions.map((session) => session.id),
  );
  const focusAgentId = input.agentId?.trim() || selectedAgentIds[0] || null;
  const focusNativeSessionId = focusAgentId ? null : selectedNativeSessionIds[0] || null;
  const plan = buildScoutVantagePlan({
    currentDirectory: input.currentDirectory,
    broker,
    tmuxSessions,
    nativeSessions,
    focusAgentId,
    focusNativeSessionId,
    selectedAgentIds,
    selectedNativeSessionIds,
    now: input.now,
  });
  const handoffId = `handoff-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { handoffPath, setupPath } = writeVantageHandoffFiles({
    handoffId,
    plan,
    source: "scout-web",
  });
  const openUrl = buildVantageOpenUrl({ handoffId, handoffPath });
  const emptyPlanError = plan.manifest.nodes.length === 0
    ? emptyVantagePlanMessage(plan)
    : null;
  const launch = input.launch === false
    ? { attempted: false, ok: false, error: null }
    : emptyPlanError
      ? { attempted: false, ok: false, error: emptyPlanError }
      : await launchVantageOpenUrl(openUrl, {
        handoffId,
        setupPath,
        currentDirectory: input.currentDirectory,
      });

  return {
    ok: true,
    schema: "openscout.vantage.handoff.v1",
    handoffId,
    handoffPath,
    setupPath,
    openUrl,
    plan,
    launch,
  };
}

async function loadVantageBrokerContext(): Promise<Awaited<ReturnType<typeof loadScoutBrokerContext>> | null> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    timeout = setTimeout(() => {
      controller.abort(new Error("Vantage broker context probe timed out."));
    }, VANTAGE_BROKER_CONTEXT_TIMEOUT_MS);
    return await loadScoutBrokerContext(undefined, { signal: controller.signal }).catch(() => null);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function emptyVantagePlanMessage(plan: ScoutVantagePlan): string {
  const selectedAgentCount = plan.manifest.selectedAgentIds?.length ?? 0;
  const selectedNativeCount = plan.manifest.selectedNativeSessionIds?.length ?? 0;
  const selectionCount = selectedAgentCount + selectedNativeCount;
  const diagnostic = plan.diagnostics.find((candidate) => candidate.severity === "warning")
    ?? plan.diagnostics[0];
  const reason = diagnostic ? ` ${diagnostic.message}` : "";
  if (selectionCount > 0) {
    return `No Vantage windows matched the selected Scout surface${selectionCount === 1 ? "" : "s"}.${reason}`;
  }
  return `No Vantage windows could be built from the current Scout state.${reason}`;
}

function readTmuxSessions(): TmuxSession[] {
  try {
    const stdout = execFileSync("tmux", ["ls", "-F", "#{session_name}\t#{session_created}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, createdAtRaw] = line.split("\t");
        return {
          name,
          createdAt: createdAtRaw ? Number.parseInt(createdAtRaw, 10) : null,
        };
      });
  } catch {
    return [];
  }
}

function ensureNativeTailTmuxSessions(nativeSessions: readonly ScoutVantageNativeSession[]): void {
  for (const nativeSession of nativeSessions) {
    if (!nativeSession.tmuxSessionName || !nativeSession.transcriptPath) {
      continue;
    }
    if (tmuxSessionExists(nativeSession.tmuxSessionName)) {
      continue;
    }
    createNativeTailTmuxSession(nativeSession);
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function createNativeTailTmuxSession(nativeSession: ScoutVantageNativeSession): void {
  try {
    const args = [
      "new-session",
      "-d",
      "-s",
      nativeSession.tmuxSessionName,
      "-n",
      "tail",
    ];
    if (nativeSession.cwd && existsSync(nativeSession.cwd)) {
      args.push("-c", nativeSession.cwd);
    }
    args.push(nativeTailCommand(nativeSession));
    execFileSync("tmux", args, {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // The planner will diagnose the missing tmux session if creation failed.
  }
}

function nativeTailCommand(nativeSession: ScoutVantageNativeSession): string {
  const title = `${nativeSession.source} ${nativeSession.sessionId ?? nativeSession.id}`;
  return [
    `printf 'Scout Vantage tail: %s\\n' ${shellQuote(title)}`,
    `printf 'Transcript: %s\\n\\n' ${shellQuote(nativeSession.transcriptPath)}`,
    `tail -n 200 -F ${shellQuote(nativeSession.transcriptPath)}`,
  ].join("; ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeVantageHandoffFiles(input: {
  handoffId: string;
  plan: ScoutVantagePlan;
  source: "scout-web";
}): { handoffPath: string; setupPath: string } {
  const handoffDirectory = join(resolveOpenScoutSupportPaths().supportDirectory, "vantage", "handoffs");
  mkdirSync(handoffDirectory, { recursive: true });
  const handoffPath = join(handoffDirectory, `${input.handoffId}.json`);
  const setupPath = join(handoffDirectory, `${input.handoffId}.setup.json`);
  stampVantageManifest(input.plan, {
    handoffId: input.handoffId,
    handoffPath,
    setupPath,
  });
  writeFileSync(
    handoffPath,
    `${JSON.stringify({
      kind: "openscout.vantage.handoff",
      schemaVersion: 1,
      handoffId: input.handoffId,
      source: input.source,
      createdAt: input.plan.createdAt,
      currentDirectory: input.plan.currentDirectory,
      focus: input.plan.manifest.focus,
      manifest: input.plan.manifest,
      diagnostics: input.plan.diagnostics,
      plan: input.plan,
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(setupPath, `${JSON.stringify(input.plan.manifest, null, 2)}\n`, "utf8");
  return { handoffPath, setupPath };
}

function stampVantageManifest(
  plan: ScoutVantagePlan,
  input: { handoffId: string; handoffPath: string; setupPath: string },
): void {
  const shortId = input.handoffId.replace(/^handoff-/, "").slice(0, 18);
  const nodeCount = plan.manifest.nodes.length;
  const selectedAgentCount = plan.manifest.selectedAgentIds?.length ?? 0;
  const selectedNativeCount = plan.manifest.selectedNativeSessionIds?.length ?? 0;
  const selectionCount = selectedAgentCount + selectedNativeCount;
  const selectionLabel = selectionCount > 0
    ? `${selectionCount} selected surface${selectionCount === 1 ? "" : "s"}`
    : "all attachable surfaces";
  const nodeLabel = `${nodeCount} node${nodeCount === 1 ? "" : "s"}`;
  const linkLabel = `${plan.manifest.workspaceID} · ${shortId}`;

  plan.manifest.handoffId = input.handoffId;
  plan.manifest.handoffPath = input.handoffPath;
  plan.manifest.setupPath = input.setupPath;
  plan.manifest.presentation = {
    ...(plan.manifest.presentation ?? {}),
    title: plan.manifest.presentation?.title ?? "Scout Vantage",
    subtitle: `${linkLabel} · ${nodeLabel} · ${selectionLabel}`,
    badge: nodeCount > 0 ? `handoff ${shortId}` : "no nodes",
    cobrand: "OpenScout",
    productName: "Scout",
    hostName: "Hudson Vantage",
    theme: plan.manifest.presentation?.theme ?? "jade",
    accent: plan.manifest.presentation?.accent ?? "cyan",
  };
}

function buildVantageOpenUrl(input: { handoffId: string; handoffPath: string }): string {
  const params = new URLSearchParams({
    id: input.handoffId,
    handoff: input.handoffPath,
  });
  return `openscout-vantage://handoff?${params.toString()}`;
}

async function launchVantageOpenUrl(
  openUrl: string,
  input: { handoffId: string; setupPath: string; currentDirectory: string },
): Promise<OpenScoutVantageHandoff["launch"]> {
  if (process.platform !== "darwin") {
    return {
      attempted: false,
      ok: false,
      error: "Native Vantage launch is only supported on macOS.",
    };
  }

  try {
    await execFileAsync("/usr/bin/open", [openUrl]);
    return { attempted: true, ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingUrlHandlerError(message)) {
      const fallback = launchHudsonTerminiCanvas(input);
      if (fallback.ok) {
        return { attempted: true, ok: true, error: null };
      }
      return {
        attempted: true,
        ok: false,
        error: fallback.error,
      };
    }
    return {
      attempted: true,
      ok: false,
      error: message,
    };
  }
}

function isMissingUrlHandlerError(message: string): boolean {
  return message.includes("kLSApplicationNotFoundErr")
    || message.includes("No application knows how to open URL");
}

function launchHudsonTerminiCanvas(input: {
  handoffId: string;
  setupPath: string;
  currentDirectory: string;
}): { ok: true } | { ok: false; error: string } {
  const packagePath = findHudsonTerminiCanvasPackage(input.currentDirectory);
  if (!packagePath) {
    return {
      ok: false,
      error: "OpenScout Vantage is not installed, and no sibling Hudson TerminiCanvas package was found.",
    };
  }

  try {
    execFileSync("/usr/bin/xcrun", ["--find", "swift"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return {
      ok: false,
      error: "OpenScout Vantage is not installed, and the Swift toolchain was not found for the Hudson Vantage fallback.",
    };
  }

  try {
    if (isHudsonTerminiCanvasRunning()) {
      queueHudsonTerminiCanvasSetup(input);
      return { ok: true };
    }
    const statePath = join(dirname(input.setupPath), `${input.handoffId}.state.json`);
    const child = spawn(
      "/usr/bin/xcrun",
      ["swift", "run", "--package-path", packagePath, "TerminiCanvas"],
      {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          HUDSON_VANTAGE_SETUP_FILE: input.setupPath,
          HUDSON_VANTAGE_STATE_FILE: statePath,
          HUDSON_VANTAGE_RESTORE_ON_LAUNCH: "0",
        },
      },
    );
    child.unref();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `OpenScout Vantage is not installed, and Hudson Vantage fallback launch failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function queueHudsonTerminiCanvasSetup(input: { handoffId: string; setupPath: string }): void {
  const controlPath = process.env.TERMINI_CANVAS_CONTROL_FILE
    || "/tmp/termini-canvas-control.jsonl";
  const command = {
    apiVersion: "v0",
    kind: "hudson.vantage.command",
    id: `openscout-${input.handoffId}`,
    action: "setup",
    manifestPath: input.setupPath,
    createIfMissing: true,
    removeMissing: true,
    fit: true,
    includeViewport: true,
    includeMetrics: true,
    includeStyle: true,
  };
  appendFileSync(controlPath, `${JSON.stringify(command)}\n`, "utf8");
}

function isHudsonTerminiCanvasRunning(): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-f", "[T]erminiCanvas"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function findHudsonTerminiCanvasPackage(currentDirectory: string): string | null {
  const candidates = [
    resolve(currentDirectory, "../hudson/examples/termini-canvas"),
    resolve(currentDirectory, "../Hudson/examples/termini-canvas"),
    "/Users/arach/dev/hudson/examples/termini-canvas",
    "/Users/arach/dev/Hudson/examples/termini-canvas",
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "Package.swift"))) {
      return candidate;
    }
  }
  return null;
}
