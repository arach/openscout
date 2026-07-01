import AppKit
import SwiftUI

// HUD chrome — broadsheet edition.
//
// A pivot. The cockpit pass treated the HUD as an instrument; this one
// treats it as a printed brief, filed by the broker every time you summon
// it. Display serif at scale for identity, sans for body, mono ONLY for
// facts (counts, branches, time). Hairlines do the work that paint used
// to. Hue carries identity as a *footer rule under the row*, not a
// shouting left stripe.
//
// Tokens still mirror design/studio/app/globals.css. The brand law from
// feedback_no_dim_text_in_menu and feedback_no_white_alpha_dividers is
// honored. Scout-only colors: warm-dark canvas + lime accent.

public enum HUDSkin: String, CaseIterable, Identifiable, Sendable {
    case current
    case metal
    case glass

    public static let storageKey = "scout.hud.skin.v1"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .current: return "Default"
        case .metal:   return "Matte"
        case .glass:   return "Glass"
        }
    }

    public var shortLabel: String {
        switch self {
        case .current: return "D"
        case .metal:   return "M"
        case .glass:   return "G"
        }
    }

    public var help: String {
        switch self {
        case .current: return "Default HUD skin"
        case .metal:   return "Matte metallic HUD skin"
        case .glass:   return "Liquid glass HUD skin"
        }
    }

    public static func stored(in defaults: UserDefaults = .standard) -> HUDSkin {
        guard let raw = defaults.string(forKey: storageKey),
              let skin = HUDSkin(rawValue: raw)
        else { return .current }
        return skin
    }
}

@MainActor
public final class HUDSkinState: ObservableObject {
    public static let shared = HUDSkinState()

    @Published public private(set) var skin: HUDSkin
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.skin = HUDSkin.stored(in: defaults)
    }

    public func setSkin(_ skin: HUDSkin) {
        guard self.skin != skin else { return }
        defaults.set(skin.rawValue, forKey: HUDSkin.storageKey)
        self.skin = skin
    }

    public func step() {
        let all = HUDSkin.allCases
        guard let index = all.firstIndex(of: skin) else {
            setSkin(.current)
            return
        }
        setSkin(all[(index + 1) % all.count])
    }
}

private struct HUDSkinPalette {
    let canvas: Color
    let canvasAlt: Color
    let canvasLift: Color
    let glassTop: Color
    let glassBottom: Color
    let ink: Color
    let inkMuted: Color
    let inkFaint: Color
    let inkDeep: Color
    let border: Color
    let borderSoft: Color
    let borderStrong: Color
    let borderRim: Color
    let accent: Color
    let accentDim: Color
    let accentSoftOpacity: Double
    let accentWhisperOpacity: Double
    let paperGrainOpacity: Double
    let metalTextureOpacity: Double
    let materialOpacity: Double
    let rimIntensity: Double
}

