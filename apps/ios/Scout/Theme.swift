import SwiftUI
import Foundation
import HudsonUI

// MARK: - Shared surface entrance

/// One launch-lifetime entrance latch owned by a top-level surface. Keeping the
/// phase outside individual rows means data inserted by later polls renders in
/// place instead of replaying the screen's first-activation choreography.
final class CockpitEntrancePhase: ObservableObject {
    @Published private(set) var hasEntered = false
    @Published private(set) var isVisible = false

    @MainActor
    func reveal(when isActive: Bool, animated: Bool) async {
        guard isActive, !Task.isCancelled, !hasEntered else { return }
        hasEntered = true
        guard animated else {
            isVisible = true
            return
        }

        // Let the loaded hierarchy commit once at its settled-from origin.
        try? await Task.sleep(for: .milliseconds(20))
        // If a very fast tab switch cancelled this beat, finish the latch rather
        // than leaving the surface transparent on its next activation.
        isVisible = true
    }
}

extension View {
    /// Scout's single first-activation language: a quiet 7pt vertical settle and
    /// fade, staggered by 35ms with the same spring on every top-level surface.
    func cockpitEntrance(
        index: Int,
        phase: CockpitEntrancePhase,
        motionEnabled: Bool = true
    ) -> some View {
        modifier(
            CockpitEntranceModifier(
                index: index,
                phase: phase,
                motionEnabled: motionEnabled
            )
        )
    }
}

private struct CockpitEntranceModifier: ViewModifier {
    let index: Int
    @ObservedObject var phase: CockpitEntrancePhase
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let animates = motionEnabled && !reduceMotion
        let delay = Double(min(max(index, 0), 8)) * 0.035
        content
            .opacity(animates ? (phase.isVisible ? 1 : 0) : 1)
            .offset(y: animates && !phase.isVisible ? 7 : 0)
            .animation(
                animates
                    ? .spring(response: 0.34, dampingFraction: 0.82).delay(delay)
                    : nil,
                value: phase.isVisible
            )
    }
}

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

/// Round-two Home experiments live behind one compact set of defaults keys so
/// the entire pass can be A/B'd from the simulator without a settings surface.
/// RootView owns the three `@AppStorage` reads and passes the resolved flags on.
enum ScoutHomeFX {
    static let grainKey = "scout.home.fx.grain"
    static let motionKey = "scout.home.fx.motion"
    static let identityKey = "scout.home.fx.identity"
}

/// App-level surface fills that carry the active canvas tone. Resolved at access
/// time from `scout.tone`; use these in place of hudson's neutral white-alpha
/// `HudSurface.inset` / `.raised` so recessed and raised surfaces warm or cool
/// with the canvas instead of greying out.
enum ScoutSurface {
    static var inset: Color { ScoutTone.stored.tokens.inset }
    static var raised: Color { ScoutTone.stored.tokens.raised }
    /// A lifted card fill — the tone's lightest step, so stat bars, the ask dock,
    /// and the horizontal cards read as raised panels off the canvas (an off-white
    /// in light mode) rather than dissolving into it.
    static var card: Color { ScoutTone.stored.tokens.cardTop }
}

struct ScoutCanvas: View {
    var isFleetLive = false
    var grainEnabled = true
    var motionEnabled = true

    @AppStorage(ScoutTone.storageKey) private var toneRaw = ScoutTone.default.rawValue
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var tone: ScoutToneTokens { ScoutTone.resolve(toneRaw).tokens }
    private var reactiveLightIsLive: Bool { grainEnabled && isFleetLive }

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
                colors: [
                    tone.keyLight.opacity(reactiveLightIsLive ? 0.082 : 0.06),
                    tone.keyLight.opacity(0.0)
                ],
                center: UnitPoint(x: 0.5, y: 0.0),
                startRadius: 0,
                endRadius: reactiveLightIsLive ? 392 : 360
            )
            .blendMode(.screen)

            if grainEnabled {
                ScoutFilmGrain()
            }
        }
        .animation(
            reduceMotion ? nil : .easeInOut(duration: motionEnabled ? 1.4 : 1.6),
            value: reactiveLightIsLive
        )
        .allowsHitTesting(false)
    }
}

