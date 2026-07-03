use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CAPABILITIES_SCHEMA: &str = "openscout.probe.capabilities/v1";
const REQUEST_SCHEMA: &str = "openscout.probe.request/v1";
const SNAPSHOT_SCHEMA: &str = "openscout.probe.snapshot/v1";
const ERROR_SCHEMA: &str = "openscout.probe.error/v1";
const TAILSCALE_STATUS_ID: &str = "tailscale.status";
const GIT_BUILD_INFO_ID: &str = "git.buildInfo";
const TAILSCALE_STATUS_TTL_MS: u64 = 30_000;
const GIT_BUILD_INFO_TTL_MS: u64 = 60_000;
const DEFAULT_TAILSCALE_TIMEOUT: Duration = Duration::from_millis(1_500);
const DEFAULT_GIT_TIMEOUT: Duration = Duration::from_millis(1_500);
const REQUEST_READ_CAP_BYTES: u64 = 1024 * 1024;
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug)]
pub struct ProbeServerOptions {
    pub socket_path: PathBuf,
    pub tailscale_bin: String,
    pub git_bin: String,
    pub tailscale_status_fixture: Option<PathBuf>,
    pub tailscale_timeout: Duration,
    pub git_timeout: Duration,
}

impl ProbeServerOptions {
    pub fn from_env(socket_path: PathBuf) -> Self {
        Self {
            socket_path,
            tailscale_bin: env_nonempty("OPENSCOUT_TAILSCALE_BIN")
                .unwrap_or_else(|| "tailscale".to_string()),
            git_bin: env_nonempty("OPENSCOUT_GIT_BIN").unwrap_or_else(|| "git".to_string()),
            tailscale_status_fixture: env_nonempty("OPENSCOUT_TAILSCALE_STATUS_JSON")
                .map(PathBuf::from),
            tailscale_timeout: env_duration_ms("OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS")
                .unwrap_or(DEFAULT_TAILSCALE_TIMEOUT),
            git_timeout: env_duration_ms("OPENSCOUT_GIT_BUILD_INFO_TIMEOUT_MS")
                .unwrap_or(DEFAULT_GIT_TIMEOUT),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ProbeServerStatus {
    #[serde(rename = "socketPath")]
    pub socket_path: String,
    #[serde(rename = "socketExists")]
    pub socket_exists: bool,
    pub reachable: bool,
    #[serde(rename = "daemonVersion")]
    pub daemon_version: Option<String>,
    pub families: Vec<ProbeCapability>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProbeCapability {
    #[serde(rename = "probeId")]
    pub probe_id: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct JsonError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timed_out: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProbeSnapshotResponse {
    schema: String,
    #[serde(rename = "probeId")]
    probe_id: String,
    key: Option<String>,
    #[serde(rename = "generatedAt")]
    generated_at: u128,
    #[serde(rename = "ttlMs")]
    ttl_ms: u64,
    value: Value,
    error: Option<JsonError>,
    #[serde(rename = "daemonVersion")]
    daemon_version: String,
}

#[derive(Debug, Deserialize)]
struct ProbeRequest {
    #[serde(rename = "schema")]
    _schema: String,
    #[serde(rename = "probeId")]
    probe_id: Option<String>,
    key: Option<String>,
    #[serde(rename = "maxAgeMs")]
    max_age_ms: Option<u64>,
}

#[derive(Debug)]
struct ProbeFailure {
    code: String,
    message: String,
    timed_out: bool,
}

#[derive(Debug)]
struct CommandResult {
    stdout: String,
}

#[derive(Debug)]
struct CommandFailure {
    code: String,
    message: String,
    timed_out: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct ProbeCacheKey {
    probe_id: String,
    key: Option<String>,
}

#[derive(Clone, Debug)]
struct StaticGitBuildMetadata {
    commit: Option<String>,
    boot_branch: Option<String>,
    metadata_at: u128,
}

#[derive(Clone, Debug, Default)]
struct ProbeCacheEntry {
    snapshot: Option<ProbeSnapshotResponse>,
    in_flight: bool,
}

#[derive(Debug, Default)]
struct ProbeEngineState {
    entries: HashMap<ProbeCacheKey, ProbeCacheEntry>,
    git_static: HashMap<String, StaticGitBuildMetadata>,
}

#[derive(Clone, Debug)]
struct ProbeEngine {
    options: ProbeServerOptions,
    state: Arc<(Mutex<ProbeEngineState>, Condvar)>,
}

impl ProbeEngine {
    fn new(options: ProbeServerOptions) -> Self {
        Self {
            options,
            state: Arc::new((Mutex::new(ProbeEngineState::default()), Condvar::new())),
        }
    }

    fn capabilities(&self) -> Vec<ProbeCapability> {
        served_capabilities()
    }

    fn snapshot(
        &self,
        probe_id: &str,
        key: Option<String>,
        max_age_ms: Option<u64>,
    ) -> ProbeSnapshotResponse {
        let ttl_ms = probe_ttl_ms(probe_id).unwrap_or(0);
        let normalized_key = match normalize_probe_key(probe_id, key) {
            Ok(value) => value,
            Err(error) => return error_snapshot(probe_id, None, ttl_ms, error),
        };
        if !is_supported_probe(probe_id) {
            return error_snapshot(
                probe_id,
                normalized_key,
                ttl_ms,
                ProbeFailure {
                    code: "unknown_probe".to_string(),
                    message: format!("unknown probeId: {probe_id}"),
                    timed_out: false,
                },
            );
        }

        let cache_key = ProbeCacheKey {
            probe_id: probe_id.to_string(),
            key: normalized_key.clone(),
        };

        loop {
            let (lock, cvar) = &*self.state;
            let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let entry = state.entries.entry(cache_key.clone()).or_default();
            if let Some(snapshot) = entry.snapshot.as_ref() {
                if snapshot_is_fresh_for(snapshot, max_age_ms.unwrap_or(ttl_ms)) {
                    return snapshot.clone();
                }
            }
            if entry.in_flight {
                let guard = cvar
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                drop(guard);
                continue;
            }
            entry.in_flight = true;
            break;
        }

        let snapshot = match self.run_probe(probe_id, normalized_key.clone()) {
            Ok(value) => ProbeSnapshotResponse {
                schema: SNAPSHOT_SCHEMA.to_string(),
                probe_id: probe_id.to_string(),
                key: normalized_key.clone(),
                generated_at: epoch_ms(),
                ttl_ms,
                value,
                error: None,
                daemon_version: DAEMON_VERSION.to_string(),
            },
            Err(error) => error_snapshot(probe_id, normalized_key.clone(), ttl_ms, error),
        };

        let (lock, cvar) = &*self.state;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = state.entries.entry(cache_key).or_default();
        entry.snapshot = Some(snapshot.clone());
        entry.in_flight = false;
        cvar.notify_all();
        snapshot
    }

    fn run_probe(&self, probe_id: &str, key: Option<String>) -> Result<Value, ProbeFailure> {
        match probe_id {
            TAILSCALE_STATUS_ID => self.run_tailscale_status(),
            GIT_BUILD_INFO_ID => {
                let repo_root = key.ok_or_else(|| ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: "git.buildInfo requires a repo root key".to_string(),
                    timed_out: false,
                })?;
                self.run_git_build_info(&repo_root)
            }
            _ => Err(ProbeFailure {
                code: "unknown_probe".to_string(),
                message: format!("unknown probeId: {probe_id}"),
                timed_out: false,
            }),
        }
    }

    fn run_tailscale_status(&self) -> Result<Value, ProbeFailure> {
        let raw = if let Some(fixture_path) = self.options.tailscale_status_fixture.as_ref() {
            match fs::read_to_string(fixture_path) {
                Ok(value) => value,
                Err(_) => return Ok(Value::Null),
            }
        } else {
            match run_capped_command(
                &self.options.tailscale_bin,
                &["status", "--json"],
                None,
                self.options.tailscale_timeout,
                4 * 1024 * 1024,
                256 * 1024,
            ) {
                Ok(output) => output.stdout,
                Err(error) if is_domain_unavailable_command_error(&error) => {
                    return Ok(Value::Null)
                }
                Err(error) => return Err(command_failure_to_probe(error, TAILSCALE_STATUS_ID)),
            }
        };
        let parsed: Value = serde_json::from_str(&raw).map_err(|error| ProbeFailure {
            code: "parse_error".to_string(),
            message: format!("failed to parse tailscale status JSON: {error}"),
            timed_out: false,
        })?;
        Ok(summarize_tailscale_status(&parsed))
    }

    fn run_git_build_info(&self, repo_root: &str) -> Result<Value, ProbeFailure> {
        let metadata = self.load_static_git_metadata(repo_root);
        let branch = self.git_value(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]);
        let dirty_status = self.git_output(repo_root, &["status", "--porcelain"]);
        Ok(json!({
            "repoRoot": repo_root,
            "commit": metadata.commit,
            "bootBranch": metadata.boot_branch,
            "branch": branch.or(metadata.boot_branch.clone()),
            "dirty": dirty_status.as_ref().map(|value| !value.trim().is_empty()),
            "metadataAt": metadata.metadata_at,
            "statusAt": epoch_ms(),
        }))
    }

    fn load_static_git_metadata(&self, repo_root: &str) -> StaticGitBuildMetadata {
        {
            let (lock, _) = &*self.state;
            let state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(metadata) = state.git_static.get(repo_root) {
                return metadata.clone();
            }
        }
        let metadata = StaticGitBuildMetadata {
            commit: self.git_value(repo_root, &["rev-parse", "--short", "HEAD"]),
            boot_branch: self.git_value(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]),
            metadata_at: epoch_ms(),
        };
        let (lock, _) = &*self.state;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .git_static
            .entry(repo_root.to_string())
            .or_insert_with(|| metadata.clone())
            .clone()
    }

    fn git_output(&self, repo_root: &str, args: &[&str]) -> Option<String> {
        let mut command_args = vec!["-C", repo_root];
        command_args.extend(args.iter().copied());
        match run_capped_command(
            &self.options.git_bin,
            &command_args,
            None,
            self.options.git_timeout,
            256 * 1024,
            64 * 1024,
        ) {
            Ok(output) => Some(output.stdout),
            Err(error) if is_domain_unavailable_command_error(&error) => None,
            Err(_) => None,
        }
    }

    fn git_value(&self, repo_root: &str, args: &[&str]) -> Option<String> {
        self.git_output(repo_root, args)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
}

pub fn serve(options: ProbeServerOptions) -> Result<(), String> {
    prepare_socket_path(&options.socket_path)?;
    let listener = UnixListener::bind(&options.socket_path).map_err(|error| {
        format!(
            "failed to bind probe socket {}: {error}",
            options.socket_path.display()
        )
    })?;
    fs::set_permissions(&options.socket_path, fs::Permissions::from_mode(0o600)).map_err(
        |error| {
            format!(
                "failed to set probe socket mode {}: {error}",
                options.socket_path.display()
            )
        },
    )?;
    eprintln!("[scoutd probes] serving {}", options.socket_path.display());

    let engine = ProbeEngine::new(options);
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let engine = engine.clone();
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, engine) {
                        eprintln!("[scoutd probes] connection failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("[scoutd probes] accept failed: {error}"),
        }
    }
    Ok(())
}

pub fn probe_server_status(socket_path: &Path) -> ProbeServerStatus {
    let socket_exists = socket_path.exists();
    match request_capabilities(socket_path, Duration::from_millis(500)) {
        Ok((daemon_version, families)) => ProbeServerStatus {
            socket_path: socket_path.to_string_lossy().to_string(),
            socket_exists,
            reachable: true,
            daemon_version: Some(daemon_version),
            families,
            error: None,
        },
        Err(error) => ProbeServerStatus {
            socket_path: socket_path.to_string_lossy().to_string(),
            socket_exists,
            reachable: false,
            daemon_version: None,
            families: Vec::new(),
            error: Some(error),
        },
    }
}

fn request_capabilities(
    socket_path: &Path,
    timeout: Duration,
) -> Result<(String, Vec<ProbeCapability>), String> {
    let mut stream = UnixStream::connect(socket_path).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(br#"{"schema":"openscout.probe.capabilities/v1"}"#)
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let schema = value
        .get("schema")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if schema != CAPABILITIES_SCHEMA {
        return Err(format!("unexpected probe capabilities schema: {schema}"));
    }
    let daemon_version = value
        .get("daemonVersion")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let families = serde_json::from_value::<Vec<ProbeCapability>>(
        value
            .get("families")
            .cloned()
            .unwrap_or(Value::Array(Vec::new())),
    )
    .map_err(|error| error.to_string())?;
    Ok((daemon_version, families))
}

fn handle_connection(mut stream: UnixStream, engine: ProbeEngine) -> Result<(), String> {
    let bytes = read_one_request(&mut stream)?;
    let response = if bytes.len() as u64 > REQUEST_READ_CAP_BYTES {
        error_response("request_too_large", "probe request exceeded the read limit")
    } else {
        match parse_request(&bytes) {
            Ok(ParsedRequest::Capabilities) => capabilities_response(engine.capabilities()),
            Ok(ParsedRequest::Probe(request)) => {
                let probe_id = request.probe_id.unwrap_or_default();
                match serde_json::to_value(engine.snapshot(
                    &probe_id,
                    request.key,
                    request.max_age_ms,
                )) {
                    Ok(value) => value,
                    Err(error) => error_response("serialize_error", &error.to_string()),
                }
            }
            Err(error) => error_response(&error.code, &error.message),
        }
    };
    let payload = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    stream
        .write_all(&payload)
        .map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    Ok(())
}

fn read_one_request(stream: &mut UnixStream) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(index) = bytes.iter().position(|byte| *byte == b'\n') {
            bytes.truncate(index);
            break;
        }
        if bytes.len() as u64 > REQUEST_READ_CAP_BYTES {
            break;
        }
    }
    Ok(bytes)
}

#[derive(Debug)]
enum ParsedRequest {
    Capabilities,
    Probe(ProbeRequest),
}

fn parse_request(bytes: &[u8]) -> Result<ParsedRequest, ProbeFailure> {
    let value: Value = serde_json::from_slice(bytes).map_err(|error| ProbeFailure {
        code: "invalid_json".to_string(),
        message: format!("malformed probe request JSON: {error}"),
        timed_out: false,
    })?;
    let schema = value
        .get("schema")
        .and_then(Value::as_str)
        .ok_or_else(|| ProbeFailure {
            code: "invalid_request".to_string(),
            message: "probe request missing schema".to_string(),
            timed_out: false,
        })?;
    match schema {
        CAPABILITIES_SCHEMA => Ok(ParsedRequest::Capabilities),
        REQUEST_SCHEMA => {
            let request: ProbeRequest =
                serde_json::from_value(value).map_err(|error| ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: format!("invalid probe request: {error}"),
                    timed_out: false,
                })?;
            if request
                .probe_id
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err(ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: "probe request missing probeId".to_string(),
                    timed_out: false,
                });
            }
            Ok(ParsedRequest::Probe(request))
        }
        other => Err(ProbeFailure {
            code: "unsupported_schema".to_string(),
            message: format!("unsupported probe request schema: {other}"),
            timed_out: false,
        }),
    }
}

