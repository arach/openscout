import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// Top-level navigation for ScoutNext. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the NavigationStack + dark Hudson
/// background) and switches between Home, Agents, Comms, Terminal, and New via
/// the docked tab bar. (Tail's firehose folds into Home's activity preview.)
struct RootView: View {
    @Bindable var model: AppModel
    @State private var showConnection = false
    @State private var showSettings = false

    private var client: any ScoutBrokerClient { model.client }

    /// Friendly name of the Mac we're connected to, for the New composer's
    /// read-only target. nil when unconnected.
    private var activeMachineName: String? {
        model.pairedMachines.first(where: { $0.isActive })?.name
    }

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
            case .agents: return .agents
            case .comms: return .comms
            case .terminal: return .terminal
            case .new: return .plus
            }
        }
    }

    @State private var surface: Surface = Self.initialSurface

    /// Launch tab. Defaults to Home; in DEBUG a `SCOUTNEXT_TAB` env value
    /// (e.g. "Comms") jumps straight to a surface so the simulator can verify
    /// any tab without driving touch input. Never affects release builds.
    private static var initialSurface: Surface {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["SCOUTNEXT_TAB"],
           let s = Surface(rawValue: raw) { return s }
        #endif
        return .home
    }

    var body: some View {
        HudPhoneAppShell {
            // Author every surface through ScoutNext's phone layout frame. The
            // 13 mini gets native sizing with compact metrics; only narrower
            // widths scale down. See `DesignFrame`.
            DesignFrame { layout in
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        titleBar(layout)

                        Group {
                            switch surface {
                            case .home:     HomeSurface(model: model, onSelectMachine: { _ in showConnection = true }, reloadToken: model.dataReadyToken)
                            case .agents:   AgentsSurface(client: client, reloadToken: model.dataReadyToken)
                            case .comms:    CommsSurface(client: client, reloadToken: model.dataReadyToken)
                            case .terminal: TerminalSurface(client: client, reloadToken: model.dataReadyToken, connectedHost: model.terminalSSHHost)
                            case .new:      NewSessionSurface(client: client, targetMachineName: activeMachineName, reloadToken: model.dataReadyToken)
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
        // Sim verification hook (sibling to `SCOUTNEXT_TAB`): open Settings on
        // launch so the inspector panels can be screenshotted without touch input.
        .onAppear {
            if ProcessInfo.processInfo.environment["SCOUTNEXT_OPEN_SETTINGS"] != nil {
                showSettings = true
            }
        }
        #endif
    }

    /// Conventional docked tab bar (vs the floating `HudLiquidBar` pill): a
    /// full-width material pinned to the bottom that bleeds through the home
    /// indicator. App-local on purpose — it renders the unified hand-drawn glyph
    /// set, which the shared `HudLiquidBarTabRow` can't (it takes SF Symbol
    /// strings only). Selection chrome mirrors the shared component exactly.
    private func dockedTabBar(_ layout: ScoutNextLayoutMetrics) -> some View {
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
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(HudHairline.standard)
                        .frame(height: HudStrokeWidth.thin)
                }
                .ignoresSafeArea(edges: .bottom)
        }
        .environment(\.colorScheme, .dark)
    }

    /// Leading run of the bottom status bar: how and where we're connected — the
    /// route (LAN / TSN / OSN, with a wi-fi glyph) or current state, then the Mac
    /// it lands on.
    private func appReadouts(_ layout: ScoutNextLayoutMetrics) -> [StatusReadout] {
        let stateLabel: String
        if case .connected(let route) = model.connectionState, !route.label.isEmpty {
            stateLabel = route.label.uppercased()
        } else {
            stateLabel = model.statusLabel.uppercased()
        }
        var items = [StatusReadout(glyph: .signal, label: stateLabel, tint: model.statusTint)]
        if let machine = activeMachineName {
            // Cap only the machine readout: a long hostname truncates here instead
            // of shoving the fleet stats — and every surface — off the screen. The
            // route + stat readouts stay intrinsic, so none of them truncate.
            items.append(StatusReadout(label: machine, tint: HudPalette.muted, maxLabelWidth: layout.statusMachineMaxLabelWidth))
        }
        return items
    }

    /// Trailing run: the fleet rollup — total agents, paired machines, and how
    /// many are active right now (accent when something's running).
    private func statsReadouts(_ layout: ScoutNextLayoutMetrics) -> [StatusReadout] {
        var items = [
            StatusReadout(label: pluralized(model.agentCount, "agent"), tint: HudPalette.muted),
            StatusReadout(
                label: "\(model.activeAgentCount) active",
                tint: model.activeAgentCount > 0 ? HudPalette.accent : HudPalette.dim
            ),
        ]
        if !layout.isMiniPhone {
            items.insert(StatusReadout(label: pluralized(model.pairedMachines.count, "machine"), tint: HudPalette.muted), at: 1)
        }
        return items
    }

    private func pluralized(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    @ViewBuilder
    private func tabButton(_ s: Surface, layout: ScoutNextLayoutMetrics) -> some View {
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
            .foregroundStyle(isSelected ? HudPalette.ink : HudPalette.muted)
            .frame(maxWidth: .infinity)
            .frame(height: layout.tabButtonHeight)
            .background {
                if isSelected {
                    Capsule()
                        .fill(HudSurface.selected(HudPalette.accent))
                        .overlay(Capsule().stroke(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.thin))
                        // A faint lit halo so the active tab glows rather than
                        // just tinting.
                        .shadow(color: HudPalette.accent.opacity(0.22), radius: 7)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func titleBar(_ layout: ScoutNextLayoutMetrics) -> some View {
        // Center-aligned so the trailing complications (status pill + gear button)
        // sit on one axis. The wordmark keeps its own baseline alignment inside a
        // nested group so "Scout"/"Next" stay typographically locked.
        HStack(spacing: HudSpacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                Text("Scout")
                    .font(HudFont.ui(layout.wordmarkSize, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Text("Next")
                    .font(HudFont.mono(layout.nextBadgeSize, weight: .bold))
                    .tracking(layout.nextBadgeTracking)
                    .foregroundStyle(ScoutCanvas.accentGradient)
            }
            Spacer()
            settingsButton
        }
        .padding(.horizontal, layout.titleHorizontalPadding)
        .padding(.top, layout.titleTopPadding)
        .padding(.bottom, layout.titleBottomPadding)
    }

    /// Settings as a contained icon complication — an inset circular button so it
    /// reads as a control paired with the status pill, not a stray glyph.
    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Glyphic(kind: .gear, size: 16)
                .foregroundStyle(HudPalette.muted)
                .frame(width: 30, height: 30)
                .background(Circle().fill(HudSurface.inset))
                .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
    }
}
