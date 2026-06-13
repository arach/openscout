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

public enum HUDChrome {
    // ── Canvas (hard black, faint warmth) ──────────────────────────────
    // Pivot away from the warm-dark scout brand toward near-pure black.
    // The operator asked for "very very very hard black" with softer
    // tones reserved for hierarchy. A whisper of warmth (~+1% in r/g)
    // keeps it from reading as a cold UI surface, but the visual
    // intent is: black means black.
    public static let canvas      = Color(red: 0.045, green: 0.040, blue: 0.035)
    public static let canvasAlt   = Color(red: 0.080, green: 0.072, blue: 0.062)
    public static let canvasLift  = Color(red: 0.155, green: 0.142, blue: 0.122)
    // Legacy glass tokens — still referenced by the panel background.
    // Pulled down into the new near-black range so the panel reads as
    // a single hard surface rather than the old warm gradient.
    public static let glassTop    = Color(red: 0.075, green: 0.068, blue: 0.058).opacity(0.96)
    public static let glassBottom = Color(red: 0.030, green: 0.026, blue: 0.022).opacity(0.97)

    // ── Ink (warm, never pure white) ───────────────────────────────────
    // Pulled back from the harder-white pass — pure white reads as
    // clinical, "blunt and out of place" per the operator. We sit
    // around the 0.88-0.92 range with a faint warm tint so the names
    // read as printed ink, not chrome lettering.
    public static let ink         = Color(red: 0.905, green: 0.892, blue: 0.862)
    public static let inkMuted    = Color(red: 0.700, green: 0.680, blue: 0.646)
    public static let inkFaint    = Color(red: 0.500, green: 0.485, blue: 0.455)
    public static let inkDeep     = Color(red: 0.380, green: 0.365, blue: 0.342)

    // ── Borders (sharper against the harder canvas) ────────────────────
    public static let border      = Color(red: 0.255, green: 0.240, blue: 0.215)
    public static let borderSoft  = Color(red: 0.155, green: 0.142, blue: 0.122)
    public static let borderStrong = Color(red: 0.380, green: 0.355, blue: 0.318)

    // ── Rim (warm-cream hairline used on the panel edge) ──────────────
    // The Lattices voice-mode reference: a single restrained, thin
    // border cuts the panel out of the desktop without needing
    // decorative brackets. Sits between border and ink — warm enough
    // to feel like printed-paper edging, dim enough not to read as a
    // glowing UI rectangle. Pair with an ambient halo shadow
    // (HUDStatusView) — together they do the job that the now-removed
    // corner brackets were doing badly.
    public static let borderRim   = Color(red: 0.395, green: 0.370, blue: 0.320)

    // ── Accent (scout lime — single accent, no cyan/rose) ──────────────
    // oklch(0.86 0.17 125)
    public static let accent      = Color(red: 0.580, green: 0.890, blue: 0.420)
    public static let accentDim   = Color(red: 0.470, green: 0.720, blue: 0.340)
    public static let accentSoft  = Color(red: 0.580, green: 0.890, blue: 0.420).opacity(0.14)
    public static let accentWhisper = Color(red: 0.580, green: 0.890, blue: 0.420).opacity(0.06)

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