fn capabilities_response(families: Vec<ProbeCapability>) -> Value {
    json!({
        "schema": CAPABILITIES_SCHEMA,
        "daemonVersion": DAEMON_VERSION,
        "families": families,
    })
}

fn served_capabilities() -> Vec<ProbeCapability> {
    vec![
        ProbeCapability {
            probe_id: TAILSCALE_STATUS_ID.to_string(),
            schema_version: 1,
            ttl_ms: TAILSCALE_STATUS_TTL_MS,
        },
        ProbeCapability {
            probe_id: GIT_BUILD_INFO_ID.to_string(),
            schema_version: 1,
            ttl_ms: GIT_BUILD_INFO_TTL_MS,
        },
    ]
}

fn error_response(code: &str, message: &str) -> Value {
    json!({
        "schema": ERROR_SCHEMA,
        "error": {
            "code": code,
            "message": message,
        },
        "daemonVersion": DAEMON_VERSION,
    })
}

fn error_snapshot(
    probe_id: &str,
    key: Option<String>,
    ttl_ms: u64,
    error: ProbeFailure,
) -> ProbeSnapshotResponse {
    ProbeSnapshotResponse {
        schema: SNAPSHOT_SCHEMA.to_string(),
        probe_id: probe_id.to_string(),
        key,
        generated_at: epoch_ms(),
        ttl_ms,
        value: Value::Null,
        error: Some(JsonError {
            code: error.code,
            message: error.message,
            timed_out: if error.timed_out { Some(true) } else { None },
        }),
        daemon_version: DAEMON_VERSION.to_string(),
    }
}

