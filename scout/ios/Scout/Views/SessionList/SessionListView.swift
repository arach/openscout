// SessionListView — Home screen showing all sessions across connected bridges.
//
// Pull to refresh, empty state, "+" to create a new session,
// connection status indicator in the toolbar.

import SwiftUI

private enum SessionSortOrder: String, CaseIterable, Identifiable {
    case recent
    case oldest
    case name

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recent: "Recent"
        case .oldest: "Oldest"
        case .name: "Name"
        }
    }
}

struct SessionListView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var showingNewSession = false
    @State private var showingSettings = false
    @State private var showingSavedSessions = false
    @State private var showingSearch = false
    @State private var isRefreshing = false
    @State private var navigateToSession: String?
    @State private var sortOrder: SessionSortOrder = .recent

    private var visibleSummaries: [SessionSummary] {
        let liveSummaries = store.summaries.filter { !$0.isCachedOnly }
        switch sortOrder {
        case .recent:
            return liveSummaries.sorted { $0.lastActivityAt > $1.lastActivityAt }
        case .oldest:
            return liveSummaries.sorted { $0.lastActivityAt < $1.lastActivityAt }
        case .name:
            return liveSummaries.sorted {
                let lhs = $0.name.localizedLowercase
                let rhs = $1.name.localizedLowercase
                if lhs == rhs {
                    return $0.lastActivityAt > $1.lastActivityAt
                }
                return lhs < rhs
            }
        }
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var connectionBannerText: String? {
        switch connection.state {
        case .connected:
            return nil
        case .connecting, .handshaking:
            return "Connecting to Scout on your Mac…"
        case .reconnecting:
            return "Reconnecting to Scout on your Mac…"
        case .failed:
            return "Scout on your Mac is unavailable right now."
        case .disconnected:
            return connection.hasTrustedBridge ? "Scout on your Mac is unavailable right now." : nil
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let connectionBannerText {
                    connectionBanner(text: connectionBannerText)
                }

                Group {
                    if visibleSummaries.isEmpty {
                        emptyState
                    } else {
                        sessionList
                    }
                }
            }
            .background(DispatchColors.backgroundAdaptive)
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    overflowMenu
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    searchButton
                    sortButton
                    newSessionButton
                }
            }
            .sheet(isPresented: $showingSearch) {
                SessionDiscoveryView(onResumed: { sessionId in
                    showingSearch = false
                    navigateToSession = sessionId
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingSavedSessions) {
                SessionHistoryView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .environment(connection)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingNewSession) {
                WorkspaceBrowserView { sessionId in
                    // Auto-navigate to the newly created session
                    navigateToSession = sessionId
                }
            }
            .navigationDestination(item: $navigateToSession) { sessionId in
                TimelineView(sessionId: sessionId)
            }
        }
        .task {
            if !isConnected && store.summaries.isEmpty {
                await refreshSessions()
            }
        }
        .task(id: isConnected) {
            guard isConnected else { return }
            await refreshSessions()
        }
    }

    // MARK: - Session List

    private var sessionList: some View {
        List {
            ForEach(visibleSummaries) { summary in
                NavigationLink(value: summary.sessionId) {
                    SessionRowView(summary: summary)
                }
                .listRowBackground(DispatchColors.backgroundAdaptive)
                .listRowSeparatorTint(DispatchColors.divider)
            }
        }
        .listStyle(.plain)
        .refreshable {
            await refreshSessions()
        }
        .navigationDestination(for: String.self) { sessionId in
            TimelineView(sessionId: sessionId)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: DispatchSpacing.xl) {
            Spacer()

            VStack(spacing: DispatchSpacing.lg) {
                ZStack {
                    Circle()
                        .fill(DispatchColors.accent.opacity(0.08))
                        .frame(width: 80, height: 80)

                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(DispatchColors.accent.opacity(0.6))
                }

                VStack(spacing: DispatchSpacing.sm) {
                    Text("No sessions")
                        .font(DispatchTypography.body(20, weight: .semibold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    if isConnected {
                        Text("Start a session or search older work.")
                            .font(DispatchTypography.body(15))
                            .foregroundStyle(DispatchColors.textSecondary)
                            .multilineTextAlignment(.center)
                    } else {
                        Text("Connect to a bridge to see your sessions.")
                            .font(DispatchTypography.body(15))
                            .foregroundStyle(DispatchColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
            }

            if isConnected {
                HStack(spacing: DispatchSpacing.md) {
                    Button {
                        showingSearch = true
                    } label: {
                        HStack(spacing: DispatchSpacing.sm) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 14, weight: .semibold))
                            Text("Search")
                                .font(DispatchTypography.body(15, weight: .semibold))
                        }
                        .padding(.horizontal, DispatchSpacing.xl)
                        .padding(.vertical, DispatchSpacing.md)
                        .background(DispatchColors.surfaceRaisedAdaptive)
                        .foregroundStyle(DispatchColors.textPrimary)
                        .clipShape(Capsule())
                    }

                    Button {
                        showingNewSession = true
                    } label: {
                        HStack(spacing: DispatchSpacing.sm) {
                            Image(systemName: "plus")
                                .font(.system(size: 14, weight: .semibold))
                            Text("New Session")
                                .font(DispatchTypography.body(15, weight: .semibold))
                        }
                        .padding(.horizontal, DispatchSpacing.xl)
                        .padding(.vertical, DispatchSpacing.md)
                        .background(DispatchColors.accent)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                    }
                }
            }

            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    private func connectionBanner(text: String) -> some View {
        HStack(spacing: DispatchSpacing.sm) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 13, weight: .semibold))
            Text(text)
                .font(DispatchTypography.caption(12, weight: .medium))
            Spacer()
            if connection.hasTrustedBridge {
                Button("Retry") {
                    Task { await connection.reconnect() }
                }
                .font(DispatchTypography.caption(12, weight: .bold))
            }
        }
        .padding(.horizontal, DispatchSpacing.lg)
        .padding(.vertical, DispatchSpacing.sm)
        .background(DispatchColors.statusError.opacity(0.12))
        .foregroundStyle(DispatchColors.statusError)
    }

    private var connectionLabel: String {
        switch connection.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .handshaking: "Handshaking"
        case .reconnecting: "Reconnecting"
        case .disconnected: "Disconnected"
        case .failed: "Connection Failed"
        }
    }

    private var connectionSymbol: String {
        switch connection.state {
        case .connected: "dot.radiowaves.left.and.right"
        case .connecting, .handshaking, .reconnecting: "arrow.triangle.2.circlepath"
        case .disconnected: "wifi.slash"
        case .failed: "exclamationmark.triangle"
        }
    }

    private var overflowMenu: some View {
        Menu {
            Button {
                showingSavedSessions = true
            } label: {
                Label("Saved Sessions", systemImage: "internaldrive")
            }

            Button {
                showingSettings = true
            } label: {
                Label("Settings", systemImage: "gearshape")
            }

            Divider()

            Label(connectionLabel, systemImage: connectionSymbol)
        } label: {
            Image(systemName: "line.3.horizontal.circle")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)
        }
        .accessibilityLabel("More")
    }

    private var searchButton: some View {
        Button {
            showingSearch = true
        } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isConnected ? DispatchColors.textPrimary : DispatchColors.textMuted)
        }
        .disabled(!isConnected)
        .accessibilityLabel("Search sessions")
    }

    private var sortButton: some View {
        Menu {
            ForEach(SessionSortOrder.allCases) { order in
                Button {
                    sortOrder = order
                } label: {
                    if sortOrder == order {
                        Label(order.label, systemImage: "checkmark")
                    } else {
                        Text(order.label)
                    }
                }
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down.circle")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)
        }
        .accessibilityLabel("Sort sessions")
    }

    // MARK: - New Session

    private var newSessionButton: some View {
        Button {
            showingNewSession = true
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(isConnected ? DispatchColors.accent : DispatchColors.textMuted.opacity(0.4))
                .symbolRenderingMode(.hierarchical)
        }
        .disabled(!isConnected)
        .accessibilityLabel("New session")
        .accessibilityHint(isConnected ? "Create a new AI agent session" : "Connect to a bridge first")
    }

    // MARK: - Refresh

    private func refreshSessions() async {
        isRefreshing = true
        await connection.refreshRelaySessions()
        isRefreshing = false
    }
}

