import Foundation
import Observation
import ScoutCapabilities

/// The notifications ledger — Scout's device-local record of every alert the
/// paired Macs raised.
///
/// Why a local ledger at all: the Mac's `mobile/inbox` is a projection of what
/// is pending RIGHT NOW (see `projectSessionAttention`). The moment an approval
/// is decided or an error clears, the item vanishes from it — there is no
/// server-side history to read back. So Home's needs-you band can answer "what
/// wants me now" but nothing could answer "what did it ask me, and what became
/// of it". This store is that record: entries are captured while they're live
/// (or when a push lands), and KEPT after they settle.
///
/// Honesty rule: an outcome is only named when THIS device made the call. A
/// decision taken here is `.approved` / `.denied` / `.answered`; anything that
/// merely stopped being pending on the Mac settles to `.resolved` (someone or
/// something else handled it) or `.cleared` (an error state that went away).
/// We never invent an outcome we didn't witness.
public struct ScoutNotification: Codable, Identifiable, Equatable, Hashable {
    public enum State: String, Codable {
        /// Still pending on the Mac — an agent is waiting on you.
        case pending
        /// Decided on this device — a real decision, sent to the agent.
        case approved, denied, answered
        /// Cleared from YOUR queue here. Nothing was sent: an agent that was
        /// waiting is still waiting, and the label never pretends otherwise.
        case dismissed
        /// Stopped being pending on the Mac, and we didn't do it.
        case resolved
        /// A failure/error entry that is no longer being reported.
        case cleared

        public var isOpen: Bool { self == .pending }
        /// True for the three outcomes this device actually performed.
        public var isOurDecision: Bool {
            switch self {
            case .approved, .denied, .answered: return true
            case .pending, .dismissed, .resolved, .cleared: return false
            }
        }
        /// True when the operator settled it from this device — a decision we
        /// sent, or a dismissal. Neither is ever overwritten by a later poll.
        public var isOurs: Bool { isOurDecision || self == .dismissed }
    }

    /// Where the entry came from. The Mac reports operator attention through
    /// TWO channels and neither is a superset of the other: `mobile/inbox`
    /// carries session attention (approvals, questions, failures) while the
    /// agent list carries `needsAttention` + `pendingAsk`, which also covers
    /// collaboration asks — an agent addressing you in a conversation, which
    /// never appears in the inbox at all. Home reads the second; if the ledger
    /// only read the first, an alert could sit on Home and be missing from the
    /// place that claims to hold every alert. So it reads both, and each source
    /// settles only its OWN entries (absence in one says nothing about the other).
    public enum Source: String, Codable, Sendable {
        case inbox
        case attention
    }

    /// Machine-scoped so two Macs raising the same session/turn id never collide.
    public var id: String
    public var itemId: String
    public var machineId: String
    public var machineName: String

    public var kind: String
    public var sessionId: String
    public var sessionName: String
    public var adapterType: String
    public var turnId: String?
    public var blockId: String?
    public var version: Int?
    public var risk: String
    public var title: String
    public var summary: String
    public var detail: String?

    /// When the Mac raised it (its own clock), and when this device first
    /// recorded it. They differ when the app was asleep.
    public var createdAt: Date
    public var arrivedAt: Date
    public var seenAt: Date?
    public var state: State
    public var settledAt: Date?
    /// Which channel reported it. Optional-with-default so ledgers written
    /// before the second source decode unchanged.
    public var source: Source
    /// Filed away: out of Open and All, still recoverable under Archived.
    /// Optional so ledgers written before archiving decode unchanged.
    public var archivedAt: Date?

    public var isUnseen: Bool { seenAt == nil }
    public var isOpen: Bool { state.isOpen && !isArchived }
    public var isArchived: Bool { archivedAt != nil }

    /// The item can be acted on from the phone only when the Mac gave us the
    /// coordinates the decision RPC needs.
    public var isDecidableApproval: Bool {
        kind == "approval" && turnId != nil && blockId != nil && version != nil
    }
    public var isAnswerableQuestion: Bool {
        kind == "question" && turnId != nil && blockId != nil
    }
    /// An agent addressing you in a conversation. There is nothing to approve —
    /// the answer is a reply, so the action is opening the thread.
    public var isConversationAsk: Bool {
        kind == "ask" && !sessionId.isEmpty
    }

