import SwiftUI
import Foundation
import HudsonUI
import UIKit

// MARK: - Adaptive appearance

/// Scout opens in Light, with Dark and System options for operators who prefer
/// a fixed cockpit or want the app to follow ambient device appearance.
enum ScoutAppearance: String, CaseIterable {
    case system, light, dark

    static let storageKey = "scout.appearance"
    static let `default`: ScoutAppearance = .light

    var title: String { rawValue.capitalized }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    static func resolve(_ raw: String?) -> ScoutAppearance {
        ScoutAppearance(rawValue: raw ?? "") ?? .default
    }
}

/// Tail can retain the compact line-by-line view or collapse repeated
/// provenance into burst headers so the log itself starts earlier.
enum ScoutTailLayout: String, CaseIterable {
    case rethought, refined

    static let storageKey = "scout.tail.layout"
    static let `default`: ScoutTailLayout = .rethought

    var title: String {
        switch self {
        case .rethought: "Bursts"
        case .refined: "Lines"
        }
    }

    static func resolve(_ raw: String?) -> ScoutTailLayout {
        ScoutTailLayout(rawValue: raw ?? "") ?? .default
    }
}

/// A dynamic UIKit-backed color keeps static token call sites reactive to the
/// active trait collection without threading `colorScheme` through every row.
func scoutAdaptive(
    light: (Int, Int, Int),
    dark: (Int, Int, Int)
) -> Color {
    Color(uiColor: UIColor { traits in
        let rgb = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
            red: CGFloat(rgb.0) / 255,
            green: CGFloat(rgb.1) / 255,
            blue: CGFloat(rgb.2) / 255,
            alpha: 1
        )
    })
}

/// The app-owned semantic palette. Dark values preserve the shipped cockpit;
/// light values use warm paper, dark ink, and deeper status hues that remain
/// legible without making the interface feel like a generic settings app.
enum ScoutPalette {
    static let bg = scoutAdaptive(light: (246, 243, 237), dark: (10, 10, 10))
    static let surface = scoutAdaptive(light: (255, 253, 249), dark: (23, 23, 23))
    static let chrome = scoutAdaptive(light: (242, 238, 230), dark: (6, 6, 6))

    static let ink = scoutAdaptive(light: (35, 33, 29), dark: (229, 229, 229))
    static let muted = scoutAdaptive(light: (88, 83, 75), dark: (184, 184, 184))
    static let dim = scoutAdaptive(light: (105, 99, 90), dark: (150, 150, 150))
    static let border = scoutAdaptive(light: (205, 197, 184), dark: (39, 39, 39))

    static let accent = scoutAdaptive(light: (7, 120, 91), dark: (16, 185, 129))
    static var accentSoft: Color { accent.opacity(0.10) }
    static let statusOk = scoutAdaptive(light: (21, 128, 61), dark: (34, 197, 94))
    static let statusWarn = scoutAdaptive(light: (161, 91, 0), dark: (245, 158, 11))
    static let statusError = scoutAdaptive(light: (185, 28, 28), dark: (220, 38, 38))
    static let statusInfo = scoutAdaptive(light: (35, 93, 173), dark: (59, 130, 246))
}

enum ScoutHairline {
    static let subtle = scoutAdaptive(light: (224, 217, 205), dark: (24, 24, 24))
    static let standard = scoutAdaptive(light: (205, 197, 184), dark: (38, 38, 38))
}

