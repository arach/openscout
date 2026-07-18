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

/// A pending "the operator's move" ask carried on an agent that `needsAttention`.
/// Mirrors the server-side attention index (packages/web/server/core/attention/
/// agent-attention.ts): the broker currently emits a single flattened `ask`
/// string plus the blocking `kind`, so `prompt` is that clamped ask line and
/// `options` is present only when the harness question offered explicit choices.
///
/// Fully OPTIONAL end to end — `AgentSummary.pendingAsk` is nil unless the wire
/// carries it, and every field here decodes tolerantly so a partial/absent
/// payload never fails the whole agent-list decode.
public struct PendingAsk: Codable, Sendable, Equatable {
    /// The category of ask, so the UI can phrase the affordance ("Approve?",
    /// "Answer", "Unblock"). Maps from the broker's session-attention kind vocab
    /// (question / approval / native_attention) with a permissive `.other` bucket.
    public enum Kind: String, Codable, Sendable {
        case permission     // approval / tool-permission gate
        case decision       // a choose-between ask
        case confirm        // a yes/no confirmation
        case blocked        // agent is blocked and needs an unblock
        case question       // a free-form question to the operator
        case other          // unknown / future kind — never fails decode

        /// Lenient decode: an unrecognized wire value maps to `.other` instead of
        /// throwing, so a new broker kind never blanks the attention band.
        public init(from decoder: Decoder) throws {
            let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? ""
            self = Kind(rawValue: raw) ?? .other
        }
    }

    /// The category of ask. Defaults to `.question` when the wire omits it.
    public var kind: Kind
    /// The single-line ask text shown in the attention band (broker-clamped to
    /// ~200 chars server-side). Never nil once a `PendingAsk` exists.
    public var prompt: String
    /// Explicit choices for a decision/question, when the harness offered them.
    /// Empty for permission/confirm/blocked asks that are answered inline.
    public var options: [String]

    public init(kind: Kind = .question, prompt: String, options: [String] = []) {
        self.kind = kind
        self.prompt = prompt
        self.options = options
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case prompt
        case options
    }

    /// Tolerant decode: `kind` defaults to `.question`, `options` to `[]`, and a
    /// missing/empty `prompt` yields nil at the call site (see AgentSummary).
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = try container.decodeIfPresent(Kind.self, forKey: .kind) ?? .question
        self.prompt = (try container.decodeIfPresent(String.self, forKey: .prompt)) ?? ""
        self.options = try container.decodeIfPresent([String].self, forKey: .options) ?? []
    }
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
    /// True when this agent is waiting on the operator (a pending question /
    /// approval / handoff). Attention outranks working/idle from the operator's
    /// seat — an agent that `needsAttention` "needs you" even while its flight
    /// is still moving. Defaults to false; only set when the broker says so.
    public var needsAttention: Bool
    /// The pending "your move" ask backing `needsAttention`, when the broker
    /// carries the text. Nil for an attention flag with no ask line (or when the
    /// wire predates attention). See `PendingAsk`.
    public var pendingAsk: PendingAsk?

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
        lastActiveAt: Date? = nil,
        needsAttention: Bool = false,
        pendingAsk: PendingAsk? = nil
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
        self.needsAttention = needsAttention
        self.pendingAsk = pendingAsk
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, harness, projectName, branch, git, model
        case statusLabel, state, sessionId, conversationId, lastActiveAt
        case needsAttention, pendingAsk
    }

    /// Tolerant decode so the two attention fields are fully additive: an older
    /// payload without them decodes to `needsAttention == false` / `pendingAsk == nil`
    /// rather than throwing. All other fields keep their prior optional semantics.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.title = try container.decode(String.self, forKey: .title)
        self.harness = try container.decodeIfPresent(String.self, forKey: .harness)
        self.projectName = try container.decodeIfPresent(String.self, forKey: .projectName)
        self.branch = try container.decodeIfPresent(String.self, forKey: .branch)
        self.git = try container.decodeIfPresent(GitState.self, forKey: .git)
        self.model = try container.decodeIfPresent(String.self, forKey: .model)
        self.statusLabel = try container.decodeIfPresent(String.self, forKey: .statusLabel)
        self.state = try container.decodeIfPresent(State.self, forKey: .state) ?? .unknown
        self.sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        self.conversationId = try container.decodeIfPresent(String.self, forKey: .conversationId)
        self.lastActiveAt = try container.decodeIfPresent(Date.self, forKey: .lastActiveAt)
        self.needsAttention = try container.decodeIfPresent(Bool.self, forKey: .needsAttention) ?? false
        self.pendingAsk = try container.decodeIfPresent(PendingAsk.self, forKey: .pendingAsk)
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
