// ScoutBottomBar — Persistent bottom navigation and composer host.
//
// Non-session surfaces use a stable six-item tab bar. Session detail keeps the
// composer toolbar, with a compact Sessions button for returning to the list.

import SwiftUI

struct ScoutBottomBar: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(ConnectionManager.self) private var connection
    @Environment(InboxStore.self) private var inbox
    @Environment(SessionStore.self) private var store

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        Group {
            if router.showsComposerToolbar, let sessionId = router.activeSessionId {
                composerMode(sessionId: sessionId)
            } else {
                chromeMode
            }
        }
    }

    // MARK: - Chrome Mode

    private var chromeMode: some View {
        VStack(spacing: 0) {
            GeometryReader { proxy in
                let metrics = SurfaceDockMetrics(width: proxy.size.width)

                HStack(spacing: metrics.spacing) {
                    ForEach(BottomNavItem.allCases) { item in
                        bottomNavButton(item, metrics: metrics)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 52)
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.2))
                .frame(height: 0.5)
        }
        .background {
            Color.clear
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Composer Mode

    private func composerMode(sessionId: String) -> some View {
        let sessionState = store.sessions[sessionId]
        let session = sessionState?.session
        let isStreaming = sessionState?.currentTurnId != nil
            || sessionState?.turns.last?.status == .streaming
        let isSessionConnected = isConnected && !store.cachedOnlySessionIds.contains(sessionId)

        return ComposerView(
            sessionId: sessionId,
            projectName: session?.name,
            adapterType: session?.adapterType,
            currentModel: session?.model,
            currentBranch: session?.currentBranch,
            currentWorkspaceRoot: session?.workspaceRoot,
            isConnected: isSessionConnected,
            isStreaming: isStreaming,
            onSend: { request in
                NotificationCenter.default.post(
                    name: .scoutSendPrompt,
                    object: nil,
                    userInfo: ["sessionId": sessionId, "request": request]
                )
            },
            onInterrupt: {
                Task {
                    if let agentId = session?.agentId {
                        try? await connection.interruptAgent(agentId)
                    } else {
                        try? await connection.interruptTurn(sessionId)
                    }
                }
            },
            navigationLeftButton: AnyView(compactSessionsButton)
        )
    }

    // MARK: - Bottom Navigation

    private enum BottomNavItem: CaseIterable, Identifiable {
        case agents
        case sessions
        case tail
        case terminal
        case inbox
        case assistant
        case settings

        var id: Self { self }

        var title: String {
            switch self {
            case .agents: return "Agents"
            case .sessions: return "Sessions"
            case .tail: return "Tail"
            case .terminal: return "Terminal"
            case .inbox: return "Inbox"
            case .assistant: return "Assistant"
            case .settings: return "Settings"
            }
        }

        var systemImage: String {
            switch self {
            case .agents: return "person.3"
            case .sessions: return "square.grid.2x2"
            case .tail: return "text.line.first.and.arrowtriangle.forward"
            case .terminal: return "terminal"
            case .inbox: return "tray.full"
            case .assistant: return "sparkles"
            case .settings: return "gearshape"
            }
        }

        var destination: Surface {
            switch self {
            case .agents: return .agents
            case .sessions: return .home
            case .tail: return .tail
            case .terminal: return .terminal
            case .inbox: return .inbox
            case .assistant: return .assistant
            case .settings: return .settings
            }
        }
    }

    private struct SurfaceDockMetrics {
        let spacing: CGFloat
        let activeWidth: CGFloat
        let inactiveWidth: CGFloat
        let itemHeight: CGFloat

        init(width: CGFloat) {
            let compact = width < 360
            spacing = compact ? 2 : 4
            activeWidth = compact ? 72 : 96
            inactiveWidth = compact ? 36 : 38
            itemHeight = 50
        }
    }

    private func bottomNavButton(_ item: BottomNavItem, metrics: SurfaceDockMetrics) -> some View {
        let isSelected = isSelected(item)

        return Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            router.switchTo(item.destination)
        } label: {
            HStack(spacing: isSelected ? 6 : 0) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: item.systemImage)
                        .font(.system(size: 15, weight: isSelected ? .semibold : .medium))
                        .frame(width: 24, height: 24)

                    if item == .inbox, inbox.unreadCount > 0 {
                        Circle()
                            .fill(ScoutColors.ledAmber)
                            .frame(width: 6, height: 6)
                            .offset(x: 4, y: -1)
                    }

                    if item == .sessions, showsConnectionWarning {
                        Circle()
                            .fill(connectionWarningColor)
                            .frame(width: 6, height: 6)
                            .offset(x: 4, y: -1)
                    }

                    if item == .settings, showsConnectionWarning {
                        Circle()
                            .fill(connectionWarningColor)
                            .frame(width: 6, height: 6)
                            .offset(x: 4, y: -1)
                    }
                }

                if isSelected {
                    Text(item.title)
                        .font(ScoutTypography.code(10, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .transition(.opacity.combined(with: .move(edge: .trailing)))
                }
            }
            .foregroundStyle(navForeground(selected: isSelected))
            .frame(width: isSelected ? metrics.activeWidth : metrics.inactiveWidth)
            .frame(height: metrics.itemHeight)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(ScoutColors.surfaceRaisedAdaptive.opacity(0.78))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(ScoutColors.divider.opacity(0.5), lineWidth: 0.5)
                        }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityValue(isSelected ? "Selected" : "")
        .animation(.spring(response: 0.24, dampingFraction: 0.88), value: isSelected)
    }

    private func navForeground(selected: Bool) -> Color {
        return selected ? ScoutColors.textPrimary : ScoutColors.textSecondary
    }

    private func isSelected(_ item: BottomNavItem) -> Bool {
        switch router.currentSurface {
        case .agents, .agentDashboard, .agentDetail:
            return item == .agents
        case .home, .allSessions, .sessionDetail:
            return item == .sessions
        case .tail:
            return item == .tail
        case .terminal:
            return item == .terminal
        case .inbox:
            return item == .inbox
        case .assistant:
            return item == .assistant
        case .settings:
            return item == .settings
        default:
            return false
        }
    }

    private var compactSessionsButton: some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            router.switchTo(.home)
        } label: {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(
                    width: ActionTrayMetrics.sideButtonSize,
                    height: ActionTrayMetrics.sideButtonSize
                )
                .contentShape(Rectangle())
                .overlay(alignment: .topTrailing) {
                    if showsConnectionWarning {
                        Circle()
                            .fill(connectionWarningColor)
                            .frame(width: 6, height: 6)
                            .offset(x: -6, y: 6)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sessions")
    }

    // MARK: - Connection Indicator

    private var showsConnectionWarning: Bool {
        let displayHealth = normalizedConnectionDisplayHealth(
            state: connection.state,
            health: connection.health
        )
        if connection.state != .connected { return true }
        switch displayHealth {
        case .suspect, .degraded, .tailscaleUnavailable, .offline: return true
        case .healthy: return false
        }
    }

    private var connectionWarningColor: Color {
        let displayHealth = normalizedConnectionDisplayHealth(
            state: connection.state,
            health: connection.health
        )
        switch displayHealth {
        case .suspect, .degraded: return ScoutColors.ledAmber
        case .tailscaleUnavailable, .offline: return ScoutColors.ledRed
        default: break
        }
        switch connection.state {
        case .connecting, .handshaking, .reconnecting: return ScoutColors.ledAmber
        default: return ScoutColors.ledRed
        }
    }
}

// MARK: - Notification for composer -> timeline communication

extension Notification.Name {
    static let scoutSendPrompt = Notification.Name("scoutSendPrompt")
}