private extension HUDSkin {
    var palette: HUDSkinPalette {
        switch self {
        case .current:
            return HUDSkinPalette(
                canvas: Color(red: 0.045, green: 0.040, blue: 0.035),
                canvasAlt: Color(red: 0.080, green: 0.072, blue: 0.062),
                canvasLift: Color(red: 0.155, green: 0.142, blue: 0.122),
                glassTop: Color(red: 0.075, green: 0.068, blue: 0.058).opacity(0.96),
                glassBottom: Color(red: 0.030, green: 0.026, blue: 0.022).opacity(0.97),
                ink: Color(red: 0.905, green: 0.892, blue: 0.862),
                inkMuted: Color(red: 0.700, green: 0.680, blue: 0.646),
                inkFaint: Color(red: 0.500, green: 0.485, blue: 0.455),
                inkDeep: Color(red: 0.380, green: 0.365, blue: 0.342),
                border: Color(red: 0.255, green: 0.240, blue: 0.215),
                borderSoft: Color(red: 0.155, green: 0.142, blue: 0.122),
                borderStrong: Color(red: 0.380, green: 0.355, blue: 0.318),
                borderRim: Color(red: 0.395, green: 0.370, blue: 0.320),
                accent: Color(red: 0.580, green: 0.890, blue: 0.420),
                accentDim: Color(red: 0.470, green: 0.720, blue: 0.340),
                accentSoftOpacity: 0.14,
                accentWhisperOpacity: 0.06,
                paperGrainOpacity: 0.045,
                metalTextureOpacity: 0,
                materialOpacity: 0,
                rimIntensity: 1.0
            )
        case .metal:
            return HUDSkinPalette(
                canvas: Color(red: 0.092, green: 0.095, blue: 0.092),
                canvasAlt: Color(red: 0.132, green: 0.136, blue: 0.128),
                canvasLift: Color(red: 0.235, green: 0.232, blue: 0.214),
                glassTop: Color(red: 0.180, green: 0.184, blue: 0.170).opacity(0.94),
                glassBottom: Color(red: 0.055, green: 0.058, blue: 0.055).opacity(0.98),
                ink: Color(red: 0.890, green: 0.884, blue: 0.842),
                inkMuted: Color(red: 0.675, green: 0.668, blue: 0.618),
                inkFaint: Color(red: 0.475, green: 0.472, blue: 0.438),
                inkDeep: Color(red: 0.330, green: 0.332, blue: 0.314),
                border: Color(red: 0.320, green: 0.320, blue: 0.290),
                borderSoft: Color(red: 0.205, green: 0.205, blue: 0.188),
                borderStrong: Color(red: 0.470, green: 0.460, blue: 0.405),
                borderRim: Color(red: 0.560, green: 0.535, blue: 0.445),
                accent: Color(red: 0.580, green: 0.890, blue: 0.420),
                accentDim: Color(red: 0.470, green: 0.720, blue: 0.340),
                accentSoftOpacity: 0.14,
                accentWhisperOpacity: 0.06,
                paperGrainOpacity: 0.030,
                metalTextureOpacity: 0.115,
                materialOpacity: 0,
                rimIntensity: 0.78
            )
        case .glass:
            return HUDSkinPalette(
                canvas: Color(red: 0.034, green: 0.047, blue: 0.049),
                canvasAlt: Color(red: 0.066, green: 0.094, blue: 0.098),
                canvasLift: Color(red: 0.118, green: 0.165, blue: 0.170),
                glassTop: Color(red: 0.165, green: 0.230, blue: 0.222).opacity(0.58),
                glassBottom: Color(red: 0.030, green: 0.044, blue: 0.048).opacity(0.50),
                ink: Color(red: 0.905, green: 0.955, blue: 0.930),
                inkMuted: Color(red: 0.700, green: 0.790, blue: 0.770),
                inkFaint: Color(red: 0.500, green: 0.610, blue: 0.600),
                inkDeep: Color(red: 0.350, green: 0.455, blue: 0.450),
                border: Color(red: 0.250, green: 0.365, blue: 0.350),
                borderSoft: Color(red: 0.145, green: 0.230, blue: 0.225),
                borderStrong: Color(red: 0.470, green: 0.620, blue: 0.585),
                borderRim: Color(red: 0.600, green: 0.840, blue: 0.770),
                accent: Color(red: 0.580, green: 0.890, blue: 0.420),
                accentDim: Color(red: 0.470, green: 0.720, blue: 0.340),
                accentSoftOpacity: 0.14,
                accentWhisperOpacity: 0.06,
                paperGrainOpacity: 0.018,
                metalTextureOpacity: 0,
                materialOpacity: 0.88,
                rimIntensity: 1.12
            )
        }
    }
}

public enum HUDChrome {
    private static var palette: HUDSkinPalette {
        HUDSkin.stored().palette
    }

    public static var activeSkin: HUDSkin { HUDSkin.stored() }

