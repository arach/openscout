import ScoutCore
import SwiftUI

private enum ScoutSidebarLayout {
    static let compactWidth: CGFloat = 52
    static let expandedWidth: CGFloat = 178
    static let compactRowSize = CGSize(width: 36, height: 34)
    static let expandedRowHeight: CGFloat = 32
    static let logoBlockWidth: CGFloat = 52
    static let logoSize: CGFloat = 28
    static let iconSize: CGFloat = 14
}

struct ScoutSidebarView: View {
    @Bindable var viewModel: ScoutShellViewModel

    private var isCompact: Bool {
        !viewModel.sidebarExpanded
    }

    private var primaryRoutes: [ScoutRoute] {
        [.home, .sessions, .console]
    }

    private var secondaryRoutes: [ScoutRoute] {
        [.integrations, .workers, .settings]
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.top, 8)
                .padding(.bottom, 14)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    sidebarGroup(primaryRoutes)
                    sidebarGroup(secondaryRoutes, title: "System")
                }
                .padding(.horizontal, isCompact ? 8 : 10)
                .padding(.vertical, 6)
            }

            Spacer(minLength: 0)

            VStack(spacing: 8) {
                Rectangle()
                    .fill(ScoutTheme.border)
                    .frame(height: 1)
                    .padding(.horizontal, 10)

                utilityButton(label: "Settings", icon: "gearshape") {
                    viewModel.selectedRoute = .settings
                }
            }
            .padding(.horizontal, isCompact ? 8 : 10)
            .padding(.top, 10)
            .padding(.bottom, 10)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(ScoutTheme.sidebar)
    }

    private var header: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                viewModel.toggleSidebar()
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "scope")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(ScoutTheme.accent)
                    .frame(width: ScoutSidebarLayout.logoSize, height: ScoutSidebarLayout.logoSize)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(ScoutTheme.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .strokeBorder(ScoutTheme.border.opacity(0.55), lineWidth: 0.75)
                            )
                    )
                    .frame(width: ScoutSidebarLayout.logoBlockWidth, alignment: .center)

                if viewModel.sidebarExpanded {
                    Text("OpenScout")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(ScoutTheme.ink)
                        .transition(.opacity)
                }

                Spacer(minLength: 0)
            }
            .frame(height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(false)
        .focusEffectDisabled()
        .padding(.horizontal, isCompact ? 0 : 10)
    }

    @ViewBuilder
    private func sidebarGroup(_ routes: [ScoutRoute], title: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title, viewModel.sidebarExpanded {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(0.6)
                    .foregroundStyle(ScoutTheme.inkFaint)
                    .padding(.leading, 12)
                    .padding(.bottom, 2)
            }

            ForEach(routes) { route in
                ScoutSidebarRouteButton(
                    route: route,
                    isSelected: viewModel.selectedRoute == route,
                    isCompact: isCompact
                ) {
                    viewModel.selectedRoute = route
                }
            }
        }
    }

    private func utilityButton(label: String, icon: String, action: @escaping () -> Void) -> some View {
        ScoutSidebarUtilityButton(
            label: label,
            icon: icon,
            isCompact: isCompact,
            action: action
        )
    }
}

private struct ScoutSidebarRouteButton: View {
    let route: ScoutRoute
    let isSelected: Bool
    let isCompact: Bool
    let action: () -> Void

    @State private var isHovered = false
    @State private var frame: CGRect = .zero

    private var iconName: String {
        if isSelected {
            switch route.systemImage {
            case "square.grid.2x2": return "square.grid.2x2.fill"
            case "clock.arrow.trianglehead.counterclockwise.rotate.90": return "clock.fill"
            case "globe": return "globe.americas.fill"
            case "point.3.connected.trianglepath.dotted": return "point.3.filled.connected.trianglepath.dotted"
            case "cpu": return "cpu.fill"
            case "gearshape": return "gearshape.fill"
            default: return route.systemImage
            }
        }

        return route.systemImage
    }