/// Hudson primitives that read the runtime theme inherit Scout's adaptive
/// colors as well. Older static-token primitives are wrapped locally below.
enum ScoutHudTheme {
    static var adaptive: HudTheme {
        HudTheme(
            palette: HudThemePalette(
                bg: ScoutPalette.bg,
                surface: ScoutPalette.surface,
                chrome: ScoutPalette.chrome,
                ink: ScoutPalette.ink,
                muted: ScoutPalette.muted,
                dim: ScoutPalette.dim,
                border: ScoutPalette.border,
                accent: ScoutPalette.accent,
                accentSoft: ScoutPalette.accentSoft,
                statusOk: ScoutPalette.statusOk,
                statusWarn: ScoutPalette.statusWarn,
                statusError: ScoutPalette.statusError,
                statusInfo: ScoutPalette.statusInfo
            ),
            hairline: HudThemeHairline(
                subtle: ScoutHairline.subtle,
                standard: ScoutHairline.standard
            ),
            radius: .default,
            focus: HudThemeFocus(ring: ScoutPalette.statusInfo.opacity(0.85), ringWidth: 1.5)
        )
    }
}

/// Adaptive versions of two still-static Hudson primitives used frequently by
/// Scout. Keeping these local avoids changing Hudson's dark default for other
/// apps while making every Scout empty/header state coherent in Light mode.
struct ScoutSectionLabel: View {
    let text: String
    var tint: Color = ScoutPalette.muted

    init(_ text: String, tint: Color = ScoutPalette.muted) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text.uppercased())
            .font(HudFont.mono(9, weight: .bold))
            .tracking(2)
            .foregroundStyle(tint)
            .accessibilityLabel(text)
    }
}

struct ScoutEmptyState: View {
    let title: String
    var subtitle: String?
    var icon = "tray"

    init(title: String, subtitle: String? = nil, icon: String = "tray") {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
    }

    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xxl, weight: .light))
                .foregroundStyle(ScoutPalette.dim)
                .accessibilityHidden(true)
            Text(title)
                .font(HudFont.mono(11, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(ScoutPalette.muted)
            if let subtitle {
                Text(subtitle)
                    .font(HudFont.mono(10))
                    .foregroundStyle(ScoutPalette.dim)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: HudLayout.panelWidth)
            }
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: HudRadius.card).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card).stroke(ScoutHairline.subtle, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Scout's blocking-work indicator. The frame stays still while three unequal
/// host facets circulate through it, so the motion reads as network activity
/// rather than an indeterminate system control. Reduce Motion keeps the same
/// complete mark and removes only the orbit.
struct ScoutActivityIndicator: View {
    var size: CGFloat = 40

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isSpinning = false

    var body: some View {
        ZStack {
            ScoutHexagon()
                .fill(ScoutPalette.accent.opacity(0.055))
            ScoutHexagon()
                .stroke(ScoutPalette.accent.opacity(0.42), lineWidth: 1.15)
            ScoutHexagon()
                .scale(0.54)
                .stroke(ScoutPalette.accent.opacity(0.28), lineWidth: 0.8)

            ZStack {
                facet(angle: 0, diameter: 5.2, opacity: 1)
                facet(angle: 120, diameter: 4.2, opacity: 0.58)
                facet(angle: 240, diameter: 3.2, opacity: 0.28)
            }
            .rotationEffect(.degrees(isSpinning ? 360 : 0))
            .animation(
                reduceMotion
                    ? nil
                    : .linear(duration: 0.82).repeatForever(autoreverses: false),
                value: isSpinning
            )
        }
        .frame(width: size, height: size)
        .onAppear { isSpinning = !reduceMotion }
        .onChange(of: reduceMotion) { _, shouldReduce in
            isSpinning = !shouldReduce
        }
        .accessibilityHidden(true)
    }

    private func facet(angle: Double, diameter: CGFloat, opacity: Double) -> some View {
        Circle()
            .fill(ScoutPalette.accent.opacity(opacity))
            .frame(width: diameter, height: diameter)
            .offset(y: -size * 0.30)
            .rotationEffect(.degrees(angle))
    }
}

struct ScoutField: View {
    let placeholder: String
    var icon: String?
    var accessibilityLabelText: String?
    var autofocus: Bool
    @Binding var text: String

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var isFocused: Bool

    init(
        _ placeholder: String,
        text: Binding<String>,
        icon: String? = nil,
        accessibilityLabel: String? = nil,
        autofocus: Bool = false
    ) {
        self.placeholder = placeholder
        self.icon = icon
        self.accessibilityLabelText = accessibilityLabel
        self.autofocus = autofocus
        _text = text
    }

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            if let icon {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(isFocused ? ScoutPalette.statusInfo : ScoutPalette.dim)
            }
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(HudFont.mono(HudTextSize.sm))
                .foregroundStyle(isEnabled ? ScoutPalette.ink : ScoutPalette.dim)
                .tint(ScoutPalette.accent)
                .focused($isFocused)
                .accessibilityLabel(accessibilityLabelText ?? placeholder)
        }
        .padding(.horizontal, HudSpacing.xl)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(isFocused ? ScoutSurface.raised : ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(
                    isFocused ? ScoutPalette.statusInfo : ScoutHairline.standard,
                    lineWidth: isFocused ? 1.5 : HudStrokeWidth.standard
                )
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        .opacity(isEnabled ? 1 : HudOpacity.muted)
        .animation(reduceMotion ? nil : ScoutMotion.fade, value: isFocused)
        .task {
            guard autofocus else { return }
            await Task.yield()
            isFocused = true
        }
    }
}

