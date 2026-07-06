import AppKit
import ScoutAppCore
import ScoutNativeCore
import ScoutSharedUI
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
    let agents: [HudAgent]

    @ObservedObject private var dock = HUDDockState.shared
    @ObservedObject private var compose = ScoutComposeService.shared
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
        .overlay(alignment: .topLeading) {
            if dock.suggestionsVisible {
                MessageSuggestionPopover(
                    suggestions: dock.suggestions,
                    selectedIndex: dock.selectedSuggestionIndex,
                    style: .hud,
                    onHover: { dock.selectSuggestion(index: $0) },
                    onSelect: { dock.applySuggestion($0) }
                )
                .padding(.horizontal, size.horizontalPadding)
                .offset(y: -suggestionPopoverHeight(count: dock.suggestions.count) - 4)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
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
        .onChange(of: dock.text) { _, _ in refreshSuggestions() }
        .onChange(of: agents) { _, next in
            dock.setSuggestionAgents(next)
        }
        .onAppear { refreshSuggestions() }
    }

    private func submit() {
        if dock.applySelectedSuggestion() { return }
        // Snapshot + clear synchronously so the field empties on the
        // same runloop tick as the keypress — no Task hop between the
        // user pressing return and SwiftUI seeing an empty binding.
        // ScoutComposeService still echoes the message into the thread
        // before the network round-trip resolves.
        let outgoing = dock.text
        dock.text = ""
        Task { await dock.send(body: outgoing) }
    }

    private func refreshSuggestions() {
        dock.setSuggestionAgents(agents)
    }

    private func suggestionPopoverHeight(count: Int) -> CGFloat {
        25 + CGFloat(min(max(count, 1), 7)) * 38
    }
}

// ─── Shared input atom styles ───────────────────────────────────────

private extension MessageSuggestionPopoverStyle {
    static let hud = MessageSuggestionPopoverStyle(
        eyebrowFont: HUDType.mono(10, weight: .bold),
        markFont: HUDType.mono(9, weight: .bold),
        labelFont: HUDType.mono(11, weight: .semibold),
        detailFont: HUDType.body(10),
        eyebrowColor: HUDChrome.inkFaint,
        commandAccent: HUDChrome.accent,
        agentAccent: HUDChrome.ink,
        sessionAccent: HUDChrome.accentDim,
        selectedLabelColor: HUDChrome.ink,
        labelColor: HUDChrome.inkMuted,
        detailColor: HUDChrome.inkFaint,
        selectedBackgroundColor: HUDChrome.canvasLift.opacity(0.62),
        backgroundColor: HUDChrome.canvasAlt,
        borderColor: HUDChrome.borderStrong,
        shadowColor: Color.black.opacity(0.24),
        cornerRadius: 6,
        borderWidth: 0.75
    )
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

    @ObservedObject private var voice = HudVoiceService.shared

