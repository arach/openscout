import SwiftUI
import UIKit
import HudsonUIKeyboard

/// Bridges hudson's `HudHostedKeyboard` (the full in-app terminal keyboard,
/// extracted from talkie) to the live PTY. Every key arrives as a
/// `KeyboardAction`; we translate it to bytes and write them straight to the
/// channel via `send` (Termini's `onTransportWrite`). Ported from talkie's
/// `SSHTerminalHostedKeyboardView`, swapping its SSH session for our transport.
/// How the live voice session maps onto the keyboard's dictate button. The
/// keyboard owns only the button's visual state; the host (`TerminalSurface`)
/// drives it from hudson's `HudDictation`.
enum TerminalDictationPhase: Equatable {
    case idle, recording, processing

    var keyboardState: HudHostedKeyboard.DictationState {
        switch self {
        case .idle:       return .idle
        case .recording:  return .recording
        case .processing: return .processing
        }
    }
}

struct TerminalHostedKeyboard: UIViewRepresentable {
    /// Writes raw bytes to the PTY channel.
    var send: (Data) -> Void
    /// Tapping the mic toggles dictation. The host owns the voice engine
    /// (hudson's `HudDictation`) and feeds the transcript back through `send`;
    /// the keyboard is just the toggle + state UI.
    var onDictate: () -> Void
    /// Mirrors the live voice session onto the dictate button.
    var dictationPhase: TerminalDictationPhase
    /// Bumped once per delivered transcript so the button flashes a success check.
    var successPulse: Int
    /// The keyboard self-sizes; it reports its height back here so the host can
    /// give the representable the right frame.
    @Binding var preferredHeight: CGFloat

    /// Terminal quick-tray (the collapsed, swipe-down layout): ESC / TAB / mic /
    /// ^C / RET. The hosted keyboard injects the dictate button between slots 2
    /// and 3, so the mic lands dead-center. The full QWERTY (swipe up) carries
    /// its own mic key too. ESC/TAB/RET route through real `KeyboardAction`s;
    /// `^C` inserts the raw interrupt byte.
    private static let minimalSlots: [Int: SlotConfig] = [
        1: .action("ESC", icon: "escape"),
        2: .action("TAB", icon: "arrow.right.to.line"),
        3: .text("^C", inserts: "\u{03}"),
        4: .action("ENTER", icon: "return"),
    ]

    func makeCoordinator() -> Coordinator { Coordinator(send: send, onDictate: onDictate) }

    func makeUIView(context: Context) -> HudHostedKeyboard {
        let keyboard = HudHostedKeyboard()
        keyboard.inputHost = context.coordinator
        keyboard.customMinimalSlotConfigs = Self.minimalSlots
        keyboard.showsMinimalDictateButton = true
        keyboard.onDictationToggle = { [weak coordinator = context.coordinator] in
            coordinator?.onDictate()
        }
        keyboard.onLayoutHeightChange = { [weak keyboard] in
            guard let keyboard else { return }
            let height = keyboard.intrinsicContentSize.height
            DispatchQueue.main.async { preferredHeight = height }
        }
        context.coordinator.keyboard = keyboard
        context.coordinator.lastSuccessPulse = successPulse
        keyboard.setDictationState(dictationPhase.keyboardState)
        DispatchQueue.main.async { preferredHeight = keyboard.intrinsicContentSize.height }
        return keyboard
    }

    func updateUIView(_ uiView: HudHostedKeyboard, context: Context) {
        context.coordinator.send = send
        context.coordinator.onDictate = onDictate
        uiView.setDictationState(dictationPhase.keyboardState)
        if successPulse != context.coordinator.lastSuccessPulse {
            context.coordinator.lastSuccessPulse = successPulse
            uiView.showDictationSuccessFeedback()
        }
    }

    @MainActor
    final class Coordinator: KeyboardInputHost {
        var send: (Data) -> Void
        var onDictate: () -> Void
        weak var keyboard: HudHostedKeyboard?
        /// Last `successPulse` we flashed, so a re-render only flashes once per bump.
        var lastSuccessPulse = 0

