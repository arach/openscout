use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_MAX_ROOTS: usize = 8;
const DEFAULT_MAX_WORKTREES: usize = 4;
const DEFAULT_MAX_FILES_PER_WORKTREE: usize = 12;
const DEFAULT_SCAN_BUDGET_MS: u64 = 4_000;
const GIT_TIMEOUT: Duration = Duration::from_millis(650);
const GIT_MAX_BUFFER: usize = 1024 * 1024;

pub fn run(args: &[String]) -> Result<(), String> {
    if args.iter().any(|arg| matches!(arg.as_str(), "-h" | "--help" | "help")) {
        print_help();
        return Ok(());
    }
    let command = args
        .iter()
        .find(|arg| !arg.starts_with("--"))
        .map(String::as_str)
        .unwrap_or("snapshot");
    match command {
        "snapshot" => {
            let options = SnapshotOptions::from_args(args)?;
            let snapshot = build_snapshot(&options);
            if options.json {
                println!("{}", snapshot.to_json());
            } else {
                println!("projects: {}", snapshot.projects.len());
                println!("worktrees: {}", snapshot.totals.worktrees);
                println!("dirty worktrees: {}", snapshot.totals.dirty_worktrees);
                if !snapshot.warnings.is_empty() {
                    println!("warnings:");
                    for warning in &snapshot.warnings {
                        println!("- {warning}");
                    }
                }
            }
            Ok(())
        }
        "-h" | "--help" | "help" => {
            print_help();
            Ok(())
        }
        other => Err(format!("unknown repo-watch command: {other}")),
    }
}

fn print_help() {
    println!(
        "openscout-supervisor repo-watch snapshot --json [--hints-file path] \
         [--include-diff] [--include-last-commit]"
    );
}

#[derive(Clone, Debug)]
struct SnapshotOptions {
    json: bool,
    hints_file: Option<PathBuf>,
    include_diff: bool,
    include_last_commit: bool,
    max_roots: usize,
    max_worktrees: usize,
    max_files_per_worktree: usize,
    scan_budget_ms: u64,
}

impl SnapshotOptions {
    fn from_args(args: &[String]) -> Result<Self, String> {
        let mut options = Self {
            json: args.iter().any(|arg| arg == "--json"),
            hints_file: None,
            include_diff: false,
            include_last_commit: false,
            max_roots: read_positive_usize_env("OPENSCOUT_REPO_WATCH_MAX_ROOTS", DEFAULT_MAX_ROOTS),
            max_worktrees: read_positive_usize_env("OPENSCOUT_REPO_WATCH_MAX_WORKTREES", DEFAULT_MAX_WORKTREES),
            max_files_per_worktree: read_positive_usize_env(
                "OPENSCOUT_REPO_WATCH_MAX_FILES_PER_WORKTREE",
                DEFAULT_MAX_FILES_PER_WORKTREE,
            ),
            scan_budget_ms: read_positive_u64_env("OPENSCOUT_REPO_WATCH_SCAN_BUDGET_MS", DEFAULT_SCAN_BUDGET_MS),
        };

        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "snapshot" | "--json" => {}
                "--include-diff" => options.include_diff = true,
                "--include-last-commit" => options.include_last_commit = true,
                "--hints-file" => {
                    index += 1;
                    let value = args.get(index).ok_or_else(|| "--hints-file requires a path".to_string())?;
                    options.hints_file = Some(PathBuf::from(value));
                }
                "--max-roots" => {
                    index += 1;
                    options.max_roots = parse_usize_arg("--max-roots", args.get(index))?;
                }
                "--max-worktrees" => {
                    index += 1;
                    options.max_worktrees = parse_usize_arg("--max-worktrees", args.get(index))?;
                }
                "--max-files-per-worktree" => {
                    index += 1;
                    options.max_files_per_worktree = parse_usize_arg("--max-files-per-worktree", args.get(index))?;
                }
                "--scan-budget-ms" => {
                    index += 1;
                    options.scan_budget_ms = parse_u64_arg("--scan-budget-ms", args.get(index))?;
                }
                value if value.starts_with("--") => return Err(format!("unknown repo-watch flag: {value}")),
                _ => {}
            }
            index += 1;
        }

        Ok(options)
    }
}

#[derive(Clone, Debug)]
struct Hint {
    path: String,
    source: String,
    source_label: Option<String>,
    agent_id: Option<String>,
    agent_name: Option<String>,
    agent_state: Option<String>,
    session_id: Option<String>,
    harness: Option<String>,
    runtime_source: Option<String>,
}

#[derive(Clone, Debug)]
struct GitRoot {
    top_level: String,
    common_git_dir: String,
    hints: Vec<Hint>,
}

#[derive(Clone, Debug)]
struct ParsedWorktree {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
    bare: bool,
}

#[derive(Clone, Debug)]
struct ChangedFile {
    path: String,
    status: String,
}

#[derive(Clone, Debug)]
struct StatusSummary {
    clean: bool,
    staged: usize,
    unstaged: usize,
    untracked: usize,
    conflicts: usize,
    changed_files: usize,
    files: Vec<ChangedFile>,
}

#[derive(Clone, Debug)]
struct BranchSummary {
    name: Option<String>,
    upstream: Option<String>,
    head: Option<String>,
    detached: bool,
    ahead: usize,
    behind: usize,
    is_main: bool,
    diverged: bool,
}

#[derive(Clone, Debug)]
struct ParsedStatus {
    branch: BranchSummary,
    status: StatusSummary,
}