fn snapshot_is_fresh_for(snapshot: &ProbeSnapshotResponse, max_age_ms: u64) -> bool {
    if max_age_ms == 0 {
        return false;
    }
    epoch_ms().saturating_sub(snapshot.generated_at) <= u128::from(max_age_ms)
}

fn is_supported_probe(probe_id: &str) -> bool {
    matches!(probe_id, TAILSCALE_STATUS_ID | GIT_BUILD_INFO_ID)
}

fn probe_ttl_ms(probe_id: &str) -> Option<u64> {
    match probe_id {
        TAILSCALE_STATUS_ID => Some(TAILSCALE_STATUS_TTL_MS),
        GIT_BUILD_INFO_ID => Some(GIT_BUILD_INFO_TTL_MS),
        _ => None,
    }
}

fn normalize_probe_key(
    probe_id: &str,
    key: Option<String>,
) -> Result<Option<String>, ProbeFailure> {
    match probe_id {
        TAILSCALE_STATUS_ID => Ok(None),
        GIT_BUILD_INFO_ID => {
            let raw_key = key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: "git.buildInfo requires a repo root key".to_string(),
                    timed_out: false,
                })?;
            Ok(Some(canonical_repo_root(raw_key)))
        }
        _ => Ok(key),
    }
}

fn summarize_tailscale_status(status: &Value) -> Value {
    let backend_state = status.get("BackendState").and_then(Value::as_str);
    let running = backend_state
        .map(|value| value.trim().eq_ignore_ascii_case("running"))
        .unwrap_or(false);
    let health = status
        .get("Health")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(|value| Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "backendState": backend_state,
        "running": running,
        "health": health,
        "peers": parse_tailscale_peers(status),
        "self": parse_tailscale_self(status),
    })
}

