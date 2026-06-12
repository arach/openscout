import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// Top-level navigation for Scout. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the NavigationStack + dark Hudson
/// background) and switches between Home, Agents, Comms, Terminal, and New via
/// the docked tab bar. (Tail's firehose folds into Home's activity preview.)
struct RootView: View {
    @Bindable var model: AppModel
    @State private var showConnection = false
    @State private var showSettings = false
    @State private var sessionStatusContext: String?

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
        case comms = "Comms"
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
            case .comms: return .comms
            case .terminal: return .terminal
            case .new: return .plus
            }
        }
    }

    @State private var surface: Surface = Self.initialSurface

    /// Launch tab. Defaults to Home; in DEBUG a `SCOUT_TAB` env value
    /// (e.g. "Comms") jumps straight to a surface so the simulator can verify
    /// any tab without driving touch input. Never affects release builds.
    private static var initialSurface: Surface {
        #if DEBUG
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
                                        Task { await model.connect(toMachineId: machine.id) }
                                    },
                                    onConversationStatusContext: { sessionStatusContext = $0 },
                                    onSeeAllAgents: {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                            surface = .agents
                                        }
                                    },
                                    reloadToken: model.dataReadyToken
                                )
                            case .agents:
                                AgentsSurface(
                                    client: client,
                                    reloadToken: model.dataReadyToken,
                                    onConversationStatusContext: { sessionStatusContext = $0 }
                                )
                            case .comms:    CommsSurface(client: client, reloadToken: model.dataReadyToken)
                            case .terminal: TerminalSurface(
                                client: client,
                                reloadToken: model.dataReadyToken,
                                terminalTargetID: activeMachine?.id,
                                connectedHost: model.terminalSSHHost,
                                onReconnectBridge: { Task { await model.reconnect() } },
                                onOpenConnectionSettings: { showConnection = true }
                            )
                            case .new:
                                NewSessionSurface(
                                    client: client,
                                    targetMachineName: activeMachineName,
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
                    ScoutStatusBar(leading: appReadouts(layout), trailing: statsReadouts(layout))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .ignoresSafeArea(edges: .bottom)
                        // The nav stack leaves a residual inset; push the last bit so
                        // the bar sits flush in the indicator band, not floating.
                        .offset(y: 14)
                }
                .task(id: model.dataReadyToken) {
                    // Keep the status bar's agent / active counts roughly live while
                    // the shell is up. Cheap directory read on a slow poll.
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
            AppSettingsView(model: model)
        }
        #if DEBUG
        // Sim verification hook (sibling to `SCOUT_TAB`): open Settings on
        // launch so the inspector panels can be screenshotted without touch input.
        .onAppear {
            if ProcessInfo.processInfo.environment["SCOUT_OPEN_SETTINGS"] != nil {
                showSettings = true
            }
        }
        #endif
        .onChange(of: surface) { _, _ in sessionStatusContext = nil }
    }

    /// Conventional docked tab bar (vs the floating `HudLiquidBar` pill): a
    /// full-width material pinned to the bottom that bleeds through the home
    /// indicator. App-local on purpose — it renders the unified hand-drawn glyph
    /// set, which the shared `HudLiquidBarTabRow` can't (it takes SF Symbol
    /// strings only). Selection chrome mirrors the shared component exactly.
    private func dockedTabBar(_ layout: ScoutLayoutMetrics) -> some View {
        HStack(spacing: HudSpacing.sm) {
            ForEach(Surface.allCases) { tabButton($0, layout: layout) }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, layout.tabBarTopPadding)
        .padding(.horizontal, layout.tabBarHorizontalPadding)
        .background(alignment: .top) {
            Rectangle()
                // Light, glassy translucency — frosted blur that lets the
                // content scroll through softly underneath.
                .fill(.ultraThinMaterial)
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
    private func statsReadouts(_ layout: ScoutLayoutMetrics) -> [StatusReadout] {
        var items = [
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

    private func pluralized(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    @ViewBuilder
    private func tabButton(_ s: Surface, layout: ScoutLayoutMetrics) -> some View {
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
            }
            // Active state is carried entirely by the accent glyph + label — no
            // indicator bar.
            .foregroundStyle(isSelected ? HudPalette.accent : ScoutInk.muted)
            .frame(maxWidth: .infinity)
            .frame(height: layout.tabButtonHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func titleBar(_ layout: ScoutLayoutMetrics) -> some View {
        // Center-aligned so the trailing complications (status pill + gear button)
        // sit on one axis with the Scout wordmark.
        // Editorial: the wordmark row over a refined neutral hairline, so the
        // header reads as a deliberate masthead rather than floating chrome.
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.md) {
                Text("Scout")
                    .font(HudFont.ui(layout.wordmarkSize, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Spacer()
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

    /// Settings as a contained icon complication — an inset circular button so it
    /// reads as a control paired with the status pill, not a stray glyph.
    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Glyphic(kind: .gear, size: 21)
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 38, height: 38)
                .background(Circle().fill(HudSurface.inset))
                .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
    }
}
