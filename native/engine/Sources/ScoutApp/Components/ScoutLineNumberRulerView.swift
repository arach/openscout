import AppKit

final class ScoutLineNumberRulerView: NSRulerView {
    private weak var textView: NSTextView?
    private let numberFont = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium)
    private let horizontalPadding: CGFloat = 8

    init(
        textView: NSTextView,
        scrollView: NSScrollView
    ) {
        self.textView = textView
        super.init(scrollView: scrollView, orientation: .verticalRuler)
        clientView = textView
        ruleThickness = 40
        refresh()
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func refresh() {
        let digits = String(max(1, lineStarts.count)).count
        ruleThickness = max(40, CGFloat(digits) * 8 + 20)
        needsDisplay = true
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        guard let textView,
              let layoutManager = textView.layoutManager,
              let textContainer = textView.textContainer else {
            return
        }

        NSColor.textBackgroundColor.withAlphaComponent(0.16).setFill()
        bounds.fill()

        let borderRect = NSRect(
            x: bounds.maxX - 1,
            y: bounds.minY,
            width: 1,
            height: bounds.height
        )
        NSColor.separatorColor.withAlphaComponent(0.45).setFill()
        borderRect.fill()

        let starts = lineStarts
        guard !starts.isEmpty else {
            return
        }

        let visibleRect = scrollView?.contentView.bounds ?? textView.visibleRect
        let visibleGlyphRange = layoutManager.glyphRange(
            forBoundingRect: visibleRect,
            in: textContainer
        )
        let visibleCharacterRange = layoutManager.characterRange(
            forGlyphRange: visibleGlyphRange,
            actualGlyphRange: nil
        )
        let startLine = lineIndex(for: visibleCharacterRange.location, in: starts)
        let endLine = lineIndex(for: NSMaxRange(visibleCharacterRange), in: starts)

        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .right

        let attributes: [NSAttributedString.Key: Any] = [
            .font: numberFont,
            .foregroundColor: NSColor.secondaryLabelColor,
            .paragraphStyle: paragraphStyle,
        ]

        for lineNumber in startLine...endLine {
            let originY = yOffset(
                for: starts[lineNumber],
                layoutManager: layoutManager,
                textContainer: textContainer,
                textView: textView
            )
            let drawRect = NSRect(
                x: horizontalPadding,
                y: originY + 1,
                width: ruleThickness - (horizontalPadding * 2),
                height: max(numberFont.pointSize + 4, 14)
            )

            NSString(string: "\(lineNumber + 1)")
                .draw(in: drawRect, withAttributes: attributes)
        }
    }

    private var lineStarts: [Int] {
        guard let textView else {
            return [0]
        }

        let nsText = textView.string as NSString
        guard nsText.length > 0 else {
            return [0]
        }

        var starts = [0]
        var index = 0

        while index < nsText.length {
            let lineRange = nsText.lineRange(for: NSRange(location: index, length: 0))
            index = NSMaxRange(lineRange)

            if index < nsText.length {
                starts.append(index)
                continue
            }

            let line = nsText.substring(with: lineRange)
            if line.hasSuffix("\n") || line.hasSuffix("\r") {
                starts.append(index)
            }
        }

        return starts
    }

    private func lineIndex(
        for location: Int,
        in starts: [Int]
    ) -> Int {
        let safeLocation = max(0, location)

        for index in starts.indices.reversed() where starts[index] <= safeLocation {
            return index
        }

        return 0
    }

    private func yOffset(
        for characterLocation: Int,
        layoutManager: NSLayoutManager,
        textContainer: NSTextContainer,
        textView: NSTextView
    ) -> CGFloat {
        let textLength = (textView.string as NSString).length
        let textOrigin = textView.textContainerOrigin

        if characterLocation >= textLength {
            return textOrigin.y + layoutManager.extraLineFragmentRect.minY
        }

        let glyphIndex = layoutManager.glyphIndexForCharacter(at: characterLocation)
        let lineRect = layoutManager.lineFragmentRect(
            forGlyphAt: glyphIndex,
            effectiveRange: nil,
            withoutAdditionalLayout: true
        )

        return textOrigin.y + lineRect.minY
    }
}