    public static func identity(machineId: String, itemId: String) -> String {
        "\(machineId)|\(itemId)"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        itemId = try c.decode(String.self, forKey: .itemId)
        machineId = try c.decode(String.self, forKey: .machineId)
        machineName = try c.decode(String.self, forKey: .machineName)
        kind = try c.decode(String.self, forKey: .kind)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        sessionName = try c.decode(String.self, forKey: .sessionName)
        adapterType = try c.decode(String.self, forKey: .adapterType)
        turnId = try c.decodeIfPresent(String.self, forKey: .turnId)
        blockId = try c.decodeIfPresent(String.self, forKey: .blockId)
        version = try c.decodeIfPresent(Int.self, forKey: .version)
        risk = try c.decode(String.self, forKey: .risk)
        title = try c.decode(String.self, forKey: .title)
        summary = try c.decode(String.self, forKey: .summary)
        detail = try c.decodeIfPresent(String.self, forKey: .detail)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        arrivedAt = try c.decode(Date.self, forKey: .arrivedAt)
        seenAt = try c.decodeIfPresent(Date.self, forKey: .seenAt)
        state = try c.decode(State.self, forKey: .state)
        settledAt = try c.decodeIfPresent(Date.self, forKey: .settledAt)
        source = try c.decodeIfPresent(Source.self, forKey: .source) ?? .inbox
        archivedAt = try c.decodeIfPresent(Date.self, forKey: .archivedAt)
    }

    public init(
        id: String,
        itemId: String,
        machineId: String,
        machineName: String,
        kind: String,
        sessionId: String,
        sessionName: String,
        adapterType: String,
        turnId: String? = nil,
        blockId: String? = nil,
        version: Int? = nil,
        risk: String,
        title: String,
        summary: String,
        detail: String? = nil,
        createdAt: Date,
        arrivedAt: Date,
        seenAt: Date? = nil,
        state: State,
        settledAt: Date? = nil,
        source: Source = .inbox,
        archivedAt: Date? = nil
    ) {
        self.id = id
        self.itemId = itemId
        self.machineId = machineId
        self.machineName = machineName
        self.kind = kind
        self.sessionId = sessionId
        self.sessionName = sessionName
        self.adapterType = adapterType
        self.turnId = turnId
        self.blockId = blockId
        self.version = version
        self.risk = risk
        self.title = title
        self.summary = summary
        self.detail = detail
        self.createdAt = createdAt
        self.arrivedAt = arrivedAt
        self.seenAt = seenAt
        self.state = state
        self.settledAt = settledAt
        self.source = source
        self.archivedAt = archivedAt
    }
}

/// Persisted ledger + the read/outcome bookkeeping around it.
///
/// Retention is deliberately modest and stated in the UI: the most recent
/// `capacity` entries, nothing older than `maxAge`. This is a log you glance
/// back at, not an archive.
@MainActor
@Observable
public final class NotificationsStore {
    public private(set) var entries: [ScoutNotification] = []

    /// Entries whose settle decision has to wait: a push stub we haven't
    /// confirmed live yet could simply be racing the next poll.
    private static let settleGrace: TimeInterval = 90
    private static let capacity = 200
    private static let maxAge: TimeInterval = 30 * 24 * 60 * 60

    private let fileURL: URL?
    private var isDirty = false

    public init(fileURL: URL? = NotificationsStore.defaultFileURL()) {
        self.fileURL = fileURL
        load()
    }

    // MARK: - Derived counts

    /// What the list is showing. `all` is the log MINUS what you filed —
    /// archiving has to actually take something out of the view or it isn't an
    /// action, and `archived` is where it stays recoverable.
    public enum Scope: String, CaseIterable, Sendable {
        case open, all, archived
    }

    /// Filed entries never badge the bell: you already dealt with them.
    public var unseenCount: Int { entries.filter { $0.isUnseen && !$0.isArchived }.count }
    public var openCount: Int { entries.filter(\.isOpen).count }
    public var archivedCount: Int { entries.filter(\.isArchived).count }
    /// Everything the log shows — the count behind "N kept".
    public var keptCount: Int { entries.filter { !$0.isArchived }.count }

    public func entries(_ scope: Scope) -> [ScoutNotification] {
        switch scope {
        case .open: return entries.filter(\.isOpen)
        case .all: return entries.filter { !$0.isArchived }
        case .archived: return entries.filter(\.isArchived)
        }
    }

    public func entry(id: String) -> ScoutNotification? {
        entries.first { $0.id == id }
    }

