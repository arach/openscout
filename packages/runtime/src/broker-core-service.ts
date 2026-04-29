import type {
  CollaborationRecord,
  ControlCommand,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
  ScoutDeliverRequest,
  ScoutDeliverResponse,
  ThreadEventEnvelope,
  ThreadSnapshot,
  ThreadWatchCloseRequest,
  ThreadWatchOpenRequest,
  ThreadWatchOpenResponse,
  ThreadWatchRenewRequest,
  ThreadWatchRenewResponse,
} from "@openscout/protocol";

import type {
  ActiveScoutBrokerService,
  ScoutBrokerActivityQuery,
  ScoutBrokerCollaborationEventQuery,
  ScoutBrokerCollaborationRecordQuery,
  ScoutBrokerMessageQuery,
} from "./broker-api.js";
import type { RuntimeRegistrySnapshot } from "./registry.js";
import type { ActivityItem } from "./sqlite-store.js";

type BrokerCoreRuntime = {
  snapshot: () => RuntimeRegistrySnapshot;
};

type BrokerCoreProjection = {
  listActivityItems: (options?: {
    limit?: number;
    agentId?: string;
    actorId?: string;
    conversationId?: string;
  }) => Promise<ActivityItem[]>;
};

type BrokerCoreJournal = {
  listCollaborationRecords: (options?: {
    limit?: number;
    kind?: CollaborationRecord["kind"];
    state?: string;
    ownerId?: string;
    nextMoveOwnerId?: string;
  }) => unknown;
  listCollaborationEvents: (options?: {
    limit?: number;
    recordId?: string;
  }) => unknown;
};

type BrokerCoreThreadEvents = {
  replay: (input: {
    conversationId: string;
    afterSeq: number;
    limit: number;
  }) => Promise<ThreadEventEnvelope[]>;
  snapshot: (conversationId: string) => Promise<ThreadSnapshot>;
  openWatch: (
    request: ThreadWatchOpenRequest,
  ) => Promise<ThreadWatchOpenResponse>;
  renewWatch: (
    request: ThreadWatchRenewRequest,
  ) => Promise<ThreadWatchRenewResponse>;
  closeWatch: (request: ThreadWatchCloseRequest) => Promise<void>;
};

export type BrokerCoreServiceDeps = {
  baseUrl: string;
  nodeId: string;
  meshId: string;
  localNode: NodeDefinition;
  runtime: BrokerCoreRuntime;
  projection: BrokerCoreProjection;
  journal: BrokerCoreJournal;
  threadEvents: BrokerCoreThreadEvents;
  isReconciledStaleFlightActivityItem: (item: ActivityItem) => boolean;
  readHome?: () => Promise<unknown>;
  executeCommand: (command: ControlCommand) => Promise<unknown>;
  postConversationMessage?: (message: MessageRecord) => Promise<unknown>;
  deliver?: (request: ScoutDeliverRequest) => Promise<ScoutDeliverResponse>;
  invokeAgent?: (
    request: InvocationRequest & { targetLabel?: string },
  ) => Promise<unknown>;
};

function normalizeLimit(limit?: number): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.min(limit, 500)
    : 100;
}

function listBrokerMessages(
  runtime: BrokerCoreRuntime,
  input: ScoutBrokerMessageQuery = {},
): MessageRecord[] {
  const snapshot = runtime.snapshot();
  const limit = normalizeLimit(input.limit);
  return Object.values(snapshot.messages)
    .filter((message) =>
      !input.conversationId || message.conversationId === input.conversationId
    )
    .filter((message) =>
      input.since === null || input.since === undefined
        ? true
        : message.createdAt >= input.since
    )
    .sort((lhs, rhs) => rhs.createdAt - lhs.createdAt)
    .slice(0, limit)
    .reverse();
}

async function listBrokerActivity(
  projection: BrokerCoreProjection,
  isReconciledStaleFlightActivityItem: (item: ActivityItem) => boolean,
  input: ScoutBrokerActivityQuery,
) {
  const items = await projection.listActivityItems({
    limit: normalizeLimit(input.limit),
    agentId: input.agentId,
    actorId: input.actorId,
    conversationId: input.conversationId,
  });
  return items.filter((item) => !isReconciledStaleFlightActivityItem(item));
}

function listBrokerCollaborationRecords(
  journal: BrokerCoreJournal,
  input: ScoutBrokerCollaborationRecordQuery,
) {
  return journal.listCollaborationRecords({
    limit: normalizeLimit(input.limit),
    kind: input.kind as CollaborationRecord["kind"] | undefined,
    state: input.state,
    ownerId: input.ownerId,
    nextMoveOwnerId: input.nextMoveOwnerId,
  });
}

function listBrokerCollaborationEvents(
  journal: BrokerCoreJournal,
  input: ScoutBrokerCollaborationEventQuery,
) {
  return journal.listCollaborationEvents({
    limit: normalizeLimit(input.limit),
    recordId: input.recordId,
  });
}

export function createBrokerCoreService(
  deps: BrokerCoreServiceDeps,
): ActiveScoutBrokerService {
  const postConversationMessage = deps.postConversationMessage;
  return {
    baseUrl: deps.baseUrl,
    readHealth: async () => {
      const snapshot = deps.runtime.snapshot();
      return {
        ok: true,
        nodeId: deps.nodeId,
        meshId: deps.meshId,
        counts: {
          nodes: Object.keys(snapshot.nodes).length,
          actors: Object.keys(snapshot.actors).length,
          agents: Object.keys(snapshot.agents).length,
          conversations: Object.keys(snapshot.conversations).length,
          messages: Object.keys(snapshot.messages).length,
          flights: Object.keys(snapshot.flights).length,
          collaborationRecords: Object.keys(snapshot.collaborationRecords)
            .length,
        },
      };
    },
    readHome: deps.readHome,
    readNode: async () => deps.localNode,
    readSnapshot: async () => deps.runtime.snapshot(),
    readMessages: async (query) => listBrokerMessages(deps.runtime, query),
    readActivity: async (query) =>
      await listBrokerActivity(
        deps.projection,
        deps.isReconciledStaleFlightActivityItem,
        query,
      ),
    readCollaborationRecords: async (query) =>
      listBrokerCollaborationRecords(deps.journal, query),
    readCollaborationEvents: async (query) =>
      listBrokerCollaborationEvents(deps.journal, query),
    readThreadEvents: async (query) =>
      await deps.threadEvents.replay({
        conversationId: query.conversationId,
        afterSeq: query.afterSeq ?? 0,
        limit: normalizeLimit(query.limit),
      }),
    readThreadSnapshot: async (conversationId) =>
      await deps.threadEvents.snapshot(conversationId),
    openThreadWatch: async (request) => await deps.threadEvents.openWatch(request),
    renewThreadWatch: async (request) =>
      await deps.threadEvents.renewWatch(request),
    closeThreadWatch: async (request) => {
      await deps.threadEvents.closeWatch(request);
      return { ok: true, watchId: request.watchId };
    },
    executeCommand: deps.executeCommand,
    postConversationMessage: postConversationMessage
      ? async (message) => await postConversationMessage(message)
      : async (message) =>
        await deps.executeCommand({ kind: "conversation.post", message }),
    deliver: deps.deliver,
    invokeAgent: deps.invokeAgent,
  };
}
