import SwiftUI
import HudsonUI

// MARK: - Unified glyph language
//
// One hand-drawn, thin-line set for the whole app (preferred over SF Symbols —
// see the cockpit DNA already in play: the reticle ring, radial asterisk, status
// dots). Every mark is laid out on a 24-unit grid and stroked with a single
// weight + round caps, so chrome reads as one coherent set at any size.
//
// Direction (chevron/arrow) is a rotation of one canonical right-pointing path —
// never a second hand-drawn variant — so left/right/up/down can never drift.

enum Glyph {
    /// One stroke weight to rule them all, kept thin by scaling with the glyph's
    /// side (≈1.5pt at a 24pt render, never below 1pt so it survives small sizes).
    static func lineWidth(for side: CGFloat) -> CGFloat { max(1, side * (1.5 / 24)) }

    static func style(for side: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: lineWidth(for: side), lineCap: .round, lineJoin: .round)
    }
}

/// The canonical paths, all authored on a 0…24 grid. Filled vs stroked is the
/// renderer's call (`Glyphic` strokes); `center` marks (the gear hub) are folded
/// into the same path so a single stroke renders the whole glyph.
struct GlyphShape: Shape {
    enum Kind: Equatable {
        case home          // 2×2 overview grid (orientation surface)
        case agent         // one figure (single agent)
        case agents        // two figures (fleet)
        case comms         // single speech bubble
        case tail          // live event waveform
        case terminal      // window + prompt
        case plus          // rounded square + plus (new)
        case lanes         // parallel mission-control lanes
        case dispatch      // routed send / dispatch
        case chevron       // canonical ›  (rotate for ‹ ˄ ˅)
        case arrow         // canonical →  (rotate for ← ↑ ↓)
        case gear          // settings
        case folder
        case check
        case signal        // wi-fi / connection (route indicator)
        case inbox         // tray with a dipped opening (notifications ledger)
        case keyboardDown  // key slab + a falling chevron (dismiss the keyboard)
        case keyboardUp    // key slab + a rising chevron (raise the keyboard)
        case places        // pane + sidebar rule — the way to everywhere else
    }

    let kind: Kind

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let ox = rect.minX + (rect.width - 24 * s) / 2
        let oy = rect.minY + (rect.height - 24 * s) / 2
        func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        func box(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ r: CGFloat) -> CGRect {
            CGRect(x: ox + x0 * s, y: oy + y0 * s, width: (x1 - x0) * s, height: (y1 - y0) * s)
        }