/// A cached, deterministic 48px monochrome tile. The texture is generated once
/// for the process, then composited by the GPU as an ImagePaint; there is no
/// TimelineView and no per-frame noise work while the key-light animates.
/// Also overlaid (stronger, shape-clipped) on crown chrome for the reference
/// designs' machined/leathery feel.
struct ScoutFilmGrain: View {
    var grainOpacity: Double = 0.028

    private static let tile: CGImage = {
        let side = 48
        var state: UInt32 = 0x5C0A_7E11
        var pixels = [UInt8](repeating: 0, count: side * side)
        for index in pixels.indices {
            state = 1_664_525 &* state &+ 1_013_904_223
            // A narrow mid-grey distribution keeps the soft-light result fine,
            // rather than turning individual pixels into visible stars.
            pixels[index] = UInt8(82 + ((state >> 24) % 93))
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        return CGImage(
            width: side,
            height: side,
            bitsPerComponent: 8,
            bitsPerPixel: 8,
            bytesPerRow: side,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )!
    }()

    var body: some View {
        Rectangle()
            .fill(
                ImagePaint(
                    image: Image(decorative: Self.tile, scale: 3, orientation: .up),
                    scale: 1
                )
            )
            .blendMode(.softLight)
            .opacity(grainOpacity)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
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

// MARK: - Canvas vibe (Scout Mobile)

/// The brighter "Scout Mobile" canvas accents used by the Home fleet dashboard —
/// a lime signal and more luminous status hues that pop against the dark canvas,
/// for a higher-contrast, more energetic read than the app's default emerald set.
enum ScoutVibe {
    /// Home's compact operational cards share one continuous corner treatment.
    /// Capsules and chips keep their own geometry.
    static let cardRadius: CGFloat = 8
    /// Lime accent (#9ce86b) — the canvas signature, brighter than emerald.
    static let accent = Color(red: 156.0/255, green: 232.0/255, blue: 107.0/255)
    /// Warm amber (#f2b34d) — permission / confirm.
    static let amber  = Color(red: 242.0/255, green: 179.0/255, blue: 77.0/255)
    /// Coral red (#f2725b) — blocked / Claude runtime.
    static let red    = Color(red: 242.0/255, green: 114.0/255, blue: 91.0/255)
    /// Sky blue (#7cc4f2) — decision / Gemini runtime.
    static let blue   = Color(red: 124.0/255, green: 196.0/255, blue: 242.0/255)
    /// Bright primary ink (#eef0f2) for card titles — a touch brighter than the
    /// app default for extra contrast on the dark surfaces.
    static let ink    = Color(red: 238.0/255, green: 240.0/255, blue: 242.0/255)
    /// A crisper hairline than the neutral default, so cards read as defined
    /// panels against the (warm) canvas rather than dissolving into it.
    static let hairline = Color(red: 58.0/255, green: 58.0/255, blue: 62.0/255)
    /// A lifted card fill that is deliberately NEUTRAL grey (a hair cool), not
    /// warmed by the canvas tone — the tone's `cardTop` reads brownish on the
    /// dashboard, so Home's cards use this clean grey instead.
    static let card = Color(red: 34.0/255, green: 34.0/255, blue: 37.0/255)
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

// MARK: - Signal frame

/// A restrained instrument-panel treatment for structural surfaces. Signal
/// panels intentionally sit on a neutral graphite plane even when the surrounding
/// Scout canvas is warm or cool: the content reads as instrumentation, not as a
/// conventional raised card. The accent is supplied by real state and only
/// reaches the registration marks / datum line; it never washes the whole panel.
extension View {
    func signalPanel(accent: Color? = nil, cut: CGFloat = 6) -> some View {
        modifier(SignalPanelDepth(accent: accent, cut: cut))
    }
}

/// Home's Signal grammar is deliberately narrower than the general Scout tone
/// system. These solid graphite tokens keep its structural hairlines crisp and
/// prevent a warm canvas from turning operational panels brown.
enum ScoutSignalSurface {
    static let top = Color(red: 19.0/255, green: 21.0/255, blue: 22.0/255)
    static let bottom = Color(red: 11.0/255, green: 13.0/255, blue: 14.0/255)
    static let edge = Color(red: 58.0/255, green: 62.0/255, blue: 63.0/255)
    static let rule = Color(red: 42.0/255, green: 46.0/255, blue: 47.0/255)
    static let neutralSignal = Color(red: 118.0/255, green: 124.0/255, blue: 125.0/255)
}

struct SignalPanelShape: InsettableShape {
    var cut: CGFloat = 6
    var insetAmount: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: insetAmount, dy: insetAmount)
        let c = min(cut, min(r.width, r.height) / 3)
        var path = Path()
        path.move(to: CGPoint(x: r.minX + c, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX, y: r.minY + c))
        path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - c))
        path.addLine(to: CGPoint(x: r.maxX - c, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX + c, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX, y: r.maxY - c))
        path.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        path.closeSubpath()
        return path
    }

