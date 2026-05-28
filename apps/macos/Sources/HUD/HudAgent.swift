import Foundation

// Agent fleet model for the HUD panel.
// Decodes the web server's /api/agents WebAgent shape and maps it into
// the compact native row model the HUD already renders.

enum HudAgentState: String, Sendable, Decodable {
    case working
    case waiting
    case available
    case offline
    case done
    case needsAttention = "needs-attention"

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? "offline"
        self = Self.fromBroker(raw)
    }

    static func fromBroker(_ raw: String?) -> HudAgentState {
        let normalized = (raw ?? "offline")
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        switch normalized {
        case "working", "running", "waking", "queued":
            return .working
        case "waiting", "blocked", "needs-attention", "needsattention", "on-you":
            return .needsAttention
        case "available", "idle", "ready":
            return .available
        case "done", "completed", "complete":
            return .done
        default:
            return .offline
        }
    }
}

struct HudAgentMessage: Sendable {
    let to: String
    let text: String
}

struct HudAgent: Identifiable, Sendable, Decodable {
    let id: String
    let name: String
    let hue: Double
    let state: HudAgentState
    let role: String
    let ago: String
    let runtime: String
    let lastTurn: String
    let lastMessage: HudAgentMessage?
    let pendingAsk: String?
    let files: Int
    let tokens: String
    let branch: String

    let handle: String?
    let harness: String?
    let projectRoot: String?
    let selector: String?
    let updatedAt: TimeInterval?
    let createdAt: TimeInterval?
    let capabilities: [String]
    let nodeName: String?
    // Real harness session ref (e.g. "relay-hudson-claude") — the value
    // /api/session-ref resolves. NOT the broker agent ID. Used for the HUD
    // OPEN TRANSCRIPT drill so the web actually finds the session.
    let harnessSessionId: String?
    // Canonical operator DM conversation for this agent. Server-rendered
    // as `dm.operator.<agentId>` but read it from the payload rather than
    // synthesizing, so we stay in sync if the convention changes.
    let conversationId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case handle
        case agentClass
        case harness
        case state
        case projectRoot
        case cwd
        case updatedAt
        case createdAt
        case transport
        case selector
        case defaultSelector
        case nodeQualifier
        case workspaceQualifier
        case capabilities
        case project
        case branch
        case role
        case model
        case authorityNodeName
        case homeNodeName
        case harnessSessionId
        case conversationId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        handle = try c.decodeIfPresent(String.self, forKey: .handle)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        state = HudAgentState.fromBroker(try c.decodeIfPresent(String.self, forKey: .state))
        projectRoot = try c.decodeIfPresent(String.self, forKey: .projectRoot)
        selector = try c.decodeIfPresent(String.self, forKey: .selector)
        updatedAt = try c.decodeIfPresent(TimeInterval.self, forKey: .updatedAt)
        createdAt = try c.decodeIfPresent(TimeInterval.self, forKey: .createdAt)
        capabilities = try c.decodeIfPresent([String].self, forKey: .capabilities) ?? []
        nodeName = try c.decodeIfPresent(String.self, forKey: .authorityNodeName)
            ?? c.decodeIfPresent(String.self, forKey: .homeNodeName)
        harnessSessionId = try c.decodeIfPresent(String.self, forKey: .harnessSessionId)
        conversationId = try c.decodeIfPresent(String.self, forKey: .conversationId)

        let project = try c.decodeIfPresent(String.self, forKey: .project)
        let brokerRole = try c.decodeIfPresent(String.self, forKey: .role)
        let branchValue = try c.decodeIfPresent(String.self, forKey: .branch)
        let model = try c.decodeIfPresent(String.self, forKey: .model)
        let transport = try c.decodeIfPresent(String.self, forKey: .transport)
        let cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
        let agentClass = try c.decodeIfPresent(String.self, forKey: .agentClass)