        var p = Path()
        switch kind {
        case .home:
            // Four rounded tiles, a 2.5-unit gutter — a dashboard, not four dots.
            let r: CGFloat = 1.9
            p.addRoundedRect(in: box(3, 3, 10.75, 10.75, r), cornerSize: .init(width: r * s, height: r * s))
            p.addRoundedRect(in: box(13.25, 3, 21, 10.75, r), cornerSize: .init(width: r * s, height: r * s))
            p.addRoundedRect(in: box(3, 13.25, 10.75, 21, r), cornerSize: .init(width: r * s, height: r * s))
            p.addRoundedRect(in: box(13.25, 13.25, 21, 21, r), cornerSize: .init(width: r * s, height: r * s))

        case .agent:
            // One figure: a single head and shoulder arc for a concrete agent.
            p.addEllipse(in: box(8.8, 4.7, 15.2, 11.1, 0))
            p.move(to: P(5.3, 19.3))
            p.addQuadCurve(to: P(18.7, 19.3), control: P(12, 12.4))

        case .agents:
            // Two figures: head circle + shoulder arc, the front one lower/right.
            p.addEllipse(in: box(6.2, 5.4, 11.0, 10.2, 0))            // back head
            p.move(to: P(3.6, 18.2))
            p.addQuadCurve(to: P(13.6, 18.2), control: P(8.6, 11.4))  // back shoulders
            p.addEllipse(in: box(13.0, 7.4, 18.2, 12.6, 0))           // front head
            p.move(to: P(10.4, 20.4))
            p.addQuadCurve(to: P(21.4, 20.4), control: P(15.9, 13.0)) // front shoulders

        case .comms:
            // A single speech bubble with a short tail — one clean shape reads
            // better at tab scale than two overlapping bubbles.
            p.addRoundedRect(in: box(3.5, 4.5, 20.5, 16, 3.4), cornerSize: .init(width: 3.4 * s, height: 3.4 * s))
            p.move(to: P(8.5, 16)); p.addLine(to: P(7, 20)); p.addLine(to: P(12.5, 16))

        case .tail:
            // Compact waveform: distinct from the connection arcs, readable at
            // tab scale, and still thin-line like the rest of the cockpit set.
            p.move(to: P(3.5, 12))
            p.addLine(to: P(6.2, 12))
            p.addLine(to: P(8.0, 7.2))
            p.addLine(to: P(10.3, 17.0))
            p.addLine(to: P(13.0, 5.8))
            p.addLine(to: P(15.7, 18.2))
            p.addLine(to: P(18.0, 12))
            p.addLine(to: P(20.5, 12))

        case .terminal:
            // A window with a `›_` prompt.
            p.addRoundedRect(in: box(2.5, 4, 21.5, 20, 3), cornerSize: .init(width: 3 * s, height: 3 * s))
            p.move(to: P(6.5, 10)); p.addLine(to: P(9.5, 13)); p.addLine(to: P(6.5, 16))
            p.move(to: P(11.5, 16)); p.addLine(to: P(15.5, 16))

        case .plus:
            let r: CGFloat = 3.6
            p.addRoundedRect(in: box(4, 4, 20, 20, r), cornerSize: .init(width: r * s, height: r * s))
            p.move(to: P(12, 9)); p.addLine(to: P(12, 15))
            p.move(to: P(9, 12)); p.addLine(to: P(15, 12))

        case .lanes:
            // Three parallel tracks with live nodes — a compact lane deck.
            for y in [CGFloat(6), 12, 18] {
                p.move(to: P(4, y)); p.addLine(to: P(20, y))
                p.addEllipse(in: box(y == 12 ? 13 : 7, y - 2, y == 12 ? 17 : 11, y + 2, 0))
            }

        case .dispatch:
            // Routed send mark: a paper-plane silhouette with an interior route.
            p.move(to: P(3.5, 5)); p.addLine(to: P(21, 12)); p.addLine(to: P(3.5, 19));
            p.addLine(to: P(7, 12)); p.closeSubpath()
            p.move(to: P(7, 12)); p.addLine(to: P(16.5, 12))

        case .chevron:
            p.move(to: P(9.5, 6)); p.addLine(to: P(15.5, 12)); p.addLine(to: P(9.5, 18))

        case .arrow:
            p.move(to: P(4.5, 12)); p.addLine(to: P(18.5, 12))
            p.move(to: P(13, 6.5)); p.addLine(to: P(18.5, 12)); p.addLine(to: P(13, 17.5))

        case .gear:
            // Flat-topped teeth (not a spiky star): each tooth rises to the outer
            // radius, runs flat, falls back to an inner-radius valley. Round joins
            // soften the corners. Hub hole in the same stroke.
            let teeth = 8
            let outer: CGFloat = 8.4, inner: CGFloat = 6.1
            let step = 2 * Double.pi / Double(teeth)
            let tw = step * 0.30   // angular half-width of each tooth top
            let c = P(12, 12)
            func vert(_ r: CGFloat, _ a: Double) -> CGPoint {
                CGPoint(x: c.x + CGFloat(cos(a)) * r * s, y: c.y + CGFloat(sin(a)) * r * s)
            }
            for i in 0..<teeth {
                let a = Double(i) * step
                let seq = [vert(inner, a - tw), vert(outer, a - tw), vert(outer, a + tw), vert(inner, a + tw)]
                if i == 0 { p.move(to: seq[0]) } else { p.addLine(to: seq[0]) }
                p.addLine(to: seq[1]); p.addLine(to: seq[2]); p.addLine(to: seq[3])
            }
            p.closeSubpath()
            p.addEllipse(in: box(9.7, 9.7, 14.3, 14.3, 0))

        case .folder:
            p.move(to: P(3, 8.5))
            p.addLine(to: P(3, 6.5))
            p.addLine(to: P(8.5, 6.5))
            p.addLine(to: P(10.5, 8.5))
            p.addRoundedRect(in: box(3, 8.5, 21, 19, 2.2), cornerSize: .init(width: 2.2 * s, height: 2.2 * s))

        case .check:
            p.move(to: P(5, 12.8)); p.addLine(to: P(10, 17.8)); p.addLine(to: P(19, 6.6))

        case .signal:
            // Wi-Fi / connection: a base dot with three rising arcs.
            p.addEllipse(in: box(11.0, 17.0, 13.0, 19.0, 0))
            p.move(to: P(9.4, 16.4));  p.addQuadCurve(to: P(14.6, 16.4), control: P(12, 12.4))
            p.move(to: P(6.8, 15.2));  p.addQuadCurve(to: P(17.2, 15.2), control: P(12, 8.4))
            p.move(to: P(4.3, 14.0));  p.addQuadCurve(to: P(19.7, 14.0), control: P(12, 4.6))

        case .inbox:
            // A tray whose lip dips in the middle — the universal inbox mark,
            // drawn in one continuous stroke (matches the studio `inbox` glyph).
            p.move(to: P(4, 13.4))
            p.addLine(to: P(6.6, 5.6))
            p.addLine(to: P(17.4, 5.6))
            p.addLine(to: P(20, 13.4))
            p.addLine(to: P(20, 17.4))
            p.addQuadCurve(to: P(17.4, 19.4), control: P(19.8, 19.4))
            p.addLine(to: P(6.6, 19.4))
            p.addQuadCurve(to: P(4, 17.4), control: P(4.2, 19.4))
            p.closeSubpath()
            p.move(to: P(4, 13.4))
            p.addLine(to: P(9, 13.4))
            p.addLine(to: P(10.4, 15.6))
            p.addLine(to: P(13.6, 15.6))
            p.addLine(to: P(15, 13.4))
            p.addLine(to: P(20, 13.4))

        case .keyboardDown, .keyboardUp:
            // A key slab with a chevron leaving it — down to dismiss, up to
            // raise. Same slab both ways so the pair reads as one toggle;
            // only the chevron turns.
            p.addRoundedRect(in: box(2.5, 3.5, 21.5, 14.5, 2.6),
                             cornerSize: .init(width: 2.6 * s, height: 2.6 * s))
            for x in [CGFloat(6.6), 11.4, 16.2] {
                p.move(to: P(x, 7.4)); p.addLine(to: P(x + 1.2, 7.4))
            }
            p.move(to: P(7.6, 11.2)); p.addLine(to: P(16.4, 11.2))
            if kind == .keyboardDown {
                p.move(to: P(8.4, 17.4)); p.addLine(to: P(12, 21)); p.addLine(to: P(15.6, 17.4))
            } else {
                p.move(to: P(8.4, 21)); p.addLine(to: P(12, 17.4)); p.addLine(to: P(15.6, 21))
            }

        case .places:
            // A pane with a sidebar rule — the studio EntryMast's places mark
            // (entry-surface.tsx), in the kit's stroke voice.
            p.addRoundedRect(in: box(3.5, 4.5, 20.5, 19.5, 3.5),
                             cornerSize: .init(width: 3.5 * s, height: 3.5 * s))
            p.move(to: P(9.75, 4.5)); p.addLine(to: P(9.75, 19.5))
        }
        return p
    }
}

