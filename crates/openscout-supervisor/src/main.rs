#[cfg(not(unix))]
compile_error!("openscout-supervisor first slice requires a Unix-like platform.");

use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_BROKER_HOST: &str = "127.0.0.1";
const DEFAULT_BROKER_HOST_MESH: &str = "0.0.0.0";
const DEFAULT_BROKER_PORT: u16 = 65_535;
const START_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
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
];

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
        "-h" | "--help" | "help" => {
            print_help();
            Ok(())
        }
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
            env_nonempty("OPENSCOUT_CONTROL_HOME")
                .map(PathBuf::from),
            home.join(".openscout/control-plane"),
        );
        let runtime_package_dir = match env_nonempty("OPENSCOUT_RUNTIME_PACKAGE_DIR") {
            Some(value) => PathBuf::from(value),
            None => find_workspace_runtime_dir(&env::current_dir().map_err(|error| error.to_string())?)
                .ok_or_else(|| "unable to resolve runtime package dir; set OPENSCOUT_RUNTIME_PACKAGE_DIR".to_string())?,
        };
        let bun_executable = env_nonempty("OPENSCOUT_BUN_BIN")
            .unwrap_or_else(|| {
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
        let broker_host = env_nonempty("OPENSCOUT_BROKER_HOST").unwrap_or_else(|| default_broker_host.to_string());
        let broker_port = env_nonempty("OPENSCOUT_BROKER_PORT")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(DEFAULT_BROKER_PORT);
        let broker_url = env_nonempty("OPENSCOUT_BROKER_URL")
            .unwrap_or_else(|| format!("http://{broker_host}:{broker_port}"));
        let broker_socket_path = PathBuf::from(
            env_nonempty("OPENSCOUT_BROKER_SOCKET_PATH")
                .unwrap_or_else(|| runtime_directory.join("broker.sock").to_string_lossy().to_string()),
        );

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
    raw: String,
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

fn start_service(config: &Config) -> Result<ServiceStatus, String> {
    ensure_launch_agent(config)?;
    let _ = run_command("/bin/launchctl", &["bootout", &config.service_target]);
    let _ = wait_for_stopped(config);
    run_command_checked("/bin/launchctl", &["bootstrap", &config.domain_target, path_str(&config.launch_agent_path)?])?;
    let _ = run_command("/bin/launchctl", &["kickstart", "-k", &config.service_target]);
    wait_for_healthy(config)
}

fn stop_service(config: &Config) -> Result<ServiceStatus, String> {
    let _ = run_command("/bin/launchctl", &["bootout", &config.service_target]);
    wait_for_stopped(config)
}

fn broker_service_status(config: &Config) -> ServiceStatus {
    ServiceStatus {
        config: config.clone(),
        launchctl: inspect_launchctl(config),
        health: fetch_health(config),
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
        last.health.error.clone().unwrap_or_else(|| "health check failed".to_string()),
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
        Err(error) => {
            return LaunchctlStatus {
                loaded: false,
                pid: None,
                launchd_state: None,
                last_exit_status: None,
                raw: error,
            };
        }
    };

    if output.status != 0 {
        return LaunchctlStatus {
            loaded: false,
            pid: None,
            launchd_state: None,
            last_exit_status: None,
            raw: first_nonempty(&output.stderr, &output.stdout),
        };
    }

    LaunchctlStatus {
        loaded: true,
        pid: parse_launchctl_u32(&output.stdout, "pid ="),
        launchd_state: parse_launchctl_string(&output.stdout, "state ="),
        last_exit_status: parse_launchctl_i32(&output.stdout, "last exit code =")
            .or_else(|| parse_launchctl_i32(&output.stdout, "last exit status =")),
        raw: output.stdout,
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
    let ok = status_code == Some(200) && body.contains("\"ok\":true");
    Ok(HealthStatus {
        reachable: status_code.is_some(),
        ok,
        transport: None,
        status_code,
        body: if body.is_empty() { None } else { Some(body) },
        error: if status_code.is_some() { None } else { Some("missing HTTP status".to_string()) },
    })
}

fn doctor_report(config: &Config) -> DoctorReport {
    let status = broker_service_status(config);
    let processes = process_snapshot();
    let mut warnings = Vec::new();

    if !config.runtime_entrypoint().exists() {
        warnings.push(format!("runtime entrypoint is missing: {}", config.runtime_entrypoint().display()));
    }
    if !command_available(&config.bun_executable) {
        warnings.push(format!("bun executable is not available: {}", config.bun_executable));
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

    let broker_processes: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|process| command_references_process(&process.command, "scout-broker"))
        .collect();
    if broker_processes.len() > 1 {
        warnings.push(format!("multiple scout-broker processes found: {}", broker_processes.len()));
    }
    for process in broker_processes {
        if process.ppid == 1 {
            warnings.push(format!("orphaned scout-broker process: pid {}", process.pid));
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

    DoctorReport { status, processes, warnings }
}

fn process_snapshot() -> Vec<ProcessInfo> {
    let output = match run_command(
        "ps",
        &["-axo", "pid=,ppid=,pcpu=,pmem=,etime=,command="],
    ) {
        Ok(output) if output.status == 0 => output.stdout,
        _ => return Vec::new(),
    };

    output
        .lines()
        .filter_map(parse_process_line)
        .filter(|process| {
            process.command.contains("openscout-runtime")
                || command_references_process(&process.command, "scout-base")
                || command_references_process(&process.command, "scout-broker")
                || command_references_process(&process.command, "scout-web")
                || command_references_process(&process.command, "OpenScoutMenu")
        })
        .collect()
}

fn command_references_process(command: &str, process_name: &str) -> bool {
    command.split_whitespace().any(|part| {
        part == process_name || part.rsplit('/').next() == Some(process_name)
    })
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
    fs::create_dir_all(&config.support_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.runtime_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.logs_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&config.control_home).map_err(|error| error.to_string())?;
    if let Some(parent) = config.launch_agent_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if !config.launch_agent_path.exists() {
        fs::write(&config.launch_agent_path, render_launch_agent_plist(config))
            .map_err(|error| error.to_string())?;
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
        ("OPENSCOUT_CONTROL_HOME", config.control_home.to_string_lossy().to_string()),
        ("OPENSCOUT_BROKER_SERVICE_MODE", config.service_mode.clone()),
        ("OPENSCOUT_BROKER_SERVICE_LABEL", config.label.clone()),
        ("OPENSCOUT_SERVICE_LABEL", config.label.clone()),
        ("OPENSCOUT_ADVERTISE_SCOPE", config.advertise_scope.clone()),
        ("HOME", home_dir().map(|path| path.to_string_lossy().to_string()).unwrap_or_default()),
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
    <string>{bun}</string>
    <string>{entrypoint}</string>
    <string>base</string>
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
        bun = xml_escape(&config.bun_executable),
        entrypoint = xml_escape(&config.runtime_entrypoint().to_string_lossy()),
        cwd = xml_escape(&config.runtime_package_dir.to_string_lossy()),
        stdout = xml_escape(&config.stdout_log_path.to_string_lossy()),
        stderr = xml_escape(&config.stderr_log_path.to_string_lossy()),
    )
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
    raw.lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix(prefix).map(|value| value.trim().to_string()))
}

fn command_available(command: &str) -> bool {
    if command.contains('/') {
        Path::new(command).exists()
    } else {
        run_command("which", &[command]).map(|output| output.status == 0).unwrap_or(false)
    }
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var(name).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

fn is_tmp_path(path: &Path) -> bool {
    let value = path.to_string_lossy();
    value == "/tmp" || value == "/private/tmp" || value.starts_with("/tmp/") || value.starts_with("/private/tmp/")
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
    entries.extend(env::var("PATH").unwrap_or_default().split(':').map(str::to_string));
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
    env_nonempty("HOME").map(PathBuf::from).ok_or_else(|| "HOME is not set".to_string())
}

fn user_id() -> Result<u32, String> {
    if let Some(uid) = env_nonempty("UID").and_then(|value| value.parse::<u32>().ok()) {
        return Ok(uid);
    }
    let output = run_command_checked("id", &["-u"])?;
    output.stdout.parse::<u32>().map_err(|error| error.to_string())
}

fn find_workspace_runtime_dir(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let candidate = current.join("packages/runtime");
        if candidate.join("package.json").exists() && candidate.join("bin/openscout-runtime.mjs").exists() {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn path_str(path: &Path) -> Result<&str, String> {
    path.to_str().ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))
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
        "openscout-supervisor <status|start|stop|restart|doctor> [--json]\n\n\
         First native supervisor slice for the OpenScout local control plane."
    );
}

fn print_status(status: &ServiceStatus, json: bool) {
    if json {
        println!("{}", status_json(status));
    } else {
        println!("label: {}", status.config.label);
        println!("loaded: {}", yes_no(status.launchctl.loaded));
        println!("pid: {}", status.launchctl.pid.map(|pid| pid.to_string()).unwrap_or_else(|| "-".to_string()));
        println!("launchd state: {}", status.launchctl.launchd_state.as_deref().unwrap_or("-"));
        println!("broker url: {}", status.config.broker_url);
        println!("broker socket: {}", status.config.broker_socket_path.display());
        println!("reachable: {}", yes_no(status.health.reachable));
        println!("health: {}", if status.health.ok { "ok" } else { "unhealthy" });
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
    format!(
        "{{\
\"label\":{},\
\"launchAgentPath\":{},\
\"brokerUrl\":{},\
\"brokerSocketPath\":{},\
\"loaded\":{},\
\"pid\":{},\
\"launchdState\":{},\
\"lastExitStatus\":{},\
\"reachable\":{},\
\"health\":{},\
\"healthTransport\":{},\
\"healthStatusCode\":{},\
\"healthBody\":{},\
\"healthError\":{}\
}}",
        json_string(&status.config.label),
        json_string(&status.config.launch_agent_path.to_string_lossy()),
        json_string(&status.config.broker_url),
        json_string(&status.config.broker_socket_path.to_string_lossy()),
        status.launchctl.loaded,
        json_opt_u32(status.launchctl.pid),
        json_opt_str(status.launchctl.launchd_state.as_deref()),
        json_opt_i32(status.launchctl.last_exit_status),
        status.health.reachable,
        status.health.ok,
        json_opt_str(status.health.transport.as_deref()),
        json_opt_u16(status.health.status_code),
        json_opt_str(status.health.body.as_deref()),
        json_opt_str(status.health.error.as_deref()),
    )
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
    if value { "yes" } else { "no" }
}

fn json_opt_str(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
}

fn json_opt_u16(value: Option<u16>) -> String {
    value.map(|number| number.to_string()).unwrap_or_else(|| "null".to_string())
}

fn json_opt_u32(value: Option<u32>) -> String {
    value.map(|number| number.to_string()).unwrap_or_else(|| "null".to_string())
}

fn json_opt_i32(value: Option<i32>) -> String {
    value.map(|number| number.to_string()).unwrap_or_else(|| "null".to_string())
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
            character if character.is_control() => escaped.push_str(&format!("\\u{:04x}", character as u32)),
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
