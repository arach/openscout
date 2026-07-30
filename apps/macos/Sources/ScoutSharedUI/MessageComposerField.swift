import AppKit
import SwiftUI

/// The editing contract shared by native Scout message composers. Presentation
/// shells remain surface-specific; focus, dictation preview, and key ownership
/// live here so a HUD shortcut can never quietly become a text-field bug.
public enum MessageComposerSubmitBehavior: Sendable {
    /// Return submits. Used by the HUD's intentionally compact one-line dock.
    case returnKey
    /// Command-Return or Control-Return submits; Return remains native editing.
    case commandReturn
}

public enum MessageComposerReturnAction: Equatable, Sendable {
    case submit
    case acceptSuggestion
    case nativeEditing
}

public enum MessageComposerKeyPolicy {
    /// Pure policy kept separate from SwiftUI so every composer can prove the
    /// same contract: only explicit completion/submission keys are claimed;
    /// printable input and native multiline editing are never intercepted.
    public static func returnAction(
        behavior: MessageComposerSubmitBehavior,
        commandPressed: Bool,
        controlPressed: Bool,
        shiftPressed: Bool,
        suggestionsVisible: Bool
    ) -> MessageComposerReturnAction {
        if commandPressed || controlPressed {
            return .submit
        }
        if suggestionsVisible && !shiftPressed {
            return .acceptSuggestion
        }
        switch behavior {
        case .returnKey:
            return .submit
        case .commandReturn:
            return .nativeEditing
        }
    }
}

public struct MessageComposerFieldStyle: @unchecked Sendable {
    let font: Font
    let textColor: Color
    let caretColor: Color
    let partialColor: Color
    let partialCaretColor: Color?
    let minimumLines: Int
    let maximumLines: Int
    let minimumHeight: CGFloat?

    public init(
        font: Font,
        textColor: Color,
        caretColor: Color,
        partialColor: Color,
        partialCaretColor: Color? = nil,
        minimumLines: Int = 1,
        maximumLines: Int = 5,
        minimumHeight: CGFloat? = nil
    ) {
        self.font = font
        self.textColor = textColor
        self.caretColor = caretColor
        self.partialColor = partialColor
        self.partialCaretColor = partialCaretColor
        self.minimumLines = minimumLines
        self.maximumLines = max(minimumLines, maximumLines)
        self.minimumHeight = minimumHeight
    }
}

public struct MessageComposerField: View {
    @Binding private var text: String
    @FocusState.Binding private var focused: Bool

    private let placeholder: String
    private let partialText: String
    private let dictationActive: Bool
    private let isEnabled: Bool
    private let suggestionsVisible: Bool
    private let submitBehavior: MessageComposerSubmitBehavior
    private let style: MessageComposerFieldStyle
    private let onSubmit: () -> Void
    private let onAcceptSuggestion: () -> Bool
    private let onMoveSuggestion: (Int) -> Bool
    private let onEscape: () -> Bool

    public init(
        text: Binding<String>,
        focused: FocusState<Bool>.Binding,
        placeholder: String,
        partialText: String = "",
        dictationActive: Bool = false,
        isEnabled: Bool = true,
        suggestionsVisible: Bool = false,
        submitBehavior: MessageComposerSubmitBehavior,
        style: MessageComposerFieldStyle,
        onSubmit: @escaping () -> Void,
        onAcceptSuggestion: @escaping () -> Bool = { false },
        onMoveSuggestion: @escaping (Int) -> Bool = { _ in false },
        onEscape: @escaping () -> Bool = { false }
    ) {
        _text = text
        _focused = focused
        self.placeholder = placeholder
        self.partialText = partialText
        self.dictationActive = dictationActive
        self.isEnabled = isEnabled
        self.suggestionsVisible = suggestionsVisible
        self.submitBehavior = submitBehavior
        self.style = style
        self.onSubmit = onSubmit
        self.onAcceptSuggestion = onAcceptSuggestion
        self.onMoveSuggestion = onMoveSuggestion
        self.onEscape = onEscape
    }

    private var showsPartial: Bool {
        text.isEmpty && dictationActive
    }

    public var body: some View {
        ZStack(alignment: .topLeading) {
            TextField(showsPartial ? "" : placeholder, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(style.font)
                .foregroundStyle(style.textColor)
                .tint(showsPartial ? Color.clear : style.caretColor)
                .lineLimit(style.minimumLines...style.maximumLines)
                .focused($focused)
                .disabled(!isEnabled)
                .onKeyPress(phases: .down, action: handleKeyPress)
                .onKeyPress(.upArrow) {
                    guard suggestionsVisible else { return .ignored }
                    return onMoveSuggestion(-1) ? .handled : .ignored
                }
                .onKeyPress(.downArrow) {
                    guard suggestionsVisible else { return .ignored }
                    return onMoveSuggestion(1) ? .handled : .ignored
                }
                .onKeyPress(.tab) {
                    guard suggestionsVisible else { return .ignored }
                    return onAcceptSuggestion() ? .handled : .ignored
                }
                .onKeyPress(.escape) {
                    onEscape() ? .handled : .ignored
                }

            if showsPartial {
                MessageComposerDictationPreview(
                    text: partialText,
                    font: style.font,
                    color: style.partialColor,
                    caretColor: style.partialCaretColor
                )
                .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, minHeight: style.minimumHeight, alignment: .topLeading)
    }

    private func handleKeyPress(_ press: KeyPress) -> KeyPress.Result {
        guard press.key == .return else { return .ignored }
        let action = MessageComposerKeyPolicy.returnAction(
            behavior: submitBehavior,
            commandPressed: press.modifiers.contains(.command),
            controlPressed: press.modifiers.contains(.control),
            shiftPressed: press.modifiers.contains(.shift),
            suggestionsVisible: suggestionsVisible
        )
        switch action {
        case .submit:
            onSubmit()
            return .handled
        case .acceptSuggestion:
            return onAcceptSuggestion() ? .handled : .ignored
        case .nativeEditing:
            return .ignored
        }
    }
}

private struct MessageComposerDictationPreview: View {
    let text: String
    let font: Font
    let color: Color
    let caretColor: Color?

    @State private var caretLit = false

    private var displayText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: 4) {
            if !displayText.isEmpty {
                Text(displayText)
                    .font(font)
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            if let caretColor {
                RoundedRectangle(cornerRadius: 0.5, style: .continuous)
                    .fill(caretColor.opacity(caretLit ? 0.95 : 0.25))
                    .frame(width: 1, height: 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            guard caretColor != nil else { return }
            withAnimation(.easeInOut(duration: 0.48).repeatForever(autoreverses: true)) {
                caretLit = true
            }
        }
    }
}

@MainActor
public enum MessageComposerTextSelection {
    /// SwiftUI installs the AppKit field editor asynchronously. Repeating the
    /// placement over two yields makes HUD engage/focus deterministic without
    /// stealing subsequent selection changes made by the operator.
    public static func moveCaretToEndSoon() {
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
