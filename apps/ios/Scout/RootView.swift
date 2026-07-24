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
    @State private var crownAssembled = true
    @State private var notificationLandingRoute: AppModel.NotificationRoute?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var navMode: ScoutNavMode { ScoutNavMode.resolve(navModeRaw) }

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
                                    onCompose: { selectSurface(.new) },
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
                                    onConversationStatusContext: { sessionStatusContext = $0 }
                                )
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    // Docked tab bar: a full-width material pinned to the bottom edge,
                    // bleeding through the home-indicator area. `safeAreaInset` insets
                    // the surfaces' scroll content above it, and the material masks
                    // anything that scrolls behind it — the conventional iOS pattern.
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if navMode == .tabs {
                            dockedTabBar(layout)
                        } else {
                            // Reserve room so surface content clears the floating crown bar.
                            Color.clear.frame(height: 96)
                        }
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
                    if navMode == .tabs {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            ScoutStatusBar(
                                leading: appReadouts(layout),
                                trailing: statsReadouts(layout, now: context.date)
                            )
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .ignoresSafeArea(edges: .bottom)
                        // The nav stack leaves a residual inset; push the last bit so
                        // the bar sits flush in the indicator band, not floating.
                        .offset(y: 14)
                    } else {
                        // Crown mode: the crown chrome replaces both the tab bar and
                        // the status strip (the LED carries fleet aliveness instead).
                        CrownNavChrome(
                            model: model,
                            currentSurface: surface,
                            onSelect: { selectSurface($0) },
                            onSettings: { showSettings = true },
                            onConnect: { showConnection = true },
                            assembled: $crownAssembled
                        )
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
        .sheet(item: $notificationLandingRoute) { route in
            NotificationLandingSheet(
                model: model,
                route: route,
                onOpenHome: {
                    notificationLandingRoute = nil
                    selectSurface(.home)
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
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

    private func openNotification(_ route: AppModel.NotificationRoute) {
        if route.conversationId != nil {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                surface = .comms
            }
            return
        }

        notificationLandingRoute = route
        model.consumeNotificationRoute(route)
    }

    private var settingsContext: AppSettingsContext {
        switch surface {
        case .home: .home
        case .agents: .agents
        case .tail: .tail
        case .comms: .comms
        case .lanes: .lanes
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

    /// Preserve the six-tab phone layout; mission control earns dedicated tabs
    /// only at iPad width, where its dense web canvases are actually useful.
    private func visibleSurfaces(_ layout: ScoutLayoutMetrics) -> [Surface] {
        if layout.physicalWidth >= 700 { return Surface.allCases }
        return Surface.allCases.filter { $0 != .lanes && $0 != .dispatch }
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
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.sm) {
                if homeIdentityEnabled {
                    EtchedScoutWordmark(size: layout.wordmarkSize)
                } else {
                    Text("SCOUT")
                        .font(HudFont.ui(layout.wordmarkSize, weight: .light))
                        .tracking(2.5)
                        .foregroundStyle(HudPalette.ink)
                }
                machineArea
                    .frame(maxWidth: .infinity, alignment: .leading)
                settingsButton
            }
            Rectangle()
                .fill(HudHairline.standard)
                .frame(height: HudStrokeWidth.thin)
                .frame(maxWidth: .infinity)
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

    /// Settings as a contained icon complication — an inset circular button so it
    /// reads as a control paired with the host area, not a stray glyph.
    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Glyphic(kind: .gear, size: 16)
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 30, height: 30)
                .background(Circle().fill(ScoutSurface.inset))
                .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
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

/// Resolves an opaque APNs correlation id against the paired Mac and presents
/// the actual situation locally. This keeps prompts, commands, paths, and error
/// details out of APNs while still giving every non-conversation alert a real
/// destination when the operator opens it.
private struct NotificationLandingSheet: View {
    let model: AppModel
    let route: AppModel.NotificationRoute
    let onOpenHome: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var item: MobileNotificationItem?
    @State private var itemClient: (any ScoutBrokerClient)?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var answer = ""
    @State private var isSubmitting = false
    @State private var actionResult: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                Group {
                    if isLoading {
                        HudEmptyState(
                            title: "Loading notification",
                            subtitle: "Fetching details from your paired Mac.",
                            icon: "bell"
                        )
                    } else if let item {
                        notificationDetail(item)
                    } else {
                        HudEmptyState(
                            title: fallbackTitle,
                            subtitle: loadError ?? "This notification is no longer active on the paired Mac.",
                            icon: "bell.slash"
                        )
                        Button("Open Home", action: onOpenHome)
                            .buttonStyle(.borderedProminent)
                            .tint(ScoutVibe.accent)
                            .padding(.top, HudSpacing.lg)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(HudSpacing.xxl)
            }
            .background(HudPalette.bg.ignoresSafeArea())
            .navigationTitle("Notification")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task(id: route.id) { await load() }
    }

    @ViewBuilder
    private func notificationDetail(_ item: MobileNotificationItem) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HStack(alignment: .firstTextBaseline) {
                Text(kindLabel(item.kind).uppercased())
                    .font(HudFont.mono(9, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(kindTint(item.kind))
                Spacer()
                Text(item.sessionName)
                    .font(HudFont.mono(9))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }

            Text(item.title)
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutVibe.ink)

            Text(item.description)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .textSelection(.enabled)

            if let detail = item.detail?.trimmingCharacters(in: .whitespacesAndNewlines), !detail.isEmpty,
               detail != item.description {
                Text(detail)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
                    .textSelection(.enabled)
                    .padding(HudSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 7).fill(ScoutSurface.inset))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            }

            notificationActions(item)

            if let actionResult {
                Text(actionResult)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(actionResult == "Sent" ? ScoutVibe.accent : ScoutVibe.amber)
            }
        }
    }

    @ViewBuilder
    private func notificationActions(_ item: MobileNotificationItem) -> some View {
        if item.kind == "approval",
           item.turnId != nil, item.blockId != nil, item.version != nil {
            HStack(spacing: HudSpacing.sm) {
                Button("Deny") { Task { await decide(.deny, item: item) } }
                    .buttonStyle(.bordered)
                Button("Approve") { Task { await decide(.approve, item: item) } }
                    .buttonStyle(.borderedProminent)
                    .tint(ScoutVibe.accent)
            }
            .disabled(isSubmitting || actionResult == "Sent")
        } else if item.kind == "question", item.turnId != nil, item.blockId != nil {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                TextField("Answer", text: $answer, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Send answer") { Task { await submitAnswer(item) } }
                    .buttonStyle(.borderedProminent)
                    .tint(ScoutVibe.accent)
                    .disabled(
                        isSubmitting
                            || actionResult == "Sent"
                            || answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
            }
        } else {
            Button("Open Home", action: onOpenHome)
                .buttonStyle(.borderedProminent)
                .tint(ScoutVibe.accent)
        }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        var completedRead = false

        for machine in model.agentMachines() {
            guard let client = machine.client,
                  let notifications = client as? any MobileNotificationCapability else { continue }
            do {
                let items = try await notifications.mobileNotifications()
                completedRead = true
                if let match = matchingItem(in: items) {
                    item = match
                    itemClient = client
                    isLoading = false
                    return
                }
            } catch {
                loadError = "Couldn’t load details from \(machine.name)."
            }
        }

        if !completedRead, loadError == nil {
            loadError = "Connect to the paired Mac to load this notification."
        }
        isLoading = false
    }

    private func matchingItem(in items: [MobileNotificationItem]) -> MobileNotificationItem? {
        if let itemId = route.itemId,
           let exact = items.first(where: { $0.id == itemId }) {
            return exact
        }
        guard let sessionId = route.sessionId else { return nil }
        return items.first { candidate in
            candidate.sessionId == sessionId
                && (route.turnId == nil || candidate.turnId == route.turnId)
                && (route.blockId == nil || candidate.blockId == route.blockId)
        }
    }

    private func decide(_ decision: ActionDecisionSpec.Decision, item: MobileNotificationItem) async {
        guard let client = itemClient,
              let turnId = item.turnId,
              let blockId = item.blockId,
              let version = item.version else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await client.decideAction(ActionDecisionSpec(
                conversationId: item.sessionId,
                turnId: turnId,
                blockId: blockId,
                decision: decision,
                version: version
            ))
            actionResult = "Sent"
        } catch {
            actionResult = "Couldn’t send the decision. Refresh and try again."
        }
    }

    private func submitAnswer(_ item: MobileNotificationItem) async {
        guard let client = itemClient,
              let turnId = item.turnId,
              let blockId = item.blockId else { return }
        let value = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await client.answerQuestion(QuestionAnswerSpec(
                conversationId: item.sessionId,
                turnId: turnId,
                blockId: blockId,
                answer: [value]
            ))
            actionResult = "Sent"
        } catch {
            actionResult = "Couldn’t send the answer. Refresh and try again."
        }
    }

    private var fallbackTitle: String {
        guard let kind = route.kind else { return "Notification unavailable" }
        return kindLabel(kind)
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "approval": return "Approval needed"
        case "question": return "Question"
        case "failed_action": return "Action failed"
        case "failed_turn": return "Turn failed"
        case "session_error": return "Session error"
        case "native_attention": return "Needs attention"
        case "delivery_issue": return "Delivery issue"
        default: return "Agent notification"
        }
    }

    private func kindTint(_ kind: String) -> Color {
        switch kind {
        case "failed_action", "failed_turn", "session_error": return .red
        case "approval", "question", "native_attention": return ScoutVibe.amber
        default: return ScoutVibe.accent
        }
    }
}
