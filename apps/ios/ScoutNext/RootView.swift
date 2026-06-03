import SwiftUI
import HudsonShell
import HudsonUI
import ScoutCapabilities

/// Top-level navigation for ScoutNext. Wraps the active surface in the
/// `HudPhoneAppShell` (which supplies the NavigationStack + dark Hudson
/// background) and switches between Home, New Session, and Tail with a HUD
/// segmented control pinned under the title.
struct RootView: View {
    let client: any ScoutBrokerClient

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

    @State private var surface: Surface = RootView.initialSurface()

    /// Honors a `-surface home|new|tail` launch argument so each surface can be
    /// driven deterministically (e.g. for screenshots) without on-screen taps.
    private static func initialSurface() -> Surface {
        if let raw = UserDefaults.standard.string(forKey: "surface"),
           let parsed = Surface(rawValue: raw.capitalized) {
            return parsed
        }
        return .home
    }

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
            }
            // Floating liquid-glass tab bar — the iOS-native Hudson nav pattern.
            // Content runs full-bleed behind the glass; tabs sit over the bottom.
            .safeAreaInset(edge: .bottom) {
                HudLiquidBar(tabs: tabs, selection: tabSelection)
            }
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
            HudBadge("offline mock", tint: HudPalette.statusWarn, dot: true)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xl)
    }
}
