import SwiftUI
import HudsonUI

// MARK: - Cockpit canvas
//
// The shared `HudPhoneAppShell` paints a flat near-black. Scout layers its
// own depth on top (app-level — hudson's palette stays untouched): a faint
// top-lit vertical wash so the screen reads as lit rather than printed, plus a
// soft emerald aura anchored under the brand wordmark. Pure decoration — it sits
// behind all content and never takes a hit.

// MARK: - Canvas tone
//
// The cockpit canvas is a near-black charcoal. "Tone" warms or cools that
// charcoal by a few points — the key-light at the top, the deep floor, and the
// raised card surfaces all shift together — so the app reads as a lit, considered
// dark instead of a flat dead grey. It does this WITHOUT leaning on the accent:
// the warmth lives in the neutrals themselves. User-selectable in Settings →
// Appearance and persisted under `scout.tone`; `.neutral` reproduces the original
// de-greened palette exactly.
enum ScoutTone: String, CaseIterable {
    case warm, neutral, cool

    var title: String {
        switch self {
        case .warm:    return "Warm"
        case .neutral: return "Neutral"
        case .cool:    return "Cool"
        }
    }

    static let storageKey = "scout.tone"
    static let `default`: ScoutTone = .warm

    /// Tolerant decode for the persisted raw string — unknown/empty falls back to
    /// the default so a stale value never strands the canvas on a blank tone.
    static func resolve(_ raw: String?) -> ScoutTone {
        ScoutTone(rawValue: raw ?? "") ?? .default
    }

    /// The current tone read straight from defaults — for the few non-reactive
    /// static call sites (e.g. the tab-bar lip). Views should prefer `@AppStorage`.
    static var stored: ScoutTone { resolve(UserDefaults.standard.string(forKey: storageKey)) }

    var tokens: ScoutToneTokens {
        switch self {
        case .neutral:
            return ScoutToneTokens(
                canvasTop:   Color(red: 0.049, green: 0.050, blue: 0.053),
                canvasFloor: Color(red: 0.018, green: 0.018, blue: 0.021),
                keyLight:    .white,
                cardTop:     Color(red: 0.105, green: 0.108, blue: 0.118),
                cardBottom:  Color(red: 0.074, green: 0.074, blue: 0.082),
                cardEdgeTop: Color(red: 0.220, green: 0.226, blue: 0.246),
                inset:       Color(red: 0.067, green: 0.068, blue: 0.074),
                raised:      Color(red: 0.090, green: 0.090, blue: 0.096)
            )
        case .warm:
            // Graphite warmed a few points (R≈G > B) with an amber key-light —
            // a temperature contrast against the cool emerald accent.
            return ScoutToneTokens(
                canvasTop:   Color(red: 0.064, green: 0.053, blue: 0.045),
                canvasFloor: Color(red: 0.024, green: 0.019, blue: 0.016),
                keyLight:    Color(red: 1.00, green: 0.94, blue: 0.86),
                cardTop:     Color(red: 0.128, green: 0.111, blue: 0.096),
                cardBottom:  Color(red: 0.090, green: 0.077, blue: 0.066),
                cardEdgeTop: Color(red: 0.262, green: 0.228, blue: 0.190),
                inset:       Color(red: 0.085, green: 0.074, blue: 0.063),
                raised:      Color(red: 0.110, green: 0.097, blue: 0.083)
            )
        case .cool:
            // Slate cooled a few points (B > R) with a cold-white key-light.
            return ScoutToneTokens(
                canvasTop:   Color(red: 0.044, green: 0.050, blue: 0.064),
                canvasFloor: Color(red: 0.015, green: 0.018, blue: 0.027),
                keyLight:    Color(red: 0.87, green: 0.94, blue: 1.00),
                cardTop:     Color(red: 0.100, green: 0.108, blue: 0.128),
                cardBottom:  Color(red: 0.070, green: 0.075, blue: 0.092),
                cardEdgeTop: Color(red: 0.205, green: 0.223, blue: 0.268),
                inset:       Color(red: 0.063, green: 0.069, blue: 0.083),
                raised:      Color(red: 0.085, green: 0.092, blue: 0.108)
            )
        }
    }
}

