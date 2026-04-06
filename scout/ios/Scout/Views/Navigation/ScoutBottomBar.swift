// ScoutBottomBar — Persistent Liquid Glass toolbar at the bottom of every surface.
//
// Two modes:
// - Chrome mode (non-session): status pill + centered section pill + actions
// - Composer mode (session detail): ComposerView with address bar

import SwiftUI

struct ScoutBottomBar: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(ConnectionManager.self) private var connection
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
            ZStack {
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        backButton
                            .frame(width: 44, height: 44)
                        ConnectionStatusPill()
                    }

                    Spacer()

                    HStack(spacing: 4) {
                        gridButton
                        overflowMenu
                    }
                }

                AddressBarPill()
            }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, -18)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [.white.opacity(0.12), .white.opacity(0.04), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 1)
        }
        .background {
            Color.clear
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Composer Mode

    private func composerMode(sessionId: String) -> some View {
        let session = store.sessions[sessionId]?.session
        let isStreaming = store.sessions[sessionId]?.currentTurnId != nil
        let isSessionConnected = isConnected && !store.cachedOnlySessionIds.contains(sessionId)

        return ComposerView(
            sessionId: sessionId,
            projectName: session?.name,
            adapterType: session?.adapterType,
            currentModel: session?.model,
            currentBranch: session?.currentBranch,
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
                    try? await connection.interruptTurn(sessionId)
                }
            },
            navigationLeftButton: AnyView(
                Group {
                    if isSessionConnected {
                        BottomCircleButton(icon: "square.grid.2x2", isActive: false) {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            router.push(.allSessions)
                        }
                        .accessibilityLabel("All sessions")
                    } else {
                        ConnectionStatusTrayButton()
                    }
                }
            )
        )
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
                .frame(width: 44, height: 44)
        }
        .disabled(!router.canGoBack)
        .accessibilityLabel("Back")
    }

    private var gridButton: some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            router.push(.allSessions)
        } label: {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(ScoutColors.textPrimary)
                .frame(width: 40, height: 40)
        }
        .accessibilityLabel("All sessions")
    }

    private var overflowMenu: some View {
        Menu {
            Button {
                router.push(.activity)
            } label: {
                Label("Activity Feed", systemImage: "text.line.first.and.arrowtriangle.forward")
            }

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
                router.popToRoot()
            } label: {
                Label("Home", systemImage: "house")
            }

            Button {
                router.push(.settings)
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(width: 40, height: 40)
        }
        .accessibilityLabel("More options")
    }
}

// MARK: - Notification for composer → timeline communication

extension Notification.Name {
    static let scoutSendPrompt = Notification.Name("scoutSendPrompt")
}