// MARK: - New Session Sheet

struct NewSessionSheet: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var sessionName = ""
    @State private var selectedAdapter = "claude-code"

    private let adapters: [(id: String, name: String, icon: String)] = [
        ("claude-code", "Claude Code", "terminal"),
        ("codex", "Codex", "brain"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Session name", text: $sessionName)
                        .font(DispatchTypography.body())
                } header: {
                    Text("Name")
                        .font(DispatchTypography.caption(12, weight: .medium))
                }

                Section {
                    ForEach(adapters, id: \.id) { adapter in
                        Button {
                            selectedAdapter = adapter.id
                        } label: {
                            HStack(spacing: DispatchSpacing.md) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous)
                                        .fill(selectedAdapter == adapter.id
                                              ? DispatchColors.accent.opacity(0.15)
                                              : DispatchColors.surfaceAdaptive)
                                        .frame(width: 36, height: 36)

                                    Image(systemName: adapter.icon)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(
                                            selectedAdapter == adapter.id
                                            ? DispatchColors.accent
                                            : DispatchColors.textSecondary
                                        )
                                }

                                Text(adapter.name)
                                    .font(DispatchTypography.body(15, weight: .medium))
                                    .foregroundStyle(DispatchColors.textPrimary)

                                Spacer()

                                if selectedAdapter == adapter.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18))
                                        .foregroundStyle(DispatchColors.accent)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Adapter")
                        .font(DispatchTypography.caption(12, weight: .medium))
                }
            }
            .navigationTitle("New Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let name = sessionName.isEmpty ? nil : sessionName
                        Task {
                            _ = try? await connection.createSession(
                                adapterType: selectedAdapter,
                                name: name
                            )
                        }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Preview

#Preview {
    SessionListView()
        .environment(SessionStore.preview)
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}

extension String {
    var searchTokens: [String] {
        trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
            .filter { !$0.isEmpty }
    }
}
