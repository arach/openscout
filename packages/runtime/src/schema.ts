export const CONTROL_PLANE_SCHEMA_VERSION = 1;

export const CONTROL_PLANE_SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  mesh_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host_name TEXT,
  advertise_scope TEXT NOT NULL,
  broker_url TEXT,
  tailnet_name TEXT,
  capabilities_json TEXT,
  labels_json TEXT,
  metadata_json TEXT,
  last_seen_at INTEGER,
  registered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  labels_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  node_qualifier TEXT,
  workspace_qualifier TEXT,
  selector TEXT,
  default_selector TEXT,
  agent_class TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  wake_policy TEXT NOT NULL,
  home_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  authority_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  advertise_scope TEXT NOT NULL,
  owner_id TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS agent_endpoints (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  harness TEXT NOT NULL,
  transport TEXT NOT NULL,
  state TEXT NOT NULL,
  address TEXT,
  session_id TEXT,
  pane TEXT,
  cwd TEXT,
  project_root TEXT,
  metadata_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL,
  share_mode TEXT NOT NULL,
  authority_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  topic TEXT,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  role TEXT,
  PRIMARY KEY (conversation_id, actor_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  origin_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  class TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  thread_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  speech_json TEXT,
  audience_json TEXT,
  visibility TEXT NOT NULL,
  policy TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  label TEXT,
  PRIMARY KEY (message_id, actor_id)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  file_name TEXT,
  blob_key TEXT,
  url TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS invocations (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  requester_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  target_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  task TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  context_json TEXT,
  execution_json TEXT,
  ensure_awake INTEGER NOT NULL DEFAULT 1,
  stream INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  invocation_id TEXT NOT NULL REFERENCES invocations(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  state TEXT NOT NULL,
  summary TEXT,
  output TEXT,
  error TEXT,
  metadata_json TEXT,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS bindings (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  external_channel_id TEXT NOT NULL,
  external_thread_id TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  invocation_id TEXT REFERENCES invocations(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  target_kind TEXT NOT NULL,
  transport TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy TEXT NOT NULL,
  status TEXT NOT NULL,
  binding_id TEXT REFERENCES bindings(id) ON DELETE SET NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  external_ref TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collaboration_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  acceptance_state TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  created_by_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  owner_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  next_move_owner_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES collaboration_records(id) ON DELETE SET NULL,
  priority TEXT,
  labels_json TEXT,
  relations_json TEXT,
  detail_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collaboration_events (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES collaboration_records(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  summary TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  node_id TEXT,
  ts INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scout_dispatches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  asked_label TEXT NOT NULL,
  detail TEXT NOT NULL,
  invocation_id TEXT,
  conversation_id TEXT,
  requester_id TEXT,
  dispatcher_node_id TEXT NOT NULL,
  dispatched_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  invocation_id TEXT REFERENCES invocations(id) ON DELETE CASCADE,
  flight_id TEXT REFERENCES flights(id) ON DELETE CASCADE,
  record_id TEXT REFERENCES collaboration_records(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  counterpart_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  workspace_root TEXT,
  session_id TEXT,
  title TEXT,
  summary TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_mesh_id
  ON nodes (mesh_id);
CREATE INDEX IF NOT EXISTS idx_agent_endpoints_agent_updated_at
  ON agent_endpoints (agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invocations_target_created_at
  ON invocations (target_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_flights_target_state
  ON flights (target_agent_id, state);
CREATE INDEX IF NOT EXISTS idx_deliveries_status_transport
  ON deliveries (status, transport);
CREATE INDEX IF NOT EXISTS idx_collaboration_records_state
  ON collaboration_records (state);
CREATE INDEX IF NOT EXISTS idx_collaboration_records_updated_at
  ON collaboration_records (updated_at);
CREATE INDEX IF NOT EXISTS idx_collaboration_events_record_created_at
  ON collaboration_events (record_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind_ts
  ON events (kind, ts);
CREATE INDEX IF NOT EXISTS idx_activity_items_agent_ts
  ON activity_items (agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_items_actor_ts
  ON activity_items (actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_items_conversation_ts
  ON activity_items (conversation_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_items_workspace_ts
  ON activity_items (workspace_root, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_items_kind_ts
  ON activity_items (kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_items_session_ts
  ON activity_items (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_scout_dispatches_dispatched_at
  ON scout_dispatches (dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_dispatches_conversation_ts
  ON scout_dispatches (conversation_id, dispatched_at DESC);
`;
