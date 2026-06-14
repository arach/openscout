#[cfg(not(unix))]
compile_error!("scoutd first slice requires a Unix-like platform.");

use std::collections::HashSet;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::os::unix::net::UnixStream;
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_BROKER_HOST: &str = "127.0.0.1";
const DEFAULT_BROKER_HOST_MESH: &str = "0.0.0.0";
const DEFAULT_BROKER_PORT: u16 = 65_535;
const RESTART_MIN_DELAY: Duration = Duration::from_secs(1);
const RESTART_MAX_DELAY: Duration = Duration::from_secs(30);
const START_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(20);
const CHILD_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(12);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const STATE_WRITE_INTERVAL: Duration = Duration::from_secs(2);
const CHILD_LOG_ROTATE_LIMIT: u64 = 512 * 1024;
const DEFAULT_REPO_WATCH_INTERVAL: Duration = Duration::from_secs(10 * 60);
const REPO_WATCH_WARM_START_DELAY: Duration = Duration::from_secs(2);
const REPO_WATCH_WARM_PATH: &str = "/v1/repo-watch/warm";
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;
const DAEMON_NAME: &str = "scoutd";
const BUILD_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Pre-rename daemon binary name. Kept for legacy-name compatibility so doctor
/// still sees a still-running `openscout-supervisor supervise` orphan after the
/// openscout-supervisor → scoutd rename.
const LEGACY_DAEMON_NAME: &str = "openscout-supervisor";
static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);
const OPTIONAL_LAUNCH_ENV_KEYS: &[&str] = &[
    "OPENSCOUT_MESH_ID",
    "OPENSCOUT_MESH_SEEDS",
    "OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS",
    "OPENSCOUT_NODE_NAME",
    "OPENSCOUT_NODE_ID",
    "OPENSCOUT_NODE_QUALIFIER",
    "OPENSCOUT_TAILSCALE_BIN",
    "OPENSCOUT_TAILSCALE_STATUS_JSON",
    "OPENSCOUT_SSE_KEEPALIVE_MS",
    "OPENSCOUT_WEB_EDGE_SCHEME",
    "OPENSCOUT_WEB_PUBLIC_ORIGIN",
    "OPENSCOUT_WEB_PORTAL_HOST",
    "OPENSCOUT_WEB_LOCAL_NAME",
    "OPENSCOUT_WEB_ADVERTISED_HOST",
    "OPENSCOUT_WEB_TRUSTED_HOSTS",
    "OPENSCOUT_WEB_TRUSTED_ORIGINS",
    "OPENSCOUT_WEB_PORT",
    "OPENSCOUT_WEB_FLAG_BUNDLE",
    "OPENSCOUT_WEB_EXPERIENCE",
    "OPENSCOUT_WEB_AB_VARIANT",
    "OPENSCOUT_REPO_WATCH_INTERVAL_MS",
    "OPENSCOUT_REPO_WATCH_ROOTS",
    "OPENSCOUT_REPO_WATCH_NATIVE",
    "OPENSCOUT_REPO_WATCH_MAX_ROOTS",
    "OPENSCOUT_REPO_WATCH_MAX_WORKTREES",
    "OPENSCOUT_REPO_WATCH_MAX_FILES_PER_WORKTREE",
    "OPENSCOUT_REPO_WATCH_SCAN_BUDGET_MS",
    "OPENSCOUT_REPO_WATCH_CACHE_TTL_MS",
    "OPENSCOUT_REPO_WATCH_REHYDRATE_AFTER_MS",
    "OPENSCOUT_REPO_SERVICE_BIN",
];

unsafe extern "C" {
    fn signal(signum: i32, handler: extern "C" fn(i32)) -> usize;
}

extern "C" fn request_shutdown(_: i32) {
    SHUTDOWN_REQUESTED.store(true, Ordering::SeqCst);
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args
        .iter()
        .any(|arg| arg == "-V" || arg == "--version" || arg == "version")
    {
        print_version();
        return Ok(());
    }
    if args
        .iter()
        .any(|arg| arg == "-h" || arg == "--help" || arg == "help")
    {
        print_help();
        return Ok(());
    }

    let json = args.iter().any(|arg| arg == "--json");
    let command = args
        .iter()
        .find(|arg| !arg.starts_with("--"))
        .map(String::as_str)
        .unwrap_or("status");
    let config = Config::resolve()?;

    match command {
        "status" => {
            let status = broker_service_status(&config);
            print_status(&status, json);
            Ok(())
        }
        "doctor" => {
            let report = doctor_report(&config);
            print_doctor(&report, json);
            Ok(())
        }
        "install" => {
            let status = install_service(&config)?;
            print_status(&status, json);
            Ok(())
        }
        "start" => {
            let status = start_service(&config)?;
            print_status(&status, json);
            Ok(())
        }
        "stop" => {
            let status = stop_service(&config)?;
            print_status(&status, json);
            Ok(())
        }
        "restart" => {
            stop_service(&config)?;
            let status = start_service(&config)?;
            print_status(&status, json);
            Ok(())
        }
        "uninstall" => {
            let status = uninstall_service(&config)?;
            print_status(&status, json);
            Ok(())
        }
        "supervise" => supervise_service(&config),
        other => Err(format!("unknown command: {other}")),
    }
}

#[derive(Clone, Debug)]
struct Config {
    label: String,
    service_mode: String,
    domain_target: String,
    service_target: String,
    launch_agent_path: PathBuf,
    support_directory: PathBuf,
    runtime_directory: PathBuf,
    logs_directory: PathBuf,
    stdout_log_path: PathBuf,
    stderr_log_path: PathBuf,
    control_home: PathBuf,
    runtime_package_dir: PathBuf,
    daemon_executable: PathBuf,
    daemon_state_path: PathBuf,
    bun_executable: String,
    broker_host: String,
    broker_port: u16,
    broker_url: String,
    broker_socket_path: PathBuf,
    advertise_scope: String,
    repo_watch_interval: Option<Duration>,
}

