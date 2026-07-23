/**
 * Versioned transport contract shared by browser-hosted and app-bundled Scout
 * surfaces. Keep this module free of browser, React, and native implementation
 * details so the same fixture corpus can be decoded by Swift.
 */

export const SCOUT_SURFACE_PROTOCOL_VERSION = 1 as const;

export type ScoutSurfaceProtocolVersion = typeof SCOUT_SURFACE_PROTOCOL_VERSION;
export type ScoutSurfaceId = "lanes" | "dispatch";
export type HostId = string;
export type RequestId = string;
export type StreamEpoch = string;
export type StreamSequence = number;

export const SCOUT_SURFACE_METHODS = [
  "bootstrap",
  "native.openExternalURL",
  "native.getPreferences",
  "native.setPreferences",
  "native.cancel",
  "agents.list",
  "agents.observe",
  "tail.recent",
  "tail.subscribe",
  "native.setLaneSelection",
  "dispatch.diagnostics",
  "dispatch.subscribe",
  "dispatch.ask",
  "dispatch.review",
] as const;

export type ScoutSurfaceMethod = (typeof SCOUT_SURFACE_METHODS)[number];

export const SCOUT_SURFACE_ERROR_CODES = [
  "cancelled",
  "deadline_exceeded",
  "internal_error",
  "invalid_params",
  "invalid_route",
  "not_connected",
  "payload_too_large",
  "protocol_mismatch",
  "unsupported_capability",
  "unsupported_method",
] as const;

export type ScoutSurfaceErrorCode = (typeof SCOUT_SURFACE_ERROR_CODES)[number];

export const SCOUT_SURFACE_LIMITS = {
  requestBytes: 1_048_576,
  replyBytes: 1_048_576,
  pushBytes: 262_144,
  preferenceValueBytes: 4_096,
  preferenceEntries: 32,
  hostIds: 32,
  agentIds: 128,
  stringBytes: 65_536,
  pushQueueItems: 32,
} as const;

export type HostScope = {
  /** A non-empty, de-duplicated set of native-authorized host fingerprints. */
  hostIds: readonly [HostId, ...HostId[]];
};

export type SurfaceActivityState = "visible" | "hiddenWarm" | "background";
export type SurfaceHostState = "connected" | "connecting" | "disconnected" | "unavailable";

export type SurfaceHost = {
  id: HostId;
  name: string;
  state: SurfaceHostState;
};

export type SurfaceDevice = {
  platform: "web" | "ios";
  formFactor: "desktop" | "phone" | "tablet" | "ipad";
};

export type SurfaceBootstrap = {
  surface: ScoutSurfaceId;
  assetRevision: string;
  protocolVersion: ScoutSurfaceProtocolVersion;
  minimumSurfaceProtocolVersion: ScoutSurfaceProtocolVersion;
  minimumNativeProtocolVersion: ScoutSurfaceProtocolVersion;
  capabilities: readonly ScoutSurfaceMethod[];
  device: SurfaceDevice;
  hosts: readonly SurfaceHost[];
  selectedHostIds: readonly HostId[];
  connectionRevision: number;
  activity: SurfaceActivityState;
};

export const SURFACE_PREFERENCE_KEYS = {
  lanes: [
    "lanes.layout",
    "lanes.horizon",
    "lanes.gridColumns",
    "lanes.collapseTechnicalEvents",
  ],
  dispatch: ["dispatch.density"],
} as const;

export type LanesPreference =
  | { key: "lanes.layout"; value: "lanes" | "grid" | "floor" }
  | { key: "lanes.horizon"; value: "5m" | "30m" | "4h" | "24h" }
  | { key: "lanes.gridColumns"; value: "auto" | "2" | "3" | "4" }
  | { key: "lanes.collapseTechnicalEvents"; value: boolean };

export type DispatchPreference = {
  key: "dispatch.density";
  value: "comfortable" | "compact";
};

export type SurfacePreference = LanesPreference | DispatchPreference;
export type SurfacePreferenceKey = SurfacePreference["key"];

export type SurfacePreferences = {
  /** At most SCOUT_SURFACE_LIMITS.preferenceEntries entries, one per key. */
  entries: readonly SurfacePreference[];
};

export type LaneSelection = {
  hostId: HostId;
  agentId: string;
  conversationId?: string;
  sessionId?: string;
};