#[derive(Clone, Debug)]
struct AgentRef {
    id: String,
    name: Option<String>,
    state: Option<String>,
    harness: Option<String>,
}

#[derive(Clone, Debug)]
struct SessionRef {
    id: String,
    source: Option<String>,
    harness: Option<String>,
}

#[derive(Clone, Debug)]
struct DiffSummary {
    unstaged_shortstat: Option<String>,
    staged_shortstat: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Attention {
    Unknown = 0,
    Quiet = 1,
    Active = 2,
    Attention = 3,
    Critical = 4,
}

impl Attention {
    fn as_str(self) -> &'static str {
        match self {
            Attention::Unknown => "unknown",
            Attention::Quiet => "quiet",
            Attention::Active => "active",
            Attention::Attention => "attention",
            Attention::Critical => "critical",
        }
    }
}

#[derive(Clone, Debug)]
struct Worktree {
    id: String,
    path: String,
    name: String,
    is_bare: bool,
    branch: BranchSummary,
    status: StatusSummary,
    diff: DiffSummary,
    attention: Attention,
    attention_reasons: Vec<String>,
    agents: Vec<AgentRef>,
    sessions: Vec<SessionRef>,
    hints: Vec<Hint>,
    last_commit_at: Option<u128>,
    scanned_at: u128,
    error: Option<String>,
}

#[derive(Clone, Debug)]
struct ProjectStats {
    worktrees: usize,
    dirty_worktrees: usize,
    conflicted_worktrees: usize,
    attached_agents: usize,
    attached_sessions: usize,
    staged: usize,
    unstaged: usize,
    untracked: usize,
    conflicts: usize,
}

#[derive(Clone, Debug)]
struct Project {
    id: String,
    name: String,
    root: String,
    common_git_dir: String,
    attention: Attention,
    attention_reasons: Vec<String>,
    worktrees: Vec<Worktree>,
    stats: ProjectStats,
    hints: Vec<Hint>,
}

#[derive(Clone, Debug)]
struct Totals {
    projects: usize,
    worktrees: usize,
    dirty_worktrees: usize,
    conflicted_worktrees: usize,
    attention_worktrees: usize,
    attached_agents: usize,
    attached_sessions: usize,
}

#[derive(Clone, Debug)]
struct Snapshot {
    generated_at: u128,
    projects: Vec<Project>,
    totals: Totals,
    warnings: Vec<String>,
}

fn build_snapshot(options: &SnapshotOptions) -> Snapshot {
    let generated_at = epoch_ms();
    let deadline = if options.scan_budget_ms > 0 {
        Some(Instant::now() + Duration::from_millis(options.scan_budget_ms))
    } else {
        None
    };
    let hints = normalize_hints(read_hints(options));
    let discovered = discover_git_roots(&hints, options.max_roots, deadline);
    let mut warnings = discovered.warnings;
    let mut projects = Vec::new();

    for root in discovered.roots {
        if budget_exceeded(deadline) {
            warnings.push("Repo Watch stopped scanning repositories after reaching the scan budget.".to_string());
            break;
        }
        let scanned = scan_project(&root, generated_at, options, deadline);
        warnings.extend(scanned.warnings);
        projects.push(scanned.project);
    }

    projects.sort_by(|left, right| {
        right
            .attention
            .cmp(&left.attention)
            .then_with(|| left.name.cmp(&right.name))
    });

    let totals = totals_for_projects(&projects);
    Snapshot {
        generated_at,
        projects,
        totals,
        warnings,
    }
}

struct DiscoveredRoots {
    roots: Vec<GitRoot>,
    warnings: Vec<String>,
}

struct ScannedProject {
    project: Project,
    warnings: Vec<String>,
}

fn discover_git_roots(hints: &[Hint], max_roots: usize, deadline: Option<Instant>) -> DiscoveredRoots {
    let mut warnings = Vec::new();
    let mut roots_by_common_dir: HashMap<String, GitRoot> = HashMap::new();
    let mut root_order = Vec::new();
    let mut truncated_by_budget = false;
    let mut truncated_by_max = false;

    for group in group_hints_by_path(hints) {
        if budget_exceeded(deadline) {
            truncated_by_budget = true;
            break;
        }
        if roots_by_common_dir.len() >= max_roots {
            truncated_by_max = true;
            break;
        }

        let Some(dir) = existing_directory_for_path(&group.path) else {
            warnings.push(format!("Skipped missing repo-watch path: {}", group.path));
            continue;
        };

        let top_level_raw = match run_git(&dir, &["rev-parse", "--show-toplevel"]) {
            Ok(value) => value.trim().to_string(),
            Err(_) => continue,
        };
        let top_level = normalize_path_string(&top_level_raw);
        let common_git_dir = match run_git(&top_level, &["rev-parse", "--git-common-dir"]) {
            Ok(value) => {
                let trimmed = value.trim();
                if Path::new(trimmed).is_absolute() {
                    normalize_path_string(trimmed)
                } else {
                    normalize_path_string(&Path::new(&top_level).join(trimmed).to_string_lossy())
                }
            }
            Err(_) => {
                warnings.push(format!("Could not resolve Git common directory for {top_level}"));
                top_level.clone()
            }
        };

        if let Some(existing) = roots_by_common_dir.get_mut(&common_git_dir) {
            existing.hints.extend(group.hints);
        } else if roots_by_common_dir.len() < max_roots {
            root_order.push(common_git_dir.clone());
            roots_by_common_dir.insert(common_git_dir.clone(), GitRoot {
                top_level,
                common_git_dir,
                hints: group.hints,
            });
        }
    }

    if truncated_by_max {
        warnings.push(format!("Repo Watch limited discovery to {max_roots} repositories."));
    }
    if truncated_by_budget {
        warnings.push("Repo Watch stopped discovery after reaching the scan budget.".to_string());
    }

    let roots = root_order
        .into_iter()
        .filter_map(|key| roots_by_common_dir.remove(&key))
        .map(|mut root| {
            root.hints = unique_hints(root.hints);
            root
        })
        .collect();

    DiscoveredRoots { roots, warnings }
}