impl Config {
    fn resolve() -> Result<Self, String> {
        let home = home_dir()?;
        let uid = user_id()?;
        let service_mode = match env_nonempty("OPENSCOUT_BROKER_SERVICE_MODE")
            .unwrap_or_else(|| "dev".to_string())
            .to_lowercase()
            .as_str()
        {
            "prod" | "production" => "prod".to_string(),
            "custom" => "custom".to_string(),
            _ => "dev".to_string(),
        };
        let label = env_nonempty("OPENSCOUT_SERVICE_LABEL")
            .or_else(|| env_nonempty("OPENSCOUT_BROKER_SERVICE_LABEL"))
            .unwrap_or_else(|| match service_mode.as_str() {
                "prod" => "com.openscout".to_string(),
                "custom" => "com.openscout.custom".to_string(),
                _ => "dev.openscout".to_string(),
            });
        let default_support_directory = home.join("Library/Application Support/OpenScout");
        let support_directory = non_tmp_path_or_default(
            env_nonempty("OPENSCOUT_SUPPORT_DIRECTORY")
                .or_else(|| env_nonempty("OPENSCOUT_SUPPORT_DIR"))
                .map(PathBuf::from),
            default_support_directory,
        );
        let runtime_directory = support_directory.join("runtime");
        let logs_directory = support_directory.join("logs/broker");
        let control_home = non_tmp_path_or_default(
            env_nonempty("OPENSCOUT_CONTROL_HOME").map(PathBuf::from),
            home.join(".openscout/control-plane"),
        );
        let runtime_package_dir = match env_nonempty("OPENSCOUT_RUNTIME_PACKAGE_DIR") {
            Some(value) => PathBuf::from(value),
            None => {
                find_workspace_runtime_dir(&env::current_dir().map_err(|error| error.to_string())?)
                    .ok_or_else(|| {
                        "unable to resolve runtime package dir; set OPENSCOUT_RUNTIME_PACKAGE_DIR"
                            .to_string()
                    })?
            }
        };
        let daemon_executable = match env_nonempty("OPENSCOUT_SCOUTD_BIN") {
            Some(value) => PathBuf::from(value),
            None => env::current_exe().map_err(|error| error.to_string())?,
        };
        let bun_executable = env_nonempty("OPENSCOUT_BUN_BIN").unwrap_or_else(|| {
            let home_bun = home.join(".bun/bin/bun");
            if home_bun.exists() {
                home_bun.to_string_lossy().to_string()
            } else {
                "bun".to_string()
            }
        });
        let advertise_scope = match env_nonempty("OPENSCOUT_ADVERTISE_SCOPE").as_deref() {
            Some("mesh") => "mesh".to_string(),
            _ => "local".to_string(),
        };
        let default_broker_host = if advertise_scope == "mesh" {
            DEFAULT_BROKER_HOST_MESH
        } else {
            DEFAULT_BROKER_HOST
        };
        let broker_host = env_nonempty("OPENSCOUT_BROKER_HOST")
            .unwrap_or_else(|| default_broker_host.to_string());
        let broker_port = env_nonempty("OPENSCOUT_BROKER_PORT")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(DEFAULT_BROKER_PORT);
        let broker_url = env_nonempty("OPENSCOUT_BROKER_URL")
            .unwrap_or_else(|| format!("http://{broker_host}:{broker_port}"));
        let broker_socket_path = PathBuf::from(
            env_nonempty("OPENSCOUT_BROKER_SOCKET_PATH").unwrap_or_else(|| {
                runtime_directory
                    .join("broker.sock")
                    .to_string_lossy()
                    .to_string()
            }),
        );
        let daemon_state_path = runtime_directory.join("scoutd-state.json");
        let repo_watch_interval = repo_watch_interval_from_env();

        Ok(Self {
            label: label.clone(),
            service_mode,
            domain_target: format!("gui/{uid}"),
            service_target: format!("gui/{uid}/{label}"),
            launch_agent_path: home.join(format!("Library/LaunchAgents/{label}.plist")),
            support_directory,
            runtime_directory,
            logs_directory: logs_directory.clone(),
            stdout_log_path: logs_directory.join("stdout.log"),
            stderr_log_path: logs_directory.join("stderr.log"),
            control_home,
            runtime_package_dir,
            daemon_executable,
            daemon_state_path,
            bun_executable,
            broker_host,
            broker_port,
            broker_url,
            broker_socket_path,
            advertise_scope,
            repo_watch_interval,
        })
    }

    fn runtime_entrypoint(&self) -> PathBuf {
        self.runtime_package_dir.join("bin/openscout-runtime.mjs")
    }
}

#[derive(Clone, Debug)]
struct LaunchctlStatus {
    loaded: bool,
    pid: Option<u32>,
    launchd_state: Option<String>,
    last_exit_status: Option<i32>,
}

#[derive(Clone, Debug)]
struct HealthStatus {
    reachable: bool,
    ok: bool,
    transport: Option<String>,
    status_code: Option<u16>,
    body: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug)]
struct ServiceStatus {
    config: Config,
    launchctl: LaunchctlStatus,
    health: HealthStatus,
    daemon_state: Option<String>,
}

#[derive(Clone, Debug)]
struct ChildExitTelemetry {
    at_ms: u128,
    code: Option<i32>,
    signal: Option<i32>,
    description: String,
}

#[derive(Clone, Debug, Default)]
struct DaemonStateTelemetry {
    base_state: Option<String>,
    restart_count: Option<u32>,
    restart_backoff_ms: Option<u64>,
    last_child_exit_description: Option<String>,
    last_child_exit_code: Option<i32>,
    last_child_exit_signal: Option<i32>,
}

#[derive(Clone, Debug)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    pcpu: String,
    pmem: String,
    elapsed: String,
    command: String,
}

#[derive(Clone, Debug)]
struct DoctorReport {
    status: ServiceStatus,
    processes: Vec<ProcessInfo>,
    warnings: Vec<String>,
}

fn install_service(config: &Config) -> Result<ServiceStatus, String> {
    bootout_legacy_service(config);
    ensure_launch_agent(config)?;
    Ok(broker_service_status(config))
}

fn start_service(config: &Config) -> Result<ServiceStatus, String> {
    bootout_legacy_service(config);
    ensure_launch_agent(config)?;
    let _ = run_command("/bin/launchctl", &["bootout", &config.service_target]);
    let _ = wait_for_stopped(config);
    run_command_checked(
        "/bin/launchctl",
        &[
            "bootstrap",
            &config.domain_target,
            path_str(&config.launch_agent_path)?,
        ],
    )?;
    let _ = run_command(
        "/bin/launchctl",
        &["kickstart", "-k", &config.service_target],
    );
    wait_for_healthy(config)
}

fn stop_service(config: &Config) -> Result<ServiceStatus, String> {
    let _ = run_command("/bin/launchctl", &["bootout", &config.service_target]);
    wait_for_stopped(config)
}

fn uninstall_service(config: &Config) -> Result<ServiceStatus, String> {
    let _ = stop_service(config);
    // Removes the legacy plist as well (see bootout_legacy_service).
    bootout_legacy_service(config);
    if config.launch_agent_path.exists() {
        fs::remove_file(&config.launch_agent_path).map_err(|error| error.to_string())?;
    }
    Ok(broker_service_status(config))
}

fn supervise_service(config: &Config) -> Result<(), String> {
    install_signal_handlers();
    ensure_daemon_directories(config)?;
    eprintln!(
        "[scoutd] starting Bun base from {}",
        config.runtime_entrypoint().display(),
    );

    let started_at_ms = epoch_ms();
    let mut restart_count = 0_u32;
    let mut restart_delay = RESTART_MIN_DELAY;
    let mut last_child_exit: Option<ChildExitTelemetry> = None;
    let mut child = spawn_base_process(config)?;
    let _repo_watch_warmer = start_repo_watch_warmer(config.clone());
    write_daemon_state(
        config,
        started_at_ms,
        Some(child.id()),
        "running",
        restart_count,
        Some(restart_delay),
        last_child_exit.as_ref(),
    )?;
    let mut next_state_write = Instant::now() + STATE_WRITE_INTERVAL;

    while !SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => {
                last_child_exit = Some(child_exit_telemetry(&status));
                write_daemon_state(
                    config,
                    started_at_ms,
                    None,
                    "exited",
                    restart_count,
                    Some(restart_delay),
                    last_child_exit.as_ref(),
                )?;
                eprintln!("[scoutd] Bun base exited: {status}");
                restart_count = restart_count.saturating_add(1);
                sleep_until_or_shutdown(Instant::now() + restart_delay);
                if SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                    break;
                }
                restart_delay = doubled_delay(restart_delay);
                child = spawn_base_process(config)?;
                write_daemon_state(
                    config,
                    started_at_ms,
                    Some(child.id()),
                    "running",
                    restart_count,
                    Some(restart_delay),
                    last_child_exit.as_ref(),
                )?;
                next_state_write = Instant::now() + STATE_WRITE_INTERVAL;
            }
            None => {
                if Instant::now() >= next_state_write {
                    write_daemon_state(
                        config,
                        started_at_ms,
                        Some(child.id()),
                        "running",
                        restart_count,
                        Some(restart_delay),
                        last_child_exit.as_ref(),
                    )?;
                    next_state_write = Instant::now() + STATE_WRITE_INTERVAL;
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }

    write_daemon_state(
        config,
        started_at_ms,
        Some(child.id()),
        "stopping",
        restart_count,
        Some(restart_delay),
        last_child_exit.as_ref(),
    )?;
    terminate_child(&mut child, "Bun base", CHILD_SHUTDOWN_TIMEOUT)?;
    write_daemon_state(
        config,
        started_at_ms,
        None,
        "stopped",
        restart_count,
        Some(restart_delay),
        last_child_exit.as_ref(),
    )?;
    Ok(())
}