/// Renders a glyph at a square size with the shared thin stroke. Color comes from
/// the environment foreground, so callers tint with `.foregroundStyle(…)`.
/// `rotation` is the one knob for directional marks (chevron/arrow).
struct Glyphic: View {
    let kind: GlyphShape.Kind
    var size: CGFloat = 18
    var rotation: Angle = .zero

    var body: some View {
        GlyphShape(kind: kind)
            .stroke(style: Glyph.style(for: size))
            .frame(width: size, height: size)
            .rotationEffect(rotation)
    }
}

extension Glyphic {
    /// Cardinal helpers so call sites read like the old SF Symbol names.
    static func chevron(_ edge: Edge, size: CGFloat = 14) -> Glyphic {
        Glyphic(kind: .chevron, size: size, rotation: Self.angle(for: edge))
    }
    static func arrow(_ edge: Edge, size: CGFloat = 16) -> Glyphic {
        Glyphic(kind: .arrow, size: size, rotation: Self.angle(for: edge))
    }
    private static func angle(for edge: Edge) -> Angle {
        switch edge {
        case .trailing: return .zero
        case .leading:  return .degrees(180)
        case .top:      return .degrees(-90)
        case .bottom:   return .degrees(90)
        }
    }
}

// MARK: - Harness marks
//
// The runtime a session runs on, as a MARK rather than a word — once the mark
// is sitting there, writing "claude" beside it is redundant (the argument the
// studio's RuntimePicker makes).
//
// These are the vendors' OWN outlines, ported verbatim from the studio's
// `HarnessMark.tsx` (simple-icons, CC0; the official grok set; lobe-icons for
// OpenAI) — an approximation of somebody's logo is worse than no logo, so a
// runtime we have no official path for falls back to a lettered mono chip
// rather than a hand-drawn stand-in. Filled with the environment foreground,
// which is what `fill="currentColor"` means on the web side.

