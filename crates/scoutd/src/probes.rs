use scoutd::repo_service;
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
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CAPABILITIES_SCHEMA: &str = "openscout.probe.capabilities/v1";
const REQUEST_SCHEMA: &str = "openscout.probe.request/v1";
const SNAPSHOT_SCHEMA: &str = "openscout.probe.snapshot/v1";
const ERROR_SCHEMA: &str = "openscout.probe.error/v1";
const REPO_SCAN_SCHEMA: &str = "openscout.repo.scan/v1";
const REPO_DIFF_SCHEMA: &str = "openscout.repo.diff/v1";
const REPO_RESPONSE_SCHEMA: &str = "openscout.repo.response/v1";
const EXEC_REQUEST_SCHEMA: &str = "openscout.exec.request/v1";
const EXEC_RESPONSE_SCHEMA: &str = "openscout.exec.response/v1";
const REPO_SCAN_CAPABILITY_ID: &str = "repo.scan";
const REPO_DIFF_CAPABILITY_ID: &str = "repo.diff";
const TAILSCALE_STATUS_ID: &str = "tailscale.status";
const GIT_BUILD_INFO_ID: &str = "git.buildInfo";
const TAILSCALE_STATUS_TTL_MS: u64 = 30_000;
const GIT_BUILD_INFO_TTL_MS: u64 = 60_000;
const DEFAULT_TAILSCALE_TIMEOUT: Duration = Duration::from_millis(1_500);
const DEFAULT_GIT_TIMEOUT: Duration = Duration::from_millis(1_500);
const DEFAULT_REPO_JOB_TIMEOUT: Duration = Duration::from_millis(20_000);
const DEFAULT_REPO_JOB_RESPONSE_CAP_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_REPO_JOB_WORKERS: usize = 4;
const DEFAULT_REPO_JOB_QUEUE: usize = 32;
const DEFAULT_EXEC_JOB_WORKERS: usize = 4;
const DEFAULT_EXEC_JOB_QUEUE: usize = 32;
const DEFAULT_CONNECTION_WORKERS: usize = 32;
const DEFAULT_CONNECTION_QUEUE: usize = 64;
const REQUEST_READ_CAP_BYTES: u64 = 8 * 1024 * 1024;
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

const EXEC_VERBS: &[&str] = &[
    "tmux.sendKeys",
    "tmux.sendKeysLiteral",
    "tmux.loadBuffer",
    "tmux.pasteBuffer",
    "tmux.deleteBuffer",
    "tmux.killSession",
    "tmux.newSession",
    "tmux.detachClient",
    "tailscale.cert",
    "reveal.open",
];

#[derive(Clone, Debug)]
pub struct ProbeServerOptions {
    pub socket_path: PathBuf,
    pub tailscale_bin: String,
    pub git_bin: String,
    pub tmux_bin: String,
    pub tailscale_status_fixture: Option<PathBuf>,
    pub tailscale_timeout: Duration,
    pub git_timeout: Duration,
    pub repo_job_timeout: Duration,
    pub repo_job_response_cap_bytes: usize,
    pub repo_job_workers: usize,
    pub repo_job_queue: usize,
    pub exec_job_workers: usize,
    pub exec_job_queue: usize,
    pub connection_workers: usize,
    pub connection_queue: usize,
}

