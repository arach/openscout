import SwiftUI

struct CommsMessageMarkup: View {
    let text: String

    private var blocks: [CommsMessageMarkupBlock] {
        CommsMessageMarkupParser.parse(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(blocks) { block in
                switch block.kind {
                case .paragraph:
                    CommsMarkdownText(block.text)
                case .heading(let depth):
                    CommsMarkdownText(
                        block.text,
                        font: HUDType.body(depth <= 2 ? 15 : 14, weight: .semibold),
                        color: HUDChrome.ink
                    )
                    .padding(.top, depth <= 2 ? 2 : 0)
                case .rule:
                    HUDHairline()
                        .padding(.vertical, 3)
                case .list(let ordered, let items):
                    CommsMarkdownList(ordered: ordered, items: items)
                case .blockquote:
                    CommsMarkdownQuote(text: block.text)
                case .code(let language):
                    CommsCodeBlock(language: language, text: block.text)
                case .table(let headers, let rows):
                    CommsMarkdownTable(headers: headers, rows: rows)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct CommsMessageMarkupBlock: Identifiable {
    enum Kind {
        case paragraph
        case heading(depth: Int)
        case rule
        case list(ordered: Bool, items: [String])
        case blockquote
        case code(language: String?)
        case table(headers: [String], rows: [[String]])
    }

    let id: Int
    let kind: Kind
    let text: String
}

enum CommsMessageMarkupParser {
    static func parse(_ rawText: String) -> [CommsMessageMarkupBlock] {
        let normalized = normalize(rawText)
        guard !normalized.isEmpty else { return [] }

        let lines = normalized
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")

        var blocks: [CommsMessageMarkupBlock] = []
        var index = 0
        var nextID = 0

        func append(_ kind: CommsMessageMarkupBlock.Kind, text: String = "") {
            blocks.append(CommsMessageMarkupBlock(id: nextID, kind: kind, text: text))
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
            blocks.append(CommsMessageMarkupBlock(id: 0, kind: .paragraph, text: rawText))
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

private struct CommsMarkdownText: View {
    let text: String
    var font: Font = HUDType.body(13)
    var color: Color = HUDChrome.ink

    init(_ text: String, font: Font = HUDType.body(13), color: Color = HUDChrome.ink) {
        self.text = text
        self.font = font
        self.color = color
    }

    var body: some View {
        Text(markdown(text))
            .font(font)
            .foregroundStyle(color)
            .lineSpacing(2)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        if let attributed = try? AttributedString(markdown: text, options: options) {
            return attributed
        }
        return AttributedString(text)
    }
}

private struct CommsMarkdownList: View {
    let ordered: Bool
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ordered ? "\(index + 1)." : "-")
                        .font(HUDType.mono(11, weight: .bold))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .frame(width: ordered ? 22 : 12, alignment: .trailing)
                    CommsMarkdownText(item)
                }
            }
        }
    }
}

private struct CommsMarkdownQuote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(HUDChrome.accentSoft)
                .frame(width: 3)
            CommsMarkdownText(text, color: HUDChrome.inkMuted)
        }
        .padding(.vertical, 2)
    }
}

private struct CommsCodeBlock: View {
    let language: String?
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let language, !language.isEmpty {
                Text(language.uppercased())
                    .font(HUDType.mono(8, weight: .bold))
                    .tracking(1.0)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            ScrollView(.horizontal) {
                Text(text)
                    .font(HUDType.mono(11))
                    .foregroundStyle(HUDChrome.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(HUDChrome.canvas.opacity(0.72))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(HUDChrome.borderSoft, lineWidth: 1)
        )
    }
}

private struct CommsMarkdownTable: View {
    let headers: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                tableRow(headers, isHeader: true)
                HUDHairline()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    tableRow(row, isHeader: false)
                }
            }
            .background(HUDChrome.canvas.opacity(0.55))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(HUDChrome.borderSoft, lineWidth: 1)
            )
        }
        .scrollIndicators(.hidden)
    }

    private func tableRow(_ cells: [String], isHeader: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<max(headers.count, cells.count), id: \.self) { index in
                CommsMarkdownText(
                    cells.indices.contains(index) ? cells[index] : "",
                    font: isHeader ? HUDType.mono(10, weight: .bold) : HUDType.body(12),
                    color: isHeader ? HUDChrome.inkMuted : HUDChrome.ink
                )
                .frame(width: 136, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 7)
            }
        }
        .background(isHeader ? HUDChrome.canvasAlt : Color.clear)
    }
}
