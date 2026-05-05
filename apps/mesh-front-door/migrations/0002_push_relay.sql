CREATE TABLE IF NOT EXISTS osn_push_devices (
  id TEXT PRIMARY KEY,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_osn_push_devices_device_bundle_env
  ON osn_push_devices (mesh_id, device_id, platform, app_bundle_id, apns_environment);

CREATE UNIQUE INDEX IF NOT EXISTS idx_osn_push_devices_token_hash
  ON osn_push_devices (token_hash);

CREATE INDEX IF NOT EXISTS idx_osn_push_devices_mesh_active
  ON osn_push_devices (mesh_id, revoked_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS osn_push_attempts (
  id TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_osn_push_attempts_mesh_created_at
  ON osn_push_attempts (mesh_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_osn_push_attempts_item
  ON osn_push_attempts (item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS osn_push_usage_daily (
  mesh_id TEXT NOT NULL,
  day TEXT NOT NULL,
  attempted_count INTEGER NOT NULL,
  delivered_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mesh_id, day)
);
