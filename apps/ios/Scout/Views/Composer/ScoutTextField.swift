// ScoutTextField — Editable text view that suppresses the native keyboard.
//
// Uses UITextView with an empty inputView to prevent the system keyboard.
// Grows with content up to maxHeight, then scrolls.

import SwiftUI
import UIKit

struct ScoutTextField: UIViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    var placeholder: String = ""
    var minHeight: CGFloat = 32
    var maxHeight: CGFloat = 70
    var useNativeKeyboard: Bool = false

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> AutoSizingTextView {
        let textView = AutoSizingTextView(minHeight: minHeight, maxHeight: maxHeight)
        textView.delegate = context.coordinator
        textView.font = UIFont.systemFont(ofSize: 15)
        textView.backgroundColor = .clear
        textView.textContainerInset = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.isScrollEnabled = false
        textView.textContainer.lineBreakMode = .byWordWrapping
        textView.setContentCompressionResistancePriority(.required, for: .vertical)
        textView.setContentHuggingPriority(.required, for: .vertical)
        textView.onHeightChange = { height in
            context.coordinator.updateMeasuredHeight(height)
        }

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
        context.coordinator.parent = self
        textView.minAllowedHeight = minHeight
        textView.maxAllowedHeight = maxHeight
        if textView.text != text {
            textView.text = text
            textView.invalidateIntrinsicContentSize()
        }
        context.coordinator.placeholderLabel?.isHidden = !text.isEmpty
        updateColors(textView)
        textView.reportHeightIfNeeded()
    }

    private func updateColors(_ textView: UITextView) {
        textView.textColor = UIColor(ScoutColors.textPrimary)
        textView.tintColor = UIColor(ScoutColors.accent)
    }

    private func makePlaceholderLabel() -> UILabel {
        let label = UILabel()
        label.text = placeholder
        label.font = UIFont.systemFont(ofSize: 15)
        label.textColor = UIColor(ScoutColors.textMuted)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = !text.isEmpty
        return label
    }

    class Coordinator: NSObject, UITextViewDelegate {
        var parent: ScoutTextField
        var placeholderLabel: UILabel?

        init(parent: ScoutTextField) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            placeholderLabel?.isHidden = !textView.text.isEmpty
            textView.invalidateIntrinsicContentSize()
            if let autoSizingTextView = textView as? AutoSizingTextView {
                autoSizingTextView.reportHeightIfNeeded()
            }
        }

        func updateMeasuredHeight(_ height: CGFloat) {
            guard abs(parent.measuredHeight - height) > 0.5 else { return }
            DispatchQueue.main.async {
                self.parent.measuredHeight = height
            }
        }
    }
}

// MARK: - Auto-sizing UITextView

/// UITextView that reports intrinsicContentSize based on text content,
/// capped at maxHeight. Switches to scrolling when content exceeds max.
class AutoSizingTextView: UITextView {
    var minAllowedHeight: CGFloat
    var maxAllowedHeight: CGFloat
    var onHeightChange: ((CGFloat) -> Void)?
    private var lastReportedHeight: CGFloat = .zero

    init(minHeight: CGFloat, maxHeight: CGFloat) {
        self.minAllowedHeight = minHeight
        self.maxAllowedHeight = maxHeight
        super.init(frame: .zero, textContainer: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        let clampedHeight = measuredHeight()
        return CGSize(width: UIView.noIntrinsicMetric, height: clampedHeight)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        reportHeightIfNeeded()
    }

    func reportHeightIfNeeded() {
        let clampedHeight = measuredHeight()
        guard abs(lastReportedHeight - clampedHeight) > 0.5 else { return }
        lastReportedHeight = clampedHeight
        onHeightChange?(clampedHeight)
    }

    private func measuredHeight() -> CGFloat {
        let fallbackWidth = window?.windowScene?.screen.bounds.width ?? 375
        let fittingWidth = bounds.width > 0 ? bounds.width : fallbackWidth - 80
        let fittingSize = sizeThatFits(CGSize(width: fittingWidth, height: .greatestFiniteMagnitude))
        let clampedHeight = max(minAllowedHeight, min(fittingSize.height, maxAllowedHeight))

        let shouldScroll = fittingSize.height > maxAllowedHeight
        if isScrollEnabled != shouldScroll {
            isScrollEnabled = shouldScroll
        }

        return clampedHeight
    }
}
