import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// Top-level navigation for Scout. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the NavigationStack + dark Hudson
/// background) and switches between the native phone surfaces plus iPad-only
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var navMode: ScoutNavMode { ScoutNavMode.resolve(navModeRaw) }

    /// The composer-first front door is on. It picks the app's chrome, not just
    /// Home's body: the calm masthead and the floating glass bar below.
    private var isEntryHome: Bool { ScoutHomeStyle.resolve(homeStyleRaw) == .entry }

    /// Liquid-glass bottom chrome — a flavor of TABS chrome under the Entry
    /// home, never entangled with crown mode (the crown owns the bottom on its
    /// own terms and is unchanged by this).
    private var usesGlassChrome: Bool { navMode == .tabs && isEntryHome }

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
        HudPhoneAppShell {
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
                                MissionControlSurface(model: model, kind: .lanes, isActive: surface == .lanes)
                            }
                            surfaceLayer(.deck) {
                                MissionControlSurface(model: model, kind: .deck, isActive: surface == .deck)
                            }
                            surfaceLayer(.dispatch) {
                                MissionControlSurface(model: model, kind: .dispatch, isActive: surface == .dispatch)
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
                        }
                        // Crown mode reserves NOTHING at the bottom: surface
                        // content flows through behind the floating crown, and
                        // the crown's own drop shadows keep it legible on top.
                    }
                    // Crown mode reserves a top zone so surface headers clear the
                    // permanent top strip + LED. Zero effect in tabs mode.
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if navMode == .crown {
                            Color.clear.frame(height: CrownMetric.topReserve(for: layout))
                        }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                        keyboardIsUp = true
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
                                .transition(.move(edge: .bottom).combined(with: .opacity))
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
                    motionEnabled: homeMotionEnabled
                )
                .ignoresSafeArea()
            }
        }
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
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                surface = .comms
            }
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
    private func surfaceLayer<Content: View>(
        _ candidate: Surface,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let isActive = surface == candidate
        return content()
            .opacity(isActive ? 1 : 0)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
            .zIndex(isActive ? 1 : 0)
    }

    private func selectSurface(_ next: Surface) {
        guard surface != next else { return }
        if reduceMotion {
            surface = next
        } else {
            withAnimation(.easeOut(duration: 0.18)) { surface = next }
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
                // Solid near-black chrome, the studio way — an opaque bar, not a
                // frosted-glass wash (the translucency read as a flat grey slab
                // over the dark canvas). Separation comes from the lit lip +
                // upward shadow, not translucency.
                .fill(HudPalette.bg)
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
                .shadow(color: Color.black.opacity(0.6), radius: 11, y: -6)
        }
        .environment(\.colorScheme, .dark)
    }

    /// Liquid-glass tab bar — the Apple-shaped bottom chrome the Entry home
    /// wears. A capsule floating inset from every edge, drawn with the REAL
    /// iOS 26 glass: `hudLiquidBarMaterial` resolves to `.glassEffect(.regular,
    /// in: .capsule)` and only Reduce Transparency drops it to a solid plate.
    /// The current tab is seated on the same machined plate the masthead
    /// complications are cut from — graphite instruments in a glass rail, so
    /// the top-left and the bottom read as one system.
    private func glassTabBar(_ layout: ScoutLayoutMetrics) -> some View {
        let tabs = visibleSurfaces(layout)
        let sideInset = layout.isNarrowPhone ? HudSpacing.xxl : HudSpacing.xxxl
        // Same equal-column discipline as the docked bar: an explicit width per
        // tab so "Terminal" shrinks inside its column instead of overflowing.
        let barWidth = max(0, layout.designWidth - sideInset * 2)
        let tabWidth = max(0, (barWidth - HudSpacing.sm * 2) / CGFloat(max(1, tabs.count)))
        return VStack(spacing: HudSpacing.xs) {
            glassStatusLine
            tabRail(tabs, layout: layout, tabWidth: tabWidth, barWidth: barWidth)
        }
        // Floats clear of the home indicator instead of bleeding into it: the
        // whole point of the shape is the air around it.
        .padding(.top, HudSpacing.sm)
        .padding(.bottom, HudSpacing.xxs)
        .environment(\.colorScheme, .dark)
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
        .padding(.vertical, HudSpacing.sm)
        .frame(width: barWidth)
        .hudLiquidBarMaterial(tint: .regular)
        // The rail is edged like the complications it seats: the same top rim
        // light + hairline the machined plates carry, over the glass rather
        // than over graphite. This is what makes the masthead and the bar read
        // as one system instead of two materials that happen to share a screen.
        .overlay(ScoutMachinedRim(shape: Capsule()))
        .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
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
                Text(s.rawValue)
                    .font(HudFont.mono(layout.tabLabelSize, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? HudPalette.accent : ScoutInk.muted)
            // The seat HUGS its tab (Apple's shape), so it can't be sized off
            // the equal column the way the docked bar's columns are. The
            // longest label ("Terminal") still clears its neighbours at both
            // phone widths — hence fixed, unscaled type here.
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: layout.tabButtonHeight)
            .background {
                if isSelected {
                    ScoutMachinedPlate(
                        shape: Capsule(),
                        rimBoost: 0.15,
                        lightReach: layout.tabButtonHeight,
                        grainOpacity: 0.05
                    )
                }
            }
            .frame(width: width)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
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
        return Surface.allCases.filter { $0 != .lanes && $0 != .deck && $0 != .dispatch }
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
                    dot: machine.isOnline ? HudPalette.accent : ScoutInk.dim,
                    label: machine.name,
                    tint: machine.isOnline ? HudPalette.ink : ScoutInk.muted,
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
                tint: model.activeAgentCount > 0 ? HudPalette.accent : ScoutInk.dim
            ),
        ]
        let machineTotal = model.pairedMachines.count
        if machineTotal > 0 {
            let online = model.pairedMachines.filter(\.isOnline).count
            items.insert(
                StatusReadout(
                    label: layout.isMiniPhone ? "\(online)/\(machineTotal)" : "\(online)/\(machineTotal) online",
                    tint: online > 0 ? HudPalette.accent : ScoutInk.dim
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
                    tint: online > 0 ? HudPalette.accent : ScoutInk.dim
                )
            )
        }
        items.append(StatusReadout(label: pluralized(model.agentCount, "agent"), tint: ScoutInk.muted))
        items.append(
            StatusReadout(
                label: "\(model.activeAgentCount) active",
                tint: model.activeAgentCount > 0 ? HudPalette.accent : ScoutInk.dim
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
            .foregroundStyle(isSelected ? HudPalette.accent : ScoutInk.muted)
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
                            .foregroundStyle(HudPalette.ink)
                    }
                }
                machineArea
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // Without the wordmark the chip would butt against the places
                    // disc; give it the breath the wordmark used to occupy.
                    .padding(.leading, isEntryHome ? HudSpacing.sm : 0)
                notificationsButton(layout)
                settingsButton(layout)
            }
            .frame(width: barWidth)
            Rectangle()
                .fill(HudHairline.standard)
                .frame(width: barWidth, height: HudStrokeWidth.thin)
        }
        .padding(.horizontal, layout.titleHorizontalPadding)
        .padding(.top, layout.titleTopPadding)
        .padding(.bottom, layout.titleBottomPadding)
    }

    /// Host area next to the wordmark — which connected Mac you're looking at.
    /// One paired Mac → a single compact host chip (an indicator, not a filter).
    /// More than one → a horizontally-scrollable filter: "All" plus each Mac,
    /// the active one lit. Nothing until at least one Mac is paired.
    @ViewBuilder
    private var machineArea: some View {
        let machines = model.pairedMachines
        if machines.count == 1 {
            hostChip(name: machines[0].name, online: machines[0].isOnline, selected: false, action: nil)
        } else if machines.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.xs) {
                    hostChip(
                        name: "All",
                        online: machines.contains(where: \.isOnline),
                        selected: model.machineFilter == .all
                    ) { Task { await model.selectMachineFilter(.all) } }
                    ForEach(machines) { machine in
                        hostChip(
                            name: machine.name,
                            online: machine.isOnline,
                            selected: model.machineFilter == .machine(machine.id)
                        ) { Task { await model.selectMachineFilter(.machine(machine.id)) } }
                    }
                }
                .padding(.trailing, HudSpacing.sm)
            }
        }
    }

    /// One host chip: an online dot + name in a low-radius plate. `selected` signals the
    /// active filter through contrast (lifted fill, ink text, brighter edge) — no
    /// accent, so the row stays calm. Tappable only when an action is supplied.
    @ViewBuilder
    private func hostChip(name: String, online: Bool, selected: Bool, action: (() -> Void)?) -> some View {
        // Near-square corners (not a capsule): the studio chrome is all crisp
        // plates and hairlines, and a full stadium read as bubbly against it.
        let plate = RoundedRectangle(cornerRadius: 5, style: .continuous)
        let chip = HStack(spacing: HudSpacing.xs) {
            Circle()
                .fill(online ? HudPalette.accent : ScoutInk.dim)
                .frame(width: 5, height: 5)
            Text(name)
                .font(HudFont.mono(10.5, weight: .medium))
                .foregroundStyle(selected ? HudPalette.ink : ScoutInk.muted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 92, alignment: .leading)
        }
        .padding(.horizontal, HudSpacing.sm)
        .padding(.vertical, 3)
        .background(plate.fill(selected ? ScoutSurface.raised : ScoutSurface.inset))
        .overlay(plate.stroke(selected ? ScoutInk.dim : HudHairline.standard, lineWidth: HudStrokeWidth.thin))

        if let action {
            Button(action: action) { chip }
                .buttonStyle(.plain)
                .accessibilityLabel("Filter host \(name)")
        } else {
            chip.accessibilityLabel("Host \(name)")
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
                            .foregroundStyle(HudPalette.bg)
                            .padding(.horizontal, 3)
                            .frame(minWidth: 14, minHeight: 14)
                            .background(Capsule().fill(ScoutVibe.accent))
                            .overlay(Capsule().stroke(HudPalette.bg, lineWidth: 1.5))
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
    private func complicationDisc(
        _ glyph: GlyphShape.Kind,
        layout: ScoutLayoutMetrics,
        tint: Color = ScoutInk.muted
    ) -> some View {
        let sizing = CrownSizing.resolve(layout)
        return ScoutMachinedPlate(shape: Circle(), lightReach: sizing.seat, grainOpacity: 0.05)
            .overlay(Glyphic(kind: glyph, size: sizing.seatGlyph).foregroundStyle(tint))
            .frame(width: sizing.seat, height: sizing.seat)
            .shadow(color: .black.opacity(0.45), radius: 3, y: 1.5)
    }

    /// The map. Every row is REAL navigation this shell already performs — tab
    /// selection, the bell's route, the gear's sheet — so there is nothing here
    /// that leads nowhere. Mission Control's lanes/deck/dispatch are deliberately
    /// left out: they are a power surface, not one of the places a new operator
    /// is looking for.
    private var placesSheet: some View {
        let places: [ScoutPlace] = [
            ScoutPlace(glyph: .agent, name: "Agents", blurb: "Who's working, and on what") { selectSurface(.agents) },
            ScoutPlace(glyph: .comms, name: "Comms", blurb: "Conversations with your agents") { selectSurface(.comms) },
            ScoutPlace(glyph: .tail, name: "Tail", blurb: "Watch the work stream live") { selectSurface(.tail) },
            ScoutPlace(glyph: .plus, name: "New session", blurb: "Start an agent on something") { selectSurface(.new) },
            ScoutPlace(glyph: .terminal, name: "Terminal", blurb: "A shell on your paired Mac") { selectSurface(.terminal) },
            ScoutPlace(glyph: .inbox, name: "Notifications", blurb: "What asked for you") { openNotifications() },
            ScoutPlace(glyph: .gear, name: "Settings", blurb: "Connection, appearance, what Home shows") { showSettings = true },
        ]
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
                                    .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(place.name)
                                        .font(HudFont.ui(HudTextSize.md, weight: .medium))
                                        .foregroundStyle(HudPalette.ink)
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
                            if place.id != places.last?.id { HudDivider(color: HudHairline.subtle) }
                        }
                    }
                }
                .padding(.horizontal, HudSpacing.xxl)
            }
            .background(HudPalette.bg)
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