fn scan_project(
    root: &GitRoot,
    now: u128,
    options: &SnapshotOptions,
    deadline: Option<Instant>,
) -> ScannedProject {
    let mut warnings = Vec::new();
    let raw_worktrees = safe_git(&root.top_level, &["worktree", "list", "--porcelain"]);
    let parsed_worktrees = raw_worktrees
        .as_deref()
        .map(parse_git_worktree_list)
        .filter(|worktrees| !worktrees.is_empty())
        .unwrap_or_else(|| {
            vec![ParsedWorktree {
                path: root.top_level.clone(),
                head: None,
                branch: None,
                detached: false,
                bare: false,
            }]
        });

    let mut ordered_worktrees = parsed_worktrees.clone();
    ordered_worktrees.sort_by(|left, right| {
        let left_rank = worktree_hint_rank(left, &root.hints);
        let right_rank = worktree_hint_rank(right, &root.hints);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.path.cmp(&right.path))
    });

    if ordered_worktrees.len() > options.max_worktrees {
        warnings.push(format!(
            "Repo Watch limited {} to {} worktrees.",
            root.top_level, options.max_worktrees,
        ));
    }

    let mut worktrees = Vec::new();
    for worktree in ordered_worktrees.into_iter().take(options.max_worktrees) {
        if budget_exceeded(deadline) {
            warnings.push(format!(
                "Repo Watch stopped scanning {} after reaching the scan budget.",
                root.top_level,
            ));
            break;
        }
        let matched_hints: Vec<Hint> = root
            .hints
            .iter()
            .filter(|hint| path_contains(&worktree.path, &hint.path))
            .cloned()
            .collect();
        let hints = if !matched_hints.is_empty() || worktree.path != root.top_level {
            matched_hints
        } else {
            root.hints.clone()
        };
        worktrees.push(scan_worktree(&worktree, hints, now, options));
    }

    let stats = stats_for_project(&worktrees);
    let attention = worktrees
        .iter()
        .map(|worktree| worktree.attention)
        .max()
        .unwrap_or(Attention::Unknown);
    let attention_reasons = unique_strings(
        worktrees
            .iter()
            .flat_map(|worktree| worktree.attention_reasons.clone())
            .collect(),
    )
    .into_iter()
    .take(6)
    .collect::<Vec<_>>();
    let root_path = worktrees
        .first()
        .map(|worktree| worktree.path.clone())
        .unwrap_or_else(|| root.top_level.clone());

    ScannedProject {
        project: Project {
            id: format!("repo:{}", hash_id(&root.common_git_dir)),
            name: path_basename(&root_path).unwrap_or_else(|| {
                path_basename(&root.common_git_dir).unwrap_or_else(|| root_path.clone())
            }),
            root: root_path,
            common_git_dir: root.common_git_dir.clone(),
            attention,
            attention_reasons,
            worktrees,
            stats,
            hints: root.hints.clone(),
        },
        warnings,
    }
}

fn scan_worktree(
    worktree: &ParsedWorktree,
    hints: Vec<Hint>,
    now: u128,
    options: &SnapshotOptions,
) -> Worktree {
    let status_output = safe_git(&worktree.path, &["status", "--porcelain=v2", "--branch", "-unormal"]);
    let mut parsed = status_output
        .as_deref()
        .map(|output| parse_git_status_porcelain_v2(output, options.max_files_per_worktree))
        .unwrap_or_else(|| ParsedStatus {
            branch: BranchSummary {
                name: worktree.branch.clone(),
                upstream: None,
                head: worktree.head.clone(),
                detached: worktree.detached,
                ahead: 0,
                behind: 0,
                is_main: is_main_branch(worktree.branch.as_deref()),
                diverged: false,
            },
            status: blank_status(),
        });

    if parsed.branch.name.is_none() {
        parsed.branch.name = worktree.branch.clone();
    }
    if parsed.branch.head.is_none() {
        parsed.branch.head = worktree.head.clone();
    }
    parsed.branch.detached = parsed.branch.name.is_none() && worktree.branch.is_none();
    parsed.branch.is_main = is_main_branch(parsed.branch.name.as_deref().or(worktree.branch.as_deref()));

    let unstaged_diff = if options.include_diff {
        safe_git(&worktree.path, &["diff", "--shortstat"]).and_then(nonempty_trimmed)
    } else {
        None
    };
    let staged_diff = if options.include_diff {
        safe_git(&worktree.path, &["diff", "--cached", "--shortstat"]).and_then(nonempty_trimmed)
    } else {
        None
    };
    let last_commit_at = if options.include_last_commit {
        safe_git(&worktree.path, &["log", "-1", "--format=%ct"])
            .and_then(|value| value.trim().parse::<u128>().ok())
            .map(|seconds| seconds.saturating_mul(1_000))
    } else {
        None
    };

    let refs = refs_for_hints(&hints);
    let error = if status_output.is_some() {
        None
    } else {
        Some("Could not read Git status".to_string())
    };
    let classified = classify_worktree(&parsed.status, &parsed.branch, &refs.agents, &refs.sessions, error.as_deref());

    Worktree {
        id: format!("worktree:{}", hash_id(&worktree.path)),
        path: worktree.path.clone(),
        name: path_basename(&worktree.path).unwrap_or_else(|| worktree.path.clone()),
        is_bare: worktree.bare,
        branch: parsed.branch,
        status: parsed.status,
        diff: DiffSummary {
            unstaged_shortstat: unstaged_diff,
            staged_shortstat: staged_diff,
        },
        attention: classified.0,
        attention_reasons: classified.1,
        agents: refs.agents,
        sessions: refs.sessions,
        hints,
        last_commit_at,
        scanned_at: now,
        error,
    }
}

