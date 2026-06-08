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
        case terminal      // window + prompt
        case plus          // rounded square + plus (new)
        case chevron       // canonical ›  (rotate for ‹ ˄ ˅)
        case arrow         // canonical →  (rotate for ← ↑ ↓)
        case gear          // settings
        case folder
        case check
        case signal        // wi-fi / connection (route indicator)
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