fn parse_tailscale_peers(status: &Value) -> Value {
    let Some(peers) = status.get("Peer").and_then(Value::as_object) else {
        return Value::Array(Vec::new());
    };
    Value::Array(
        peers
            .iter()
            .map(|(fallback_id, peer)| {
                let id = string_field(peer, "ID").unwrap_or_else(|| fallback_id.clone());
                let name = string_field(peer, "HostName")
                    .or_else(|| string_field(peer, "DNSName"))
                    .unwrap_or_else(|| fallback_id.clone());
                let mut map = Map::new();
                map.insert("id".to_string(), Value::String(id));
                map.insert("name".to_string(), Value::String(name));
                insert_string_if_present(&mut map, "dnsName", string_field(peer, "DNSName"));
                map.insert(
                    "addresses".to_string(),
                    string_array_field(peer, "TailscaleIPs"),
                );
                map.insert(
                    "online".to_string(),
                    Value::Bool(peer.get("Online").and_then(Value::as_bool).unwrap_or(false)),
                );
                insert_string_if_present(&mut map, "hostName", string_field(peer, "HostName"));
                insert_string_if_present(&mut map, "os", string_field(peer, "OS"));
                map.insert("tags".to_string(), string_array_field(peer, "Tags"));
                Value::Object(map)
            })
            .collect(),
    )
}