fn install_signal_handlers() {
    unsafe {
        let _ = signal(SIGINT, request_shutdown);
        let _ = signal(SIGTERM, request_shutdown);
    }
}

fn spawn_base_process(config: &Config) -> Result<Child, String> {
    prepare_child_logs_for_spawn(config)?;
    let stdout_log = open_child_log(&config.stdout_log_path)?;
    let stderr_log = open_child_log(&config.stderr_log_path)?;
    let mut command = Command::new(&config.bun_executable);
    command
        .arg(config.runtime_entrypoint())
        .arg("base")
        .current_dir(&config.runtime_package_dir)
        .env("OPENSCOUT_PARENT_PID", std::process::id().to_string())
        .env(
            "OPENSCOUT_SUPPORT_DIRECTORY",
            config.support_directory.to_string_lossy().to_string(),
        )
        .env(
            "OPENSCOUT_RUNTIME_PACKAGE_DIR",
            config.runtime_package_dir.to_string_lossy().to_string(),
        )
        .env("OPENSCOUT_BROKER_HOST", &config.broker_host)
        .env("OPENSCOUT_BROKER_PORT", config.broker_port.to_string())
        .env("OPENSCOUT_BROKER_URL", &config.broker_url)
        .env(
            "OPENSCOUT_BROKER_SOCKET_PATH",
            config.broker_socket_path.to_string_lossy().to_string(),
        )
        .env(
            "OPENSCOUT_CONTROL_HOME",
            config.control_home.to_string_lossy().to_string(),
        )
        .env("OPENSCOUT_BROKER_SERVICE_MODE", &config.service_mode)
        .env("OPENSCOUT_BROKER_SERVICE_LABEL", &config.label)
        .env("OPENSCOUT_SERVICE_LABEL", &config.label)
        .env("OPENSCOUT_ADVERTISE_SCOPE", &config.advertise_scope)
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    for &key in OPTIONAL_LAUNCH_ENV_KEYS {
        if let Some(value) = env_nonempty(key) {
            command.env(key, value);
        }
    }
    if let Some(core_agents) = env_nonempty("OPENSCOUT_CORE_AGENTS") {
        command.env("OPENSCOUT_CORE_AGENTS", core_agents);
    }

    command
        .spawn()
        .map_err(|error| format!("failed to start Bun base: {error}"))
}

fn prepare_child_logs_for_spawn(config: &Config) -> Result<(), String> {
    rotate_child_log_if_needed(&config.stdout_log_path, &config.logs_directory)?;
    rotate_child_log_if_needed(&config.stderr_log_path, &config.logs_directory)
}

fn open_child_log(path: &Path) -> Result<fs::File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open child log {}: {error}", path.display()))
}

fn rotate_child_log_if_needed(path: &Path, logs_directory: &Path) -> Result<(), String> {
    if !scoutd_owned_child_log_path(path, logs_directory) {
        return Ok(());
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to inspect log {}: {error}", path.display())),
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Ok(());
    }
    if metadata.len() <= CHILD_LOG_ROTATE_LIMIT {
        return Ok(());
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to read log {}: {error}", path.display()))?;
    file.seek(SeekFrom::Start(
        metadata.len().saturating_sub(CHILD_LOG_ROTATE_LIMIT),
    ))
    .map_err(|error| format!("failed to seek log {}: {error}", path.display()))?;
    let mut retained_tail = Vec::new();
    file.read_to_end(&mut retained_tail)
        .map_err(|error| format!("failed to retain log tail {}: {error}", path.display()))?;

    let rotated_path = rotated_child_log_path(path);
    fs::write(&rotated_path, retained_tail).map_err(|error| {
        format!(
            "failed to write rotated log {}: {error}",
            rotated_path.display()
        )
    })?;
    OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.set_len(0))
        .map_err(|error| format!("failed to truncate log {}: {error}", path.display()))
}

fn scoutd_owned_child_log_path(path: &Path, logs_directory: &Path) -> bool {
    path.parent() == Some(logs_directory)
        && matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some("stdout.log" | "stderr.log")
        )
}

fn rotated_child_log_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "child.log".to_string());
    path.with_file_name(format!("{file_name}.1"))
}

fn child_exit_telemetry(status: &ExitStatus) -> ChildExitTelemetry {
    ChildExitTelemetry {
        at_ms: epoch_ms(),
        code: status.code(),
        signal: status.signal(),
        description: status.to_string(),
    }
}

fn sleep_until_or_shutdown(deadline: Instant) {
    while Instant::now() < deadline && !SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
        thread::sleep(POLL_INTERVAL);
    }
}

fn start_repo_watch_warmer(config: Config) -> Option<thread::JoinHandle<()>> {
    let interval = config.repo_watch_interval?;
    match thread::Builder::new()
        .name("scoutd-repo-watch-warmer".to_string())
        .spawn(move || {
            sleep_until_or_shutdown(Instant::now() + REPO_WATCH_WARM_START_DELAY);
            while !SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                if let Err(error) = warm_repo_watch_snapshot(&config) {
                    eprintln!("[scoutd] repo-watch warm failed: {error}");
                }
                sleep_until_or_shutdown(Instant::now() + interval);
            }
        }) {
        Ok(handle) => Some(handle),
        Err(error) => {
            eprintln!("[scoutd] failed to start repo-watch warmer: {error}");
            None
        }
    }
}

fn warm_repo_watch_snapshot(config: &Config) -> Result<(), String> {
    match warm_repo_watch_unix(&config.broker_socket_path) {
        Ok(()) => Ok(()),
        Err(socket_error) => warm_repo_watch_tcp(config)
            .map_err(|http_error| format!("{socket_error}; http fallback: {http_error}")),
    }
}

fn warm_repo_watch_unix(socket_path: &Path) -> Result<(), String> {
    let mut stream = UnixStream::connect(socket_path).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    warm_repo_watch_http(&mut stream, "localhost")
}

fn warm_repo_watch_tcp(config: &Config) -> Result<(), String> {
    let mut stream = TcpStream::connect((&config.broker_host[..], config.broker_port))
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    warm_repo_watch_http(&mut stream, &config.broker_host)
}

fn warm_repo_watch_http<T: Read + Write>(stream: &mut T, host: &str) -> Result<(), String> {
    let response = fetch_http_response(stream, host, REPO_WATCH_WARM_PATH, "application/json")?;
    match parse_http_status_code(&response) {
        Some(status) if (200..300).contains(&status) => Ok(()),
        Some(status) => Err(format!("repo-watch warm returned HTTP {status}")),
        None => Err("repo-watch warm response missing HTTP status".to_string()),
    }
}

fn fetch_http_response<T: Read + Write>(
    stream: &mut T,
    host: &str,
    path: &str,
    accept: &str,
) -> Result<String, String> {
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nAccept: {accept}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    Ok(response)
}

fn parse_http_status_code(response: &str) -> Option<u16> {
    response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
}

fn doubled_delay(delay: Duration) -> Duration {
    let doubled = delay.as_millis().saturating_mul(2);
    Duration::from_millis(doubled.min(RESTART_MAX_DELAY.as_millis()) as u64)
}

fn terminate_child(child: &mut Child, label: &str, timeout: Duration) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }

    let _ = send_process_signal(child.id(), "TERM");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        thread::sleep(POLL_INTERVAL);
    }

    eprintln!("[scoutd] {label} did not exit after SIGTERM; forcing shutdown");
    child.kill().map_err(|error| error.to_string())?;
    let _ = child.wait();
    Ok(())
}

fn send_process_signal(pid: u32, signal_name: &str) -> Result<(), String> {
    let status = Command::new("/bin/kill")
        .arg(format!("-{signal_name}"))
        .arg(pid.to_string())
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("kill -{signal_name} {pid} exited with {status}"))
    }
}

fn broker_service_status(config: &Config) -> ServiceStatus {
    ServiceStatus {
        config: config.clone(),
        launchctl: inspect_launchctl(config),
        health: fetch_health(config),
        daemon_state: read_daemon_state_json(config),
    }
}

