import SwiftUI
import HudsonUI
import ScoutCapabilities

/// v3 Home — the X-like feed (design/studio/views/mobile-timeline.tsx §1).
/// A "Working now" horizontal row of live agents, then outcome posts shaped
/// from data the app ALREADY syncs — no new backend.
///
/// FEED SHAPING (v1, deliberately conservative): posts are grouped out of the
/// per-machine tail window (`recentTail`, the same 50-row / 5s-poll source as
/// TailSurface) by conversation. `TailEvent` carries no outcome state, so the
/// context row is inferred ONLY where the data honestly supports it:
///   · needs you — the conversation's agent reports `needsAttention`, or an
///     OPEN notifications-ledger entry names the same conversation;
///   · done      — the group's newest event is a codex "task complete" marker
///     (the same canonical completion test TailSurface uses);
///   · failed    — the newest event's summary says so ("failed" / "error");
///   · active    — everything else. No outcome is ever invented.
/// Agent identity comes from `listAgents` (matched on conversationId); posts
/// with no agent match fall back to the tail's `/project:session` handle.
/// Known limits: 5s-poll staleness, a 50-event window per Mac (old work ages
/// out), and keyword failure detection — all acceptable for v1, and called
/// out here rather than smoothed over.
struct V3HomeSurface: View {
    let model: AppModel
    let isActive: Bool
    /// Host scope from the masthead (a paired-machine id, nil = all hosts):
    /// both the Working-now cards and the feed narrow to that Mac's events.
    var hostScope: String?
    /// The sub-bar feed filter. Working honestly narrows to posts whose
    /// matched agent is `.live` right now; Thinking stays cosmetic (the tail
    /// carries no thinking signal — see V3HomeFilter).
    var filter: V3HomeFilter = .forYou
    /// Posts tap through to Chats (the thread's durable home). The peek sheet
    /// from the study is OUT of scope for this slice.
    var onOpenChats: () -> Void = {}

    private static let maxEventsPerMachine = 50
    private static let maxPosts = 30
    private static let tailPollSeconds: Double = 5
    private static let agentPollSeconds: Double = 20

    @State private var events: [MachineTailEvent] = []
    @State private var agents: [MachineAgent] = []
    @State private var hasLoadedTail = false
    @State private var onlineMachineCount = 0
    @State private var pairedMachineCount = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct MachineTailEvent: Identifiable {
        let id: String
        let machineId: String
        let event: TailEvent
    }

    private struct MachineAgent: Identifiable {
        let id: String
        let machineId: String
        let agent: AgentSummary
    }

    /// The scope, dropped back to all-hosts when it names a Mac that is no
    /// longer paired (stale selection must never blank the feed).
    private var effectiveScope: String? {
        guard let hostScope, model.pairedMachines.contains(where: { $0.id == hostScope }) else {
            return nil
        }
        return hostScope
    }

