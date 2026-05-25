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

enum HUDChrome {
    // ── Canvas (warm-dark, scout brand) ────────────────────────────────
    // oklch(0.14 0.008 80) ≈ rgb(30, 28, 25)
    static let canvas      = Color(red: 0.118, green: 0.110, blue: 0.098)
    // oklch(0.18 0.009 80) ≈ rgb(40, 37, 33) — chrome surfaces
    static let canvasAlt   = Color(red: 0.157, green: 0.145, blue: 0.129)
    // oklch(0.22 0.009 80) ≈ rgb(50, 46, 41) — active row lift
    static let canvasLift  = Color(red: 0.196, green: 0.180, blue: 0.161)
    // Glass top + bottom (used in the panel gradient base under the
    // NSVisualEffectView material).
    static let glassTop    = Color(red: 0.156, green: 0.146, blue: 0.131).opacity(0.92)
    static let glassBottom = Color(red: 0.090, green: 0.082, blue: 0.072).opacity(0.94)

    // ── Ink (solid greys, NEVER opacity-dimmed text) ───────────────────
    // oklch(0.96 0.008 80) — near-white warm
    static let ink         = Color(red: 0.955, green: 0.948, blue: 0.935)
    // oklch(0.72 0.012 80)
    static let inkMuted    = Color(red: 0.700, green: 0.682, blue: 0.652)
    // oklch(0.58 0.012 80)
    static let inkFaint    = Color(red: 0.535, green: 0.518, blue: 0.490)
    // A deeper grey for masthead/eyebrow chrome — sits between faint and the
    // canvas-alt fills. Reads as printed ink on paper at small sizes.
    static let inkDeep     = Color(red: 0.430, green: 0.412, blue: 0.388)

    // ── Borders (solid, no white-alpha gradient stripes) ───────────────
    static let border      = Color(red: 0.235, green: 0.220, blue: 0.200)
    static let borderSoft  = Color(red: 0.180, green: 0.168, blue: 0.150)
    static let borderStrong = Color(red: 0.295, green: 0.275, blue: 0.245)

    // ── Accent (scout lime — single accent, no cyan/rose) ──────────────
    // oklch(0.86 0.17 125)
    static let accent      = Color(red: 0.580, green: 0.890, blue: 0.420)
    static let accentDim   = Color(red: 0.470, green: 0.720, blue: 0.340)
    static let accentSoft  = Color(red: 0.580, green: 0.890, blue: 0.420).opacity(0.14)
    static let accentWhisper = Color(red: 0.580, green: 0.890, blue: 0.420).opacity(0.06)

    // ── Per-agent hue helper ───────────────────────────────────────────
    //
    // Studio convention is oklch(0.72 0.14 H). The HSB approximation lands
    // close to the studio's lifted-and-clear palette by hue. Saturation 0.55,
    // brightness 0.80 reads as a clear identity band, not a wash.
    static func agentHue(_ h: Double, lightness: Double = 0.80, saturation: Double = 0.55) -> Color {
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

enum HUDType {
    // Sans body — agent names, prose, all readable text. Inter, then
    // SF Pro (Apple's Inter-equivalent) as the system fallback.
    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Inter", size: size).weight(weight)
    }

    // Display — same family as body, retained for legacy call sites.
    // Use `body(_, weight:)` for new code.
    static func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        body(size, weight: weight)
    }

    // Mono — JetBrains Mono. Used for counts, branches, time, eyebrows,
    // hotkeys. Falls back to SF Mono if JBM is not installed.
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("JetBrains Mono", size: size).weight(weight)
    }

    // Eyebrow standard tracking for ALL-CAPS mono labels.
    // Studio convention: tracking-eyebrow ≈ 0.18em (~1.6px at 9px).
    static let eyebrowTracking: CGFloat = 1.55
    static let eyebrowMicro: CGFloat = 1.85
}

// MARK: - Hairline (solid 1px, single border color)
//
// Studio convention — solid token, never a gradient. The previous
// 5-stop gradient pretended to be a specular lift; studio uses a flat
// `--studio-edge` everywhere and that's what we mirror.

struct HUDHairline: View {
    enum Axis { case horizontal, vertical }
    var axis: Axis = .horizontal
    var inset: CGFloat = 0

    var body: some View {
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

struct HUDPaperGrain: View {
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

    var body: some View {
        Image(nsImage: Self.image)
            .resizable(resizingMode: .tile)
            .blendMode(.softLight)
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

struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
    var state: NSVisualEffectView.State = .active
    var cornerRadius: CGFloat = 12

    func makeNSView(context: Context) -> NSVisualEffectView {
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

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
        nsView.state = state
        nsView.layer?.cornerRadius = cornerRadius
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
    var color: Color = HUDChrome.inkDeep
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
        table[id] ?? Array(repeating: 0.2, count: 12)
    }
}