fn parse_git_worktree_list(output: &str) -> Vec<ParsedWorktree> {
    let mut worktrees = Vec::new();
    let mut current: Option<ParsedWorktree> = None;

    fn flush(current: &mut Option<ParsedWorktree>, worktrees: &mut Vec<ParsedWorktree>) {
        if let Some(mut worktree) = current.take() {
            worktree.path = normalize_path_string(&worktree.path);
            if worktree.branch.is_none() {
                worktree.detached = true;
            }
            worktrees.push(worktree);
        }
    }

    for line in output.lines() {
        if line.trim().is_empty() {
            flush(&mut current, &mut worktrees);
            continue;
        }
        let mut parts = line.splitn(2, ' ');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default().trim();
        match key {
            "worktree" => {
                flush(&mut current, &mut worktrees);
                current = Some(ParsedWorktree {
                    path: value.to_string(),
                    head: None,
                    branch: None,
                    detached: false,
                    bare: false,
                });
            }
            "HEAD" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.head = nonempty(value);
                }
            }
            "branch" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.branch = nonempty(value.trim_start_matches("refs/heads/"));
                }
            }
            "detached" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.detached = true;
                }
            }
            "bare" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.bare = true;
                }
            }
            _ => {}
        }
    }
    flush(&mut current, &mut worktrees);
    worktrees
}

fn parse_git_status_porcelain_v2(output: &str, max_files: usize) -> ParsedStatus {
    let mut status = blank_status();
    let mut head = None;
    let mut branch_name = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.oid ") {
            let trimmed = value.trim();
            head = if trimmed.is_empty() || trimmed == "(initial)" {
                None
            } else {
                Some(trimmed.to_string())
            };
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.head ") {
            let trimmed = value.trim();
            branch_name = if trimmed.is_empty() || trimmed == "(detached)" {
                None
            } else {
                Some(trimmed.to_string())
            };
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.upstream ") {
            upstream = nonempty(value.trim());
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            let parts = value.split_whitespace().collect::<Vec<_>>();
            ahead = parts
                .first()
                .and_then(|part| part.strip_prefix('+'))
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            behind = parts
                .get(1)
                .and_then(|part| part.strip_prefix('-'))
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            continue;
        }

        if line.starts_with("? ") {
            status.untracked += 1;
            push_changed_file(&mut status, extract_status_path(line), "untracked", max_files);
            continue;
        }
        if line.starts_with("u ") {
            status.conflicts += 1;
            push_changed_file(&mut status, extract_status_path(line), "conflict", max_files);
            continue;
        }
        if line.starts_with("1 ") || line.starts_with("2 ") {
            let xy = line.get(2..4).unwrap_or_default().as_bytes().to_vec();
            let staged = xy.first().map(|value| *value != b'.').unwrap_or(false);
            let unstaged = xy.get(1).map(|value| *value != b'.').unwrap_or(false);
            if staged {
                status.staged += 1;
            }
            if unstaged {
                status.unstaged += 1;
            }
            let label = match (staged, unstaged) {
                (true, true) => "staged+unstaged",
                (true, false) => "staged",
                (false, true) => "unstaged",
                (false, false) => "changed",
            };
            push_changed_file(&mut status, extract_status_path(line), label, max_files);
        }
    }

    status.clean = status.staged == 0
        && status.unstaged == 0
        && status.untracked == 0
        && status.conflicts == 0;
    let is_main = is_main_branch(branch_name.as_deref());
    let detached = branch_name.is_none();

    ParsedStatus {
        branch: BranchSummary {
            name: branch_name,
            upstream,
            head,
            detached,
            ahead,
            behind,
            is_main,
            diverged: ahead > 0 && behind > 0,
        },
        status,
    }
}

fn blank_status() -> StatusSummary {
    StatusSummary {
        clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        changed_files: 0,
        files: Vec::new(),
    }
}

fn extract_status_path(line: &str) -> String {
    if let Some(value) = line.strip_prefix("? ") {
        return value.trim().to_string();
    }
    if line.starts_with("u ") {
        return line.split(' ').skip(10).collect::<Vec<_>>().join(" ").trim().to_string();
    }
    if line.starts_with("2 ") {
        let primary = line.split('\t').next().unwrap_or(line);
        return primary.split(' ').skip(9).collect::<Vec<_>>().join(" ").trim().to_string();
    }
    if line.starts_with("1 ") {
        return line.split(' ').skip(8).collect::<Vec<_>>().join(" ").trim().to_string();
    }
    String::new()
}

fn push_changed_file(status: &mut StatusSummary, path: String, label: &str, max_files: usize) {
    status.changed_files += 1;
    if status.files.len() < max_files {
        status.files.push(ChangedFile {
            path: if path.is_empty() { "unknown".to_string() } else { path },
            status: label.to_string(),
        });
    }
}

