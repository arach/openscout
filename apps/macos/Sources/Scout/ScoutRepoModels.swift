import Foundation

/// Wire contract + derivations for the **Repo Watch** section.
///
/// The structs mirror `RepoWatchSnapshot` exported from `@openscout/runtime`
/// (`packages/runtime/src/repo-watch/index.ts`) and served by the broker at
/// `GET /v1/repo-watch/snapshot`. The derivations below are the Swift twins of
/// the web surface's `scout/repo-watch/ui.ts` — kept semantically identical so
/// native and web read as one system (churn parse, agent dedupe, attention
/// rank, branch split, relative time, worktree state).
///
/// Decoding follows the house style (`ScoutChannel`): explicit `CodingKeys` +
/// `init(from:)` with `decodeIfPresent` defaults, so a partial/forward-evolved
/// snapshot never hard-fails the section.

// MARK: - Attention

/// §6 Attention Rules — the backend's mechanical severity classifier. The UI
/// sorts by `rank` (lower = worse) without inventing product semantics.
enum RepoAttention: String, Decodable, Sendable, CaseIterable {
    case critical   // merge conflicts / unmerged
    case attention  // dirty main|master, diverged branch, or status errored
    case active     // dirty, ahead/behind, or a live agent/session attached
    case quiet      // clean and idle
    case unknown    // discovered but couldn't be scanned

    /// Lower = worse. Drives worst-first ordering everywhere.
    var rank: Int {
        switch self {
        case .critical: return 0
        case .attention: return 1
        case .active: return 2
        case .quiet: return 3
        case .unknown: return 4
        }
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RepoAttention(rawValue: raw) ?? .unknown
    }
}

// MARK: - Snapshot

struct RepoWatchSnapshot: Decodable, Sendable {
    /// Epoch **ms** the snapshot was generated. Relative-time anchor.
    let generatedAt: Double
    let projects: [RepoProject]
    let totals: RepoTotals
    let warnings: [String]

    enum CodingKeys: String, CodingKey { case generatedAt, projects, totals, warnings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(Double.self, forKey: .generatedAt) ?? 0
        projects = try c.decodeIfPresent([RepoProject].self, forKey: .projects) ?? []
        totals = try c.decodeIfPresent(RepoTotals.self, forKey: .totals) ?? .empty
        warnings = try c.decodeIfPresent([String].self, forKey: .warnings) ?? []
    }

    static let empty = RepoWatchSnapshot(generatedAt: 0, projects: [], totals: .empty, warnings: [])

    private init(generatedAt: Double, projects: [RepoProject], totals: RepoTotals, warnings: [String]) {
        self.generatedAt = generatedAt
        self.projects = projects
        self.totals = totals
        self.warnings = warnings
    }
}

struct RepoTotals: Decodable, Sendable {
    let projects: Int
    let worktrees: Int
    let dirtyWorktrees: Int
    let conflictedWorktrees: Int
    let attentionWorktrees: Int
    let attachedAgents: Int
    let attachedSessions: Int

    static let empty = RepoTotals(projects: 0, worktrees: 0, dirtyWorktrees: 0,
                                  conflictedWorktrees: 0, attentionWorktrees: 0,
                                  attachedAgents: 0, attachedSessions: 0)

    enum CodingKeys: String, CodingKey {
        case projects, worktrees, dirtyWorktrees, conflictedWorktrees
        case attentionWorktrees, attachedAgents, attachedSessions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projects = try c.decodeIfPresent(Int.self, forKey: .projects) ?? 0
        worktrees = try c.decodeIfPresent(Int.self, forKey: .worktrees) ?? 0
        dirtyWorktrees = try c.decodeIfPresent(Int.self, forKey: .dirtyWorktrees) ?? 0
        conflictedWorktrees = try c.decodeIfPresent(Int.self, forKey: .conflictedWorktrees) ?? 0
        attentionWorktrees = try c.decodeIfPresent(Int.self, forKey: .attentionWorktrees) ?? 0
        attachedAgents = try c.decodeIfPresent(Int.self, forKey: .attachedAgents) ?? 0
        attachedSessions = try c.decodeIfPresent(Int.self, forKey: .attachedSessions) ?? 0
    }

