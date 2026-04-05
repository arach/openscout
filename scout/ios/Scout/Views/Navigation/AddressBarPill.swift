// AddressBarPill — Capsule showing connection state + context text.
//
// Follows the metadataChip pattern from ComposerView.
// Tappable for connection detail popover.

import SwiftUI

struct AddressBarPill: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store

    @State private var showingConnectionInfo = false

    private var connectionDotColor: Color {
        switch connection.state {
        case .connected: ScoutColors.statusActive
        case .connecting, .handshaking, .reconnecting: ScoutColors.statusStreaming
        case .disconnected, .failed: ScoutColors.statusError
        }
    }

    private var isAnimatedDot: Bool {
        switch connection.state {
        case .connecting, .handshaking, .reconnecting: true
        default: false
        }
    }

    private var contextText: String {
        switch connection.state {
        case .connected:
            return surfaceContextText
        case .connecting, .handshaking:
            return "Connecting..."
        case .reconnecting(let attempt):
            return attempt > 1 ? "Reconnecting (\(attempt))..." : "Reconnecting..."
        case .failed:
            return "Connection failed"
        case .disconnected:
            return connection.hasTrustedBridge ? "Disconnected" : "Not paired"
        }
    }

    private var surfaceContextText: String {
        switch router.currentSurface {
        case .home:
            let count = store.summaries.filter { !$0.isCachedOnly }.count
            return count == 0 ? "Scout" : "\(count) session\(count == 1 ? "" : "s")"
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
        Button {
            showingConnectionInfo = true
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(connectionDotColor)
                    .frame(width: 7, height: 7)
                    .shadow(color: isAnimatedDot ? connectionDotColor.opacity(0.6) : .clear,
                            radius: isAnimatedDot ? 4 : 0)

                Text(contextText)
                    .font(ScoutTypography.caption(13, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showingConnectionInfo) {
            connectionInfoPopover
                .presentationCompactAdaptation(.popover)
        }
        .accessibilityLabel("Connection: \(contextText)")
    }

    private var connectionInfoPopover: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(connectionDotColor)
                    .frame(width: 9, height: 9)
                Text(connectionLabel)
                    .font(ScoutTypography.body(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
            }

            if case .failed(let error) = connection.state {
                Text(error.scoutUserFacingMessage)
                    .font(ScoutTypography.caption(13))
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            if connection.hasTrustedBridge, connection.state != .connected {
                Button("Retry Connection") {
                    showingConnectionInfo = false
                    Task { await connection.reconnect() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(ScoutSpacing.lg)
        .frame(minWidth: 220)
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
}
