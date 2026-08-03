import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// Top-level navigation for Scout. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the adaptive NavigationStack) and switches
/// between the native phone surfaces plus iPad-only
/// Lanes and Dispatch mission control via the docked tab bar.
struct RootView: View {
    @Bindable var model: AppModel
    @State private var showConnection = false
    @State private var showSettings = false
    @State private var sessionStatusContext: String?
    @State private var terminalDiagnostics = TerminalDiagnosticsModel()
    @AppStorage(ScoutHomeFX.grainKey) private var homeGrainEnabled = true
    @AppStorage(ScoutHomeFX.motionKey) private var homeMotionEnabled = true
    @AppStorage(ScoutHomeFX.identityKey) private var homeIdentityEnabled = true
    @AppStorage(ScoutHomeLabPreset.storageKey) private var homeLabPresetRaw = ScoutHomeLabPreset.default.rawValue
    @State private var homeLabExpanded = false
    @State private var homeLabVisible = true
    // Opt-in alternative navigation. `.tabs` keeps the shipped chrome (titleBar +
    // dockedTabBar + status strip) exactly; `.crown` swaps in the summonable crown.
    @AppStorage(ScoutNavMode.storageKey) private var navModeRaw = ScoutNavMode.default.rawValue
    // The Home variant also picks the app's bottom chrome: `.entry` (the calm
    // composer-first front door) wears the floating liquid-glass bar, `.fleet`
    // keeps the docked bar + cockpit strip untouched.
    @AppStorage(ScoutHomeStyle.storageKey) private var homeStyleRaw = ScoutHomeStyle.default.rawValue
    @State private var crownAssembled = true
    @State private var showVitals = false
    @State private var showTailSheet = false
    /// The Notifications destination (the ledger) + the correlation id an
    /// opened push wants it to land on.
    @State private var showNotifications = false
    @State private var notificationsFocusItemId: String?
    /// One-shot seed from Home's ask composers — prompt, plus the runtime pick
    /// and attachments when the surface offered them. Consumed by the New
    /// surface (which stays mounted, so this must be a binding, not init state)
    /// and cleared once it lands in the composer.
    @State private var newComposerSeed: NewSessionSeed?
    /// The keyboard is on screen. The docked tab bar steps aside while it is —
    /// iOS lets the keyboard cover the bar rather than shoving it up a row.
    @State private var keyboardIsUp = false
    /// The Places map, and the navigation a row picked — run on dismiss so a
    /// destination that presents its own sheet isn't swallowed.
    @State private var showPlaces = false
    @State private var pendingPlace: (() -> Void)?
    /// The glass bar's machined seat is ONE object that travels between tabs.
    /// It is drawn inside whichever button is selected and matched across the
    /// swap, so switching tabs slides the seat from the old glyph to the new
    /// instead of extinguishing one and lighting another — the bar answers
    /// "where did I come from" without the surfaces having to move at all.
    @Namespace private var glassTabSeat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    private var navMode: ScoutNavMode { ScoutNavMode.resolve(navModeRaw) }

    /// The composer-first front door is on. It picks the app's chrome, not just
    /// Home's body: the calm masthead and the floating glass bar below.
    private var isEntryHome: Bool { ScoutHomeStyle.resolve(homeStyleRaw) == .entry }

    /// Liquid-glass bottom chrome — a flavor of TABS chrome under the Entry
    /// home, never entangled with crown mode (the crown owns the bottom on its
    /// own terms and is unchanged by this).
    private var usesGlassChrome: Bool { navMode == .tabs && isEntryHome }

    private var homeLabPreset: ScoutHomeLabPreset {
        #if DEBUG
        ScoutHomeLabPreset.resolve(homeLabPresetRaw)
        #else
        .current
        #endif
    }

    /// The lab re-authors Home only. Leaving Home immediately restores the
    /// app's normal shared chrome, which keeps the experiment from leaking into
    /// product surfaces it was never designed against.
    private var homePrecisionIsActive: Bool {
        surface == .home && homeLabPreset.isPrecision
    }

    private var client: any ScoutBrokerClient { model.client }

    /// The focused/filter Mac. Several Macs may be online, but surfaces still
    /// route through this one until coalesced FleetClient reads land.
    private var activeMachine: AppModel.PairedMachine? {
        model.pairedMachines.first(where: { $0.isActive })
    }

    /// Friendly name of the focused Mac, for the New composer's read-only target.
    private var activeMachineName: String? { activeMachine?.name }

    enum Surface: String, CaseIterable, Identifiable {
        case home = "Home"
        case agents = "Agents"
        case tail = "Tail"
        case comms = "Comms"
        case lanes = "Lanes"
        case deck = "Deck"
        case dispatch = "Dispatch"
        case terminal = "Terminal"
        case new = "New"

        var id: String { rawValue }

        /// The phone rail's canonical order. Every secondary map of the rail
        /// derives from this list so Scout never teaches two navigation models.
        static let phoneNavigationOrder: [Surface] = [
            .home, .agents, .tail, .comms, .terminal, .new,
        ]

        /// Compact labels keep all six navigation seats on one consistent
        /// rhythm. The destination remains "Terminal" everywhere outside the
        /// rail; "Shell" is the familiar, shorter action label under its glyph.
        var navigationLabel: String {
            self == .terminal ? "Shell" : rawValue
        }

        var navigationBlurb: String {
            switch self {
            case .home: "Your fleet at a glance"
            case .agents: "Who's working, and on what"
            case .tail: "Watch the work stream live"
            case .comms: "Conversations with your agents"
            case .lanes: "Live work across parallel lanes"
            case .deck: "Mission control for active work"
            case .dispatch: "Send work across the fleet"
            case .terminal: "A shell on your paired Mac"
            case .new: "Start an agent on something"
            }
        }

        /// Hand-drawn glyph from the unified set (see `Glyphs.swift`).
        var glyph: GlyphShape.Kind {
            switch self {
            case .home: return .home
            // Single silhouette / single bubble at tab scale — the two-figure
            // and two-bubble marks turn to mud at this size. (The multi-figure
            // `.agents` still earns its keep inline in Home's project counts.)
            case .agents: return .agent
            case .tail: return .tail
            case .comms: return .comms
            case .lanes: return .lanes
            case .deck: return .dispatch
            case .dispatch: return .dispatch
            case .terminal: return .terminal
            case .new: return .plus
            }
        }
    }

    @State private var surface: Surface = Self.initialSurface