        /// One-shot/locked modifier latches applied to the next inserted character.
        private var control: TerminalModifierState = .inactive
        private var shift: TerminalModifierState = .inactive

        init(send: @escaping (Data) -> Void, onDictate: @escaping () -> Void) {
            self.send = send
            self.onDictate = onDictate
        }

        private func write(_ s: String) { send(Data(s.utf8)) }

        func performKeyboardAction(_ action: KeyboardAction) {
            switch action {
            case .insert(let text):
                sendTranslated(text)
            case .deleteBackward:
                write("\u{7F}")
            case .tab:
                write("\t")
            case .escape:
                write("\u{1B}")
            case .enter:
                write("\r")
            case .interrupt:
                write("\u{03}")                 // Ctrl-C
            case .copy, .selectAll:
                break                            // origin only from explicit slots; no-op for a PTY
            case .paste:
                if let s = UIPasteboard.general.string, !s.isEmpty { sendTranslated(s) }
            case .toggleShift:
                shift = (shift == .armed ? .inactive : .armed)
            case .toggleControl:
                control = (control == .armed ? .inactive : .armed)
            case .dismissKeyboard:
                keyboard?.resignFirstResponder()
            case .moveCursor(let movement):
                switch movement {
                case .left:      write("\u{1B}[D")
                case .right:     write("\u{1B}[C")
                case .up:        write("\u{1B}[A")
                case .down:      write("\u{1B}[B")
                case .wordLeft:  write("\u{1B}b")
                case .wordRight: write("\u{1B}f")
                }
            }
        }

        private func sendTranslated(_ text: String) {
            guard let resolved = TerminalInputTranslator.resolvedInput(
                for: text, controlModifierState: control, shiftModifierState: shift
            ) else { return }
            write(resolved.payload)
            if resolved.consumedControl, control.consumesAfterUse { control = .inactive }
            if resolved.consumedShift, shift.consumesAfterUse { shift = .inactive }
        }
    }
}

// MARK: - Modifier state + input translation (ported from talkie)

/// A sticky/one-shot terminal modifier: `armed` applies to the next character
/// then clears; `locked` stays on until tapped off.
enum TerminalModifierState {
    case inactive, armed, locked
    var isActive: Bool { self != .inactive }
    var consumesAfterUse: Bool { self == .armed }
}

/// Resolves a typed string + control/shift latches into the bytes a terminal
/// expects — CTRL+letter → control code (Ctrl-A = 0x01 …), SHIFT → uppercase,
/// newlines normalized to CR. Pure logic, no I/O.
enum TerminalInputTranslator {
    static func normalize(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\r")
            .replacingOccurrences(of: "\n", with: "\r")
    }

    static func controlModifiedInput(for text: String) -> String? {
        guard text.count == 1, let scalar = text.unicodeScalars.first else { return nil }
        let value: UInt32?
        switch scalar {
        case "a"..."z": value = scalar.value - 96
        case "A"..."Z": value = scalar.value - 64
        case "@":  value = 0
        case "[":  value = 27
        case "\\": value = 28
        case "]":  value = 29
        case "^":  value = 30
        case "_":  value = 31
        case "?":  value = 127
        case " ":  value = 0
        default:   value = nil
        }
        guard let value, let controlScalar = UnicodeScalar(value) else { return nil }
        return String(controlScalar)
    }

    static func shiftModifiedInput(for text: String) -> String? {
        guard text.count == 1 else { return nil }
        return text.uppercased()
    }

    static func resolvedInput(
        for text: String,
        controlModifierState: TerminalModifierState,
        shiftModifierState: TerminalModifierState = .inactive
    ) -> (payload: String, consumedControl: Bool, consumedShift: Bool)? {
        let normalized = normalize(text)
        guard !normalized.isEmpty else { return nil }

        var payload = normalized
        var consumedControl = false
        var consumedShift = false

        if shiftModifierState.isActive, let shifted = shiftModifiedInput(for: payload) {
            payload = shifted
            consumedShift = true
        }
        if controlModifierState.isActive, let control = controlModifiedInput(for: payload) {
            payload = control
            consumedControl = true
        }
        return (payload, consumedControl, consumedShift)
    }
}