// MARK: - Motion vocabulary

/// Scout's four motions, so the app moves in one language rather than in as
/// many languages as it has animated views. Every one of them has to answer
/// "where did this come from / where did it go" — motion that only decorates
/// isn't in the vocabulary.
///
/// The springs are short and snappy (~0.3s, barely-there settle). A rubbery
/// spring reads as a toy; a spring that never settles reads as a glitch.
enum ScoutMotion {
    /// Something GROWS out of the thing you touched — the runtime panel from
    /// its chip. The overshoot is nearly gone (0.86) so the panel arrives, it
    /// doesn't wobble.
    static let grow = Animation.spring(response: 0.30, dampingFraction: 0.86)

    /// Something TRAVELS between two seats it already had — the tab bar's
    /// liquid seat sliding from tab to tab, the harness rail's marker. This is
    /// intentionally quicker than a conventional spring: the glass should
    /// keep up with the finger, then settle once without a visible wobble.
    static let travel = Animation.spring(response: 0.18, dampingFraction: 0.88)

    /// Something just CHANGES: a scrim, a tint, a crossfade. No spring — there
    /// is no distance being covered.
    static let fade = Animation.easeOut(duration: 0.10)

    /// The Reduce Motion form of all of the above: the same event, no travel.
    static let plain = Animation.easeOut(duration: 0.08)