struct HintGroup {
    path: String,
    hints: Vec<Hint>,
}

struct HintRefs {
    agents: Vec<AgentRef>,
    sessions: Vec<SessionRef>,
}

fn read_hints(options: &SnapshotOptions) -> Vec<Hint> {
    let mut hints = environment_hints();
    if let Some(path) = &options.hints_file {
        if let Ok(raw) = fs::read_to_string(path) {
            hints.extend(raw.lines().filter_map(parse_hint_line));
        }
    }
    hints
}

fn environment_hints() -> Vec<Hint> {
    env::var("OPENSCOUT_REPO_WATCH_ROOTS")
        .ok()
        .map(|raw| {
            raw.split(|character| character == ',' || character == ':')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(|path| Hint {
                    path: path.to_string(),
                    source: "environment".to_string(),
                    source_label: Some("OPENSCOUT_REPO_WATCH_ROOTS".to_string()),
                    agent_id: None,
                    agent_name: None,
                    agent_state: None,
                    session_id: None,
                    harness: None,
                    runtime_source: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_hint_line(line: &str) -> Option<Hint> {
    let trimmed = line.trim_end_matches(|character| character == '\r' || character == '\n');
    if trimmed.trim().is_empty() {
        return None;
    }
    let fields = trimmed.split('\t').collect::<Vec<_>>();
    let path = fields.first()?.trim();
    if path.is_empty() {
        return None;
    }
    Some(Hint {
        path: path.to_string(),
        source: fields.get(1).and_then(|value| nonempty(value.trim())).unwrap_or_else(|| "endpoint".to_string()),
        source_label: fields.get(2).and_then(|value| nonempty(value.trim())),
        agent_id: fields.get(3).and_then(|value| nonempty(value.trim())),
        agent_name: fields.get(4).and_then(|value| nonempty(value.trim())),
        agent_state: fields.get(5).and_then(|value| nonempty(value.trim())),
        session_id: fields.get(6).and_then(|value| nonempty(value.trim())),
        harness: fields.get(7).and_then(|value| nonempty(value.trim())),
        runtime_source: fields.get(8).and_then(|value| nonempty(value.trim())),
    })
}

fn normalize_hints(hints: Vec<Hint>) -> Vec<Hint> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for mut hint in hints.into_iter().filter(|hint| !hint.path.trim().is_empty()) {
        hint.path = normalize_path_string(&expand_home(&hint.path));
        let key = hint_key(&hint);
        if seen.insert(key) {
            out.push(hint);
        }
    }
    out.sort_by(|left, right| {
        hint_discovery_rank(left)
            .cmp(&hint_discovery_rank(right))
            .then_with(|| left.path.cmp(&right.path))
    });
    out
}

fn unique_hints(hints: Vec<Hint>) -> Vec<Hint> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for hint in hints {
        let key = format!(
            "{}\0{}\0{}\0{}",
            hint.path,
            hint.source,
            hint.agent_id.as_deref().unwrap_or_default(),
            hint.session_id.as_deref().unwrap_or_default(),
        );
        if seen.insert(key) {
            out.push(hint);
        }
    }
    out
}

fn group_hints_by_path(hints: &[Hint]) -> Vec<HintGroup> {
    let mut groups: HashMap<String, Vec<Hint>> = HashMap::new();
    let mut order = Vec::new();
    for hint in hints {
        if !groups.contains_key(&hint.path) {
            order.push(hint.path.clone());
        }
        groups.entry(hint.path.clone()).or_default().push(hint.clone());
    }
    order
        .into_iter()
        .filter_map(|path| groups.remove(&path).map(|hints| HintGroup { path, hints }))
        .collect()
}

fn refs_for_hints(hints: &[Hint]) -> HintRefs {
    let mut agents = Vec::new();
    let mut seen_agents = HashSet::new();
    let mut sessions = Vec::new();
    let mut seen_sessions = HashSet::new();

    for hint in hints {
        if let Some(agent_id) = &hint.agent_id {
            if seen_agents.insert(agent_id.clone()) {
                agents.push(AgentRef {
                    id: agent_id.clone(),
                    name: hint.agent_name.clone(),
                    state: hint.agent_state.clone(),
                    harness: hint.harness.clone().or_else(|| hint.runtime_source.clone()),
                });
            }
        }
        if let Some(session_id) = &hint.session_id {
            if seen_sessions.insert(session_id.clone()) {
                sessions.push(SessionRef {
                    id: session_id.clone(),
                    source: hint.runtime_source.clone(),
                    harness: hint.harness.clone(),
                });
            }
        }
    }

    HintRefs { agents, sessions }
}

fn classify_worktree(
    status: &StatusSummary,
    branch: &BranchSummary,
    agents: &[AgentRef],
    sessions: &[SessionRef],
    error: Option<&str>,
) -> (Attention, Vec<String>) {
    let mut reasons = Vec::new();
    if let Some(error) = error {
        return (Attention::Attention, vec![error.to_string()]);
    }
    if status.conflicts > 0 {
        reasons.push(format!(
            "{} conflicted file{}",
            status.conflicts,
            if status.conflicts == 1 { "" } else { "s" },
        ));
        return (Attention::Critical, reasons);
    }
    if branch.is_main && !status.clean {
        reasons.push(format!("Dirty {}", branch.name.as_deref().unwrap_or("main")));
    }
    if branch.diverged {
        reasons.push(format!("Diverged from {}", branch.upstream.as_deref().unwrap_or("upstream")));
    }
    if !reasons.is_empty() {
        return (Attention::Attention, reasons);
    }
    if !status.clean {
        reasons.push(format!(
            "{} changed file{}",
            status.changed_files,
            if status.changed_files == 1 { "" } else { "s" },
        ));
    }
    if branch.ahead > 0 {
        reasons.push(format!("{} ahead", branch.ahead));
    }
    if branch.behind > 0 {
        reasons.push(format!("{} behind", branch.behind));
    }
    if !agents.is_empty() || !sessions.is_empty() {
        reasons.push("Scout activity attached".to_string());
    }
    if !reasons.is_empty() {
        return (Attention::Active, reasons);
    }
    (Attention::Quiet, reasons)
}

fn stats_for_project(worktrees: &[Worktree]) -> ProjectStats {
    let agent_ids = worktrees
        .iter()
        .flat_map(|worktree| worktree.agents.iter().map(|agent| agent.id.clone()))
        .collect::<HashSet<_>>();
    let session_ids = worktrees
        .iter()
        .flat_map(|worktree| worktree.sessions.iter().map(|session| session.id.clone()))
        .collect::<HashSet<_>>();
    ProjectStats {
        worktrees: worktrees.len(),
        dirty_worktrees: worktrees.iter().filter(|worktree| !worktree.status.clean).count(),
        conflicted_worktrees: worktrees.iter().filter(|worktree| worktree.status.conflicts > 0).count(),
        attached_agents: agent_ids.len(),
        attached_sessions: session_ids.len(),
        staged: worktrees.iter().map(|worktree| worktree.status.staged).sum(),
        unstaged: worktrees.iter().map(|worktree| worktree.status.unstaged).sum(),
        untracked: worktrees.iter().map(|worktree| worktree.status.untracked).sum(),
        conflicts: worktrees.iter().map(|worktree| worktree.status.conflicts).sum(),
    }
}

fn totals_for_projects(projects: &[Project]) -> Totals {
    let mut agent_ids = HashSet::new();
    let mut session_ids = HashSet::new();
    let mut worktrees = 0;
    let mut dirty_worktrees = 0;
    let mut conflicted_worktrees = 0;
    let mut attention_worktrees = 0;

    for project in projects {
        worktrees += project.worktrees.len();
        dirty_worktrees += project.stats.dirty_worktrees;
        conflicted_worktrees += project.stats.conflicted_worktrees;
        attention_worktrees += project
            .worktrees
            .iter()
            .filter(|worktree| matches!(worktree.attention, Attention::Critical | Attention::Attention))
            .count();
        for worktree in &project.worktrees {
            for agent in &worktree.agents {
                agent_ids.insert(agent.id.clone());
            }
            for session in &worktree.sessions {
                session_ids.insert(session.id.clone());
            }
        }
    }

    Totals {
        projects: projects.len(),
        worktrees,
        dirty_worktrees,
        conflicted_worktrees,
        attention_worktrees,
        attached_agents: agent_ids.len(),
        attached_sessions: session_ids.len(),
    }
}

fn safe_git(cwd: &str, args: &[&str]) -> Option<String> {
    run_git(cwd, args).ok()
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("git {}: {error}", args.join(" ")))?;

    let stdout = child.stdout.take().ok_or_else(|| "failed to capture git stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "failed to capture git stderr".to_string())?;
    let stdout_handle = thread::spawn(move || read_limited(stdout, GIT_MAX_BUFFER));
    let stderr_handle = thread::spawn(move || read_limited(stderr, GIT_MAX_BUFFER));
    let deadline = Instant::now() + GIT_TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("git {} timed out after {}ms", args.join(" "), GIT_TIMEOUT.as_millis()));
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let stdout_bytes = stdout_handle
        .join()
        .map_err(|_| "failed to join git stdout reader".to_string())??;
    let stderr_bytes = stderr_handle
        .join()
        .map_err(|_| "failed to join git stderr reader".to_string())??;
    let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
    let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    if status.success() {
        Ok(stdout)
    } else if !stderr.is_empty() {
        Err(stderr)
    } else {
        Err(format!("git {} exited with {status}", args.join(" ")))
    }
}

fn read_limited<R: Read>(mut reader: R, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(out);
        }
        if out.len().saturating_add(read) > max_bytes {
            return Err("git output exceeded output limit".to_string());
        }
        out.extend_from_slice(&buffer[..read]);
    }
}

