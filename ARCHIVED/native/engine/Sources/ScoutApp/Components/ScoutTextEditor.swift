import AppKit
import SwiftUI

enum ScoutTextEditorBehavior {
    case document
    case composer
}

struct ScoutTextEditor: NSViewRepresentable {
    @Binding var text: String
    @Binding var metrics: ScoutEditorMetrics

    let usesMonospacedFont: Bool
    let showsLineNumbers: Bool
    let behavior: ScoutTextEditorBehavior
    let accessibilityLabel: String
    let accessibilityHint: String
    let onCommandEnter: (() -> Void)?

    init(
        text: Binding<String>,
        metrics: Binding<ScoutEditorMetrics>,
        usesMonospacedFont: Bool,
        showsLineNumbers: Bool,
        behavior: ScoutTextEditorBehavior = .document,
        accessibilityLabel: String,
        accessibilityHint: String,
        onCommandEnter: (() -> Void)?
    ) {
        _text = text
        _metrics = metrics
        self.usesMonospacedFont = usesMonospacedFont
        self.showsLineNumbers = showsLineNumbers
        self.behavior = behavior
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
        self.onCommandEnter = onCommandEnter
    }

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

        context.coordinator.syncTextView(textView, with: text)

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
        textView.isAutomaticTextReplacementEnabled = behavior == .document
        textView.isAutomaticDataDetectionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = behavior == .document
        textView.isIncrementalSearchingEnabled = behavior == .document
        textView.usesFindBar = behavior == .document
        textView.isContinuousSpellCheckingEnabled = behavior == .document
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
        textView.onCommandEnter = onCommandEnter
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
        private var lastPublishedText: String
        private var isSynchronizingText = false

        init(
            text: Binding<String>,
            metrics: Binding<ScoutEditorMetrics>
        ) {
            self.text = text
            self.metrics = metrics
            self.lastPublishedText = text.wrappedValue
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

        func syncTextView(_ textView: ScoutTextView, with externalText: String) {
            guard !isSynchronizingText else {
                return
            }

            if textView.string == externalText {
                lastPublishedText = externalText
                return
            }

            guard externalText != lastPublishedText else {
                return
            }

            guard !textView.hasMarkedText() else {
                return
            }

            let selectedRange = textView.selectedRange()
            let nsText = externalText as NSString
            let safeLocation = min(selectedRange.location, nsText.length)
            let safeLength = min(selectedRange.length, nsText.length - safeLocation)

            isSynchronizingText = true
            textView.string = externalText
            textView.setSelectedRange(NSRange(location: safeLocation, length: safeLength))
            lastPublishedText = externalText
            isSynchronizingText = false
        }

        func publishMetrics(from textView: ScoutTextView) {
            let measured = ScoutEditorMetrics.measuring(
                text: textView.string,
                selectedRange: textView.selectedRange()
            )
            if metrics.wrappedValue != measured {
                metrics.wrappedValue = measured
            }
            rulerView?.refresh()
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? ScoutTextView else {
                return
            }

            guard !isSynchronizingText else {
                return
            }

            lastPublishedText = textView.string
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