fn wait_for_healthy(config: &Config) -> Result<ServiceStatus, String> {
    let deadline = Instant::now() + START_TIMEOUT;
    let mut last = broker_service_status(config);
    while Instant::now() < deadline {
        last = broker_service_status(config);
        if last.health.reachable && last.health.ok {
            return Ok(last);
        }
        thread::sleep(POLL_INTERVAL);
    }
    Err(format!(
        "broker did not become healthy: {}",
        last.health
            .error
            .clone()
            .unwrap_or_else(|| "health check failed".to_string()),
    ))
}

fn wait_for_stopped(config: &Config) -> Result<ServiceStatus, String> {
    let deadline = Instant::now() + STOP_TIMEOUT;
    let mut last = broker_service_status(config);
    while Instant::now() < deadline {
        last = broker_service_status(config);
        if !last.launchctl.loaded && !last.health.reachable {
            return Ok(last);
        }
        thread::sleep(POLL_INTERVAL);
    }
    Err(format!(
        "service did not stop within {:?}: launchd loaded={}, broker reachable={}",
        STOP_TIMEOUT, last.launchctl.loaded, last.health.reachable,
    ))
}

fn inspect_launchctl(config: &Config) -> LaunchctlStatus {
    let output = match run_command("/bin/launchctl", &["print", &config.service_target]) {
        Ok(output) => output,
        Err(_) => {
            return LaunchctlStatus {
                loaded: false,
                pid: None,
                launchd_state: None,
                last_exit_status: None,
            };
        }
    };

    if output.status != 0 {
        return LaunchctlStatus {
            loaded: false,
            pid: None,
            launchd_state: None,
            last_exit_status: None,
        };
    }

    LaunchctlStatus {
        loaded: true,
        pid: parse_launchctl_u32(&output.stdout, "pid ="),
        launchd_state: parse_launchctl_string(&output.stdout, "state ="),
        last_exit_status: parse_launchctl_i32(&output.stdout, "last exit code =")
            .or_else(|| parse_launchctl_i32(&output.stdout, "last exit status =")),
    }
}

fn fetch_health(config: &Config) -> HealthStatus {
    match fetch_unix_health(&config.broker_socket_path) {
        Ok(mut health) => {
            health.transport = Some("unix_socket".to_string());
            return health;
        }
        Err(socket_error) => match fetch_tcp_health(config) {
            Ok(mut health) => {
                health.transport = Some("http".to_string());
                health
            }
            Err(http_error) => HealthStatus {
                reachable: false,
                ok: false,
                transport: None,
                status_code: None,
                body: None,
                error: Some(format!("{socket_error}; http fallback: {http_error}")),
            },
        },
    }
}

fn fetch_unix_health(socket_path: &Path) -> Result<HealthStatus, String> {
    let mut stream = UnixStream::connect(socket_path).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    fetch_http_health(&mut stream, "localhost")
}

fn fetch_tcp_health(config: &Config) -> Result<HealthStatus, String> {
    let mut stream = TcpStream::connect((&config.broker_host[..], config.broker_port))
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    fetch_http_health(&mut stream, &config.broker_host)
}

fn fetch_http_health<T: Read + Write>(stream: &mut T, host: &str) -> Result<HealthStatus, String> {
    let response = fetch_http_response(stream, host, "/health", "application/json")?;
    parse_health_response(&response)
}

fn parse_health_response(response: &str) -> Result<HealthStatus, String> {
    let status_code = parse_http_status_code(response);
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default();
    let ok = status_code == Some(200) && health_body_reports_ok(&body);
    Ok(HealthStatus {
        reachable: status_code.is_some(),
        ok,
        transport: None,
        status_code,
        body: if body.is_empty() { None } else { Some(body) },
        error: if status_code.is_some() {
            None
        } else {
            Some("missing HTTP status".to_string())
        },
    })
}

fn health_body_reports_ok(body: &str) -> bool {
    let Some((_, after_key)) = body.split_once("\"ok\"") else {
        return false;
    };
    let Some((_, after_colon)) = after_key.split_once(':') else {
        return false;
    };
    after_colon.trim_start().starts_with("true")
}

fn doctor_report(config: &Config) -> DoctorReport {
    let status = broker_service_status(config);
    let processes = process_snapshot();
    let mut warnings = Vec::new();

    if !config.runtime_entrypoint().exists() {
        warnings.push(format!(
            "runtime entrypoint is missing: {}",
            config.runtime_entrypoint().display()
        ));
    }
    if !command_available(&config.bun_executable) {
        warnings.push(format!(
            "bun executable is not available: {}",
            config.bun_executable
        ));
    }
    if !status.health.reachable {
        warnings.push("broker health is unreachable".to_string());
    }
    if status.config.broker_socket_path.exists() && !status.health.reachable {
        warnings.push(format!(
            "broker socket exists but health is unreachable: {}",
            status.config.broker_socket_path.display(),
        ));
    }
    if status.launchctl.loaded && status.daemon_state.is_none() {
        warnings.push(format!(
            "launchd service is loaded but scoutd state is missing: {}",
            status.config.daemon_state_path.display(),
        ));
    }
    if let Some(raw_state) = status.daemon_state.as_deref() {
        warnings.extend(restart_telemetry_warnings(raw_state));
    }

    let daemon_processes: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|process| command_invokes_scoutd_daemon(&process.command))
        .collect();
    if daemon_processes.len() > 1 {
        warnings.push(format!(
            "multiple scoutd processes found: {}",
            daemon_processes.len()
        ));
    }
    for process in daemon_processes {
        if process.ppid == 1 && status.launchctl.pid != Some(process.pid) {
            warnings.push(format!("orphaned scoutd process: pid {}", process.pid));
        }
    }
    let broker_processes: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|process| command_references_process(&process.command, "scout-broker"))
        .collect();
    if broker_processes.len() > 1 {
        warnings.push(format!(
            "multiple scout-broker processes found: {}",
            broker_processes.len()
        ));
    }
    for process in broker_processes {
        if process.ppid == 1 {
            warnings.push(format!(
                "orphaned scout-broker process: pid {}",
                process.pid
            ));
        }
    }
    for process in processes
        .iter()
        .filter(|process| command_references_process(&process.command, "scout-web"))
    {
        if process.ppid == 1 {
            warnings.push(format!("orphaned scout-web process: pid {}", process.pid));
        }
    }

    DoctorReport {
        status,
        processes,
        warnings,
    }
}

fn restart_telemetry_warnings(raw_state: &str) -> Vec<String> {
    let telemetry = parse_daemon_state_telemetry(raw_state);
    let mut warnings = Vec::new();
    let restart_count = telemetry.restart_count.unwrap_or(0);
    let last_child_exit = telemetry.last_child_exit_description.as_deref();

    if restart_count > 0 || last_child_exit.is_some() {
        let mut details = format!("scout-base restart telemetry: restartCount={restart_count}");
        if let Some(base_state) = telemetry.base_state.as_deref() {
            details.push_str(&format!(", baseState={base_state}"));
        }
        if let Some(backoff_ms) = telemetry.restart_backoff_ms {
            details.push_str(&format!(", restartBackoffMs={backoff_ms}"));
        }
        if let Some(description) = last_child_exit {
            details.push_str(&format!(", lastChildExit={description}"));
        }
        if let Some(code) = telemetry.last_child_exit_code {
            details.push_str(&format!(", exitCode={code}"));
        }
        if let Some(signal) = telemetry.last_child_exit_signal {
            details.push_str(&format!(", signal={signal}"));
        }
        warnings.push(details);
    }

    warnings
}

fn parse_daemon_state_telemetry(raw_state: &str) -> DaemonStateTelemetry {
    DaemonStateTelemetry {
        base_state: parse_json_string_field(raw_state, "baseState"),
        restart_count: parse_json_u32_field(raw_state, "restartCount"),
        restart_backoff_ms: parse_json_u64_field(raw_state, "restartBackoffMs"),
        last_child_exit_description: parse_json_string_field(raw_state, "description"),
        last_child_exit_code: parse_json_i32_field(raw_state, "code"),
        last_child_exit_signal: parse_json_i32_field(raw_state, "signal"),
    }
}