    /// Best match for an opened push. The correlation id is authoritative when
    /// present; otherwise fall back to the session/turn/block triple the alert
    /// carried, newest first.
    public func entry(
        matchingItemId itemId: String?,
        sessionId: String? = nil,
        turnId: String? = nil,
        blockId: String? = nil
    ) -> ScoutNotification? {
        if let itemId, let exact = entries.first(where: { $0.itemId == itemId }) {
            return exact
        }
        guard let sessionId else { return nil }
        return entries.first { candidate in
            candidate.sessionId == sessionId
                && (turnId == nil || candidate.turnId == turnId)
                && (blockId == nil || candidate.blockId == blockId)
        }
    }

    // MARK: - Ingest

    /// Fold one machine's live inbox into the ledger.
    ///
    /// Call ONLY after a successful read — the absence of an item is what
    /// settles a pending entry, so a failed fetch must never reach here or a
    /// dropped poll would mass-settle a queue that is very much still waiting.
    public func ingest(
        _ items: [MobileNotificationItem],
        machineId: String,
        machineName: String,
        now: Date = Date()
    ) {
        var liveIds = Set<String>()

        for item in items {
            let id = ScoutNotification.identity(machineId: machineId, itemId: item.id)
            liveIds.insert(id)
            let created = ScoutTimestamp.date(fromEpoch: TimeInterval(item.createdAt)) ?? now

            if let index = entries.firstIndex(where: { $0.id == id }) {
                var existing = entries[index]
                // Refresh the content (titles/details sharpen as a turn runs).
                existing.kind = item.kind
                existing.sessionName = item.sessionName
                existing.adapterType = item.adapterType
                existing.turnId = item.turnId
                existing.blockId = item.blockId
                existing.version = item.version
                existing.risk = item.risk
                existing.title = item.title
                existing.summary = item.description
                existing.detail = item.detail
                existing.machineName = machineName
                existing.createdAt = created
                // An entry we inferred settled but that is demonstrably still
                // pending goes back in the queue. Anything the operator settled
                // HERE — a decision we sent, or a dismissal — stands: a
                // dismissed alert must not climb back into the queue every poll.
                if !existing.state.isOurs, existing.state != .pending {
                    existing.state = .pending
                    existing.settledAt = nil
                }
                entries[index] = existing
                isDirty = true
                continue
            }

            // A push stub for this same alert gets ADOPTED rather than
            // duplicated: the machine that reports it live is the machine that
            // raised it, and the stub already carries when it reached us and
            // whether it's been seen.
            var arrived = now
            var seen: Date?
            if let stub = entries.firstIndex(where: { $0.machineId.isEmpty && $0.itemId == item.id }) {
                arrived = entries[stub].arrivedAt
                seen = entries[stub].seenAt
                entries.remove(at: stub)
            }

            entries.append(ScoutNotification(
                id: id,
                itemId: item.id,
                machineId: machineId,
                machineName: machineName,
                kind: item.kind,
                sessionId: item.sessionId,
                sessionName: item.sessionName,
                adapterType: item.adapterType,
                turnId: item.turnId,
                blockId: item.blockId,
                version: item.version,
                risk: item.risk,
                title: item.title,
                summary: item.description,
                detail: item.detail,
                createdAt: created,
                arrivedAt: arrived,
                seenAt: seen,
                state: .pending,
                settledAt: nil,
                source: .inbox,
                archivedAt: nil
            ))
            isDirty = true
        }

        // Settle what this machine no longer reports THROUGH THIS CHANNEL. An
        // inbox read says nothing about an attention-sourced ask, and vice
        // versa — crossing them would settle live alerts on every poll.
        for index in entries.indices where entries[index].machineId == machineId {
            let entry = entries[index]
            guard entry.source == .inbox else { continue }
            guard entry.state == .pending, !liveIds.contains(entry.id) else { continue }
            entries[index].state = Self.settledState(forKind: entry.kind)
            entries[index].settledAt = now
            isDirty = true
        }

        finish(now: now)
    }