export type StreamCursor = {
  epoch: StreamEpoch;
  sequence: StreamSequence;
  connectionRevision: number;
};

export type HostFailure = {
  hostId: HostId;
  ready: false;
  error: ScoutSurfaceError;
};

export type HostSuccess<T> = {
  hostId: HostId;
  ready: true;
  value: T;
};

export type HostOutcome<T> = HostSuccess<T> | HostFailure;

export type FleetSnapshot<T> = {
  hosts: readonly HostOutcome<T>[];
};

export type SurfaceAgent = {
  id: string;
  name: string;
  handle: string | null;
  harness: string | null;
  model: string | null;
  state: string | null;
  projectRoot: string | null;
  conversationId: string | null;
  sessionId: string | null;
  updatedAt: number | null;
};

export type HostAgentSnapshot = {
  cursor: StreamCursor;
  agents: readonly SurfaceAgent[];
};

export type FleetAgentSnapshot = FleetSnapshot<HostAgentSnapshot>;

export type SurfaceObserveEvent = {
  id: string;
  at: number;
  kind: "think" | "tool" | "ask" | "message" | "note" | "system" | "boot";
  text: string;
  tool?: string;
  detail?: string;
};

export type SurfaceAgentObserve = {
  agentId: string;
  source: "history" | "live" | "unavailable";
  fidelity: "timestamped" | "synthetic";
  sessionId: string | null;
  updatedAt: number;
  events: readonly SurfaceObserveEvent[];
};

export type HostObserveSnapshot = {
  cursor: StreamCursor;
  agents: readonly SurfaceAgentObserve[];
};

export type FleetObserveSnapshot = FleetSnapshot<HostObserveSnapshot>;

export type SurfaceTailEvent = {
  id: string;
  at: number;
  agentId: string | null;
  sessionId: string | null;
  kind: string;
  text: string;
};

export type HostTailSnapshot = {
  cursor: StreamCursor;
  nextCursor: string | null;
  events: readonly SurfaceTailEvent[];
};

export type FleetTailSnapshot = FleetSnapshot<HostTailSnapshot>;

export type FleetTailDelta = {
  hostId: HostId;
  cursor: StreamCursor;
  events: readonly SurfaceTailEvent[];
};

export type SurfaceDispatchRecord = {
  id: string;
  state: string;
  actorId: string | null;
  targetId: string | null;
  summary: string;
  createdAt: number;
  updatedAt: number;
  messageId: string | null;
  conversationId: string | null;
  flightId: string | null;
  workId: string | null;
  ref: string | null;
};

export type HostDispatchSnapshot = {
  cursor: StreamCursor;
  nextCursor: string | null;
  records: readonly SurfaceDispatchRecord[];
};

export type FleetDispatchSnapshot = FleetSnapshot<HostDispatchSnapshot>;

export type FleetDispatchDelta = {
  hostId: HostId;
  cursor: StreamCursor;
  records: readonly SurfaceDispatchRecord[];
};

export type RoutedTarget =
  | { kind: "agent"; hostId: HostId; agentId: string }
  | { kind: "conversation"; hostId: HostId; conversationId: string }
  | { kind: "channel"; hostId: HostId; channelId: string };

export type RoutedAskRequest = {
  route: RoutedTarget;
  body: string;
  replyMode: "wait" | "notify";
};

export type RoutedReviewRequest = {
  hostId: HostId;
  dispatchId: string;
  note?: string;
};

export type RoutedScoutReceipt = {
  hostId: HostId;
  messageId: string | null;
  conversationId: string | null;
  flightId: string | null;
  workId: string | null;
  ref: string | null;
};

export type RoutedAskReceipt = RoutedScoutReceipt;
export type RoutedReviewReceipt = RoutedScoutReceipt;

export type EmptyParams = Record<never, never>;

