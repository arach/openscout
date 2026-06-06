// MessageMarkup — shared, transport/UI-free markdown structure parser.
//
// Conversation text blocks arrive as raw markdown (paragraphs, headings, lists,
// fenced code, blockquotes, rules, tables). This splits that raw string into an
// ordered list of semantic blocks so each platform can render them natively —
// inline emphasis stays in the block `text` for the renderer to interpret.
//
// Pure Foundation, no @MainActor, no UI: this is the single source of truth both
// iOS (ScoutNext) and macOS render from, so markup parses identically everywhere.

import Foundation

public struct MessageMarkupBlock: Identifiable, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case paragraph
        case heading(depth: Int)
        case rule
        case list(ordered: Bool, items: [String])
        case blockquote
        case code(language: String?)
        case table(headers: [String], rows: [[String]])
    }

    public let id: Int
    public let kind: Kind
    public let text: String

    public init(id: Int, kind: Kind, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }
}

public enum MessageMarkupParser {
    public static func parse(_ rawText: String) -> [MessageMarkupBlock] {
        let normalized = normalize(rawText)
        guard !normalized.isEmpty else { return [] }

        let lines = normalized
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")

        var blocks: [MessageMarkupBlock] = []
        var index = 0
        var nextID = 0

        func append(_ kind: MessageMarkupBlock.Kind, text: String = "") {
            blocks.append(MessageMarkupBlock(id: nextID, kind: kind, text: text))
            nextID += 1
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
                continue
            }

            if let language = fenceLanguage(trimmed) {
                var codeLines: [String] = []
                index += 1
                while index < lines.count && fenceLanguage(lines[index].trimmingCharacters(in: .whitespaces)) == nil {
                    codeLines.append(lines[index])
                    index += 1
                }
                if index < lines.count { index += 1 }
                append(.code(language: language), text: codeLines.joined(separator: "\n"))
                continue
            }

            if isRule(trimmed) {
                append(.rule)
                index += 1
                continue
            }

            if let heading = heading(trimmed) {
                append(.heading(depth: heading.depth), text: heading.text)
                index += 1
                continue
            }

            if isTableStart(lines, index) {
                let headers = splitTableRow(lines[index])
                index += 2
                var rows: [[String]] = []
                while index < lines.count,
                      lines[index].contains("|"),
                      !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(splitTableRow(lines[index]))
                    index += 1
                }
                append(.table(headers: headers, rows: rows))
                continue
            }

            if let unordered = unorderedListItem(line) {
                var items = [unordered]
                index += 1
                while index < lines.count, let item = unorderedListItem(lines[index]) {
                    items.append(item)
                    index += 1
                }
                append(.list(ordered: false, items: items))
                continue
            }

            if let ordered = orderedListItem(line) {
                var items = [ordered]
                index += 1
                while index < lines.count, let item = orderedListItem(lines[index]) {
                    items.append(item)
                    index += 1
                }
                append(.list(ordered: true, items: items))
                continue
            }

            if trimmed.hasPrefix(">") {
                var quoteLines: [String] = []
                while index < lines.count {
                    let quoteLine = lines[index].trimmingCharacters(in: .whitespaces)
                    guard quoteLine.hasPrefix(">") else { break }
                    quoteLines.append(String(quoteLine.dropFirst()).trimmingCharacters(in: .whitespaces))
                    index += 1
                }
                append(.blockquote, text: quoteLines.joined(separator: "\n"))
                continue
            }

            var paragraphLines: [String] = []
            while index < lines.count && !isBlockStart(lines, index) {
                paragraphLines.append(lines[index].trimmingCharacters(in: .whitespaces))
                index += 1
            }
            append(.paragraph, text: paragraphLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
        }

        if blocks.isEmpty {
            blocks.append(MessageMarkupBlock(id: 0, kind: .paragraph, text: rawText))
        }
        return blocks
    }

    private static func normalize(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func fenceLanguage(_ trimmed: String) -> String? {
        guard trimmed.hasPrefix("```") else { return nil }
        let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
        guard language.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        return language.isEmpty ? "" : language
    }

    private static func heading(_ trimmed: String) -> (depth: Int, text: String)? {
        let depth = trimmed.prefix { $0 == "#" }.count
        guard (1...6).contains(depth) else { return nil }
        let rest = trimmed.dropFirst(depth)
        guard rest.first == " " else { return nil }
        return (depth, String(rest.dropFirst()).trimmingCharacters(in: .whitespaces))
    }

    private static func isRule(_ trimmed: String) -> Bool {
        guard trimmed.count >= 3 else { return false }
        let allowed = Set(trimmed)
        return allowed == ["-"] || allowed == ["*"] || allowed == ["_"]
    }

    private static func unorderedListItem(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") else { return nil }
        return String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
    }

    private static func orderedListItem(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let digits = trimmed.prefix { $0.isNumber }
        guard !digits.isEmpty else { return nil }
        let rest = trimmed.dropFirst(digits.count)
        guard rest.count >= 2,
              let marker = rest.first,
              marker == "." || marker == ")",
              rest.dropFirst().first == " "
        else { return nil }
        return String(rest.dropFirst(2)).trimmingCharacters(in: .whitespaces)
    }

    private static func splitTableRow(_ line: String) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespaces) }
    }

    private static func isTableSeparator(_ line: String) -> Bool {
        let cells = splitTableRow(line)
        guard cells.count >= 2 else { return false }
        return cells.allSatisfy { cell in
            let core = cell.trimmingCharacters(in: CharacterSet(charactersIn: " :-"))
            return core.isEmpty && cell.contains("-")
        }
    }

    private static func isTableStart(_ lines: [String], _ index: Int) -> Bool {
        guard index + 1 < lines.count else { return false }
        return lines[index].contains("|") && isTableSeparator(lines[index + 1])
    }

    private static func isBlockStart(_ lines: [String], _ index: Int) -> Bool {
        guard index < lines.count else { return true }
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty
            || fenceLanguage(trimmed) != nil
            || heading(trimmed) != nil
            || isRule(trimmed)
            || unorderedListItem(line) != nil
            || orderedListItem(line) != nil
            || trimmed.hasPrefix(">")
            || isTableStart(lines, index)
    }
}