    private var showDictationPreview: Bool {
        text.isEmpty && (voice.state.isCaptureActive || voice.state.isProcessing)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                MicButton(box: 20, glyph: 12)
                SpeakerButton(box: 20, glyph: 12)

                if let target {
                    MessageRouteChip(label: target, style: .hud)
                    MessageContextPill(name: threadName, style: .hud)
                }

                ZStack(alignment: .leading) {
                    TextField(showDictationPreview ? "" : "talk — / commands · @ agents", text: $text)
                        .textFieldStyle(.plain)
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.ink)
                        .focused($focused)
                        .onKeyPress(phases: .down) { press in
                            guard press.key == .return else { return .ignored }
                            guard press.modifiers.contains(.command) || press.modifiers.contains(.control) else { return .ignored }
                            onSubmit()
                            return .handled
                        }
                        .onSubmit(onSubmit)
                    if showDictationPreview {
                        DictationLivePreview(text: voice.partial)
                            .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                MessageSendChip(isEnabled: !text.isEmpty, isSending: isSending, style: .hud(small: true), action: onSubmit)
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

    @ObservedObject private var voice = HudVoiceService.shared

    private var isLarge: Bool { size == .large }
    private var minInputH: CGFloat { isLarge ? 46 : 36 }
    private var micBox: CGFloat { isLarge ? 28 : 24 }
    private var micGlyph: CGFloat { isLarge ? 16 : 14 }
    // Slightly smaller than the prior sans sizes — mono reads heavier.
    private var placeholderSize: CGFloat { isLarge ? 11.5 : 10.5 }
    private var showDictationPreview: Bool {
        text.isEmpty && (voice.state.isCaptureActive || voice.state.isProcessing)
    }

    var body: some View {
        // Top-aligned: chips stay with the first line; the text field
        // grows downward as the operator types. lineLimit(1...5) caps
        // growth so a runaway paste can't push the whole HUD around.
        HStack(alignment: .top, spacing: 10) {
            MicButton(box: micBox, glyph: micGlyph)
            SpeakerButton(box: micBox, glyph: micGlyph)

            if let target {
                MessageRouteChip(label: target, style: .hud)
                    .padding(.top, isLarge ? 6 : 4)
                MessageContextPill(name: threadName, style: .hud)
                    .padding(.top, isLarge ? 6 : 4)
            }

            ZStack(alignment: .topLeading) {
                TextField(
                    showDictationPreview ? "" : "talk to the assistant — / commands, @ for agents",
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
                .onKeyPress(phases: .down) { press in
                    guard press.key == .return else { return .ignored }
                    guard press.modifiers.contains(.command) || press.modifiers.contains(.control) else { return .ignored }
                    onSubmit()
                    return .handled
                }
                .onSubmit(onSubmit)
                if showDictationPreview {
                    DictationLivePreview(text: voice.partial, fontSize: placeholderSize)
                        .allowsHitTesting(false)
                        .padding(.top, 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, isLarge ? 4 : 3)

            MessageSendChip(isEnabled: !text.isEmpty, isSending: isSending, style: .hud(small: false), action: onSubmit)
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

private extension MessageRouteChipStyle {
    static let hud = MessageRouteChipStyle(
        font: HUDType.mono(10, weight: .semibold),
        textColor: HUDChrome.accent,
        borderColor: HUDChrome.accent.opacity(0.45),
        horizontalPadding: 6,
        verticalPadding: 2,
        cornerRadius: 3
    )
}

private extension MessageContextPillStyle {
    static let hud = MessageContextPillStyle(
        separatorFont: HUDType.mono(10, weight: .semibold),
        textFont: HUDType.mono(10),
        separatorColor: HUDChrome.inkFaint,
        textColor: HUDChrome.inkMuted
    )
}

private extension MessageSendChipStyle {
    static func hud(small: Bool) -> MessageSendChipStyle {
        MessageSendChipStyle(
            keyFont: HUDType.mono(small ? 9 : 10, weight: .semibold),
            titleFont: HUDType.mono(small ? 9 : 10, weight: .semibold),
            tracking: HUDType.eyebrowMicro,
            enabledColor: HUDChrome.accent,
            hoverColor: HUDChrome.ink,
            disabledColor: HUDChrome.inkFaint,
            horizontalPadding: 4,
            verticalPadding: 2
        )
    }
}

// ─── Mic button (hand-drawn glyph, no SF Symbols) ───────────────────

/// Tap → toggle dictation. Hold (≥250ms) → push-to-talk: talk while held,
/// release to send the transcript to the target. Visual state mirrors
/// HudVoiceService.state:
///   idle/probing      → faint ink stroke
///   starting          → ink stroke + soft pulse
///   recording         → accent stroke + halo + pulse
///   processing        → faint stroke + spinner-ish pulse
///   unavailable       → very dim + dashed (and a `.help` tooltip with
///                       the reason; tapping re-probes)
private struct MicButton: View {
    let box: CGFloat
    let glyph: CGFloat

    @ObservedObject private var voice = HudVoiceService.shared
    @State private var pulse = false

    private var isRecording: Bool {
        voice.state.isCaptureActive
    }

    private var isProcessing: Bool {
        voice.state.isProcessing
    }

    private var isUnavailable: Bool {
        voice.state.isUnavailable
    }

    private var strokeColor: Color {
        if isRecording { return HUDChrome.accent }
        if isProcessing { return HUDChrome.inkMuted }
        if isUnavailable { return HUDChrome.inkFaint.opacity(0.5) }
        return HUDChrome.inkFaint
    }

    private var tooltip: String {
        switch voice.state {
        case .probing:               return "Preparing voice…"
        case .idle:                  return "Tap to dictate · hold to talk-and-send to the target"
        case .starting:              return "Starting recording…"
        case .recording:             return "Recording — release to send, or tap to commit"
        case .processing:            return "Transcribing…"
        case .unavailable(let r):    return r
        }
    }

    // Press-and-hold plumbing. A press held ≥250ms enters push-to-talk
    // (beginHoldToTalk on threshold-crossing, endHoldToTalk on release);
    // a short press keeps the existing tap-to-toggle dictation.
    @State private var pressBeganAt: Date?
    @State private var holdActive = false
    @State private var holdArmTask: Task<Void, Never>?

    private var pressGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard pressBeganAt == nil else { return }   // debounce repeats
                pressBeganAt = Date()
                holdActive = false
                holdArmTask?.cancel()
                holdArmTask = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    guard !Task.isCancelled, pressBeganAt != nil else { return }
                    holdActive = true
                    HUDDockState.shared.beginHoldToTalk()
                }
            }
            .onEnded { _ in
                holdArmTask?.cancel()
                holdArmTask = nil
                let wasHold = holdActive
                pressBeganAt = nil
                holdActive = false
                if wasHold {
                    HUDDockState.shared.endHoldToTalk()
                } else {
                    Task { @MainActor in await HUDDockState.shared.toggleDictation() }
                }
            }
    }

    var body: some View {
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
        .gesture(pressGesture)
        .help(tooltip)
        .task { if voice.state == .probing { await voice.probe() } }
        .onChange(of: voice.state) { _, newValue in
            // Drive the pulse based on whether we're hot/processing.
            pulse = false
            if newValue == .recording || newValue == .starting || newValue == .processing {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
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

// ─── Speaker toggle (spoken agent replies) ──────────────────────────

/// One obvious switch for spoken agent replies. Toggles the UserDefaults
/// gate "scout.voiceRepliesEnabled" via HUDReplySpeaker (default OFF).
/// Accent stroke when ON; a soft halo pulses while a reply is actually
/// being spoken. Same hand-drawn stroke family as MicGlyphShape.
private struct SpeakerButton: View {
    let box: CGFloat
    let glyph: CGFloat

    @ObservedObject private var speaker = HUDReplySpeaker.shared
    @State private var pulse = false

    private var isOn: Bool { speaker.enabled }

    private var strokeColor: Color {
        isOn ? HUDChrome.accent : HUDChrome.inkFaint
    }

    private var tooltip: String {
        isOn
            ? "Spoken replies on — tap to mute the agent's voice"
            : "Spoken replies off — tap to hear agent replies aloud"
    }

    var body: some View {
        Button(action: { speaker.toggle() }) {
            ZStack {
                if isOn && speaker.isSpeaking {
                    Circle()
                        .fill(HUDChrome.accent.opacity(pulse ? 0.20 : 0.06))
                        .frame(width: box, height: box)
                }
                SpeakerGlyphShape(muted: !isOn)
                    .stroke(
                        strokeColor,
                        style: StrokeStyle(
                            lineWidth: isOn ? 1.4 : 1,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                    .frame(width: glyph, height: glyph)
            }
            .frame(width: box, height: box)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(tooltip)
        .onChange(of: speaker.isSpeaking) { _, speaking in
            pulse = false
            if speaking {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
        }
    }
}

// SpeakerGlyphShape — a small speaker cone (foot + cone box) with one or
// two emitted waves. Drawn on the same 14×14 viewBox and stroke weight as
// MicGlyphShape so the pair reads as one hand-drawn set. When `muted`, the
// waves are dropped and a short slash sits over the cone.
private struct SpeakerGlyphShape: Shape {
    var muted: Bool

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()

        // Cone body — a small box on the left driving out to a trapezoid.
        path.move(to: p(2, 5.5))
        path.addLine(to: p(4, 5.5))
        path.addLine(to: p(7, 3))
        path.addLine(to: p(7, 11))
        path.addLine(to: p(4, 8.5))
        path.addLine(to: p(2, 8.5))
        path.closeSubpath()

        if muted {
            // Short slash across the cone mouth.
            path.move(to: p(9, 4.5))
            path.addLine(to: p(12.5, 9.5))
        } else {
            // Two emitted waves.
            path.move(to: p(9, 5))
            path.addQuadCurve(to: p(9, 9), control: p(10.6, 7))
            path.move(to: p(10.8, 3.6))
            path.addQuadCurve(to: p(10.8, 10.4), control: p(13, 7))
        }

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