fn existing_directory_for_path(path: &str) -> Option<String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).ok()?;
    let dir = if metadata.is_dir() {
        path
    } else if metadata.is_file() {
        path.parent()?.to_path_buf()
    } else {
        return None;
    };
    Some(normalize_path_string(&dir.to_string_lossy()))
}

fn normalize_path_string(input: &str) -> String {
    let expanded = expand_home(input.trim());
    let path = PathBuf::from(expanded);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join(path)
    };
    path_clean(&absolute)
}

fn expand_home(input: &str) -> String {
    if input == "~" {
        return home_dir().unwrap_or_else(|| input.to_string());
    }
    if let Some(rest) = input.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return Path::new(&home).join(rest).to_string_lossy().to_string();
        }
    }
    input.to_string()
}

fn path_clean(path: &Path) -> String {
    let mut parts = Vec::new();
    let is_absolute = path.is_absolute();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::RootDir => {}
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            Component::Prefix(value) => parts.push(value.as_os_str().to_string_lossy().to_string()),
        }
    }
    let joined = parts.join("/");
    if is_absolute {
        if joined.is_empty() { "/".to_string() } else { format!("/{joined}") }
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

fn path_contains(parent: &str, child: &str) -> bool {
    let parent = parent.trim_end_matches('/');
    let child = child.trim_end_matches('/');
    child == parent
        || child
            .strip_prefix(parent)
            .map(|rest| rest.starts_with('/'))
            .unwrap_or(false)
}

fn path_basename(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
}

fn is_main_branch(value: Option<&str>) -> bool {
    matches!(value, Some("main") | Some("master"))
}

fn worktree_hint_rank(worktree: &ParsedWorktree, hints: &[Hint]) -> i32 {
    hints
        .iter()
        .filter(|hint| path_contains(&worktree.path, &hint.path))
        .map(hint_discovery_rank)
        .min()
        .unwrap_or(100)
}

fn hint_discovery_rank(hint: &Hint) -> i32 {
    let mut rank = source_rank(&hint.source) + state_rank(hint.agent_state.as_deref());
    if is_broad_local_root_path(&hint.path) {
        rank += 300;
    }
    if is_temp_local_path(&hint.path) {
        rank += 200;
    }
    rank
}

fn source_rank(source: &str) -> i32 {
    match source {
        "environment" => -100,
        "endpoint" => 0,
        "tail-process" => 10,
        "tail-transcript" => 20,
        "agent" => 50,
        _ => 60,
    }
}

fn state_rank(state: Option<&str>) -> i32 {
    match state.map(|value| value.to_ascii_lowercase()).as_deref() {
        Some("active") => 0,
        Some("idle") => 10,
        Some("waiting") => 20,
        Some("offline") => 200,
        _ => 40,
    }
}

fn is_broad_local_root_path(path: &str) -> bool {
    let Some(home) = home_dir().map(|value| normalize_path_string(&value)) else {
        return path == "/";
    };
    let home_parent = Path::new(&home)
        .parent()
        .map(|value| normalize_path_string(&value.to_string_lossy()));
    path == home
        || path == normalize_path_string(&Path::new(&home).join("dev").to_string_lossy())
        || path == normalize_path_string(&Path::new(&home).join("Developer").to_string_lossy())
        || home_parent.as_deref() == Some(path)
        || path == "/"
}

fn is_temp_local_path(path: &str) -> bool {
    let mut roots = vec!["/tmp".to_string(), "/private/tmp".to_string()];
    if let Ok(tmpdir) = env::var("TMPDIR") {
        roots.push(normalize_path_string(&tmpdir));
    }
    roots.iter().any(|root| path_contains(root, path))
}

fn home_dir() -> Option<String> {
    env::var("HOME").ok().filter(|value| !value.trim().is_empty())
}

fn budget_exceeded(deadline: Option<Instant>) -> bool {
    deadline.map(|deadline| Instant::now() >= deadline).unwrap_or(false)
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn read_positive_usize_env(name: &str, fallback: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_positive_u64_env(name: &str, fallback: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn parse_usize_arg(flag: &str, value: Option<&String>) -> Result<usize, String> {
    value
        .ok_or_else(|| format!("{flag} requires a value"))?
        .parse::<usize>()
        .map_err(|error| format!("{flag}: {error}"))
}

fn parse_u64_arg(flag: &str, value: Option<&String>) -> Result<u64, String> {
    value
        .ok_or_else(|| format!("{flag} requires a value"))?
        .parse::<u64>()
        .map_err(|error| format!("{flag}: {error}"))
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn nonempty_trimmed(value: String) -> Option<String> {
    nonempty(value.trim())
}

fn hint_key(hint: &Hint) -> String {
    format!(
        "{}\0{}\0{}\0{}\0{}\0{}",
        hint.path,
        hint.source,
        hint.agent_id.as_deref().unwrap_or_default(),
        hint.session_id.as_deref().unwrap_or_default(),
        hint.runtime_source.as_deref().unwrap_or_default(),
        hint.harness.as_deref().unwrap_or_default(),
    )
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        if seen.insert(value.clone()) {
            out.push(value);
        }
    }
    out
}

fn hash_id(input: &str) -> String {
    let mut hash = 2166136261_u32;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16777619);
    }
    to_base36(hash)
}

fn to_base36(mut value: u32) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let mut chars = Vec::new();
    while value > 0 {
        let digit = value % 36;
        let character = if digit < 10 {
            (b'0' + digit as u8) as char
        } else {
            (b'a' + (digit - 10) as u8) as char
        };
        chars.push(character);
        value /= 36;
    }
    chars.iter().rev().collect()
}

impl Snapshot {
    fn to_json(&self) -> String {
        format!(
            "{{\"generatedAt\":{},\"projects\":[{}],\"totals\":{},\"warnings\":[{}]}}",
            self.generated_at,
            join_json(&self.projects, Project::to_json),
            self.totals.to_json(),
            join_json(&self.warnings, |warning| json_string(warning)),
        )
    }
}

impl Totals {
    fn to_json(&self) -> String {
        format!(
            "{{\"projects\":{},\"worktrees\":{},\"dirtyWorktrees\":{},\"conflictedWorktrees\":{},\"attentionWorktrees\":{},\"attachedAgents\":{},\"attachedSessions\":{}}}",
            self.projects,
            self.worktrees,
            self.dirty_worktrees,
            self.conflicted_worktrees,
            self.attention_worktrees,
            self.attached_agents,
            self.attached_sessions,
        )
    }
}

impl Project {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"name\":{},\"root\":{},\"commonGitDir\":{},\"attention\":{},\"attentionReasons\":[{}],\"worktrees\":[{}],\"stats\":{},\"hints\":[{}]}}",
            json_string(&self.id),
            json_string(&self.name),
            json_string(&self.root),
            json_string(&self.common_git_dir),
            json_string(self.attention.as_str()),
            join_json(&self.attention_reasons, |reason| json_string(reason)),
            join_json(&self.worktrees, Worktree::to_json),
            self.stats.to_json(),
            join_json(&self.hints, Hint::to_json),
        )
    }
}

