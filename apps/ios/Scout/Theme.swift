import SwiftUI
import HudsonUI

// MARK: - Cockpit canvas
//
// The shared `HudPhoneAppShell` paints a flat near-black. Scout layers its
// own depth on top (app-level — hudson's palette stays untouched): a faint
// top-lit vertical wash so the screen reads as lit rather than printed, plus a
// soft emerald aura anchored under the brand wordmark. Pure decoration — it sits
// behind all content and never takes a hit.

struct ScoutCanvas: View {
    var body: some View {
        ZStack {
            HudPalette.bg

            // Pushed darker per the elegant direction: a faint NEUTRAL top lift
            // over a deep floor, so the canvas reads rich-dark rather than
            // dead-black — and stays neutral, not green.
            LinearGradient(
                stops: [
                    .init(color: Color(red: 0.049, green: 0.050, blue: 0.053), location: 0.0),
                    .init(color: HudPalette.bg, location: 0.36),
                    .init(color: Color(red: 0.018, green: 0.018, blue: 0.021), location: 1.0)
                ],
                startPoint: .top, endPoint: .bottom
            )

            // A neutral grey backlight across the top — a soft key-light so the
            // screen reads lit, with NO green tint. White over `.screen` on the
            // dark canvas resolves to a faint cool-grey lift.
            RadialGradient(
                colors: [Color.white.opacity(0.05), Color.white.opacity(0.0)],
                center: UnitPoint(x: 0.5, y: 0.0),
                startRadius: 0, endRadius: 340
            )
            .blendMode(.screen)
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Accent gradient
//
// A directional emerald the brand and primary CTAs can share, so the accent
// reads as one light source rather than a flat fill. Cooler at the tail (a hint
// of teal) for a little life.

extension ScoutCanvas {
    static let accentGradient = LinearGradient(
        colors: [
            HudPalette.accent,
            Color(red: 11.0/255, green: 197.0/255, blue: 165.0/255)  // emerald → teal
        ],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    // Card depth tones — all SOLID lifts in the same neutral hue (no white-alpha
    // edges). Top catches the canvas key-light; bottom settles to the standard
    // border.
    static let cardTop        = Color(red: 0.105, green: 0.108, blue: 0.118)  // lifted, a hair cool
    static let cardBottom     = Color(red: 0.074, green: 0.074, blue: 0.082)  // near-bg floor
    static let cardEdgeTop    = Color(red: 0.220, green: 0.226, blue: 0.246)  // top highlight
    static let cardEdgeBottom = HudPalette.border                              // #272727
}

// MARK: - Card depth

extension View {
    /// Raises a container off the lit canvas: a top-edge highlight catching the
    /// key-light, a faintly top-lit fill, and a soft drop shadow. For genuine
    /// cards/containers — not flat list rows. Edges are solid lifted neutrals,
    /// never `white.opacity` hairlines.
    func scoutCard(cornerRadius: CGFloat = HudRadius.card) -> some View {
        modifier(ScoutCardDepth(cornerRadius: cornerRadius))
    }
}

private struct ScoutCardDepth: ViewModifier {
    var cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(
                shape.fill(
                    LinearGradient(
                        colors: [ScoutCanvas.cardTop, ScoutCanvas.cardBottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [ScoutCanvas.cardEdgeTop, ScoutCanvas.cardEdgeBottom],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .clipShape(shape)
            .shadow(color: Color.black.opacity(0.33), radius: 9, y: 3)
    }
}