    private init(projects: Int, worktrees: Int, dirtyWorktrees: Int, conflictedWorktrees: Int,
                 attentionWorktrees: Int, attachedAgents: Int, attachedSessions: Int) {
        self.projects = projects
        self.worktrees = worktrees
        self.dirtyWorktrees = dirtyWorktrees
        self.conflictedWorktrees = conflictedWorktrees
        self.attentionWorktrees = attentionWorktrees
        self.attachedAgents = attachedAgents
        self.attachedSessions = attachedSessions
    }
}

// MARK: - Project

struct RepoProject: Decodable, Identifiable, Sendable {
    let id: String                  // `repo:${hash(commonGitDir)}`
    let name: String
    let root: String
    let commonGitDir: String
    let attention: RepoAttention
    let attentionReasons: [String]
    let worktrees: [RepoWorktree]
    let stats: RepoProjectStats
    let hints: [RepoHint]

    enum CodingKeys: String, CodingKey {
        case id, name, root, commonGitDir, attention, attentionReasons, worktrees, stats, hints
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "—"
        root = try c.decodeIfPresent(String.self, forKey: .root) ?? ""
        commonGitDir = try c.decodeIfPresent(String.self, forKey: .commonGitDir) ?? ""
        attention = try c.decodeIfPresent(RepoAttention.self, forKey: .attention) ?? .unknown
        attentionReasons = try c.decodeIfPresent([String].self, forKey: .attentionReasons) ?? []
        worktrees = try c.decodeIfPresent([RepoWorktree].self, forKey: .worktrees) ?? []
        stats = try c.decodeIfPresent(RepoProjectStats.self, forKey: .stats) ?? .empty
        hints = try c.decodeIfPresent([RepoHint].self, forKey: .hints) ?? []
    }
}

struct RepoProjectStats: Decodable, Sendable {
    let worktrees: Int
    let dirtyWorktrees: Int
    let conflictedWorktrees: Int
    let attachedAgents: Int
    let attachedSessions: Int
    let staged: Int
    let unstaged: Int
    let untracked: Int
    let conflicts: Int

    static let empty = RepoProjectStats(worktrees: 0, dirtyWorktrees: 0, conflictedWorktrees: 0,
                                        attachedAgents: 0, attachedSessions: 0, staged: 0,
                                        unstaged: 0, untracked: 0, conflicts: 0)

    enum CodingKeys: String, CodingKey {
        case worktrees, dirtyWorktrees, conflictedWorktrees, attachedAgents
        case attachedSessions, staged, unstaged, untracked, conflicts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        worktrees = try c.decodeIfPresent(Int.self, forKey: .worktrees) ?? 0
        dirtyWorktrees = try c.decodeIfPresent(Int.self, forKey: .dirtyWorktrees) ?? 0
        conflictedWorktrees = try c.decodeIfPresent(Int.self, forKey: .conflictedWorktrees) ?? 0
        attachedAgents = try c.decodeIfPresent(Int.self, forKey: .attachedAgents) ?? 0
        attachedSessions = try c.decodeIfPresent(Int.self, forKey: .attachedSessions) ?? 0
        staged = try c.decodeIfPresent(Int.self, forKey: .staged) ?? 0
        unstaged = try c.decodeIfPresent(Int.self, forKey: .unstaged) ?? 0
        untracked = try c.decodeIfPresent(Int.self, forKey: .untracked) ?? 0
        conflicts = try c.decodeIfPresent(Int.self, forKey: .conflicts) ?? 0
    }

    private init(worktrees: Int, dirtyWorktrees: Int, conflictedWorktrees: Int, attachedAgents: Int,
                 attachedSessions: Int, staged: Int, unstaged: Int, untracked: Int, conflicts: Int) {
        self.worktrees = worktrees
        self.dirtyWorktrees = dirtyWorktrees
        self.conflictedWorktrees = conflictedWorktrees
        self.attachedAgents = attachedAgents
        self.attachedSessions = attachedSessions
        self.staged = staged
        self.unstaged = unstaged
        self.untracked = untracked
        self.conflicts = conflicts
    }
}

// MARK: - Worktree