export type ScoutSurfaceMethodContract = {
  bootstrap: { params: EmptyParams; result: SurfaceBootstrap };
  "native.openExternalURL": { params: { url: string }; result: SurfaceAck };
  "native.getPreferences": {
    params: { keys: readonly SurfacePreferenceKey[] };
    result: SurfacePreferences;
  };
  "native.setPreferences": { params: SurfacePreferences; result: SurfaceAck };
  "native.cancel": { params: { requestId: RequestId }; result: SurfaceAck };
  "agents.list": { params: EmptyParams; result: FleetAgentSnapshot };
  "agents.observe": { params: { agentIds: readonly string[] }; result: FleetObserveSnapshot };
  "tail.recent": { params: { cursor?: string; limit?: number }; result: FleetTailSnapshot };
  "tail.subscribe": { params: { cursor?: string }; result: SurfaceSubscriptionReceipt };
  "native.setLaneSelection": { params: { selection: LaneSelection | null }; result: SurfaceAck };
  "dispatch.diagnostics": {
    params: { cursor?: string; limit?: number };
    result: FleetDispatchSnapshot;
  };
  "dispatch.subscribe": { params: { cursor?: string }; result: SurfaceSubscriptionReceipt };
  "dispatch.ask": { params: RoutedAskRequest; result: RoutedAskReceipt };
  "dispatch.review": { params: RoutedReviewRequest; result: RoutedReviewReceipt };
};

export type HostScopedSurfaceMethod =
  | "agents.list"
  | "agents.observe"
  | "tail.recent"
  | "tail.subscribe"
  | "dispatch.diagnostics"
  | "dispatch.subscribe";

export type SurfaceAck = { accepted: true };

export type SurfaceSubscriptionReceipt = {
  subscriptionId: string;
  hosts: readonly HostOutcome<{ cursor: StreamCursor }>[];
};

type RequestRoute<M extends ScoutSurfaceMethod> = M extends HostScopedSurfaceMethod
  ? HostScope
  : { hostIds?: never };

export type ScoutSurfaceRequestFor<M extends ScoutSurfaceMethod> = {
  v: ScoutSurfaceProtocolVersion;
  id: RequestId;
  surface: ScoutSurfaceId;
  method: M;
  params: ScoutSurfaceMethodContract[M]["params"];
  deadlineMs?: number;
} & RequestRoute<M>;

export type ScoutSurfaceRequest = {
  [M in ScoutSurfaceMethod]: ScoutSurfaceRequestFor<M>;
}[ScoutSurfaceMethod];

export type ScoutSurfaceReplyMetadata = {
  appliedDeadlineMs: number;
};

export type ScoutSurfaceSuccessReplyFor<M extends ScoutSurfaceMethod> = {
  v: ScoutSurfaceProtocolVersion;
  id: RequestId;
  method: M;
  metadata: ScoutSurfaceReplyMetadata;
  result: ScoutSurfaceMethodContract[M]["result"];
};

export type ScoutSurfaceSuccessReply = {
  [M in ScoutSurfaceMethod]: ScoutSurfaceSuccessReplyFor<M>;
}[ScoutSurfaceMethod];

export type ScoutSurfaceError = {
  code: ScoutSurfaceErrorCode;
  message: string;
  retryable: boolean;
};

export type ScoutSurfaceErrorReply = {
  v: ScoutSurfaceProtocolVersion;
  id: RequestId;
  method: ScoutSurfaceMethod;
  metadata: ScoutSurfaceReplyMetadata;
  error: ScoutSurfaceError;
};

export type ScoutSurfaceReply = ScoutSurfaceSuccessReply | ScoutSurfaceErrorReply;

export type SurfaceSessionUpdatePush = {
  v: ScoutSurfaceProtocolVersion;
  stream: "session.update";
  hosts: readonly SurfaceHost[];
  selectedHostIds: readonly HostId[];
  connectionRevision: number;
  activity: SurfaceActivityState;
};

type SurfaceStreamPushBase<S extends string> = {
  v: ScoutSurfaceProtocolVersion;
  stream: S;
  hostId: HostId;
  epoch: StreamEpoch;
  sequence: StreamSequence;
  connectionRevision: number;
};

export type SurfaceTailPush = SurfaceStreamPushBase<"tail.delta"> & {
  payload: { events: readonly SurfaceTailEvent[] };
};

export type SurfaceDispatchPush = SurfaceStreamPushBase<"dispatch.delta"> & {
  payload: { records: readonly SurfaceDispatchRecord[] };
};

export type SurfaceStreamResetPush = SurfaceStreamPushBase<"stream.reset"> & {
  payload: { target: "tail" | "dispatch"; reason: "gap" | "overflow" | "reconnect" | "resync" };
};

