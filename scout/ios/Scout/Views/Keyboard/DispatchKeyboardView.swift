// DispatchKeyboardView — SwiftUI wrapper around DispatchCompactKeyboard (UIKit).
//
// UIViewRepresentable bridge that exposes the same callback API
// while using the real UIKit keyboard underneath for proper touch
// handling, accent popups, hold-to-repeat delete, hit slop, and
// spring press animations.
//
// Includes swipe-to-collapse gesture from HostedTalkieKeyboardView
// and edge gesture exclusion zones (18pt from edges).

import SwiftUI

// MARK: - Keyboard State

enum KeyboardPage: Equatable {
    case letters
    case numbers
    case symbols
}

enum DictationState: Equatable {
    case idle
    case recording
    case processing
}

// MARK: - Toolbar Item (configurable action chip)

struct KeyboardToolbarItem: Identifiable {
    let id = UUID()
    let label: String
    let icon: String
    let action: (inout String) -> Void

    /// Whether this item acts as a section divider (rendered as a Divider)
    var isDivider: Bool { label == "---" }

    static func divider() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "---", icon: "", action: { _ in })
    }

    // MARK: - Clipboard

    static func paste() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Paste", icon: "doc.on.clipboard") { text in
            if let clip = UIPasteboard.general.string { text.append(clip) }
        }
    }

    static func copy() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Copy", icon: "doc.on.doc") { text in
            guard !text.isEmpty else { return }
            UIPasteboard.general.string = text
        }
    }

    static func cut() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Cut", icon: "scissors") { text in
            guard !text.isEmpty else { return }
            UIPasteboard.general.string = text
            text = ""
        }
    }

    // MARK: - Case

    static func uppercase() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "UPPER", icon: "textformat.size.larger") { text in
            text = text.uppercased()
        }
    }

    static func lowercase() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "lower", icon: "textformat.size.smaller") { text in
            text = text.lowercased()
        }
    }

    static func camelCase() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "camelCase", icon: "textformat") { text in
            let words = text.split(whereSeparator: { $0.isWhitespace || $0 == "_" || $0 == "-" })
            guard let first = words.first else { return }
            text = first.lowercased() + words.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }.joined()
        }
    }

    static func snakeCase() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "snake_case", icon: "textformat.abc.dottedunderline") { text in
            var result = ""
            for char in text {
                if char.isUppercase && !result.isEmpty && result.last != "_" {
                    result.append("_")
                }
                result.append(char)
            }
            text = result.split(whereSeparator: { $0.isWhitespace || $0 == "-" }).joined(separator: "_").lowercased()
        }
    }

    // MARK: - Wrapping

    static func wrapQuotes() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "\"Quotes\"", icon: "text.quote") { text in
            text = "\"\(text)\""
        }
    }

    static func wrapBacktick() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "`Code`", icon: "chevron.left.forwardslash.chevron.right") { text in
            text = "`\(text)`"
        }
    }

    static func wrapCodeBlock() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "```Block```", icon: "doc.plaintext") { text in
            text = "```\n\(text)\n```"
        }
    }

    static func wrapParens() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "(Parens)", icon: "parentheses") { text in
            text = "(\(text))"
        }
    }

    // MARK: - Edit

    static func trim() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Trim", icon: "line.3.horizontal.decrease") { text in
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    static func clear() -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Clear", icon: "xmark.circle") { text in
            text = ""
        }
    }

    // MARK: - Voice / Navigation (for optional injection)

    static func voice(action: @escaping () -> Void) -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Dictate", icon: "mic.fill") { _ in action() }
    }

    static func dismiss(action: @escaping () -> Void) -> KeyboardToolbarItem {
        KeyboardToolbarItem(label: "Hide", icon: "keyboard.chevron.compact.down") { _ in action() }
    }

    // MARK: - Default Set

    static func defaultItems() -> [KeyboardToolbarItem] {
        [
            .paste(), .copy(), .cut(),
            .divider(),
            .uppercase(), .lowercase(), .camelCase(), .snakeCase(),
            .divider(),
            .wrapQuotes(), .wrapBacktick(), .wrapCodeBlock(), .wrapParens(),
            .divider(),
            .trim(), .clear(),
        ]
    }
}

// MARK: - DispatchKeyboardView (SwiftUI API)

struct DispatchKeyboardView: View {
    @Binding var text: String
    var dictationState: DictationState = .idle
    var toolbarItems: [KeyboardToolbarItem] = KeyboardToolbarItem.defaultItems()

    let onInsert: (String) -> Void
    let onDelete: () -> Void
    let onReturn: () -> Void
    let onVoice: () -> Void
    var onDismiss: (() -> Void)?

    @State private var isMinimized = false
    @State private var pageLabel = "ABC"

    var body: some View {
        VStack(spacing: 0) {
            if isMinimized {
                minimizedBar
            } else {
                DispatchKeyboardRepresentable(
                    dictationState: dictationState,
                    onInsert: onInsert,
                    onDelete: onDelete,
                    onReturn: onReturn,
                    onVoice: onVoice,
                    onMinimize: { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { isMinimized = true } },
                    onPageChanged: { pageLabel = $0 },
                    onSwipeLeft: nil,
                    onSwipeRight: nil
                )
                .frame(height: DispatchCompactKeyboard.preferredHeight)
            }
        }
        .background {
            Color.clear
                .glassEffect(.regular, in: .rect(cornerRadius: 0))
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: isMinimized)
    }

