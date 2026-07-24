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
    // Stable identity: readouts are rebuilt on every body pass, so a fresh UUID
    // each time would make ForEach tear down and recreate them — restarting any
    // pulse animation. The label is unique within a run, so key on it.
    // `nonisolated` because `Identifiable.id` must satisfy the protocol off the
    // MainActor; `label` is an immutable `let`, so reading it is race-free.
    nonisolated var id: String { label }
    var dot: Color? = nil
    var glyph: GlyphShape.Kind? = nil
    var pulses: Bool = false
    let label: String
    var tint: Color = ScoutInk.muted
    /// When set, the label truncates within this width instead of taking its full
    /// intrinsic size. Used for the machine readout, whose name can be long enough
    /// (a verbose hostname) to otherwise push the whole bar past the screen.
    var maxLabelWidth: CGFloat? = nil

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
                .truncationMode(.tail)
                .frame(maxWidth: maxLabelWidth, alignment: .leading)
        }
        // Short readouts stay intrinsic (crisp, no truncation); a capped readout
        // goes horizontally flexible so its label truncates instead of forcing the
        // bar — and every surface beneath it — wider than the screen.
        .fixedSize(horizontal: maxLabelWidth == nil, vertical: true)
    }
}

/// The status bar itself: a leading run + a trailing run of readouts, separated
/// within a run by a faint middot, with the center left open for the home
/// indicator. Generous side insets so edge readouts clear the rounded corners.
struct ScoutStatusBar: View {
    var leading: [StatusReadout] = []
    var trailing: [StatusReadout] = []
    /// Overrides the layout's standard side inset. Crown mode uses this to
    /// push the edge readouts clear of the corner labels that share the
    /// indicator band when the crown is summoned.
    var sideInset: CGFloat? = nil
    @Environment(\.scoutLayout) private var layout

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            run(leading)
            Spacer(minLength: layout.statusCenterGap)
            run(trailing)
        }
        .padding(.horizontal, sideInset ?? layout.statusSideInset)
        .padding(.vertical, HudSpacing.xs)
        // Kept low so the taller nav above can sit lower without the footer
        // crowding it.
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
            .foregroundStyle(ScoutInk.dim)
    }
}
