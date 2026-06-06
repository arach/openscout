import SwiftUI
import HudsonUI

// MARK: - Cockpit status bar
//
// The bottom readout that rides the home-indicator protected zone. Built from
// small `StatusReadout` cells grouped into a leading and a trailing run, with the
// center kept clear for the home indicator. Read-only by contract — telemetry,
// never a control. Think tmux / htop status line: route, fleet, machine, all at a
// glance, and trivially extensible by appending readouts.

/// One readout cell — an optional (optionally pulsing) status dot followed by a
/// short mono label. The atom the bar is built from.
struct StatusReadout: View, Identifiable {
    let id = UUID()
    var dot: Color? = nil
    var glyph: GlyphShape.Kind? = nil
    var pulses: Bool = false
    let label: String
    var tint: Color = HudPalette.muted

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            if let glyph {
                Glyphic(kind: glyph, size: 11)
                    .foregroundStyle(tint)
            } else if let dot {
                HudStatusDot(color: dot, size: 5, pulses: pulses)
            }
            Text(label)
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .tracking(0.4)
                .foregroundStyle(tint)
                .lineLimit(1)
        }
        .fixedSize()
    }
}

/// The status bar itself: a leading run + a trailing run of readouts, separated
/// within a run by a faint middot, with the center left open for the home
/// indicator. Generous side insets so edge readouts clear the rounded corners.
struct ScoutStatusBar: View {
    var leading: [StatusReadout] = []
    var trailing: [StatusReadout] = []

    /// Insets the runs to where the rounded bottom corners straighten out, so the
    /// first/last readout sits on the flat edge rather than riding the curve.
    private let sideInset: CGFloat = 42

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            run(leading)
            Spacer(minLength: HudSpacing.lg)
            run(trailing)
        }
        .padding(.horizontal, sideInset)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: HudLayout.statusBarHeight)
        // A slightly recessed strip with a top hairline so it reads as a status
        // bar distinct from the tab row above. The fill bleeds down into the
        // home-indicator zone so the bar reaches the true bottom edge.
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                HudPalette.chrome
                Rectangle()
                    .fill(HudHairline.standard)
                    .frame(height: HudStrokeWidth.thin)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func run(_ items: [StatusReadout]) -> some View {
        HStack(spacing: HudSpacing.sm) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { separator }
                item
            }
        }
    }

    private var separator: some View {
        Text("·")
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .foregroundStyle(HudPalette.dim)
    }
}
