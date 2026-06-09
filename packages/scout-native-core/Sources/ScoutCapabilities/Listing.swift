// ListingCapability (SCO-061 Phase 3, seeded early for the ScoutNext demo).
//
// Shared summary models + a transport-agnostic listing contract. Reconciles the
// iOS `MobileSessionSummary`/`MobileAgentSummary` shapes with the macOS fleet
// shapes into one set of pure models both platforms render.

import Foundation

public struct SessionSummary: Codable, Sendable, Identifiable, Equatable {
    public enum Status: String, Codable, Sendable { case active, idle, connecting, closed, unknown }

    public var id: String
    public var title: String
    public var harness: String?
    public var preview: String?
    public var agentName: String?
    public var workspaceRoot: String?
    public var messageCount: Int?
    public var status: Status
    public var lastMessageAt: Date?

    public init(
        id: String,
        title: String,
        harness: String? = nil,
        preview: String? = nil,
        agentName: String? = nil,
        workspaceRoot: String? = nil,
        messageCount: Int? = nil,
        status: Status = .unknown,
        lastMessageAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.harness = harness
        self.preview = preview
        self.agentName = agentName
        self.workspaceRoot = workspaceRoot
        self.messageCount = messageCount
        self.status = status
        self.lastMessageAt = lastMessageAt
    }

    /// Project name derived from the workspace root (last path component).
    public var projectName: String? {
        guard let workspaceRoot, !workspaceRoot.isEmpty else { return nil }
        return (workspaceRoot as NSString).lastPathComponent
    }
}

/// Working-tree posture for an agent's checkout. All-zero == clean. Kept as
/// plain counts so the row can phrase it ("+2 ↑1", "clean") however it likes.
public struct GitState: Codable, Sendable, Equatable {
    public var ahead: Int
    public var behind: Int
    /// Count of changed/uncommitted files in the working tree.
    public var dirty: Int

    public init(ahead: Int = 0, behind: Int = 0, dirty: Int = 0) {
        self.ahead = ahead
        self.behind = behind
        self.dirty = dirty
    }

    public var isClean: Bool { ahead == 0 && behind == 0 && dirty == 0 }
}

public struct AgentSummary: Codable, Sendable, Identifiable, Equatable {
    public enum State: String, Codable, Sendable { case live, idle, offline, unknown }

    public var id: String
    public var title: String
    public var harness: String?
    public var projectName: String?
    /// Current git branch of the agent's checkout (e.g. "feat/in-app-session").
    public var branch: String?
    /// Working-tree posture (ahead/behind/dirty). Nil when unknown.
    public var git: GitState?
    /// Precise model id (e.g. "claude-opus-4-8"), distinct from the harness family.
    public var model: String?
    /// What the agent is doing right now — the most-recent action, not a clock.
    public var statusLabel: String?
    public var state: State
    /// Harness session label (e.g. "relay-openscout-claude"). NOT a routable
    /// conversation id — it's shared across agents in the same project. Use it for
    /// display only; route taps via `conversationId`.
    public var sessionId: String?
    /// The broker conversation to open for this agent (its operator DM, or the
    /// canonical `dm.operator.<id>` it'll be created under on first send). This is
    /// what the conversation surface loads / sends / streams against.
    public var conversationId: String?
    public var lastActiveAt: Date?

    public init(
        id: String,
        title: String,
        harness: String? = nil,
        projectName: String? = nil,
        branch: String? = nil,
        git: GitState? = nil,
        model: String? = nil,
        statusLabel: String? = nil,
        state: State = .unknown,
        sessionId: String? = nil,
        conversationId: String? = nil,
        lastActiveAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.harness = harness
        self.projectName = projectName
        self.branch = branch
        self.git = git
        self.model = model
        self.statusLabel = statusLabel
        self.state = state
        self.sessionId = sessionId
        self.conversationId = conversationId
        self.lastActiveAt = lastActiveAt
    }
}

/// A project the connected machine knows about, carrying the harnesses it can
/// actually run there — the machine-backed catalog the New-session composer reads
/// so its harness list reflects what's installed on that Mac, not a hardcoded set.
public struct WorkspaceSummary: Codable, Sendable, Identifiable, Equatable {
    /// One harness available for this workspace, with the machine's readiness.
    public struct Harness: Codable, Sendable, Identifiable, Equatable {
        /// Mirrors the bridge's per-harness readiness for this workspace.
        public enum Readiness: String, Codable, Sendable {
            case ready, configured, installed, missing, unknown
        }

        public var harness: String        // e.g. "claude", "codex"
        public var readiness: Readiness
        public var detail: String?

        public var id: String { harness }

        public init(harness: String, readiness: Readiness = .unknown, detail: String? = nil) {
            self.harness = harness
            self.readiness = readiness
            self.detail = detail
        }

        /// True when the harness can start a session now (installed + usable).
        public var isUsable: Bool {
            readiness == .ready || readiness == .configured || readiness == .installed
        }
    }

    public var id: String          // workspace id
    public var title: String
    public var projectName: String
    public var root: String
    /// The harness the machine recommends for this workspace, if any.
    public var defaultHarness: String?
    public var harnesses: [Harness]

    public init(
        id: String,
        title: String,
        projectName: String,
        root: String,
        defaultHarness: String? = nil,
        harnesses: [Harness] = []
    ) {
        self.id = id
        self.title = title
        self.projectName = projectName
        self.root = root
        self.defaultHarness = defaultHarness
        self.harnesses = harnesses
    }
}

/// Capability: list sessions, agents, and the machine's known workspaces. The
/// query/limit semantics are the app's need; the transport decides how to fulfill
/// them.
public protocol ListingCapability: Sendable {
    func listSessions(query: String?, limit: Int) async throws -> [SessionSummary]
    func listAgents(query: String?, limit: Int) async throws -> [AgentSummary]
    func listWorkspaces(query: String?, limit: Int) async throws -> [WorkspaceSummary]
}

public extension ListingCapability {
    /// Default: no machine-backed workspaces (e.g. a transport that doesn't expose
    /// them). Conformers that can fetch them override this. Keeps existing
    /// conformers source-compatible.
    func listWorkspaces(query: String?, limit: Int) async throws -> [WorkspaceSummary] { [] }
}