    // ── Canvas ────────────────────────────────────────────────────────
    public static var canvas: Color { palette.canvas }
    public static var canvasAlt: Color { palette.canvasAlt }
    public static var canvasLift: Color { palette.canvasLift }
    public static var glassTop: Color { palette.glassTop }
    public static var glassBottom: Color { palette.glassBottom }

    // ── Ink ───────────────────────────────────────────────────────────
    public static var ink: Color { palette.ink }
    public static var inkMuted: Color { palette.inkMuted }
    public static var inkFaint: Color { palette.inkFaint }
    public static var inkDeep: Color { palette.inkDeep }

    // ── Borders ───────────────────────────────────────────────────────
    public static var border: Color { palette.border }
    public static var borderSoft: Color { palette.borderSoft }
    public static var borderStrong: Color { palette.borderStrong }
    public static var borderRim: Color { palette.borderRim }

    // ── Accent ────────────────────────────────────────────────────────
    public static var accent: Color { palette.accent }
    public static var accentDim: Color { palette.accentDim }
    public static var accentSoft: Color { palette.accent.opacity(palette.accentSoftOpacity) }
    public static var accentWhisper: Color { palette.accent.opacity(palette.accentWhisperOpacity) }

    // ── Surface treatment knobs ───────────────────────────────────────
    public static var paperGrainOpacity: Double { palette.paperGrainOpacity }
    public static var metalTextureOpacity: Double { palette.metalTextureOpacity }
    public static var materialOpacity: Double { palette.materialOpacity }
    public static var rimIntensity: Double { palette.rimIntensity }

    // ── Per-agent hue helper ───────────────────────────────────────────
    //
    // Studio convention is oklch(0.72 0.14 H). The HSB approximation lands
    // close to the studio's lifted-and-clear palette by hue. Saturation 0.55,
    // brightness 0.80 reads as a clear identity band, not a wash.
    public static func agentHue(_ h: Double, lightness: Double = 0.80, saturation: Double = 0.55) -> Color {
        let normHue = (h.truncatingRemainder(dividingBy: 360)) / 360.0
        return Color(hue: normHue, saturation: saturation, brightness: lightness, opacity: 1)
    }
}

// MARK: - Typographic system (sans + mono, no serif)
//
// Two voices only — sans for everything readable, mono for chrome
// (counts, branches, time, eyebrows). The serif "display" face is
// retired; `display()` is kept as an alias on top of sans so existing
// call sites compile, but it returns the same font sans does. Family
// stack: JetBrains Mono (mono) + Inter (sans). JBM resolves from the
// system font folder; Inter falls back to SF Pro at UI sizes when not
// bundled.

public enum HUDType {
    // Sans body — agent names, prose, all readable text. Inter, then
    // SF Pro (Apple's Inter-equivalent) as the system fallback.
    public static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Inter", size: size).weight(weight)
    }

    // Display — same family as body, retained for legacy call sites.
    // Use `body(_, weight:)` for new code.
    public static func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        body(size, weight: weight)
    }

    // Mono — JetBrains Mono. Used for counts, branches, time, eyebrows,
    // hotkeys. Falls back to SF Mono if JBM is not installed.
    public static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("JetBrains Mono", size: size).weight(weight)
    }

    // Eyebrow standard tracking for ALL-CAPS mono labels.
    // Studio convention: tracking-eyebrow ≈ 0.18em (~1.6px at 9px).
    public static let eyebrowTracking: CGFloat = 1.55
    public static let eyebrowMicro: CGFloat = 1.85
}

// MARK: - Hairline (solid 1px, single border color)
//
// Studio convention — solid token, never a gradient. The previous
// 5-stop gradient pretended to be a specular lift; studio uses a flat
// `--studio-edge` everywhere and that's what we mirror.

public struct HUDHairline: View {
    public enum Axis { case horizontal, vertical }
    var axis: Axis = .horizontal
    var inset: CGFloat = 0

    public init(axis: Axis = .horizontal, inset: CGFloat = 0) {
        self.axis = axis
        self.inset = inset
    }