    private var reloadKey: String {
        "\(model.fleetDataReadyToken).\(model.fleetRevision).\(model.machineFilterKey)"
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                if !workingAgents.isEmpty {
                    workingSection
                }
                feedSection
            }
            .padding(.bottom, HudSpacing.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .refreshable {
            await fetchTailOnce()
            await fetchAgentsOnce()
        }
        .task(id: "\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            await fetchTailOnce()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.tailPollSeconds))
                if Task.isCancelled { break }
                await fetchTailOnce()
            }
        }
        .task(id: "agents|\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            while !Task.isCancelled {
                await fetchAgentsOnce()
                try? await Task.sleep(for: .seconds(Self.agentPollSeconds))
            }
        }
    }

    // MARK: - Working now

    private var workingAgents: [MachineAgent] {
        agents.filter { entry in
            entry.agent.state == .live
                && (effectiveScope == nil || entry.machineId == effectiveScope)
        }
    }

    private var workingSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.sm) {
                HudStatusDot(color: ScoutPalette.accent, size: 5, pulses: !reduceMotion)
                ScoutSectionLabel("Working now")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    ForEach(workingAgents) { entry in
                        workingCard(entry.agent)
                    }
                }
                .padding(.horizontal, 14)
            }
        }
        .padding(.top, HudSpacing.md)
    }

    private func workingCard(_ agent: AgentSummary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(ScoutPalette.accent)
                    .frame(width: 5, height: 5)
                Text(agent.title)
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let lastActive = agent.lastActiveAt {
                    Text(Self.ageLabel(since: lastActive))
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.accent)
                }
            }
            Text(agent.statusLabel ?? "working")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutInk.muted)
                .lineLimit(2)
            Text(agent.projectName ?? "—")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .lineLimit(1)
        }
        .padding(HudSpacing.md)
        .frame(width: 172, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.raised))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: - Feed

    @ViewBuilder
    private var feedSection: some View {
        if posts.isEmpty {
            emptyState
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(posts) { post in
                    V3FeedPostRow(post: post, onOpen: {
                        guard post.conversationId != nil else { return }
                        onOpenChats()
                    })
                }
            }
            .padding(.horizontal, 14)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if pairedMachineCount == 0 {
            ScoutEmptyState(
                title: "No Macs paired",
                subtitle: "Pair a Mac from Settings → Connection to see your fleet.",
                icon: "desktopcomputer"
            )
        } else if onlineMachineCount == 0 {
            ScoutEmptyState(
                title: "No Macs online",
                subtitle: "The feed fills in once a paired Mac is reachable.",
                icon: "network.slash"
            )
        } else {
            ScoutEmptyState(
                title: hasLoadedTail ? "No recent activity" : "Loading recent activity",
                subtitle: hasLoadedTail
                    ? "Agent work across your Macs lands here as it happens."
                    : "Reading the latest tail window.",
                icon: "waveform"
            )
        }
    }

    // MARK: - Post shaping

    private var posts: [V3FeedPost] {
        let openAlertSessions = Set(model.notifications.entries(.open).map(\.sessionId))
        var groups: [String: (key: String, rows: [MachineTailEvent])] = [:]
        var order: [String] = []
        for row in events {  // events arrive oldest → newest
            if let scope = effectiveScope, row.machineId != scope { continue }
            let key = row.event.conversationId
                ?? [row.machineId, row.event.source, row.event.project ?? "—"].joined(separator: "\u{1f}")
            if groups[key] == nil {
                groups[key] = (key, [])
                order.append(key)
            }
            groups[key]?.rows.append(row)
        }
        let now = Date()
        let shaped: [(post: V3FeedPost, isLive: Bool)] = order.compactMap { key in
            guard let group = groups[key], let newest = group.rows.last else { return nil }
            let event = newest.event
            let matched = agents.first { $0.agent.conversationId == event.conversationId }?.agent
            let state: V3FeedPost.State
            if matched?.needsAttention == true
                || (event.conversationId.map { openAlertSessions.contains($0) } ?? false) {
                state = .needs
            } else if Self.isTurnCompletion(event) {
                state = .done
            } else if Self.looksFailed(event.summary) {
                state = .failed
            } else {
                state = .active
            }
            let line = group.rows.last(where: { $0.event.kind == .assistant })?.event.summary
                ?? event.summary
            return (
                V3FeedPost(
                    id: key,
                    agent: matched?.title ?? Self.handle(for: event),
                    project: event.project ?? matched?.projectName ?? "",
                    harness: event.source,
                    age: Self.ageLabel(since: Date(timeIntervalSince1970: Double(event.tsMs) / 1_000), now: now),
                    state: state,
                    line: Self.clamp(line),
                    conversationId: event.conversationId
                ),
                matched?.state == .live
            )
        }
        return Array(
            shaped
                // Working = honestly narrowed to posts whose agent is live
                // right now; For you / Thinking show the full feed.
                .filter { filter != .working || $0.isLive }
                .map(\.post)
                .sorted { lhs, rhs in
                    // Newest first — group order was append-time, so re-sort on
                    // the newest event each group carries.
                    let l = groups[lhs.id]?.rows.last?.event.tsMs ?? 0
                    let r = groups[rhs.id]?.rows.last?.event.tsMs ?? 0
                    return l > r
                }
                .prefix(Self.maxPosts)
        )
    }

    /// The canonical codex completion marker (same test TailSurface applies).
    private static func isTurnCompletion(_ event: TailEvent) -> Bool {
        guard event.kind == .system, event.source.lowercased() == "codex" else { return false }
        return event.summary
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: " ") == "task complete"
    }

    private static func looksFailed(_ summary: String) -> Bool {
        let lowered = summary.lowercased()
        return lowered.contains("failed") || lowered.contains("error")
    }

    /// `/project:last4` — the same compact handle Tail renders, so a post with
    /// no agent match still names where it happened.
    private static func handle(for event: TailEvent) -> String {
        var base = "—"
        if let project = event.project, !project.isEmpty {
            base = "/" + project
        } else if let cwd = event.cwd, !cwd.isEmpty {
            base = "/" + cwd.split(separator: "/").suffix(2).joined(separator: "/")
        }
        let last4 = String((event.conversationId ?? "").suffix(4))
        return last4.isEmpty ? base : "\(base):\(last4)"
    }

    private static func clamp(_ text: String) -> String {
        let flattened = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard flattened.count > 280 else { return flattened }
        return String(flattened.prefix(277)) + "…"
    }

    static func ageLabel(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "\(Int(seconds))s" }
        if seconds < 3_600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3_600))h" }
        return "\(Int(seconds / 86_400))d"
    }

    // MARK: - Fetching

    private func fetchTailOnce() async {
        let machines = model.agentMachines()
        pairedMachineCount = machines.count
        onlineMachineCount = machines.filter(\.isOnline).count
        var snapshot: [MachineTailEvent] = []
        for machine in machines {
            guard let client = machine.client else { continue }
            guard let rows = try? await client.recentTail(limit: Self.maxEventsPerMachine),
                  !Task.isCancelled else { continue }
            snapshot.append(contentsOf: rows.map { event in
                MachineTailEvent(
                    id: "\(machine.id)::\(event.id)",
                    machineId: machine.id,
                    event: event
                )
            })
        }
        guard !Task.isCancelled else { return }
        let oldestFirst = snapshot.sorted {
            if $0.event.tsMs == $1.event.tsMs { return $0.id < $1.id }
            return $0.event.tsMs < $1.event.tsMs
        }
        events = oldestFirst
        hasLoadedTail = true
    }

    private func fetchAgentsOnce() async {
        var collected: [MachineAgent] = []
        var sawSuccessfulRead = false
        for machine in model.agentMachines() {
            guard let client = machine.client else { continue }
            guard let rows = try? await client.listAgents(query: nil, limit: 200),
                  !Task.isCancelled else { continue }
            sawSuccessfulRead = true
            collected.append(contentsOf: rows.map {
                MachineAgent(id: "\(machine.id)::\($0.id)", machineId: machine.id, agent: $0)
            })
        }
        guard !Task.isCancelled, sawSuccessfulRead else { return }
        agents = collected
        // Share the read with the shell counters (the status strip's "N
        // active"), the same hand-off Home makes to Root.
        model.updateFleetStats(from: collected.map(\.agent))
    }
}

