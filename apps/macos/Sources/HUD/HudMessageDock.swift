import SwiftUI

// HudMessageDock — universal bottom-of-panel conversational dock.
//
// Native port of design/studio/components/hud/HudMessageDock.tsx.
// Replaces the old footer ("filed by @scout · <ts> · ESC dismiss") on
// every HUD panel. Always visible. Two stacked rows at medium/large,
// one row at compact.
//
//   row 1 — activity strip  (`↑ 3 responses · 12 messages today`)
//           collapses to inline `↑ N · M msg` chip at compact
//   row 2 — input row       (mic glyph · placeholder · ↵ SEND · ESC + hyper)
//
// This is a visual surface only — no TextField, no broker wire-up. The
// placeholder is a Text, not a real input. The mic is a hand-drawn
// SwiftUI Shape (no SF Symbols, per the cockpit aesthetic preference).
//
// No hairline divider between the strip and input row — separation is
// carried by the lightness lift from canvas → canvasAlt, per the
// no-white-alpha-dividers rule.

enum HudDockSize {
    case compact
    case medium
    case large

    static func from(panelWidth w: CGFloat) -> HudDockSize {
        if w >= 880 { return .large }
        if w >= 640 { return .medium }
        return .compact
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .compact: return 12
        case .medium:  return 16
        case .large:   return 20
        }
    }
}

struct HudMessageDock: View {
    var responseCount: Int = 3
    var messageCount: Int = 12

    var body: some View {
        GeometryReader { proxy in
            let size = HudDockSize.from(panelWidth: proxy.size.width)
            Group {
                switch size {
                case .compact:
                    CompactDock(
                        responseCount: responseCount,
                        messageCount: messageCount,
                        pad: size.horizontalPadding
                    )
                case .medium, .large:
                    MediumLargeDock(
                        size: size,
                        responseCount: responseCount,
                        messageCount: messageCount
                    )
                }
            }
            .frame(width: proxy.size.width, alignment: .leading)
        }
        .frame(height: dockHeight)
    }

    // Reserve the right vertical space at the outer level so GeometryReader
    // doesn't collapse. Compact is a single row; medium/large are two rows.
    // We pick the larger (medium) reservation by default; large rows fit
    // within the same outer height because we let the inner content drive
    // intrinsic height. Use a tight fixed value to stay close to the studio.
    private var dockHeight: CGFloat {
        // 32 compact, 52 medium, 64 large — but height is decided at
        // render time inside GeometryReader. We must hand a value to the
        // outer frame to give GeometryReader a height. Conservative:
        // 64 covers all three; the dock fills it from the bottom.
        64
    }
}

// ─── Compact — single 32px row ──────────────────────────────────────

private struct CompactDock: View {
    let responseCount: Int
    let messageCount: Int
    let pad: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                MicButton(box: 20, glyph: 12)

                Text("talk — / commands · /s search")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 4) {
                    Text("↵")
                        .font(HUDType.mono(9, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkFaint)
                    Text("SEND")
                        .font(HUDType.mono(9, weight: .semibold))
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(HUDChrome.inkFaint)
                }
                .fixedSize()

                EscChip()
                HyperKeyChip()
            }
            .padding(.horizontal, pad)
            .frame(height: 32)
            .frame(maxWidth: .infinity)
            .background(HUDChrome.canvasAlt)
        }
    }
}

// ─── Medium / Large — two rows ──────────────────────────────────────

private struct MediumLargeDock: View {
    let size: HudDockSize
    let responseCount: Int
    let messageCount: Int

    private var isLarge: Bool { size == .large }
    private var stripH: CGFloat { isLarge ? 18 : 16 }
    private var inputH: CGFloat { isLarge ? 46 : 36 }
    private var micBox: CGFloat { isLarge ? 28 : 24 }
    private var micGlyph: CGFloat { isLarge ? 16 : 14 }
    private var placeholderSize: CGFloat { isLarge ? 12.5 : 11.5 }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            // Activity strip — sits on panel-body canvas, reads as the
            // closing line of the content. No divider — separation
            // comes from the lift to canvasAlt below.
            HStack(spacing: 6) {
                Text("↑")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("\(responseCount)")
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("responses")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("·")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("\(messageCount)")
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("messages today")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, size.horizontalPadding)
            .frame(height: stripH)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(HUDChrome.canvas)

