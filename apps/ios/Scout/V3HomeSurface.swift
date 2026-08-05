import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutNativeCore

/// v3 Home — the X-like feed (design/studio/views/mobile-timeline.tsx §1).
/// A "Working now" horizontal row of live agents, then outcome posts shaped
/// from data the app ALREADY syncs — no new backend.
///
/// FEED SHAPING (v1, deliberately conservative): posts are grouped by
/// conversation out of the per-machine ACTIVITY ledger (`recentActivity` —
/// the curated cross-agent exchange feed), not out of `recentTail`. The tail
/// is a global harness firehose: a single chatty session fills its whole
/// window, so a tail-fed feed collapses to one post while the rest of the
/// fleet is invisible (measured 2026-08-04: 50 tail rows = 1 conversation,
/// 60 ledger rows = 31). The ledger is also the only source whose
/// `conversationId` shares an id space with `listAgents`, so agent matching
/// can actually resolve.
///
/// `TailEvent` carries no outcome state, so the context row is inferred ONLY
/// where the data honestly supports it:
///   · needs you — an OPEN notifications-ledger entry names the conversation
///     (that ledger is built from `agent.needsAttention` and keyed on the
///     agent's own id, so it is the reliable side of the same fact);
///   · failed    — the newest event's summary says so ("failed" / "error");
///   · active    — everything else. No outcome is ever invented.
///
/// IDENTITY comes from the ledger's own `actorName`, never from the roster.
/// Agents collapse many-to-one onto a conversation (measured 2026-08-04: 260
/// agents share a single `chn-…`), so a roster "match" is an arbitrary member
/// of that set — letting it win renamed real posts and once labelled the
/// operator's own message with an agent's name. The RUNTIME likewise comes off
/// the wire per row (the broker resolves it from the actor's endpoint, the only
/// place a cardless flight agent's runtime is recorded); the roster is a last
/// fallback. Nothing here is ever guessed from a name.
/// Known limits: poll staleness, a bounded window per Mac (old work ages
/// out), and keyword failure detection — all acceptable for v1, and called
/// out here rather than smoothed over.
struct V3HomeSurface: View {
    let model: AppModel
    let isActive: Bool
    /// Host scope from the masthead (a paired-machine id, nil = all hosts):
    /// both the Working-now cards and the feed narrow to that Mac's events.
    var hostScope: String?
    /// The sub-bar feed filter. Working honestly narrows to posts whose agent
    /// the broker reports live right now (see V3HomeFilter).
    var filter: V3HomeFilter = .forYou
    private static let maxEventsPerMachine = 80
    private static let maxPosts = 30
    private static let feedPollSeconds: Double = 10
    private static let agentPollSeconds: Double = 20

    @State private var events: [MachineFeedEvent] = []
    @State private var agents: [MachineAgent] = []
    @State private var hasLoadedFeed = false
    @State private var onlineMachineCount = 0
    @State private var pairedMachineCount = 0
    /// The thread a tapped post opened — the post's own conversation, one layer
    /// deep (the study's peek sheet, in its first honest form).
    @State private var openThread: OpenThread?
    @StateObject private var entrance = CockpitEntrancePhase()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A post's conversation plus the Mac that holds it — the feed is
    /// cross-machine, so the thread has to be read through its own host's
    /// client, not whichever one happens to be selected.
    private struct OpenThread: Identifiable {
        let conversation: CommsConversation
        let client: any ScoutBrokerClient
        /// Carried from the post so the thread header can wear the same badge
        /// the feed row did — the thread itself cannot resolve a runtime.
        let harness: String?
        var id: String { conversation.id }
    }