    public var body: some View {
        Rectangle()
            .fill(HUDChrome.border)
            .frame(
                width:  axis == .vertical   ? 1 : nil,
                height: axis == .horizontal ? 1 : nil
            )
            .padding(.horizontal, axis == .horizontal ? inset : 0)
            .padding(.vertical,   axis == .vertical   ? inset : 0)
    }
}

// MARK: - Hue rule
//
// The signature broadsheet move: per-agent hue carries identity not as a
// vertical stripe but as a fading horizontal underline at the bottom of
// each row — like a printer's color register mark. Quieter than a
// stripe, more editorial. Fades from hue → border in the same hue family.

struct HUDHueRule: View {
    var color: Color
    var thickness: CGFloat = 1
    var inset: CGFloat = 0

    var body: some View {
        Rectangle()
            .fill(HUDChrome.borderSoft)
            .frame(height: thickness)
            .padding(.horizontal, inset)
    }
}

// MARK: - Paper grain (very low contrast texture)
//
// The whisper of broadsheet paper. Stochastic dots at 4% opacity over
// the whole panel — invisible until you look for it, but adds the kind
// of surface character that makes a flat glass panel feel printed.
// Cached as a static image so we don't repaint on every frame.

public struct HUDPaperGrain: View {
    var opacity: Double = 0.045
    static let image: NSImage = {
        let size = NSSize(width: 240, height: 240)
        let img = NSImage(size: size)
        img.lockFocus()
        defer { img.unlockFocus() }
        NSColor.clear.set()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
        var generator = SystemRandomNumberGenerator()
        for _ in 0..<3200 {
            let x = CGFloat(UInt(generator.next() % 240))
            let y = CGFloat(UInt(generator.next() % 240))
            let lum = CGFloat(UInt(generator.next() % 100)) / 100.0
            // Warm grain — bias toward paper-cream, not pure white.
            let r: CGFloat = 0.98
            let g: CGFloat = 0.94
            let b: CGFloat = 0.82
            NSColor(red: r, green: g, blue: b, alpha: lum * 0.35).set()
            NSBezierPath(rect: NSRect(x: x, y: y, width: 1, height: 1)).fill()
        }
        return img
    }()

    public init(opacity: Double = 0.045) {
        self.opacity = opacity
    }

    public var body: some View {
        Image(nsImage: Self.image)
            .resizable(resizingMode: .tile)
            .blendMode(.softLight)
            .opacity(opacity)
            .allowsHitTesting(false)
    }
}

// MARK: - Brushed metal grain (cached directional texture)

public struct HUDMetalGrain: View {
    var opacity: Double = 0.08

    static let image: NSImage = {
        let size = NSSize(width: 240, height: 240)
        let img = NSImage(size: size)
        img.lockFocus()
        defer { img.unlockFocus() }
        NSColor.clear.set()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

        var generator = SystemRandomNumberGenerator()
        for y in stride(from: 0, to: 240, by: 2) {
            let lum = CGFloat(UInt(generator.next() % 100)) / 100.0
            let alpha = 0.055 + (lum * 0.065)
            let white = 0.52 + (lum * 0.20)
            let x = CGFloat(Int(generator.next() % 36)) - 24
            let length = CGFloat(96 + Int(generator.next() % 190))
            NSColor(white: white, alpha: alpha).set()
            NSBezierPath(rect: NSRect(x: x, y: CGFloat(y), width: length, height: 0.55)).fill()
        }

        for _ in 0..<520 {
            let x = CGFloat(UInt(generator.next() % 240))
            let y = CGFloat(UInt(generator.next() % 240))
            let lum = CGFloat(UInt(generator.next() % 100)) / 100.0
            NSColor(white: 0.38 + lum * 0.24, alpha: 0.030).set()
            NSBezierPath(rect: NSRect(x: x, y: y, width: 1, height: 1)).fill()
        }

        return img
    }()

    public init(opacity: Double = 0.08) {
        self.opacity = opacity
    }