    /// Pick the honest animation for the current accessibility setting.
    static func honoring(_ reduceMotion: Bool, _ animation: Animation) -> Animation {
        reduceMotion ? plain : animation
    }
}

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
                canvasTop:   scoutAdaptive(light: (252, 251, 248), dark: (13, 13, 14)),
                canvasFloor: scoutAdaptive(light: (240, 237, 231), dark: (5, 5, 5)),
                keyLight:    scoutAdaptive(light: (255, 255, 255), dark: (255, 255, 255)),
                cardTop:     scoutAdaptive(light: (255, 255, 252), dark: (27, 28, 30)),
                cardBottom:  scoutAdaptive(light: (246, 243, 237), dark: (19, 19, 21)),
                cardEdgeTop: scoutAdaptive(light: (210, 204, 194), dark: (56, 58, 63)),
                inset:       scoutAdaptive(light: (238, 235, 229), dark: (17, 17, 19)),
                raised:      scoutAdaptive(light: (249, 247, 242), dark: (23, 23, 24))
            )
        case .warm:
            // Graphite warmed a few points (R≈G > B) with an amber key-light —
            // a temperature contrast against the cool emerald accent.
            return ScoutToneTokens(
                canvasTop:   scoutAdaptive(light: (253, 249, 241), dark: (16, 14, 11)),
                canvasFloor: scoutAdaptive(light: (239, 232, 221), dark: (6, 5, 4)),
                keyLight:    scoutAdaptive(light: (255, 250, 240), dark: (255, 240, 219)),
                cardTop:     scoutAdaptive(light: (255, 252, 247), dark: (33, 28, 24)),
                cardBottom:  scoutAdaptive(light: (247, 240, 230), dark: (23, 20, 17)),
                cardEdgeTop: scoutAdaptive(light: (211, 198, 181), dark: (67, 58, 48)),
                inset:       scoutAdaptive(light: (240, 233, 223), dark: (22, 19, 16)),
                raised:      scoutAdaptive(light: (250, 245, 237), dark: (28, 25, 21))
            )
        case .cool:
            // Slate cooled a few points (B > R) with a cold-white key-light.
            return ScoutToneTokens(
                canvasTop:   scoutAdaptive(light: (247, 250, 252), dark: (11, 13, 16)),
                canvasFloor: scoutAdaptive(light: (232, 238, 243), dark: (4, 5, 7)),
                keyLight:    scoutAdaptive(light: (242, 249, 255), dark: (222, 240, 255)),
                cardTop:     scoutAdaptive(light: (251, 253, 255), dark: (26, 28, 33)),
                cardBottom:  scoutAdaptive(light: (239, 244, 248), dark: (18, 19, 23)),
                cardEdgeTop: scoutAdaptive(light: (192, 203, 214), dark: (52, 57, 68)),
                inset:       scoutAdaptive(light: (233, 239, 244), dark: (16, 18, 21)),
                raised:      scoutAdaptive(light: (245, 249, 252), dark: (22, 23, 28))
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
    var cardEdgeBottom: Color { ScoutPalette.border }
}

/// Round-two Home experiments live behind one compact set of defaults keys so
/// the entire pass can be A/B'd from the simulator without a settings surface.
/// RootView owns the three `@AppStorage` reads and passes the resolved flags on.
enum ScoutHomeFX {
    static let grainKey = "scout.home.fx.grain"
    static let motionKey = "scout.home.fx.motion"
    static let identityKey = "scout.home.fx.identity"
}

/// DEBUG-only Home finish lab. Every study keeps the same component anatomy,
/// corner radii, spacing and navigation behavior. Only type, hairlines and the
/// black/graphite/accent palette move, so comparisons answer the question the
/// lab is actually meant to answer instead of smuggling in a redesign.
enum ScoutHomeLabPreset: String, CaseIterable, Identifiable {
    case current
    case datum
    case plate
    case inset
    case typeset

    static let storageKey = "scout.home.lab.preset"
    static let `default`: ScoutHomeLabPreset = .datum

    var id: String { rawValue }

    var title: String {
        switch self {
        case .current: "Current"
        case .datum: "Rule"
        case .plate: "Graphite"
        case .inset: "Signal"
        case .typeset: "Ink"
        }
    }

    var code: String {
        switch self {
        case .current: "CUR"
        case .datum: "RUL"
        case .plate: "GRF"
        case .inset: "SIG"
        case .typeset: "INK"
        }
    }

    var blurb: String {
        switch self {
        case .current: "warm field · standard weight"
        case .datum: "true black · one hairline · state accent"
        case .plate: "graphite fill · regular type · clear rim"
        case .inset: "true black · tracked labels · green signal"
        case .typeset: "true black · wide type ramp · faint rim"
        }
    }

    var isPrecision: Bool { self != .current }

    var surfaceFill: Color {
        switch self {
        case .current: ScoutSurface.raised
        case .datum: Color.black
        case .plate: Color(red: 14.0 / 255, green: 14.0 / 255, blue: 16.0 / 255)
        case .inset: Color(red: 15.0 / 255, green: 17.0 / 255, blue: 17.0 / 255)
        case .typeset: Color(red: 10.0 / 255, green: 10.0 / 255, blue: 12.0 / 255)
        }
    }

    var chromeFill: Color {
        switch self {
        case .current: ScoutPalette.chrome.opacity(0.08)
        case .datum: Color.white.opacity(0.025)
        case .plate: Color(red: 0.072, green: 0.074, blue: 0.080)
        case .inset: Color.white.opacity(0.032)
        case .typeset: Color.black
        }
    }

