import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// The v3 alternate root (experimental, off by default — see `ScoutV3`).
/// Five tabs: Home · Chats · [hex compose] · Projects · Alerts. Shipped
/// surfaces are embedded, never rewritten: Chats is `CommsSurface`, the hex
/// is `NewSessionSurface`, Alerts is `NotificationsSurface`. Home
/// (`V3HomeSurface`) and Projects (`V3ProjectsSurface`) are new.
struct V3RootView: View {
    @Bindable var model: AppModel

    // Debug/screenshot seeds: `defaults write app.openscout.scout scout.nav.v3.tab -string chats`
    // (or compose/projects/alerts/home) picks the launch tab; no effect when unset.
    @State private var tab: V3Tab = UserDefaults.standard.string(forKey: "scout.nav.v3.tab")
        .flatMap(V3Tab.init(rawValue:)) ?? .home
    // Home's host scope (a paired-machine id, nil = all hosts) and feed
    // filter, lifted here because the scope menu lives in the masthead and
    // the filter menu in the sub bar — both chrome, owned by the root.
    @State private var homeHostScope: String?
    @State private var homeFilter: V3HomeFilter = .forYou
    // `defaults write app.openscout.scout scout.nav.v3.settings -bool true` opens
    // settings over the v3 root at launch; no effect when unset/false.
    @State private var showSettings = UserDefaults.standard.bool(forKey: "scout.nav.v3.settings")
    @State private var terminalDiagnostics = TerminalDiagnosticsModel()
    /// Compose seed slot, kept for parity with RootView's New surface wiring.
    @State private var newComposerSeed: NewSessionSeed?
    /// The keyboard covers the docked tab bar (same contract as RootView).
    @State private var keyboardIsUp = false
    // TODO(v3): the Chats scope seg is cosmetic — wiring Mine/Channels into
    // CommsSurface would touch shipped code, which this slice must not do.
    @State private var chatsScope: V3ChatsScope = .mine
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var client: any ScoutBrokerClient { model.client }

    /// The focused Mac — a live terminal belongs to exactly one host, the same
    /// rule RootView follows.
    private var activeMachine: AppModel.PairedMachine? {
        model.pairedMachines.first(where: { $0.isActive })
    }

    /// Breathing room left under the status readout on a device with a home
    /// indicator. Enough that the indicator never crosses the text, small
    /// enough that the footer reads as sitting ON the bottom edge.
    private static let homeIndicatorClearance: CGFloat = 12

