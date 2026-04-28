// ScoutBottomBar — Persistent toolbar at the bottom of every surface.
//
// Two modes:
// - Chrome mode (non-session): back + hero home/grid + overflow
// - Composer mode (session detail): ComposerView with compact home button left
//
// The center home button carries an integrated connection indicator:
// hidden when healthy, amber when degraded, red when disconnected.

import SwiftUI

struct ScoutBottomBar: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(ConnectionManager.self) private var connection
    @Environment(InboxStore.self) private var inbox
    @Environment(SessionStore.self) private var store

    @State private var showingDiscovery = false
    @State private var showingSavedSessions = false

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
        .sheet(isPresented: $showingDiscovery) {
            SessionDiscoveryView(onResumed: { sessionId in
                showingDiscovery = false
                router.push(.sessionDetail(sessionId: sessionId))
            })
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingSavedSessions) {
            SessionHistoryView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Chrome Mode

    private var chromeMode: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                backButton
                    .frame(width: ActionTrayMetrics.sideButtonSize, height: ActionTrayMetrics.sideButtonSize)

                Spacer()

                heroHomeButton

                Spacer()

                overflowMenu
                    .frame(width: ActionTrayMetrics.sideButtonSize, height: ActionTrayMetrics.sideButtonSize)
            }
            .padding(.horizontal, ActionTrayMetrics.horizontalPadding)
            .padding(.top, 6)
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
            navigationLeftButton: AnyView(compactHomeButton)
        )
    }

    // MARK: - Home Buttons

    private func navigateHome() {
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        router.popToRoot()
    }

    private var homeButtonForeground: Color {
        router.currentSurface == .home
            ? ScoutColors.textPrimary
            : ScoutColors.textSecondary
    }

    private var compactHomeButton: some View {
        Button {
            navigateHome()
        } label: {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(homeButtonForeground)
                .frame(
                    width: ActionTrayMetrics.sideButtonSize,
                    height: ActionTrayMetrics.sideButtonSize
                )
                .contentShape(Circle())
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
        .accessibilityLabel("Home")
    }

    private var heroHomeButton: some View {
        Button {
            navigateHome()
        } label: {
            ZStack {
                Circle()
                    .fill(heroHomeButtonFill)

                Circle()
                    .strokeBorder(heroHomeButtonBorder, lineWidth: 1)

                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(homeButtonForeground)
            }
            .frame(
                width: ActionTrayMetrics.centerButtonSize,
                height: ActionTrayMetrics.centerButtonSize
            )
            .contentShape(Circle())
            .overlay(alignment: .topTrailing) {
                if showsConnectionWarning {
                    Circle()
                        .fill(connectionWarningColor)
                        .frame(width: 8, height: 8)
                        .offset(x: -8, y: 8)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Home")
    }

    private var heroHomeButtonFill: Color {
        router.currentSurface == .home
            ? ScoutColors.surfaceRaisedAdaptive
            : ScoutColors.surfaceAdaptive.opacity(0.92)
    }

    private var heroHomeButtonBorder: Color {
        ScoutColors.border.opacity(router.currentSurface == .home ? 0.34 : 0.22)
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

    // MARK: - Chrome Buttons

    private var backButton: some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            router.pop()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(router.canGoBack ? ScoutColors.textPrimary : ScoutColors.textMuted.opacity(0.4))
                .frame(
                    width: ActionTrayMetrics.sideButtonSize,
                    height: ActionTrayMetrics.sideButtonSize
                )
        }
        .disabled(!router.canGoBack)
        .accessibilityLabel("Back")
    }

    private var overflowMenu: some View {
        Menu {
            Button {
                router.push(.newSession)
            } label: {
                Label("New Session", systemImage: "plus")
            }
            .disabled(!isConnected)

            Divider()

            Button {
                router.push(.inbox)
            } label: {
                Label(inbox.unreadCount > 0 ? "Inbox (\(inbox.unreadCount))" : "Inbox", systemImage: "tray.full")
            }

            Button {
                router.push(.agents)
            } label: {
                Label("Agents", systemImage: "person.3")
            }
            .disabled(!isConnected)

            Button {
                router.push(.activity)
            } label: {
                Label("Activity Feed", systemImage: "text.line.first.and.arrowtriangle.forward")
            }

            Button {
                router.push(.tail)
            } label: {
                Label("Tail", systemImage: "terminal")
            }
            .disabled(!isConnected)

            Divider()

            Button {
                showingDiscovery = true
            } label: {
                Label("Search Sessions", systemImage: "magnifyingglass")
            }
            .disabled(!isConnected)

            Button {
                showingSavedSessions = true
            } label: {
                Label("Saved Sessions", systemImage: "internaldrive")
            }

            Divider()

            Button {
                router.push(.settings)
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(
                    width: ActionTrayMetrics.sideButtonSize,
                    height: ActionTrayMetrics.sideButtonSize
                )
                .contentShape(Circle())
        }
        .accessibilityLabel("More options")
    }
}

// MARK: - Notification for composer → timeline communication

extension Notification.Name {
    static let scoutSendPrompt = Notification.Name("scoutSendPrompt")
}
