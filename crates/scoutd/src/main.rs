#[cfg(not(unix))]
compile_error!("scoutd first slice requires a Unix-like platform.");

use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, Stdio};
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
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;
const DAEMON_NAME: &str = "scoutd";
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
    let mut child = spawn_base_process(config)?;
    write_daemon_state(
        config,
        started_at_ms,
        Some(child.id()),
        "running",
        restart_count,
    )?;
    let mut next_state_write = Instant::now() + STATE_WRITE_INTERVAL;

    while !SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => {
                write_daemon_state(config, started_at_ms, None, "exited", restart_count)?;
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
    )?;
    terminate_child(&mut child, "Bun base", CHILD_SHUTDOWN_TIMEOUT)?;
    write_daemon_state(config, started_at_ms, None, "stopped", restart_count)?;
    Ok(())
}

fn install_signal_handlers() {
    unsafe {
        let _ = signal(SIGINT, request_shutdown);
        let _ = signal(SIGTERM, request_shutdown);
    }
}

fn spawn_base_process(config: &Config) -> Result<Child, String> {
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
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

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

fn sleep_until_or_shutdown(deadline: Instant) {
    while Instant::now() < deadline && !SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
        thread::sleep(POLL_INTERVAL);
    }
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
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    parse_health_response(&response)
}

fn parse_health_response(response: &str) -> Result<HealthStatus, String> {
    let status_line = response.lines().next().unwrap_or_default();
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
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
) -> Result<(), String> {
    fs::create_dir_all(&config.runtime_directory).map_err(|error| error.to_string())?;
    let payload = format!(
        "{{\
\"schemaVersion\":1,\
\"daemon\":\"scoutd\",\
\"scoutdPid\":{},\
\"startedAtMs\":{},\
\"basePid\":{},\
\"baseState\":{},\
\"restartCount\":{},\
\"updatedAtMs\":{}\
}}\n",
        std::process::id(),
        started_at_ms,
        json_opt_u32(base_pid),
        json_string(base_state),
        restart_count,
        epoch_ms(),
    );
    let temporary_path = config.daemon_state_path.with_extension("json.tmp");
    fs::write(&temporary_path, payload).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, &config.daemon_state_path).map_err(|error| error.to_string())
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

fn print_help() {
    println!(
        "scoutd <status|install|start|stop|restart|uninstall|doctor|supervise> [--json]\n\n\
         Native daemon for the OpenScout local control plane."
    );
}

fn print_status(status: &ServiceStatus, json: bool) {
    if json {
        println!("{}", status_json(status));
    } else {
        println!("label: {}", status.config.label);
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

/// Window for tailing log files. Logs are unrotated and can reach hundreds of
/// MB, so we only read this many trailing bytes rather than the whole file.
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
        command_invokes_scoutd_daemon, health_body_reports_ok, parse_health_response,
        process_snapshot_filter, read_last_log_line_from, LEGACY_DAEMON_NAME, LOG_TAIL_WINDOW,
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
    fn legacy_daemon_name_is_pre_rename_binary() {
        assert_eq!(LEGACY_DAEMON_NAME, "openscout-supervisor");
    }
}