    public var body: some View {
        Image(nsImage: Self.image)
            .resizable(resizingMode: .tile)
            .blendMode(.overlay)
            .opacity(opacity)
            .allowsHitTesting(false)
    }
}

// MARK: - Panel rim (top-edge specular + corner halos)
//
// Faint horizontal gradient sweep along the panel's top edge, peaking at
// the center in lime, with soft halos at the two corners. Lives as an
// overlay on top of the panel content.

struct HUDPanelRim: View {
    var intensity: Double = 1.0

    var body: some View {
        ZStack(alignment: .top) {
            Canvas { ctx, size in
                let rect = CGRect(x: 0, y: 0, width: size.width, height: 1.4)
                let limeStop = HUDChrome.accent.opacity(0.28 * intensity)
                let warmStop = Color(red: 0.98, green: 0.95, blue: 0.85).opacity(0.22 * intensity)
                let gradient = Gradient(stops: [
                    .init(color: .clear,    location: 0.00),
                    .init(color: warmStop,  location: 0.30),
                    .init(color: limeStop,  location: 0.50),
                    .init(color: warmStop,  location: 0.70),
                    .init(color: .clear,    location: 1.00),
                ])
                ctx.fill(
                    Path(rect),
                    with: .linearGradient(
                        gradient,
                        startPoint: CGPoint(x: 0, y: 0),
                        endPoint:   CGPoint(x: size.width, y: 0)
                    )
                )

                // Corner halos — warm ambient
                let r: CGFloat = 60
                for cx in [CGFloat(0), size.width] {
                    let halo = CGRect(x: cx - r, y: -r * 0.45, width: r * 2, height: r)
                    ctx.fill(
                        Path(ellipseIn: halo),
                        with: .color(
                            Color(red: 1.0, green: 0.94, blue: 0.78).opacity(0.05 * intensity)
                        )
                    )
                }
            }
            .frame(height: 60)
            .allowsHitTesting(false)
        }
    }
}

// MARK: - NSVisualEffectView bridge

public struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
    var state: NSVisualEffectView.State = .active
    var cornerRadius: CGFloat = 12

    public init(
        material: NSVisualEffectView.Material = .hudWindow,
        blendingMode: NSVisualEffectView.BlendingMode = .behindWindow,
        state: NSVisualEffectView.State = .active,
        cornerRadius: CGFloat = 12
    ) {
        self.material = material
        self.blendingMode = blendingMode
        self.state = state
        self.cornerRadius = cornerRadius
    }

    public func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = material
        v.blendingMode = blendingMode
        v.state = state
        v.isEmphasized = false
        v.wantsLayer = true
        v.layer?.cornerRadius = cornerRadius
        v.layer?.cornerCurve = .continuous
        v.layer?.masksToBounds = true
        return v
    }

    public func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
        nsView.state = state
        nsView.layer?.cornerRadius = cornerRadius
    }
}

// MARK: - Harness mark

/// Small monochrome provider glyphs for dense HUD rows. These mirror the
/// full macOS Tail marks without depending on the app target's private views.
struct HUDHarnessMark: View {
    let harness: String
    var size: CGFloat = 12
    var tint: Color = HUDChrome.inkMuted

    var body: some View {
        Canvas { ctx, dim in
            let s = dim.width / 24
            let shading = GraphicsContext.Shading.color(tint)
            let c = CGPoint(x: 12 * s, y: 12 * s)
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }

            switch Self.normalize(harness) {
            case "gemini":
                let tips: [(CGFloat, CGFloat)] = [
                    (12, 0), (15, 9), (24, 12), (15, 15),
                    (12, 24), (9, 15), (0, 12), (9, 9),
                ]
                var p = Path()
                p.move(to: pt(tips[0].0, tips[0].1))
                for t in tips.dropFirst() { p.addLine(to: pt(t.0, t.1)) }
                p.closeSubpath()
                ctx.fill(p, with: shading)

            case "claude":
                var p = Path()
                for i in 0..<8 {
                    let a = Double(i) * .pi / 4
                    p.move(to: c)
                    p.addLine(to: CGPoint(x: c.x + cos(a) * 11 * s, y: c.y + sin(a) * 11 * s))
                }
                ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))