/// Canonical harness key after alias folding, mirroring the studio's
/// `normalizeHarnessKey` (HarnessMark.tsx): decorations are stripped
/// ("claude-code", "claude (sonnet)") before the alias table is consulted.
enum HarnessKey {
    static func normalize(_ harness: String?) -> String {
        let raw = harness?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !raw.isEmpty else { return "" }
        let base = raw.prefix { !" (_-".contains($0) }
        let aliases: [String: String] = [
            "anthropic": "claude", "claude": "claude", "claudecode": "claude",
            "sonnet": "claude", "opus": "claude", "haiku": "claude", "fable": "claude",
            "openai": "codex", "codex": "codex", "gpt": "codex", "chatgpt": "codex", "oai": "codex",
            "google": "gemini", "gemini": "gemini", "vertex": "gemini",
            "xai": "grok", "grok": "grok",
            // The broker reports these endpoints as `kimi` / `grok-acp`; the
            // decoration strip above already folds the `-acp` suffix.
            "kimi": "kimi", "moonshot": "kimi", "moonshotai": "kimi", "k2": "kimi"
        ]
        return aliases[String(base)] ?? String(base)
    }
}

/// One vendor mark: its own viewBox, its own subpaths, its own fill rule.
/// The path strings are the official artwork, byte-for-byte — see the file
/// header. Editing them by eye is the one thing this type exists to prevent.
struct HarnessBrandMark {
    let viewBox: CGRect
    let paths: [String]
    /// `fill-rule="evenodd"` on the source artwork (the OpenAI mark knocks its
    /// `>_` out of the cloud that way).
    let evenOdd: Bool

    static func mark(for harness: String?) -> HarnessBrandMark? {
        catalog[HarnessKey.normalize(harness)]
    }

    static let catalog: [String: HarnessBrandMark] = HarnessBrandArtwork.catalog
}

/// Renders a brand mark's path data, aspect-fit and centred in the given rect.
struct HarnessBrandShape: Shape {
    let mark: HarnessBrandMark

    func path(in rect: CGRect) -> Path {
        let box = mark.viewBox
        guard box.width > 0, box.height > 0 else { return Path() }
        let scale = min(rect.width / box.width, rect.height / box.height)
        let transform = CGAffineTransform(translationX: rect.midX, y: rect.midY)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -box.midX, y: -box.midY)
        var combined = Path()
        for data in mark.paths {
            combined.addPath(SVGPathData.parse(data))
        }
        return combined.applying(transform)
    }
}

/// Renders a harness mark at a square size, tinted by the environment
/// foreground. Unknown runtimes get their initial in mono rather than a
/// stand-in glyph, so an unfamiliar harness still identifies itself.
struct HarnessMark: View {
    let harness: String?
    var size: CGFloat = 13

    var body: some View {
        Group {
            if let mark = HarnessBrandMark.mark(for: harness) {
                HarnessBrandShape(mark: mark)
                    .fill(style: FillStyle(eoFill: mark.evenOdd))
            } else if let initial = HarnessKey.normalize(harness).first {
                Text(String(initial).uppercased())
                    .font(HudFont.mono(size * 0.78, weight: .semibold))
            }
        }
        .frame(width: size, height: size)
    }

    /// True when the runtime NAMES itself — the test for whether a chip has
    /// anything to say. A named runtime we hold no official artwork for still
    /// identifies itself with its mono initial (see the fallback above), so it
    /// gets a chip too; only a synthesized or unnamed adapter gets nothing.
    /// (Before this, `pi` and any future runtime silently lost its badge.)
    static func identifies(_ harness: String?) -> Bool {
        !HarnessKey.normalize(harness).isEmpty
    }
}

// MARK: - SVG path data

