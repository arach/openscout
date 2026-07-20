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
                        titleBar(layout)

                        Group {
                            switch surface {
                            case .home:
                                HomeSurface(
                                    model: model,
                                    onSelectMachine: { machine in
                                        Task { await model.selectMachineFilter(.machine(machine.id)) }
                                    },
                                    onSelectAll: {
                                        Task { await model.selectMachineFilter(.all) }
                                    },
                                    onConversationStatusContext: { sessionStatusContext = $0 },
                                    onSeeAllAgents: {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                            surface = .agents
                                        }
                                    },
                                    onSeeAllActivity: {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                            surface = .comms
                                        }
                                    },
                                    onCompose: {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                            surface = .new
                                        }
                                    },
                                    reloadToken: model.fleetDataReadyToken
                                )
                            case .agents:
                                AgentsSurface(
                                    model: model,
                                    onConversationStatusContext: { sessionStatusContext = $0 }
                                )
                            case .tail:
                                TailSurface(model: model, reloadToken: model.fleetDataReadyToken)
                            case .comms:
                                CommsSurface(
                                    model: model,
                                    reloadToken: model.fleetDataReadyToken,
                                    notificationRoute: model.pendingNotificationRoute
                                )
                            case .lanes:    MissionControlSurface(model: model, kind: .lanes)
                            case .dispatch: MissionControlSurface(model: model, kind: .dispatch)
                            case .terminal: TerminalSurface(
                                client: client,
                                diagnostics: terminalDiagnostics,
                                reloadToken: model.dataReadyToken,
                                terminalTargetID: activeMachine?.id,
                                connectedHost: model.terminalSSHHost,
                                onReconnectBridge: { Task { await model.reconnect() } },
                                onOpenConnectionSettings: { showConnection = true },
                                isPresentingSettings: showSettings
                            )
                            case .new:
                                NewSessionSurface(
                                    model: model,
                                    client: client,
                                    reloadToken: model.dataReadyToken,
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
                        dockedTabBar(layout)
                    }

                    // Read-only connection readout pinned flush to the true screen
                    // bottom, inside the home-indicator protected zone. The combo that
                    // makes it hug the edge instead of floating at the safe-area
                    // boundary: fill down + bottom-align the content, THEN ignore the
                    // bottom safe area. Safe to sit on the swipe-up gesture —
                    // hit-testing is off, it's a pure readout.
                    // Tick independently of broker polling so "FETCH NOW" ages
                    // into seconds/minutes even when a stalled request produces no
                    // model mutation. The timestamp itself only advances after a
                    // successfully decoded broker query (see BrokerRequestLog).
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
            .background { ScoutCanvas().ignoresSafeArea() }
        }
        .sheet(isPresented: $showConnection) {
            ConnectionView(model: model)
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
            guard route != nil else { return }
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                surface = .comms
            }
        }
        .onAppear {
            if model.pendingNotificationRoute != nil {
                surface = .comms
            }
        }
        .onChange(of: surface) { _, _ in sessionStatusContext = nil }
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

    /// Compact, passive freshness readout. This is deliberately a wall-clock
    /// confirmation rather than "FETCH NOW": the protected area reports state
    /// and never presents text that looks like an action.
    private func fetchReadout(_ layout: ScoutLayoutMetrics, now: Date) -> StatusReadout {
        guard let fetchedAt = model.lastSuccessfulFetchAt else {
            return StatusReadout(
                label: layout.isMiniPhone ? "SYNC —" : "FETCHED —",
                tint: ScoutInk.dim
            )
        }

        let age = max(0, Int(now.timeIntervalSince(fetchedAt)))
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        let clock = formatter.string(from: fetchedAt)
        return StatusReadout(
            label: "\(layout.isMiniPhone ? "SYNC" : "FETCHED") \(clock)",
            tint: age >= 60 ? HudPalette.statusWarn : ScoutInk.muted
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
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) { surface = s }
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
                Text("SCOUT")
                    .font(HudFont.ui(layout.wordmarkSize, weight: .light))
                    .tracking(3)
                    .foregroundStyle(HudPalette.ink)
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

    /// One host chip: an online dot + name in a capsule. `selected` signals the
    /// active filter through contrast (lifted fill, ink text, brighter edge) — no
    /// accent, so the row stays calm. Tappable only when an action is supplied.
    @ViewBuilder
    private func hostChip(name: String, online: Bool, selected: Bool, action: (() -> Void)?) -> some View {
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
        .background(Capsule().fill(selected ? ScoutSurface.raised : ScoutSurface.inset))
        .overlay(Capsule().stroke(selected ? ScoutInk.dim : HudHairline.standard, lineWidth: HudStrokeWidth.thin))

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