struct RepoWorktree: Decodable, Identifiable, Sendable {
    let id: String                  // `worktree:${hash(path)}`
    let path: String
    let name: String
    let isBare: Bool
    let branch: RepoBranch
    let status: RepoStatus
    let diff: RepoDiff
    let attention: RepoAttention
    let attentionReasons: [String]
    let agents: [RepoAgentRef]
    let sessions: [RepoSessionRef]
    let hints: [RepoHint]
    let lastCommitAt: Double?       // epoch ms; nil unless includeLastCommit=1
    let lastTouchedAt: Double?      // epoch ms; newest working-tree file mtime
    let scannedAt: Double
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id, path, name, isBare, branch, status, diff, attention, attentionReasons
        case agents, sessions, hints, lastCommitAt, lastTouchedAt, scannedAt, error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "—"
        isBare = try c.decodeIfPresent(Bool.self, forKey: .isBare) ?? false
        branch = try c.decodeIfPresent(RepoBranch.self, forKey: .branch) ?? .empty
        status = try c.decodeIfPresent(RepoStatus.self, forKey: .status) ?? .empty
        diff = try c.decodeIfPresent(RepoDiff.self, forKey: .diff) ?? .empty
        attention = try c.decodeIfPresent(RepoAttention.self, forKey: .attention) ?? .unknown
        attentionReasons = try c.decodeIfPresent([String].self, forKey: .attentionReasons) ?? []
        agents = try c.decodeIfPresent([RepoAgentRef].self, forKey: .agents) ?? []
        sessions = try c.decodeIfPresent([RepoSessionRef].self, forKey: .sessions) ?? []
        hints = try c.decodeIfPresent([RepoHint].self, forKey: .hints) ?? []
        lastCommitAt = try c.decodeIfPresent(Double.self, forKey: .lastCommitAt)
        lastTouchedAt = try c.decodeIfPresent(Double.self, forKey: .lastTouchedAt)
        scannedAt = try c.decodeIfPresent(Double.self, forKey: .scannedAt) ?? 0
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

struct RepoBranch: Decodable, Sendable {
    let name: String?
    let upstream: String?
    let head: String?
    let detached: Bool
    let ahead: Int
    let behind: Int
    let isMain: Bool
    let diverged: Bool

    static let empty = RepoBranch(name: nil, upstream: nil, head: nil, detached: false,
                                  ahead: 0, behind: 0, isMain: false, diverged: false)

    enum CodingKeys: String, CodingKey {
        case name, upstream, head, detached, ahead, behind, isMain, diverged
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        upstream = try c.decodeIfPresent(String.self, forKey: .upstream)
        head = try c.decodeIfPresent(String.self, forKey: .head)
        detached = try c.decodeIfPresent(Bool.self, forKey: .detached) ?? false
        ahead = try c.decodeIfPresent(Int.self, forKey: .ahead) ?? 0
        behind = try c.decodeIfPresent(Int.self, forKey: .behind) ?? 0
        isMain = try c.decodeIfPresent(Bool.self, forKey: .isMain) ?? false
        diverged = try c.decodeIfPresent(Bool.self, forKey: .diverged) ?? false
    }

    private init(name: String?, upstream: String?, head: String?, detached: Bool,
                 ahead: Int, behind: Int, isMain: Bool, diverged: Bool) {
        self.name = name
        self.upstream = upstream
        self.head = head
        self.detached = detached
        self.ahead = ahead
        self.behind = behind
        self.isMain = isMain
        self.diverged = diverged
    }
}

struct RepoStatus: Decodable, Sendable {
    let clean: Bool
    let staged: Int
    let unstaged: Int
    let untracked: Int
    let conflicts: Int
    let changedFiles: Int
    let files: [RepoChangedFile]

    static let empty = RepoStatus(clean: true, staged: 0, unstaged: 0, untracked: 0,
                                  conflicts: 0, changedFiles: 0, files: [])

    enum CodingKeys: String, CodingKey {
        case clean, staged, unstaged, untracked, conflicts, changedFiles, files
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clean = try c.decodeIfPresent(Bool.self, forKey: .clean) ?? true
        staged = try c.decodeIfPresent(Int.self, forKey: .staged) ?? 0
        unstaged = try c.decodeIfPresent(Int.self, forKey: .unstaged) ?? 0
        untracked = try c.decodeIfPresent(Int.self, forKey: .untracked) ?? 0
        conflicts = try c.decodeIfPresent(Int.self, forKey: .conflicts) ?? 0
        changedFiles = try c.decodeIfPresent(Int.self, forKey: .changedFiles) ?? 0
        files = try c.decodeIfPresent([RepoChangedFile].self, forKey: .files) ?? []
    }