    var primaryInk: Color {
        switch self {
        case .current: ScoutPalette.ink
        case .datum: Color.white.opacity(0.92)
        case .plate: Color.white.opacity(0.90)
        case .inset: Color.white.opacity(0.94)
        case .typeset: Color.white.opacity(0.86)
        }
    }

    var secondaryInk: Color {
        switch self {
        case .current: ScoutInk.muted
        case .datum: Color.white.opacity(0.56)
        case .plate: Color.white.opacity(0.62)
        case .inset: Color.white.opacity(0.54)
        case .typeset: Color.white.opacity(0.44)
        }
    }

    var border: Color {
        switch self {
        case .current: ScoutHairline.standard
        case .datum: Color.white.opacity(0.16)
        case .plate: Color(red: 35.0 / 255, green: 35.0 / 255, blue: 38.0 / 255)
        case .inset: Color(red: 42.0 / 255, green: 46.0 / 255, blue: 47.0 / 255)
        case .typeset: Color.white.opacity(0.09)
        }
    }

    var accent: Color {
        switch self {
        case .current, .datum, .plate: ScoutPalette.accent
        case .inset: Color(red: 0.18, green: 0.88, blue: 0.65)
        case .typeset: Color.white.opacity(0.78)
        }
    }

    var primaryActionFill: Color {
        switch self {
        case .current: ScoutVibe.accent
        case .plate: accent
        case .datum, .inset, .typeset: surfaceFill
        }
    }

    var primaryActionInk: Color {
        switch self {
        case .current, .plate: Color.black
        case .datum, .inset: accent
        case .typeset: primaryInk
        }
    }

    var primaryActionBorder: Color {
        switch self {
        case .current: Color.clear
        case .datum, .inset: accent.opacity(0.55)
        case .plate: accent.opacity(0.72)
        case .typeset: border
        }
    }

    var uiWeight: Font.Weight {
        switch self {
        case .current, .plate: .regular
        case .datum, .inset, .typeset: .light
        }
    }

    var monoWeight: Font.Weight {
        switch self {
        case .current: .medium
        case .plate: .regular
        case .datum, .inset, .typeset: .light
        }
    }

    var labelTracking: CGFloat {
        switch self {
        case .current, .plate: 0
        case .datum: 0.25
        case .inset: 0.85
        case .typeset: 0.15
        }
    }

    static func resolve(_ raw: String?) -> ScoutHomeLabPreset {
        ScoutHomeLabPreset(rawValue: raw ?? "") ?? .default
    }
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
    /// Home precision studies use an optically flat black field. There is no
    /// hidden texture, key light, gradient or reactive glow in this branch.
    var precisionBlack = false

    @AppStorage(ScoutTone.storageKey) private var toneRaw = ScoutTone.default.rawValue
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private var tone: ScoutToneTokens { ScoutTone.resolve(toneRaw).tokens }
    private var reactiveLightIsLive: Bool { grainEnabled && isFleetLive }