/// A minimal SVG path-data reader — SwiftUI has none, and the brand artwork
/// above only exists as `d` strings. Supports exactly the commands that data
/// uses (M m L l H h V v C c S s Q q T t A a Z z); anything else trips an
/// assertion in DEBUG rather than silently dropping a stroke.
enum SVGPathData {
    static func parse(_ data: String) -> Path {
        var path = Path()
        var scanner = Scanner(data)
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        // Reflected control point of the previous curve — what S/T mirror.
        var lastCubicControl: CGPoint?
        var lastQuadControl: CGPoint?
        var command: Character = "M"

        while !scanner.isAtEnd {
            if let next = scanner.command() { command = next }
            let relative = command.isLowercase
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
            }

            switch Character(command.lowercased()) {
            case "m":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = point(x, y)
                subpathStart = current
                path.move(to: current)
                // Extra coordinate pairs after a moveto are implicit linetos.
                command = relative ? "l" : "L"
                lastCubicControl = nil; lastQuadControl = nil

            case "l":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = point(x, y)
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil

            case "h":
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil

            case "v":
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil

            case "c":
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = point(x1, y1), c2 = point(x2, y2)
                current = point(x, y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastCubicControl = c2; lastQuadControl = nil

            case "s":
                guard let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = reflect(lastCubicControl, about: current)
                let c2 = point(x2, y2)
                current = point(x, y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastCubicControl = c2; lastQuadControl = nil

            case "q":
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c = point(x1, y1)
                current = point(x, y)
                path.addQuadCurve(to: current, control: c)
                lastQuadControl = c; lastCubicControl = nil

            case "t":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let c = reflect(lastQuadControl, about: current)
                current = point(x, y)
                path.addQuadCurve(to: current, control: c)
                lastQuadControl = c; lastCubicControl = nil

            case "a":
                guard let rx = scanner.number(), let ry = scanner.number(),
                      let rotation = scanner.number(),
                      let largeArc = scanner.flag(), let sweep = scanner.flag(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let end = point(x, y)
                addArc(&path, from: current, to: end, rx: rx, ry: ry,
                       rotationDegrees: rotation, largeArc: largeArc, sweep: sweep)
                current = end
                lastCubicControl = nil; lastQuadControl = nil

            case "z":
                path.closeSubpath()
                current = subpathStart
                lastCubicControl = nil; lastQuadControl = nil

            default:
                assertionFailure("SVGPathData: unsupported command '\(command)'")
                return path
            }
        }
        return path
    }

    private static func reflect(_ control: CGPoint?, about point: CGPoint) -> CGPoint {
        guard let control else { return point }
        return CGPoint(x: 2 * point.x - control.x, y: 2 * point.y - control.y)
    }

    /// Endpoint-parameterized arc → centre parameterization → cubic segments
    /// (W3C SVG 1.1 implementation notes, F.6.5/F.6.6).
    private static func addArc(
        _ path: inout Path,
        from start: CGPoint,
        to end: CGPoint,
        rx: CGFloat,
        ry: CGFloat,
        rotationDegrees: CGFloat,
        largeArc: Bool,
        sweep: Bool
    ) {
        guard rx != 0, ry != 0 else {
            path.addLine(to: end)
            return
        }
        var rx = abs(rx), ry = abs(ry)
        let phi = rotationDegrees * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx2 = (start.x - end.x) / 2, dy2 = (start.y - end.y) / 2
        let x1p = cosPhi * dx2 + sinPhi * dy2
        let y1p = -sinPhi * dx2 + cosPhi * dy2

        // Scale the radii up if they can't span the chord.
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let scale = sqrt(lambda)
            rx *= scale
            ry *= scale
        }

        let sign: CGFloat = largeArc == sweep ? -1 : 1
        let numerator = max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p)
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let coefficient = denominator == 0 ? 0 : sign * sqrt(numerator / denominator)
        let cxp = coefficient * rx * y1p / ry
        let cyp = -coefficient * ry * x1p / rx
        let center = CGPoint(
            x: cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2,
            y: sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2
        )

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
            guard len > 0 else { return 0 }
            let value = max(-1, min(1, dot / len))
            let sign: CGFloat = (ux * vy - uy * vx) < 0 ? -1 : 1
            return sign * acos(value)
        }