    var body: some View {
        Button(action: action) {
            if isCompact {
                Image(systemName: iconName)
                    .font(.system(size: ScoutSidebarLayout.iconSize, weight: .medium))
                    .foregroundStyle(isSelected ? ScoutTheme.accent : (isHovered ? ScoutTheme.inkSecondary : ScoutTheme.inkMuted))
                    .frame(width: ScoutSidebarLayout.compactRowSize.width, height: ScoutSidebarLayout.compactRowSize.height)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(isSelected ? ScoutTheme.selection : (isHovered ? ScoutTheme.hover : Color.clear))
                    )
            } else {
                HStack(spacing: 10) {
                    Image(systemName: iconName)
                        .font(.system(size: ScoutSidebarLayout.iconSize, weight: .medium))
                        .foregroundStyle(isSelected ? ScoutTheme.accent : ScoutTheme.inkMuted)
                        .frame(width: 16, alignment: .center)

                    Text(route.title)
                        .font(.system(size: 12))
                        .foregroundStyle(isSelected ? ScoutTheme.ink : ScoutTheme.inkSecondary)
                        .lineLimit(1)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .frame(height: ScoutSidebarLayout.expandedRowHeight)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isSelected ? ScoutTheme.selection : (isHovered ? ScoutTheme.hover : Color.clear))
                )
            }
        }
        .buttonStyle(.plain)
        .focusable(false)
        .focusEffectDisabled()
        .background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { frame = geo.frame(in: .global) }
                    .onChange(of: geo.frame(in: .global)) { _, newValue in
                        frame = newValue
                    }
            }
        }
        .onHover { hovering in
            isHovered = hovering
        }
        .onContinuousHover { phase in
            guard isCompact else { return }
            let tooltip = ScoutSidebarTooltipState.shared
            switch phase {
            case .active:
                let anchor = CGPoint(x: frame.maxX + 2, y: frame.midY)
                if tooltip.label == route.title {
                    tooltip.update(anchor: anchor)
                } else {
                    tooltip.show(label: route.title, anchor: anchor)
                }
            case .ended:
                tooltip.dismiss(matching: route.title)
            }
        }
    }
}

private struct ScoutSidebarUtilityButton: View {
    let label: String
    let icon: String
    let isCompact: Bool
    let action: () -> Void

    @State private var isHovered = false
    @State private var frame: CGRect = .zero

    var body: some View {
        Button(action: action) {
            if isCompact {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(isHovered ? ScoutTheme.inkSecondary : ScoutTheme.inkMuted)
                    .frame(width: ScoutSidebarLayout.compactRowSize.width, height: ScoutSidebarLayout.compactRowSize.height)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(isHovered ? ScoutTheme.hover : Color.clear)
                    )
            } else {
                HStack(spacing: 10) {
                    Image(systemName: icon)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(isHovered ? ScoutTheme.inkSecondary : ScoutTheme.inkMuted)
                        .frame(width: 16, alignment: .center)

                    Text(label)
                        .font(.system(size: 12))
                        .foregroundStyle(isHovered ? ScoutTheme.inkSecondary : ScoutTheme.inkMuted)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .frame(height: ScoutSidebarLayout.expandedRowHeight)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isHovered ? ScoutTheme.hover : Color.clear)
                )
            }
        }
        .buttonStyle(.plain)
        .focusable(false)
        .focusEffectDisabled()
        .background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { frame = geo.frame(in: .global) }
                    .onChange(of: geo.frame(in: .global)) { _, newValue in
                        frame = newValue
                    }
            }
        }
        .onHover { hovering in
            isHovered = hovering
        }
        .onContinuousHover { phase in
            guard isCompact else { return }
            let tooltip = ScoutSidebarTooltipState.shared
            switch phase {
            case .active:
                let anchor = CGPoint(x: frame.maxX + 2, y: frame.midY)
                if tooltip.label == label {
                    tooltip.update(anchor: anchor)
                } else {
                    tooltip.show(label: label, anchor: anchor)
                }
            case .ended:
                tooltip.dismiss(matching: label)
            }
        }
    }
}