fn process_snapshot() -> Vec<ProcessInfo> {
    let output = match run_command("ps", &["-axo", "pid=,ppid=,pcpu=,pmem=,etime=,command="]) {
        Ok(output) if output.status == 0 => output.stdout,
        _ => return Vec::new(),
    };

    output
        .lines()
        .filter_map(parse_process_line)
        .filter(|process| process_snapshot_filter(&process.command))
        .collect()
}

fn process_snapshot_filter(command: &str) -> bool {
    command.contains("openscout-runtime")
        || command_references_process(command, DAEMON_NAME)
        // Legacy-name compatibility for the openscout-supervisor → scoutd rename.
        || command_references_process(command, LEGACY_DAEMON_NAME)
        || command_references_process(command, "scout-base")
        || command_references_process(command, "scout-broker")
        || command_references_process(command, "scout-web")
        || command_references_process(command, "ScoutMenu")
}

fn legacy_service_label(config: &Config) -> String {
    match config.service_mode.as_str() {
        "prod" => "com.openscout.broker".to_string(),
        "custom" => "com.openscout.broker.custom".to_string(),
        _ => "dev.openscout.broker".to_string(),
    }
}

fn legacy_service_target(config: &Config) -> String {
    format!("{}/{}", config.domain_target, legacy_service_label(config))
}

fn legacy_launch_agent_path(config: &Config) -> PathBuf {
    match home_dir() {
        Ok(home) => home.join(format!(
            "Library/LaunchAgents/{}.plist",
            legacy_service_label(config)
        )),
        Err(_) => config.launch_agent_path.clone(),
    }
}

fn bootout_legacy_service(config: &Config) {
    let legacy_target = legacy_service_target(config);
    if legacy_target != config.service_target {
        let _ = run_command("/bin/launchctl", &["bootout", &legacy_target]);
    }
    // The legacy plist has RunAtLoad=true, so leaving it on disk lets launchd
    // re-bootstrap the old service at every login. Remove it best-effort,
    // consistent with the bootout above.
    let legacy_path = legacy_launch_agent_path(config);
    if legacy_path != config.launch_agent_path && legacy_path.exists() {
        if let Err(error) = fs::remove_file(&legacy_path) {
            eprintln!(
                "[scoutd] failed to remove legacy launch agent {}: {error}",
                legacy_path.display()
            );
        }
    }
}

fn command_references_process(command: &str, process_name: &str) -> bool {
    command
        .split_whitespace()
        .any(|part| part == process_name || part.rsplit('/').next() == Some(process_name))
}

fn command_invokes_scoutd_daemon(command: &str) -> bool {
    let mut parts = command.split_whitespace();
    while let Some(part) = parts.next() {
        let name = part.rsplit('/').next().unwrap_or(part);
        // Legacy-name compatibility for the openscout-supervisor → scoutd rename:
        // a pre-rename `openscout-supervisor supervise` orphan still counts as a
        // daemon process so doctor's duplicate/orphan warnings include it.
        if name == DAEMON_NAME || name == LEGACY_DAEMON_NAME {
            return matches!(parts.next(), Some("supervise"));
        }
    }
    false
}

fn parse_process_line(line: &str) -> Option<ProcessInfo> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let ppid = parts.next()?.parse::<u32>().ok()?;
    let pcpu = parts.next()?.to_string();
    let pmem = parts.next()?.to_string();
    let elapsed = parts.next()?.to_string();
    let command = parts.collect::<Vec<_>>().join(" ");
    Some(ProcessInfo {
        pid,
        ppid,
        pcpu,
        pmem,
        elapsed,
        command,
    })
}