fn parse_tailscale_self(status: &Value) -> Value {
    let Some(self_node) = status.get("Self") else {
        return Value::Null;
    };
    let id = string_field(self_node, "ID")
        .or_else(|| string_field(self_node, "DNSName"))
        .or_else(|| string_field(self_node, "HostName"))
        .unwrap_or_else(|| "self".to_string());
    let name = string_field(self_node, "HostName")
        .or_else(|| string_field(self_node, "DNSName"))
        .unwrap_or_else(|| "self".to_string());
    let mut map = Map::new();
    map.insert("id".to_string(), Value::String(id));
    map.insert("name".to_string(), Value::String(name));
    insert_string_if_present(&mut map, "dnsName", string_field(self_node, "DNSName"));
    map.insert(
        "addresses".to_string(),
        string_array_field(self_node, "TailscaleIPs"),
    );
    map.insert(
        "online".to_string(),
        Value::Bool(
            self_node
                .get("Online")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        ),
    );
    insert_string_if_present(&mut map, "hostName", string_field(self_node, "HostName"));
    insert_string_if_present(&mut map, "os", string_field(self_node, "OS"));
    if let Some(tailnet) = status.get("CurrentTailnet") {
        insert_string_if_present(&mut map, "tailnetName", string_field(tailnet, "Name"));
        insert_string_if_present(
            &mut map,
            "magicDnsSuffix",
            string_field(tailnet, "MagicDNSSuffix"),
        );
    }
    Value::Object(map)
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::to_string)
}