impl ProjectStats {
    fn to_json(&self) -> String {
        format!(
            "{{\"worktrees\":{},\"dirtyWorktrees\":{},\"conflictedWorktrees\":{},\"attachedAgents\":{},\"attachedSessions\":{},\"staged\":{},\"unstaged\":{},\"untracked\":{},\"conflicts\":{}}}",
            self.worktrees,
            self.dirty_worktrees,
            self.conflicted_worktrees,
            self.attached_agents,
            self.attached_sessions,
            self.staged,
            self.unstaged,
            self.untracked,
            self.conflicts,
        )
    }
}

impl Worktree {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"path\":{},\"name\":{},\"isBare\":{},\"branch\":{},\"status\":{},\"diff\":{},\"attention\":{},\"attentionReasons\":[{}],\"agents\":[{}],\"sessions\":[{}],\"hints\":[{}],\"lastCommitAt\":{},\"scannedAt\":{},\"error\":{}}}",
            json_string(&self.id),
            json_string(&self.path),
            json_string(&self.name),
            self.is_bare,
            self.branch.to_json(),
            self.status.to_json(),
            self.diff.to_json(),
            json_string(self.attention.as_str()),
            join_json(&self.attention_reasons, |reason| json_string(reason)),
            join_json(&self.agents, AgentRef::to_json),
            join_json(&self.sessions, SessionRef::to_json),
            join_json(&self.hints, Hint::to_json),
            json_opt_u128(self.last_commit_at),
            self.scanned_at,
            json_opt_str(self.error.as_deref()),
        )
    }
}

