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
            .background(DispatchColors.backgroundAdaptive)
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
                    .font(DispatchTypography.body(14))
                    .foregroundStyle(DispatchColors.textSecondary)
                    .padding(.vertical, DispatchSpacing.md)
                    .listRowBackground(DispatchColors.backgroundAdaptive)
            } else {
                ForEach(filteredSessions, id: \.id) { info in
                    Button {
                        selectedSessionId = info.id
                    } label: {
                        HStack(spacing: DispatchSpacing.md) {
                            Image(systemName: AdapterIcon.systemName(for: info.adapterType))
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(DispatchColors.accent)
                                .frame(width: 32)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(info.name)
                                    .font(DispatchTypography.body(15, weight: .medium))
                                    .foregroundStyle(DispatchColors.textPrimary)
                                HStack(spacing: DispatchSpacing.sm) {
                                    Text(AdapterIcon.displayName(for: info.adapterType))
                                        .font(DispatchTypography.caption(12))
                                        .foregroundStyle(DispatchColors.textMuted)
                                    Text("\(info.turnCount) turns")
                                        .font(DispatchTypography.caption(12))
                                        .foregroundStyle(DispatchColors.textMuted)
                                    Text(RelativeTime.string(from: info.cachedAt))
                                        .font(DispatchTypography.caption(12))
                                        .foregroundStyle(DispatchColors.textMuted)
                                }
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(DispatchColors.textMuted)
                        }
                    }
                    .listRowBackground(DispatchColors.backgroundAdaptive)
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
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 36))
                .foregroundStyle(DispatchColors.textMuted)
            Text("Nothing saved")
                .font(DispatchTypography.body(16, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
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
                        HStack(spacing: DispatchSpacing.sm) {
                            Image(systemName: "internaldrive")
                                .font(.system(size: 12))
                            Text("Read only")
                                .font(DispatchTypography.caption(12, weight: .medium))
                        }
                        .foregroundStyle(DispatchColors.textMuted)
                        .padding(.vertical, DispatchSpacing.sm)

                        ForEach(turns) { turn in
                            TurnView(turn: turn)
                        }
                    }
                    .padding(.top, DispatchSpacing.sm)
                    .padding(.bottom, DispatchSpacing.md)
                }
            }
        }
        .background(DispatchColors.backgroundAdaptive)
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

            VStack(spacing: DispatchSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(DispatchColors.accent.opacity(0.08))
                        .frame(width: 72, height: 72)
                    Image(systemName: "text.document")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(DispatchColors.accent.opacity(0.5))
                }

                VStack(spacing: DispatchSpacing.sm) {
                    Text("No turns cached")
                        .font(DispatchTypography.body(17, weight: .semibold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    if let session = state?.session {
                        // Show what we know about this session
                        HStack(spacing: DispatchSpacing.md) {
                            Label(
                                AdapterIcon.displayName(for: session.adapterType),
                                systemImage: AdapterIcon.systemName(for: session.adapterType)
                            )
                            .font(DispatchTypography.caption(12, weight: .medium))
                            .foregroundStyle(DispatchColors.textSecondary)

                            Text(session.status.rawValue)
                                .font(DispatchTypography.caption(12))
                                .foregroundStyle(DispatchColors.textMuted)
                        }
                    }

                        Text("No messages yet.")
                            .font(DispatchTypography.body(14))
                            .foregroundStyle(DispatchColors.textMuted)
                            .padding(.top, DispatchSpacing.xxs)
                }

                // Fetch from bridge button
                if isConnected {
                    VStack(spacing: DispatchSpacing.sm) {
                        Button {
                            Task { await fetchFromBridge() }
                        } label: {
                            HStack(spacing: DispatchSpacing.sm) {
                                if isFetchingFromBridge {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "arrow.down.circle")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                Text(isFetchingFromBridge ? "Fetching..." : "Fetch from bridge")
                                    .font(DispatchTypography.body(14, weight: .semibold))
                            }
                            .padding(.horizontal, DispatchSpacing.xl)
                            .padding(.vertical, DispatchSpacing.md)
                            .background(DispatchColors.accent)
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                        }
                        .disabled(isFetchingFromBridge)

                        if let fetchError {
                            Text(fetchError)
                                .font(DispatchTypography.caption(12))
                                .foregroundStyle(DispatchColors.statusError)
                        }
                    }
                } else {
                    HStack(spacing: DispatchSpacing.xs) {
                        Circle()
                            .fill(DispatchColors.statusIdle)
                            .frame(width: 6, height: 6)
                        Text("Connect to fetch")
                            .font(DispatchTypography.caption(12))
                            .foregroundStyle(DispatchColors.textMuted)
                    }
                    .padding(.top, DispatchSpacing.xs)
                }
            }

            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
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
