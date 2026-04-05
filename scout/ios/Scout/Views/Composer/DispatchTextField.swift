// DispatchTextField — Editable text view that suppresses the native keyboard.
//
// Uses UITextView with an empty inputView to prevent the system keyboard.
// Grows with content up to maxHeight, then scrolls.

import SwiftUI
import UIKit

struct DispatchTextField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String = ""
    var maxHeight: CGFloat = 70
    var useNativeKeyboard: Bool = false

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> AutoSizingTextView {
        let textView = AutoSizingTextView(maxHeight: maxHeight)
        textView.delegate = context.coordinator
        textView.font = UIFont.systemFont(ofSize: 15)
        textView.backgroundColor = .clear
        textView.textContainerInset = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.isScrollEnabled = false
        textView.textContainer.lineBreakMode = .byWordWrapping
        textView.setContentCompressionResistancePriority(.required, for: .vertical)
        textView.setContentHuggingPriority(.required, for: .vertical)

        if !useNativeKeyboard {
            textView.inputView = UIView()
            textView.inputAssistantItem.leadingBarButtonGroups = []
            textView.inputAssistantItem.trailingBarButtonGroups = []
        }

        // Placeholder
        let label = makePlaceholderLabel()
        textView.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: textView.leadingAnchor),
            label.topAnchor.constraint(equalTo: textView.topAnchor),
        ])
        context.coordinator.placeholderLabel = label

        updateColors(textView)
        return textView
    }

    func updateUIView(_ textView: AutoSizingTextView, context: Context) {
        if textView.text != text {
            textView.text = text
            textView.invalidateIntrinsicContentSize()
        }
        context.coordinator.placeholderLabel?.isHidden = !text.isEmpty
        updateColors(textView)
    }

    private func updateColors(_ textView: UITextView) {
        textView.textColor = UIColor(DispatchColors.textPrimary)
        textView.tintColor = UIColor(DispatchColors.accent)
    }

    private func makePlaceholderLabel() -> UILabel {
        let label = UILabel()
        label.text = placeholder
        label.font = UIFont.systemFont(ofSize: 15)
        label.textColor = UIColor(DispatchColors.textMuted)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = !text.isEmpty
        return label
    }

    class Coordinator: NSObject, UITextViewDelegate {
        let parent: DispatchTextField
        var placeholderLabel: UILabel?

        init(parent: DispatchTextField) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            placeholderLabel?.isHidden = !textView.text.isEmpty
            textView.invalidateIntrinsicContentSize()
        }
    }
}

// MARK: - Auto-sizing UITextView

/// UITextView that reports intrinsicContentSize based on text content,
/// capped at maxHeight. Switches to scrolling when content exceeds max.
class AutoSizingTextView: UITextView {
    private let maxAllowedHeight: CGFloat

    init(maxHeight: CGFloat) {
        self.maxAllowedHeight = maxHeight
        super.init(frame: .zero, textContainer: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        let fittingSize = sizeThatFits(CGSize(width: bounds.width > 0 ? bounds.width : UIScreen.main.bounds.width - 80, height: .greatestFiniteMagnitude))
        let clampedHeight = min(fittingSize.height, maxAllowedHeight)

        let shouldScroll = fittingSize.height > maxAllowedHeight
        if isScrollEnabled != shouldScroll {
            isScrollEnabled = shouldScroll
        }

        return CGSize(width: UIView.noIntrinsicMetric, height: clampedHeight)
    }
}
