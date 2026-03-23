import AppKit

final class ScoutTextView: NSTextView {
    var onMetricsChange: ((ScoutEditorMetrics) -> Void)?

    private let indentUnit = "    "

    override var acceptsFirstResponder: Bool {
        true
    }

    override var canBecomeKeyView: Bool {
        true
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }

    override func didChangeText() {
        super.didChangeText()
        publishMetrics()
    }

    override func setSelectedRanges(
        _ ranges: [NSValue],
        affinity: NSSelectionAffinity,
        stillSelecting flag: Bool
    ) {
        super.setSelectedRanges(
            ranges,
            affinity: affinity,
            stillSelecting: flag
        )
        publishMetrics()
    }

    override func insertTab(_ sender: Any?) {
        let selection = selectedRange()
        guard selection.length > 0 else {
            insertText(indentUnit, replacementRange: selection)
            publishMetrics()
            return
        }

        transformSelectedLines { line in
            indentUnit + line
        }
    }

    override func insertBacktab(_ sender: Any?) {
        let selection = selectedRange()
        let nsText = string as NSString
        let lineRange = nsText.lineRange(for: selection)
        let line = nsText.substring(with: lineRange)
        let removedCount = removableIndentCount(in: line)

        guard removedCount > 0 else {
            return
        }

        if selection.length == 0 {
            let updatedLine = removingIndent(from: line)
            let cursorOffset = max(0, selection.location - lineRange.location)
            let newLocation = max(
                lineRange.location,
                selection.location - min(removedCount, cursorOffset)
            )

            replaceText(
                in: lineRange,
                with: updatedLine,
                selection: NSRange(location: newLocation, length: 0)
            )
            return
        }

        transformSelectedLines(removingIndent(from:))
    }

    override func insertNewline(_ sender: Any?) {
        let continuation = continuationPrefix()
        super.insertNewline(sender)

        guard !continuation.isEmpty else {
            publishMetrics()
            return
        }

        insertText(continuation, replacementRange: selectedRange())
        publishMetrics()
    }

    private func transformSelectedLines(_ transform: (String) -> String) {
        let nsText = string as NSString
        let selection = selectedRange()
        let lineRange = nsText.lineRange(for: selection)
        let block = nsText.substring(with: lineRange)
        let replacement = block
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { transform(String($0)) }
            .joined(separator: "\n")

        replaceText(
            in: lineRange,
            with: replacement,
            selection: NSRange(
                location: lineRange.location,
                length: (replacement as NSString).length
            )
        )
    }

    private func replaceText(
        in range: NSRange,
        with replacement: String,
        selection: NSRange
    ) {
        guard shouldChangeText(in: range, replacementString: replacement) else {
            return
        }

        textStorage?.replaceCharacters(in: range, with: replacement)
        didChangeText()
        setSelectedRange(selection)
    }

    private func continuationPrefix() -> String {
        let nsText = string as NSString
        let selection = selectedRange()

        guard selection.length == 0 else {
            return ""
        }

        let lineRange = nsText.lineRange(for: selection)
        let rawLine = nsText.substring(with: lineRange)
        let line = rawLine.trimmingCharacters(in: .newlines)
        let leadingWhitespace = String(line.prefix { $0 == " " || $0 == "\t" })
        let trimmed = String(line.dropFirst(leadingWhitespace.count))

        if let unorderedMarker = unorderedListMarker(in: trimmed) {
            return leadingWhitespace + unorderedMarker
        }

        if let orderedMarker = orderedListMarker(in: trimmed) {
            return leadingWhitespace + orderedMarker
        }

        return leadingWhitespace
    }

    private func unorderedListMarker(in line: String) -> String? {
        ["- ", "* ", "+ ", "• "].first(where: line.hasPrefix)
    }

    private func orderedListMarker(in line: String) -> String? {
        guard let range = line.range(
            of: #"^(\d+)\.\s"#,
            options: .regularExpression
        ) else {
            return nil
        }

        let prefix = String(line[range])
        guard let number = Int(prefix.split(separator: ".").first ?? "") else {
            return nil
        }

        return "\(number + 1). "
    }

    private func removingIndent(from line: String) -> String {
        if line.hasPrefix(indentUnit) {
            return String(line.dropFirst(indentUnit.count))
        }

        if line.hasPrefix("\t") {
            return String(line.dropFirst())
        }

        let removableCount = removableIndentCount(in: line)
        guard removableCount > 0 else {
            return line
        }

        return String(line.dropFirst(removableCount))
    }

    private func removableIndentCount(in line: String) -> Int {
        if line.hasPrefix(indentUnit) {
            return indentUnit.count
        }

        if line.hasPrefix("\t") {
            return 1
        }

        return min(
            indentUnit.count,
            line.prefix { $0 == " " }.count
        )
    }

    private func publishMetrics() {
        onMetricsChange?(
            ScoutEditorMetrics.measuring(
                text: string,
                selectedRange: selectedRange()
            )
        )
    }
}