            case "codex":
                for i in 0..<6 {
                    let a = Double(i) * .pi / 3 - .pi / 2
                    let outer = CGPoint(x: c.x + cos(a) * 7.4 * s, y: c.y + sin(a) * 7.4 * s)
                    let tangent = CGPoint(x: -sin(a), y: cos(a))
                    var p = Path()
                    p.move(to: CGPoint(
                        x: outer.x - tangent.x * 3.4 * s,
                        y: outer.y - tangent.y * 3.4 * s
                    ))
                    p.addQuadCurve(
                        to: CGPoint(
                            x: outer.x + tangent.x * 3.4 * s,
                            y: outer.y + tangent.y * 3.4 * s
                        ),
                        control: CGPoint(
                            x: c.x + cos(a) * 10.2 * s,
                            y: c.y + sin(a) * 10.2 * s
                        )
                    )
                    ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2.15 * s, lineCap: .round))
                }
                var center = Path()
                center.addEllipse(in: CGRect(x: c.x - 2.1 * s, y: c.y - 2.1 * s, width: 4.2 * s, height: 4.2 * s))
                ctx.fill(center, with: shading)

            case "cursor":
                var p = Path()
                p.move(to: pt(12, 3))
                p.addLine(to: pt(21.5, 19))
                p.addLine(to: pt(2.5, 19))
                p.closeSubpath()
                ctx.fill(p, with: shading)

            case "grok":
                var p = Path()
                p.move(to: pt(5, 18))
                p.addLine(to: pt(15, 6))
                p.move(to: pt(11, 20))
                p.addLine(to: pt(21, 8))
                ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2.4 * s, lineCap: .round))

            case "opencode":
                var p = Path()
                p.addRoundedRect(
                    in: CGRect(x: 2.5 * s, y: 2.5 * s, width: 19 * s, height: 19 * s),
                    cornerSize: CGSize(width: 3 * s, height: 3 * s)
                )
                p.addRoundedRect(
                    in: CGRect(x: 8 * s, y: 8 * s, width: 8 * s, height: 8 * s),
                    cornerSize: CGSize(width: 1.5 * s, height: 1.5 * s)
                )
                ctx.fill(p, with: shading, style: FillStyle(eoFill: true))

            case "github":
                var line = Path()
                line.move(to: pt(8, 5.5))
                line.addLine(to: pt(8, 18.5))
                line.move(to: pt(8, 11))
                line.addQuadCurve(to: pt(16.5, 9), control: pt(8, 9))
                ctx.stroke(line, with: shading, style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
                var dots = Path()
                for d in [(8.0, 5.0), (8.0, 19.0), (16.5, 9.0)] {
                    dots.addEllipse(
                        in: CGRect(
                            x: (CGFloat(d.0) - 2.4) * s,
                            y: (CGFloat(d.1) - 2.4) * s,
                            width: 4.8 * s,
                            height: 4.8 * s
                        )
                    )
                }
                ctx.fill(dots, with: shading)

            default:
                let key = Self.normalize(harness)
                let letter = String(key.first ?? "?").uppercased()
                let text = Text(letter)
                    .font(.system(size: 13 * s, weight: .semibold, design: .monospaced))
                    .foregroundColor(tint)
                ctx.draw(text, at: c)
            }
        }
        .frame(width: size, height: size)
    }

    static func normalize(_ harness: String) -> String {
        let raw = harness.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !raw.isEmpty else { return "unknown" }
        var base = raw
        if let i = base.firstIndex(where: { $0 == " " || $0 == "(" }) {
            base = String(base[..<i])
        }
        if let i = base.firstIndex(where: { $0 == "_" || $0 == "-" }) {
            base = String(base[..<i])
        }
        let aliases: [String: String] = [
            "anthropic": "claude", "claude": "claude", "claudecode": "claude", "sonnet": "claude", "opus": "claude",
            "openai": "codex", "codex": "codex", "gpt": "codex", "chatgpt": "codex", "oai": "codex",
            "xai": "grok", "grok": "grok",
            "google": "gemini", "gemini": "gemini", "vertex": "gemini",
            "cursor": "cursor", "github": "github", "opencode": "opencode", "oc": "opencode",
        ]
        return aliases[base] ?? aliases[raw] ?? base
    }
}

