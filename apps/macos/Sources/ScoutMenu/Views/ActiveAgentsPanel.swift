import AppKit
import ScoutAppCore
import SwiftUI

/// Who is working right now, in the menu-bar popup.
///
/// Optional by construction: with nothing active this is an `EmptyView`, so it
/// costs no height and no spacing in the host stack. That also means it never
/// receives `onAppear` while empty, so **the host view owns the store's
/// start/stop** — see the integration note that ships with this module.
///
/// Height: the popup sizes its popover by hand, so this panel publishes its own
/// geometry. Use `ActiveAgentsPanel.heightContribution(for:stackSpacing:)` for
/// the number to add to the popover height, or `preferredHeight` for the
/// worst case (4 rows plus the overflow line).
struct ActiveAgentsPanel: View {
    @ObservedObject var store: ActiveAgentsStore
    var onOpenAgent: (ScoutAgent) -> Void

    // MARK: - Geometry (mirrored by the host's manual popover height math)

    static let rowHeight: CGFloat = 44
    static let rowSpacing: CGFloat = 5
    static let headerHeight: CGFloat = 12
    static let headerSpacing: CGFloat = 6
    static let overflowRowHeight: CGFloat = 12

    static func height(rowCount: Int, hasOverflow: Bool) -> CGFloat {
        guard rowCount > 0 else { return 0 }
        let rows = CGFloat(rowCount) * rowHeight + CGFloat(rowCount - 1) * rowSpacing
        let overflow = hasOverflow ? rowSpacing + overflowRowHeight : 0
        return headerHeight + headerSpacing + rows + overflow
    }

    /// Worst case: a full four rows plus "+N more".
    static let preferredHeight: CGFloat = height(
        rowCount: ActiveAgentsStore.visibleRowLimit,
        hasOverflow: true
    )

    /// Exactly what the host should add to its popover height, including the
    /// stack spacing the panel would otherwise leave behind. 0 when the panel
    /// is hiding itself.
    static func heightContribution(for store: ActiveAgentsStore, stackSpacing: CGFloat = 14) -> CGFloat {
        guard store.hasContent else { return 0 }
        return height(rowCount: store.visibleRowCount, hasOverflow: store.overflowCount > 0) + stackSpacing
    }

    var body: some View {
        if store.hasContent {
            VStack(alignment: .leading, spacing: Self.headerSpacing) {
                header
                VStack(spacing: Self.rowSpacing) {
                    ForEach(store.visibleAgents) { agent in
                        ActiveAgentRow(agent: agent) { onOpenAgent(agent) }
                    }
                    if store.overflowCount > 0 {
                        overflowLine
                    }
                }
            }
            .animation(.easeOut(duration: 0.18), value: store.agents)
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text("ACTIVE AGENTS")
                .font(MenuType.mono(9, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(ShellPalette.dim)
            Spacer(minLength: 4)
            Text("\(store.agents.count)")
                .font(MenuType.mono(9, weight: .bold))
                .foregroundStyle(ShellPalette.muted)
                .monospacedDigit()
        }
        .frame(height: Self.headerHeight)
        .padding(.horizontal, 4)
    }

    private var overflowLine: some View {
        HStack {
            Text("+\(store.overflowCount) more")
                .font(MenuType.mono(9, weight: .bold))
                .foregroundStyle(ShellPalette.muted)
            Spacer(minLength: 0)
        }
        .frame(height: Self.overflowRowHeight)
        .padding(.horizontal, 4)
    }
}

/// One agent, one optional action: the whole row opens it. No secondary
/// buttons, no filters — the popup reports, the web app is where you act.
private struct ActiveAgentRow: View {
    let agent: ScoutAgent
    let action: () -> Void

    @State private var isHovered = false

    private var needsYou: Bool { ActiveAgentsStore.needsYou(agent) }
    private var isWorking: Bool { agent.state == .working }

    var body: some View {
        Button(action: action) { card }
            .buttonStyle(.plain)
            .help("Open \(agent.displayName) in Scout")
            .accessibilityLabel("\(agent.displayName), \(ActiveAgentsStore.activityLabel(for: agent))")
            .accessibilityHint("Opens this agent in the Scout web app")
    }

    private var card: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(agent.displayName)
                        .font(MenuType.bodyMedium(11.5))
                        .foregroundStyle(ShellPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer(minLength: 4)

                    Text(ActiveAgentsStore.activityLabel(for: agent))
                        .font(MenuType.mono(9, weight: .medium))
                        .foregroundStyle(needsYou ? ShellPalette.accent : ShellPalette.dim)
                        .lineLimit(1)
                        .fixedSize()
                }

                Text(ActiveAgentsStore.detailLabel(for: agent))
                    .font(MenuType.body(10))
                    .foregroundStyle(ShellPalette.muted)
                    .lineLimit(1)
                    .truncationMode(needsYou ? .tail : .middle)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: ActiveAgentsPanel.rowHeight)
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(fill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(border, lineWidth: 1)
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.12)) {
                isHovered = hovering
            }
            if hovering {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }

    /// One accent, rationed: it marks the agents that are live or waiting on
    /// you. Everything else stays grey — no per-state color coding.
    private var dotColor: Color {
        needsYou || isWorking ? ShellPalette.accent : ShellPalette.muted
    }

    private var fill: Color {
        if needsYou {
            return isHovered ? ShellPalette.accentPressed : ShellPalette.accentSoft
        }
        return isHovered ? ShellPalette.surfaceFillStrong : ShellPalette.card
    }

    private var border: Color {
        if needsYou { return ShellPalette.accent.opacity(0.4) }
        return isHovered ? ShellPalette.lineStrong : ShellPalette.line
    }
}