fn ensure_launch_agent(config: &Config) -> Result<(), String> {
    ensure_daemon_directories(config)?;
    let plist = render_launch_agent_plist(config);
    if fs::read_to_string(&config.launch_agent_path)
        .ok()
        .as_deref()
        != Some(plist.as_str())
    {
        fs::write(&config.launch_agent_path, plist).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ensure_daemon_directories(config: &Config) -> Result<(), String> {
    fs::create_dir_all(&config.support_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.runtime_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.logs_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.control_home).map_err(|error| error.to_string())?;
    if let Some(parent) = config.launch_agent_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn render_launch_agent_plist(config: &Config) -> String {
    let mut env_entries = vec![
        ("OPENSCOUT_BROKER_HOST", config.broker_host.clone()),
        ("OPENSCOUT_BROKER_PORT", config.broker_port.to_string()),
        ("OPENSCOUT_BROKER_URL", config.broker_url.clone()),
        (
            "OPENSCOUT_BROKER_SOCKET_PATH",
            config.broker_socket_path.to_string_lossy().to_string(),
        ),
        (
            "OPENSCOUT_SUPPORT_DIRECTORY",
            config.support_directory.to_string_lossy().to_string(),
        ),
        (
            "OPENSCOUT_RUNTIME_PACKAGE_DIR",
            config.runtime_package_dir.to_string_lossy().to_string(),
        ),
        (
            "OPENSCOUT_CONTROL_HOME",
            config.control_home.to_string_lossy().to_string(),
        ),
        ("OPENSCOUT_BROKER_SERVICE_MODE", config.service_mode.clone()),
        ("OPENSCOUT_BROKER_SERVICE_LABEL", config.label.clone()),
        ("OPENSCOUT_SERVICE_LABEL", config.label.clone()),
        ("OPENSCOUT_ADVERTISE_SCOPE", config.advertise_scope.clone()),
        (
            "HOME",
            home_dir()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
        ),
        ("PATH", launch_agent_path_env()),
    ];
    for &key in OPTIONAL_LAUNCH_ENV_KEYS {
        if let Some(value) = env_nonempty(key) {
            env_entries.push((key, value));
        }
    }
    if let Some(core_agents) = env_nonempty("OPENSCOUT_CORE_AGENTS") {
        env_entries.push(("OPENSCOUT_CORE_AGENTS", core_agents));
    }
    let env_block = env_entries
        .into_iter()
        .map(|(key, value)| {
            format!(
                "\n    <key>{}</key>\n    <string>{}</string>",
                xml_escape(key),
                xml_escape(&value),
            )
        })
        .collect::<String>();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{daemon}</string>
    <string>supervise</string>
  </array>
  <key>WorkingDirectory</key>
  <string>{cwd}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>{stdout}</string>
  <key>StandardErrorPath</key>
  <string>{stderr}</string>
  <key>EnvironmentVariables</key>
  <dict>{env_block}
  </dict>
</dict>
</plist>
"#,
        label = xml_escape(&config.label),
        daemon = xml_escape(&config.daemon_executable.to_string_lossy()),
        cwd = xml_escape(&config.runtime_package_dir.to_string_lossy()),
        stdout = xml_escape(&config.stdout_log_path.to_string_lossy()),
        stderr = xml_escape(&config.stderr_log_path.to_string_lossy()),
    )
}

fn read_daemon_state_json(config: &Config) -> Option<String> {
    let raw = fs::read_to_string(&config.daemon_state_path).ok()?;
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn write_daemon_state(
    config: &Config,
    started_at_ms: u128,
    base_pid: Option<u32>,
    base_state: &str,
    restart_count: u32,
    restart_backoff: Option<Duration>,
    last_child_exit: Option<&ChildExitTelemetry>,
) -> Result<(), String> {
    fs::create_dir_all(&config.runtime_directory).map_err(|error| error.to_string())?;
    let payload = format!(
        "{{\
\"schemaVersion\":1,\
\"daemon\":\"scoutd\",\
\"version\":{},\
\"gitSha\":{},\
\"scoutdPid\":{},\
\"startedAtMs\":{},\
\"basePid\":{},\
\"baseState\":{},\
\"restartCount\":{},\
\"restartBackoffMs\":{},\
\"lastChildExit\":{},\
\"updatedAtMs\":{}\
}}\n",
        json_string(BUILD_VERSION),
        json_opt_str(build_git_sha()),
        std::process::id(),
        started_at_ms,
        json_opt_u32(base_pid),
        json_string(base_state),
        restart_count,
        json_opt_u64(restart_backoff.map(duration_millis)),
        child_exit_json(last_child_exit),
        epoch_ms(),
    );
    let temporary_path = config.daemon_state_path.with_extension("json.tmp");
    fs::write(&temporary_path, payload).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, &config.daemon_state_path).map_err(|error| error.to_string())
}

fn child_exit_json(value: Option<&ChildExitTelemetry>) -> String {
    match value {
        Some(exit) => format!(
            "{{\"atMs\":{},\"code\":{},\"signal\":{},\"description\":{}}}",
            exit.at_ms,
            json_opt_i32(exit.code),
            json_opt_i32(exit.signal),
            json_string(&exit.description),
        ),
        None => "null".to_string(),
    }
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[derive(Debug)]
struct CommandOutput {
    status: i32,
    stdout: String,
    stderr: String,
}

fn run_command(command: &str, args: &[&str]) -> Result<CommandOutput, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|error| format!("{command}: {error}"))?;
    Ok(CommandOutput {
        status: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

fn run_command_checked(command: &str, args: &[&str]) -> Result<CommandOutput, String> {
    let output = run_command(command, args)?;
    if output.status == 0 {
        Ok(output)
    } else {
        Err(first_nonempty(&output.stderr, &output.stdout))
    }
}

fn parse_launchctl_u32(raw: &str, prefix: &str) -> Option<u32> {
    parse_launchctl_string(raw, prefix).and_then(|value| value.parse::<u32>().ok())
}

fn parse_launchctl_i32(raw: &str, prefix: &str) -> Option<i32> {
    parse_launchctl_string(raw, prefix).and_then(|value| value.parse::<i32>().ok())
}

fn parse_launchctl_string(raw: &str, prefix: &str) -> Option<String> {
    raw.lines().map(str::trim).find_map(|line| {
        line.strip_prefix(prefix)
            .map(|value| value.trim().to_string())
    })
}

fn parse_json_u32_field(raw: &str, key: &str) -> Option<u32> {
    parse_json_unsigned_field(raw, key).and_then(|value| u32::try_from(value).ok())
}

fn parse_json_u64_field(raw: &str, key: &str) -> Option<u64> {
    parse_json_unsigned_field(raw, key)
}

fn parse_json_unsigned_field(raw: &str, key: &str) -> Option<u64> {
    let after_colon = json_field_after_colon(raw, key)?;
    let digits = after_colon
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u64>().ok()
    }
}

fn parse_json_i32_field(raw: &str, key: &str) -> Option<i32> {
    let after_colon = json_field_after_colon(raw, key)?;
    let value = after_colon.trim_start();
    let mut chars = value.chars();
    let mut number = String::new();
    if matches!(chars.clone().next(), Some('-')) {
        number.push('-');
        chars.next();
    }
    number.extend(chars.take_while(|character| character.is_ascii_digit()));
    if number.is_empty() || number == "-" {
        None
    } else {
        number.parse::<i32>().ok()
    }
}

fn parse_json_string_field(raw: &str, key: &str) -> Option<String> {
    let after_colon = json_field_after_colon(raw, key)?;
    parse_json_string_value(after_colon.trim_start())
}

fn json_field_after_colon<'a>(raw: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{}\"", json_escape(key));
    let (_, after_key) = raw.split_once(&needle)?;
    let (_, after_colon) = after_key.split_once(':')?;
    Some(after_colon)
}

fn parse_json_string_value(raw: &str) -> Option<String> {
    let mut chars = raw.chars();
    if chars.next()? != '"' {
        return None;
    }
    let mut parsed = String::new();
    while let Some(character) = chars.next() {
        match character {
            '"' => return Some(parsed),
            '\\' => match chars.next()? {
                '"' => parsed.push('"'),
                '\\' => parsed.push('\\'),
                '/' => parsed.push('/'),
                'b' => parsed.push('\u{0008}'),
                'f' => parsed.push('\u{000c}'),
                'n' => parsed.push('\n'),
                'r' => parsed.push('\r'),
                't' => parsed.push('\t'),
                'u' => {
                    let mut hex = String::new();
                    for _ in 0..4 {
                        hex.push(chars.next()?);
                    }
                    let value = u32::from_str_radix(&hex, 16).ok()?;
                    parsed.push(char::from_u32(value)?);
                }
                escaped => parsed.push(escaped),
            },
            value => parsed.push(value),
        }
    }
    None
}

fn command_available(command: &str) -> bool {
    if command.contains('/') {
        Path::new(command).exists()
    } else {
        run_command("which", &[command])
            .map(|output| output.status == 0)
            .unwrap_or(false)
    }
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn repo_watch_interval_from_env() -> Option<Duration> {
    let Some(raw) = env_nonempty("OPENSCOUT_REPO_WATCH_INTERVAL_MS") else {
        return Some(DEFAULT_REPO_WATCH_INTERVAL);
    };
    match raw.parse::<i64>() {
        Ok(value) if value <= 0 => None,
        Ok(value) => Some(Duration::from_millis(value as u64)),
        Err(_) => Some(DEFAULT_REPO_WATCH_INTERVAL),
    }
}

fn is_tmp_path(path: &Path) -> bool {
    let value = path.to_string_lossy();
    value == "/tmp"
        || value == "/private/tmp"
        || value.starts_with("/tmp/")
        || value.starts_with("/private/tmp/")
}

fn non_tmp_path_or_default(value: Option<PathBuf>, fallback: PathBuf) -> PathBuf {
    match value {
        Some(path) if !is_tmp_path(&path) => path,
        _ => fallback,
    }
}

fn launch_agent_path_env() -> String {
    let mut entries = Vec::new();
    if let Ok(home) = home_dir() {
        entries.push(home.join(".bun/bin").to_string_lossy().to_string());
    }
    entries.extend(
        env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .map(str::to_string),
    );
    entries.extend([
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ]);

    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|entry| !entry.is_empty() && !is_tmp_path(Path::new(entry)))
        .filter(|entry| seen.insert(entry.clone()))
        .collect::<Vec<_>>()
        .join(":")
}

fn home_dir() -> Result<PathBuf, String> {
    env_nonempty("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())
}

fn user_id() -> Result<u32, String> {
    if let Some(uid) = env_nonempty("UID").and_then(|value| value.parse::<u32>().ok()) {
        return Ok(uid);
    }
    let output = run_command_checked("id", &["-u"])?;
    output
        .stdout
        .parse::<u32>()
        .map_err(|error| error.to_string())
}

fn find_workspace_runtime_dir(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let candidate = current.join("packages/runtime");
        if candidate.join("package.json").exists()
            && candidate.join("bin/openscout-runtime.mjs").exists()
        {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn path_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))
}

fn first_nonempty(first: &str, second: &str) -> String {
    if !first.trim().is_empty() {
        first.trim().to_string()
    } else {
        second.trim().to_string()
    }
}

fn build_git_sha() -> Option<&'static str> {
    option_env!("SCOUTD_GIT_SHA").filter(|value| !value.trim().is_empty())
}

fn build_identity_text() -> String {
    match build_git_sha() {
        Some(git_sha) => format!("{DAEMON_NAME} {BUILD_VERSION} ({git_sha})"),
        None => format!("{DAEMON_NAME} {BUILD_VERSION}"),
    }
}

fn build_identity_json() -> String {
    format!(
        "{{\"name\":{},\"version\":{},\"gitSha\":{}}}",
        json_string(DAEMON_NAME),
        json_string(BUILD_VERSION),
        json_opt_str(build_git_sha()),
    )
}

fn print_version() {
    println!("{}", build_identity_text());
}

fn print_help() {
    println!(
        "scoutd <status|install|start|stop|restart|uninstall|doctor|supervise|version> [--json]\n\n\
         Native daemon for the OpenScout local control plane."
    );
}

fn print_status(status: &ServiceStatus, json: bool) {
    if json {
        println!("{}", status_json(status));
    } else {
        println!("label: {}", status.config.label);
        println!("scoutd: {}", build_identity_text());
        println!("loaded: {}", yes_no(status.launchctl.loaded));
        println!(
            "pid: {}",
            status
                .launchctl
                .pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "-".to_string())
        );
        println!(
            "launchd state: {}",
            status.launchctl.launchd_state.as_deref().unwrap_or("-")
        );
        println!(
            "scoutd state: {}",
            if status.daemon_state.is_some() {
                "recorded"
            } else {
                "missing"
            }
        );
        println!("broker url: {}", status.config.broker_url);
        println!(
            "broker socket: {}",
            status.config.broker_socket_path.display()
        );
        println!("reachable: {}", yes_no(status.health.reachable));
        println!(
            "health: {}",
            if status.health.ok { "ok" } else { "unhealthy" }
        );
    }
}