// MARK: - Mini pulse glyph (kept; smaller role in broadsheet)
//
// 12-step amplitude rendered as stepped vertical bars in the agent's hue.
// In the new IA this lives only in the expanded panel — the row footer
// uses the hue-rule for identity, not a sparkline.

struct HUDPulseSparkline: View {
    var values: [Double]
    var color: Color
    var size = CGSize(width: 30, height: 8)

    var body: some View {
        Canvas { ctx, canvasSize in
            guard !values.isEmpty else { return }
            let step = canvasSize.width / CGFloat(values.count)
            let barW = max(1, step - 1)
            for (i, v) in values.enumerated() {
                let h = max(1.2, CGFloat(v) * canvasSize.height)
                let x = CGFloat(i) * step
                let y = canvasSize.height - h
                let rect = CGRect(x: x, y: y, width: barW, height: h)
                let recencyAlpha = 0.35 + 0.65 * (Double(i) / Double(max(1, values.count - 1)))
                ctx.fill(
                    Path(roundedRect: rect, cornerRadius: 0.5),
                    with: .color(color.opacity(recencyAlpha))
                )
            }
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }
}

// MARK: - Attention pulse (kept; used inline with name)
//
// Slow breathing ring. In the broadsheet the row's identity is the name,
// so the attention pulse moves to sit beside the agent name as a printer's
// ornament rather than at the status-glyph slot.

struct HUDAttentionPulse: View {
    @State private var phase: CGFloat = 0
    var dotRadius: CGFloat = 3.5

    var body: some View {
        Canvas { ctx, size in
            let mid = CGPoint(x: size.width / 2, y: size.height / 2)
            let baseR: CGFloat = dotRadius
            let pulseR = baseR + phase * 5
            let alpha = 0.45 * (1.0 - phase)
            ctx.fill(
                Path(ellipseIn: CGRect(
                    x: mid.x - pulseR, y: mid.y - pulseR,
                    width: pulseR * 2, height: pulseR * 2
                )),
                with: .color(HUDChrome.accent.opacity(alpha))
            )
            ctx.fill(
                Path(ellipseIn: CGRect(
                    x: mid.x - baseR, y: mid.y - baseR,
                    width: baseR * 2, height: baseR * 2
                )),
                with: .color(HUDChrome.accent)
            )
        }
        .frame(width: 14, height: 14)
        .onAppear {
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) {
                phase = 1.0
            }
        }
    }
}

// MARK: - Printer's ornament (broadsheet flourish)
//
// A small hand-drawn fleur — three-petal lime mark used as the masthead
// signature. Replaces the cockpit monogram. Reads as a publisher's
// printing mark on the broadsheet.

struct HUDMastheadMark: View {
    var size: CGFloat = 14

