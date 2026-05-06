-- Re-scope the OpenScout Push Relay around the authenticated GitHub user.
-- Drops the v1 mesh-keyed tables (no production data yet) and recreates them
-- keyed by user_id. Adds audit log and rate-limit bucket tables.

DROP INDEX IF EXISTS idx_osn_push_devices_device_bundle_env;
DROP INDEX IF EXISTS idx_osn_push_devices_token_hash;
DROP INDEX IF EXISTS idx_osn_push_devices_mesh_active;
DROP INDEX IF EXISTS idx_osn_push_attempts_mesh_created_at;
DROP INDEX IF EXISTS idx_osn_push_attempts_item;
DROP TABLE IF EXISTS osn_push_devices;
DROP TABLE IF EXISTS osn_push_attempts;
DROP TABLE IF EXISTS osn_push_usage_daily;

CREATE TABLE osn_push_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mesh_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_bundle_id TEXT NOT NULL,
  apns_environment TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  app_version TEXT,
  build_number TEXT,
  device_model TEXT,
  system_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE UNIQUE INDEX idx_osn_push_devices_user_device_bundle_env
  ON osn_push_devices (user_id, device_id, platform, app_bundle_id, apns_environment);

CREATE UNIQUE INDEX idx_osn_push_devices_token_hash
  ON osn_push_devices (token_hash);

CREATE INDEX idx_osn_push_devices_user_active
  ON osn_push_devices (user_id, revoked_at, updated_at DESC);

CREATE TABLE osn_push_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mesh_id TEXT NOT NULL,
  device_id TEXT,
  item_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  apns_id TEXT,
  apns_status INTEGER,
  apns_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_osn_push_attempts_user_created_at
  ON osn_push_attempts (user_id, created_at DESC);

CREATE INDEX idx_osn_push_attempts_item
  ON osn_push_attempts (item_id, created_at DESC);

CREATE TABLE osn_push_usage_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  attempted_count INTEGER NOT NULL,
  delivered_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Sliding-window rate-limit buckets. window_kind is one of:
--   'user_minute'  | 'user_hour'  | 'user_day' | 'device_minute'
-- For device_minute, key is `${user_id}:${device_id}`. For user_*, key is user_id.
CREATE TABLE osn_push_rate_buckets (
  bucket_key TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket_key, window_kind, window_start)
);

CREATE INDEX idx_osn_push_rate_buckets_updated_at
  ON osn_push_rate_buckets (updated_at);

-- Security audit log. Captures every state-changing call and every denial,
-- so we can review abuse, debug rate-limit issues, and show users their own
-- activity. Retained for OPENSCOUT_PUSH_AUDIT_RETENTION_DAYS (default 30).
CREATE TABLE osn_push_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_osn_push_audit_log_user_created_at
  ON osn_push_audit_log (user_id, created_at DESC);

CREATE INDEX idx_osn_push_audit_log_created_at
  ON osn_push_audit_log (created_at);