impl ProbeServerOptions {
    pub fn from_env(socket_path: PathBuf) -> Self {
        Self {
            socket_path,
            tailscale_bin: env_nonempty("OPENSCOUT_TAILSCALE_BIN")
                .unwrap_or_else(|| "tailscale".to_string()),
            git_bin: env_nonempty("OPENSCOUT_GIT_BIN").unwrap_or_else(|| "git".to_string()),
            tmux_bin: env_nonempty("OPENSCOUT_TMUX_BIN").unwrap_or_else(|| "tmux".to_string()),
            tailscale_status_fixture: env_nonempty("OPENSCOUT_TAILSCALE_STATUS_JSON")
                .map(PathBuf::from),
            tailscale_timeout: env_duration_ms("OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS")
                .unwrap_or(DEFAULT_TAILSCALE_TIMEOUT),
            git_timeout: env_duration_ms("OPENSCOUT_GIT_BUILD_INFO_TIMEOUT_MS")
                .unwrap_or(DEFAULT_GIT_TIMEOUT),
            repo_job_timeout: env_duration_ms("OPENSCOUT_REPO_JOB_TIMEOUT_MS")
                .unwrap_or(DEFAULT_REPO_JOB_TIMEOUT),
            repo_job_response_cap_bytes: env_usize("OPENSCOUT_REPO_JOB_RESPONSE_MAX_BYTES")
                .unwrap_or(DEFAULT_REPO_JOB_RESPONSE_CAP_BYTES),
            repo_job_workers: env_usize("OPENSCOUT_REPO_JOB_WORKERS")
                .unwrap_or(DEFAULT_REPO_JOB_WORKERS)
                .max(1),
            repo_job_queue: env_usize("OPENSCOUT_REPO_JOB_QUEUE").unwrap_or(DEFAULT_REPO_JOB_QUEUE),
            exec_job_workers: env_usize("OPENSCOUT_EXEC_JOB_WORKERS")
                .unwrap_or(DEFAULT_EXEC_JOB_WORKERS)
                .max(1),
            exec_job_queue: env_usize("OPENSCOUT_EXEC_JOB_QUEUE").unwrap_or(DEFAULT_EXEC_JOB_QUEUE),
            connection_workers: env_usize("OPENSCOUT_PROBE_CONNECTION_WORKERS")
                .unwrap_or(DEFAULT_CONNECTION_WORKERS)
                .max(1),
            connection_queue: env_usize("OPENSCOUT_PROBE_CONNECTION_QUEUE")
                .unwrap_or(DEFAULT_CONNECTION_QUEUE),
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
pub struct ExecVerbCapability {
    pub verb: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RepoJobResponse {
    schema: String,
    operation: String,
    #[serde(rename = "generatedAt")]
    generated_at: u128,
    value: Value,
    error: Option<JsonError>,
    #[serde(rename = "daemonVersion")]
    daemon_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ExecResponse {
    schema: String,
    verb: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonError>,
    #[serde(rename = "daemonVersion")]
    daemon_version: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RepoOperation {
    Scan,
    Diff,
}

impl RepoOperation {
    fn capability_id(self) -> &'static str {
        match self {
            Self::Scan => REPO_SCAN_CAPABILITY_ID,
            Self::Diff => REPO_DIFF_CAPABILITY_ID,
        }
    }
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

#[derive(Debug, Deserialize)]
struct ExecRequest {
    verb: Option<String>,
    #[serde(default)]
    args: Value,
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
    stderr: String,
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

#[derive(Debug, Default)]
struct JobLimiterState {
    active: usize,
    queued: usize,
}

#[derive(Clone, Debug)]
struct JobLimiter {
    label: &'static str,
    max_active: usize,
    max_queue: usize,
    state: Arc<(Mutex<JobLimiterState>, Condvar)>,
}

#[derive(Debug)]
struct JobPermit {
    state: Arc<(Mutex<JobLimiterState>, Condvar)>,
}

impl Drop for JobPermit {
    fn drop(&mut self) {
        let (lock, cvar) = &*self.state;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active = state.active.saturating_sub(1);
        cvar.notify_one();
    }
}

impl JobLimiter {
    fn new(label: &'static str, max_active: usize, max_queue: usize) -> Self {
        Self {
            label,
            max_active: max_active.max(1),
            max_queue,
            state: Arc::new((Mutex::new(JobLimiterState::default()), Condvar::new())),
        }
    }

    fn acquire(&self) -> Result<JobPermit, ProbeFailure> {
        let (lock, cvar) = &*self.state;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.active < self.max_active {
            state.active += 1;
            return Ok(JobPermit {
                state: Arc::clone(&self.state),
            });
        }
        if state.queued >= self.max_queue {
            return Err(ProbeFailure {
                code: "busy".to_string(),
                message: format!(
                    "{} queue is full (active={}, queued={}, maxQueue={})",
                    self.label, state.active, state.queued, self.max_queue
                ),
                timed_out: false,
            });
        }
        state.queued += 1;
        loop {
            state = cvar
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.active < self.max_active {
                state.queued = state.queued.saturating_sub(1);
                state.active += 1;
                return Ok(JobPermit {
                    state: Arc::clone(&self.state),
                });
            }
        }
    }
}

#[derive(Clone, Debug)]
struct ProbeEngine {
    options: ProbeServerOptions,
    state: Arc<(Mutex<ProbeEngineState>, Condvar)>,
    repo_jobs: JobLimiter,
    exec_jobs: JobLimiter,
}

impl ProbeEngine {
    fn new(options: ProbeServerOptions) -> Self {
        let repo_jobs =
            JobLimiter::new("repo job", options.repo_job_workers, options.repo_job_queue);
        let exec_jobs =
            JobLimiter::new("exec job", options.exec_job_workers, options.exec_job_queue);
        Self {
            options,
            state: Arc::new((Mutex::new(ProbeEngineState::default()), Condvar::new())),
            repo_jobs,
            exec_jobs,
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

    fn run_repo_job(&self, operation: RepoOperation, input: Value) -> RepoJobResponse {
        let result = match self.repo_jobs.acquire() {
            Ok(_permit) => {
                run_repo_operation_with_timeout(operation, input, self.options.repo_job_timeout)
            }
            Err(error) => Err(error),
        };
        match result {
            Ok(value) => repo_job_response(operation, value, None),
            Err(error) => repo_job_response(
                operation,
                Value::Null,
                Some(JsonError {
                    code: error.code,
                    message: error.message,
                    timed_out: if error.timed_out { Some(true) } else { None },
                }),
            ),
        }
    }

    fn run_exec_job(&self, verb: String, args: Value) -> ExecResponse {
        let result = match self.exec_jobs.acquire() {
            Ok(_permit) => self.run_exec_verb(&verb, args),
            Err(error) => Err(error),
        };
        match result {
            Ok(value) => exec_response(&verb, true, Some(value), None),
            Err(error) => exec_response(
                &verb,
                false,
                None,
                Some(JsonError {
                    code: error.code,
                    message: error.message,
                    timed_out: if error.timed_out { Some(true) } else { None },
                }),
            ),
        }
    }

    fn run_exec_verb(&self, verb: &str, args: Value) -> Result<Value, ProbeFailure> {
        if !EXEC_VERBS.contains(&verb) {
            return Err(ProbeFailure {
                code: "unknown_verb".to_string(),
                message: format!("unknown exec verb: {verb}"),
                timed_out: false,
            });
        }
        let object = args.as_object().ok_or_else(|| ProbeFailure {
            code: "invalid_request".to_string(),
            message: format!("{verb} args must be an object"),
            timed_out: false,
        })?;
        match verb {
            "tmux.sendKeys" => self.exec_tmux_send_keys(object),
            "tmux.sendKeysLiteral" => self.exec_tmux_send_keys_literal(object),
            "tmux.loadBuffer" => self.exec_tmux_load_buffer(object),
            "tmux.pasteBuffer" => self.exec_tmux_paste_buffer(object),
            "tmux.deleteBuffer" => self.exec_tmux_delete_buffer(object),
            "tmux.killSession" => self.exec_tmux_kill_session(object),
            "tmux.newSession" => self.exec_tmux_new_session(object),
            "tmux.detachClient" => self.exec_tmux_detach_client(object),
            "tailscale.cert" => self.exec_tailscale_cert(object),
            "reveal.open" => self.exec_reveal_open(object),
            _ => Err(ProbeFailure {
                code: "unknown_verb".to_string(),
                message: format!("unknown exec verb: {verb}"),
                timed_out: false,
            }),
        }
    }

    fn exec_tmux_send_keys(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let target = required_tmux_target(args, "target")?;
        let keys = required_string_array(args, "keys", validate_tmux_key)?;
        if keys.is_empty() {
            return Err(invalid_args("tmux.sendKeys requires at least one key"));
        }
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend(["send-keys".to_string(), "-t".to_string(), target]);
        command_args.extend(keys);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_send_keys_literal(
        &self,
        args: &Map<String, Value>,
    ) -> Result<Value, ProbeFailure> {
        let target = required_tmux_target(args, "target")?;
        let text = required_bounded_string(args, "text", 128 * 1024, allow_text_payload)?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend([
            "send-keys".to_string(),
            "-t".to_string(),
            target,
            "-l".to_string(),
            text,
        ]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_load_buffer(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let buffer_name = required_buffer_name(args, "bufferName")?;
        let content =
            required_bounded_string(args, "content", 4 * 1024 * 1024, allow_text_payload)?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend([
            "load-buffer".to_string(),
            "-b".to_string(),
            buffer_name,
            "-".to_string(),
        ]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            Some(content.into_bytes()),
            args,
            ExecVerbLimits::tmux_large_input(),
        )
    }

    fn exec_tmux_paste_buffer(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let buffer_name = required_buffer_name(args, "bufferName")?;
        let target = required_tmux_target(args, "target")?;
        let flags = optional_string(args, "flags").unwrap_or_else(|| "-dpr".to_string());
        validate_tmux_paste_flags(&flags)?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend([
            "paste-buffer".to_string(),
            flags,
            "-b".to_string(),
            buffer_name,
            "-t".to_string(),
            target,
        ]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_delete_buffer(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let buffer_name = required_buffer_name(args, "bufferName")?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend(["delete-buffer".to_string(), "-b".to_string(), buffer_name]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_kill_session(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let target = required_tmux_target(args, "target")?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend(["kill-session".to_string(), "-t".to_string(), target]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_detach_client(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let session_name = required_tmux_target(args, "sessionName")?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.extend(["detach-client".to_string(), "-s".to_string(), session_name]);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux(),
        )
    }

    fn exec_tmux_new_session(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let session_name = required_tmux_target(args, "sessionName")?;
        let command = required_bounded_string(args, "command", 16 * 1024, allow_tmux_command)?;
        let mut command_args = tmux_socket_prefix(args)?;
        command_args.push("new-session".to_string());
        let detached = optional_bool(args, "detached").unwrap_or(true);
        let print_pane = optional_bool(args, "printPane").unwrap_or(false);
        if detached && print_pane {
            command_args.push("-dP".to_string());
        } else {
            if detached {
                command_args.push("-d".to_string());
            }
            if print_pane {
                command_args.push("-P".to_string());
            }
        }
        if let Some(window_name) = optional_string(args, "windowName") {
            validate_tmux_window_name(&window_name)?;
            command_args.extend(["-n".to_string(), window_name]);
        }
        if let Some(columns) = optional_u16(args, "columns") {
            command_args.extend(["-x".to_string(), columns.to_string()]);
        }
        if let Some(rows) = optional_u16(args, "rows") {
            command_args.extend(["-y".to_string(), rows.to_string()]);
        }
        if let Some(format) = optional_string(args, "format") {
            validate_tmux_format(&format)?;
            command_args.extend(["-F".to_string(), format]);
        }
        command_args.extend(["-s".to_string(), session_name]);
        if let Some(cwd) = optional_string(args, "cwd") {
            validate_absolute_path(&cwd, "cwd")?;
            command_args.extend(["-c".to_string(), cwd]);
        }
        command_args.push(command);
        self.run_exec_command_json(
            &self.options.tmux_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tmux_new_session(),
        )
    }

    fn exec_tailscale_cert(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let cert_file = required_bounded_string(args, "certFile", 4096, |value| {
            validate_absolute_path(value, "certFile")
        })?;
        let key_file = required_bounded_string(args, "keyFile", 4096, |value| {
            validate_absolute_path(value, "keyFile")
        })?;
        let hostname = required_bounded_string(args, "hostname", 253, validate_hostname)?;
        let command_args = vec![
            "cert".to_string(),
            "--cert-file".to_string(),
            cert_file,
            "--key-file".to_string(),
            key_file,
            hostname,
        ];
        self.run_exec_command_json(
            &self.options.tailscale_bin,
            command_args,
            None,
            args,
            ExecVerbLimits::tailscale_cert(),
        )
    }

    fn exec_reveal_open(&self, args: &Map<String, Value>) -> Result<Value, ProbeFailure> {
        let target_path = required_bounded_string(args, "targetPath", 4096, |value| {
            validate_absolute_path(value, "targetPath")
        })?;
        let mode = required_bounded_string(args, "mode", 32, validate_reveal_mode)?;
        let (command, command_args) = match mode.as_str() {
            "darwinReveal" => ("open".to_string(), vec!["-R".to_string(), target_path]),
            "darwinOpen" => ("open".to_string(), vec![target_path]),
            "xdgOpen" => ("xdg-open".to_string(), vec![target_path]),
            "windowsSelect" => (
                "explorer.exe".to_string(),
                vec![format!("/select,{target_path}")],
            ),
            _ => return Err(invalid_args("unsupported reveal.open mode")),
        };
        self.run_exec_command_json(
            &command,
            command_args,
            None,
            args,
            ExecVerbLimits::reveal_open(),
        )
    }

    fn run_exec_command_json(
        &self,
        command: &str,
        args: Vec<String>,
        stdin: Option<Vec<u8>>,
        request_args: &Map<String, Value>,
        limits: ExecVerbLimits,
    ) -> Result<Value, ProbeFailure> {
        let timeout = requested_timeout(request_args, limits.default_timeout, limits.max_timeout)?;
        match run_capped_command_with_input(
            command,
            &args,
            stdin.as_deref(),
            None,
            timeout,
            limits.max_stdout_bytes,
            limits.max_stderr_bytes,
        ) {
            Ok(output) => Ok(json!({
                "stdout": output.stdout,
                "stderr": output.stderr,
                "exitCode": 0,
            })),
            Err(error) => Err(command_failure_to_exec(error, command)),
        }
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
        let metadata = self.load_static_git_metadata(repo_root)?;
        let branch = self.git_value(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let dirty_status = self.git_output(repo_root, &["status", "--porcelain"])?;
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

    fn load_static_git_metadata(
        &self,
        repo_root: &str,
    ) -> Result<StaticGitBuildMetadata, ProbeFailure> {
        {
            let (lock, _) = &*self.state;
            let state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(metadata) = state.git_static.get(repo_root) {
                return Ok(metadata.clone());
            }
        }
        let metadata = StaticGitBuildMetadata {
            commit: self.git_value(repo_root, &["rev-parse", "--short", "HEAD"])?,
            boot_branch: self.git_value(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?,
            metadata_at: epoch_ms(),
        };
        let (lock, _) = &*self.state;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(state
            .git_static
            .entry(repo_root.to_string())
            .or_insert_with(|| metadata.clone())
            .clone())
    }

    fn git_output(&self, repo_root: &str, args: &[&str]) -> Result<Option<String>, ProbeFailure> {
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
            Ok(output) => Ok(Some(output.stdout)),
            Err(error) if is_domain_unavailable_command_error(&error) => Ok(None),
            Err(error) => Err(command_failure_to_probe(error, GIT_BUILD_INFO_ID)),
        }
    }

    fn git_value(&self, repo_root: &str, args: &[&str]) -> Result<Option<String>, ProbeFailure> {
        Ok(self
            .git_output(repo_root, args)?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()))
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
    let connection_jobs = JobLimiter::new(
        "probe connection",
        engine.options.connection_workers,
        engine.options.connection_queue,
    );
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let permit = match connection_jobs.acquire() {
                    Ok(permit) => permit,
                    Err(error) => {
                        let response = error_response(&error.code, &error.message);
                        if let Ok(payload) = serde_json::to_vec(&response) {
                            let _ = stream.write_all(&payload);
                            let _ = stream.write_all(b"\n");
                        }
                        continue;
                    }
                };
                let engine = engine.clone();
                thread::spawn(move || {
                    let _permit = permit;
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
            Ok(ParsedRequest::Repo(request)) => {
                match serde_json::to_value(engine.run_repo_job(request.operation, request.body)) {
                    Ok(value) => value,
                    Err(error) => repo_job_error_response(
                        request.operation,
                        "serialize_error",
                        &error.to_string(),
                        false,
                    ),
                }
            }
            Ok(ParsedRequest::Exec(request)) => {
                let verb = request.verb.unwrap_or_default();
                match serde_json::to_value(engine.run_exec_job(verb.clone(), request.args)) {
                    Ok(value) => value,
                    Err(error) => {
                        exec_error_response(&verb, "serialize_error", &error.to_string(), false)
                    }
                }
            }
            Err(error) => error_response(&error.code, &error.message),
        }
    };
    let payload =
        serialize_response_with_cap(response, engine.options.repo_job_response_cap_bytes)?;
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
        let read = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
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
    Repo(RepoJobRequest),
    Exec(ExecRequest),
}

#[derive(Debug)]
struct RepoJobRequest {
    operation: RepoOperation,
    body: Value,
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
        REPO_SCAN_SCHEMA => Ok(ParsedRequest::Repo(RepoJobRequest {
            operation: RepoOperation::Scan,
            body: value,
        })),
        REPO_DIFF_SCHEMA => Ok(ParsedRequest::Repo(RepoJobRequest {
            operation: RepoOperation::Diff,
            body: value,
        })),
        EXEC_REQUEST_SCHEMA => {
            let request: ExecRequest =
                serde_json::from_value(value).map_err(|error| ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: format!("invalid exec request: {error}"),
                    timed_out: false,
                })?;
            if request
                .verb
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err(ProbeFailure {
                    code: "invalid_request".to_string(),
                    message: "exec request missing verb".to_string(),
                    timed_out: false,
                });
            }
            Ok(ParsedRequest::Exec(request))
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
        "verbs": served_exec_capabilities(),
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
        ProbeCapability {
            probe_id: REPO_SCAN_CAPABILITY_ID.to_string(),
            schema_version: 1,
            ttl_ms: 0,
        },
        ProbeCapability {
            probe_id: REPO_DIFF_CAPABILITY_ID.to_string(),
            schema_version: 1,
            ttl_ms: 0,
        },
    ]
}

fn served_exec_capabilities() -> Vec<ExecVerbCapability> {
    EXEC_VERBS
        .iter()
        .map(|verb| ExecVerbCapability {
            verb: (*verb).to_string(),
            schema_version: 1,
        })
        .collect()
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

fn repo_job_response(
    operation: RepoOperation,
    value: Value,
    error: Option<JsonError>,
) -> RepoJobResponse {
    RepoJobResponse {
        schema: REPO_RESPONSE_SCHEMA.to_string(),
        operation: operation.capability_id().to_string(),
        generated_at: epoch_ms(),
        value,
        error,
        daemon_version: DAEMON_VERSION.to_string(),
    }
}

fn repo_job_error_response(
    operation: RepoOperation,
    code: &str,
    message: &str,
    timed_out: bool,
) -> Value {
    serde_json::to_value(repo_job_response(
        operation,
        Value::Null,
        Some(JsonError {
            code: code.to_string(),
            message: message.to_string(),
            timed_out: if timed_out { Some(true) } else { None },
        }),
    ))
    .unwrap_or_else(|_| error_response(code, message))
}

fn exec_response(
    verb: &str,
    ok: bool,
    value: Option<Value>,
    error: Option<JsonError>,
) -> ExecResponse {
    ExecResponse {
        schema: EXEC_RESPONSE_SCHEMA.to_string(),
        verb: verb.to_string(),
        ok,
        value,
        error,
        daemon_version: DAEMON_VERSION.to_string(),
    }
}

fn exec_error_response(verb: &str, code: &str, message: &str, timed_out: bool) -> Value {
    serde_json::to_value(exec_response(
        verb,
        false,
        None,
        Some(JsonError {
            code: code.to_string(),
            message: message.to_string(),
            timed_out: if timed_out { Some(true) } else { None },
        }),
    ))
    .unwrap_or_else(|_| error_response(code, message))
}

fn run_repo_operation_with_timeout(
    operation: RepoOperation,
    input: Value,
    timeout: Duration,
) -> Result<Value, ProbeFailure> {
    if timeout.is_zero() {
        return Err(ProbeFailure {
            code: "timeout".to_string(),
            message: "repo job timed out after 0ms".to_string(),
            timed_out: true,
        });
    }
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let result = match operation {
            RepoOperation::Scan => repo_service::scan_value(input),
            RepoOperation::Diff => repo_service::diff_value(input),
        };
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(timeout) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(ProbeFailure {
            code: "invalid_request".to_string(),
            message,
            timed_out: false,
        }),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(ProbeFailure {
            code: "timeout".to_string(),
            message: format!("repo job timed out after {}ms", timeout.as_millis()),
            timed_out: true,
        }),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(ProbeFailure {
            code: "worker".to_string(),
            message: "repo job worker exited without a response".to_string(),
            timed_out: false,
        }),
    }
}

fn serialize_response_with_cap(
    response: Value,
    repo_response_cap: usize,
) -> Result<Vec<u8>, String> {
    let mut payload = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    if payload.len() <= repo_response_cap {
        return Ok(payload);
    }
    let operation = response
        .get("operation")
        .and_then(Value::as_str)
        .and_then(repo_operation_from_capability_id);
    if response.get("schema").and_then(Value::as_str) == Some(REPO_RESPONSE_SCHEMA) {
        let operation = operation.unwrap_or(RepoOperation::Scan);
        let capped = repo_job_error_response(
            operation,
            "output_cap",
            &format!("repo job response exceeded {repo_response_cap} bytes"),
            false,
        );
        payload = serde_json::to_vec(&capped).map_err(|error| error.to_string())?;
    }
    Ok(payload)
}

fn repo_operation_from_capability_id(value: &str) -> Option<RepoOperation> {
    match value {
        REPO_SCAN_CAPABILITY_ID => Some(RepoOperation::Scan),
        REPO_DIFF_CAPABILITY_ID => Some(RepoOperation::Diff),
        _ => None,
    }
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

#[derive(Clone, Copy, Debug)]
struct ExecVerbLimits {
    default_timeout: Duration,
    max_timeout: Duration,
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
}

impl ExecVerbLimits {
    fn tmux() -> Self {
        Self {
            default_timeout: Duration::from_millis(2_000),
            max_timeout: Duration::from_millis(5_000),
            max_stdout_bytes: 64 * 1024,
            max_stderr_bytes: 64 * 1024,
        }
    }

    fn tmux_large_input() -> Self {
        Self {
            default_timeout: Duration::from_millis(5_000),
            max_timeout: Duration::from_millis(10_000),
            max_stdout_bytes: 64 * 1024,
            max_stderr_bytes: 64 * 1024,
        }
    }

    fn tmux_new_session() -> Self {
        Self {
            default_timeout: Duration::from_millis(5_000),
            max_timeout: Duration::from_millis(10_000),
            max_stdout_bytes: 64 * 1024,
            max_stderr_bytes: 64 * 1024,
        }
    }

    fn tailscale_cert() -> Self {
        Self {
            default_timeout: Duration::from_millis(30_000),
            max_timeout: Duration::from_millis(30_000),
            max_stdout_bytes: 512 * 1024,
            max_stderr_bytes: 512 * 1024,
        }
    }

    fn reveal_open() -> Self {
        Self {
            default_timeout: Duration::from_millis(1_500),
            max_timeout: Duration::from_millis(5_000),
            max_stdout_bytes: 64 * 1024,
            max_stderr_bytes: 64 * 1024,
        }
    }
}

fn invalid_args(message: &str) -> ProbeFailure {
    ProbeFailure {
        code: "invalid_request".to_string(),
        message: message.to_string(),
        timed_out: false,
    }
}

fn optional_string(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn optional_bool(args: &Map<String, Value>, key: &str) -> Option<bool> {
    args.get(key).and_then(Value::as_bool)
}

fn optional_u16(args: &Map<String, Value>, key: &str) -> Option<u16> {
    args.get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= u64::from(u16::MAX))
        .map(|value| value as u16)
}

fn required_bounded_string<F>(
    args: &Map<String, Value>,
    key: &str,
    max_len: usize,
    validate: F,
) -> Result<String, ProbeFailure>
where
    F: Fn(&str) -> Result<(), ProbeFailure>,
{
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_args(&format!("missing string arg: {key}")))?
        .to_string();
    if value.is_empty() || value.len() > max_len {
        return Err(invalid_args(&format!(
            "{key} length is outside the allowed range"
        )));
    }
    if value.contains('\0')
        || value
            .chars()
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(invalid_args(&format!("{key} contains a control character")));
    }
    validate(&value)?;
    Ok(value)
}

fn required_string_array<F>(
    args: &Map<String, Value>,
    key: &str,
    validate: F,
) -> Result<Vec<String>, ProbeFailure>
where
    F: Fn(&str) -> Result<(), ProbeFailure>,
{
    let values = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_args(&format!("missing array arg: {key}")))?;
    if values.len() > 64 {
        return Err(invalid_args(&format!("{key} has too many entries")));
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let string = value
            .as_str()
            .ok_or_else(|| invalid_args(&format!("{key} entries must be strings")))?;
        if string.is_empty() || string.len() > 128 || string.contains('\0') {
            return Err(invalid_args(&format!(
                "{key} entry is outside the allowed range"
            )));
        }
        validate(string)?;
        out.push(string.to_string());
    }
    Ok(out)
}

fn required_tmux_target(args: &Map<String, Value>, key: &str) -> Result<String, ProbeFailure> {
    required_bounded_string(args, key, 160, validate_tmux_target)
}

fn required_buffer_name(args: &Map<String, Value>, key: &str) -> Result<String, ProbeFailure> {
    required_bounded_string(args, key, 160, validate_tmux_buffer_name)
}

fn tmux_socket_prefix(args: &Map<String, Value>) -> Result<Vec<String>, ProbeFailure> {
    let Some(socket_path) = optional_string(args, "socketPath") else {
        return Ok(Vec::new());
    };
    validate_absolute_path(&socket_path, "socketPath")?;
    Ok(vec!["-S".to_string(), socket_path])
}

fn requested_timeout(
    args: &Map<String, Value>,
    default_timeout: Duration,
    max_timeout: Duration,
) -> Result<Duration, ProbeFailure> {
    let requested = args
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .map(Duration::from_millis)
        .unwrap_or(default_timeout);
    if requested.is_zero() {
        return Err(ProbeFailure {
            code: "timeout".to_string(),
            message: "exec verb timed out after 0ms".to_string(),
            timed_out: true,
        });
    }
    Ok(requested.min(max_timeout))
}

fn validate_tmux_target(value: &str) -> Result<(), ProbeFailure> {
    validate_no_shell_meta(value, "tmux target")?;
    if value.len() > 160
        || !value.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(ch, '_' | '-' | '.' | ':' | '@' | '%' | '+' | '=' | '/')
        })
    {
        return Err(invalid_args("tmux target contains unsupported characters"));
    }
    Ok(())
}

fn validate_tmux_buffer_name(value: &str) -> Result<(), ProbeFailure> {
    validate_no_shell_meta(value, "tmux buffer name")?;
    if !value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':' | '@' | '%' | '+' | '=')
    }) {
        return Err(invalid_args(
            "tmux buffer name contains unsupported characters",
        ));
    }
    Ok(())
}

fn validate_tmux_key(value: &str) -> Result<(), ProbeFailure> {
    validate_no_shell_meta(value, "tmux key")?;
    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                '_' | '-' | '.' | ':' | '@' | '%' | '+' | '=' | '/' | '[' | ']'
            )
    }) {
        return Ok(());
    }
    Err(invalid_args("tmux key contains unsupported characters"))
}

fn validate_tmux_window_name(value: &str) -> Result<(), ProbeFailure> {
    validate_no_shell_meta(value, "tmux window name")?;
    if value.len() <= 80
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(ch, '_' | '-' | '.' | ':' | '@' | '%' | '+' | '=')
        })
    {
        return Ok(());
    }
    Err(invalid_args(
        "tmux window name contains unsupported characters",
    ))
}

fn validate_tmux_paste_flags(value: &str) -> Result<(), ProbeFailure> {
    match value {
        "-dpr" | "-dp" | "-dr" | "-d" | "-p" | "-r" => Ok(()),
        _ => Err(invalid_args("unsupported tmux paste-buffer flags")),
    }
}

fn validate_tmux_format(value: &str) -> Result<(), ProbeFailure> {
    match value {
        "#{pane_id}" => Ok(()),
        _ => Err(invalid_args("unsupported tmux format string")),
    }
}

fn allow_text_payload(value: &str) -> Result<(), ProbeFailure> {
    if value.contains('\0') {
        return Err(invalid_args("text payload contains NUL"));
    }
    Ok(())
}

fn allow_tmux_command(value: &str) -> Result<(), ProbeFailure> {
    if value.contains('\0') || value.trim().is_empty() {
        return Err(invalid_args("tmux command is empty or contains NUL"));
    }
    Ok(())
}

fn validate_absolute_path(value: &str, field: &str) -> Result<(), ProbeFailure> {
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(invalid_args(&format!(
            "{field} contains an unsupported character"
        )));
    }
    if !Path::new(value).is_absolute() {
        return Err(invalid_args(&format!("{field} must be absolute")));
    }
    Ok(())
}

fn validate_hostname(value: &str) -> Result<(), ProbeFailure> {
    if value.ends_with('.') || value.starts_with('.') || value.contains("..") {
        return Err(invalid_args("hostname must be a normalized DNS name"));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
    {
        return Err(invalid_args("hostname contains unsupported characters"));
    }
    for label in value.split('.') {
        if label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-') {
            return Err(invalid_args("hostname label is invalid"));
        }
    }
    Ok(())
}

fn validate_reveal_mode(value: &str) -> Result<(), ProbeFailure> {
    match value {
        "darwinReveal" | "darwinOpen" | "xdgOpen" | "windowsSelect" => Ok(()),
        _ => Err(invalid_args("unsupported reveal.open mode")),
    }
}

fn validate_no_shell_meta(value: &str, label: &str) -> Result<(), ProbeFailure> {
    if value.chars().any(|ch| {
        matches!(
            ch,
            ';' | '&'
                | '|'
                | '`'
                | '$'
                | '<'
                | '>'
                | '"'
                | '\''
                | '\\'
                | '('
                | ')'
                | '{'
                | '}'
                | '*'
                | '?'
                | '!'
                | '\n'
                | '\r'
                | '\t'
                | ' '
        )
    }) {
        return Err(invalid_args(&format!(
            "{label} contains shell metacharacters"
        )));
    }
    Ok(())
}

fn run_capped_command(
    command: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
) -> Result<CommandResult, CommandFailure> {
    run_capped_command_with_input(
        command,
        &args
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>(),
        None,
        cwd,
        timeout,
        max_stdout_bytes,
        max_stderr_bytes,
    )
}

fn run_capped_command_with_input(
    command: &str,
    args: &[String],
    stdin: Option<&[u8]>,
    cwd: Option<&Path>,
    timeout: Duration,
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
) -> Result<CommandResult, CommandFailure> {
    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
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

    if let Some(input) = stdin {
        let Some(mut child_stdin) = child.stdin.take() else {
            return Err(CommandFailure {
                code: "io".to_string(),
                message: format!("{command}: stdin pipe unavailable"),
                timed_out: false,
            });
        };
        child_stdin
            .write_all(input)
            .map_err(|error| CommandFailure {
                code: "io".to_string(),
                message: format!("{command}: failed to write stdin: {error}"),
                timed_out: false,
            })?;
    }

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
    let stderr = join_reader(stderr_reader)??;

    if let Some(status) = status {
        if status.success() {
            return Ok(CommandResult {
                stdout: String::from_utf8_lossy(&stdout).to_string(),
                stderr: String::from_utf8_lossy(&stderr).to_string(),
            });
        }
        let stderr_text = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(CommandFailure {
            code: "exit".to_string(),
            message: if stderr_text.is_empty() {
                format!("{command} exited with {}", status.code().unwrap_or(1))
            } else {
                stderr_text
            },
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

fn command_failure_to_exec(error: CommandFailure, command: &str) -> ProbeFailure {
    ProbeFailure {
        code: error.code,
        message: format!("Exec command {command} failed: {}", error.message),
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

fn env_usize(name: &str) -> Option<usize> {
    env_nonempty(name).and_then(|value| value.parse::<usize>().ok())
}

#[cfg(test)]
mod tests {
    use super::{serve, ProbeServerOptions, CAPABILITIES_SCHEMA, ERROR_SCHEMA, SNAPSHOT_SCHEMA};
    use scoutd::repo_service;
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::io::{Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixStream;
    use std::path::{Path, PathBuf};
    use std::process::Command;
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
            if socket_path.exists() && UnixStream::connect(&socket_path).is_ok() {
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
            tmux_bin: "tmux".to_string(),
            tailscale_status_fixture: None,
            tailscale_timeout: Duration::from_millis(1_500),
            git_timeout: Duration::from_millis(1_500),
            repo_job_timeout: Duration::from_millis(20_000),
            repo_job_response_cap_bytes: 8 * 1024 * 1024,
            repo_job_workers: 4,
            repo_job_queue: 32,
            exec_job_workers: 4,
            exec_job_queue: 32,
            connection_workers: 32,
            connection_queue: 64,
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
            4
        );
        let family_ids = capabilities
            .get("families")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|family| family.get("probeId").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(family_ids.contains(&"repo.scan"));
        assert!(family_ids.contains(&"repo.diff"));
        let verb_ids = capabilities
            .get("verbs")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|verb| verb.get("verb").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(verb_ids.contains(&"tmux.sendKeys"));
        assert!(verb_ids.contains(&"tmux.newSession"));
        assert!(verb_ids.contains(&"tailscale.cert"));

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
    fn exec_tmux_send_keys_uses_structured_verb_envelope() {
        let dir = unique_temp_dir("scoutd-exec-send-keys");
        let socket_path = dir.join("probes.sock");
        let argv_path = dir.join("argv.txt");
        let tmux = dir.join("tmux");
        write_executable(
            &tmux,
            &format!(
                r#"#!/bin/sh
printf '%s\n' "$@" > {}
exit 0
"#,
                shell_quote(&argv_path.to_string_lossy())
            ),
        );
        let mut options = base_options(socket_path.clone());
        options.tmux_bin = tmux.to_string_lossy().to_string();
        start_test_server(options);

        let response = request(
            &socket_path,
            r#"{"schema":"openscout.exec.request/v1","verb":"tmux.sendKeys","args":{"target":"scout-test","keys":["C-c"],"timeoutMs":2000}}"#,
        );
        assert_eq!(
            response.get("schema").and_then(Value::as_str),
            Some("openscout.exec.response/v1")
        );
        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            fs::read_to_string(&argv_path).unwrap(),
            "send-keys\n-t\nscout-test\nC-c\n"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exec_unknown_verb_and_injection_shaped_args_are_rejected() {
        let dir = unique_temp_dir("scoutd-exec-validation");
        let socket_path = dir.join("probes.sock");
        start_test_server(base_options(socket_path.clone()));

        let unknown = request(
            &socket_path,
            r#"{"schema":"openscout.exec.request/v1","verb":"tmux.runShell","args":{}}"#,
        );
        assert_eq!(
            unknown.get("schema").and_then(Value::as_str),
            Some("openscout.exec.response/v1")
        );
        assert_eq!(unknown.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            unknown.pointer("/error/code").and_then(Value::as_str),
            Some("unknown_verb")
        );

        let malformed = request(
            &socket_path,
            r#"{"schema":"openscout.exec.request/v1","verb":"tmux.killSession","args":{"target":"safe;rm -rf /"}}"#,
        );
        assert_eq!(malformed.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            malformed.pointer("/error/code").and_then(Value::as_str),
            Some("invalid_request")
        );

        let bad_path = request(
            &socket_path,
            r#"{"schema":"openscout.exec.request/v1","verb":"tailscale.cert","args":{"certFile":"relative.crt","keyFile":"/tmp/key","hostname":"node.example.ts.net"}}"#,
        );
        assert_eq!(bad_path.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            bad_path.pointer("/error/code").and_then(Value::as_str),
            Some("invalid_request")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exec_timeout_returns_error_without_crashing_server() {
        let dir = unique_temp_dir("scoutd-exec-timeout");
        let socket_path = dir.join("probes.sock");
        let tmux = dir.join("tmux");
        write_executable(
            &tmux,
            r#"#!/bin/sh
sleep 1
exit 0
"#,
        );
        let mut options = base_options(socket_path.clone());
        options.tmux_bin = tmux.to_string_lossy().to_string();
        start_test_server(options);

        let timed_out = request(
            &socket_path,
            r#"{"schema":"openscout.exec.request/v1","verb":"tmux.sendKeys","args":{"target":"scout-test","keys":["Enter"],"timeoutMs":1}}"#,
        );
        assert_eq!(
            timed_out.get("schema").and_then(Value::as_str),
            Some("openscout.exec.response/v1")
        );
        assert_eq!(timed_out.get("ok").and_then(Value::as_bool), Some(false));
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

    #[test]
    fn repo_scan_and_diff_match_one_shot_contract_over_socket() {
        let dir = unique_temp_dir("scoutd-repo-parity");
        let socket_path = dir.join("probes.sock");
        let repo = dir.join("repo");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("README.md"), "hello\n").unwrap();
        run_git(&repo, &["add", "README.md"]);
        run_git(
            &repo,
            &[
                "-c",
                "user.email=scout@example.test",
                "-c",
                "user.name=Scout",
                "commit",
                "-m",
                "initial",
            ],
        );
        fs::write(repo.join("README.md"), "hello\nworld\n").unwrap();
        fs::write(repo.join("scratch.md"), "scratch\n").unwrap();
        start_test_server(base_options(socket_path.clone()));

        let scan_request = json!({
            "schema": "openscout.repo.scan/v1",
            "hints": [{ "path": repo.to_string_lossy(), "source": "test" }],
            "limits": {
                "maxRoots": 4,
                "maxWorktrees": 4,
                "maxFilesPerWorktree": 12,
                "scanBudgetMs": 4_000,
                "includeDiff": true,
                "includeLastCommit": true
            }
        });
        let socket_scan = request(&socket_path, &scan_request.to_string());
        assert_eq!(
            socket_scan.get("schema").and_then(Value::as_str),
            Some("openscout.repo.response/v1")
        );
        assert_eq!(
            socket_scan.get("operation").and_then(Value::as_str),
            Some("repo.scan")
        );
        assert!(socket_scan.get("error").unwrap().is_null());
        let one_shot_scan: Value = serde_json::from_str(
            &repo_service::run_command_json("scan", &scan_request.to_string()).unwrap(),
        )
        .unwrap();
        let mut socket_scan_value = socket_scan.get("value").cloned().unwrap();
        let mut one_shot_scan_value = one_shot_scan;
        normalize_scan_timestamps(&mut socket_scan_value);
        normalize_scan_timestamps(&mut one_shot_scan_value);
        assert_eq!(socket_scan_value, one_shot_scan_value);

        let diff_request = json!({
            "schema": "openscout.repo.diff/v1",
            "worktreePath": repo.to_string_lossy(),
            "layers": ["unstaged"],
            "limits": {
                "maxPatchBytes": 200_000,
                "maxFiles": 100,
                "maxHunksPerFile": 50,
                "maxLinesPerHunk": 500,
                "timeoutMs": 5_000,
                "includeRawPatch": true,
                "includeParsedHunks": true,
                "includeBinaryPatch": true
            }
        });
        let socket_diff = request(&socket_path, &diff_request.to_string());
        assert_eq!(
            socket_diff.get("schema").and_then(Value::as_str),
            Some("openscout.repo.response/v1")
        );
        assert_eq!(
            socket_diff.get("operation").and_then(Value::as_str),
            Some("repo.diff")
        );
        assert!(socket_diff.get("error").unwrap().is_null());
        let one_shot_diff: Value = serde_json::from_str(
            &repo_service::run_command_json("diff", &diff_request.to_string()).unwrap(),
        )
        .unwrap();
        let mut socket_diff_value = socket_diff.get("value").cloned().unwrap();
        let mut one_shot_diff_value = one_shot_diff;
        normalize_generated_at(&mut socket_diff_value);
        normalize_generated_at(&mut one_shot_diff_value);
        assert_eq!(socket_diff_value, one_shot_diff_value);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn repo_malformed_body_returns_repo_error_envelope() {
        let dir = unique_temp_dir("scoutd-repo-malformed");
        let socket_path = dir.join("probes.sock");
        start_test_server(base_options(socket_path.clone()));

        let response = request(&socket_path, r#"{"schema":"openscout.repo.diff/v1"}"#);
        assert_eq!(
            response.get("schema").and_then(Value::as_str),
            Some("openscout.repo.response/v1")
        );
        assert_eq!(
            response.get("operation").and_then(Value::as_str),
            Some("repo.diff")
        );
        assert_eq!(
            response.pointer("/error/code").and_then(Value::as_str),
            Some("invalid_request")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn repo_timeout_returns_error_without_crashing_server() {
        let dir = unique_temp_dir("scoutd-repo-timeout");
        let socket_path = dir.join("probes.sock");
        let mut options = base_options(socket_path.clone());
        options.repo_job_timeout = Duration::from_millis(0);
        start_test_server(options);

        let timed_out = request(
            &socket_path,
            r#"{"schema":"openscout.repo.scan/v1","hints":[]}"#,
        );
        assert_eq!(
            timed_out.get("schema").and_then(Value::as_str),
            Some("openscout.repo.response/v1")
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

    #[test]
    fn repo_oversized_response_returns_error_envelope() {
        let dir = unique_temp_dir("scoutd-repo-output-cap");
        let socket_path = dir.join("probes.sock");
        let mut options = base_options(socket_path.clone());
        options.repo_job_response_cap_bytes = 64;
        start_test_server(options);

        let response = request(
            &socket_path,
            r#"{"schema":"openscout.repo.scan/v1","hints":[]}"#,
        );
        assert_eq!(
            response.get("schema").and_then(Value::as_str),
            Some("openscout.repo.response/v1")
        );
        assert_eq!(
            response.pointer("/error/code").and_then(Value::as_str),
            Some("output_cap")
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

    fn run_git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        if !output.status.success() {
            let _ = std::io::stderr().write_all(&output.stderr);
            panic!("git {} failed", args.join(" "));
        }
    }

    fn normalize_scan_timestamps(value: &mut Value) {
        normalize_generated_at(value);
        if let Some(projects) = value.get_mut("projects").and_then(Value::as_array_mut) {
            for project in projects {
                if let Some(worktrees) = project.get_mut("worktrees").and_then(Value::as_array_mut)
                {
                    for worktree in worktrees {
                        if let Some(object) = worktree.as_object_mut() {
                            object.insert("scannedAt".to_string(), Value::from(0));
                        }
                    }
                }
            }
        }
    }

    fn normalize_generated_at(value: &mut Value) {
        if let Some(object) = value.as_object_mut() {
            object.insert("generatedAt".to_string(), Value::from(0));
        }
    }
}
