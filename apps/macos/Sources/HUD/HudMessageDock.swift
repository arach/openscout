import AppKit
import ScoutNativeCore
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

private struct DockWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

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
    @ObservedObject private var compose = HudComposeService.shared
    @FocusState private var focused: Bool
    @State private var panelWidth: CGFloat = 0

    // Active thread name for the dock's target row. Defaults to "default"
    // until the thread map loads (stage 1 always resolves to that anyway).
    private var threadName: String {
        compose.activeThread?.name ?? "default"
    }

    var body: some View {
        // Width is measured via a background-attached GeometryReader so it
        // doesn't impose a vertical layout (a wrapping GeometryReader fills
        // its parent vertically, which collapses any child that uses
        // `.fixedSize(vertical: true)`). The actual dock content owns its
        // own intrinsic height — and the multi-line TextField grows it.
        let size = HudDockSize.from(panelWidth: panelWidth)
        Group {
            switch size {
            case .compact:
                CompactDock(
                    pad: size.horizontalPadding,
                    text: $dock.text,
                    target: dock.targetLabel,
                    threadName: threadName,
                    isSending: dock.isSending,
                    focused: $focused,
                    onSubmit: submit
                )
            case .medium, .large:
                MediumLargeDock(
                    size: size,
                    text: $dock.text,
                    target: dock.targetLabel,
                    threadName: threadName,
                    isSending: dock.isSending,
                    focused: $focused,
                    onSubmit: submit
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: DockWidthKey.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(DockWidthKey.self) { panelWidth = $0 }
        .onChange(of: dock.focusRequested) { _, _ in
            focused = true
            DockFieldSelection.moveCaretToEndSoon()
        }
        .onChange(of: dock.blurRequested)  { _, _ in focused = false }
    }

    private func submit() {
        // Snapshot + clear synchronously so the field empties on the
        // same runloop tick as the keypress — no Task hop between the
        // user pressing return and SwiftUI seeing an empty binding.
        // HudComposeService still echoes the message into the thread
        // before the network round-trip resolves.
        let outgoing = dock.text
        dock.text = ""
        Task { await dock.send(body: outgoing) }
    }
}

// ─── Compact — single 32px row ──────────────────────────────────────

private struct CompactDock: View {
    let pad: CGFloat
    @Binding var text: String
    let target: String?
    let threadName: String
    let isSending: Bool
    @FocusState.Binding var focused: Bool
    let onSubmit: () -> Void

    @ObservedObject private var vox = ScoutVoiceService.shared

    private var showDictationPreview: Bool {
        text.isEmpty && (vox.state.isCaptureActive || vox.state.isProcessing)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                MicButton(box: 20, glyph: 12)

                if let target {
                    TargetChip(label: target)
                    ThreadPill(name: threadName)
                }

                ZStack(alignment: .leading) {
                    TextField(showDictationPreview ? "" : "talk — / commands · /s search", text: $text)
                        .textFieldStyle(.plain)
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.ink)
                        .focused($focused)
                        .onSubmit(onSubmit)
                    if showDictationPreview {
                        DictationLivePreview(text: vox.partial)
                            .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                SendChip(small: true, dimmed: text.isEmpty || isSending, onTap: onSubmit)
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
    let threadName: String
    let isSending: Bool
    @FocusState.Binding var focused: Bool
    let onSubmit: () -> Void

    @ObservedObject private var vox = ScoutVoiceService.shared

    private var isLarge: Bool { size == .large }
    private var minInputH: CGFloat { isLarge ? 46 : 36 }
    private var micBox: CGFloat { isLarge ? 28 : 24 }
    private var micGlyph: CGFloat { isLarge ? 16 : 14 }
    // Slightly smaller than the prior sans sizes — mono reads heavier.
    private var placeholderSize: CGFloat { isLarge ? 11.5 : 10.5 }
    private var showDictationPreview: Bool {
        text.isEmpty && (vox.state.isCaptureActive || vox.state.isProcessing)
    }

    var body: some View {
        // Top-aligned: chips stay with the first line; the text field
        // grows downward as the operator types. lineLimit(1...5) caps
        // growth so a runaway paste can't push the whole HUD around.
        HStack(alignment: .top, spacing: 10) {
            MicButton(box: micBox, glyph: micGlyph)

            if let target {
                TargetChip(label: target)
                    .padding(.top, isLarge ? 6 : 4)
                ThreadPill(name: threadName)
                    .padding(.top, isLarge ? 6 : 4)
            }

            ZStack(alignment: .topLeading) {
                TextField(
                    showDictationPreview ? "" : "talk to the assistant — / for commands, /s to search",
                    text: $text,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                // Mono small for cockpit voice and to match the message
                // thread font; matches CompactDock which is already mono.
                .font(HUDType.mono(placeholderSize))
                .foregroundStyle(HUDChrome.ink)
                .focused($focused)
                .onSubmit(onSubmit)
                if showDictationPreview {
                    DictationLivePreview(text: vox.partial, fontSize: placeholderSize)
                        .allowsHitTesting(false)
                        .padding(.top, 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, isLarge ? 4 : 3)

            SendChip(small: false, dimmed: text.isEmpty || isSending, onTap: onSubmit)
                .padding(.top, isLarge ? 6 : 4)

            HStack(spacing: 8) {
                EscChip()
                HyperKeyChip()
            }
            .padding(.leading, 4)
            .padding(.top, isLarge ? 6 : 4)
        }
        .padding(.horizontal, size.horizontalPadding)
        .padding(.vertical, isLarge ? 6 : 4)
        .frame(maxWidth: .infinity, minHeight: minInputH, alignment: .top)
        .background(HUDChrome.canvas)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(HUDChrome.borderRim.opacity(0.55))
                .frame(height: 0.5)
        }
    }
}

// ─── Dictation insertion affordances ────────────────────────────────

@MainActor
private enum DockFieldSelection {
    static func moveCaretToEndSoon() {
        moveCaretToEnd()
        Task { @MainActor in
            await Task.yield()
            moveCaretToEnd()
            await Task.yield()
            moveCaretToEnd()
        }
    }

    private static func moveCaretToEnd() {
        guard let editor = NSApp.windows
            .compactMap({ $0.firstResponder as? NSText })
            .first(where: { $0.isEditable })
        else { return }

        let length = (editor.string as NSString).length
        editor.selectedRange = NSRange(location: length, length: 0)
    }
}

private struct DictationLivePreview: View {
    let text: String
    var fontSize: CGFloat = 10

    @State private var caretLit = false

    private var displayText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: 4) {
            if !displayText.isEmpty {
                Text(displayText)
                    .font(HUDType.mono(fontSize))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            RoundedRectangle(cornerRadius: 0.5, style: .continuous)
                .fill(HUDChrome.accent.opacity(caretLit ? 0.95 : 0.25))
                .frame(width: 1, height: max(10, fontSize + 2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.48).repeatForever(autoreverses: true)) {
                caretLit = true
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

// ─── Thread pill (which scoutbot thread the send lands in) ──────────
//
// Subtle, borderless, mid-dot separator: reads as secondary metadata
// next to the @target chip rather than a second chip competing for
// attention. Static in stage 1; stage 2 will swap this for an
// interactive switcher.
private struct ThreadPill: View {
    let name: String

    var body: some View {
        HStack(spacing: 3) {
            Text("·")
                .font(HUDType.mono(10, weight: .semibold))
                .foregroundStyle(HUDChrome.inkFaint)
            Text(name)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkMuted)
        }
        .fixedSize()
    }
}

// ─── SEND chip (lights up when text is present) ─────────────────────

private struct SendChip: View {
    let small: Bool
    let dimmed: Bool
    let onTap: () -> Void

    @State private var hovered = false

    private var color: Color {
        if dimmed { return HUDChrome.inkFaint }
        return hovered ? HUDChrome.ink : HUDChrome.accent
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Text("↵")
                    .font(HUDType.mono(small ? 9 : 10, weight: .semibold))
                    .foregroundStyle(color)
                Text("SEND")
                    .font(HUDType.mono(small ? 9 : 10, weight: .semibold))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(color)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(dimmed)
        .onHover { hovered = $0 }
        .help(dimmed ? "" : "Send (↵)")
    }
}

// ─── Mic button (hand-drawn glyph, no SF Symbols) ───────────────────

/// Tap -> toggle dictation. Visual state mirrors ScoutVoiceService.state:
///   idle/probing      → faint ink stroke
///   starting          → ink stroke + soft pulse
///   recording         → accent stroke + halo + pulse
///   processing        → faint stroke + spinner-ish pulse
///   unavailable       → very dim + dashed (and a `.help` tooltip with
///                       the reason; tapping re-probes)
private struct MicButton: View {
    let box: CGFloat
    let glyph: CGFloat

    @ObservedObject private var vox = ScoutVoiceService.shared
    @State private var pulse = false

    private var isRecording: Bool {
        vox.state.isCaptureActive
    }

    private var isProcessing: Bool {
        vox.state.isProcessing
    }

    private var isUnavailable: Bool {
        vox.state.isUnavailable
    }

    private var strokeColor: Color {
        if isRecording { return HUDChrome.accent }
        if isProcessing { return HUDChrome.inkMuted }
        if isUnavailable { return HUDChrome.inkFaint.opacity(0.5) }
        return HUDChrome.inkFaint
    }

    private var tooltip: String {
        switch vox.state {
        case .probing:               return "Checking voice…"
        case .idle:                  return "Hold to dictate (or tap to start)"
        case .starting:              return "Starting recording…"
        case .recording:             return "Recording — tap to commit"
        case .processing:            return "Transcribing…"
        case .unavailable(let r):    return r
        }
    }

    var body: some View {
        Button(action: handleTap) {
            ZStack {
                // Pulsing halo only when actively recording — accent at
                // 14-20% alpha so the dock still reads composed.
                if isRecording {
                    Circle()
                        .fill(HUDChrome.accent.opacity(pulse ? 0.20 : 0.08))
                        .frame(width: box, height: box)
                }
                MicGlyphShape()
                    .stroke(
                        strokeColor,
                        style: StrokeStyle(
                            lineWidth: isRecording ? 1.4 : 1,
                            lineCap: .round,
                            lineJoin: .round,
                            dash: isUnavailable ? [1.5, 1.5] : []
                        )
                    )
                    .frame(width: glyph, height: glyph)
                    .opacity(isProcessing && pulse ? 0.55 : 1.0)
            }
            .frame(width: box, height: box)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(tooltip)
        .task { if vox.state == .probing { await vox.probe() } }
        .onChange(of: vox.state) { _, newValue in
            // Drive the pulse based on whether we're hot/processing.
            pulse = false
            if newValue == .recording || newValue == .starting || newValue == .processing {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
        }
    }

    private func handleTap() {
        Task { @MainActor in
            await HUDDockState.shared.toggleDictation()
        }
    }
}

// MicGlyphShape — slim capsule body sitting in a U-cradle that drops
// to a short stem and a flat foot. Drawn on a 14×14 viewBox; pairs with
// RobotGlyphShape + YouGlyphShape at the same stroke weight so the
// hand-drawn family reads as one set.
//
// The old version had the cradle arc starting at y=7.5 (inside the
// body) and sweeping the wrong way, which produced a shape that didn't
// read as a mic. Now: body in upper half, cradle below it, stem and
// foot — the classic studio-mic silhouette.
private struct MicGlyphShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()

        // Body — slim rounded capsule taking the upper half.
        let bodyRect = CGRect(
            x: rect.minX + 5 * sx,
            y: rect.minY + 2 * sy,
            width: 4 * sx,
            height: 6.5 * sy
        )
        let rx = 2 * min(sx, sy)
        path.addRoundedRect(in: bodyRect, cornerSize: CGSize(width: rx, height: rx))

        // Cradle — U-shaped quadratic curve sitting below the body,
        // slightly wider on each side so the body reads as resting in
        // it. Control point at (7, 13.5) → bezier peak at (7, 11).
        path.move(to: p(4, 8.5))
        path.addQuadCurve(to: p(10, 8.5), control: p(7, 13.5))

        // Stem — short vertical from the cradle's peak down to the foot.
        path.move(to: p(7, 11))
        path.addLine(to: p(7, 12.7))

        // Foot — flat horizontal base.
        path.move(to: p(5, 12.7))
        path.addLine(to: p(9, 12.7))

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