    private init(clean: Bool, staged: Int, unstaged: Int, untracked: Int,
                 conflicts: Int, changedFiles: Int, files: [RepoChangedFile]) {
        self.clean = clean
        self.staged = staged
        self.unstaged = unstaged
        self.untracked = untracked
        self.conflicts = conflicts
        self.changedFiles = changedFiles
        self.files = files
    }
}

struct RepoChangedFile: Decodable, Identifiable, Sendable {
    let path: String
    let status: String              // "untracked" | "conflict" | "staged" | "unstaged" | "staged+unstaged" | "changed"

    var id: String { path }

    enum CodingKeys: String, CodingKey { case path, status }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "changed"
    }
}

struct RepoDiff: Decodable, Sendable {
    let unstagedShortstat: String?
    let stagedShortstat: String?

    static let empty = RepoDiff(unstagedShortstat: nil, stagedShortstat: nil)

    enum CodingKeys: String, CodingKey { case unstagedShortstat, stagedShortstat }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        unstagedShortstat = try c.decodeIfPresent(String.self, forKey: .unstagedShortstat)
        stagedShortstat = try c.decodeIfPresent(String.self, forKey: .stagedShortstat)
    }

    private init(unstagedShortstat: String?, stagedShortstat: String?) {
        self.unstagedShortstat = unstagedShortstat
        self.stagedShortstat = stagedShortstat
    }
}

struct RepoAgentRef: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let state: String?
    let harness: String?

    /// `state === "active"` — the worktree has live Scout activity.
    var live: Bool { (state ?? "").lowercased() == "active" }

    /// Display handle built from `name` (hyphenated) or falling back to `id`,
    /// mirroring web `ui.ts` (no handle is sent over the wire).
    var handle: String {
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            let slug = name.lowercased()
                .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            return slug.isEmpty ? id : "@\(slug)"
        }
        return id
    }

    /// Two-letter initials for dense agent chips ("Hudson Logo" → "HL").
    var initials: String {
        let base = (name?.nilIfEmpty ?? id)
        let words = base.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let letters = words.prefix(2).compactMap { $0.first }.map { String($0) }
        let joined = letters.joined().uppercased()
        return joined.isEmpty ? String(base.prefix(2)).uppercased() : joined
    }

    /// ACTIVE | IDLE | WAITING | OFFLINE | —
    var stateWord: String {
        guard let s = state?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return "—" }
        return s.uppercased()
    }

    enum CodingKeys: String, CodingKey { case id, name, state, harness }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name)
        state = try c.decodeIfPresent(String.self, forKey: .state)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
    }
}

struct RepoSessionRef: Decodable, Identifiable, Sendable {
    let id: String
    let source: String?
    let harness: String?

    enum CodingKeys: String, CodingKey { case id, source, harness }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        source = try c.decodeIfPresent(String.self, forKey: .source)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
    }
}

struct RepoHint: Decodable, Sendable {
    let path: String
    let source: String
    let sourceLabel: String?
    let agentId: String?
    let agentName: String?
    let agentState: String?
    let sessionId: String?
    let harness: String?

    enum CodingKeys: String, CodingKey {
        case path, source, sourceLabel, agentId, agentName, agentState, sessionId, harness
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "unknown"
        sourceLabel = try c.decodeIfPresent(String.self, forKey: .sourceLabel)
        agentId = try c.decodeIfPresent(String.self, forKey: .agentId)
        agentName = try c.decodeIfPresent(String.self, forKey: .agentName)
        agentState = try c.decodeIfPresent(String.self, forKey: .agentState)
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
    }
}

// MARK: - Derivations (Swift twins of scout/repo-watch/ui.ts)

/// Parsed `git diff --shortstat` churn, summed across staged + unstaged.
struct RepoChurn: Sendable {
    let add: Int
    let del: Int
    var total: Int { add + del }
    var has: Bool { total > 0 }

    static let none = RepoChurn(add: 0, del: 0)
}

/// Worktree state lens — mirrors web `wtState()`.
enum RepoWorktreeState: Sendable {
    case error   // scan failed
    case live    // a live agent is attached
    case dirty   // uncommitted changes or ahead/behind
    case clean   // quiet
}

extension RepoWorktree {
    /// Churn parsed from the diff shortstats (web `churnOf()`).
    var churn: RepoChurn {
        RepoChurnParser.parse(diff.unstagedShortstat, diff.stagedShortstat)
    }

    /// One-line lens (web `wtState()`).
    var state: RepoWorktreeState {
        if error != nil { return .error }
        if agents.contains(where: { $0.live }) { return .live }
        if !status.clean || branch.ahead > 0 || branch.behind > 0 { return .dirty }
        return .clean
    }

