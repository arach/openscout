import { execSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readProjectedRelayMessages } from "../projections/messages.js";
import { readProjectedRelayTwins } from "../projections/twins.js";
import {
  appendRelayEvent,
  appendRelayMessage,
  createRelayEventId,
  getRelayEventsPath,
} from "../store/jsonl-store.js";
import type {
  ProjectTwinInvokeOptions,
  ProjectTwinInvokeResult,
  ProjectTwinRecord,
  ProjectTwinRuntime,
  ProjectTwinRuntimeEntry,
  ProjectTwinStartOptions,
  ProjectTwinStartResult,
  ProjectTwinStopResult,
} from "../protocol/twins.js";

function normalizeTwinRecord(twinName: string, record: Partial<ProjectTwinRecord>): ProjectTwinRecord {
  const projectRoot = record.projectRoot ?? record.cwd ?? "";

  return {
    twinId: record.twinId ?? twinName,
    kind: "project",
    runtime: "tmux-claude",
    protocol: "relay",
    harness: "relay-native",
    sessionAdapter: "tmux",
    agentEngine: "claude",
    project: record.project ?? twinName,
    projectRoot,
    tmuxSession: record.tmuxSession ?? `relay-${twinName}`,
    cwd: record.cwd ?? projectRoot,
    startedAt: record.startedAt ?? Math.floor(Date.now() / 1000),
    systemPrompt: record.systemPrompt,
  };
}

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const OPENSCOUT_REPO_ROOT = resolve(MODULE_DIRECTORY, "..", "..", "..", "..", "..");

function brokerRelayCommand(): string {
  return `bun run --cwd ${JSON.stringify(OPENSCOUT_REPO_ROOT)} packages/relay/src/cli.ts relay`;
}

function buildTwinSystemPrompt(
  hub: string,
  twinName: string,
  projectName: string,
  projectPath: string,
  task?: string,
): string {
  const relayEventsPath = getRelayEventsPath(hub);
  const relayCommand = brokerRelayCommand();

  return [
    `You are "${twinName}", a project twin for the ${projectName} project.`,
    ``,
    `You are the persistent, project-native runtime for this codebase.`,
    `A primary agent may call into you for context, execution, follow-through, and handoff.`,
    ``,
    `You have full access to the codebase at ${projectPath}.`,
    `There is a structured relay event stream at ${relayEventsPath} shared by all agents.`,
    ``,
    `Your job:`,
    `  - Respond to @${twinName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need project-native context`,
    `  - Maintain continuity for ongoing project work`,
    ``,
    `Relay commands:`,
    `  ${relayCommand} send --as ${twinName} "your message"   — send a message`,
    `  ${relayCommand} read                                   — check recent messages`,
    `  ${relayCommand} who                                    — see who's active`,
    ``,
    `Rules:`,
    `  - Always reply via the broker-backed relay command above so other agents see your response`,
    `  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply`,
    `  - Be specific: include file paths, line numbers, what you found`,
    `  - Keep messages under 200 chars unless detailed info was requested`,
    `  - Check relay read for context before responding`,
    task ? `` : undefined,
    task ? `Your primary task: ${task}` : undefined,
  ].filter(Boolean).join("\n");
}