        hue = HudHue.forAgent(name: name, handle: handle)
        role = Self.makeRole(role: brokerRole, project: project, harness: harness, agentClass: agentClass)
        ago = Self.formatAgo(sinceMs: updatedAt)
        runtime = Self.formatRuntime(createdAtMs: createdAt)
        branch = branchValue ?? projectRoot ?? cwd ?? "—"
        tokens = model ?? harness ?? transport ?? "—"
        files = capabilities.count
        pendingAsk = state == .needsAttention ? "waiting for operator input" : nil
        lastMessage = nil
        lastTurn = Self.makeSummary(
            state: state,
            harness: harness,
            transport: transport,
            project: project,
            cwd: cwd,
            nodeName: nodeName,
            selector: selector
        )
    }

    private static func makeRole(
        role: String?,
        project: String?,
        harness: String?,
        agentClass: String?
    ) -> String {
        let left = role ?? project ?? agentClass ?? "agent"
        if let harness, !harness.isEmpty {
            return "\(left) · \(harness)"
        }
        return left
    }

    private static func makeSummary(
        state: HudAgentState,
        harness: String?,
        transport: String?,
        project: String?,
        cwd: String?,
        nodeName: String?,
        selector: String?
    ) -> String {
        let status: String = switch state {
        case .working: "Working"
        case .needsAttention: "Waiting on the operator"
        case .available: "Available"
        case .waiting: "Waiting"
        case .done: "Done"
        case .offline: "Offline"
        }
        let runtime = [harness, transport].compactMap { $0 }.joined(separator: " · ")
        let scope = project ?? cwd ?? nodeName ?? selector ?? "broker-visible fleet"
        if runtime.isEmpty {
            return "\(status) in \(scope)."
        }
        return "\(status) via \(runtime) in \(scope)."
    }

    static func formatAgo(sinceMs: TimeInterval?, now: Date = Date()) -> String {
        guard let sinceMs else { return "—" }
        let then = Date(timeIntervalSince1970: sinceMs / 1000)
        let delta = max(0, Int(now.timeIntervalSince(then)))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        let h = delta / 3600
        let m = (delta % 3600) / 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    private static func formatRuntime(createdAtMs: TimeInterval?, now: Date = Date()) -> String {
        guard let createdAtMs else { return "—" }
        let then = Date(timeIntervalSince1970: createdAtMs / 1000)
        let delta = max(0, Int(now.timeIntervalSince(then)))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        if delta < 86_400 {
            let h = delta / 3600
            let m = (delta % 3600) / 60
            return m == 0 ? "\(h)h" : "\(h)h \(m)m"
        }
        return "\(delta / 86_400)d"
    }
}

struct HudActivityItem: Identifiable, Sendable, Decodable {
    let id: String
    let kind: String
    let ts: TimeInterval
    let actorName: String?
    let title: String?
    let summary: String?
    let conversationId: String?
    let workspaceRoot: String?
    let agentId: String?
    let agentName: String?
    let flightId: String?
    let invocationId: String?
    let sessionId: String?
    let messageId: String?
    let recordId: String?

    var displayName: String {
        agentName ?? actorName ?? "broker"
    }

    var relativeTimestamp: String {
        HudAgent.formatAgo(sinceMs: ts)
    }
}

// Hue convention from studio AgentRow — same agent, same color everywhere.
enum HudHue {
    static let scout: Double  = 125
    static let hudson: Double = 210
    static let qb: Double     = 25
    static let cody: Double   = 85
    static let ranger: Double = 295
    static let vox: Double    = 340
    static let atlas: Double  = 175
    static let drover: Double = 50
    static let vault: Double  = 250
    static let pike: Double   = 305
    static let quill: Double  = 195
    static let cobalt: Double = 235

    static func forAgent(name: String, handle: String?) -> Double {
        let key = (handle ?? name)
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
        switch key {
        case "scout": return scout
        case "hudson": return hudson
        case "qb": return qb
        case "cody": return cody
        case "ranger": return ranger
        case "vox": return vox
        case "atlas": return atlas
        case "drover": return drover
        case "vault": return vault
        case "pike": return pike
        case "quill": return quill
        case "cobalt": return cobalt
        default: return hashedHue(key)
        }
    }

    private static func hashedHue(_ input: String) -> Double {
        var hash: UInt32 = 2_166_136_261
        for byte in input.utf8 {
            hash ^= UInt32(byte)
            hash &*= 16_777_619
        }
        return Double(hash % 360)
    }
}