        let ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry
        let vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry
        let theta = angle(1, 0, ux, uy)
        var delta = angle(ux, uy, vx, vy)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }

        // One cubic per ≤90° of sweep keeps the error under a rendering pixel.
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let alpha = 4.0 / 3.0 * tan(step / 4)
        var angleStart = theta
        var point = start

        for _ in 0..<segments {
            let angleEnd = angleStart + step
            let cosStart = cos(angleStart), sinStart = sin(angleStart)
            let cosEnd = cos(angleEnd), sinEnd = sin(angleEnd)
            func map(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(
                    x: cosPhi * rx * x - sinPhi * ry * y + center.x,
                    y: sinPhi * rx * x + cosPhi * ry * y + center.y
                )
            }
            let endPoint = map(cosEnd, sinEnd)
            let derivativeStart = map(-sinStart, cosStart)
            let derivativeEnd = map(-sinEnd, cosEnd)
            let c1 = CGPoint(
                x: point.x + alpha * (derivativeStart.x - center.x),
                y: point.y + alpha * (derivativeStart.y - center.y)
            )
            let c2 = CGPoint(
                x: endPoint.x - alpha * (derivativeEnd.x - center.x),
                y: endPoint.y - alpha * (derivativeEnd.y - center.y)
            )
            path.addCurve(to: endPoint, control1: c1, control2: c2)
            point = endPoint
            angleStart = angleEnd
        }
    }

    /// Tokenizer. SVG path data allows every separator to be implicit, so
    /// numbers have to be scanned character by character (`.079-.2307` is two
    /// numbers, `013.046` after an arc's rotation is two flags and a number).
    private struct Scanner {
        private let characters: [Character]
        private var index = 0

        init(_ data: String) { characters = Array(data) }

        var isAtEnd: Bool {
            var probe = index
            while probe < characters.count, isSeparator(characters[probe]) { probe += 1 }
            return probe >= characters.count
        }

        private func isSeparator(_ c: Character) -> Bool { c == "," || c.isWhitespace }

        private mutating func skipSeparators() {
            while index < characters.count, isSeparator(characters[index]) { index += 1 }
        }

        /// The next command letter, or nil when the run continues with more
        /// coordinates for the command already in force.
        mutating func command() -> Character? {
            skipSeparators()
            guard index < characters.count, characters[index].isLetter else { return nil }
            defer { index += 1 }
            return characters[index]
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            var text = ""
            if index < characters.count, characters[index] == "+" || characters[index] == "-" {
                text.append(characters[index]); index += 1
            }
            var sawDot = false
            while index < characters.count {
                let c = characters[index]
                if c.isNumber {
                    text.append(c); index += 1
                } else if c == ".", !sawDot {
                    sawDot = true; text.append(c); index += 1
                } else if c == "e" || c == "E" {
                    text.append(c); index += 1
                    if index < characters.count, characters[index] == "+" || characters[index] == "-" {
                        text.append(characters[index]); index += 1
                    }
                } else {
                    break
                }
            }
            return Double(text).map { CGFloat($0) }
        }

        /// Arc flags are single digits and may be packed against the next
        /// number with no separator at all.
        mutating func flag() -> Bool? {
            skipSeparators()
            guard index < characters.count, characters[index] == "0" || characters[index] == "1" else {
                return number().map { $0 != 0 }
            }
            defer { index += 1 }
            return characters[index] == "1"
        }
    }
}

// MARK: - Brand artwork
//
// GENERATED FROM design/studio/components/HarnessMark.tsx — the official vendor
// artwork (simple-icons CC0 for Claude + Gemini + Kimi, lobe-icons for OpenAI,
// the xAI asset set for Grok). Path data is VERBATIM; do not hand-edit. To
// refresh, re-export from the studio source rather than retyping.

enum HarnessBrandArtwork {
    static let catalog: [String: HarnessBrandMark] = [
        "claude": HarnessBrandMark(
            viewBox: CGRect(x: 0, y: 0, width: 24, height: 24),
            paths: [
                "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
            ],
            evenOdd: false
        ),
        "codex": HarnessBrandMark(
            viewBox: CGRect(x: 0, y: 0, width: 24, height: 24),
            paths: [
                "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
            ],
            evenOdd: true
        ),
        "gemini": HarnessBrandMark(
            viewBox: CGRect(x: 0, y: 0, width: 24, height: 24),
            paths: [
                "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
            ],
            evenOdd: false
        ),
        "kimi": HarnessBrandMark(
            viewBox: CGRect(x: 0, y: 0, width: 24, height: 24),
            paths: [
                "M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441"
            ],
            evenOdd: false
        ),
        "grok": HarnessBrandMark(
            viewBox: CGRect(x: 0, y: 0, width: 34, height: 33),
            paths: [
                "M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436",
                "M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341"
            ],
            evenOdd: false
        ),
    ]
}
