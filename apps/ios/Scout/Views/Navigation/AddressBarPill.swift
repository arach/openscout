// Navigation pills for the persistent bottom bar.
//
// - AddressBarPill: current section only
// - ConnectionStatusPill: compact global connection control with diagnostics
// - ConnectionStatusTrayButton: same status, sized for the action tray left slot

import SwiftUI

// Shared helper — maps connection state/health to a single status color.
private func connectionStatusColor(health: BridgeHealthState, state: ConnectionState) -> Color {
    switch health {
    case .healthy: break
    case .suspect, .degraded: return ScoutColors.statusStreaming
    case .offline: return ScoutColors.statusError
    }
    switch state {
    case .connected: return ScoutColors.statusActive
    case .connecting, .handshaking, .reconnecting: return ScoutColors.statusStreaming
    case .disconnected, .failed: return ScoutColors.statusError
    }
}

struct AddressBarPill: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store

    private var contextText: String {
        switch router.currentSurface {
        case .home:
            return "Home"
        case .agents:
            return "Agents"
        case .sessionDetail(let sessionId):
            return store.sessions[sessionId]?.session.name ?? "Session"
        case .allSessions:
            return "All Sessions"
        case .activity:
            return "Activity"
        case .newSession:
            return "New Session"
        case .settings:
            return "Settings"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(contextText)
                .font(ScoutTypography.caption(13, weight: .medium))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityLabel("Current section: \(contextText)")
    }
}

struct ConnectionStatusPill: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store

    @State private var showingConnectionSheet = false

    private var dotColor: Color {
        connectionStatusColor(health: connection.health, state: connection.state)
    }

    var body: some View {
        Button {
            showingConnectionSheet = true
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                Text(connection.statusDetails.shortLabel)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(dotColor)
                    .tracking(-0.3)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingConnectionSheet) {
            ConnectionStatusSheet()
                .environment(connection)
                .environment(store)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .accessibilityLabel("Connection status: \(connection.statusDetails.shortLabel)")
    }
}

// Action tray button — same status dot, sized to match BottomCircleButton.
struct ConnectionStatusTrayButton: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store

    @State private var showingConnectionSheet = false

    private var dotColor: Color {
        connectionStatusColor(health: connection.health, state: connection.state)
    }

    var body: some View {
        Button {
            showingConnectionSheet = true
        } label: {
            Circle()
                .fill(dotColor)
                .frame(width: 10, height: 10)
                .frame(width: 44, height: 44)
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.clear)
                        .glassEffect(.regular.interactive())
                }
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingConnectionSheet) {
            ConnectionStatusSheet()
                .environment(connection)
                .environment(store)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .accessibilityLabel("Connection: \(connection.statusDetails.shortLabel)")
    }
}