function buildTwinInitialMessage(projectName: string, twinName: string, task?: string): string {
  if (task) {
    return `You are now online as the ${twinName} twin for ${projectName}. Your task: ${task}. Announce yourself on the relay and start working.`;
  }

  return `You are now online as the ${twinName} twin for ${projectName}. Announce yourself on the relay with: ${brokerRelayCommand()} send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
}

function createTwinFlightId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTwinReplyMetadata(body: string, flightId: string, asker: string): string {
  return body
    .replace(new RegExp(`\\[ask:${escapeRegExp(flightId)}\\]`, "g"), "")
    .replace(new RegExp(`@${escapeRegExp(asker)}`, "g"), "")
    .trim();
}

function buildTwinNudge(twinName: string, asker: string, flightId: string): string {
  const relayCommand = brokerRelayCommand();
  return [
    `New relay ask from ${asker}.`,
    `Read it: ${relayCommand} read -n 5 --as ${twinName}.`,
    `Reply with: ${relayCommand} send --as ${twinName} "[ask:${flightId}] @${asker} <your response>"`,
  ].join(" ");
}

function buildTwinTickMessage(twinName: string, reason: string): string {
  const relayCommand = brokerRelayCommand();
  return [
    `Relay tick: ${reason}.`,
    `Check for new work with ${relayCommand} read -n 5 --as ${twinName}.`,
    `Continue any pending project work and respond on relay if needed.`,
  ].join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TmuxClaudeProjectTwinRuntime implements ProjectTwinRuntime {
  constructor(private readonly hub: string) {}

  private get twinDir(): string {
    return join(this.hub, "twins");
  }

  async loadTwins(): Promise<Record<string, ProjectTwinRecord>> {
    const twins = await readProjectedRelayTwins(this.hub);
    return Object.fromEntries(
      Object.entries(twins).map(([name, record]) => [name, normalizeTwinRecord(name, record)]),
    );
  }

  private async isSessionAlive(sessionName: string): Promise<boolean> {
    try {
      execSync(`tmux has-session -t ${sessionName}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  private async sendTwinPrompt(record: ProjectTwinRecord, prompt: string): Promise<boolean> {
    if (!await this.isSessionAlive(record.tmuxSession)) {
      return false;
    }

    execSync(
      `tmux send-keys -t ${JSON.stringify(record.tmuxSession)} ${JSON.stringify(prompt)} Enter`,
      { stdio: "pipe" },
    );
    return true;
  }

  async isTwinAlive(twinName: string): Promise<boolean> {
    const twins = await this.loadTwins();
    const record = twins[twinName];
    if (!record) return false;
    return this.isSessionAlive(record.tmuxSession);
  }

  async startProjectTwin(options: ProjectTwinStartOptions): Promise<ProjectTwinStartResult> {
    const { projectPath, twinName, task } = options;

    const projectStats = await stat(projectPath);
    if (!projectStats.isDirectory()) {
      throw new Error(`not a directory: ${projectPath}`);
    }

    const projectName = basename(projectPath);
    const tmuxSession = `relay-${twinName}`;
    const currentTwins = await this.loadTwins();

    if (await this.isSessionAlive(tmuxSession)) {
      const existing = currentTwins[twinName] ?? normalizeTwinRecord(twinName, {
        project: projectName,
        projectRoot: projectPath,
        cwd: projectPath,
        tmuxSession,
      });

      if (!currentTwins[twinName]) {
        await appendRelayEvent(this.hub, {
          id: createRelayEventId("twin"),
          kind: "project_twin.started",
          v: 1,
          ts: Math.floor(Date.now() / 1000),
          actor: twinName,
          payload: {
            record: existing,
          },
        });
      }

      return {
        status: "already_running",
        record: existing,
      };
    }

    const systemPrompt = buildTwinSystemPrompt(this.hub, twinName, projectName, projectPath, task);
    const initialMessage = buildTwinInitialMessage(projectName, twinName, task);

    await mkdir(this.twinDir, { recursive: true });

    const promptFile = join(this.twinDir, `${twinName}.prompt.txt`);
    const initialFile = join(this.twinDir, `${twinName}.initial.txt`);
    const launchScript = join(this.twinDir, `${twinName}.launch.sh`);

    await writeFile(promptFile, systemPrompt);
    await writeFile(initialFile, initialMessage);
    await writeFile(
      launchScript,
      [
        `#!/bin/bash`,
        `cd ${JSON.stringify(projectPath)}`,
        `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
        `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
      ].join("\n") + "\n",
    );
    execSync(`chmod 755 ${JSON.stringify(launchScript)}`);
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

    const record = normalizeTwinRecord(twinName, {
      project: projectName,
      projectRoot: projectPath,
      cwd: projectPath,
      tmuxSession,
      startedAt: Math.floor(Date.now() / 1000),
      systemPrompt: task || undefined,
    });

    await appendRelayEvent(this.hub, {
      id: createRelayEventId("twin"),
      kind: "project_twin.started",
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      actor: twinName,
      payload: {
        record,
      },
    });
    await appendRelayMessage(this.hub, {
      ts: Math.floor(Date.now() / 1000),
      from: twinName,
      type: "SYS",
      body: `twin spawned for ${projectName}`,
    });

    return {
      status: "started",
      record,
    };
  }

  async invokeProjectTwin(twinName: string, options: ProjectTwinInvokeOptions): Promise<ProjectTwinInvokeResult> {
    const twins = await this.loadTwins();
    const twin = twins[twinName];

    if (!twin || !await this.isSessionAlive(twin.tmuxSession)) {
      throw new Error(`twin "${twinName}" is not running`);
    }

    const flightId = createTwinFlightId();
    const askedAt = Math.floor(Date.now() / 1000);
    const timeoutSeconds = options.timeoutSeconds ?? 300;
    const contextBlock = options.context
      ? `\n\nContext: ${JSON.stringify(options.context, null, 2)}`
      : "";

    await appendRelayMessage(this.hub, {
      ts: askedAt,
      from: options.asker,
      type: "MSG",
      body: `[ask:${flightId}] @${twinName} ${options.task}${contextBlock}`,
      to: [twinName],
    });

    const nudge = buildTwinNudge(twinName, options.asker, flightId);
    await this.sendTwinPrompt(twin, nudge);

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() <= deadline) {
      const messages = await readProjectedRelayMessages(this.hub, { since: askedAt - 1 });

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.type !== "MSG") continue;
        if (message.from !== twinName) continue;
        if (!message.rawBody.includes(`[ask:${flightId}]`)) continue;

        return {
          twin,
          flightId,
          response: stripTwinReplyMetadata(message.rawBody, flightId, options.asker),
          respondedAt: message.timestamp,
        };
      }

      await sleep(500);
    }

    throw new Error(`timed out after ${timeoutSeconds}s waiting for ${twinName}`);
  }

  async tickProjectTwin(twinName: string, reason: string): Promise<boolean> {
    const twins = await this.loadTwins();
    const twin = twins[twinName];
    if (!twin) return false;

    return this.sendTwinPrompt(twin, buildTwinTickMessage(twinName, reason));
  }

  async stopProjectTwin(twinName: string): Promise<ProjectTwinStopResult> {
    const twins = await this.loadTwins();
    const record = twins[twinName];

    if (!record) {
      return {
        status: "not_found",
        twinName,
      };
    }

    let status: ProjectTwinStopResult["status"] = "stopped";
    try {
      execSync(`tmux kill-session -t ${record.tmuxSession} 2>/dev/null`);
    } catch {
      status = "already_stopped";
    }

    await appendRelayEvent(this.hub, {
      id: createRelayEventId("twin"),
      kind: "project_twin.stopped",
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      actor: twinName,
      payload: {
        twinId: twinName,
      },
    });
    await appendRelayMessage(this.hub, {
      ts: Math.floor(Date.now() / 1000),
      from: twinName,
      type: "SYS",
      body: "twin stopped",
    });

    return {
      status,
      twinName,
      record,
    };
  }

  async stopAllProjectTwins(): Promise<ProjectTwinStopResult[]> {
    const twins = await this.loadTwins();
    const names = Object.keys(twins);
    const results: ProjectTwinStopResult[] = [];

    for (const twinName of names) {
      const record = twins[twinName];
      let status: ProjectTwinStopResult["status"] = "stopped";
      try {
        execSync(`tmux kill-session -t ${record.tmuxSession} 2>/dev/null`);
      } catch {
        status = "already_stopped";
      }

      results.push({
        status,
        twinName,
        record,
      });

      await appendRelayEvent(this.hub, {
        id: createRelayEventId("twin"),
        kind: "project_twin.stopped",
        v: 1,
        ts: Math.floor(Date.now() / 1000),
        actor: twinName,
        payload: {
          twinId: twinName,
        },
      });
    }

    if (results.length > 0) {
      await appendRelayMessage(this.hub, {
        ts: Math.floor(Date.now() / 1000),
        from: "system",
        type: "SYS",
        body: "all twins stopped",
      });
    }

    return results;
  }

  async listProjectTwins(): Promise<ProjectTwinRuntimeEntry[]> {
    const twins = await this.loadTwins();
    const now = Math.floor(Date.now() / 1000);

    return Promise.all(
      Object.entries(twins).map(async ([_, record]) => ({
        ...record,
        alive: await this.isSessionAlive(record.tmuxSession),
        uptimeSeconds: now - record.startedAt,
      })),
    );
  }

  async cleanupDeadTwins(): Promise<string[]> {
    const twins = await this.loadTwins();
    const removed: string[] = [];

    for (const [twinName, record] of Object.entries(twins)) {
      if (!await this.isSessionAlive(record.tmuxSession)) {
        removed.push(twinName);
        await appendRelayEvent(this.hub, {
          id: createRelayEventId("twin"),
          kind: "project_twin.stopped",
          v: 1,
          ts: Math.floor(Date.now() / 1000),
          actor: twinName,
          payload: {
            twinId: twinName,
          },
        });
      }
    }

    return removed;
  }
}

export function createTmuxClaudeProjectTwinRuntime(hub: string): ProjectTwinRuntime {
  return new TmuxClaudeProjectTwinRuntime(hub);
}
