import Foundation

struct ScoutEditorMetrics: Equatable {
    let lineCount: Int
    let wordCount: Int
    let characterCount: Int
    let cursorLine: Int
    let cursorColumn: Int
    let selectedCharacterCount: Int

    static let empty = measuring(
        text: "",
        selectedRange: NSRange(location: 0, length: 0)
    )

    static func measuring(text: String, selectedRange: NSRange) -> ScoutEditorMetrics {
        let nsText = text as NSString
        let safeLocation = max(0, min(selectedRange.location, nsText.length))
        let safeLength = max(0, min(selectedRange.length, nsText.length - safeLocation))
        let safeRange = NSRange(location: safeLocation, length: safeLength)

        let lineCount = max(1, text.components(separatedBy: .newlines).count)
        let wordCount = text.split(whereSeparator: \.isWhitespace).count
        let characterCount = text.count

        let prefix = nsText.substring(to: safeLocation)
        let cursorLines = prefix.components(separatedBy: .newlines)
        let cursorLine = max(1, cursorLines.count)
        let cursorColumn = (cursorLines.last?.count ?? 0) + 1

        let selectedCharacterCount = Range(safeRange, in: text)
            .map { text[$0].count }
            ?? 0

        return ScoutEditorMetrics(
            lineCount: lineCount,
            wordCount: wordCount,
            characterCount: characterCount,
            cursorLine: cursorLine,
            cursorColumn: cursorColumn,
            selectedCharacterCount: selectedCharacterCount
        )
    }
}
