import AppKit
import SwiftUI

struct ScoutTextEditor: NSViewRepresentable {
    @Binding var text: String
    @Binding var metrics: ScoutEditorMetrics

    let usesMonospacedFont: Bool
    let showsLineNumbers: Bool
    let accessibilityLabel: String
    let accessibilityHint: String

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, metrics: $metrics)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder
        scrollView.scrollerStyle = .overlay

        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer(
            containerSize: NSSize(
                width: 0,
                height: CGFloat.greatestFiniteMagnitude
            )
        )

        textStorage.addLayoutManager(layoutManager)
        layoutManager.addTextContainer(textContainer)
        textContainer.widthTracksTextView = true
        textContainer.heightTracksTextView = false

        let textView = ScoutTextView(frame: .zero, textContainer: textContainer)
        configure(textView)
        textView.string = text

        scrollView.documentView = textView

        let rulerView: ScoutLineNumberRulerView?
        if showsLineNumbers {
            let view = ScoutLineNumberRulerView(
                textView: textView,
                scrollView: scrollView
            )
            scrollView.verticalRulerView = view
            scrollView.hasVerticalRuler = true
            scrollView.rulersVisible = true
            rulerView = view
        } else {
            scrollView.hasVerticalRuler = false
            scrollView.rulersVisible = false
            rulerView = nil
        }

        context.coordinator.configure(
            textView: textView,
            rulerView: rulerView
        )
        context.coordinator.publishMetrics(from: textView)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? ScoutTextView else {
            return
        }

        configure(textView)
        scrollView.hasVerticalRuler = showsLineNumbers
        scrollView.rulersVisible = showsLineNumbers

        if textView.string != text {
            let selectedRange = textView.selectedRange()
            let safeLocation = min(selectedRange.location, (text as NSString).length)
            textView.string = text
            textView.setSelectedRange(NSRange(location: safeLocation, length: 0))
        }

        context.coordinator.publishMetrics(from: textView)
    }

    private func configure(_ textView: ScoutTextView) {
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.isEditable = true
        textView.isSelectable = true
        textView.isFieldEditor = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = true
        textView.isAutomaticDataDetectionEnabled = true
        textView.isAutomaticSpellingCorrectionEnabled = true
        textView.isIncrementalSearchingEnabled = true
        textView.usesFindBar = true
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = false
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.textContainer?.widthTracksTextView = true
        textView.allowsUndo = true
        textView.focusRingType = .default
        textView.setAccessibilityLabel(accessibilityLabel)
        textView.setAccessibilityHelp(accessibilityHint)
        textView.font = usesMonospacedFont
            ? .monospacedSystemFont(ofSize: 13, weight: .regular)
            : .systemFont(ofSize: 13)
        textView.textColor = .labelColor
        textView.insertionPointColor = .controlAccentColor
        textView.selectedTextAttributes = [
            .backgroundColor: NSColor.selectedContentBackgroundColor.withAlphaComponent(0.25),
        ]
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        private let text: Binding<String>
        private let metrics: Binding<ScoutEditorMetrics>
        private weak var rulerView: ScoutLineNumberRulerView?

        init(
            text: Binding<String>,
            metrics: Binding<ScoutEditorMetrics>
        ) {
            self.text = text
            self.metrics = metrics
        }

        func configure(
            textView: ScoutTextView,
            rulerView: ScoutLineNumberRulerView?
        ) {
            textView.delegate = self
            textView.onMetricsChange = { [weak self] metrics in
                self?.metrics.wrappedValue = metrics
                self?.rulerView?.refresh()
            }
            self.rulerView = rulerView
        }

        func publishMetrics(from textView: ScoutTextView) {
            metrics.wrappedValue = ScoutEditorMetrics.measuring(
                text: textView.string,
                selectedRange: textView.selectedRange()
            )
            rulerView?.refresh()
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? ScoutTextView else {
                return
            }

            text.wrappedValue = textView.string
            publishMetrics(from: textView)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? ScoutTextView else {
                return
            }

            publishMetrics(from: textView)
        }
    }
}
