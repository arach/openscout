import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities

/// Top-level navigation for ScoutNext. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the NavigationStack + dark Hudson
/// background) and switches between Home, New Session, and Tail via the
/// floating liquid-glass tab bar.
struct RootView: View {
    @Bindable var model: AppModel
    @State private var showConnection = false

    private var client: any ScoutBrokerClient { model.client }

    enum Surface: String, CaseIterable, Identifiable {
        case home = "Home"
        case new = "New"
        case tail = "Tail"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .home: return "square.grid.2x2"
            case .new: return "plus.bubble"
            case .tail: return "waveform"
            }
        }
    }

    @State private var surface: Surface = .home

    var body: some View {
        HudPhoneAppShell {
            VStack(spacing: 0) {
                titleBar

                Group {
                    switch surface {
                    case .home: HomeSurface(client: client)
                    case .new:  NewSessionSurface(client: client)
                    case .tail: TailSurface(client: client)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // Re-key surfaces when the data source flips so they reload.
                .id(model.source)
            }
            // Floating liquid-glass tab bar — the iOS-native Hudson nav pattern.
            // Content runs full-bleed behind the glass; tabs sit over the bottom.
            .safeAreaInset(edge: .bottom) {
                HudLiquidBar(tabs: tabs, selection: tabSelection)
            }
        }
        .sheet(isPresented: $showConnection) {
            ConnectionView(model: model)
        }
    }

    private var tabs: [HudLiquidBarTab] {
        Surface.allCases.map { HudLiquidBarTab(id: $0.id, icon: $0.icon, title: $0.rawValue) }
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
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xl)
    }
}