    /// Worktrees with live agents, unsaved changes, drift, sessions, or a scan
    /// error (web `hasActivity()`); everything else folds into the clean tray.
    var hasActivity: Bool {
        !status.clean
            || branch.ahead > 0
            || branch.behind > 0
            || agents.contains(where: { $0.live })
            || !sessions.isEmpty
            || error != nil
    }

    /// Live-first, de-duplicated by display handle (web `uniqueAgents()`).
    var uniqueAgents: [RepoAgentRef] {
        var seen = Set<String>()
        let ordered = agents.sorted { lhs, rhs in
            if lhs.live != rhs.live { return lhs.live }
            return false
        }
        return ordered.filter { seen.insert($0.handle).inserted }
    }

    /// Branch label split into a dimmed prefix and highlighted leaf, or a short
    /// SHA when detached (web `branchParts()`).
    var branchParts: RepoBranchParts {
        if branch.detached {
            let sha = (branch.head ?? "").prefix(7)
            return RepoBranchParts(detached: true, sha: String(sha), prefix: "", leaf: String(sha))
        }
        let name = branch.name ?? ""
        if let slash = name.range(of: "/", options: .backwards) {
            return RepoBranchParts(detached: false, sha: "",
                                   prefix: String(name[..<slash.upperBound]),
                                   leaf: String(name[slash.upperBound...]))
        }
        return RepoBranchParts(detached: false, sha: "", prefix: "", leaf: name)
    }

    /// Relative time of the last commit against the snapshot's `generatedAt`
    /// (deterministic — no wall clock; web `agoFromMillis()`).
    func lastCommitAgo(generatedAt: Double) -> String? {
        guard let ts = lastCommitAt else { return nil }
        return RepoRelativeTime.ago(fromMillis: ts, now: generatedAt)
    }

    /// Relative time since the worktree was last *touched* (newest working-tree
    /// file mtime) — "when did I last work here", distinct from the last commit.
    func lastTouchedAgo(generatedAt: Double) -> String? {
        guard let ts = lastTouchedAt else { return nil }
        return RepoRelativeTime.ago(fromMillis: ts, now: generatedAt)
    }

    /// Drift flag pill text (web Drift view).
    var driftFlag: String {
        if error != nil { return "SCAN ERR" }
        if branch.ahead > 0 && branch.behind > 0 { return "DIVERGED" }
        if branch.behind > 0 { return "REBASE" }
        if branch.ahead > 0 { return "AHEAD \(branch.ahead)" }
        return "IN SYNC"
    }
}

struct RepoBranchParts: Sendable {
    let detached: Bool
    let sha: String
    let prefix: String
    let leaf: String
}

enum RepoChurnParser {
    private static let insertions = try! NSRegularExpression(pattern: #"(\d+)\s+insertions?\(\+\)"#)
    private static let deletions = try! NSRegularExpression(pattern: #"(\d+)\s+deletions?\(-\)"#)

    static func parse(_ shortstats: String?...) -> RepoChurn {
        var add = 0
        var del = 0
        for stat in shortstats {
            guard let stat, !stat.isEmpty else { continue }
            add += firstInt(insertions, in: stat)
            del += firstInt(deletions, in: stat)
        }
        return RepoChurn(add: add, del: del)
    }

    private static func firstInt(_ regex: NSRegularExpression, in text: String) -> Int {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              let captured = Range(match.range(at: 1), in: text) else { return 0 }
        return Int(text[captured]) ?? 0
    }
}

enum RepoRelativeTime {
    /// "3s" / "5m" / "2h" / "1d" against a fixed `now` (both epoch ms).
    static func ago(fromMillis ts: Double, now: Double) -> String {
        let seconds = max(0, (now - ts) / 1000)
        if seconds < 60 { return "\(Int(seconds))s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(Int(minutes))m" }
        let hours = minutes / 60
        if hours < 24 { return "\(Int(hours))h" }
        return "\(Int(hours / 24))d"
    }
}

/// Abbreviate a path to its last `segments` components with a "…/" prefix when
/// longer (web `shortPath()`).
func repoShortPath(_ path: String, segments: Int = 3) -> String {
    let parts = path.split(separator: "/").map(String.init)
    guard parts.count > segments else { return path }
    return "…/" + parts.suffix(segments).joined(separator: "/")
}