    var body: some View {
        ZStack {
            if precisionBlack {
                Color.black
            } else {
                ScoutPalette.bg

                // A faint top lift over a deep floor, both carrying the active tone,
                // so the canvas reads rich-dark and lit rather than dead-black.
                LinearGradient(
                    stops: [
                        .init(color: tone.canvasTop, location: 0.0),
                        .init(color: ScoutPalette.bg, location: 0.36),
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
                .blendMode(colorScheme == .dark ? .screen : .normal)

                if grainEnabled {
                    ScoutFilmGrain(grainOpacity: colorScheme == .dark ? 0.028 : 0.012)
                }
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
            ScoutPalette.accent,
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
    static let muted = ScoutPalette.muted
    /// Tertiary text / faint labels. ↑ from hudson `dim` #737373 (115) — the real
    /// offender; this clears WCAG AA against the canvas.
    static let dim = ScoutPalette.dim
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
    static let accent = scoutAdaptive(light: (41, 124, 63), dark: (156, 232, 107))
    /// Warm amber (#f2b34d) — permission / confirm.
    static let amber = scoutAdaptive(light: (157, 93, 7), dark: (242, 179, 77))
    /// Coral red (#f2725b) — blocked / Claude runtime.
    static let red = scoutAdaptive(light: (181, 49, 34), dark: (242, 114, 91))
    /// Sky blue (#7cc4f2) — decision / Gemini runtime.
    static let blue = scoutAdaptive(light: (45, 104, 158), dark: (124, 196, 242))
    /// Bright primary ink (#eef0f2) for card titles — a touch brighter than the
    /// app default for extra contrast on the dark surfaces.
    static let ink = scoutAdaptive(light: (35, 33, 29), dark: (238, 240, 242))
    /// A crisper hairline than the neutral default, so cards read as defined
    /// panels against the (warm) canvas rather than dissolving into it.
    static let hairline = scoutAdaptive(light: (201, 195, 184), dark: (58, 58, 62))
    /// A lifted card fill that is deliberately NEUTRAL grey (a hair cool), not
    /// warmed by the canvas tone — the tone's `cardTop` reads brownish on the
    /// dashboard, so Home's cards use this clean grey instead.
    static let card = scoutAdaptive(light: (255, 253, 248), dark: (34, 34, 37))
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
    @Environment(\.colorScheme) private var colorScheme

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
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? 0.33 : 0.10),
                radius: colorScheme == .dark ? 9 : 7,
                y: 3
            )
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
    static let top = scoutAdaptive(light: (255, 254, 250), dark: (19, 21, 22))
    static let bottom = scoutAdaptive(light: (243, 239, 231), dark: (11, 13, 14))
    static let edge = scoutAdaptive(light: (195, 188, 176), dark: (58, 62, 63))
    static let rule = scoutAdaptive(light: (216, 209, 198), dark: (42, 46, 47))
    static let neutralSignal = scoutAdaptive(light: (101, 96, 88), dark: (118, 124, 125))
    static let keyLight = scoutAdaptive(light: (255, 255, 255), dark: (255, 255, 255))
}

/// The machined complication plate, factored out of the crown study so the
/// masthead's complications and the glass tab bar's active seat are literally
/// the same object at two scales. The physicality is LIGHTING, not hue: a
/// top-lit graphite face, a rim light bright at the crown and gone by the
/// waist, a hairline that holds the silhouette against the canvas, and fine
/// grain. Never the tone cards (brown under the warm tone) and never the
/// accent — the crown study banned green on complications.
struct ScoutMachinedPlate<S: Shape>: View {
    let shape: S
    /// Extra rim brightness for the active state (crown parity: +0.15).
    var rimBoost: Double = 0
    /// Reach of the pooled top light. Scale it with the plate — the crown's 78
    /// is sized for a 56pt circle and washes a masthead disc flat.
    var lightReach: CGFloat = 34
    var grainOpacity: Double = 0.05

    var body: some View {
        shape
            .fill(
                LinearGradient(
                    colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .overlay(
                shape.fill(
                    RadialGradient(
                        colors: [ScoutSignalSurface.keyLight.opacity(0.09), .clear],
                        center: .top, startRadius: 0, endRadius: lightReach
                    )
                )
            )
            .overlay(ScoutMachinedRim(shape: shape, rimBoost: rimBoost))
            .overlay(ScoutFilmGrain(grainOpacity: grainOpacity).clipShape(shape))
    }
}

/// The machined lighting on its own — a rim light bright at the crown and gone
/// by the waist, over a faint full hairline that holds the silhouette. For
/// surfaces that bring their own fill and must keep it: the liquid-glass tab
/// bar wears this so the rail is edged like the complications it seats,
/// without turning the glass opaque.
struct ScoutMachinedRim<S: Shape>: View {
    let shape: S
    var rimBoost: Double = 0

    var body: some View {
        shape
            .stroke(
                LinearGradient(
                    stops: [
                        .init(color: ScoutSignalSurface.neutralSignal.opacity(0.55 + rimBoost), location: 0),
                        .init(color: ScoutSignalSurface.neutralSignal.opacity(0.16 + rimBoost * 0.4), location: 0.35),
                        .init(color: .clear, location: 0.55),
                    ],
                    startPoint: .top, endPoint: .bottom
                ),
                lineWidth: 1
            )
            .overlay(shape.stroke(ScoutSignalSurface.edge.opacity(0.35), lineWidth: HudStrokeWidth.thin))
    }
}

// MARK: - Floating navigation

/// The approved navigation proposal treats selection as a tinted droplet in a
/// larger glass rail, rather than as another solid machined control. On iOS 26
/// this uses the system's real glass material; the fallback preserves the same
/// translucent green wash and lit rim.
struct ScoutLiquidNavigationSeat: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if reduceTransparency {
                Capsule()
                    .fill(ScoutSurface.raised)
            } else if #available(iOS 26.0, *) {
                Capsule()
                    .fill(.clear)
                    .glassEffect(
                        .regular.tint(ScoutPalette.accent.opacity(colorScheme == .dark ? 0.15 : 0.10)),
                        in: .capsule
                    )
            } else {
                Capsule()
                    .fill(.ultraThinMaterial)
            }
        }
        .overlay {
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [
                            ScoutPalette.accent.opacity(colorScheme == .dark ? 0.12 : 0.10),
                            ScoutPalette.accent.opacity(colorScheme == .dark ? 0.045 : 0.035),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        }
        .overlay {
            Capsule()
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(colorScheme == .dark ? 0.16 : 0.62),
                            ScoutPalette.accent.opacity(colorScheme == .dark ? 0.16 : 0.18),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: HudStrokeWidth.thin
                )
        }
    }
}

enum ScoutFloatingSurfaceRole {
    case navigation
    case control
}

extension View {
    /// Two-layer elevation keeps Light mode physical without the grey halo a
    /// single dark, high-opacity shadow produces: a broad warm ambient shadow
    /// plus a tiny contact shadow. Dark mode retains the deeper existing read.
    func scoutFloatingSurface(_ role: ScoutFloatingSurfaceRole) -> some View {
        modifier(ScoutFloatingSurfaceDepth(role: role))
    }
}

private struct ScoutFloatingSurfaceDepth: ViewModifier {
    let role: ScoutFloatingSurfaceRole
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let shadow = colorScheme == .dark
            ? Color.black
            : Color(red: 74.0 / 255, green: 60.0 / 255, blue: 42.0 / 255)

        switch role {
        case .navigation:
            content
                .shadow(
                    color: shadow.opacity(colorScheme == .dark ? 0.42 : 0.10),
                    radius: colorScheme == .dark ? 14 : 18,
                    y: colorScheme == .dark ? 6 : 8
                )
                .shadow(
                    color: shadow.opacity(colorScheme == .dark ? 0.22 : 0.07),
                    radius: 2,
                    y: 1
                )
        case .control:
            content
                .shadow(
                    color: shadow.opacity(colorScheme == .dark ? 0.34 : 0.08),
                    radius: colorScheme == .dark ? 4 : 8,
                    y: colorScheme == .dark ? 2 : 3
                )
                .shadow(
                    color: shadow.opacity(colorScheme == .dark ? 0.22 : 0.08),
                    radius: 1,
                    y: 1
                )
        }
    }
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
    @Environment(\.colorScheme) private var colorScheme

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
            .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.24 : 0.08), radius: 4, y: 2)
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
        // Registration marks replace the frame at each corner; they should not
        // float inside it and create a second, competing corner. The half-point
        // keeps the 1 pt stroke inside the clipping boundary while reading as
        // exactly edge-seated.
        let inset: CGFloat = 0.5
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
