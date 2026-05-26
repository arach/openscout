import SwiftUI

// HudMessageDock — universal bottom-of-panel conversational dock.
//
// Native port of design/studio/components/hud/HudMessageDock.tsx.
// Replaces the old footer ("filed by @scout · <ts> · ESC dismiss") on
// every HUD panel. Always visible. Single input row at every tier.
//
//   mic glyph · [@target] · text input · ↵ SEND · ESC + hyper
//
// State + broker wiring live in HUDDockState. The dock binds to it via
// shared singleton. ↵ submits, Esc clears (or dismisses HUD when empty),
// engage SEND focuses the field. The mic is a hand-drawn SwiftUI Shape
// (no SF Symbols, per the cockpit aesthetic preference).

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
    @ObservedObject private var dock = HUDDockState.shared
    @FocusState private var focused: Bool

    var body: some View {
        GeometryReader { proxy in
            let size = HudDockSize.from(panelWidth: proxy.size.width)
            Group {
                switch size {
                case .compact:
                    CompactDock(
                        pad: size.horizontalPadding,
                        text: $dock.text,
                        target: dock.targetLabel,
                        isSending: dock.isSending,
                        focused: $focused,
                        onSubmit: submit
                    )
                case .medium, .large:
                    MediumLargeDock(
                        size: size,
                        text: $dock.text,
                        target: dock.targetLabel,
                        isSending: dock.isSending,
                        focused: $focused,
                        onSubmit: submit
                    )
                }
            }
            .frame(width: proxy.size.width, alignment: .leading)
        }
        .frame(height: dockHeight)
        .onChange(of: dock.focusRequested) { _, _ in focused = true }
        .onChange(of: dock.blurRequested)  { _, _ in focused = false }
    }

    private func submit() {
        Task { await dock.send() }
    }

    private var dockHeight: CGFloat {
        // 32 compact, 36 medium, 46 large — the dock fills from the bottom
        // within this reservation. 48 covers all three tiers.
        48
    }
}

// ─── Compact — single 32px row ──────────────────────────────────────

private struct CompactDock: View {
    let pad: CGFloat
    @Binding var text: String
    let target: String?
    let isSending: Bool
    @FocusState.Binding var focused: Bool
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                MicButton(box: 20, glyph: 12)

                if let target {
                    TargetChip(label: target)
                }

                TextField("talk — / commands · /s search", text: $text)
                    .textFieldStyle(.plain)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.ink)
                    .focused($focused)
                    .onSubmit(onSubmit)
                    .frame(maxWidth: .infinity, alignment: .leading)

                SendChip(small: true, dimmed: text.isEmpty || isSending)
                EscChip()
                HyperKeyChip()
            }
            .padding(.horizontal, pad)
            .frame(height: 32)
            .frame(maxWidth: .infinity)
            .background(HUDChrome.canvas)
            .overlay(alignment: .top) {
                // Warm-cream hairline framing — same family as the panel
                // rim but at a fraction of the alpha. Cuts the dock out
                // of the body the way Lattices' "Hold to speak" strip
                // sits below its log column.
                Rectangle()
                    .fill(HUDChrome.borderRim.opacity(0.55))
                    .frame(height: 0.5)
            }
        }
    }
}

// ─── Medium / Large — two rows ──────────────────────────────────────

private struct MediumLargeDock: View {
    let size: HudDockSize
    @Binding var text: String
    let target: String?
    let isSending: Bool
    @FocusState.Binding var focused: Bool
    let onSubmit: () -> Void

    private var isLarge: Bool { size == .large }
    private var inputH: CGFloat { isLarge ? 46 : 36 }
    private var micBox: CGFloat { isLarge ? 28 : 24 }
    private var micGlyph: CGFloat { isLarge ? 16 : 14 }
    private var placeholderSize: CGFloat { isLarge ? 12.5 : 11.5 }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            // Input row — lifted to canvasAlt so the dock reads recessed
            // from the panel body without a hairline divider.
            HStack(spacing: 10) {
                MicButton(box: micBox, glyph: micGlyph)

                if let target {
                    TargetChip(label: target)
                }

                TextField("talk to the assistant — / for commands, /s to search", text: $text)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(placeholderSize))
                    .foregroundStyle(HUDChrome.ink)
                    .focused($focused)
                    .onSubmit(onSubmit)
                    .frame(maxWidth: .infinity, alignment: .leading)

                SendChip(small: false, dimmed: text.isEmpty || isSending)

                HStack(spacing: 8) {
                    EscChip()
                    HyperKeyChip()
                }
                .padding(.leading, 4)
            }
            .padding(.horizontal, size.horizontalPadding)
            .frame(height: inputH)
            .frame(maxWidth: .infinity)
            .background(HUDChrome.canvas)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(HUDChrome.borderRim.opacity(0.55))
                    .frame(height: 0.5)
            }
        }
    }
}

// ─── Target chip (telegraphs routing) ───────────────────────────────

private struct TargetChip: View {
    let label: String

    var body: some View {
        HStack(spacing: 3) {
            Text(label.hasPrefix("@") ? label : "@" + label)
                .font(HUDType.mono(10, weight: .semibold))
                .foregroundStyle(HUDChrome.accent)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .overlay(
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .stroke(HUDChrome.accent.opacity(0.45), lineWidth: 0.5)
        )
        .fixedSize()
    }
}

// ─── SEND chip (lights up when text is present) ─────────────────────

private struct SendChip: View {
    let small: Bool
    let dimmed: Bool

    var body: some View {
        HStack(spacing: 4) {
            Text("↵")
                .font(HUDType.mono(small ? 9 : 10, weight: .semibold))
                .foregroundStyle(dimmed ? HUDChrome.inkFaint : HUDChrome.accent)
            Text("SEND")
                .font(HUDType.mono(small ? 9 : 10, weight: .semibold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(dimmed ? HUDChrome.inkFaint : HUDChrome.accent)
        }
        .fixedSize()
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
