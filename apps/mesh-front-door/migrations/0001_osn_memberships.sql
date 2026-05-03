CREATE TABLE IF NOT EXISTS osn_users (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS osn_meshes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS osn_mesh_memberships (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  mesh_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id, mesh_id),
  FOREIGN KEY (provider, provider_user_id)
    REFERENCES osn_users(provider, provider_user_id)
    ON DELETE CASCADE,
  FOREIGN KEY (mesh_id)
    REFERENCES osn_meshes(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS osn_mesh_memberships_mesh_id_idx
  ON osn_mesh_memberships(mesh_id);