    /// Fold one machine's flagged agents into the ledger.
    ///
    /// This is the channel Home's needs-you lane reads, and it carries what the
    /// inbox structurally cannot: a collaboration ask, where an agent is
    /// addressing YOU in a conversation. Those have no turn/block coordinates —
    /// there is nothing to approve from here — so the entry's action is opening
    /// the conversation, which is exactly where Home's card goes too.
    ///
    /// Same contract as `ingest`: successful reads only.
    public func ingestAgentAttention(
        _ agents: [AgentSummary],
        machineId: String,
        machineName: String,
        now: Date = Date()
    ) {
        var liveIds = Set<String>()

        for agent in agents where agent.needsAttention {
            // Keyed on the agent, not the ask text: an ask that gets rephrased
            // as a turn runs is the same demand, and must not spawn a new row
            // on every poll.
            let itemId = "agent-attention:\(agent.id)"
            let id = ScoutNotification.identity(machineId: machineId, itemId: itemId)
            liveIds.insert(id)

            let ask = agent.pendingAsk
            let prompt = ask?.prompt.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let summary = prompt.isEmpty ? "This agent is waiting on you." : prompt
            let title = Self.askTitle(for: ask?.kind, agent: agent)

            if let index = entries.firstIndex(where: { $0.id == id }) {
                var existing = entries[index]
                existing.title = title
                existing.summary = summary
                existing.sessionName = agent.title
                existing.machineName = machineName
                existing.sessionId = agent.conversationId ?? existing.sessionId
                existing.detail = ask.map { $0.options.joined(separator: " · ") }
                    .flatMap { $0.isEmpty ? nil : "Options: \($0)" }
                if !existing.state.isOurs, existing.state != .pending {
                    existing.state = .pending
                    existing.settledAt = nil
                }
                entries[index] = existing
                isDirty = true
                continue
            }

            entries.append(ScoutNotification(
                id: id,
                itemId: itemId,
                machineId: machineId,
                machineName: machineName,
                kind: "ask",
                sessionId: agent.conversationId ?? "",
                sessionName: agent.title,
                adapterType: agent.harness ?? "",
                risk: "low",
                title: title,
                summary: summary,
                detail: (ask?.options.isEmpty == false)
                    ? "Options: \(ask!.options.joined(separator: " · "))"
                    : nil,
                createdAt: agent.lastActiveAt ?? now,
                arrivedAt: now,
                state: .pending,
                source: .attention
            ))
            isDirty = true
        }

        for index in entries.indices where entries[index].machineId == machineId {
            let entry = entries[index]
            guard entry.source == .attention else { continue }
            guard entry.state == .pending, !liveIds.contains(entry.id) else { continue }
            // The agent stopped asking. We don't know whether you answered it
            // on the Mac or the agent moved on, so it settles unnamed.
            entries[index].state = .resolved
            entries[index].settledAt = now
            isDirty = true
        }

        finish(now: now)
    }

    private static func askTitle(for kind: PendingAsk.Kind?, agent: AgentSummary) -> String {
        switch kind {
        case .permission: return "\(agent.title) needs permission"
        case .decision: return "\(agent.title) needs a decision"
        case .confirm: return "\(agent.title) needs a confirmation"
        case .blocked: return "\(agent.title) is blocked"
        case .question, .other, .none: return "\(agent.title) is asking you"
        }
    }

    /// Settle push stubs no Mac has claimed. Called once per polling round,
    /// after every reachable machine has been folded in — a stub can belong to
    /// any of them, so it can only be judged when the whole round is done, and
    /// only after a grace window in case the alert simply beat the poll.
    public func settleUnclaimedStubs(now: Date = Date()) {
        var changed = false
        for index in entries.indices {
            let entry = entries[index]
            guard entry.machineId.isEmpty, entry.state == .pending else { continue }
            guard now.timeIntervalSince(entry.arrivedAt) > Self.settleGrace else { continue }
            entries[index].state = Self.settledState(forKind: entry.kind)
            entries[index].settledAt = now
            changed = true
        }
        guard changed else { return }
        isDirty = true
        save()
    }

    /// Record an alert we only know about through APNs. The payload carries no
    /// human-readable content by design (prompts, commands, paths, and error
    /// bodies never transit Apple), so the stub is deliberately thin — the next
    /// successful inbox read fills it in.
    public func recordPush(
        kind pushKind: String?,
        itemId pushItemId: String?,
        sessionId: String?,
        turnId: String?,
        blockId: String?,
        now: Date = Date()
    ) {
        guard let itemId = pushItemId ?? sessionId else { return }
        if entry(matchingItemId: pushItemId, sessionId: sessionId, turnId: turnId, blockId: blockId) != nil {
            return
        }

        let kind = pushKind ?? "native_attention"
        entries.append(ScoutNotification(
            id: ScoutNotification.identity(machineId: "", itemId: itemId),
            itemId: itemId,
            machineId: "",
            machineName: "",
            kind: kind,
            sessionId: sessionId ?? "",
            sessionName: "",
            adapterType: "",
            turnId: turnId,
            blockId: blockId,
            version: nil,
            risk: "low",
            title: Self.kindLabel(kind),
            summary: "Details load from the Mac that raised this.",
            detail: nil,
            createdAt: now,
            arrivedAt: now,
            seenAt: nil,
            state: .pending,
            settledAt: nil,
            source: .inbox,
            archivedAt: nil
        ))
        isDirty = true
        finish(now: now)
    }

