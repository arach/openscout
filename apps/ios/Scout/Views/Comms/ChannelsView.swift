import SwiftUI

// MARK: - Comms data model
//
// These mirror the shape of MobileInboxItem (id, sessionName, createdAt) so they
// can be rebased onto the wire model once the broker exposes /comms endpoints.
// Until then they live alongside the views and seed in-memory.

enum CommsPeerKind: String, Sendable {
    case agent
    case person
}

struct CommsPeer: Identifiable, Hashable, Sendable {
    let id: String
    let displayName: String
    let kind: CommsPeerKind
    let isOnline: Bool

    var avatarInitial: String {
        guard let first = displayName.first else { return "?" }
        return String(first).uppercased()
    }
}

enum MessageDeliveryState: String, Sendable {
    case sending
    case sent
    case seen
    case replied
    case failed
}

struct CommsMessage: Identifiable, Sendable {
    let id: String
    let senderId: String
    let senderName: String
    let body: String
    let createdAt: Date
    let deliveryState: MessageDeliveryState
    let isOutbound: Bool
    let replyCount: Int
    let threadId: String?
}

struct CommsConversation: Identifiable, Sendable {
    enum Surface: Sendable {
        case dm(peer: CommsPeer)
        case channel(name: String, memberCount: Int)
    }

    let id: String
    let surface: Surface
    let lastMessageSnippet: String
    let lastMessageAt: Date
    let unreadCount: Int
}

// MARK: - ChannelsView

