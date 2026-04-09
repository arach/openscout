// SessionHistoryView — Browse cached sessions offline.
//
// Read-only viewer for past sessions stored on-device.
// Works without a bridge connection. Shows cached turns and blocks.

import SwiftUI

struct SessionHistoryView: View {
    @State private var cachedSessions: [SessionCache.CachedSessionInfo] = []
    @State private var selectedSessionId: String?
    @State private var searchText = ""

    private var filteredSessions: [SessionCache.CachedSessionInfo] {
        let tokens = searchText.searchTokens
        guard !tokens.isEmpty else { return cachedSessions }

        return cachedSessions.filter { info in
            tokens.allSatisfy { token in
                info.name.localizedCaseInsensitiveContains(token)
                    || info.adapterType.localizedCaseInsensitiveContains(token)
                    || AdapterIcon.displayName(for: info.adapterType).localizedCaseInsensitiveContains(token)
                    || info.id.localizedCaseInsensitiveContains(token)
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if cachedSessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle("Saved")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $selectedSessionId) { sessionId in
                CachedSessionView(sessionId: sessionId)
            }
            .searchable(text: $searchText, prompt: "Search saved sessions")
        }
        .task {
            cachedSessions = SessionCache.shared.loadIndex()
        }
    }

    private var sessionList: some View {
        List {
            if filteredSessions.isEmpty {
                Text("No cached sessions match “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .padding(.vertical, ScoutSpacing.md)
                    .listRowBackground(ScoutColors.backgroundAdaptive)
            } else {
                ForEach(filteredSessions, id: \.id) { info in
                    Button {
                        selectedSessionId = info.id
                    } label: {
                        HStack(spacing: ScoutSpacing.md) {
                            Image(systemName: AdapterIcon.systemName(for: info.adapterType))
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(ScoutColors.accent)
                                .frame(width: 32)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(info.name)
                                    .font(ScoutTypography.body(15, weight: .medium))
                                    .foregroundStyle(ScoutColors.textPrimary)
                                HStack(spacing: ScoutSpacing.sm) {
                                    Text(AdapterIcon.displayName(for: info.adapterType))
                                        .font(ScoutTypography.caption(12))
                                        .foregroundStyle(ScoutColors.textMuted)
                                    Text("\(info.turnCount) turns")
                                        .font(ScoutTypography.caption(12))
                                        .foregroundStyle(ScoutColors.textMuted)
                                    Text(RelativeTime.string(from: info.cachedAt))
                                        .font(ScoutTypography.caption(12))
                                        .foregroundStyle(ScoutColors.textMuted)
                                }
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                    }
                    .listRowBackground(ScoutColors.backgroundAdaptive)
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        let filtered = filteredSessions
                        SessionCache.shared.delete(sessionId: filtered[index].id)
                        cachedSessions.removeAll { $0.id == filtered[index].id }
                    }
                }
            }
        }
        .listStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 36))
                .foregroundStyle(ScoutColors.textMuted)
            Text("Nothing saved")
                .font(ScoutTypography.body(16, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}

// MARK: - Cached Session Viewer (read-only timeline)

struct CachedSessionView: View {
    let sessionId: String

    @Environment(ConnectionManager.self) private var connection
    @State private var state: SessionState?
    @State private var isFetchingFromBridge = false
    @State private var fetchError: String?

    private var isConnected: Bool { connection.state == .connected }

    private var turns: [Turn] {
        guard let state else { return [] }
        return state.turns.map { turnState in
            let turnStatus: TurnStatus = switch turnState.status {
            case .streaming: .streaming
            case .completed: .completed
            case .interrupted: .stopped
            case .error: .failed
            }
            let blocks = turnState.blocks.map(\.block)
            let startedAtDate = Date(timeIntervalSince1970: Double(turnState.startedAt) / 1000.0)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return Turn(
                id: turnState.id,
                sessionId: sessionId,
                status: turnStatus,
                startedAt: formatter.string(from: startedAtDate),
                endedAt: turnState.endedAt.map { formatter.string(from: Date(timeIntervalSince1970: Double($0) / 1000.0)) },
                blocks: blocks,
                turnHash: turnState.turnHash
            )
        }
    }

    var body: some View {
        Group {
            if turns.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // Source banner
                        HStack(spacing: ScoutSpacing.sm) {
                            Image(systemName: "internaldrive")
                                .font(.system(size: 12))
                            Text("Read only")
                                .font(ScoutTypography.caption(12, weight: .medium))
                        }
                        .foregroundStyle(ScoutColors.textMuted)
                        .padding(.vertical, ScoutSpacing.sm)

                        ForEach(turns) { turn in
                            TurnView(turn: turn)
                        }
                    }
                    .padding(.top, ScoutSpacing.sm)
                    .padding(.bottom, ScoutSpacing.md)
                }
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .navigationTitle(state?.session.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            state = SessionCache.shared.load(sessionId: sessionId)
            // If cache is empty but bridge is connected, try fetching live data
            if (state == nil || state?.turns.isEmpty == true), isConnected {
                await fetchFromBridge()
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: ScoutSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(ScoutColors.accent.opacity(0.08))
                        .frame(width: 72, height: 72)
                    Image(systemName: "text.document")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(ScoutColors.accent.opacity(0.5))
                }

                VStack(spacing: ScoutSpacing.sm) {
                    Text("No turns cached")
                        .font(ScoutTypography.body(17, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)

                    if let session = state?.session {
                        // Show what we know about this session
                        HStack(spacing: ScoutSpacing.md) {
                            Label(
                                AdapterIcon.displayName(for: session.adapterType),
                                systemImage: AdapterIcon.systemName(for: session.adapterType)
                            )
                            .font(ScoutTypography.caption(12, weight: .medium))
                            .foregroundStyle(ScoutColors.textSecondary)

                            Text(session.status.rawValue)
                                .font(ScoutTypography.caption(12))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                    }

                        Text("No messages yet.")
                            .font(ScoutTypography.body(14))
                            .foregroundStyle(ScoutColors.textMuted)
                            .padding(.top, ScoutSpacing.xxs)
                }

                // Fetch from bridge button
                if isConnected {
                    VStack(spacing: ScoutSpacing.sm) {
                        Button {
                            Task { await fetchFromBridge() }
                        } label: {
                            HStack(spacing: ScoutSpacing.sm) {
                                if isFetchingFromBridge {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "arrow.down.circle")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                Text(isFetchingFromBridge ? "Fetching..." : "Fetch from bridge")
                                    .font(ScoutTypography.body(14, weight: .semibold))
                            }
                            .padding(.horizontal, ScoutSpacing.xl)
                            .padding(.vertical, ScoutSpacing.md)
                            .background(ScoutColors.accent)
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                        }
                        .disabled(isFetchingFromBridge)

                        if let fetchError {
                            Text(fetchError)
                                .font(ScoutTypography.caption(12))
                                .foregroundStyle(ScoutColors.statusError)
                        }
                    }
                } else {
                    HStack(spacing: ScoutSpacing.xs) {
                        Circle()
                            .fill(ScoutColors.statusIdle)
                            .frame(width: 6, height: 6)
                        Text("Connect to fetch")
                            .font(ScoutTypography.caption(12))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                    .padding(.top, ScoutSpacing.xs)
                }
            }

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Bridge Fetch

    private func fetchFromBridge() async {
        isFetchingFromBridge = true
        fetchError = nil
        do {
            let snapshot = try await connection.getSnapshot(sessionId)
            state = snapshot
            // Update the local cache with fresh data
            if !snapshot.turns.isEmpty {
                SessionCache.shared.save(snapshot)
            }
        } catch {
            fetchError = "Could not fetch: \(error.localizedDescription)"
        }
        isFetchingFromBridge = false
    }
}