fn print_doctor(report: &DoctorReport, json: bool) {
    if json {
        println!("{}", doctor_json(report));
    } else {
        print_status(&report.status, false);
        if report.warnings.is_empty() {
            println!("warnings: none");
        } else {
            println!("warnings:");
            for warning in &report.warnings {
                println!("- {warning}");
            }
        }
        println!("processes: {}", report.processes.len());
    }
}

fn status_json(status: &ServiceStatus) -> String {
    let installed = status.config.launch_agent_path.exists();
    let uses_launch_agent = installed || status.launchctl.loaded;
    let last_log_line = if status.health.reachable {
        read_last_log_line(&[
            &status.config.stdout_log_path,
            &status.config.stderr_log_path,
        ])
    } else {
        read_last_log_line(&[
            &status.config.stderr_log_path,
            &status.config.stdout_log_path,
        ])
    };

    format!(
        "{{\
\"label\":{},\
\"mode\":{},\
\"launchAgentPath\":{},\
\"bootoutCommand\":{},\
\"brokerUrl\":{},\
\"brokerSocketPath\":{},\
\"supportDirectory\":{},\
\"runtimeDirectory\":{},\
\"controlHome\":{},\
\"stdoutLogPath\":{},\
\"stderrLogPath\":{},\
\"installed\":{},\
\"loaded\":{},\
\"pid\":{},\
\"launchdState\":{},\
\"lastExitStatus\":{},\
\"usesLaunchAgent\":{},\
\"reachable\":{},\
\"health\":{},\
\"lastLogLine\":{},\
\"scoutdExecutable\":{},\
\"scoutdVersion\":{},\
\"scoutdBuild\":{},\
\"scoutdStatePath\":{},\
\"scoutdState\":{}\
}}",
        json_string(&status.config.label),
        json_string(&status.config.service_mode),
        json_string(&status.config.launch_agent_path.to_string_lossy()),
        json_string(&format!(
            "/bin/launchctl bootout {}",
            status.config.service_target
        )),
        json_string(&status.config.broker_url),
        json_string(&status.config.broker_socket_path.to_string_lossy()),
        json_string(&status.config.support_directory.to_string_lossy()),
        json_string(&status.config.runtime_directory.to_string_lossy()),
        json_string(&status.config.control_home.to_string_lossy()),
        json_string(&status.config.stdout_log_path.to_string_lossy()),
        json_string(&status.config.stderr_log_path.to_string_lossy()),
        installed,
        status.launchctl.loaded,
        json_opt_u32(status.launchctl.pid),
        json_opt_str(status.launchctl.launchd_state.as_deref()),
        json_opt_i32(status.launchctl.last_exit_status),
        uses_launch_agent,
        status.health.reachable,
        health_json(&status.health),
        json_opt_str(last_log_line.as_deref()),
        json_string(&status.config.daemon_executable.to_string_lossy()),
        json_string(BUILD_VERSION),
        build_identity_json(),
        json_string(&status.config.daemon_state_path.to_string_lossy()),
        status.daemon_state.as_deref().unwrap_or("null"),
    )
}

fn health_json(health: &HealthStatus) -> String {
    format!(
        "{{\
\"reachable\":{},\
\"ok\":{},\
\"checkedAt\":{},\
\"transport\":{},\
\"statusCode\":{},\
\"body\":{},\
\"error\":{}\
}}",
        health.reachable,
        health.ok,
        epoch_ms(),
        json_opt_str(health.transport.as_deref()),
        json_opt_u16(health.status_code),
        json_opt_str(health.body.as_deref()),
        json_opt_str(health.error.as_deref()),
    )
}

fn read_last_log_line(paths: &[&Path]) -> Option<String> {
    for path in paths {
        if let Some(line) = read_last_log_line_from(path) {
            return Some(line);
        }
    }
    None
}

/// Window for tailing log files. Even with child log bounding, older files can
/// be large, so we only read trailing bytes rather than the whole file.
const LOG_TAIL_WINDOW: u64 = 64 * 1024;

fn read_last_log_line_from(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let offset = len.saturating_sub(LOG_TAIL_WINDOW);
    if offset > 0 {
        file.seek(SeekFrom::Start(offset)).ok()?;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;

    let tail = String::from_utf8_lossy(&bytes);
    // When we did not start at the beginning of the file, the first line may be
    // a partial line truncated by the seek; skip it.
    let mut lines = tail.lines();
    if offset > 0 {
        lines.next();
    }
    lines
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .next_back()
        .map(str::to_string)
}

fn doctor_json(report: &DoctorReport) -> String {
    let warnings = report
        .warnings
        .iter()
        .map(|warning| json_string(warning))
        .collect::<Vec<_>>()
        .join(",");
    let processes = report
        .processes
        .iter()
        .map(process_json)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"status\":{},\"warnings\":[{}],\"processes\":[{}]}}",
        status_json(&report.status),
        warnings,
        processes,
    )
}