    func inset(by amount: CGFloat) -> SignalPanelShape {
        var copy = self
        copy.insetAmount += amount
        return copy
    }
}

private struct SignalPanelDepth: ViewModifier {
    let accent: Color?
    let cut: CGFloat

    func body(content: Content) -> some View {
        let shape = SignalPanelShape(cut: cut)
        let markTint = accent ?? ScoutSignalSurface.neutralSignal
        return content
            .background(
                shape.fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            )
            .overlay(
                shape.strokeBorder(ScoutSignalSurface.edge, lineWidth: HudStrokeWidth.thin)
            )
            .overlay {
                SignalRegistrationMarks(tint: markTint)
            }
            .overlay(alignment: .topLeading) {
                // One short datum is enough to carry state into the frame. The
                // rest stays neutral so green / amber remain meaningful signals.
                Rectangle()
                    .fill(markTint)
                    .frame(width: accent == nil ? 18 : 30, height: HudStrokeWidth.thin)
                    .padding(.leading, 15)
            }
            .clipShape(shape)
            .shadow(color: Color.black.opacity(0.24), radius: 4, y: 2)
    }
}

private struct SignalRegistrationMarks: View {
    let tint: Color

    var body: some View {
        ZStack {
            SignalCornerMark(corner: .topLeading).stroke(tint, lineWidth: 1)
            SignalCornerMark(corner: .topTrailing).stroke(tint, lineWidth: 1)
            SignalCornerMark(corner: .bottomLeading).stroke(tint, lineWidth: 1)
            SignalCornerMark(corner: .bottomTrailing).stroke(tint, lineWidth: 1)
        }
        .opacity(0.82)
        .allowsHitTesting(false)
    }
}

private enum SignalCorner {
    case topLeading, topTrailing, bottomLeading, bottomTrailing
}

private struct SignalCornerMark: Shape {
    let corner: SignalCorner

    func path(in rect: CGRect) -> Path {
        let inset: CGFloat = 4
        let length: CGFloat = 9
        var path = Path()
        switch corner {
        case .topLeading:
            path.move(to: CGPoint(x: rect.minX + inset, y: rect.minY + inset + length))
            path.addLine(to: CGPoint(x: rect.minX + inset, y: rect.minY + inset))
            path.addLine(to: CGPoint(x: rect.minX + inset + length, y: rect.minY + inset))
        case .topTrailing:
            path.move(to: CGPoint(x: rect.maxX - inset - length, y: rect.minY + inset))
            path.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.minY + inset))
            path.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.minY + inset + length))
        case .bottomLeading:
            path.move(to: CGPoint(x: rect.minX + inset, y: rect.maxY - inset - length))
            path.addLine(to: CGPoint(x: rect.minX + inset, y: rect.maxY - inset))
            path.addLine(to: CGPoint(x: rect.minX + inset + length, y: rect.maxY - inset))
        case .bottomTrailing:
            path.move(to: CGPoint(x: rect.maxX - inset - length, y: rect.maxY - inset))
            path.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.maxY - inset))
            path.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.maxY - inset - length))
        }
        return path
    }
}