    /// The REAL device bottom inset, read from the window rather than a
    /// GeometryReader — inside `safeAreaInset` the proxy reports the inset the
    /// container has already consumed, which is 0 here. Same reason
    /// CrownNavigation reads `deviceTopInset` this way.
    private var deviceBottomInset: CGFloat {
        #if canImport(UIKit)
        return UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first }
            .first?.safeAreaInsets.bottom ?? 0
        #else
        return 0
        #endif
    }

    enum V3ChatsScope: String {
        case mine = "Mine"
        case channels = "Channels"
    }

    var body: some View {
        HudPhoneAppShell(background: ScoutPalette.bg, appearance: .system) {
            DesignFrame { layout in
                VStack(spacing: 0) {
                    V3Masthead(
                        model: model,
                        hostScope: homeHostScope,
                        onSelectHostScope: { homeHostScope = $0 },
                        onSearch: { /* no search destination yet — see V3Masthead */ },
                        onSettings: { showSettings = true }
                    )
                    subBar

                    // Keep tab surfaces alive across switches (opacity swap,
                    // same discipline as RootView's surfaceLayer).
                    ZStack {
                        slot(.home) {
                            // Posts open their own thread over the feed (see
                            // V3HomeSurface.openPost) — Home no longer hands
                            // taps to the Chats tab, which landed you on the
                            // list with the thread you asked for nowhere in it.
                            V3HomeSurface(
                                model: model,
                                isActive: tab == .home,
                                hostScope: homeHostScope,
                                filter: homeFilter
                            )
                        }
                        slot(.chats) {
                            CommsSurface(
                                model: model,
                                isActive: tab == .chats,
                                reloadToken: model.fleetDataReadyToken,
                                notificationRoute: model.pendingNotificationRoute
                            )
                        }
                        slot(.logs) {
                            // The shipped cross-agent tail, embedded as-is.
                            TailSurface(
                                model: model,
                                isActive: tab == .logs,
                                reloadToken: model.fleetDataReadyToken
                            )
                        }
                        slot(.compose) {
                            NewSessionSurface(
                                model: model,
                                client: client,
                                reloadToken: model.dataReadyToken,
                                isActive: tab == .compose,
                                onConversationStatusContext: { _ in },
                                promptSeed: $newComposerSeed
                            )
                        }
                        slot(.projects) {
                            V3ProjectsSurface(model: model, isActive: tab == .projects)
                        }
                        slot(.shell) {
                            // The shipped SSH/PTY surface, wired the same way
                            // RootView wires it (target + proven-reachable host
                            // + the recovery hooks AppModel owns).
                            TerminalSurface(
                                client: client,
                                diagnostics: terminalDiagnostics,
                                reloadToken: model.dataReadyToken,
                                terminalTargetID: activeMachine?.id,
                                connectedHost: model.terminalSSHHost,
                                onReconnectBridge: { Task { await model.reconnect() } },
                                onOpenConnectionSettings: { showSettings = true },
                                isPresentingSettings: showSettings,
                                isActive: tab == .shell
                            )
                        }
                        slot(.alerts) {
                            // Embedded as-is. Its header close button calls
                            // `dismiss()`, which is a no-op outside a
                            // presentation — harmless here, and the surface
                            // stays byte-identical to the shipped one.
                            NotificationsSurface(model: model)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if !keyboardIsUp {
                        VStack(spacing: 0) {
                            V3TabBar(
                                active: tab,
                                alerts: model.notifications.openCount,
                                onSelect: select
                            )
                            statusStrip
                        }
                        // The status strip's FILL already bleeds into the
                        // home-indicator band, but its content was parked above
                        // the whole inset — on a device with an indicator that
                        // left the readout floating over an empty stripe of
                        // chrome. Pull the footer down into that band and keep
                        // only `homeIndicatorClearance` of it, so the readout
                        // sits near the true bottom edge without crowding the
                        // indicator. Devices without an indicator have a 0
                        // inset, so max() makes this a no-op there.
                        .padding(.bottom, -max(0, deviceBottomInset - Self.homeIndicatorClearance))
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                    keyboardIsUp = Self.keyboardCoversScreen(notification)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                    keyboardIsUp = false
                }
                // The ledger polls on its own cadence on every surface — the
                // Alerts badge has to be right wherever you are (RootView's
                // own contract, mirrored).
                .task(id: model.fleetDataReadyToken) {
                    guard model.fleetDataReadyToken != 0 else { return }
                    while !Task.isCancelled {
                        await model.refreshNotifications()
                        try? await Task.sleep(for: .seconds(30))
                    }
                }
            }
            .background {
                ScoutCanvas(isFleetLive: model.activeAgentCount > 0)
                    .ignoresSafeArea()
            }
        }
        .fullScreenCover(isPresented: $showSettings) {
            AppSettingsView(
                model: model,
                context: .home,
                terminalDiagnostics: terminalDiagnostics
            )
        }
    }

    // MARK: - Sub bar (per tab)

    @ViewBuilder
    private var subBar: some View {
        switch tab {
        case .home:
            V3SubBar {
                V3FeedFilterMenu(selection: homeFilter, onSelect: { homeFilter = $0 })
            }
        case .chats:
            V3SubBar {
                HStack(spacing: 3) {
                    ForEach([V3ChatsScope.mine, .channels], id: \.rawValue) { scope in
                        Button { chatsScope = scope } label: {
                            Text(scope.rawValue)
                                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                                .foregroundStyle(chatsScope == scope ? ScoutPalette.ink : ScoutInk.muted)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 5)
                                .background(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .fill(chatsScope == scope ? ScoutPalette.accentSoft : .clear)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(
                                            chatsScope == scope ? ScoutPalette.accent.opacity(0.35) : .clear,
                                            lineWidth: 1
                                        )
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chatsScope == scope ? .isSelected : [])
                    }
                }
                .padding(3)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(ScoutPalette.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(ScoutHairline.standard, lineWidth: 1)
                )
            }
        case .compose:
            V3SubBar {
                ScoutSectionLabel("New session")
                Spacer(minLength: 0)
                if let machine = model.pairedMachines.first(where: \.isActive) {
                    Text(machine.name)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                        .lineLimit(1)
                }
            }
        case .logs:
            // No sub bar. TailSurface already opens with its own context line,
            // and that line is the live one — last refresh, attached/detached,
            // the refresh control — all driven by state the surface owns. A bar
            // here could only ever restate the label ("Fleet tail" over "TAIL")
            // plus a scope string we weren't actually filtering by, so the tab
            // shipped two headers saying the same thing. The surface keeps the
            // one that does work; the shell steps back and gives it the height.
            // (The masthead carries its own bottom hairline, so the seam under
            // the chrome is unchanged.) See the header note in TailSurface.swift.
            EmptyView()
        case .projects:
            V3SubBar {
                ScoutSectionLabel("Projects · workspaces")
            }
        case .shell:
            V3SubBar {
                ScoutSectionLabel("Shell")
                Spacer(minLength: 0)
                if let machine = activeMachine {
                    Text(machine.name)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                        .lineLimit(1)
                }
            }
        case .alerts:
            V3SubBar {
                let waiting = model.notifications.openCount
                Text("Needs you · \(waiting)")
                    .font(HudFont.mono(9, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(waiting > 0 ? ScoutPalette.statusWarn : ScoutPalette.muted)
                Spacer(minLength: 0)
                Text("\(model.notifications.keptCount - waiting) kept")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
            }
        }
    }

    // MARK: - Status strip

    /// The cockpit readout under the tab bar (the study's V3StatusBar):
    /// focused host leading, fleet counts trailing. Read-only by contract.
    private var statusStrip: some View {
        let machines = model.pairedMachines
        let online = machines.filter(\.isOnline).count
        let focused = machines.first(where: \.isActive) ?? machines.first
        return ScoutStatusBar(
            leading: [
                StatusReadout(
                    dot: focused?.isOnline == true ? ScoutPalette.accent : ScoutInk.dim,
                    label: focused?.name ?? "no host",
                    tint: focused?.isOnline == true ? ScoutInk.muted : ScoutInk.dim
                )
            ],
            trailing: [
                StatusReadout(
                    label: "\(model.activeAgentCount) active",
                    tint: model.activeAgentCount > 0 ? ScoutPalette.accent : ScoutInk.dim
                ),
                StatusReadout(label: "\(online)/\(machines.count) online")
            ]
        )
    }

    // MARK: - Mechanics

    @ViewBuilder
    private func slot<Content: View>(
        _ candidate: V3Tab,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let isActive = tab == candidate
        content()
            .opacity(isActive ? 1 : 0)
            .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.fade), value: isActive)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
            .zIndex(isActive ? 1 : 0)
    }

    private func select(_ next: V3Tab) {
        guard tab != next else { return }
        if reduceMotion {
            tab = next
        } else {
            withAnimation(ScoutMotion.fade) { tab = next }
        }
    }

    /// Same keyboard-coverage test as RootView's: only suppress the tab bar
    /// when the reported end frame actually intersects the screen.
    private static func keyboardCoversScreen(_ notification: Notification) -> Bool {
        #if canImport(UIKit)
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return false
        }
        let screenBounds = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.screen.bounds }
            .first ?? .zero
        guard !screenBounds.isEmpty else { return frame.height > 0 }
        return frame.height > 0 && frame.minY < screenBounds.maxY - 1
        #else
        return false
        #endif
    }
}
