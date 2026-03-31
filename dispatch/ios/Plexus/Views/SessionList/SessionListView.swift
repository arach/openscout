// SessionListView — Home screen showing all sessions across connected bridges.
//
// Pull to refresh, empty state, "+" to create a new session,
// connection status indicator in the toolbar.

import SwiftUI

struct SessionListView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var showingNewSession = false
    @State private var showingSettings = false
    @State private var showingHistory = false
    @State private var showingDiscovery = false
    @State private var isRefreshing = false
    @State private var navigateToSession: String?

    private var sortedSummaries: [SessionSummary] {
        store.summaries.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        NavigationStack {
            Group {
                if sortedSummaries.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(PlexusColors.backgroundAdaptive)
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    connectionStatusButton
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    discoveryButton
                    historyButton
                    settingsButton
                    newSessionButton
                }
            }
            .sheet(isPresented: $showingDiscovery) {
                SessionDiscoveryView(onResumed: { sessionId in
                    showingDiscovery = false
                    navigateToSession = sessionId
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingHistory) {
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
    }

    // MARK: - Session List

    private var sessionList: some View {
        List {
            ForEach(sortedSummaries) { summary in
                NavigationLink(value: summary.sessionId) {
                    SessionRowView(summary: summary)
                }
                .listRowBackground(PlexusColors.backgroundAdaptive)
                .listRowSeparatorTint(PlexusColors.divider)
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
        VStack(spacing: PlexusSpacing.xl) {
            Spacer()

            VStack(spacing: PlexusSpacing.lg) {
                ZStack {
                    Circle()
                        .fill(PlexusColors.accent.opacity(0.08))
                        .frame(width: 80, height: 80)

                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(PlexusColors.accent.opacity(0.6))
                }

                VStack(spacing: PlexusSpacing.sm) {
                    Text("No active sessions")
                        .font(PlexusTypography.body(20, weight: .semibold))
                        .foregroundStyle(PlexusColors.textPrimary)

                    if isConnected {
                        Text("Create a session to start working with an AI agent.")
                            .font(PlexusTypography.body(15))
                            .foregroundStyle(PlexusColors.textSecondary)
                            .multilineTextAlignment(.center)
                    } else {
                        Text("Connect to a bridge to see your sessions.")
                            .font(PlexusTypography.body(15))
                            .foregroundStyle(PlexusColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
            }

            if isConnected {
                Button {
                    showingNewSession = true
                } label: {
                    HStack(spacing: PlexusSpacing.sm) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .semibold))
                        Text("New Session")
                            .font(PlexusTypography.body(15, weight: .semibold))
                    }
                    .padding(.horizontal, PlexusSpacing.xl)
                    .padding(.vertical, PlexusSpacing.md)
                    .background(PlexusColors.accent)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                }
            }

            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }

    // MARK: - Connection Status

    private var connectionStatusButton: some View {
        HStack(spacing: PlexusSpacing.xs) {
            connectionDot
            Text(connectionLabel)
                .font(PlexusTypography.caption(12, weight: .medium))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connection: \(connectionLabel)")
    }

    @ViewBuilder
    private var connectionDot: some View {
        switch connection.state {
        case .connected:
            Circle()
                .fill(PlexusColors.statusActive)
                .frame(width: 7, height: 7)
        case .connecting, .handshaking, .reconnecting:
            ProgressView()
                .controlSize(.mini)
        case .disconnected:
            Circle()
                .fill(PlexusColors.statusIdle)
                .frame(width: 7, height: 7)
        case .failed:
            Circle()
                .fill(PlexusColors.statusError)
                .frame(width: 7, height: 7)
        }
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

    // MARK: - Discovery

    private var discoveryButton: some View {
        Button {
            showingDiscovery = true
        } label: {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 16))
                .foregroundStyle(isConnected ? PlexusColors.accent : PlexusColors.textMuted)
        }
        .disabled(!isConnected)
        .accessibilityLabel("Browse past sessions")
    }

    // MARK: - History

    private var historyButton: some View {
        Button {
            showingHistory = true
        } label: {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 16))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .accessibilityLabel("Session history")
    }

    // MARK: - Settings

    private var settingsButton: some View {
        Button {
            showingSettings = true
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 17))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .accessibilityLabel("Settings")
    }

    // MARK: - New Session

    private var newSessionButton: some View {
        Button {
            showingNewSession = true
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(isConnected ? PlexusColors.accent : PlexusColors.textMuted.opacity(0.4))
                .symbolRenderingMode(.hierarchical)
        }
        .disabled(!isConnected)
        .accessibilityLabel("New session")
        .accessibilityHint(isConnected ? "Create a new AI agent session" : "Connect to a bridge first")
    }

    // MARK: - Refresh

    private func refreshSessions() async {
        isRefreshing = true
        do {
            _ = try await connection.bridgeStatus()
        } catch {
            // Silently handle -- the UI reflects connection state automatically
        }
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
        ("openai", "OpenAI", "brain"),
        ("anthropic", "Anthropic", "sparkles"),
        ("groq", "Groq", "bolt.fill"),
        ("together", "Together", "square.stack.3d.up"),
        ("lm-studio", "LM Studio", "desktopcomputer"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Session name", text: $sessionName)
                        .font(PlexusTypography.body())
                } header: {
                    Text("Name")
                        .font(PlexusTypography.caption(12, weight: .medium))
                }

                Section {
                    ForEach(adapters, id: \.id) { adapter in
                        Button {
                            selectedAdapter = adapter.id
                        } label: {
                            HStack(spacing: PlexusSpacing.md) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous)
                                        .fill(selectedAdapter == adapter.id
                                              ? PlexusColors.accent.opacity(0.15)
                                              : PlexusColors.surfaceAdaptive)
                                        .frame(width: 36, height: 36)

                                    Image(systemName: adapter.icon)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(
                                            selectedAdapter == adapter.id
                                            ? PlexusColors.accent
                                            : PlexusColors.textSecondary
                                        )
                                }

                                Text(adapter.name)
                                    .font(PlexusTypography.body(15, weight: .medium))
                                    .foregroundStyle(PlexusColors.textPrimary)

                                Spacer()

                                if selectedAdapter == adapter.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18))
                                        .foregroundStyle(PlexusColors.accent)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Adapter")
                        .font(PlexusTypography.caption(12, weight: .medium))
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
