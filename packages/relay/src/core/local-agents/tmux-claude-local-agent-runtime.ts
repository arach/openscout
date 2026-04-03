import { execSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hasTmuxSessionSync, killTmuxSessionSync } from "../compat/tmux-sessions.js";
import { readProjectedRelayMessages } from "../projections/messages.js";
import { readProjectedRelayLocalAgents } from "../projections/local-agents.js";
import {
  appendRelayEvent,
  appendRelayMessage,
  createRelayEventId,
  getRelayEventsPath,
} from "../store/jsonl-store.js";
import type {
  LocalAgentInvokeOptions,
  LocalAgentInvokeResult,
  LocalAgentRecord,
  LocalAgentRuntime,
  LocalAgentRuntimeEntry,
  LocalAgentStartOptions,
  LocalAgentStartResult,
  LocalAgentStopResult,
} from "../protocol/local-agents.js";
import { sendTmuxPrompt } from "@openscout/runtime/local-agents";

function normalizeLocalAgentRecord(agentName: string, record: Partial<LocalAgentRecord>): LocalAgentRecord {
  const projectRoot = record.projectRoot ?? record.cwd ?? "";

  return {
    agentId: record.agentId ?? agentName,
    kind: "project",
    runtime: "tmux-claude",
    protocol: "relay",
    harness: "relay-native",
    sessionAdapter: "tmux",
    agentEngine: "claude",
    project: record.project ?? agentName,
    projectRoot,
    tmuxSession: record.tmuxSession ?? `relay-${agentName}`,
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

function buildLocalAgentSystemPrompt(
  hub: string,
  agentName: string,
  projectName: string,
  projectPath: string,
  task?: string,
): string {
  const relayEventsPath = getRelayEventsPath(hub);
  const relayCommand = brokerRelayCommand();

  return [
    `You are "${agentName}", a local agent for the ${projectName} project.`,
    ``,
    `You are the persistent, project-native runtime for this codebase.`,
    `A primary agent may call into you for context, execution, follow-through, and handoff.`,
    ``,
    `You have full access to the codebase at ${projectPath}.`,
    `There is a structured relay event stream at ${relayEventsPath} shared by all agents.`,
    ``,
    `Your job:`,
    `  - Respond to @${agentName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need project-native context`,
    `  - Maintain continuity for ongoing project work`,
    ``,
    `Relay commands:`,
    `  ${relayCommand} send --as ${agentName} "your message"   — send a message`,
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

function buildLocalAgentInitialMessage(projectName: string, agentName: string, task?: string): string {
  if (task) {
    return `You are now online as the ${agentName} local agent for ${projectName}. Your task: ${task}. Announce yourself on the relay and start working.`;
  }

  return `You are now online as the ${agentName} local agent for ${projectName}. Announce yourself on the relay with: ${brokerRelayCommand()} send --as ${agentName} "local agent online — ready to assist with ${projectName}"`;
}

function createLocalAgentFlightId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLocalAgentReplyMetadata(body: string, flightId: string, asker: string): string {
  return body
    .replace(new RegExp(`\\[ask:${escapeRegExp(flightId)}\\]`, "g"), "")
    .replace(new RegExp(`@${escapeRegExp(asker)}`, "g"), "")
    .trim();
}

function buildLocalAgentNudge(agentName: string, asker: string, flightId: string): string {
  const relayCommand = brokerRelayCommand();
  return [
    `New relay ask from ${asker}.`,
    `Read it: ${relayCommand} read -n 5 --as ${agentName}.`,
    `Reply with: ${relayCommand} send --as ${agentName} "[ask:${flightId}] @${asker} <your response>"`,
  ].join(" ");
}

function buildLocalAgentTickMessage(agentName: string, reason: string): string {
  const relayCommand = brokerRelayCommand();
  return [
    `Relay tick: ${reason}.`,
    `Check for new work with ${relayCommand} read -n 5 --as ${agentName}.`,
    `Continue any pending project work and respond on relay if needed.`,
  ].join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TmuxClaudeLocalAgentRuntime implements LocalAgentRuntime {
  constructor(private readonly hub: string) {}

  private get localAgentDirectory(): string {
    return join(this.hub, "agents");
  }

  async loadLocalAgents(): Promise<Record<string, LocalAgentRecord>> {
    const localAgents = await readProjectedRelayLocalAgents(this.hub);
    return Object.fromEntries(
      Object.entries(localAgents).map(([name, record]) => [name, normalizeLocalAgentRecord(name, record)]),
    );
  }

  private async isSessionAlive(sessionName: string): Promise<boolean> {
    return hasTmuxSessionSync(sessionName);
  }

  private async sendLocalAgentPrompt(record: LocalAgentRecord, prompt: string): Promise<boolean> {
    if (!await this.isSessionAlive(record.tmuxSession)) {
      return false;
    }

    sendTmuxPrompt(record.tmuxSession, prompt);
    return true;
  }

  async isLocalAgentAlive(agentName: string): Promise<boolean> {
    const localAgents = await this.loadLocalAgents();
    const record = localAgents[agentName];
    if (!record) return false;
    return this.isSessionAlive(record.tmuxSession);
  }

  async startLocalAgent(options: LocalAgentStartOptions): Promise<LocalAgentStartResult> {
    const { projectPath, agentName, task } = options;

    const projectStats = await stat(projectPath);
    if (!projectStats.isDirectory()) {
      throw new Error(`not a directory: ${projectPath}`);
    }

    const projectName = basename(projectPath);
    const tmuxSession = `relay-${agentName}`;
    const currentLocalAgents = await this.loadLocalAgents();

    if (await this.isSessionAlive(tmuxSession)) {
      const existing = currentLocalAgents[agentName] ?? normalizeLocalAgentRecord(agentName, {
        project: projectName,
        projectRoot: projectPath,
        cwd: projectPath,
        tmuxSession,
      });

      if (!currentLocalAgents[agentName]) {
        await appendRelayEvent(this.hub, {
          id: createRelayEventId("agent"),
          kind: "local_agent.started",
          v: 1,
          ts: Math.floor(Date.now() / 1000),
          actor: agentName,
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

    const systemPrompt = buildLocalAgentSystemPrompt(this.hub, agentName, projectName, projectPath, task);
    const initialMessage = buildLocalAgentInitialMessage(projectName, agentName, task);

    await mkdir(this.localAgentDirectory, { recursive: true });

    const promptFile = join(this.localAgentDirectory, `${agentName}.prompt.txt`);
    const initialFile = join(this.localAgentDirectory, `${agentName}.initial.txt`);
    const launchScript = join(this.localAgentDirectory, `${agentName}.launch.sh`);

    await writeFile(promptFile, systemPrompt);
    await writeFile(initialFile, initialMessage);
    await writeFile(
      launchScript,
      [
        `#!/bin/bash`,
        `cd ${JSON.stringify(projectPath)}`,
        `(sleep 5 && BUFFER_NAME="openscout-init-${agentName}-$$" && tmux load-buffer -b "$BUFFER_NAME" ${JSON.stringify(initialFile)} && tmux paste-buffer -d -b "$BUFFER_NAME" -t ${tmuxSession} && tmux send-keys -t ${tmuxSession} Enter) &`,
        `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${agentName}-relay-agent"`,
      ].join("\n") + "\n",
    );
    execSync(`chmod 755 ${JSON.stringify(launchScript)}`);
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

    const record = normalizeLocalAgentRecord(agentName, {
      project: projectName,
      projectRoot: projectPath,
      cwd: projectPath,
      tmuxSession,
      startedAt: Math.floor(Date.now() / 1000),
      systemPrompt: task || undefined,
    });

    await appendRelayEvent(this.hub, {
      id: createRelayEventId("agent"),
      kind: "local_agent.started",
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      actor: agentName,
      payload: {
        record,
      },
    });
    await appendRelayMessage(this.hub, {
      ts: Math.floor(Date.now() / 1000),
      from: agentName,
      type: "SYS",
      body: `local agent spawned for ${projectName}`,
    });

    return {
      status: "started",
      record,
    };
  }

  async invokeLocalAgent(agentName: string, options: LocalAgentInvokeOptions): Promise<LocalAgentInvokeResult> {
    const localAgents = await this.loadLocalAgents();
    const localAgent = localAgents[agentName];

    if (!localAgent || !await this.isSessionAlive(localAgent.tmuxSession)) {
      throw new Error(`local agent "${agentName}" is not running`);
    }

    const flightId = createLocalAgentFlightId();
    const askedAt = Math.floor(Date.now() / 1000);
    const timeoutSeconds = options.timeoutSeconds ?? 300;
    const contextBlock = options.context
      ? `\n\nContext: ${JSON.stringify(options.context, null, 2)}`
      : "";

    await appendRelayMessage(this.hub, {
      ts: askedAt,
      from: options.asker,
      type: "MSG",
      body: `[ask:${flightId}] @${agentName} ${options.task}${contextBlock}`,
      to: [agentName],
    });

    const nudge = buildLocalAgentNudge(agentName, options.asker, flightId);
    await this.sendLocalAgentPrompt(localAgent, nudge);

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() <= deadline) {
      const messages = await readProjectedRelayMessages(this.hub, { since: askedAt - 1 });

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.type !== "MSG") continue;
        if (message.from !== agentName) continue;
        if (!message.rawBody.includes(`[ask:${flightId}]`)) continue;

        return {
          localAgent,
          flightId,
          response: stripLocalAgentReplyMetadata(message.rawBody, flightId, options.asker),
          respondedAt: message.timestamp,
        };
      }

      await sleep(500);
    }

    throw new Error(`timed out after ${timeoutSeconds}s waiting for ${agentName}`);
  }

  async tickLocalAgent(agentName: string, reason: string): Promise<boolean> {
    const localAgents = await this.loadLocalAgents();
    const localAgent = localAgents[agentName];
    if (!localAgent) return false;

    return this.sendLocalAgentPrompt(localAgent, buildLocalAgentTickMessage(agentName, reason));
  }

  async stopLocalAgent(agentName: string): Promise<LocalAgentStopResult> {
    const localAgents = await this.loadLocalAgents();
    const record = localAgents[agentName];

    if (!record) {
      return {
        status: "not_found",
        agentName,
      };
    }

    let status: LocalAgentStopResult["status"] = "stopped";
    if (!killTmuxSessionSync(record.tmuxSession)) {
      status = "already_stopped";
    }

    await appendRelayEvent(this.hub, {
      id: createRelayEventId("agent"),
      kind: "local_agent.stopped",
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      actor: agentName,
      payload: {
        agentId: agentName,
      },
    });
    await appendRelayMessage(this.hub, {
      ts: Math.floor(Date.now() / 1000),
      from: agentName,
      type: "SYS",
      body: "local agent stopped",
    });

    return {
      status,
      agentName,
      record,
    };
  }

  async stopAllLocalAgents(): Promise<LocalAgentStopResult[]> {
    const localAgents = await this.loadLocalAgents();
    const names = Object.keys(localAgents);
    const results: LocalAgentStopResult[] = [];

    for (const agentName of names) {
      const record = localAgents[agentName];
      let status: LocalAgentStopResult["status"] = "stopped";
      if (!killTmuxSessionSync(record.tmuxSession)) {
        status = "already_stopped";
      }

      results.push({
        status,
        agentName,
        record,
      });

      await appendRelayEvent(this.hub, {
        id: createRelayEventId("agent"),
        kind: "local_agent.stopped",
        v: 1,
        ts: Math.floor(Date.now() / 1000),
        actor: agentName,
        payload: {
          agentId: agentName,
        },
      });
    }

    if (results.length > 0) {
      await appendRelayMessage(this.hub, {
        ts: Math.floor(Date.now() / 1000),
        from: "system",
        type: "SYS",
        body: "all local agents stopped",
      });
    }

    return results;
  }

  async listLocalAgents(): Promise<LocalAgentRuntimeEntry[]> {
    const localAgents = await this.loadLocalAgents();
    const now = Math.floor(Date.now() / 1000);

    return Promise.all(
      Object.entries(localAgents).map(async ([_, record]) => ({
        ...record,
        alive: await this.isSessionAlive(record.tmuxSession),
        uptimeSeconds: now - record.startedAt,
      })),
    );
  }

  async cleanupDeadLocalAgents(): Promise<string[]> {
    const localAgents = await this.loadLocalAgents();
    const removed: string[] = [];

    for (const [agentName, record] of Object.entries(localAgents)) {
      if (!await this.isSessionAlive(record.tmuxSession)) {
        removed.push(agentName);
        await appendRelayEvent(this.hub, {
          id: createRelayEventId("agent"),
          kind: "local_agent.stopped",
          v: 1,
          ts: Math.floor(Date.now() / 1000),
          actor: agentName,
          payload: {
            agentId: agentName,
          },
        });
      }
    }

    return removed;
  }
}

export function createTmuxClaudeLocalAgentRuntime(hub: string): LocalAgentRuntime {
  return new TmuxClaudeLocalAgentRuntime(hub);
}