    /// Launch tab. Defaults to Home; in DEBUG either `--scout-tab Comms` or a
    /// `SCOUT_TAB=Comms` environment value jumps straight to a surface so the
    /// simulator can verify any tab without driving touch input. Launch args are
    /// the reliable path on current simulator runtimes; neither path ships in
    /// release behavior.
    private static var initialSurface: Surface {
        #if DEBUG
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "--scout-tab"),
           arguments.indices.contains(flag + 1),
           let surface = Surface(rawValue: arguments[flag + 1]) {
            return surface
        }
        if let raw = ProcessInfo.processInfo.environment["SCOUT_TAB"],
           let s = Surface(rawValue: raw) { return s }
        #endif
        return .home
    }

    var body: some View {
        HudPhoneAppShell(background: ScoutPalette.bg, appearance: .system) {
            // Author every surface through Scout's phone layout frame. The
            // 13 mini gets native sizing with compact metrics; only narrower
            // widths scale down. See `DesignFrame`.
            DesignFrame { layout in
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        // Crown mode drops the masthead; identity + actions move to
                        // the crown chrome. Tabs mode is unchanged.
                        if navMode == .tabs {
                            titleBar(layout)
                        }

                        // Keep every tab surface alive for the launch lifetime.
                        // Opacity switches presentation without discarding view
                        // state, scroll positions, loaded snapshots, or Terminal's
                        // live workspace. Inactive surfaces gate their own work.
                        ZStack {
                            surfaceLayer(.home) {
                                HomeSurface(
                                    model: model,
                                    motionEnabled: homeMotionEnabled,
                                    identityEnabled: homeIdentityEnabled,
                                    isActive: surface == .home,
                                    onConversationStatusContext: { sessionStatusContext = $0 },
                                    onSeeAllAgents: { selectSurface(.agents) },
                                    onSeeAllActivity: { selectSurface(.comms) },
                                    onSeeAllNotifications: { openNotifications() },
                                    onCompose: { seed in
                                        newComposerSeed = seed
                                        selectSurface(.new)
                                    },
                                    onConnect: { showConnection = true },
                                    reloadToken: model.fleetDataReadyToken
                                )
                            }
                            surfaceLayer(.agents) {
                                AgentsSurface(
                                    model: model,
                                    isActive: surface == .agents,
                                    onConversationStatusContext: { sessionStatusContext = $0 }
                                )
                            }
                            surfaceLayer(.tail) {
                                TailSurface(
                                    model: model,
                                    isActive: surface == .tail,
                                    reloadToken: model.fleetDataReadyToken
                                )
                            }
                            surfaceLayer(.comms) {
                                CommsSurface(
                                    model: model,
                                    isActive: surface == .comms,
                                    reloadToken: model.fleetDataReadyToken,
                                    notificationRoute: model.pendingNotificationRoute
                                )
                            }
                            surfaceLayer(.lanes) {
                                MissionControlSurface(
                                    model: model,
                                    kind: .lanes,
                                    isActive: surface == .lanes,
                                    onOpenDeck: { selectSurface(.deck) },
                                    onConnect: { showConnection = true }
                                )
                            }
                            surfaceLayer(.deck) {
                                MissionControlSurface(
                                    model: model,
                                    kind: .deck,
                                    isActive: surface == .deck,
                                    onOpenLanes: { selectSurface(.lanes) },
                                    onConnect: { showConnection = true }
                                )
                            }
                            surfaceLayer(.dispatch) {
                                MissionControlSurface(
                                    model: model,
                                    kind: .dispatch,
                                    isActive: surface == .dispatch,
                                    onConnect: { showConnection = true },
                                    onCompose: { seed in
                                        newComposerSeed = seed
                                        selectSurface(.new)
                                    }
                                )
                            }
                            surfaceLayer(.terminal) {
                                TerminalSurface(
                                    client: client,
                                    diagnostics: terminalDiagnostics,
                                    reloadToken: model.dataReadyToken,
                                    terminalTargetID: activeMachine?.id,
                                    connectedHost: model.terminalSSHHost,
                                    onReconnectBridge: { Task { await model.reconnect() } },
                                    onOpenConnectionSettings: { showConnection = true },
                                    isPresentingSettings: showSettings,
                                    isActive: surface == .terminal
                                )
                            }
                            surfaceLayer(.new) {
                                NewSessionSurface(
                                    model: model,
                                    client: client,
                                    reloadToken: model.dataReadyToken,
                                    isActive: surface == .new,
                                    onConversationStatusContext: { sessionStatusContext = $0 },
                                    promptSeed: $newComposerSeed
                                )
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    // Docked tab bar: a full-width material pinned to the bottom edge,
                    // bleeding through the home-indicator area. `safeAreaInset` insets
                    // the surfaces' scroll content above it, and the material masks
                    // anything that scrolls behind it — the conventional iOS pattern.
                    //
                    // The keyboard COVERS it, as on every other iOS app: a docked
                    // bar riding up above the keys spends a whole row on chrome
                    // nobody can reach. Only surface content rises, so composers
                    // still land directly on the keyboard.
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if navMode == .tabs, !keyboardIsUp {
                            // The Entry home wears the floating glass bar; the
                            // classic Fleet home keeps the docked bar exactly.
                            if usesGlassChrome {
                                glassTabBar(layout)
                            } else {
                                dockedTabBar(layout)
                            }
                        } else if navMode == .crown, !keyboardIsUp {
                            // The crown is persistent navigation now, so surface
                            // content must stop above it instead of covering it
                            // once Home's composer settles into place.
                            Color.clear.frame(height: CrownMetric.bottomReserve)
                        }
                    }
                    // Crown mode reserves a top zone so surface headers clear the
                    // permanent top strip + LED. Zero effect in tabs mode.
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if navMode == .crown {
                            Color.clear.frame(height: CrownMetric.topReserve(for: layout))
                        }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                        // Focus alone is not a keyboard. With a hardware keyboard
                        // attached, Home auto-focuses its composer and UIKit can
                        // still emit keyboard lifecycle notifications even though
                        // no software keys cover the app. Only suppress navigation
                        // when the reported end frame actually intersects the screen.
                        keyboardIsUp = Self.keyboardCoversScreen(notification)
                    }
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                        keyboardIsUp = false
                    }

                    // Read-only connection readout pinned flush to the true screen
                    // bottom, inside the home-indicator protected zone. The combo that
                    // makes it hug the edge instead of floating at the safe-area
                    // boundary: fill down + bottom-align the content, THEN ignore the
                    // bottom safe area. Safe to sit on the swipe-up gesture —
                    // hit-testing is off, it's a pure readout.
                    // Tick independently of broker polling so the FETCHED age
                    // counts up through seconds/minutes even when a stalled
                    // request produces no model mutation. The underlying fetch
                    // instant only advances after a successfully decoded broker
                    // query (see BrokerRequestLog).
                    // Glass chrome ABSORBS this strip: a floating bar wants clear
                    // air under it, and the permanent readouts it carried are
                    // already elsewhere (route + host on the masthead chip, fleet
                    // counts on Home and Agents). What the strip alone could tell
                    // you — connection dropped, or data quietly gone stale — comes
                    // back as one line above the glass bar, and only while true.
                    if usesGlassChrome {
                        EmptyView()
                    } else if navMode == .tabs {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            ScoutStatusBar(
                                leading: appReadouts(layout),
                                trailing: statsReadouts(layout, now: context.date)
                            )
                        }
                        // Pinned to the design width, leading: the strip's readouts
                        // are intrinsically sized, so a wide fleet ("200 agents")
                        // makes the run longer than the screen — and an unclamped
                        // strip then inflated the whole shell stack, shoving the
                        // masthead and every surface ~20pt right until the trailing
                        // complication clipped. The strip still runs off its own
                        // trailing end exactly as before; nothing else moves now.
                        .frame(width: layout.designWidth, alignment: .leading)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .ignoresSafeArea(edges: .bottom)
                        // The nav stack leaves a residual inset; push the last bit so
                        // the bar sits flush in the indicator band, not floating.
                        .offset(y: 14)
                    } else {
                        // Crown mode: the crown chrome replaces both the tab bar and
                        // the status strip (the LED carries fleet aliveness instead) —
                        // but on SUMMON the strip returns as a thin read-only line
                        // popped up from the true bottom edge (same unsafe-area
                        // discipline as tabs). It never shows at rest: the resting
                        // crown owns the bottom. Side insets push the edge readouts
                        // clear of the corner labels that share the indicator band —
                        // on the wide canvas the island corners sit far inboard, so
                        // the strip can use the rail's own inset. Painted UNDER the
                        // crown chrome so the corners and labels draw above it.
                        // Studio model: design/studio/views/fleet-led-carousel.tsx.
                        Group {
                            if crownAssembled {
                                ScoutStatusBar(
                                    leading: appReadouts(layout),
                                    trailing: crownStatsReadouts(layout),
                                    sideInset: layout.physicalWidth >= 700 ? 28 : (layout.isMiniPhone ? 56 : 68)
                                )
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                                .ignoresSafeArea(edges: .bottom)
                                // Same residual-inset correction as the tabs bar, so the
                                // strip sits flush in the indicator band, not floating.
                                // The wide canvas reads best a touch deeper still.
                                .offset(y: layout.physicalWidth >= 700 ? 20 : 14)
                                .transition(
                                    reduceMotion
                                        ? .opacity
                                        : .move(edge: .bottom).combined(with: .opacity)
                                )
                            }
                            CrownNavChrome(
                                model: model,
                                currentSurface: surface,
                                onSelect: { selectSurface($0) },
                                onSettings: { showSettings = true },
                                onConnect: { showConnection = true },
                                onLED: { showVitals = true },
                                onTailSummon: { showTailSheet = true },
                                assembled: $crownAssembled
                            )
                            // Active surfaces deliberately carry zIndex(1) so
                            // their transitions remain stable. The navigation
                            // landmark must sit above that layer or Home's dock
                            // paints over it after loading.
                            .zIndex(2)
                        }
                        // The chrome bleeds INTO the top safe area — without this it
                        // starts below the island and its own safeAreaInsets.top then
                        // double-counts, dropping the strip + LED ~50pt too low. The
                        // bottom is deliberately untouched (the geometry there is
                        // operator-approved).
                        .ignoresSafeArea(edges: .top)
                        // Hoisted to the container: an .animation modifier on the
                        // INSERTED view itself can't animate its own insertion, so
                        // the strip appeared instead of lifting in from the bottom.
                        .animation(reduceMotion ? .easeOut(duration: 0.12) : .easeOut(duration: 0.22), value: crownAssembled)
                    }
                }
                // The ledger polls on its own cadence, on every surface: the
                // masthead bell has to be right wherever you are, and an alert
                // captured while it is still pending is the only way the ledger
                // learns what it said (the Mac drops it once it settles).
                .task(id: model.fleetDataReadyToken) {
                    guard model.fleetDataReadyToken != 0 else { return }
                    while !Task.isCancelled {
                        await model.refreshNotifications()
                        try? await Task.sleep(for: .seconds(30))
                    }
                }
                .task(id: "\(model.fleetDataReadyToken)|\(surface.rawValue)") {
                    guard model.fleetDataReadyToken != 0, surface != .home else { return }
                    // Keep the status bar's agent / active counts roughly live while
                    // non-Home surfaces are up. Home shares its own successful
                    // agent read, so Root does not duplicate that RPC underneath it.
                    while !Task.isCancelled {
                        await model.refreshFleetStats()
                        try? await Task.sleep(for: .seconds(20))
                    }
                }
            }
            // Cockpit depth behind every surface — full-bleed and UNSCALED behind
            // the design frame, so the physical edges stay covered even when the
            // frame shrinks to fit the 13 mini. (The shell itself paints only a
            // flat color.)
            .background {
                ScoutCanvas(
                    isFleetLive: model.activeAgentCount > 0,
                    grainEnabled: homeGrainEnabled,
                    motionEnabled: homeMotionEnabled,
                    precisionBlack: homePrecisionIsActive
                )
                .ignoresSafeArea()
            }
            #if DEBUG
            .overlay(alignment: .bottomTrailing) {
                if surface == .home, homeLabVisible {
                    homeLabControl
                        .padding(.trailing, 12)
                        .padding(.bottom, 92)
                }
            }
            #endif
        }
        .preferredColorScheme(homePrecisionIsActive ? .dark : nil)
        .sheet(isPresented: $showConnection) {
            ConnectionView(model: model)
        }
        // The map. The picked destination runs on dismiss (see `pendingPlace`).
        .sheet(isPresented: $showPlaces, onDismiss: {
            let go = pendingPlace
            pendingPlace = nil
            go?()
        }) {
            placesSheet
        }
        // Crown-mode LED quick-action: a compact vitals panel (route, hosts,
        // refresh). The Connect corner still opens the full ConnectionView.
        .sheet(isPresented: $showVitals) {
            CrownVitalsPanel(model: model)
        }
        // Crown pro gesture (long-hold + slide up): the tail as a sheet, so it
        // works even when the home tail module is switched off.
        .sheet(isPresented: $showTailSheet) {
            TailSurface(
                model: model,
                isActive: showTailSheet,
                reloadToken: model.fleetDataReadyToken
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        // Notifications is a destination, not a card: the ledger is a page you
        // go to (from the masthead bell, the Home lane, or an opened push), and
        // it pushes conversations of its own.
        .fullScreenCover(isPresented: $showNotifications, onDismiss: { notificationsFocusItemId = nil }) {
            NotificationsSurface(model: model, focusItemId: notificationsFocusItemId)
        }
        // Settings is a full page, not a card sheet — the shell carries its own
        // close control, so present it edge-to-edge.
        .fullScreenCover(isPresented: $showSettings) {
            AppSettingsView(
                model: model,
                context: settingsContext,
                terminalDiagnostics: terminalDiagnostics
            )
        }
        #if DEBUG
        // Sim verification hook (sibling to `SCOUT_TAB`): open Settings on
        // launch so the inspector panels can be screenshotted without touch input.
        .onAppear {
            // `SCOUT_NAV=crown` (or `tabs`) flips navigation mode for captures.
            if let nav = ProcessInfo.processInfo.environment["SCOUT_NAV"],
               ScoutNavMode(rawValue: nav) != nil {
                navModeRaw = nav
            }
            if let preset = ProcessInfo.processInfo.environment["SCOUT_HOME_PRESET"],
               ScoutHomeLabPreset(rawValue: preset) != nil {
                homeLabPresetRaw = preset
            }
            let homeLabMode = ProcessInfo.processInfo.environment["SCOUT_HOME_LAB"]
            homeLabVisible = homeLabMode != "hidden"
            homeLabExpanded = homeLabMode == "expanded"
            // `SCOUT_CROWN=collapsed` starts crown mode collapsed for the paired capture.
            if ProcessInfo.processInfo.environment["SCOUT_CROWN"] == "collapsed" {
                crownAssembled = false
            }
            // `SCOUT_OPEN_VITALS=1` opens the LED vitals panel for capture.
            if ProcessInfo.processInfo.environment["SCOUT_OPEN_VITALS"] == "1" {
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(400))
                    showVitals = true
                }
            }
            // `SCOUT_OPEN_NOTIFICATIONS=1` opens the ledger for capture.
            if ProcessInfo.processInfo.environment["SCOUT_OPEN_NOTIFICATIONS"] == "1" {
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(400))
                    showNotifications = true
                }
            }
            if ProcessInfo.processInfo.environment["SCOUT_OPEN_SETTINGS"] != nil {
                let delayMilliseconds = Int(
                    ProcessInfo.processInfo.environment["SCOUT_OPEN_SETTINGS_DELAY_MS"] ?? "0"
                ) ?? 0
                Task { @MainActor in
                    if delayMilliseconds > 0 {
                        try? await Task.sleep(for: .milliseconds(delayMilliseconds))
                    }
                    showSettings = true
                }
            }
        }
        #endif
        .onChange(of: model.pendingNotificationRoute) { _, route in
            guard let route else { return }
            openNotification(route)
        }
        .onAppear {
            guard let route = model.pendingNotificationRoute else { return }
            openNotification(route)
        }
        .onChange(of: surface) { _, _ in sessionStatusContext = nil }
    }

    /// Where an opened alert lands. Conversation alerts belong to Comms (the
    /// thread is their durable home); every other alert belongs to the ledger,
    /// which holds the full text the push deliberately withheld — and keeps
    /// holding it after the item stops being pending, which the old landing
    /// sheet could not (it only knew how to say "no longer active").
    private func openNotification(_ route: AppModel.NotificationRoute) {
        if route.conversationId != nil {
            selectSurface(.comms)
            return
        }

        // Same identity the ledger records a push stub under, so an alert whose
        // payload carried no correlation id still lands on its own entry.
        openNotifications(focusItemId: route.itemId ?? route.sessionId)
        model.consumeNotificationRoute(route)
    }

    private func openNotifications(focusItemId: String? = nil) {
        notificationsFocusItemId = focusItemId
        showNotifications = true
    }

    private static func keyboardCoversScreen(_ notification: Notification) -> Bool {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return false
        }
        let screenBounds = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.screen.bounds }
            .first ?? .zero
        guard !screenBounds.isEmpty else { return frame.height > 0 }
        return frame.height > 0 && frame.minY < screenBounds.maxY - 1
    }

    private var settingsContext: AppSettingsContext {
        switch surface {
        case .home: .home
        case .agents: .agents
        case .tail: .tail
        case .comms: .comms
        case .lanes: .lanes
        case .deck: .dispatch
        case .dispatch: .dispatch
        case .terminal: .terminal
        case .new: .new
        }
    }

    /// A stable, always-mounted slot for one top-level surface. The selected
    /// slot crossfades above the others; hidden slots remain in the hierarchy but
    /// cannot receive touch or accessibility focus.
    ///
    /// The fade is deliberately the shortest thing in the app and is declared
    /// HERE rather than inherited from whoever set `surface` — a tab switch on
    /// iOS is instant, and a surface that slides or springs into place is a
    /// surface you have to wait for. The pleasure lives in the bar; the content
    /// just has to arrive. (Whole-surface movement is banned outright: nothing
    /// here translates.)
    private func surfaceLayer<Content: View>(
        _ candidate: Surface,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let isActive = surface == candidate
        return content()
            .opacity(isActive ? 1 : 0)
            .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.fade), value: isActive)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
            .zIndex(isActive ? 1 : 0)
    }

    /// Selection is a plain state change: the glass rail declares the seat's
    /// spring, each surface slot declares its own crossfade, and the docked bar
    /// keeps the tint ease it always had. Nothing here imposes one animation on
    /// all three — that is how the seat ended up sharing the surfaces' timing.
    private func selectSurface(_ next: Surface) {
        guard surface != next else { return }
        if reduceMotion {
            surface = next
        } else {
            withAnimation(ScoutMotion.fade) { surface = next }
        }
    }

    /// Conventional docked tab bar (vs the floating `HudLiquidBar` pill): a
    /// full-width material pinned to the bottom that bleeds through the home
    /// indicator. App-local on purpose — it renders the unified hand-drawn glyph
    /// set, which the shared `HudLiquidBarTabRow` can't (it takes SF Symbol
    /// strings only). Selection chrome mirrors the shared component exactly.
    private func dockedTabBar(_ layout: ScoutLayoutMetrics) -> some View {
        // Give every tab an EXPLICIT equal width derived from the design width, so
        // the label shrinks (via minimumScaleFactor) to fit its column instead of
        // holding its intrinsic width. `maxWidth: .infinity` alone let the long
        // labels ("Terminal") keep their ideal size, so six columns overflowed
        // 393pt and the trailing "New" tab clipped off the right edge.
        let tabs = visibleSurfaces(layout)
        let hPad = layout.tabBarHorizontalPadding
        let tabWidth = max(0, (layout.designWidth - hPad * 2) / CGFloat(max(1, tabs.count)))
        return HStack(spacing: 0) {
            ForEach(tabs) { tabButton($0, layout: layout, width: tabWidth) }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, layout.tabBarTopPadding)
        .padding(.horizontal, hPad)
        .background(alignment: .top) {
            Rectangle()
                // Opaque adaptive chrome keeps the content legible in both
                // appearances. Separation comes from the lit lip + upward
                // shadow, not a decorative blur.
                .fill(ScoutPalette.bg)
                // Lift the studio way (cf. `scoutCard`): a SOLID lifted-tone top
                // edge (`cardEdgeTop`), never a glossy white sheen. Crisp 1.5pt
                // lit lip — a sharp raised edge, not a soft bevel.
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(ScoutCanvas.cardEdgeTop)
                        .frame(height: 1.5)
                }
                .ignoresSafeArea(edges: .bottom)
                // Elevation: a tighter, crisper shadow cast upward so the bar
                // reads as a sharply raised surface, not a soft glow.
                .shadow(color: Color.black.opacity(0.22), radius: 11, y: -6)
        }
    }

    /// Liquid-glass tab bar — the Apple-shaped bottom chrome the Entry home
    /// wears. A capsule floating inset from every edge, drawn with the REAL
    /// iOS 26 glass: `hudLiquidBarMaterial` resolves to `.glassEffect(.regular,
    /// in: .capsule)` and only Reduce Transparency drops it to a solid plate.
    /// The current tab is seated on the same machined plate the masthead
    /// complications are cut from — graphite instruments in a glass rail, so
    /// the top-left and the bottom read as one system.
    @ViewBuilder
    private func glassTabBar(_ layout: ScoutLayoutMetrics) -> some View {
        let tabs = visibleSurfaces(layout)
        let sideInset = layout.isNarrowPhone ? HudSpacing.xxl : HudSpacing.xxxl
        // Same equal-column discipline as the docked bar: an explicit width per
        // tab so "Terminal" shrinks inside its column instead of overflowing.
        let barWidth = max(0, layout.designWidth - sideInset * 2)
        let tabWidth = max(0, (barWidth - HudSpacing.sm * 2) / CGFloat(max(1, tabs.count)))
        VStack(spacing: HudSpacing.xs) {
            glassStatusLine
            tabRail(tabs, layout: layout, tabWidth: tabWidth, barWidth: barWidth)
        }
        // Floats clear of the home indicator instead of bleeding into it: the
        // whole point of the shape is the air around it.
        .padding(.top, HudSpacing.sm)
        .padding(.bottom, HudSpacing.xxs)
    }

    private func tabRail(
        _ tabs: [Surface],
        layout: ScoutLayoutMetrics,
        tabWidth: CGFloat,
        barWidth: CGFloat
    ) -> some View {
        HStack(spacing: 0) {
            ForEach(tabs) { glassTabButton($0, layout: layout, width: tabWidth) }
        }
        // Glass shows AROUND the seated tab — the seat has to sit in the rail,
        // not fill it, or the bar reads as a slab with a lid.
        .padding(.horizontal, HudSpacing.sm)
        .padding(.vertical, 10)
        .frame(width: barWidth)
        // The seat's travel and the glyph/label tint ease together, and this
        // animation overrides the shell's own surface crossfade for everything
        // inside the rail — the bar gets the spring, the surfaces keep their
        // fast, flat fade.
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.travel), value: surface)
        // Regular glass gives the busy Tail enough optical blur to read as an
        // atmosphere behind the rail rather than as a second layer of text.
        // The semantic backing is intentionally faint: the native material is
        // still doing the refraction and most of the opacity.
        .background {
            Capsule()
                .fill(
                    homePrecisionIsActive
                        ? homeLabPreset.chromeFill
                        : ScoutPalette.chrome.opacity(colorScheme == .dark ? 0.08 : 0.12)
                )
        }
        .modifier(HomeLabGlassMaterial(enabled: !homePrecisionIsActive))
        .overlay {
            Capsule()
                .stroke(homeTabRailBorder, lineWidth: HudStrokeWidth.thin)
        }
        .modifier(HomeLabNavigationDepth(enabled: !homePrecisionIsActive))
    }

    /// One glass-bar tab. Selection reads exactly as it does on the docked bar
    /// — accent glyph + label, still the only green down here — with the
    /// machined seat carrying the WHERE, so the accent stays rationed.
    @ViewBuilder
    private func glassTabButton(_ s: Surface, layout: ScoutLayoutMetrics, width: CGFloat) -> some View {
        let isSelected = surface == s
        Button {
            guard surface != s else { return }
            #if canImport(UIKit)
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            #endif
            selectSurface(s)
        } label: {
            VStack(spacing: HudSpacing.xxs) {
                Glyphic(kind: s.glyph, size: layout.tabGlyphSize)
                Text(s.navigationLabel)
                    .font(
                        HudFont.mono(
                            layout.tabLabelSize,
                            weight: homePrecisionIsActive ? homeLabPreset.monoWeight : .medium
                        )
                    )
                    .tracking(homePrecisionIsActive ? homeLabPreset.labelTracking : 0)
                    .lineLimit(1)
            }
            .foregroundStyle(
                isSelected
                    ? (homePrecisionIsActive ? homeLabPreset.accent : ScoutPalette.accent)
                    : (homePrecisionIsActive ? homeLabPreset.secondaryInk : ScoutInk.muted)
            )
            // Every selected droplet has exactly one column's footprint. The
            // shape no longer breathes wider for Terminal or narrower for Tail;
            // only the content inside it changes.
            .frame(width: width, height: layout.tabButtonHeight)
            .background {
                if isSelected {
                    Group {
                        if homePrecisionIsActive {
                            Capsule()
                                .fill(homeLabPreset.surfaceFill)
                                .overlay {
                                    Capsule()
                                        .stroke(homeLabPreset.border, lineWidth: HudStrokeWidth.thin)
                                }
                        } else {
                            ScoutLiquidNavigationSeat()
                        }
                    }
                    // One seat, shared identity: SwiftUI interpolates the frame
                    // between the tab that had it and the tab taking it, so the
                    // plate slides and stretches to its new label's width
                    // rather than teleporting. Reduce Motion drops the match
                    // (the seat simply appears where it belongs) — a matched
                    // geometry animated with `nil` is exactly a cut.
                    .matchedGeometryEffect(id: "glass-tab-seat", in: glassTabSeat)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var homeTabRailBorder: AnyShapeStyle {
        if homePrecisionIsActive {
            return AnyShapeStyle(homeLabPreset.border)
        }
        return AnyShapeStyle(
            LinearGradient(
                colors: [
                    Color.white.opacity(colorScheme == .dark ? 0.19 : 0.72),
                    ScoutHairline.standard.opacity(colorScheme == .dark ? 0.55 : 0.78),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    /// What the absorbed cockpit strip still owes you, and nothing else: one
    /// dim line above the glass bar, shown ONLY when the connection is down or
    /// the last good fetch has gone stale. Silence means "connected, fresh" —
    /// which is the state the calm chrome is designed for. Ticks on a 15s
    /// cadence (the readout is minutes-grained; a per-second timer would wake
    /// the whole shell for nothing).
    private var glassStatusLine: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            if let note = degradedNote(now: context.date) {
                Text(note)
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.6)
                    .foregroundStyle(ScoutInk.dim)
                    .allowsHitTesting(false)
            }
        }
    }

    /// The one honest sentence about a degraded shell: not connected, or the
    /// broker data has quietly stopped arriving (3 minutes ≈ nine missed poll
    /// cycles — a real stall, not one slow request).
    private func degradedNote(now: Date) -> String? {
        guard case .connected = model.connectionState else {
            return model.statusLabel.uppercased()
        }
        guard let fetchedAt = model.lastSuccessfulFetchAt else { return nil }
        let age = Int(now.timeIntervalSince(fetchedAt))
        guard age >= 180 else { return nil }
        return age < 3600 ? "STALE · \(age / 60)m" : "STALE · \(age / 3600)h"
    }

    /// Preserve the six-tab phone layout; mission control earns dedicated tabs
    /// only at iPad width, where its dense web canvases are actually useful.
    private func visibleSurfaces(_ layout: ScoutLayoutMetrics) -> [Surface] {
        if layout.physicalWidth >= 700 { return Surface.allCases }
        return Surface.phoneNavigationOrder
    }

    /// Leading run of the bottom status bar: how and where we're connected — the
    /// route (LAN / TSN / OSN, with a wi-fi glyph) or current state, then the Mac
    /// it lands on.
    private func appReadouts(_ layout: ScoutLayoutMetrics) -> [StatusReadout] {
        let stateLabel: String
        if case .connected(let route) = model.connectionState, !route.label.isEmpty {
            stateLabel = route.label.uppercased()
        } else {
            stateLabel = model.statusLabel.uppercased()
        }
        var items = [StatusReadout(glyph: .signal, pulses: model.statusPulses, label: stateLabel, tint: model.statusTint)]
        if let machine = model.pairedMachines.first(where: { $0.isActive }) {
            // Cap only the machine readout: a long hostname truncates here instead
            // of shoving the fleet stats — and every surface — off the screen. The
            // route + stat readouts stay intrinsic, so none of them truncate.
            items.append(
                StatusReadout(
                    dot: machine.isOnline ? ScoutPalette.accent : ScoutInk.dim,
                    label: machine.name,
                    tint: machine.isOnline ? ScoutPalette.ink : ScoutInk.muted,
                    maxLabelWidth: layout.statusMachineMaxLabelWidth
                )
            )
        }
        if let sessionStatusContext {
            items.append(
                StatusReadout(
                    label: sessionStatusContext,
                    tint: ScoutInk.dim,
                    maxLabelWidth: layout.isMiniPhone ? 96 : 160
                )
            )
        }
        return items
    }

    /// Trailing run: the fleet rollup — total agents, paired machines, and how
    /// many are active right now (accent when something's running).
    private func statsReadouts(_ layout: ScoutLayoutMetrics, now: Date) -> [StatusReadout] {
        var items = [
            fetchReadout(layout, now: now),
            StatusReadout(label: pluralized(model.agentCount, "agent"), tint: ScoutInk.muted),
            StatusReadout(
                label: "\(model.activeAgentCount) active",
                tint: model.activeAgentCount > 0 ? ScoutPalette.accent : ScoutInk.dim
            ),
        ]
        let machineTotal = model.pairedMachines.count
        if machineTotal > 0 {
            let online = model.pairedMachines.filter(\.isOnline).count
            items.insert(
                StatusReadout(
                    label: layout.isMiniPhone ? "\(online)/\(machineTotal)" : "\(online)/\(machineTotal) online",
                    tint: online > 0 ? ScoutPalette.accent : ScoutInk.dim
                ),
                at: 1
            )
        }
        return items
    }

    /// Trailing run of the CROWN-mode status line (summon-only): a trimmed
    /// fleet rollup. No FETCHED age — the operator rates seconds-since-fetch
    /// the least useful measure, and the vitals panel carries staleness. The
    /// phone also drops the host count (the LED right above already carries
    /// it); the wide canvas has the room and keeps it.
    private func crownStatsReadouts(_ layout: ScoutLayoutMetrics) -> [StatusReadout] {
        var items: [StatusReadout] = []
        let machineTotal = model.pairedMachines.count
        if layout.physicalWidth >= 700, machineTotal > 0 {
            let online = model.pairedMachines.filter(\.isOnline).count
            items.append(
                StatusReadout(
                    label: "\(online)/\(machineTotal) online",
                    tint: online > 0 ? ScoutPalette.accent : ScoutInk.dim
                )
            )
        }
        items.append(StatusReadout(label: pluralized(model.agentCount, "agent"), tint: ScoutInk.muted))
        items.append(
            StatusReadout(
                label: "\(model.activeAgentCount) active",
                tint: model.activeAgentCount > 0 ? ScoutPalette.accent : ScoutInk.dim
            )
        )
        return items
    }

    /// Compact, passive freshness readout. Shows the age of the last successful
    /// broker fetch ("FETCHED 12s") so the value counts up as data stalls instead
    /// of freezing at a wall-clock time. Deliberately quiet: staleness reads from
    /// the growing age itself, so there is no warn tint competing for attention —
    /// fresh is muted, long-stalled just sinks to dim.
    private func fetchReadout(_ layout: ScoutLayoutMetrics, now: Date) -> StatusReadout {
        guard let fetchedAt = model.lastSuccessfulFetchAt else {
            return StatusReadout(
                label: layout.isMiniPhone ? "SYNC —" : "FETCHED —",
                tint: ScoutInk.dim
            )
        }

        let age = max(0, Int(now.timeIntervalSince(fetchedAt)))
        let ageLabel: String
        if age < 60 {
            ageLabel = "\(age)s"
        } else if age < 3600 {
            ageLabel = "\(age / 60)m"
        } else {
            ageLabel = "\(age / 3600)h"
        }
        return StatusReadout(
            label: "\(layout.isMiniPhone ? "SYNC" : "FETCHED") \(ageLabel)",
            // 3 minutes ≈ nine missed poll cycles — a real stall, not one slow
            // request. Even then it only dims; the readout is telemetry, not an alarm.
            tint: age >= 180 ? ScoutInk.dim : ScoutInk.muted
        )
    }

    private func pluralized(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    @ViewBuilder
    private func tabButton(_ s: Surface, layout: ScoutLayoutMetrics, width: CGFloat) -> some View {
        let isSelected = surface == s
        Button {
            guard surface != s else { return }
            #if canImport(UIKit)
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            #endif
            selectSurface(s)
        } label: {
            VStack(spacing: HudSpacing.xxs) {
                Glyphic(kind: s.glyph, size: layout.tabGlyphSize)
                Text(s.rawValue)
                    .font(HudFont.mono(layout.tabLabelSize, weight: .medium))
                    .lineLimit(1)
                    // Shrink a hair rather than clip: guarantees the longest labels
                    // ("Terminal"/"Agents") still fit six-across at native width.
                    .minimumScaleFactor(0.75)
            }
            .padding(.horizontal, 1)
            // Active state is carried entirely by the accent glyph + label — no
            // indicator bar.
            .foregroundStyle(isSelected ? ScoutPalette.accent : ScoutInk.muted)
            // Explicit equal column width (not maxWidth) so labels shrink to fit
            // rather than overflowing the bar.
            .frame(width: width)
            .frame(height: layout.tabButtonHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func titleBar(_ layout: ScoutLayoutMetrics) -> some View {
        // A quiet masthead, lifted from the studio: a thin all-caps SCOUT
        // wordmark paired with two small circular complications (compose · gear)
        // over a refined hairline — no logo tile, no heavy weight.
        // The row is pinned to a DEFINITE width rather than left to fill: a wide
        // surface below can inflate the shared column, and an elastic masthead
        // rides that inflation until the trailing gear clips off the screen.
        let barWidth = max(0, layout.designWidth - layout.titleHorizontalPadding * 2)
        return VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.sm) {
                placesButton(layout)
                // The Entry home drops the wordmark: on the composer-first front
                // door the app's name is the one thing on the row that answers no
                // question you have. The complications and the host you're
                // steering carry the masthead instead. The Fleet home — a
                // dashboard, read at arm's length — keeps it.
                if !isEntryHome {
                    if homeIdentityEnabled {
                        EtchedScoutWordmark(size: layout.wordmarkSize)
                    } else {
                        Text("SCOUT")
                            .font(HudFont.ui(layout.wordmarkSize, weight: .light))
                            .tracking(2.5)
                            .foregroundStyle(ScoutPalette.ink)
                    }
                }
                // New carries its own HOST control, because choosing where a
                // session lands is that surface's whole first half. Repeating
                // the same machine in the masthead says it twice and makes the
                // operator wonder whether they are two different settings.
                if surface != .new, !model.pairedMachines.isEmpty {
                    machineArea
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // Without the wordmark the chip would butt against the
                        // places disc; give it the breath the wordmark used to
                        // occupy.
                        .padding(.leading, isEntryHome ? HudSpacing.sm : 0)
                } else {
                    // An EXPLICIT spacer, because an empty `Group` does not take
                    // part in layout however greedy a frame you hang on it. New
                    // has no host qualifier by design; an unpaired Home has no
                    // machine content yet. Both still need the leading utility
                    // and trailing utilities to own opposite screen edges.
                    // The complications seat on the EDGES: places top-left,
                    // bell + gear top-right, on every surface.
                    Spacer(minLength: 0)
                }
                notificationsButton(layout)
                settingsButton(layout)
            }
            .frame(width: barWidth)
            Rectangle()
                .fill(homePrecisionIsActive ? homeLabPreset.border : ScoutHairline.standard)
                .frame(width: barWidth, height: HudStrokeWidth.thin)
        }
        .padding(.horizontal, layout.titleHorizontalPadding)
        .padding(.top, layout.titleTopPadding)
        .padding(.bottom, layout.titleBottomPadding)
    }

    /// Shared host scope next to the wordmark. The quiet Scout hex owns one
    /// facet dot per paired Mac: filled means included in fleet-readable views,
    /// hollow means excluded, while accent/dim remains the secondary online
    /// signal. The native menu edits any non-empty subset without turning hosts
    /// into a standalone destination or a second masthead row.
    @ViewBuilder
    private var machineArea: some View {
        let machines = model.pairedMachines
        if !machines.isEmpty {
            let selectedIds = model.selectedMachineIds
            Menu {
                Section("Hosts") {
                    ForEach(machines) { machine in
                        let isSelected = selectedIds.contains(machine.id.lowercased())
                        Button {
                            Task { await model.toggleMachineFilter(machine.id) }
                        } label: {
                            Label(
                                machine.name,
                                systemImage: isSelected ? "checkmark.circle.fill" : "circle"
                            )
                        }
                        .accessibilityLabel(
                            "\(machine.name), \(machine.isOnline ? "online" : "offline"), \(isSelected ? "included" : "excluded")"
                        )
                        .disabled(isSelected && selectedIds.count == 1)
                        .menuActionDismissBehavior(.disabled)
                    }
                }
                if selectedIds.count < machines.count {
                    Button("Select all", systemImage: "checkmark.circle") {
                        Task { await model.selectMachineFilter(.all) }
                    }
                    .menuActionDismissBehavior(.disabled)
                }
                Divider()
                Button("Done") {}
            } label: {
                HostFacetQualifier(machines: machines, selectedIds: selectedIds)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .menuOrder(.fixed)
            .buttonStyle(.plain)
            .accessibilityHint("Choose which hosts appear in fleet views")
        }
    }

    /// The Notifications destination as a masthead complication, paired with the
    /// gear. The unread count rides the corner as a small accent pip — the one
    /// place in the chrome that carries a number, because "how many alerts have
    /// I not looked at" is the only count that should pull you somewhere.
    private func notificationsButton(_ layout: ScoutLayoutMetrics) -> some View {
        let unseen = model.notifications.unseenCount
        return Button { openNotifications() } label: {
            complicationDisc(.inbox, layout: layout, tint: unseen > 0 ? ScoutVibe.ink : ScoutInk.muted)
                .overlay(alignment: .topTrailing) {
                    if unseen > 0 {
                        Text(unseen > 99 ? "99+" : "\(unseen)")
                            .font(HudFont.mono(HudTextSize.micro - 1, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(ScoutPalette.bg)
                            .padding(.horizontal, 3)
                            .frame(minWidth: 14, minHeight: 14)
                            .background(Capsule().fill(ScoutVibe.accent))
                            .overlay(Capsule().stroke(ScoutPalette.bg, lineWidth: 1.5))
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(unseen > 0 ? "Notifications, \(unseen) unread" : "Notifications")
    }

    /// The way to everywhere else — leading the masthead, because a new user's
    /// first question is "where can I go", and the answer should not be "read
    /// the tab bar".
    private func placesButton(_ layout: ScoutLayoutMetrics) -> some View {
        Button { showPlaces = true } label: {
            complicationDisc(.places, layout: layout)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Places")
    }

    /// ONE masthead complication family — places leading, bell + gear trailing,
    /// all three cut from the crown's machined plate at the crown's own SEAT
    /// scale (`CrownSizing.seat`), so the top row reads as instruments rather
    /// than as outlined icons. Calmer than the crown only where the masthead
    /// demands it: a single contact shadow instead of the crown's floating
    /// pair. Never the accent — the rule the crown study set.
    @ViewBuilder
    private func complicationDisc(
        _ glyph: GlyphShape.Kind,
        layout: ScoutLayoutMetrics,
        tint: Color = ScoutInk.muted
    ) -> some View {
        let sizing = CrownSizing.resolve(layout)
        if homePrecisionIsActive {
            Circle()
                .fill(homeLabPreset.surfaceFill)
                .overlay {
                    Circle()
                        .stroke(homeLabPreset.border, lineWidth: HudStrokeWidth.thin)
                }
                .overlay {
                    Glyphic(kind: glyph, size: sizing.seatGlyph)
                        .foregroundStyle(homeLabPreset.secondaryInk)
                }
            .frame(width: sizing.seat, height: sizing.seat)
            .contentShape(Circle())
        } else {
            ScoutMachinedPlate(shape: Circle(), lightReach: sizing.seat, grainOpacity: 0.035)
                .overlay(Glyphic(kind: glyph, size: sizing.seatGlyph).foregroundStyle(tint))
                .frame(width: sizing.seat, height: sizing.seat)
                .scoutFloatingSurface(.control)
        }
    }

    #if DEBUG
    /// A simulator/developer overlay, never release chrome. It switches complete
    /// art-direction systems rather than isolated tokens, so every row is a
    /// meaningful permutation the team can judge in context.
    @ViewBuilder
    private var homeLabControl: some View {
        if homeLabExpanded {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: HudSpacing.sm) {
                    Text("HOME STYLE LAB")
                        .font(HudFont.mono(9, weight: .light))
                        .tracking(1.5)
                        .foregroundStyle(Color.white.opacity(0.56))
                    Spacer(minLength: HudSpacing.md)
                    Button("DONE") { homeLabExpanded = false }
                        .font(HudFont.mono(9, weight: .light))
                        .tracking(0.8)
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .padding(.leading, HudSpacing.lg)

                Rectangle()
                    .fill(Color.white.opacity(0.16))
                    .frame(height: HudStrokeWidth.thin)

                ForEach(ScoutHomeLabPreset.allCases) { preset in
                    Button {
                        homeLabPresetRaw = preset.rawValue
                    } label: {
                        HStack(spacing: HudSpacing.md) {
                            Text(preset.code)
                                .font(HudFont.mono(9, weight: .light))
                                .tracking(0.8)
                                .foregroundStyle(
                                    preset == homeLabPreset
                                        ? ScoutPalette.accent
                                        : Color.white.opacity(0.36)
                                )
                                .frame(width: 32, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(preset.title)
                                    .font(HudFont.ui(12, weight: .light))
                                    .foregroundStyle(Color.white.opacity(0.88))
                                Text(preset.blurb)
                                    .font(HudFont.mono(8.5, weight: .light))
                                    .foregroundStyle(Color.white.opacity(0.38))
                            }
                            Spacer(minLength: 0)
                            Rectangle()
                                .fill(preset == homeLabPreset ? ScoutPalette.accent : Color.clear)
                                .frame(width: 13, height: HudStrokeWidth.thin)
                        }
                        .padding(.horizontal, HudSpacing.lg)
                        .frame(height: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(preset == homeLabPreset ? Color.white.opacity(0.035) : Color.clear)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(Color.white.opacity(0.08))
                            .frame(height: HudStrokeWidth.thin)
                    }
                }
            }
            .frame(width: 286)
            .background(Color.black.opacity(0.96))
            .overlay(Rectangle().stroke(Color.white.opacity(0.20), lineWidth: HudStrokeWidth.thin))
        } else {
            Button { homeLabExpanded = true } label: {
                HStack(spacing: HudSpacing.sm) {
                    Text("LAB")
                        .foregroundStyle(Color.white.opacity(0.42))
                    Rectangle()
                        .fill(ScoutPalette.accent)
                        .frame(width: 8, height: HudStrokeWidth.thin)
                    Text(homeLabPreset.code)
                        .foregroundStyle(Color.white.opacity(0.82))
                }
                .font(HudFont.mono(9, weight: .light))
                .tracking(0.8)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Color.black.opacity(0.94))
                .overlay(Rectangle().stroke(Color.white.opacity(0.18), lineWidth: HudStrokeWidth.thin))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open Home style lab, \(homeLabPreset.title) selected")
        }
    }
    #endif

    /// A literal map of the bottom rail: identical destinations, order, names,
    /// and glyphs. Notifications and Settings already have masthead controls;
    /// adding them here used to create a competing information architecture.
    private var placesSheet: some View {
        #if canImport(UIKit)
        let surfaces = UIDevice.current.userInterfaceIdiom == .pad
            ? Surface.allCases
            : Surface.phoneNavigationOrder
        #else
        let surfaces = Surface.phoneNavigationOrder
        #endif
        let places = surfaces.map { destination in
            ScoutPlace(
                glyph: destination.glyph,
                name: destination.navigationLabel,
                blurb: destination.navigationBlurb
            ) {
                selectSurface(destination)
            }
        }
        return NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(places) { place in
                        Button {
                            // Run AFTER the sheet is gone — two of these open
                            // sheets of their own, and iOS drops the second
                            // presentation if the first is still on screen.
                            pendingPlace = place.go
                            showPlaces = false
                        } label: {
                            HStack(spacing: HudSpacing.xxl) {
                                Glyphic(kind: place.glyph, size: 19)
                                    .foregroundStyle(ScoutInk.muted)
                                    .frame(width: 34, height: 34)
                                    .background(Circle().fill(ScoutSurface.inset))
                                    .overlay(Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(place.name)
                                        .font(HudFont.ui(HudTextSize.md, weight: .medium))
                                        .foregroundStyle(ScoutPalette.ink)
                                    Text(place.blurb)
                                        .font(HudFont.ui(HudTextSize.sm))
                                        .foregroundStyle(ScoutInk.dim)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                Glyphic.chevron(.trailing, size: 12)
                                    .foregroundStyle(ScoutInk.dim)
                            }
                            .padding(.vertical, HudSpacing.xl)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .bottom) {
                            if place.id != places.last?.id { HudDivider(color: ScoutHairline.subtle) }
                        }
                    }
                }
                .padding(.horizontal, HudSpacing.xxl)
            }
            .background(ScoutPalette.bg)
            .navigationTitle("Places")
            .navigationBarTitleDisplayMode(.inline)
        }
        // Sized so the whole map is on screen at rest — a destination list you
        // have to scroll to see the end of is not a map.
        .presentationDetents([.fraction(0.68), .large])
        .presentationDragIndicator(.visible)
    }

    /// Settings, trailing the complication family.
    private func settingsButton(_ layout: ScoutLayoutMetrics) -> some View {
        Button { showSettings = true } label: {
            complicationDisc(.gear, layout: layout)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
    }
}

/// The masthead's compact fleet scope. Its label names a single selected Mac,
/// reports the full host count, or shows subset coverage; the mark itself keeps
/// the richer one-dot-per-host selection state visible without another row.
private struct HostFacetQualifier: View {
    let machines: [AppModel.PairedMachine]
    let selectedIds: Set<String>

    private var selectedMachines: [AppModel.PairedMachine] {
        machines.filter { selectedIds.contains($0.id.lowercased()) }
    }

    private var label: String {
        if selectedMachines.count == 1, let machine = selectedMachines.first {
            return machine.name
        }
        if selectedMachines.count == machines.count {
            return "\(machines.count) hosts"
        }
        return "\(selectedMachines.count)/\(machines.count) hosts"
    }

    private var accessibilityValue: String {
        let names = selectedMachines.map(\.name).joined(separator: ", ")
        let online = selectedMachines.filter(\.isOnline).count
        return "\(selectedMachines.count) of \(machines.count) selected: \(names). \(online) online."
    }

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            HostFacetMark(machines: machines, selectedIds: selectedIds)
            Text(label)
                .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 92, alignment: .leading)
            Image(systemName: "chevron.down")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ScoutInk.dim)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Hosts")
        .accessibilityValue(accessibilityValue)
    }
}

/// Facets is the selected Studio geometry: the first four hosts occupy the
/// pointy hex's top, right, bottom, and left facets. Larger fleets keep the
/// one-dot-per-host promise by distributing all dots around the same inner ring.
/// Fill is selection; stroke color is availability, so neither meaning relies
/// on color alone.
private struct HostFacetMark: View {
    let machines: [AppModel.PairedMachine]
    let selectedIds: Set<String>

    private static let cardinalFacets = [
        CGPoint(x: 0.50, y: 0.31),
        CGPoint(x: 0.69, y: 0.50),
        CGPoint(x: 0.50, y: 0.69),
        CGPoint(x: 0.31, y: 0.50),
    ]

    private var points: [CGPoint] {
        if machines.count <= Self.cardinalFacets.count {
            return Array(Self.cardinalFacets.prefix(machines.count))
        }
        return machines.indices.map { index in
            let angle = -.pi / 2 + (2 * .pi * CGFloat(index) / CGFloat(machines.count))
            return CGPoint(x: 0.5 + cos(angle) * 0.22, y: 0.5 + sin(angle) * 0.22)
        }
    }

    private var dotDiameter: CGFloat {
        machines.count <= 4 ? 3.8 : max(2.2, 4.4 - CGFloat(machines.count) * 0.24)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ScoutHexagon()
                    .stroke(ScoutInk.muted.opacity(0.82), lineWidth: 1)
                ScoutHexagon()
                    .scale(0.54)
                    .stroke(ScoutInk.dim.opacity(0.58), lineWidth: 0.75)

                ForEach(Array(machines.enumerated()), id: \.element.id) { index, machine in
                    let isSelected = selectedIds.contains(machine.id.lowercased())
                    let signal = machine.isOnline ? ScoutPalette.accent : ScoutInk.dim
                    let point = points[index]
                    Circle()
                        .fill(isSelected ? signal : ScoutPalette.bg)
                        .overlay(Circle().stroke(signal, lineWidth: 0.8))
                        .frame(width: dotDiameter, height: dotDiameter)
                        .position(x: proxy.size.width * point.x, y: proxy.size.height * point.y)
                }
            }
        }
        .frame(width: 20, height: 22)
        .allowsHitTesting(false)
    }
}

/// The normal wordmark's exact type metrics, finished as a dark letterpress:
/// four sub-point edge impressions surround a graphite face, and the faint
/// top-to-bottom shading gives the inset face an inner shadow without changing
/// the masthead's layout or introducing a logo tile.
private struct EtchedScoutWordmark: View {
    let size: CGFloat

    private var face: some View {
        Text("SCOUT")
            .font(HudFont.ui(size, weight: .light))
            .tracking(2.5)
    }

    var body: some View {
        ZStack {
            face.foregroundStyle(Color.black.opacity(0.72)).offset(y: 0.65)
            face.foregroundStyle(ScoutInk.dim.opacity(0.48)).offset(x: -0.4)
            face.foregroundStyle(ScoutInk.dim.opacity(0.48)).offset(x: 0.4)
            face.foregroundStyle(ScoutInk.dim.opacity(0.42)).offset(y: -0.4)
            face.foregroundStyle(ScoutInk.dim.opacity(0.34)).offset(y: 0.4)
            face.foregroundStyle(
                LinearGradient(
                    colors: [ScoutSignalSurface.edge.opacity(0.78), ScoutSignalSurface.top],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Scout")
    }
}

/// Keeps the Home finish studies on the exact same capsule geometry while
/// allowing the material and depth stack to be switched off independently.
private struct HomeLabGlassMaterial: ViewModifier {
    let enabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.hudLiquidBarMaterial(tint: .regular)
        } else {
            content
        }
    }
}

private struct HomeLabNavigationDepth: ViewModifier {
    let enabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.scoutFloatingSurface(.navigation)
        } else {
            content
        }
    }
}

/// One destination on the Places map: a glyph, its name, and the one sentence
/// that says what you'd go there to do. `go` is the shell's OWN navigation —
/// there is no route here that doesn't already exist.
private struct ScoutPlace: Identifiable {
    let glyph: GlyphShape.Kind
    let name: String
    let blurb: String
    let go: () -> Void

    var id: String { name }
}
