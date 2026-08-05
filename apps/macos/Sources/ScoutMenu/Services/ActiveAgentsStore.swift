import Combine
import Foundation
import ScoutAppCore

/// The currently-active slice of the fleet, for the menu-bar popup.
///
/// This is deliberately **not** a roster. It answers "who is doing something
/// right now, and who is waiting on me" — an agent that is merely registered
/// and quiet drops out of the list entirely, which is why the panel is allowed
/// to render nothing at all. Nothing here ever frames an agent as
/// available/ready for work; rows are labelled by activity and recency.
///
/// Lifecycle: `start()` fires an immediate refresh plus a ~6s poll;
/// `stop()` cancels both. Because the panel collapses to `EmptyView` when
/// there is nothing to show — and a view that is not in the tree never
/// receives `onAppear` — the **host** view owns start/stop, not the panel.
/// See the integration note at the top of `ActiveAgentsPanel`.
@MainActor
final class ActiveAgentsStore: ObservableObject, ScoutChangeSetting {
    /// Ranked, already-filtered rows: needs-you first, then working, then the
    /// recently active. Empty whenever the fleet is quiet *or* the local web
    /// server is down — the menu never distinguishes the two.
    @Published private(set) var agents: [ScoutAgent] = []

    /// How long an agent that has just finished a turn still counts as
    /// recently active.
    ///
    /// Note this window is deliberately *not* applied to `available` agents.
    /// `/api/agents` stamps `updatedAt` on registration sweeps, not on agent
    /// activity — measured on a live broker, 40 registrations shared a single
    /// 500ms window while nothing at all was running. Treating "updated
    /// recently" as "active" therefore turns this panel into a fleet roster,
    /// which is exactly what it must never be.
    static let activityWindow: TimeInterval = 15 * 60

    /// A registration still claiming `working`/`needs-attention` this long
    /// after its last update is a zombie the broker never got to retire, not a
    /// turn in flight. Past this bound we stop believing the state field.
    static let liveClaimWindow: TimeInterval = 6 * 60 * 60

    /// The popup shows at most this many rows; the remainder collapse into a
    /// single "+N more" line.
    static let visibleRowLimit = 4

    private let pollInterval: TimeInterval
    private let fetchLimit: Int
    private var isStarted = false
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?

    /// Consecutive fetch failures. One blip keeps the last snapshot on screen;
    /// a genuinely down broker (which fails every time) empties the panel.
    private var failureStreak = 0
    private static let failureStreakBeforeClearing = 2

    init(pollInterval: TimeInterval = 6, fetchLimit: Int = 40) {
        self.pollInterval = pollInterval
        self.fetchLimit = fetchLimit
    }

    // MARK: - Presentation surface

    /// True only when there is at least one active or needs-you agent. The
    /// panel renders nothing otherwise: an absent section beats an empty state
    /// in a menu that is mostly about the local services.
    var hasContent: Bool { !agents.isEmpty }

    /// The rows the panel actually draws.
    var visibleAgents: [ScoutAgent] { Array(agents.prefix(Self.visibleRowLimit)) }

    /// How many active agents did not fit; 0 when everything is on screen.
    var overflowCount: Int { max(0, agents.count - Self.visibleRowLimit) }

    /// Number of rows the panel will draw right now (0 when it self-hides).
    var visibleRowCount: Int { visibleAgents.count }

    // MARK: - Lifecycle