/// The resolved color set for one tone. The bottom card edge stays anchored to
/// hudson's `border` so cards settle into the same floor across every tone.
/// `inset`/`raised` are SOLID toned fills that replace hudson's white-alpha
/// `HudSurface.inset` — white-alpha greys the warmth back out (and is a banned
/// treatment on our dark surfaces), so chips/pills/fields carry the tone instead.
struct ScoutToneTokens {
    let canvasTop: Color
    let canvasFloor: Color
    let keyLight: Color
    let cardTop: Color
    let cardBottom: Color
    let cardEdgeTop: Color
    let inset: Color
    let raised: Color
    var cardEdgeBottom: Color { HudPalette.border }
}

/// App-level surface fills that carry the active canvas tone. Resolved at access
/// time from `scout.tone`; use these in place of hudson's neutral white-alpha
/// `HudSurface.inset` / `.raised` so recessed and raised surfaces warm or cool
/// with the canvas instead of greying out.
enum ScoutSurface {
    static var inset: Color { ScoutTone.stored.tokens.inset }
    static var raised: Color { ScoutTone.stored.tokens.raised }
}

struct ScoutCanvas: View {
    @AppStorage(ScoutTone.storageKey) private var toneRaw = ScoutTone.default.rawValue
    private var tone: ScoutToneTokens { ScoutTone.resolve(toneRaw).tokens }

    var body: some View {
        ZStack {
            HudPalette.bg

            // A faint top lift over a deep floor, both carrying the active tone,
            // so the canvas reads rich-dark and lit rather than dead-black.
            LinearGradient(
                stops: [
                    .init(color: tone.canvasTop, location: 0.0),
                    .init(color: HudPalette.bg, location: 0.36),
                    .init(color: tone.canvasFloor, location: 1.0)
                ],
                startPoint: .top, endPoint: .bottom
            )

            // A soft key-light across the top — tinted by the tone (warm amber /
            // cold white / neutral). Over `.screen` on the dark canvas it resolves
            // to a faint lit glow that de-greys the upper third.
            RadialGradient(
                colors: [tone.keyLight.opacity(0.06), tone.keyLight.opacity(0.0)],
                center: UnitPoint(x: 0.5, y: 0.0),
                startRadius: 0, endRadius: 360
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

    // The raised-edge highlight for chrome that lifts the studio way (the
    // tab-bar lip). Tracks the active tone; resolved at access time for the
    // handful of non-reactive static call sites.
    static var cardEdgeTop: Color { ScoutTone.stored.tokens.cardEdgeTop }
}

// MARK: - Text contrast
//
// Scout lifts hudson's two faint text rungs a notch for the phone. On the
// near-black cockpit canvas the shared `muted`/`dim` read too soft — the small
// mono labels (section headers, row details, activity meta) sit around the AA
// floor. These brighten the secondary/tertiary tiers while keeping the
// ink → muted → dim hierarchy distinct. App-level only; hudson's palette (and
// the macOS app) stays untouched. One place to tune the whole iOS app's contrast.
enum ScoutInk {
    /// Secondary text. ↑ from hudson `muted` #A3A3A3 (163).
    static let muted = Color(red: 184.0/255, green: 184.0/255, blue: 184.0/255)
    /// Tertiary text / faint labels. ↑ from hudson `dim` #737373 (115) — the real
    /// offender; this clears WCAG AA against the canvas.
    static let dim   = Color(red: 150.0/255, green: 150.0/255, blue: 150.0/255)
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
    @AppStorage(ScoutTone.storageKey) private var toneRaw = ScoutTone.default.rawValue

    func body(content: Content) -> some View {
        let t = ScoutTone.resolve(toneRaw).tokens
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(
                shape.fill(
                    LinearGradient(
                        colors: [t.cardTop, t.cardBottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [t.cardEdgeTop, t.cardEdgeBottom],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .clipShape(shape)
            .shadow(color: Color.black.opacity(0.33), radius: 9, y: 3)
    }
}