struct ChannelsView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var directMessages: [CommsConversation] = []
    @State private var channels: [CommsConversation] = []
    @State private var query: String = ""
    @State private var searchSessions: [MobileSessionSummary] = []
    @State private var searchAgents: [MobileAgentSummary] = []
    @State private var isSearching = false

    private var hasAnyConversations: Bool {
        !directMessages.isEmpty || !channels.isEmpty
    }

    private var isConnected: Bool { connection.state == .connected }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                heroSection
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                searchBar
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.md)

                if !query.isEmpty {
                    searchResults
                } else if !hasAnyConversations {
                    emptyState
                        .padding(.top, 48)
                        .padding(.horizontal, ScoutSpacing.xxl)
                } else {
                    if !directMessages.isEmpty {
                        sectionHeader(title: "Direct Messages", count: directMessages.count, tint: ScoutColors.ledGreen)
                        ForEach(Array(directMessages.enumerated()), id: \.element.id) { index, convo in
                            dmRow(convo)
                            if index < directMessages.count - 1 { rowDivider }
                        }
                    }

                    if !channels.isEmpty {
                        sectionHeader(title: "Channels", count: channels.count, tint: ScoutColors.ledAmber)
                        ForEach(Array(channels.enumerated()), id: \.element.id) { index, convo in
                            channelRow(convo)
                            if index < channels.count - 1 { rowDivider }
                        }
                    }
                }

                Color.clear.frame(height: 100)
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .onChange(of: query) { _, q in
            Task { await runSearch(q) }
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            TextField("Sessions, channels, agents...", text: $query)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, ScoutSpacing.md)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
    }

    // MARK: - Search Results

    private var searchResults: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isSearching {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xxl)
            } else if searchSessions.isEmpty && searchAgents.isEmpty {
                Text("No results for \"\(query)\"")
                    .font(ScoutTypography.body(13))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xxl)
                    .padding(.horizontal, ScoutSpacing.lg)
            } else {
                if !searchAgents.isEmpty {
                    sectionHeader(title: "Agents", count: searchAgents.count, tint: ScoutColors.accent)
                    ForEach(Array(searchAgents.enumerated()), id: \.element.id) { index, agent in
                        agentSearchRow(agent)
                        if index < searchAgents.count - 1 { rowDivider }
                    }
                }

                if !searchSessions.isEmpty {
                    sectionHeader(title: "Sessions", count: searchSessions.count, tint: ScoutColors.ledAmber)
                    ForEach(Array(searchSessions.enumerated()), id: \.element.id) { index, session in
                        sessionSearchRow(session)
                        if index < searchSessions.count - 1 { rowDivider }
                    }
                }
            }
        }
    }

    private func agentSearchRow(_ agent: MobileAgentSummary) -> some View {
        Button {
            router.push(.agentDetail(agentId: agent.id))
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                        .fill(ScoutColors.accent.opacity(0.12))
                        .frame(width: 32, height: 32)
                    Text(String(agent.title.prefix(1)).uppercased())
                        .font(ScoutTypography.code(13, weight: .semibold))
                        .foregroundStyle(ScoutColors.accent)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.title)
                        .font(ScoutTypography.body(14, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)
                    Text("agent · \(agent.statusLabel)")
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.sm)
            .padding(.horizontal, ScoutSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sessionSearchRow(_ session: MobileSessionSummary) -> some View {
        Button {
            router.push(.sessionDetail(sessionId: session.id))
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                        .fill(ScoutColors.ledAmber.opacity(0.12))
                        .frame(width: 32, height: 32)
                    Image(systemName: "bubble.left")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ScoutColors.ledAmber)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.title)
                        .font(ScoutTypography.body(14, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)
                    if let preview = session.preview?.trimmingCharacters(in: .whitespacesAndNewlines), !preview.isEmpty {
                        Text(preview)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    } else if let agentName = session.agentName {
                        Text(agentName)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.sm)
            .padding(.horizontal, ScoutSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Search

    private func runSearch(_ q: String) async {
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isConnected else {
            searchSessions = []
            searchAgents = []
            isSearching = false
            return
        }
        isSearching = true
        async let sessionsTask = (try? await connection.listMobileSessions(query: trimmed, limit: 20)) ?? []
        async let agentsTask = (try? await connection.listMobileAgents(query: trimmed, limit: 10)) ?? []
        let (sessions, agents) = await (sessionsTask, agentsTask)
        // Discard stale results if query changed while we were fetching.
        guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else { return }
        searchSessions = sessions
        searchAgents = agents
        isSearching = false
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
                Text("Mesh")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                Text("/")
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)

                Text("Comms")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)

                Spacer()

                if totalUnread > 0 {
                    HStack(spacing: ScoutSpacing.xs) {
                        PulseIndicator()
                        Text("\(totalUnread) unread")
                            .font(ScoutTypography.code(10, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                    }
                }
            }

            Text("Conversations")
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            Text(heroSubtitle)
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(2)
        }
    }

    private var totalUnread: Int {
        directMessages.reduce(0) { $0 + $1.unreadCount }
            + channels.reduce(0) { $0 + $1.unreadCount }
    }

    private var heroSubtitle: String {
        if !hasAnyConversations {
            return "DM an agent or join a channel to start talking."
        }
        let dms = directMessages.count
        let chs = channels.count
        return "\(dms) direct \(dms == 1 ? "thread" : "threads"), \(chs) shared \(chs == 1 ? "channel" : "channels")."
    }

    private func sectionHeader(title: String, count: Int, tint: Color) -> some View {
        HStack(spacing: ScoutSpacing.sm) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)

            Text(title.uppercased())
                .font(ScoutTypography.code(10, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Spacer()

            Text("\(count)")
                .font(ScoutTypography.code(10))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, ScoutSpacing.xl)
        .padding(.bottom, ScoutSpacing.xs)
    }

    // MARK: - DM row

    private func dmRow(_ convo: CommsConversation) -> some View {
        guard case .dm(let peer) = convo.surface else {
            return AnyView(EmptyView())
        }
        return AnyView(
            Button {
                // TODO: requires .channel/.dm surfaces in ScoutRouter
                router.push(.dm(peerId: peer.id))
            } label: {
                HStack(alignment: .top, spacing: ScoutSpacing.md) {
                    avatar(for: peer)

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: ScoutSpacing.sm) {
                            Text(peer.displayName)
                                .font(ScoutTypography.code(13, weight: .medium))
                                .foregroundStyle(ScoutColors.textPrimary)
                                .lineLimit(1)

                            if peer.kind == .agent {
                                Text("agent")
                                    .font(ScoutTypography.code(9, weight: .medium))
                                    .foregroundStyle(ScoutColors.textMuted)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(
                                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                                            .fill(ScoutColors.surfaceAdaptive)
                                    )
                            }
                        }

                        Text(convo.lastMessageSnippet)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }

                    Spacer(minLength: ScoutSpacing.sm)

                    rowMeta(unread: convo.unreadCount, timestamp: convo.lastMessageAt)
                }
                .padding(.vertical, ScoutSpacing.md)
                .padding(.horizontal, ScoutSpacing.lg)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        )
    }

    // MARK: - Channel row

    private func channelRow(_ convo: CommsConversation) -> some View {
        guard case .channel(let name, let memberCount) = convo.surface else {
            return AnyView(EmptyView())
        }
        return AnyView(
            Button {
                // TODO: requires .channel/.dm surfaces in ScoutRouter
                router.push(.channel(id: convo.id))
            } label: {
                HStack(alignment: .top, spacing: ScoutSpacing.md) {
                    Text("#")
                        .font(ScoutTypography.code(15, weight: .bold))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .frame(width: 28, height: 28, alignment: .center)
                        .background(
                            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                                .fill(ScoutColors.surfaceRaisedAdaptive)
                        )

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: ScoutSpacing.sm) {
                            Text(name)
                                .font(ScoutTypography.code(13, weight: .medium))
                                .foregroundStyle(ScoutColors.textPrimary)
                                .lineLimit(1)

                            Text("\(memberCount) \(memberCount == 1 ? "member" : "members")")
                                .font(ScoutTypography.code(10))
                                .foregroundStyle(ScoutColors.textMuted)
                        }

                        Text(convo.lastMessageSnippet)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }

                    Spacer(minLength: ScoutSpacing.sm)

                    rowMeta(unread: convo.unreadCount, timestamp: convo.lastMessageAt)
                }
                .padding(.vertical, ScoutSpacing.md)
                .padding(.horizontal, ScoutSpacing.lg)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        )
    }

    // MARK: - Shared row pieces

    private func avatar(for peer: CommsPeer) -> some View {
        ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .fill(ScoutColors.surfaceRaisedAdaptive)
                .frame(width: 28, height: 28)
                .overlay(
                    Text(peer.avatarInitial)
                        .font(ScoutTypography.code(12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                )

            // Presence is meaningful for agents (working/available/offline maps to LEDs);
            // for people it tracks app-foreground.
            Circle()
                .fill(peer.isOnline ? ScoutColors.ledGreen : ScoutColors.textMuted)
                .frame(width: 7, height: 7)
                .overlay(
                    Circle()
                        .stroke(ScoutColors.backgroundAdaptive, lineWidth: 1.5)
                )
                .offset(x: 2, y: 2)
        }
    }

    private func rowMeta(unread: Int, timestamp: Date) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(RelativeTime.string(from: timestamp))
                .font(ScoutTypography.code(9))
                .foregroundStyle(ScoutColors.textMuted)

            if unread > 0 {
                Text("\(unread)")
                    .font(ScoutTypography.code(9, weight: .bold))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule(style: .continuous)
                            .fill(ScoutColors.accent.opacity(0.22))
                    )
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
        }
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(ScoutColors.divider)
            .frame(height: 0.5)
            .padding(.leading, ScoutSpacing.lg + 28 + ScoutSpacing.md)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.md) {
            Text("NO CONVERSATIONS")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text("DM an agent from Fleet, or join a shared channel to coordinate with the team.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Seed data

enum CommsSeed {
    static let peers: [CommsPeer] = [
        CommsPeer(id: "agent-archie", displayName: "Archie", kind: .agent, isOnline: true),
        CommsPeer(id: "agent-hetz", displayName: "Hetz", kind: .agent, isOnline: true),
        CommsPeer(id: "agent-codex", displayName: "Codex", kind: .agent, isOnline: false),
        CommsPeer(id: "person-morgan", displayName: "Morgan", kind: .person, isOnline: true),
    ]

    static let directMessages: [CommsConversation] = [
        CommsConversation(
            id: "dm-archie",
            surface: .dm(peer: peers[0]),
            lastMessageSnippet: "Pushed the auth refactor to the worktree.",
            lastMessageAt: Date().addingTimeInterval(-90),
            unreadCount: 2
        ),
        CommsConversation(
            id: "dm-hetz",
            surface: .dm(peer: peers[1]),
            lastMessageSnippet: "GPU job queued — 4m ETA.",
            lastMessageAt: Date().addingTimeInterval(-720),
            unreadCount: 0
        ),
        CommsConversation(
            id: "dm-morgan",
            surface: .dm(peer: peers[3]),
            lastMessageSnippet: "Will review the PR after standup.",
            lastMessageAt: Date().addingTimeInterval(-3_600),
            unreadCount: 0
        ),
        CommsConversation(
            id: "dm-codex",
            surface: .dm(peer: peers[2]),
            lastMessageSnippet: "Offline — last seen 2h ago.",
            lastMessageAt: Date().addingTimeInterval(-7_200),
            unreadCount: 0
        ),
    ]

    static let channels: [CommsConversation] = [
        CommsConversation(
            id: "channel-team",
            surface: .channel(name: "team", memberCount: 6),
            lastMessageSnippet: "@archie can you take the auth ticket?",
            lastMessageAt: Date().addingTimeInterval(-300),
            unreadCount: 3
        ),
        CommsConversation(
            id: "channel-deploys",
            surface: .channel(name: "deploys", memberCount: 4),
            lastMessageSnippet: "scout-broker v0.42.1 promoted to prod.",
            lastMessageAt: Date().addingTimeInterval(-2_400),
            unreadCount: 0
        ),
        CommsConversation(
            id: "channel-incidents",
            surface: .channel(name: "incidents", memberCount: 8),
            lastMessageSnippet: "All clear since 14:02.",
            lastMessageAt: Date().addingTimeInterval(-9_000),
            unreadCount: 0
        ),
    ]

    static func messages(forPeerId id: String) -> [CommsMessage] {
        let now = Date()
        switch id {
        case "agent-archie":
            return [
                CommsMessage(
                    id: "m1",
                    senderId: "agent-archie",
                    senderName: "Archie",
                    body: "Picked up the auth refactor ticket. Spinning up a worktree.",
                    createdAt: now.addingTimeInterval(-1_800),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: nil
                ),
                CommsMessage(
                    id: "m2",
                    senderId: "me",
                    senderName: "You",
                    body: "Thanks — keep the JWT contract stable, Morgan is mid-flight on the iOS client.",
                    createdAt: now.addingTimeInterval(-1_500),
                    deliveryState: .seen,
                    isOutbound: true,
                    replyCount: 0,
                    threadId: nil
                ),
                CommsMessage(
                    id: "m3",
                    senderId: "agent-archie",
                    senderName: "Archie",
                    body: "Ack. Limiting changes to src/auth/session.ts and the test fixtures.",
                    createdAt: now.addingTimeInterval(-1_200),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: nil
                ),
                CommsMessage(
                    id: "m4",
                    senderId: "me",
                    senderName: "You",
                    body: "How's the test suite looking?",
                    createdAt: now.addingTimeInterval(-180),
                    deliveryState: .seen,
                    isOutbound: true,
                    replyCount: 0,
                    threadId: nil
                ),
                CommsMessage(
                    id: "m5",
                    senderId: "me",
                    senderName: "You",
                    body: "And did the lint pass?",
                    createdAt: now.addingTimeInterval(-90),
                    deliveryState: .sent,
                    isOutbound: true,
                    replyCount: 0,
                    threadId: nil
                ),
            ]
        case "agent-hetz":
            return [
                CommsMessage(
                    id: "h1",
                    senderId: "agent-hetz",
                    senderName: "Hetz",
                    body: "GPU job 4f2a queued behind 2 others. ETA ~4 minutes.",
                    createdAt: now.addingTimeInterval(-720),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: nil
                ),
            ]
        default:
            return []
        }
    }

    static func peer(forId id: String) -> CommsPeer {
        peers.first(where: { $0.id == id })
            ?? CommsPeer(id: id, displayName: id, kind: .agent, isOnline: false)
    }

    static func channel(forId id: String) -> (name: String, memberCount: Int) {
        if let convo = channels.first(where: { $0.id == id }),
           case .channel(let name, let memberCount) = convo.surface {
            return (name, memberCount)
        }
        return (id, 0)
    }

    static func channelMessages(forId id: String) -> [CommsMessage] {
        let now = Date()
        switch id {
        case "channel-team":
            return [
                CommsMessage(
                    id: "t1",
                    senderId: "person-morgan",
                    senderName: "Morgan",
                    body: "Auth refactor PR is up — needs a second pair of eyes.",
                    createdAt: now.addingTimeInterval(-2_700),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 4,
                    threadId: "thread-auth-refactor"
                ),
                CommsMessage(
                    id: "t2",
                    senderId: "agent-archie",
                    senderName: "Archie",
                    body: "Reviewed. Two nits on naming, otherwise green.",
                    createdAt: now.addingTimeInterval(-1_800),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: nil
                ),
                CommsMessage(
                    id: "t3",
                    senderId: "me",
                    senderName: "You",
                    body: "@archie can you take the auth ticket through to deploy?",
                    createdAt: now.addingTimeInterval(-300),
                    deliveryState: .sent,
                    isOutbound: true,
                    replyCount: 0,
                    threadId: nil
                ),
            ]
        case "channel-deploys":
            return [
                CommsMessage(
                    id: "d1",
                    senderId: "agent-archie",
                    senderName: "Archie",
                    body: "scout-broker v0.42.1 promoted to prod.",
                    createdAt: now.addingTimeInterval(-2_400),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 1,
                    threadId: "thread-deploy-042"
                ),
            ]
        default:
            return []
        }
    }

    static func threadReplies(forThreadId id: String) -> [CommsMessage] {
        let now = Date()
        switch id {
        case "thread-auth-refactor":
            return [
                CommsMessage(
                    id: "tr1",
                    senderId: "agent-archie",
                    senderName: "Archie",
                    body: "Diff is small — JWT parsing was the load-bearing change.",
                    createdAt: now.addingTimeInterval(-2_500),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: "thread-auth-refactor"
                ),
                CommsMessage(
                    id: "tr2",
                    senderId: "person-morgan",
                    senderName: "Morgan",
                    body: "Tests cover both legacy and new token shapes?",
                    createdAt: now.addingTimeInterval(-2_300),
                    deliveryState: .seen,
                    isOutbound: false,
                    replyCount: 0,
                    threadId: "thread-auth-refactor"
                ),
            ]
        default:
            return []
        }
    }
}