fn string_array_field(value: &Value, field: &str) -> Value {
    Value::Array(
        value
            .get(field)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|value| Value::String(value.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    )
}

fn insert_string_if_present(map: &mut Map<String, Value>, field: &str, value: Option<String>) {
    if let Some(value) = value {
        map.insert(field.to_string(), Value::String(value));
    }
}

fn canonical_repo_root(raw_path: &str) -> String {
    let mut current = realpath_or_resolved(&directory_or_parent(Path::new(raw_path)));
    loop {
        if current.join(".git").exists() {
            return realpath_or_resolved(&current).to_string_lossy().to_string();
        }
        let Some(parent) = current.parent() else {
            return realpath_or_resolved(&directory_or_parent(Path::new(raw_path)))
                .to_string_lossy()
                .to_string();
        };
        if parent == current {
            return realpath_or_resolved(&directory_or_parent(Path::new(raw_path)))
                .to_string_lossy()
                .to_string();
        }
        current = parent.to_path_buf();
    }
}

fn directory_or_parent(path: &Path) -> PathBuf {
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    match fs::metadata(&resolved) {
        Ok(metadata) if metadata.is_dir() => resolved,
        Ok(_) => resolved
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| resolved.clone()),
        Err(_) => resolved,
    }
}

fn realpath_or_resolved(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn run_capped_command(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
) -> Result<CommandResult, CommandFailure> {
    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command_builder.current_dir(cwd);
    }
    let mut child = command_builder.spawn().map_err(|error| CommandFailure {
        code: error
            .raw_os_error()
            .map(|_| "spawn".to_string())
            .unwrap_or_else(|| "spawn".to_string()),
        message: format!("{command}: {error}"),
        timed_out: false,
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = stdout.map(|mut stdout| {
        thread::spawn(move || read_limited(&mut stdout, max_stdout_bytes, "stdout"))
    });
    let stderr_reader = stderr.map(|mut stderr| {
        thread::spawn(move || read_limited(&mut stderr, max_stderr_bytes, "stderr"))
    });

    let status = wait_child_with_timeout(&mut child, timeout).map_err(|error| CommandFailure {
        code: "wait".to_string(),
        message: error,
        timed_out: false,
    })?;
    let stdout = join_reader(stdout_reader)??;
    let _stderr = join_reader(stderr_reader)??;

    if let Some(status) = status {
        if status.success() {
            return Ok(CommandResult {
                stdout: String::from_utf8_lossy(&stdout).to_string(),
            });
        }
        return Err(CommandFailure {
            code: "exit".to_string(),
            message: format!("{command} exited with {}", status.code().unwrap_or(1)),
            timed_out: false,
        });
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(CommandFailure {
        code: "timeout".to_string(),
        message: format!("{command} timed out after {}ms", timeout.as_millis()),
        timed_out: true,
    })
}

fn wait_child_with_timeout(
    child: &mut Child,
    timeout: Duration,
) -> Result<Option<std::process::ExitStatus>, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_limited<R: Read>(
    reader: &mut R,
    max_bytes: usize,
    stream_name: &'static str,
) -> Result<Vec<u8>, CommandFailure> {
    let mut bytes = Vec::new();
    let mut buf = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buf).map_err(|error| CommandFailure {
            code: "io".to_string(),
            message: error.to_string(),
            timed_out: false,
        })?;
        if read == 0 {
            return Ok(bytes);
        }
        bytes.extend_from_slice(&buf[..read]);
        if bytes.len() > max_bytes {
            return Err(CommandFailure {
                code: "output_cap".to_string(),
                message: format!("probe {stream_name} exceeded {max_bytes} bytes"),
                timed_out: false,
            });
        }
    }
}

fn join_reader(
    handle: Option<thread::JoinHandle<Result<Vec<u8>, CommandFailure>>>,
) -> Result<Result<Vec<u8>, CommandFailure>, CommandFailure> {
    match handle {
        Some(handle) => handle.join().map_err(|_| CommandFailure {
            code: "thread".to_string(),
            message: "probe output reader panicked".to_string(),
            timed_out: false,
        }),
        None => Ok(Ok(Vec::new())),
    }
}

fn is_domain_unavailable_command_error(error: &CommandFailure) -> bool {
    matches!(error.code.as_str(), "spawn" | "exit")
}

fn command_failure_to_probe(error: CommandFailure, probe_id: &str) -> ProbeFailure {
    ProbeFailure {
        code: error.code,
        message: format!("Probe {probe_id} failed: {}", error.message),
        timed_out: error.timed_out,
    }
}

fn prepare_socket_path(socket_path: &Path) -> Result<(), String> {
    if let Some(parent) = socket_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create probe socket directory {}: {error}",
                parent.display()
            )
        })?;
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
    }
    match fs::symlink_metadata(socket_path) {
        Ok(metadata) => {
            if metadata.file_type().is_socket() {
                let _ = fs::remove_file(socket_path);
                Ok(())
            } else {
                Err(format!(
                    "probe socket path exists and is not a socket: {}",
                    socket_path.display()
                ))
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to inspect probe socket {}: {error}",
            socket_path.display()
        )),
    }
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_duration_ms(name: &str) -> Option<Duration> {
    env_nonempty(name)
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
}

