// Navigation elements for the persistent bottom bar and top-level status.
//
// - AddressBarPill: current section readout (center of chrome bar)
// - ConnectionLED: small color-coded dot at top-right (green/amber/red)
// - ConnectionStatusPill: legacy compact pill (retained for compatibility)
// - ConnectionStatusTrayButton: legacy tray button (retained for compatibility)

import SwiftUI

// Shared helper — maps connection state/health to a single status color.
private func connectionStatusColor(health: BridgeHealthState, state: ConnectionState) -> Color {
    let displayHealth = normalizedConnectionDisplayHealth(state: state, health: health)
    switch state {
    case .connected:
        switch displayHealth {
        case .suspect, .degraded: return ScoutColors.statusStreaming
        case .healthy, .tailscaleUnavailable, .offline: return ScoutColors.statusActive
        }
    case .connecting, .handshaking, .reconnecting: return ScoutColors.statusStreaming
    case .disconnected, .failed:
        switch displayHealth {
        case .suspect, .degraded: return ScoutColors.statusStreaming
        case .healthy, .tailscaleUnavailable, .offline: return ScoutColors.statusError
        }
    }
}

private func connectionLEDColor(health: BridgeHealthState, state: ConnectionState) -> Color {
    let displayHealth = normalizedConnectionDisplayHealth(state: state, health: health)
    switch state {
    case .connected:
        switch displayHealth {
        case .suspect, .degraded: return ScoutColors.ledAmber
        case .healthy, .tailscaleUnavailable, .offline: return ScoutColors.ledGreen
        }
    case .connecting, .handshaking, .reconnecting: return ScoutColors.ledAmber
    case .disconnected, .failed:
        switch displayHealth {
        case .suspect, .degraded: return ScoutColors.ledAmber
        case .healthy, .tailscaleUnavailable, .offline: return ScoutColors.ledRed
        }
    }
}

// MARK: - Connection LED (top-right indicator)

struct ConnectionLED: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store

    @State private var showingSheet = false

    private var color: Color {
        connectionLEDColor(health: connection.health, state: connection.state)
    }

    var body: some View {
        Button {
            showingSheet = true
        } label: {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .frame(width: 28, height: 28)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingSheet) {
            ConnectionStatusSheet()
                .environment(connection)
                .environment(store)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .accessibilityLabel("Connection: \(connection.statusDetails.shortLabel)")
    }
}

// MARK: - Transport chip (LAN / MESH / REMOTE)

/// Small pill showing how the iPhone is currently reaching the bridge:
/// `LAN` (green LED) for RFC1918 private network, `MESH` (amber LED) for
/// Tailscale CGNAT or `*.ts.net`, `REMOTE` (red LED) for anything else.
/// Renders nothing when disconnected.
struct TransportChip: View {
    @Environment(ConnectionManager.self) private var connection

    private var kind: TransportKind { connection.transportKind }

    private var ledColor: Color {
        switch kind {
        case .lan: return ScoutColors.ledGreen
        case .mesh: return ScoutColors.ledAmber
        case .remote: return ScoutColors.ledRed
        case .loopback: return ScoutColors.textMuted
        case .none: return ScoutColors.textMuted
        }
    }

    var body: some View {
        if kind == .none {
            EmptyView()
        } else {
            HStack(spacing: 5) {
                Circle()
                    .fill(ledColor)
                    .frame(width: 5, height: 5)
                Text(kind.label)
                    .font(ScoutTypography.code(9, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(ScoutColors.surfaceRaisedAdaptive)
            )
            .overlay(
                Capsule().strokeBorder(ScoutColors.border, lineWidth: 0.5)
            )
            .accessibilityLabel("Transport: \(kind.label)")
        }
    }
}

struct AddressBarPill: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store

    private var contextText: String {
        switch router.currentSurface {
        case .home:
            return "Home"
        case .inbox:
            return "Inbox"
        case .agents:
            return "Agents"
        case .sessionDetail(let sessionId):
            return store.sessions[sessionId]?.session.name ?? "Session"
        case .allSessions:
            return "All Sessions"
        case .activity:
            return "Activity"
        case .tail:
            return "Tail"
        case .newSession:
            return "New Session"
        case .agentDashboard:
            return "Agent"
        case .agentDetail:
            return "Agent"
        case .settings:
            return "Settings"
        }
    }

    var body: some View {
        Text(contextText.uppercased())
            .font(ScoutTypography.code(10, weight: .semibold))
            .foregroundStyle(ScoutColors.textSecondary)
            .lineLimit(1)
            .accessibilityLabel("Current section: \(contextText)")
    }
}

struct ConnectionStatusPill: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store

    @State private var showingConnectionSheet = false

    var body: some View {
        Button {
            showingConnectionSheet = true
        } label: {
            Text(connection.statusDetails.shortLabel.uppercased())
                .font(ScoutTypography.code(9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)
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

    var body: some View {
        Button {
            showingConnectionSheet = true
        } label: {
            Circle()
                .fill(ScoutColors.textMuted)
                .frame(width: 8, height: 8)
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
    @State private var syncStatusSessionName: String?
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
        case .healthy:
            connection.state == .connected ? "Healthy" : "Mac Reachable"
        case .suspect: "Checking"
        case .degraded: "Degraded"
        case .tailscaleUnavailable: "Tailscale Off"
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
                Text(connection.statusDetails.title)
                    .font(ScoutTypography.code(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                Spacer()
                Text(connection.statusDetails.shortLabel.uppercased())
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Text("Bridge reachability and the latest network read from your Mac.")
                .font(ScoutTypography.caption(12))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.surfaceRaisedAdaptive, in: RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
    }

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            statusRow(label: "Health", value: healthLabel)
            statusRow(label: "Paired Bridge", value: pairedBridgeLabel)
            if let host = connection.bridgeHost {
                let kind = connection.transportKind
                if kind != .none {
                    statusRow(label: "Connected Via", value: "\(kind.label) · \(host)")
                } else {
                    statusRow(label: "Bridge Host", value: host)
                }
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
                if let syncStatusSessionName {
                    statusRow(label: "Sync Session", value: syncStatusSessionName)
                }
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
        .background(ScoutColors.surfaceRaisedAdaptive, in: RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
    }

    private func narrativeCard(message: String, tone: NarrativeTone = .neutral) -> some View {
        Text(message)
            .font(ScoutTypography.code(12))
            .foregroundStyle(ScoutColors.textSecondary)
            .padding(ScoutSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                ScoutColors.surfaceRaisedAdaptive,
                in: RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
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
            syncStatusSessionName = nil
            refreshError = nil
            return
        }

        isRefreshing = true
        refreshError = nil
        defer { isRefreshing = false }

        if connection.state == .connected {
            do {
                let bridge = try await connection.bridgeStatus()
                bridgeStatus = bridge

                guard let session = bridge.sessions.max(by: { $0.lastActivityAt < $1.lastActivityAt }) else {
                    syncStatus = nil
                    syncStatusSessionName = nil
                    return
                }

                syncStatus = try await connection.syncStatus(sessionId: session.sessionId)
                syncStatusSessionName = session.name
            } catch {
                syncStatus = nil
                bridgeStatus = nil
                syncStatusSessionName = nil
                refreshError = error.scoutUserFacingMessage
            }
        } else {
            syncStatus = nil
            bridgeStatus = nil
            syncStatusSessionName = nil
        }
    }

    private enum NarrativeTone {
        case neutral
        case error
    }
}