fn process_json(process: &ProcessInfo) -> String {
    format!(
        "{{\"pid\":{},\"ppid\":{},\"pcpu\":{},\"pmem\":{},\"elapsed\":{},\"command\":{}}}",
        process.pid,
        process.ppid,
        json_string(&process.pcpu),
        json_string(&process.pmem),
        json_string(&process.elapsed),
        json_string(&process.command),
    )
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

fn json_opt_str(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
}

fn json_opt_u16(value: Option<u16>) -> String {
    value
        .map(|number| number.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn json_opt_u32(value: Option<u32>) -> String {
    value
        .map(|number| number.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn json_opt_u64(value: Option<u64>) -> String {
    value
        .map(|number| number.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn json_opt_i32(value: Option<i32>) -> String {
    value
        .map(|number| number.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", json_escape(value))
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32))
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::{
        build_identity_json, build_identity_text, command_invokes_scoutd_daemon,
        health_body_reports_ok, parse_daemon_state_telemetry, parse_health_response,
        parse_http_status_code, process_snapshot_filter, read_last_log_line_from,
        restart_telemetry_warnings, rotate_child_log_if_needed, rotated_child_log_path,
        scoutd_owned_child_log_path, BUILD_VERSION, CHILD_LOG_ROTATE_LIMIT, DAEMON_NAME,
        LEGACY_DAEMON_NAME, LOG_TAIL_WINDOW, REPO_WATCH_WARM_PATH,
    };
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn health_body_reports_ok_accepts_compact_and_pretty_json() {
        assert!(health_body_reports_ok(r#"{"ok":true}"#));
        assert!(health_body_reports_ok(
            r#"{
  "ok": true,
  "status": "ready"
}"#
        ));
    }

    #[test]
    fn health_body_reports_ok_rejects_missing_or_false_values() {
        assert!(!health_body_reports_ok(r#"{"ok":false}"#));
        assert!(!health_body_reports_ok(r#"{"status":"ready"}"#));
    }

    #[test]
    fn parse_health_response_marks_pretty_ok_body_healthy() {
        let response =
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\n  \"ok\": true\n}";
        let health = parse_health_response(response).expect("health response parses");

        assert!(health.reachable);
        assert!(health.ok);
        assert_eq!(health.status_code, Some(200));
    }

    #[test]
    fn parse_http_status_code_reads_status_line() {
        assert_eq!(
            parse_http_status_code("HTTP/1.1 202 Accepted\r\ncontent-length: 0\r\n\r\n"),
            Some(202)
        );
        assert_eq!(parse_http_status_code("not an http response"), None);
    }

    #[test]
    fn repo_watch_warm_path_is_a_runtime_nudge() {
        assert_eq!(REPO_WATCH_WARM_PATH, "/v1/repo-watch/warm");
    }

    #[test]
    fn command_invokes_scoutd_daemon_only_matches_daemon_commands() {
        assert!(command_invokes_scoutd_daemon(
            "/Users/arach/dev/openscout/target/debug/scoutd supervise"
        ));
        assert!(!command_invokes_scoutd_daemon(
            "target/debug/scoutd doctor --json"
        ));
        assert!(!command_invokes_scoutd_daemon("scoutd status --json"));
    }

    #[test]
    fn command_invokes_scoutd_daemon_matches_legacy_supervisor_name() {
        // Legacy-name compatibility: a still-running pre-rename daemon must be
        // recognized so doctor's orphan/duplicate warnings include it.
        assert!(command_invokes_scoutd_daemon(
            "/usr/local/bin/openscout-supervisor supervise"
        ));
        assert!(command_invokes_scoutd_daemon(
            "openscout-supervisor supervise"
        ));
        assert!(!command_invokes_scoutd_daemon(
            "openscout-supervisor status --json"
        ));
    }

    #[test]
    fn process_snapshot_filter_matches_legacy_supervisor_name() {
        assert!(process_snapshot_filter(
            "/usr/local/bin/openscout-supervisor supervise"
        ));
        assert!(process_snapshot_filter("scoutd supervise"));
        assert!(!process_snapshot_filter("/bin/zsh -l"));
    }

    #[test]
    fn build_identity_reports_package_version() {
        assert!(build_identity_text().starts_with(&format!("{DAEMON_NAME} {BUILD_VERSION}")));
        assert!(build_identity_json().contains(&format!(r#""version":"{BUILD_VERSION}""#)));
        assert!(build_identity_json().contains(r#""gitSha":"#));
    }

    #[test]
    fn parse_daemon_state_telemetry_reads_restart_fields() {
        let telemetry = parse_daemon_state_telemetry(
            r#"{"baseState":"running","restartCount":2,"restartBackoffMs":4000,"lastChildExit":{"atMs":123,"code":1,"signal":null,"description":"exit status: 1"}}"#,
        );

        assert_eq!(telemetry.base_state.as_deref(), Some("running"));
        assert_eq!(telemetry.restart_count, Some(2));
        assert_eq!(telemetry.restart_backoff_ms, Some(4000));
        assert_eq!(
            telemetry.last_child_exit_description.as_deref(),
            Some("exit status: 1")
        );
        assert_eq!(telemetry.last_child_exit_code, Some(1));
        assert_eq!(telemetry.last_child_exit_signal, None);
    }

    #[test]
    fn restart_telemetry_warnings_include_backoff_and_exit_context() {
        let warnings = restart_telemetry_warnings(
            r#"{"baseState":"exited","restartCount":1,"restartBackoffMs":1000,"lastChildExit":{"atMs":123,"code":null,"signal":9,"description":"signal: 9"}}"#,
        );

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("restartCount=1"));
        assert!(warnings[0].contains("baseState=exited"));
        assert!(warnings[0].contains("restartBackoffMs=1000"));
        assert!(warnings[0].contains("lastChildExit=signal: 9"));
        assert!(warnings[0].contains("signal=9"));
    }

    #[test]
    fn restart_telemetry_warnings_ignore_quiet_state() {
        let warnings = restart_telemetry_warnings(
            r#"{"baseState":"running","restartCount":0,"restartBackoffMs":1000,"lastChildExit":null}"#,
        );

        assert!(warnings.is_empty());
    }

    fn unique_temp_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("scoutd-test-{name}-{nanos}.log"))
    }

    #[test]
    fn read_last_log_line_from_returns_trimmed_last_nonempty_line() {
        let path = unique_temp_path("small");
        fs::write(&path, "first line\nsecond line\n  \n").expect("write log");
        let line = read_last_log_line_from(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(line.as_deref(), Some("second line"));
    }

    #[test]
    fn read_last_log_line_from_reads_only_a_bounded_tail() {
        let path = unique_temp_path("large");
        // Build a file much larger than the tail window so the early lines fall
        // outside it; only the final line should be returned.
        let filler = "x".repeat(200);
        let mut contents = String::new();
        while contents.len() < (LOG_TAIL_WINDOW as usize) * 3 {
            contents.push_str(&filler);
            contents.push('\n');
        }
        contents.push_str("final marker line\n");
        fs::write(&path, &contents).expect("write large log");

        let line = read_last_log_line_from(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(line.as_deref(), Some("final marker line"));
    }

    #[test]
    fn read_last_log_line_from_handles_non_utf8_bytes() {
        let path = unique_temp_path("non-utf8");
        // Invalid UTF-8 (0xFF) on an earlier line, valid final line.
        let mut bytes = b"corrupt \xff line\n".to_vec();
        bytes.extend_from_slice(b"good final line\n");
        fs::write(&path, &bytes).expect("write non-utf8 log");

        let line = read_last_log_line_from(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(line.as_deref(), Some("good final line"));
    }

    #[test]
    fn rotate_child_log_if_needed_retains_tail_and_truncates_current_log() {
        let dir = unique_temp_path("rotate-dir");
        fs::create_dir_all(&dir).expect("create log dir");
        let path = dir.join("stdout.log");
        let marker = b"tail marker line\n";
        let mut contents = vec![b'x'; CHILD_LOG_ROTATE_LIMIT as usize + 32];
        contents.extend_from_slice(marker);
        fs::write(&path, &contents).expect("write large log");

        rotate_child_log_if_needed(&path, &dir).expect("rotate log");

        assert_eq!(fs::metadata(&path).expect("current log metadata").len(), 0);
        let rotated = fs::read(rotated_child_log_path(&path)).expect("read rotated log");
        assert!(rotated.len() <= CHILD_LOG_ROTATE_LIMIT as usize);
        assert!(rotated.ends_with(marker));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_child_log_if_needed_ignores_unowned_log_names() {
        let dir = unique_temp_path("rotate-ignore-dir");
        fs::create_dir_all(&dir).expect("create log dir");
        let path = dir.join("other.log");
        let contents = vec![b'x'; CHILD_LOG_ROTATE_LIMIT as usize + 32];
        fs::write(&path, &contents).expect("write large log");

        rotate_child_log_if_needed(&path, &dir).expect("skip unowned log");

        assert_eq!(
            fs::metadata(&path).expect("current log metadata").len(),
            contents.len() as u64
        );
        assert!(!rotated_child_log_path(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scoutd_owned_child_log_path_accepts_only_expected_child_logs() {
        let dir = PathBuf::from("/Users/example/Library/Application Support/OpenScout/logs/broker");

        assert!(scoutd_owned_child_log_path(&dir.join("stdout.log"), &dir));
        assert!(scoutd_owned_child_log_path(&dir.join("stderr.log"), &dir));
        assert!(!scoutd_owned_child_log_path(&dir.join("other.log"), &dir));
        assert!(!scoutd_owned_child_log_path(
            &dir.join("nested/stdout.log"),
            &dir
        ));
    }

    #[test]
    fn legacy_daemon_name_is_pre_rename_binary() {
        assert_eq!(LEGACY_DAEMON_NAME, "openscout-supervisor");
    }
}