struct ConnectionStatusSheet: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var syncStatus: SyncStatusResponse?
    @State private var bridgeStatus: BridgeStatusResponse?
    @State private var isRefreshing = false
    @State private var refreshError: String?

    private let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    private var statusColor: Color {
        connectionStatusColor(health: connection.health, state: connection.state)
    }

    private var healthLabel: String {
        switch connection.health {
        case .healthy: "Healthy"
        case .suspect: "Checking"
        case .degraded: "Degraded"
        case .offline: "Offline"
        }
    }

    private var pairedBridgeLabel: String {
        if let name = connection.pairedBridgeName {
            return name
        }
        if let fingerprint = connection.pairedBridgeFingerprint {
            return String(fingerprint.prefix(12))
        }
        return connection.hasTrustedBridge ? "Trusted bridge" : "Not paired"
    }

    private var activeSessionCount: Int {
        store.summaries.filter { !$0.isCachedOnly && ($0.status == "active" || $0.status == "connecting") }.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScoutSpacing.lg) {
                    headerCard
                    overviewCard
                    if let message = connection.statusDetails.message {
                        narrativeCard(message: message)
                    }
                    if let refreshError {
                        narrativeCard(message: refreshError, tone: .error)
                    }
                    actionsRow
                }
                .padding(ScoutSpacing.lg)
            }
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle("Connection Status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await refreshDiagnostics(forceReconnect: false) }
                    } label: {
                        if isRefreshing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isRefreshing || !connection.hasTrustedBridge)
                }
            }
            .task {
                await refreshDiagnostics(forceReconnect: false)
            }
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 10, height: 10)
                Text(connection.statusDetails.title)
                    .font(ScoutTypography.body(17, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                Spacer()
                Text(connection.statusDetails.shortLabel)
                    .font(ScoutTypography.caption(12, weight: .semibold))
                    .foregroundStyle(statusColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(statusColor.opacity(0.12), in: Capsule())
            }

            Text("Glanceable app health, remote bridge reachability, and the latest network read from your Mac.")
                .font(ScoutTypography.caption(13))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.surfaceRaisedAdaptive, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            statusRow(label: "Health", value: healthLabel)
            statusRow(label: "Paired Bridge", value: pairedBridgeLabel)
            if let host = connection.bridgeHost {
                statusRow(label: "Bridge Host", value: host)
            }
            if let room = connection.relayRoomId {
                statusRow(label: "Relay Room", value: room)
            }
            statusRow(label: "Active Sessions", value: "\(activeSessionCount)")
            if let bridgeStatus {
                statusRow(label: "Remote Sessions", value: "\(bridgeStatus.sessions.count)")
            }
            if let syncStatus {
                statusRow(label: "Sync Cursor", value: "#\(syncStatus.currentSeq)")
                statusRow(label: "Synced Sessions", value: "\(syncStatus.sessionCount)")
            }
            if let lastSeen = connection.pairedBridgeLastSeen {
                statusRow(label: "Bridge Last Seen", value: relativeTime(for: lastSeen))
            }
            if let lastRPC = connection.lastSuccessfulRPCAtDate {
                statusRow(label: "Last Good RPC", value: relativeTime(for: lastRPC))
            }
            if let lastInbound = connection.lastIncomingMessageAtDate {
                statusRow(label: "Last Inbound", value: relativeTime(for: lastInbound))
            }
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.surfaceRaisedAdaptive, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func narrativeCard(message: String, tone: NarrativeTone = .neutral) -> some View {
        Text(message)
            .font(ScoutTypography.caption(13))
            .foregroundStyle(tone == .error ? ScoutColors.statusError : ScoutColors.textSecondary)
            .padding(ScoutSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                tone == .error ? ScoutColors.statusError.opacity(0.08) : ScoutColors.surfaceRaisedAdaptive,
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
    }

    private var actionsRow: some View {
        HStack(spacing: ScoutSpacing.sm) {
            if connection.statusDetails.allowsRetry || connection.hasTrustedBridge {
                Button {
                    Task { await refreshDiagnostics(forceReconnect: true) }
                } label: {
                    Text(connection.state == .connected ? "Refresh Link" : "Retry Connection")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRefreshing)
            }

            if connection.state == .connected {
                Button("Disconnect") {
                    connection.disconnect()
                    dismiss()
                }
                .buttonStyle(.bordered)
                .tint(ScoutColors.textSecondary)
            }
        }
    }

    private func statusRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            Text(label)
                .font(ScoutTypography.caption(12, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 110, alignment: .leading)
            Text(value)
                .font(ScoutTypography.caption(13))
                .foregroundStyle(ScoutColors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func relativeTime(for date: Date) -> String {
        relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    private func refreshDiagnostics(forceReconnect: Bool) async {
        if forceReconnect {
            await connection.reconnect()
        }

        guard connection.hasTrustedBridge else {
            syncStatus = nil
            bridgeStatus = nil
            refreshError = nil
            return
        }

        isRefreshing = true
        refreshError = nil
        defer { isRefreshing = false }

        if connection.state == .connected {
            do {
                async let sync = connection.syncStatus()
                async let bridge = connection.bridgeStatus()
                syncStatus = try await sync
                bridgeStatus = try await bridge
            } catch {
                syncStatus = nil
                bridgeStatus = nil
                refreshError = error.scoutUserFacingMessage
            }
        } else {
            syncStatus = nil
            bridgeStatus = nil
        }
    }

    private enum NarrativeTone {
        case neutral
        case error
    }
}