#[cfg(test)]
mod tests {
    use super::{serve, ProbeServerOptions, CAPABILITIES_SCHEMA, ERROR_SCHEMA, SNAPSHOT_SCHEMA};
    use serde_json::Value;
    use std::fs;
    use std::io::{Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixStream;
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = PathBuf::from("/tmp").join(format!("{prefix}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_executable(path: &Path, body: &str) {
        fs::write(path, body).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn start_test_server(options: ProbeServerOptions) {
        let socket_path = options.socket_path.clone();
        thread::spawn(move || {
            let _ = serve(options);
        });
        for _ in 0..100 {
            if socket_path.exists() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("server did not create socket {}", socket_path.display());
    }

    fn request(socket_path: &Path, payload: &str) -> Value {
        let mut stream = UnixStream::connect(socket_path).unwrap();
        stream.write_all(payload.as_bytes()).unwrap();
        let _ = stream.shutdown(std::net::Shutdown::Write);
        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn base_options(socket_path: PathBuf) -> ProbeServerOptions {
        ProbeServerOptions {
            socket_path,
            tailscale_bin: "tailscale".to_string(),
            git_bin: "git".to_string(),
            tailscale_status_fixture: None,
            tailscale_timeout: Duration::from_millis(1_500),
            git_timeout: Duration::from_millis(1_500),
        }
    }

    #[test]
    fn capabilities_and_unknown_probe_use_one_json_response_per_connection() {
        let dir = unique_temp_dir("scoutd-probes-capabilities");
        let socket_path = dir.join("probes.sock");
        start_test_server(base_options(socket_path.clone()));

        let capabilities = request(
            &socket_path,
            r#"{"schema":"openscout.probe.capabilities/v1"}"#,
        );
        assert_eq!(
            capabilities.get("schema").and_then(Value::as_str),
            Some(CAPABILITIES_SCHEMA)
        );
        assert_eq!(
            capabilities
                .get("families")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            2
        );

        let unknown = request(
            &socket_path,
            r#"{"schema":"openscout.probe.request/v1","probeId":"missing.probe","maxAgeMs":0}"#,
        );
        assert_eq!(
            unknown.get("schema").and_then(Value::as_str),
            Some(SNAPSHOT_SCHEMA)
        );
        assert_eq!(
            unknown.pointer("/error/code").and_then(Value::as_str),
            Some("unknown_probe")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn malformed_request_returns_structured_error_response() {
        let dir = unique_temp_dir("scoutd-probes-malformed");
        let socket_path = dir.join("probes.sock");
        start_test_server(base_options(socket_path.clone()));

        let malformed = request(&socket_path, "not-json");
        assert_eq!(
            malformed.get("schema").and_then(Value::as_str),
            Some(ERROR_SCHEMA)
        );
        assert_eq!(
            malformed.pointer("/error/code").and_then(Value::as_str),
            Some("invalid_json")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_clients_share_one_underlying_exec_per_ttl() {
        let dir = unique_temp_dir("scoutd-probes-single-flight");
        let socket_path = dir.join("probes.sock");
        let counter_path = dir.join("count");
        let tailscale = dir.join("tailscale");
        write_executable(
            &tailscale,
            &format!(
                r#"#!/bin/sh
if [ "$1" = "status" ]; then
  printf x >> {}
  sleep 0.2
  cat <<'JSON'
{{"BackendState":"Running","Health":[],"Self":{{"ID":"self-node","HostName":"workstation","TailscaleIPs":["100.64.0.10"],"Online":true}},"Peer":{{}}}}
JSON
  exit 0
fi
exit 64
"#,
                shell_quote(&counter_path.to_string_lossy())
            ),
        );
        let mut options = base_options(socket_path.clone());
        options.tailscale_bin = tailscale.to_string_lossy().to_string();
        start_test_server(options);

        let payload = r#"{"schema":"openscout.probe.request/v1","probeId":"tailscale.status","maxAgeMs":30000}"#;
        let left_path = socket_path.clone();
        let right_path = socket_path.clone();
        let left = thread::spawn(move || request(&left_path, payload));
        let right = thread::spawn(move || request(&right_path, payload));
        let left = left.join().unwrap();
        let right = right.join().unwrap();
        assert_eq!(
            left.pointer("/value/running").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            right
                .pointer("/value/self/hostName")
                .and_then(Value::as_str),
            Some("workstation")
        );
        assert_eq!(fs::read_to_string(&counter_path).unwrap(), "x");

        let cached = request(&socket_path, payload);
        assert_eq!(
            cached.pointer("/value/running").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(fs::read_to_string(&counter_path).unwrap(), "x");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn probe_timeout_returns_snapshot_error_without_crashing_server() {
        let dir = unique_temp_dir("scoutd-probes-timeout");
        let socket_path = dir.join("probes.sock");
        let tailscale = dir.join("tailscale");
        write_executable(
            &tailscale,
            r#"#!/bin/sh
sleep 1
exit 0
"#,
        );
        let mut options = base_options(socket_path.clone());
        options.tailscale_bin = tailscale.to_string_lossy().to_string();
        options.tailscale_timeout = Duration::from_millis(50);
        start_test_server(options);

        let timed_out = request(
            &socket_path,
            r#"{"schema":"openscout.probe.request/v1","probeId":"tailscale.status","maxAgeMs":0}"#,
        );
        assert_eq!(
            timed_out.get("schema").and_then(Value::as_str),
            Some(SNAPSHOT_SCHEMA)
        );
        assert_eq!(
            timed_out.pointer("/error/code").and_then(Value::as_str),
            Some("timeout")
        );
        assert_eq!(
            timed_out
                .pointer("/error/timed_out")
                .and_then(Value::as_bool),
            Some(true)
        );

        let capabilities = request(
            &socket_path,
            r#"{"schema":"openscout.probe.capabilities/v1"}"#,
        );
        assert_eq!(
            capabilities.get("schema").and_then(Value::as_str),
            Some(CAPABILITIES_SCHEMA)
        );

        let _ = fs::remove_dir_all(dir);
    }

    fn shell_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}