            // Input row — slightly lifted (canvasAlt) so the row reads
            // recessed from the body without a hairline.
            HStack(spacing: 10) {
                MicButton(box: micBox, glyph: micGlyph)

                Text("talk to the assistant — / for commands, /s to search")
                    .font(HUDType.body(placeholderSize))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 4) {
                    Text("↵")
                        .font(HUDType.mono(10, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkFaint)
                    Text("SEND")
                        .font(HUDType.mono(10, weight: .semibold))
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(HUDChrome.inkFaint)
                }
                .fixedSize()

                HStack(spacing: 8) {
                    EscChip()
                    HyperKeyChip()
                }
                .padding(.leading, 4)
            }
            .padding(.horizontal, size.horizontalPadding)
            .frame(height: inputH)
            .frame(maxWidth: .infinity)
            .background(HUDChrome.canvasAlt)
        }
    }
}

// ─── Mic button (hand-drawn glyph, no SF Symbols) ───────────────────

private struct MicButton: View {
    let box: CGFloat
    let glyph: CGFloat

    var body: some View {
        ZStack {
            MicGlyphShape()
                .stroke(HUDChrome.inkFaint, style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                .frame(width: glyph, height: glyph)
        }
        .frame(width: box, height: box)
    }
}

// MicGlyphShape — capsule body + cradle arc + stem-to-base, faithfully
// mirroring the studio SVG (viewBox 0 0 14 14) scaled to the shape rect.
private struct MicGlyphShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()

        // Capsule body: rect x=5 y=2 w=4 h=6.5 rx=2
        let bodyRect = CGRect(
            x: rect.minX + 5 * sx,
            y: rect.minY + 2 * sy,
            width: 4 * sx,
            height: 6.5 * sy
        )
        let rx = 2 * min(sx, sy)
        path.addRoundedRect(in: bodyRect, cornerSize: CGSize(width: rx, height: rx))

        // Cradle arc: M3.5 7.5 A3.5 3.5 0 0 0 10.5 7.5
        // Arc from (3.5,7.5) to (10.5,7.5), sweeping downward through (7, 11).
        let arcStart = p(3.5, 7.5)
        let arcEnd = p(10.5, 7.5)
        let arcCenter = p(7, 7.5)
        let arcRadius = 3.5 * sx
        path.move(to: arcStart)
        path.addArc(
            center: arcCenter,
            radius: arcRadius,
            startAngle: .degrees(180),
            endAngle: .degrees(0),
            clockwise: false
        )
        _ = arcEnd // silence unused

        // Stem: line from (7, 10.5) to (7, 12)
        path.move(to: p(7, 10.5))
        path.addLine(to: p(7, 12))

        return path
    }
}

// ─── ESC chip ───────────────────────────────────────────────────────

private struct EscChip: View {
    var body: some View {
        Text("ESC")
            .font(HUDType.mono(8, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(HUDChrome.inkFaint)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(HUDChrome.canvas)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 0.5)
            )
    }
}

// ─── Hyper key chip ─────────────────────────────────────────────────

private struct HyperKeyChip: View {
    var body: some View {
        HStack(spacing: 1) {
            ForEach(["⌃", "⌥", "⇧", "⌘"], id: \.self) { glyph in
                Text(glyph)
                    .font(HUDType.mono(8, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            Text("H")
                .font(HUDType.mono(8, weight: .bold))
                .foregroundStyle(HUDChrome.accent)
                .padding(.leading, 1)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 1.5)
        .background(
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(HUDChrome.canvas)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .stroke(HUDChrome.border, lineWidth: 0.5)
        )
    }
}