    private struct MachineFeedEvent: Identifiable {
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
            await fetchFeedOnce()
            await fetchAgentsOnce()
        }
        .task(id: "\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            await fetchFeedOnce()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.feedPollSeconds))
                if Task.isCancelled { break }
                await fetchFeedOnce()
            }
        }
        .task(id: "agents|\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            while !Task.isCancelled {
                await fetchAgentsOnce()
                try? await Task.sleep(for: .seconds(Self.agentPollSeconds))
            }
        }
        // A post opens ITS OWN thread, one layer over the feed — tapping a
        // result and landing on the chat list was a dead end.
        .sheet(item: $openThread) { thread in
            CommsThreadView(
                client: thread.client,
                conversation: thread.conversation,
                counterpartHarness: thread.harness,
                onClose: { openThread = nil },
                onRead: {
                    _ = try? await thread.client.markConversationRead(
                        conversationId: thread.conversation.id
                    )
                }
            )
        }
    }

    /// Build the thread a post points at. The feed row carries everything the
    /// header needs, so the sheet opens with the agent's name already on it
    /// instead of a blank bar that fills in after the first fetch.
    private func openPost(_ post: V3FeedPost) {
        guard let conversationId = post.conversationId, !conversationId.isEmpty else { return }
        let client = model.agentMachines().first { $0.id == post.machineId }?.client ?? model.client
        openThread = OpenThread(
            conversation: CommsConversation(
                id: conversationId,
                kind: .unknown,
                title: post.agent,
                participants: [post.agent],
                lastMessagePreview: post.line,
                lastMessageAuthor: post.agent,
                lastMessageAt: nil,
                messageCount: 0,
                unreadCount: 0
            ),
            client: client,
            harness: post.harness.isEmpty ? nil : post.harness
        )
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
            let rows = posts
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, post in
                    V3FeedPostRow(post: post, onOpen: { openPost(post) })
                        // First activation only: the same 7pt settle every Scout
                        // surface uses, staggered down the feed. Later polls
                        // render in place — the phase latch is per launch.
                        .cockpitEntrance(index: index, phase: entrance, motionEnabled: !reduceMotion)
                        // A post that arrives while you are reading slides in
                        // from the top instead of teleporting the list.
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .top).combined(with: .opacity),
                                removal: .opacity
                            )
                        )
                }
            }
            .padding(.horizontal, 14)
            .animation(
                reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86),
                value: rows.map(\.id)
            )
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
        } else if filter != .forYou, !unfilteredPostCountIsZero {
            // The fleet HAS work; this filter just doesn't match any of it.
            // Saying "no recent activity" here sent the operator hunting for a
            // connection bug that wasn't there.
            ScoutEmptyState(
                title: "Nothing \(filter.rawValue.lowercased()) right now",
                subtitle: "For you still has recent work from your fleet.",
                icon: "line.3.horizontal.decrease"
            )
        } else {
            ScoutEmptyState(
                title: hasLoadedFeed ? "No recent activity" : "Loading recent activity",
                subtitle: hasLoadedFeed
                    ? "Agent work across your Macs lands here as it happens."
                    : "Reading the latest exchanges.",
                icon: "waveform"
            )
        }
    }

    /// Whether the feed is empty even before the sub-bar filter runs — the test
    /// that separates "nothing happened" from "nothing matches this filter".
    private var unfilteredPostCountIsZero: Bool {
        events.allSatisfy { row in
            effectiveScope != nil && row.machineId != effectiveScope
        }
    }

    // MARK: - Post shaping

    private var posts: [V3FeedPost] {
        let openAlertSessions = Set(model.notifications.entries(.open).map(\.sessionId))
        var groups: [String: (key: String, rows: [MachineFeedEvent])] = [:]
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
            let matched = agents.first {
                $0.agent.conversationId != nil && $0.agent.conversationId == event.conversationId
            }?.agent
            let state: V3FeedPost.State
            // One source for attention, not two: the notifications ledger is
            // BUILT from `agent.needsAttention` and keyed on the agent's own id,
            // so it is a strict superset of the roster check AND doesn't ride
            // the many-to-one conversation match. Asking both only added a way
            // to raise attention on the wrong post.
            if event.conversationId.map({ openAlertSessions.contains($0) }) ?? false {
                state = .needs
            } else if Self.looksFailed(event.summary) {
                state = .failed
            } else {
                state = .active
            }
            // The agent's own last word is the outcome; an operator line is the
            // ask, not the result. Fall back to the newest row when the group
            // has no agent line yet.
            let agentRow = group.rows.last(where: { $0.event.kind == .assistant })
            let line = agentRow?.event.summary ?? event.summary
            // The ledger names its actor on every row — prefer a roster match,
            // then the agent's name, then whoever posted last (an ask you sent
            // that nobody has answered yet reads as "You", not as a handle
            // stitched out of an id), and only then the synthesized handle.
            // The row the post is NAMED after. nil when the operator is the only
            // one who has spoken — an ask nobody has answered yet. That case is
            // "You", and an operator has no project and no runtime, so none of
            // the agent enrichment below may touch it.
            let namingRow = agentRow ?? group.rows.last { $0.event.kind != .user }
            let actorName = (namingRow ?? newest)
                .event.source
                .trimmingCharacters(in: .whitespacesAndNewlines)
            // The LEDGER names the actor, and it is authoritative: it recorded
            // who actually posted. The roster must never override it — agents
            // collapse many-to-one onto a conversation (measured: 260 agents
            // share one `chn-…`), so a "match" is an arbitrary member of that
            // set. Letting it win renamed three of seven resolving groups and
            // labelled the operator's own message with an agent's name.
            let handle = Self.splitHandle(
                actorName.isEmpty ? Self.handle(for: event) : actorName,
                projects: projectPrefixes
            )
            return (
                V3FeedPost(
                    id: key,
                    machineId: newest.machineId,
                    agent: handle.name,
                    project: namingRow == nil
                        ? ""
                        : (event.project ?? matched?.projectName ?? handle.project ?? ""),
                    // The ledger attributes the runtime broker-side (resolved from
                    // the actor's endpoint — the only place a cardless flight
                    // agent's runtime is recorded), so it comes off the row we
                    // named the post after. Roster match is the last fallback, and
                    // an operator-only post gets nothing: "You" runs on no runtime.
                    harness: namingRow.flatMap { $0.event.runtime }
                        ?? (namingRow == nil ? nil : matched?.harness)
                        ?? "",
                    age: Self.ageLabel(since: Date(timeIntervalSince1970: Double(event.tsMs) / 1_000), now: now),
                    state: state,
                    line: Self.outcomeLine(line),
                    conversationId: event.conversationId
                ),
                matched?.state == .live
            )
        }
        return Array(
            shaped
                // Working = honestly narrowed to posts whose agent is live
                // right now; For you shows the full feed.
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

    private static func looksFailed(_ summary: String) -> Bool {
        let lowered = summary.lowercased()
        return lowered.contains("failed") || lowered.contains("error")
    }

    /// Project names the fleet actually has, from the agent roster. Used to
    /// split handles — never to guess one that isn't there.
    private var projectPrefixes: Set<String> {
        Set(
            agents.compactMap { entry in
                entry.agent.projectName?.lowercased()
            }
            .filter { !$0.isEmpty }
        )
    }

    /// Flight agents are handled `<project>-<name>-<n>` ("openscout-faraday-2"),
    /// which puts the project in the name AND the meta line and leaves every
    /// avatar in a project sharing one initial. Split the prefix off when it
    /// names a project this fleet really has; otherwise leave the handle alone.
    /// Nothing is lost — the prefix reappears as the post's project.
    static func splitHandle(_ handle: String, projects: Set<String>) -> (name: String, project: String?) {
        guard let dash = handle.firstIndex(of: "-") else { return (handle, nil) }
        let prefix = String(handle[handle.startIndex..<dash])
        let rest = String(handle[handle.index(after: dash)...])
        guard !rest.isEmpty, projects.contains(prefix.lowercased()) else { return (handle, nil) }
        return (rest, prefix)
    }

    /// The ledger carries raw message bodies — routing tags, pasted session ids,
    /// markdown. The feed wants the sentence a person would say. Take the first
    /// real line (a heading IS the summary), drop the control prefix and the
    /// emphasis marks, and clamp. A very short opener borrows the next line so
    /// the post never reads as a fragment.
    static func outcomeLine(_ text: String) -> String {
        var body = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // "[ask:f-mset7puc-37iu] …" — routing metadata, not the message.
        if body.hasPrefix("["), let close = body.firstIndex(of: "]") {
            let tag = body[body.index(after: body.startIndex)..<close]
            if tag.count <= 40, tag.contains(":") {
                body = String(body[body.index(after: close)...])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        let lines = body
            .components(separatedBy: .newlines)
            .map { line in
                line.trimmingCharacters(in: .whitespacesAndNewlines)
                    .drop { $0 == "#" || $0 == ">" || $0 == "-" || $0 == "*" || $0 == " " }
            }
            .map(String.init)
            .filter { !$0.isEmpty }

        var lead = lines.first ?? ""
        // A stub opener ("Checks run:", "Hostname:") is a label, not a sentence.
        if lead.count < 28, lines.count > 1 {
            lead = "\(lead) \(lines[1])"
        }

        let flattened = lead
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard flattened.count > 180 else { return flattened }
        return String(flattened.prefix(179)) + "…"
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

    static func ageLabel(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "\(Int(seconds))s" }
        if seconds < 3_600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3_600))h" }
        return "\(Int(seconds / 86_400))d"
    }

    // MARK: - Fetching

    private func fetchFeedOnce() async {
        let machines = model.agentMachines()
        pairedMachineCount = machines.count
        onlineMachineCount = machines.filter(\.isOnline).count
        var snapshot: [MachineFeedEvent] = []
        for machine in machines {
            guard let client = machine.client else { continue }
            guard let rows = try? await client.recentActivity(limit: Self.maxEventsPerMachine),
                  !Task.isCancelled else { continue }
            snapshot.append(contentsOf: rows.map { event in
                MachineFeedEvent(
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
        hasLoadedFeed = true
        await entrance.reveal(when: isActive, animated: !reduceMotion)
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
    /// No `done`: the activity ledger carries no completion signal, and a state
    /// nothing can produce is a lie in the type. Add it back the day a real
    /// outcome marker reaches the phone.
    enum State {
        case needs, failed, active

        var label: String {
            switch self {
            case .needs: "Needs you"
            case .failed: "Failed"
            case .active: "Active"
            }
        }

        var color: Color {
            switch self {
            case .needs: ScoutPalette.statusWarn
            case .failed: ScoutPalette.statusError
            case .active: ScoutPalette.statusOk
            }
        }
    }

    let id: String
    /// The Mac this post came from — the feed is cross-machine, so opening the
    /// thread has to go back through the right host.
    let machineId: String
    let agent: String
    let project: String
    let harness: String
    let age: String
    let state: State
    let line: String
    let conversationId: String?
}

/// The row's press feedback: a shallow settle, no travel. Enough that a tap
/// feels received before the thread sheet takes over.
private struct V3FeedRowPress: ButtonStyle {
    let motionEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(motionEnabled && configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// One post, X anatomy: identity column · name + meta (quiet state mark at the
/// row's trailing edge when not standard) · outcome line in primary ink.
struct V3FeedPostRow: View {
    let post: V3FeedPost
    var onOpen: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The harness rides the sprite as a corner badge, so it never spends a
    /// slot in the meta line.
    private var meta: String {
        [post.project, post.age]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// A needs-you agent reads alive; everything else sits at the calm range.
    private var spriteTone: AgentSpriteTone {
        post.state == .needs ? .live : AgentSpriteTone()
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                // Identity is the creature (name → sprite, the same one this
                // agent wears on web and macOS); the runtime is the badge on
                // its shoulder. Neither borrows the status palette.
                SpriteIdentityMark(
                    name: post.agent,
                    harness: post.harness.isEmpty ? nil : post.harness,
                    size: 32,
                    tone: spriteTone
                )

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        // Mono, not sans: an agent name is a HANDLE, and Scout
                        // sets handles in mono everywhere else (Comms authors,
                        // Tail rows). Sans-bold made the feed read like a social
                        // app with people in it.
                        Text(post.agent)
                            .font(HudFont.mono(HudTextSize.md, weight: .semibold))
                            .tracking(0.2)
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                        Text(meta)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.dim)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: 8)
                        // Active is the standard state: unmarked. Only the two
                        // states that ask something of you carry a trailing mark,
                        // so the feed stays quiet until it isn't.
                        if post.state != .active {
                            Text(post.state.label)
                                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                                .tracking(0.5)
                                .foregroundStyle(post.state.color)
                                .lineLimit(1)
                        }
                    }
                    // Three lines is the glance: enough to know what happened,
                    // short enough that the next post is on screen. The thread
                    // holds the rest — this is a feed, not a reader.
                    // The line stays in the reading face (sans) one step under
                    // the handle's ink, so the eye lands on WHO first and the
                    // prose reads as its report. Two faces, two jobs.
                    Text(post.line)
                        .font(HudFont.ui(HudTextSize.md))
                        .lineSpacing(3)
                        .lineLimit(3)
                        .foregroundStyle(ScoutInk.body)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // The study's action row carried real CTAs (Review PR,
                    // Answer, Retry). None of them are wired yet, and the whole
                    // row already taps through, so two dead words per post are
                    // not worth the height. It comes back with the first CTA
                    // that does something.
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
        .buttonStyle(V3FeedRowPress(motionEnabled: !reduceMotion))
        .disabled(post.conversationId == nil)
        // The row's tap is the one real gesture — it opens this post's own
        // thread. No per-action affordance claims otherwise.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(post.state.label), \(post.agent), \(meta): \(post.line)")
        .accessibilityHint(post.conversationId != nil ? "Opens the thread" : "")
    }
}
