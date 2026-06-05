import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities

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

        var icon: String {
            switch self {
            case .home: return "square.grid.2x2"
            case .agents: return "person.2"
            case .comms: return "bubble.left.and.bubble.right"
            case .terminal: return "terminal"
            case .new: return "plus.bubble"
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
            VStack(spacing: 0) {
                titleBar

                Group {
                    switch surface {
                    case .home:     HomeSurface(model: model, onSelectMachine: { _ in showConnection = true }, reloadToken: model.dataReadyToken)
                    case .agents:   AgentsSurface(client: client, reloadToken: model.dataReadyToken)
                    case .comms:    CommsSurface(client: client, reloadToken: model.dataReadyToken)
                    case .terminal: TerminalSurface(client: client, reloadToken: model.dataReadyToken, connectedHost: model.terminalSSHHost)
                    case .new:      NewSessionSurface(client: client, targetMachineName: activeMachineName)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            // Docked tab bar: a full-width material pinned to the bottom edge,
            // bleeding through the home-indicator area. `safeAreaInset` insets the
            // surfaces' scroll content above it, and the material masks anything
            // that scrolls behind it — the conventional iOS pattern, no stranded
            // rows in a gap beneath a floating pill.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                dockedTabBar
            }
        }
        .sheet(isPresented: $showConnection) {
            ConnectionView(model: model)
        }
        // Settings is a full page, not a card sheet — the shell carries its own
        // close control, so present it edge-to-edge.
        .fullScreenCover(isPresented: $showSettings) {
            AppSettingsView(model: model)
        }
    }

    private var tabs: [HudLiquidBarTab] {
        Surface.allCases.map { HudLiquidBarTab(id: $0.id, icon: $0.icon, title: $0.rawValue) }
    }

    /// EXPERIMENT: conventional docked tab bar (vs the floating `HudLiquidBar`
    /// pill). Reuses the shared `HudLiquidBarTabRow` buttons, but wraps them in a
    /// full-width material that pins to the bottom and bleeds through the home
    /// indicator. Lives here, app-level — the shared component is untouched.
    private var dockedTabBar: some View {
        HudLiquidBarTabRow(tabs: tabs, selection: tabSelection)
            .frame(maxWidth: .infinity)
            .padding(.top, HudSpacing.sm)
            // Extra side room so the leading/trailing selected capsule doesn't
            // clip against the bar edge.
            .padding(.horizontal, HudSpacing.xxl)
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

    private var tabSelection: Binding<HudLiquidBarTab.ID> {
        Binding(
            get: { surface.id },
            set: { surface = Surface(rawValue: $0) ?? .home }
        )
    }

    private var titleBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            Text("Scout")
                .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
            Text("Next")
                .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                .tracking(2)
                .foregroundStyle(HudPalette.accent)
            Spacer()
            Button { showConnection = true } label: {
                HudBadge(model.statusLabel, tint: model.statusTint, dot: true)
            }
            .buttonStyle(.plain)
            Button { showSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(HudFont.ui(HudTextSize.md, weight: .regular))
                    .foregroundStyle(HudPalette.muted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xl)
    }
}