    // MARK: - Read state

    public func markSeen(id: String, now: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              entries[index].seenAt == nil else { return }
        entries[index].seenAt = now
        isDirty = true
        save()
    }

    public func markAllSeen(now: Date = Date()) {
        var changed = false
        for index in entries.indices where entries[index].seenAt == nil {
            entries[index].seenAt = now
            changed = true
        }
        guard changed else { return }
        isDirty = true
        save()
    }

    // MARK: - Outcomes

    /// Stamp an outcome we performed from this device.
    public func record(_ state: ScoutNotification.State, id: String, now: Date = Date()) {
        guard state.isOurDecision, let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].state = state
        entries[index].settledAt = now
        if entries[index].seenAt == nil { entries[index].seenAt = now }
        isDirty = true
        save()
    }

    /// Take an open entry out of YOUR queue without answering the agent. This
    /// is triage, not a decision: nothing is sent, and `.dismissed` is labelled
    /// so it can never be read as one. The entry stays in the log.
    public func dismiss(id: String, now: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              entries[index].state == .pending else { return }
        entries[index].state = .dismissed
        entries[index].settledAt = now
        if entries[index].seenAt == nil { entries[index].seenAt = now }
        isDirty = true
        save()
    }

    /// File a settled entry away — out of Open and All, still under Archived.
    /// Refuses to file something that is still waiting on you: hiding a live
    /// demand is exactly the failure this destination exists to prevent.
    /// Dismiss it first if you want it gone.
    public func archive(id: String, now: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              !entries[index].isOpen else { return }
        entries[index].archivedAt = now
        if entries[index].seenAt == nil { entries[index].seenAt = now }
        isDirty = true
        save()
    }

    public func unarchive(id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              entries[index].isArchived else { return }
        entries[index].archivedAt = nil
        isDirty = true
        save()
    }

    public func clearAll() {
        guard !entries.isEmpty else { return }
        entries.removeAll()
        isDirty = true
        save()
    }

    // MARK: - Internals

    private static func settledState(forKind kind: String) -> ScoutNotification.State {
        switch kind {
        case "approval", "question", "native_attention": return .resolved
        default: return .cleared
        }
    }

    public static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "ask": return "Asking you"
        case "approval": return "Approval needed"
        case "question": return "Question"
        case "failed_action": return "Action failed"
        case "failed_turn": return "Turn failed"
        case "session_error": return "Session error"
        case "native_attention": return "Needs attention"
        case "delivery_issue": return "Delivery issue"
        default: return "Agent notification"
        }
    }

    /// Short mono tag for the row/detail state line.
    public static func stateLabel(_ entry: ScoutNotification) -> String {
        switch entry.state {
        case .pending: return "waiting on you"
        case .approved: return "approved"
        case .denied: return "denied"
        case .answered: return "answered"
        case .dismissed: return "dismissed"
        case .resolved: return "resolved elsewhere"
        case .cleared: return "cleared"
        }
    }

    /// The qualifier that keeps a settled entry honest: what we sent, or that
    /// we sent nothing at all.
    public static func stateQualifier(_ entry: ScoutNotification) -> String? {
        switch entry.state {
        case .approved, .denied, .answered: return "from this iPhone"
        case .dismissed: return "not answered"
        case .pending, .resolved, .cleared: return nil
        }
    }

    /// Sort newest-first, then apply retention.
    private func finish(now: Date) {
        entries.sort { left, right in
            if left.createdAt != right.createdAt { return left.createdAt > right.createdAt }
            return left.id > right.id
        }
        // Retention runs off `arrivedAt` — THIS device's clock — not the Mac's
        // `createdAt`. The window we state is "kept on this iPhone, 30 days",
        // and a Mac reporting an old turn time (or a skewed clock) must not be
        // able to make an entry evaporate the moment it settles.
        let cutoff = now.addingTimeInterval(-Self.maxAge)
        let kept = entries.filter { $0.arrivedAt >= cutoff || $0.isOpen }
        if kept.count != entries.count { entries = kept }
        if entries.count > Self.capacity {
            entries = Array(entries.prefix(Self.capacity))
        }
        save()
    }

    // MARK: - Persistence

    public static func defaultFileURL() -> URL? {
        guard let base = try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else { return nil }
        let directory = base.appendingPathComponent("Scout", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("notifications.json")
    }

    private func load() {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let decoded = try? decoder.decode([ScoutNotification].self, from: data) else { return }
        entries = decoded
    }

    private func save() {
        guard isDirty, let fileURL else { return }
        isDirty = false
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(entries) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
