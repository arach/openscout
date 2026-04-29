import type { BrokerServiceStatus } from "@openscout/runtime/broker-process-manager";

import { loadScoutAgentStatuses, type ScoutAgentStatus } from "../agents/service.ts";
import { getRuntimeBrokerServiceStatus } from "../../app/host/runtime-service-client.ts";
import {
  listScoutAgents,
  loadScoutMessages,
  resolveScoutBrokerUrl,
  type ScoutBrokerMessageRecord,
  type ScoutWhoEntry,
} from "../broker/service.ts";

export type ScoutMonitorSnapshot = {
  refreshedAt: number;
  currentDirectory: string;
  brokerUrl: string;
  brokerStatus: BrokerServiceStatus;
  brokerAgents: ScoutWhoEntry[];
  localAgents: ScoutAgentStatus[];
  recentMessages: ScoutBrokerMessageRecord[];
  channel: string;
  errors: string[];
};

export type ScoutMonitorSnapshotOptions = {
  currentDirectory: string;
  channel?: string;
  limit?: number;
};

const DEFAULT_MONITOR_CHANNEL = "shared";
const DEFAULT_MONITOR_MESSAGE_LIMIT = 12;

export async function loadScoutMonitorSnapshot(
  input: ScoutMonitorSnapshotOptions,
): Promise<ScoutMonitorSnapshot> {
  const channel = input.channel?.trim() || DEFAULT_MONITOR_CHANNEL;
  const limit = input.limit ?? DEFAULT_MONITOR_MESSAGE_LIMIT;
  const brokerUrl = resolveScoutBrokerUrl();
  const errors: string[] = [];

  const [brokerStatusResult, localAgentsResult] = await Promise.allSettled([
    getRuntimeBrokerServiceStatus(),
    loadScoutAgentStatuses({ currentDirectory: input.currentDirectory }),
  ]);

  const brokerStatus = brokerStatusResult.status === "fulfilled"
    ? brokerStatusResult.value
    : await getRuntimeBrokerServiceStatus();

  const localAgents = localAgentsResult.status === "fulfilled"
    ? localAgentsResult.value
    : [];

  if (localAgentsResult.status === "rejected") {
    errors.push(localAgentsResult.reason instanceof Error ? localAgentsResult.reason.message : String(localAgentsResult.reason));
  }

  let brokerAgents: ScoutWhoEntry[] = [];
  let recentMessages: ScoutBrokerMessageRecord[] = [];

  if (brokerStatus.reachable && brokerStatus.health.ok) {
    const [brokerAgentsResult, recentMessagesResult] = await Promise.allSettled([
      listScoutAgents({ currentDirectory: input.currentDirectory }),
      loadScoutMessages({ channel, limit }),
    ]);

    if (brokerAgentsResult.status === "fulfilled") {
      brokerAgents = brokerAgentsResult.value;
    } else {
      errors.push(brokerAgentsResult.reason instanceof Error ? brokerAgentsResult.reason.message : String(brokerAgentsResult.reason));
    }

    if (recentMessagesResult.status === "fulfilled") {
      recentMessages = recentMessagesResult.value;
    } else {
      errors.push(recentMessagesResult.reason instanceof Error ? recentMessagesResult.reason.message : String(recentMessagesResult.reason));
    }
  } else if (brokerStatus.health.error) {
    errors.push(brokerStatus.health.error);
  }

  return {
    refreshedAt: Math.floor(Date.now() / 1000),
    currentDirectory: input.currentDirectory,
    brokerUrl,
    brokerStatus,
    brokerAgents,
    localAgents,
    recentMessages,
    channel,
    errors,
  };
}