    func start() {
        guard !isStarted else { return }
        isStarted = true
        refresh()
        let interval = pollInterval
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard let self else { return }
                refresh()
            }
        }
    }

    func stop() {
        isStarted = false
        pollTask?.cancel()
        pollTask = nil
        inFlight?.cancel()
        inFlight = nil
    }

    /// Fetch once. Overlapping polls are dropped rather than queued — the
    /// attention-aware read can take a beat on a busy machine and a menu that
    /// is open for ten seconds must not stack requests behind it.
    func refresh() {
        guard inFlight == nil else { return }
        inFlight = Task { [weak self] in
            await self?.load()
            self?.inFlight = nil
        }
    }

    private func load() async {
        do {
            let fetched = try await ScoutHTTP.fetch([ScoutAgent].self, from: agentsURL())
            failureStreak = 0
            scoutSetIfChanged(Self.ranked(fetched), to: \.agents)
        } catch {
            // Network errors are swallowed on purpose: an offline broker shows
            // as an absent panel, never as an error row in the menu bar.
            failureStreak += 1
            if failureStreak >= Self.failureStreakBeforeClearing {
                scoutSetIfChanged([], to: \.agents)
            }
        }
    }

    /// `detail=summary` keeps the payload lean (the popup needs name, state,
    /// harness, project and recency, nothing else); `attention=1` is what makes
    /// the server compute `needs_attention` + `pendingAsk` at all — without it
    /// no agent ever reports that it is waiting on the operator.
    private func agentsURL() -> URL {
        ScoutWeb.baseURL()
            .appending(path: "api/agents")
            .appending(queryItems: [
                URLQueryItem(name: "limit", value: "\(fetchLimit)"),
                URLQueryItem(name: "detail", value: "summary"),
                URLQueryItem(name: "attention", value: "1"),
            ])
    }

    // MARK: - Activity semantics

    /// "Needs you" is a precedence layer rather than a status: a pending ask
    /// outranks whatever else the fleet happens to be doing.
    static func needsYou(_ agent: ScoutAgent) -> Bool {
        agent.state == .needsAttention || agent.pendingAsk != nil
    }

    /// Active means *in a turn now*, *waiting on the operator*, or *just
    /// finished* — never "registered and idle".
    static func isActive(_ agent: ScoutAgent, now: Date = Date()) -> Bool {
        let age = age(of: agent, now: now)
        switch agent.state {
        case .working, .needsAttention:
            // Trust the server's claim about the present moment, but not
            // indefinitely — see `liveClaimWindow`.
            return (age ?? 0) <= liveClaimWindow
        case .done:
            guard let age else { return false }
            return age <= activityWindow
        case .available, .offline:
            // Registered and quiet. A recent `updatedAt` here means the broker
            // swept the registration, not that the agent did anything — see
            // `activityWindow`.
            return false
        }
    }

    /// Filter to the active set and order it: needs-you, then working, then
    /// recently active; most recent first inside each band.
    static func ranked(_ agents: [ScoutAgent], now: Date = Date()) -> [ScoutAgent] {
        agents
            .filter { isActive($0, now: now) }
            .sorted { left, right in
                let leftBand = band(left)
                let rightBand = band(right)
                if leftBand != rightBand { return leftBand < rightBand }
                let leftUpdated = left.updatedAt ?? 0
                let rightUpdated = right.updatedAt ?? 0
                if leftUpdated != rightUpdated { return leftUpdated > rightUpdated }
                return left.displayName.localizedCaseInsensitiveCompare(right.displayName) == .orderedAscending
            }
    }

    /// What the agent is doing, plus when we last heard from it —
    /// "working · 4m", "idle · 2h". Never a readiness word.
    static func activityLabel(for agent: ScoutAgent) -> String {
        let verb: String
        if needsYou(agent) {
            verb = "needs you"
        } else {
            switch agent.state {
            case .working: verb = "working"
            case .done: verb = "done"
            case .available, .offline, .needsAttention: verb = "idle"
            }
        }
        let age = agent.updatedLabel
        return age == "—" ? verb : "\(verb) · \(age)"
    }

    /// The second line: the pending question when one is waiting, otherwise
    /// where the work is happening.
    static func detailLabel(for agent: ScoutAgent) -> String {
        if needsYou(agent), let ask = trimmedNonEmpty(agent.pendingAsk) {
            return ask
        }
        let parts = [trimmedNonEmpty(agent.harness), projectLabel(for: agent)].compactMap { $0 }
        return parts.isEmpty ? agent.roleLabel : parts.joined(separator: " · ")
    }

    // MARK: - Internals

    private static func band(_ agent: ScoutAgent) -> Int {
        if needsYou(agent) { return 0 }
        if agent.state == .working { return 1 }
        return 2
    }

    private static func age(of agent: ScoutAgent, now: Date) -> TimeInterval? {
        guard let updated = ScoutRelativeTime.date(agent.updatedAt) else { return nil }
        return max(0, now.timeIntervalSince(updated))
    }

    private static func projectLabel(for agent: ScoutAgent) -> String? {
        if let project = trimmedNonEmpty(agent.project) { return project }
        guard let root = trimmedNonEmpty(agent.projectRoot) ?? trimmedNonEmpty(agent.cwd) else { return nil }
        return trimmedNonEmpty(String(root.split(separator: "/").last ?? "")) ?? root
    }

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}