// MARK: - Feed post model + row

struct V3FeedPost: Identifiable {
    enum State {
        case needs, done, failed, active

        var label: String {
            switch self {
            case .needs: "Needs you"
            case .done: "Done"
            case .failed: "Failed"
            case .active: "Active"
            }
        }

        var color: Color {
            switch self {
            case .needs: ScoutPalette.statusWarn
            case .done: ScoutPalette.accent
            case .failed: ScoutPalette.statusError
            case .active: ScoutPalette.statusOk
            }
        }
    }

    let id: String
    let agent: String
    let project: String
    let harness: String
    let age: String
    let state: State
    let line: String
    let conversationId: String?
}

/// One post, X anatomy: avatar column · name + meta (quiet state mark at the
/// row's trailing edge when not done) · outcome line in primary ink · dim
/// action row.
struct V3FeedPostRow: View {
    let post: V3FeedPost
    var onOpen: () -> Void = {}

    /// The study's deterministic accent tile: mono initial, name-hash tint
    /// (same pattern as Comms "Marks").
    private static let avatarTones: [Color] = [
        ScoutPalette.accent, ScoutPalette.statusInfo, ScoutPalette.statusOk, ScoutPalette.statusWarn
    ]

    private var tone: Color {
        var hash: UInt32 = 0
        for byte in post.agent.utf8 { hash = hash &* 31 &+ UInt32(byte) }
        return Self.avatarTones[Int(hash % UInt32(Self.avatarTones.count))]
    }

    private var initial: String {
        let alphanumerics = post.agent.filter { $0.isLetter || $0.isNumber }
        return alphanumerics.first.map { String($0).uppercased() } ?? "•"
    }

    private var meta: String {
        [post.project, post.harness, post.age]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Text(initial)
                    .font(HudFont.mono(13, weight: .bold))
                    .foregroundStyle(tone)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(tone.opacity(0.13)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(tone.opacity(0.32), lineWidth: 1)
                    )

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(post.agent)
                            .font(HudFont.ui(HudTextSize.lg, weight: .bold))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                        Text(meta)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.dim)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: 8)
                        // Done is the standard state: unmarked. The rest get a
                        // quiet trailing mark; working stays dimmer than
                        // needs-you/failed.
                        if post.state != .done {
                            Text(post.state.label)
                                .font(HudFont.mono(HudTextSize.micro, weight: post.state == .active ? .medium : .bold))
                                .tracking(0.5)
                                .foregroundStyle(post.state.color)
                                .lineLimit(1)
                        }
                    }
                    Text(post.line)
                        .font(HudFont.ui(HudTextSize.md))
                        .lineSpacing(3)
                        .foregroundStyle(ScoutPalette.ink)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 18) {
                        Text("Reply")
                            .foregroundStyle(post.state == .needs ? ScoutPalette.accent : ScoutInk.dim)
                            .fontWeight(post.state == .needs ? .bold : .regular)
                        Text("Open thread")
                    }
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .foregroundStyle(ScoutInk.dim)
                    .padding(.top, 5)
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutHairline.subtle)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // The action row is visual in this slice — the whole row's tap is the
        // one real gesture (through to Chats when a thread exists).
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(post.state.label), \(post.agent), \(meta): \(post.line)")
        .accessibilityHint(post.conversationId != nil ? "Opens Chats" : "")
    }
}