    /// Voice-workflow toolbar — text manipulation utilities for dictation editing
    private var minimizedBar: some View {
        VStack(spacing: 0) {
            // Top row: fixed controls
            HStack(spacing: DispatchSpacing.sm) {
                // Expand keyboard
                ToolbarButton(icon: "keyboard", label: nil) {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        isMinimized = false
                    }
                }

                Divider()
                    .frame(height: 20)

                // Scrollable configurable utility chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(toolbarItems) { item in
                            if item.isDivider {
                                Divider().frame(height: 20)
                            } else {
                                ToolChip(label: item.label, icon: item.icon) {
                                    item.action(&text)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                }
            }
            .padding(.horizontal, DispatchSpacing.sm)
            .frame(height: 44)
        }
    }

}

// MARK: - UIViewRepresentable Bridge

private struct DispatchKeyboardRepresentable: UIViewRepresentable {
    let dictationState: DictationState
    let onInsert: (String) -> Void
    let onDelete: () -> Void
    let onReturn: () -> Void
    let onVoice: () -> Void
    let onMinimize: (() -> Void)?
    let onPageChanged: ((String) -> Void)?
    let onSwipeLeft: (() -> Void)?
    let onSwipeRight: (() -> Void)?

    func makeUIView(context: Context) -> DispatchKeyboardHostView {
        let host = DispatchKeyboardHostView()
        bindCallbacks(host)
        return host
    }

    func updateUIView(_ host: DispatchKeyboardHostView, context: Context) {
        bindCallbacks(host)
    }

    private func bindCallbacks(_ host: DispatchKeyboardHostView) {
        host.keyboard.onKeyTapped = { key in onInsert(key) }
        host.keyboard.onDeleteTapped = { onDelete() }
        host.keyboard.onReturnTapped = { onReturn() }
        host.keyboard.onSpaceTapped = { onInsert(" ") }
        host.keyboard.onVoiceTapped = { onVoice() }
        host.keyboard.onEmojiTapped = nil
        host.onSwipeDown = onMinimize
        host.onSwipeLeft = { host.keyboard.nextPage(); reportPage(host) }
        host.onSwipeRight = { host.keyboard.previousPage(); reportPage(host) }
    }

    private func reportPage(_ host: DispatchKeyboardHostView) {
        let label: String
        switch host.keyboard.currentPage {
        case .letters: label = "ABC"
        case .numbers: label = "123"
        case .symbols: label = "#+=  "
        }
        onPageChanged?(label)
    }
}

// MARK: - Host View (gesture handling from HostedTalkieKeyboardView)

/// Wraps DispatchCompactKeyboard with swipe gesture handling
/// and edge gesture exclusion zones.
final class DispatchKeyboardHostView: UIView, UIGestureRecognizerDelegate {
    let keyboard = DispatchCompactKeyboard()
    var onSwipeDown: (() -> Void)?
    var onSwipeLeft: (() -> Void)?
    var onSwipeRight: (() -> Void)?

    private let edgeExclusion: CGFloat = 18

    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        backgroundColor = .clear
        keyboard.translatesAutoresizingMaskIntoConstraints = false
        addSubview(keyboard)
        NSLayoutConstraint.activate([
            keyboard.topAnchor.constraint(equalTo: topAnchor),
            keyboard.leadingAnchor.constraint(equalTo: leadingAnchor),
            keyboard.trailingAnchor.constraint(equalTo: trailingAnchor),
            keyboard.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        // Pan gesture for swipe directions
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.cancelsTouchesInView = false
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        addGestureRecognizer(pan)
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        guard g.state == .ended else { return }
        let translation = g.translation(in: self)
        let velocity = g.velocity(in: self)
        let absX = abs(translation.x)
        let absY = abs(translation.y)

        // Determine primary direction
        if absY > absX {
            // Vertical swipe — down to minimize
            if translation.y > 30 || velocity.y > 480 {
                onSwipeDown?()
            }
        } else {
            // Horizontal swipe — change page
            if translation.x < -40 || velocity.x < -400 {
                onSwipeLeft?()
            } else if translation.x > 40 || velocity.x > 400 {
                onSwipeRight?()
            }
        }
    }

    // MARK: - Gesture Delegate

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        false
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        let point = touch.location(in: self)
        return point.x > edgeExclusion && point.x < bounds.width - edgeExclusion
    }
}

// MARK: - Toolbar Button (icon only, fixed size)

private struct ToolbarButton: View {
    let icon: String
    let label: String?
    var tint: Color = DispatchColors.textSecondary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Tool Chip (scrollable utility action)

private struct ToolChip: View {
    let label: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        }) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                Text(label)
                    .font(DispatchTypography.caption(12, weight: .medium))
            }
            .foregroundStyle(DispatchColors.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.white.opacity(0.06))
                    .glassEffect(.regular.interactive())
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Previews

#Preview("Keyboard") {
    @Previewable @State var text = "Hello world"
    VStack {
        Spacer()
        DispatchKeyboardView(
            text: $text,
            onInsert: { text.append($0) },
            onDelete: { if !text.isEmpty { text.removeLast() } },
            onReturn: { print("Return") },
            onVoice: { print("Voice") }
        )
    }
    .background(DispatchColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