    var body: some View {
        Canvas { ctx, canvasSize in
            let cx = canvasSize.width / 2
            let cy = canvasSize.height / 2
            let r = min(canvasSize.width, canvasSize.height) / 2 - 1

            // Outer warm ring
            let ringRect = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
            ctx.stroke(
                Path(ellipseIn: ringRect),
                with: .color(HUDChrome.borderStrong),
                style: StrokeStyle(lineWidth: 1)
            )

            // Three lime petals — 120° apart, rising
            let petalLen = r * 0.78
            let petalWide: CGFloat = 1.4
            for i in 0..<3 {
                let angle = Double(i) * (2 * .pi / 3) - .pi / 2
                let dx = cos(angle)
                let dy = sin(angle)
                var path = Path()
                path.move(to: CGPoint(x: cx, y: cy))
                path.addLine(to: CGPoint(x: cx + dx * petalLen, y: cy + dy * petalLen))
                ctx.stroke(
                    path,
                    with: .color(HUDChrome.accent),
                    style: StrokeStyle(lineWidth: petalWide, lineCap: .round)
                )
            }

            // Center dot
            let dotR: CGFloat = 1.6
            let dotRect = CGRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            ctx.fill(Path(ellipseIn: dotRect), with: .color(HUDChrome.canvas))
            ctx.stroke(
                Path(ellipseIn: dotRect),
                with: .color(HUDChrome.accent),
                style: StrokeStyle(lineWidth: 0.9)
            )
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Eyebrow label (mono small-caps with leading bullet)
//
// The ubiquitous studio header pattern: `· LABEL` in mono uppercase
// with eyebrow tracking. Pulled out so every view uses the same atom.

struct HUDEyebrow: View {
    let text: String
    // Normalized to studio's `text-studio-ink-faint`. inkDeep was an
    // earlier broadsheet departure; the source-of-truth playground (and
    // the studio research entry) call for faint. Override per-call when
    // a specific eyebrow legitimately needs the deeper voice.
    var color: Color = HUDChrome.inkFaint
    var size: CGFloat = 9
    var leadingBullet: Bool = true

    var body: some View {
        Text(leadingBullet ? "· " + text.uppercased() : text.uppercased())
            .font(HUDType.mono(size, weight: .semibold))
            .tracking(HUDType.eyebrowMicro)
            .foregroundStyle(color)
            .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Mock pulse data

enum HUDMockPulse {
    static let table: [String: [Double]] = [
        "hudson": [0.2, 0.3, 0.5, 0.4, 0.6, 0.8, 0.7, 0.9, 0.85, 0.95, 0.8, 0.9],
        "drover": [0.6, 0.7, 0.5, 0.3, 0.2, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05],
        "pike":   [0.4, 0.5, 0.7, 0.8, 0.7, 0.6, 0.9, 0.85, 0.7, 0.8, 0.9, 0.85],
        "atlas":  [0.7, 0.8, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
        "quill":  [0.5, 0.6, 0.5, 0.6, 0.7, 0.5, 0.6, 0.7, 0.65, 0.7, 0.6, 0.7],
        "cobalt": [0.5, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08],
    ]

    static func pulse(for id: String) -> [Double] {
        if let table = table[id] { return table }
        return synthesized(for: id)
    }

    /// Deterministic, varied 12-step amplitude derived from the id.
    /// Mirrors what `design/studio/lib/agentHue.ts` does for hue — we
    /// don't want every unknown agent's row to flatline at 0.2, that
    /// reads as "dead" instead of "pulsing". Each agent gets a unique
    /// curve that holds across renders.
    private static func synthesized(for id: String) -> [Double] {
        var seed: UInt64 = 5381
        for byte in id.utf8 {
            seed = (seed &* 33) &+ UInt64(byte)
        }
        var state = seed | 1 // avoid degenerate 0
        func next() -> Double {
            // xorshift64* — cheap deterministic PRNG, plenty for visuals
            state ^= state >> 12
            state ^= state << 25
            state ^= state >> 27
            let n = state &* 0x2545F4914F6CDD1D
            return Double(n >> 11) / Double(1 << 53)
        }
        // Bias the curve toward a profile shape so it reads as activity,
        // not noise: pick a base amplitude per agent, then jitter ±0.35
        // around it. Floor at 0.12 (visible bar), ceil at 0.95.
        let base = 0.35 + next() * 0.45 // 0.35–0.80
        return (0..<12).map { _ in
            let jitter = (next() - 0.5) * 0.7
            return min(0.95, max(0.12, base + jitter))
        }
    }
}