export type ScoutSurfacePush =
  | SurfaceSessionUpdatePush
  | SurfaceTailPush
  | SurfaceDispatchPush
  | SurfaceStreamResetPush;

export type Unsubscribe = () => void;

export interface ScoutSurfaceClient {
  bootstrap(): Promise<SurfaceBootstrap>;
  agents: {
    list(scope: HostScope): Promise<FleetAgentSnapshot>;
    observe(scope: HostScope, agentIds: readonly string[]): Promise<FleetObserveSnapshot>;
  };
  tail: {
    recent(scope: HostScope, cursor?: string): Promise<FleetTailSnapshot>;
    subscribe(scope: HostScope, listener: (delta: FleetTailDelta) => void): Unsubscribe;
  };
  dispatch: {
    diagnostics(scope: HostScope, cursor?: string): Promise<FleetDispatchSnapshot>;
    ask(request: RoutedAskRequest): Promise<RoutedAskReceipt>;
    review(request: RoutedReviewRequest): Promise<RoutedReviewReceipt>;
    subscribe(scope: HostScope, listener: (delta: FleetDispatchDelta) => void): Unsubscribe;
  };
  native: {
    setLaneSelection(selection: LaneSelection | null): Promise<void>;
    openExternalURL(url: string): Promise<void>;
    getPreferences(keys: readonly SurfacePreferenceKey[]): Promise<SurfacePreferences>;
    setPreferences(values: SurfacePreferences): Promise<void>;
    cancel(requestId: RequestId): Promise<void>;
  };
}

export type ScoutSurfaceMethodPolicy = {
  surfaces: readonly ScoutSurfaceId[];
  defaultDeadlineMs: number;
  maximumDeadlineMs: number;
};

const SHARED_SURFACES = ["lanes", "dispatch"] as const;

export const SCOUT_SURFACE_METHOD_POLICY = {
  bootstrap: { surfaces: SHARED_SURFACES, defaultDeadlineMs: 5_000, maximumDeadlineMs: 5_000 },
  "native.openExternalURL": { surfaces: SHARED_SURFACES, defaultDeadlineMs: 5_000, maximumDeadlineMs: 5_000 },
  "native.getPreferences": { surfaces: SHARED_SURFACES, defaultDeadlineMs: 2_000, maximumDeadlineMs: 5_000 },
  "native.setPreferences": { surfaces: SHARED_SURFACES, defaultDeadlineMs: 2_000, maximumDeadlineMs: 5_000 },
  "native.cancel": { surfaces: SHARED_SURFACES, defaultDeadlineMs: 1_000, maximumDeadlineMs: 2_000 },
  "agents.list": { surfaces: ["lanes"], defaultDeadlineMs: 10_000, maximumDeadlineMs: 20_000 },
  "agents.observe": { surfaces: ["lanes"], defaultDeadlineMs: 15_000, maximumDeadlineMs: 30_000 },
  "tail.recent": { surfaces: ["lanes"], defaultDeadlineMs: 15_000, maximumDeadlineMs: 30_000 },
  "tail.subscribe": { surfaces: ["lanes"], defaultDeadlineMs: 5_000, maximumDeadlineMs: 10_000 },
  "native.setLaneSelection": { surfaces: ["lanes"], defaultDeadlineMs: 2_000, maximumDeadlineMs: 5_000 },
  "dispatch.diagnostics": { surfaces: ["dispatch"], defaultDeadlineMs: 15_000, maximumDeadlineMs: 30_000 },
  "dispatch.subscribe": { surfaces: ["dispatch"], defaultDeadlineMs: 5_000, maximumDeadlineMs: 10_000 },
  "dispatch.ask": { surfaces: ["dispatch"], defaultDeadlineMs: 30_000, maximumDeadlineMs: 60_000 },
  "dispatch.review": { surfaces: ["dispatch"], defaultDeadlineMs: 30_000, maximumDeadlineMs: 60_000 },
} as const satisfies Record<ScoutSurfaceMethod, ScoutSurfaceMethodPolicy>;

export function isScoutSurfaceMethod(value: string): value is ScoutSurfaceMethod {
  return (SCOUT_SURFACE_METHODS as readonly string[]).includes(value);
}

export function preferenceKeysForSurface(surface: ScoutSurfaceId): readonly SurfacePreferenceKey[] {
  return SURFACE_PREFERENCE_KEYS[surface];
}