impl BranchSummary {
    fn to_json(&self) -> String {
        format!(
            "{{\"name\":{},\"upstream\":{},\"head\":{},\"detached\":{},\"ahead\":{},\"behind\":{},\"isMain\":{},\"diverged\":{}}}",
            json_opt_str(self.name.as_deref()),
            json_opt_str(self.upstream.as_deref()),
            json_opt_str(self.head.as_deref()),
            self.detached,
            self.ahead,
            self.behind,
            self.is_main,
            self.diverged,
        )
    }
}

impl StatusSummary {
    fn to_json(&self) -> String {
        format!(
            "{{\"clean\":{},\"staged\":{},\"unstaged\":{},\"untracked\":{},\"conflicts\":{},\"changedFiles\":{},\"files\":[{}]}}",
            self.clean,
            self.staged,
            self.unstaged,
            self.untracked,
            self.conflicts,
            self.changed_files,
            join_json(&self.files, ChangedFile::to_json),
        )
    }
}

impl ChangedFile {
    fn to_json(&self) -> String {
        format!(
            "{{\"path\":{},\"status\":{}}}",
            json_string(&self.path),
            json_string(&self.status),
        )
    }
}

impl DiffSummary {
    fn to_json(&self) -> String {
        format!(
            "{{\"unstagedShortstat\":{},\"stagedShortstat\":{}}}",
            json_opt_str(self.unstaged_shortstat.as_deref()),
            json_opt_str(self.staged_shortstat.as_deref()),
        )
    }
}

impl AgentRef {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"name\":{},\"state\":{},\"harness\":{}}}",
            json_string(&self.id),
            json_opt_str(self.name.as_deref()),
            json_opt_str(self.state.as_deref()),
            json_opt_str(self.harness.as_deref()),
        )
    }
}

impl SessionRef {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"source\":{},\"harness\":{}}}",
            json_string(&self.id),
            json_opt_str(self.source.as_deref()),
            json_opt_str(self.harness.as_deref()),
        )
    }
}

impl Hint {
    fn to_json(&self) -> String {
        let mut fields = vec![
            format!("\"path\":{}", json_string(&self.path)),
            format!("\"source\":{}", json_string(&self.source)),
        ];
        push_json_opt_field(&mut fields, "sourceLabel", self.source_label.as_deref());
        push_json_opt_field(&mut fields, "agentId", self.agent_id.as_deref());
        push_json_opt_field(&mut fields, "agentName", self.agent_name.as_deref());
        push_json_opt_field(&mut fields, "agentState", self.agent_state.as_deref());
        push_json_opt_field(&mut fields, "sessionId", self.session_id.as_deref());
        push_json_opt_field(&mut fields, "harness", self.harness.as_deref());
        push_json_opt_field(&mut fields, "runtimeSource", self.runtime_source.as_deref());
        format!("{{{}}}", fields.join(","))
    }
}

fn push_json_opt_field(fields: &mut Vec<String>, name: &str, value: Option<&str>) {
    if let Some(value) = value {
        fields.push(format!("\"{name}\":{}", json_string(value)));
    }
}

fn join_json<T>(items: &[T], render: impl Fn(&T) -> String) -> String {
    items.iter().map(render).collect::<Vec<_>>().join(",")
}

fn json_opt_str(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
}

fn json_opt_u128(value: Option<u128>) -> String {
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
