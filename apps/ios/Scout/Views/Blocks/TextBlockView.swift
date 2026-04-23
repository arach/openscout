// TextBlockView — Renders a text block with markdown support.
//
// Streaming: text appears incrementally with a blinking cursor at the end.
// Completed: full markdown rendered, cursor hidden.

import SwiftUI

struct TextBlockView: View {
    let block: Block

    private var isStreaming: Bool {
        block.status == .streaming || block.status == .started
    }

    private var displayText: String {
        block.text ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if displayText.isEmpty && isStreaming {
                streamingPlaceholder
            } else {
                markdownContent
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Text block: \(displayText)")
    }

    // MARK: - Markdown Content

    @ViewBuilder
    private var markdownContent: some View {
        let parts = ScoutMarkdownParser.parse(displayText)
        let sections = ScoutMarkdownPresentation.sections(from: parts)

        ForEach(Array(sections.enumerated()), id: \.offset) { idx, section in
            switch section {
            case .markdown(let part):
                markdownPartView(part, isAfterPreviousSection: idx > 0)
            case .plan(let plan):
                planSurface(plan)
                    .padding(.top, idx > 0 ? ScoutSpacing.sm : 0)
            }
        }

        if isStreaming {
            StreamingCursor()
                .padding(.top, ScoutSpacing.xxs)
        }
    }

    @ViewBuilder
    private func markdownPartView(
        _ part: ScoutMarkdownParser.Part,
        isAfterPreviousSection: Bool
    ) -> some View {
        switch part {
        case .text(let str):
            paragraphs(str)
                .padding(.top, isAfterPreviousSection ? ScoutSpacing.xs : 0)
        case .codeBlock(let language, let code):
            codeBlockView(language: language, code: code)
        case .heading(let level, let text):
            headingView(level: level, text: text)
                .padding(.top, isAfterPreviousSection ? ScoutSpacing.md : 0)
        case .blockquote(let text):
            blockquoteView(text)
                .padding(.top, isAfterPreviousSection ? ScoutSpacing.xs : 0)
        case .list(let items):
            listView(items)
                .padding(.top, isAfterPreviousSection ? ScoutSpacing.xs : 0)
        case .table(let header, let rows):
            tableView(header: header, rows: rows)
        case .rule:
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 0.5)
                .padding(.vertical, ScoutSpacing.md)
        }
    }

    @ViewBuilder
    private func paragraphs(_ text: String, color: Color = ScoutColors.textPrimary) -> some View {
        let paras = text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            ForEach(Array(paras.enumerated()), id: \.offset) { _, para in
                inlineText(para, color: color)
            }
        }
    }

    private func inlineText(_ text: String, color: Color = ScoutColors.textPrimary) -> some View {
        Text(styledMarkdown(text))
            .font(ScoutTypography.body())
            .foregroundStyle(color)
            .textSelection(.enabled)
            .lineSpacing(3)
    }

    private func styledMarkdown(_ text: String) -> AttributedString {
        guard var attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) else {
            return AttributedString(text)
        }

        var codeRanges: [Range<AttributedString.Index>] = []
        for run in attributed.runs {
            if run.inlinePresentationIntent?.contains(.code) == true {
                codeRanges.append(run.range)
            }
        }
        for range in codeRanges {
            attributed[range].foregroundColor = ScoutColors.activityBlue
            attributed[range].font = .system(.body, design: .monospaced)
        }

        applyMentionLinks(&attributed)

        return attributed
    }

    private func applyMentionLinks(_ attributed: inout AttributedString) {
        var i = attributed.startIndex
        while i < attributed.endIndex {
            guard attributed.characters[i] == "@" else {
                i = attributed.characters.index(after: i)
                continue
            }
            var j = attributed.characters.index(after: i)
            while j < attributed.endIndex {
                let c = attributed.characters[j]
                guard c.isLetter || c.isNumber || c == "." || c == "-" || c == "_" else { break }
                j = attributed.characters.index(after: j)
            }
            // Must have at least one word char after @
            if j > attributed.characters.index(after: i) {
                let handle = String(attributed.characters[attributed.characters.index(after: i)..<j])
                if let url = URL(string: "scout://agent/\(handle)") {
                    attributed[i..<j].link = url
                    attributed[i..<j].foregroundColor = ScoutColors.activityBlue
                }
            }
            i = j
        }
    }

    private func headingView(level: Int, text: String) -> some View {
        Text(styledMarkdown(text))
            .font(headingFont(level))
            .foregroundStyle(ScoutColors.textPrimary)
            .textSelection(.enabled)
            .padding(.bottom, level <= 2 ? ScoutSpacing.xs : 0)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .system(size: 22, weight: .bold)
        case 2: .system(size: 18, weight: .semibold)
        case 3: .system(size: 16, weight: .semibold)
        default: .system(size: 15, weight: .medium)
        }
    }

    private func blockquoteView(_ text: String) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.lg) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(width: 2)

            paragraphs(text, color: ScoutColors.textSecondary)
        }
        .padding(.vertical, ScoutSpacing.sm)
    }

    private func listView(_ items: [ScoutMarkdownParser.ListItem]) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
                    listMarkerView(item)
                        .frame(width: markerWidth(for: item), alignment: .trailing)

                    inlineText(item.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, CGFloat(item.level) * ScoutSpacing.xl)
            }
        }
        .padding(.vertical, ScoutSpacing.xs)
    }

    private func planSurface(_ plan: ScoutPlanSurface) -> some View {
        let completed = plan.completedCount
        let total = plan.items.count
        let hasTaskStates = plan.items.contains { $0.taskState != nil }

        return VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(alignment: .center, spacing: ScoutSpacing.sm) {
                Image(systemName: "checklist")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(ScoutColors.activityBlue)
                    .frame(width: 18, height: 18)

                VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                    Text(plan.title.uppercased())
                        .font(ScoutTypography.caption(10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)

                    if let summary = plan.summary {
                        Text(summary)
                            .font(ScoutTypography.caption(12))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .lineLimit(2)
                    }
                }

                Spacer(minLength: ScoutSpacing.md)

                Text(hasTaskStates ? "\(completed)/\(total)" : "\(total) step\(total == 1 ? "" : "s")")
                    .font(ScoutTypography.caption(11, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .padding(.horizontal, ScoutSpacing.sm)
                    .padding(.vertical, ScoutSpacing.xxs)
                    .background(ScoutColors.surfaceAdaptive)
                    .clipShape(Capsule())
            }

            if hasTaskStates {
                planProgressBar(completed: completed, total: total)
            }

            VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                ForEach(Array(plan.items.enumerated()), id: \.offset) { index, item in
                    planStepRow(index: index, item: item)
                }
            }
        }
        .padding(ScoutSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutColors.surfaceRaisedAdaptive)
        .overlay {
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .stroke(ScoutColors.border, lineWidth: 0.5)
        }
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Plan, \(completed) of \(total) complete")
    }

    private func planProgressBar(completed: Int, total: Int) -> some View {
        GeometryReader { proxy in
            let ratio = total == 0 ? 0 : CGFloat(completed) / CGFloat(total)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(ScoutColors.surfaceAdaptive)

                Capsule()
                    .fill(ScoutColors.activityGreen)
                    .frame(width: max(4, proxy.size.width * ratio))
                    .opacity(ratio > 0 ? 1 : 0)
            }
        }
        .frame(height: 4)
    }

    private func planStepRow(index: Int, item: ScoutMarkdownParser.ListItem) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.sm) {
            planStepMarker(index: index, item: item)
                .padding(.top, 1)

            Text(styledMarkdown(item.text))
                .font(ScoutTypography.body(14))
                .foregroundStyle(item.taskState == .checked ? ScoutColors.textSecondary : ScoutColors.textPrimary)
                .strikethrough(item.taskState == .checked, color: ScoutColors.textMuted)
                .textSelection(.enabled)
                .lineSpacing(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, CGFloat(item.level) * ScoutSpacing.xl)
    }

    @ViewBuilder
    private func planStepMarker(index: Int, item: ScoutMarkdownParser.ListItem) -> some View {
        if let taskState = item.taskState {
            Image(systemName: taskState == .checked ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(taskState == .checked ? ScoutColors.activityGreen : ScoutColors.textMuted)
                .frame(width: 20, height: 20)
        } else {
            Text("\(index + 1)")
                .font(ScoutTypography.caption(10, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(width: 20, height: 20)
                .background(ScoutColors.surfaceAdaptive)
                .clipShape(Circle())
        }
    }

    @ViewBuilder
    private func listMarkerView(_ item: ScoutMarkdownParser.ListItem) -> some View {
        if let taskState = item.taskState {
            Image(systemName: taskState == .checked ? "checkmark.square.fill" : "square")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(taskState == .checked ? ScoutColors.activityGreen : ScoutColors.textMuted)
        } else {
            switch item.marker {
            case .unordered:
                Text("•")
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(ScoutColors.textSecondary)
            case .ordered(let ordinal):
                Text("\(ordinal).")
                    .font(ScoutTypography.caption(12, weight: .medium))
                    .foregroundStyle(ScoutColors.textSecondary)
            }
        }
    }

    private func markerWidth(for item: ScoutMarkdownParser.ListItem) -> CGFloat {
        if item.taskState != nil { return 16 }
        switch item.marker {
        case .unordered: return 12
        case .ordered(let ordinal):
            return ordinal >= 100 ? 30 : ordinal >= 10 ? 24 : 18
        }
    }

    private func tableView(header: [String], rows: [[String]]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                tableRow(header, isHeader: true)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    tableRow(row, isHeader: false)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                    .stroke(ScoutColors.divider, lineWidth: 0.5)
            }
        }
        .padding(.vertical, ScoutSpacing.sm)
    }

    private func tableRow(_ cells: [String], isHeader: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { idx, cell in
                Text(styledMarkdown(cell))
                    .font(isHeader ? ScoutTypography.body(13, weight: .semibold) : ScoutTypography.body(13))
                    .foregroundStyle(isHeader ? ScoutColors.textPrimary : ScoutColors.textSecondary)
                    .textSelection(.enabled)
                    .lineLimit(nil)
                    .frame(minWidth: 96, maxWidth: 180, alignment: .leading)
                    .padding(.horizontal, ScoutSpacing.md)
                    .padding(.vertical, ScoutSpacing.sm)
                    .background(isHeader ? ScoutColors.surfaceAdaptive : Color.clear)
                    .overlay(alignment: .trailing) {
                        if idx < cells.count - 1 {
                            Rectangle()
                                .fill(ScoutColors.divider)
                                .frame(width: 0.5)
                        }
                    }
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 0.5)
        }
    }

    private func codeBlockView(language: String?, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language, !language.isEmpty {
                Text(language.uppercased())
                    .font(ScoutTypography.code(9, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.md)
                    .padding(.bottom, ScoutSpacing.xs)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(SyntaxHighlighter.highlight(code))
                    .textSelection(.enabled)
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, language != nil ? ScoutSpacing.xs : ScoutSpacing.md)
                    .padding(.bottom, ScoutSpacing.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        .padding(.vertical, ScoutSpacing.sm)
    }

    // MARK: - Streaming Placeholder

    private var streamingPlaceholder: some View {
        HStack(spacing: ScoutSpacing.sm) {
            PulseIndicator()
            Text("Writing...")
                .font(ScoutTypography.caption())
                .foregroundStyle(ScoutColors.textMuted)
        }
    }
}

// MARK: - Lightweight Syntax Highlighter

private enum SyntaxHighlighter {
    static func highlight(_ code: String) -> AttributedString {
        var result = AttributedString(code)
        result.font = .system(.body, design: .monospaced)
        result.foregroundColor = ScoutColors.textPrimary

        let fullRange = NSRange(location: 0, length: (code as NSString).length)

        func apply(_ pattern: String, color: Color, options: NSRegularExpression.Options = []) {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
            for match in regex.matches(in: code, range: fullRange) {
                guard let stringRange = Range(match.range, in: code) else { continue }
                let lo = code.distance(from: code.startIndex, to: stringRange.lowerBound)
                let hi = code.distance(from: code.startIndex, to: stringRange.upperBound)
                let start = result.characters.index(result.startIndex, offsetBy: lo)
                let end = result.characters.index(result.startIndex, offsetBy: hi)
                result[start..<end].foregroundColor = color
            }
        }

        let keywords = #"\b(let|var|func|if|else|for|while|return|import|struct|class|enum|case|switch|guard|async|await|try|catch|throw|throws|const|def|fn|pub|use|self|Self|true|false|nil|null|undefined|void|type|interface|export|default|from|new|this|super|static|private|public|internal|protocol|extension|where|in|as|is)\b"#
        apply(keywords, color: ScoutColors.activityBlue)
        apply(#"\b\d+\.?\d*\b"#, color: ScoutColors.activityAmber)
        apply(#""[^"\\]*(?:\\.[^"\\]*)*""#, color: ScoutColors.activityGreen)
        apply(#"'[^'\\]*(?:\\.[^'\\]*)*'"#, color: ScoutColors.activityGreen)
        apply(#"//.*$"#, color: ScoutColors.textMuted, options: .anchorsMatchLines)

        return result
    }
}

// MARK: - Markdown Presentation

struct ScoutPlanSurface: Equatable {
    var title: String
    var summary: String?
    var items: [ScoutMarkdownParser.ListItem]

    var completedCount: Int {
        items.filter { $0.taskState == .checked }.count
    }
}

enum ScoutMarkdownSection: Equatable {
    case markdown(ScoutMarkdownParser.Part)
    case plan(ScoutPlanSurface)
}

enum ScoutMarkdownPresentation {
    static func sections(from parts: [ScoutMarkdownParser.Part]) -> [ScoutMarkdownSection] {
        var sections: [ScoutMarkdownSection] = []
        var index = 0

        while index < parts.count {
            if case .heading(_, let title) = parts[index],
               isPlanHeading(title),
               let extracted = extractPlan(
                   from: parts,
                   start: index + 1,
                   title: cleanInlineLabel(title),
                   summary: nil
               ) {
                sections.append(.plan(extracted.plan))
                index = extracted.nextIndex
                continue
            }

            if case .text(let text) = parts[index],
               isPlanIntro(text),
               let extracted = extractPlan(
                   from: parts,
                   start: index + 1,
                   title: titleForPlanIntro(text),
                   summary: summaryForPlanIntro(text)
               ) {
                sections.append(.plan(extracted.plan))
                index = extracted.nextIndex
                continue
            }

            sections.append(.markdown(parts[index]))
            index += 1
        }

        return sections
    }

    private static func extractPlan(
        from parts: [ScoutMarkdownParser.Part],
        start: Int,
        title: String,
        summary: String?
    ) -> (plan: ScoutPlanSurface, nextIndex: Int)? {
        var cursor = start
        var planSummary = summary

        if cursor + 1 < parts.count,
           case .text(let text) = parts[cursor],
           case .list = parts[cursor + 1],
           isPlanSummaryCandidate(text) {
            planSummary = cleanSummary(text)
            cursor += 1
        }

        guard cursor < parts.count,
              case .list(let firstItems) = parts[cursor],
              !firstItems.isEmpty
        else {
            return nil
        }

        var items = firstItems
        cursor += 1

        while cursor < parts.count {
            if case .list(let moreItems) = parts[cursor] {
                items.append(contentsOf: moreItems)
                cursor += 1
            } else {
                break
            }
        }

        return (
            ScoutPlanSurface(
                title: title.isEmpty ? "Plan" : title,
                summary: planSummary,
                items: items
            ),
            cursor
        )
    }

    private static func isPlanHeading(_ text: String) -> Bool {
        let plain = normalizedPlanText(text)
        if plain.contains("plan") {
            return true
        }

        return [
            "approach",
            "next steps",
            "steps",
            "checklist",
            "todo",
            "to do",
        ].contains(plain)
    }

    private static func isPlanIntro(_ text: String) -> Bool {
        let plain = normalizedPlanText(text)
        guard !plain.isEmpty, plain.count <= 160 else { return false }

        if ["plan", "the plan"].contains(plain) {
            return true
        }

        guard plain.hasSuffix(":") else { return false }
        return plain.contains("plan")
            || plain.contains("steps")
            || plain.contains("checklist")
            || plain.contains("todo")
    }

    private static func isPlanSummaryCandidate(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 220 && !trimmed.contains("\n\n")
    }

    private static func titleForPlanIntro(_ text: String) -> String {
        let plain = normalizedPlanText(text)
        if plain.contains("checklist") { return "Checklist" }
        if plain.contains("steps") { return "Next Steps" }
        return "Plan"
    }

    private static func summaryForPlanIntro(_ text: String) -> String? {
        let plain = normalizedPlanText(text).trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        if [
            "plan",
            "the plan",
            "here is the plan",
            "heres the plan",
            "here's the plan",
        ].contains(plain) {
            return nil
        }

        return cleanSummary(text)
    }

    private static func cleanSummary(_ text: String) -> String? {
        let cleaned = cleanInlineLabel(text)
            .trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    private static func cleanInlineLabel(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"[*_`#]+"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizedPlanText(_ text: String) -> String {
        cleanInlineLabel(text)
            .replacingOccurrences(of: #"[\s]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }
}

// MARK: - Markdown Parser

/// Small block parser for chat markdown. Clearly's renderer uses cmark-gfm plus
/// a post-processing pipeline; this keeps the same parse-then-render boundary
/// without adding a full HTML/WebView renderer to the iOS timeline.
enum ScoutMarkdownParser {
    enum Part: Equatable {
        case text(String)
        case codeBlock(language: String?, code: String)
        case heading(level: Int, text: String)
        case blockquote(String)
        case list([ListItem])
        case table(header: [String], rows: [[String]])
        case rule
    }

    struct ListItem: Equatable {
        var level: Int
        var marker: ListMarker
        var taskState: TaskState?
        var text: String
    }

    enum ListMarker: Equatable {
        case unordered
        case ordered(Int)
    }

    enum TaskState: Equatable {
        case checked
        case unchecked
    }

    private struct Fence {
        var marker: Character
        var length: Int
        var language: String?
    }

    private struct ParsedListItem {
        var level: Int
        var marker: ListMarker
        var taskState: TaskState?
        var text: String
    }

    static func parse(_ input: String) -> [Part] {
        var parts: [Part] = []
        var paragraphLines: [String] = []
        let normalized = input
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var index = 0

        func flushText() {
            let text = paragraphLines
                .joined(separator: "\n")
                .trimmingCharacters(in: .newlines)
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(.text(text))
            }
            paragraphLines.removeAll()
        }

        while index < lines.count {
            let line = lines[index]

            if let fence = parseFenceStart(line) {
                flushText()
                let consumed = consumeFence(lines: lines, start: index, fence: fence)
                parts.append(.codeBlock(language: fence.language, code: consumed.code))
                index = consumed.nextIndex
                continue
            }

            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                flushText()
                index += 1
                continue
            }

            if let heading = parseHeading(line) {
                flushText()
                parts.append(.heading(level: heading.0, text: heading.1))
                index += 1
                continue
            }

            if isRule(line) {
                flushText()
                parts.append(.rule)
                index += 1
                continue
            }

            if let table = parseTable(lines: lines, start: index) {
                flushText()
                parts.append(table.part)
                index = table.nextIndex
                continue
            }

            if parseBlockquoteLine(line) != nil {
                flushText()
                let quote = consumeBlockquote(lines: lines, start: index)
                parts.append(.blockquote(quote.text))
                index = quote.nextIndex
                continue
            }

            if parseListItem(line) != nil {
                flushText()
                let list = consumeList(lines: lines, start: index)
                parts.append(.list(list.items))
                index = list.nextIndex
                continue
            }

            paragraphLines.append(line)
            index += 1
        }

        flushText()
        return parts
    }

    private static func parseHeading(_ line: String) -> (Int, String)? {
        let leading = leadingWhitespace(in: line)
        guard leading.columns <= 3 else { return nil }

        let trimmed = line.dropFirst(leading.characters)
        var level = 0
        var index = trimmed.startIndex
        while index < trimmed.endIndex, trimmed[index] == "#" {
            level += 1
            index = trimmed.index(after: index)
        }

        guard level >= 1, level <= 6 else { return nil }
        if index < trimmed.endIndex {
            guard trimmed[index].isWhitespace else { return nil }
        }

        var rest = String(trimmed[index...]).trimmingCharacters(in: .whitespaces)
        if let closingRange = rest.range(of: #"\s+#+\s*$"#, options: .regularExpression) {
            rest.removeSubrange(closingRange)
            rest = rest.trimmingCharacters(in: .whitespaces)
        }
        guard !rest.isEmpty else { return nil }
        return (level, rest)
    }

    private static func isRule(_ line: String) -> Bool {
        let leading = leadingWhitespace(in: line)
        guard leading.columns <= 3 else { return false }

        let body = line.dropFirst(leading.characters)
        var marker: Character?
        var count = 0

        for char in body {
            if char.isWhitespace { continue }
            guard char == "-" || char == "*" || char == "_" else { return false }
            if let marker {
                guard marker == char else { return false }
            } else {
                marker = char
            }
            count += 1
        }

        return count >= 3
    }

    private static func parseFenceStart(_ line: String) -> Fence? {
        let leading = leadingWhitespace(in: line)
        guard leading.columns <= 3 else { return nil }

        let body = line.dropFirst(leading.characters)
        guard let marker = body.first, marker == "`" || marker == "~" else { return nil }

        var length = 0
        var index = body.startIndex
        while index < body.endIndex, body[index] == marker {
            length += 1
            index = body.index(after: index)
        }
        guard length >= 3 else { return nil }

        let info = String(body[index...]).trimmingCharacters(in: .whitespaces)
        if marker == "`", info.contains("`") { return nil }
        let language = info
            .split(whereSeparator: { $0.isWhitespace })
            .first
            .map(String.init)

        return Fence(marker: marker, length: length, language: language)
    }

    private static func consumeFence(
        lines: [String],
        start: Int,
        fence: Fence
    ) -> (code: String, nextIndex: Int) {
        var codeLines: [String] = []
        var index = start + 1

        while index < lines.count {
            if isFenceClose(lines[index], fence: fence) {
                return (codeLines.joined(separator: "\n"), index + 1)
            }
            codeLines.append(lines[index])
            index += 1
        }

        return (codeLines.joined(separator: "\n"), index)
    }

    private static func isFenceClose(_ line: String, fence: Fence) -> Bool {
        let leading = leadingWhitespace(in: line)
        guard leading.columns <= 3 else { return false }

        let body = line.dropFirst(leading.characters)
        var count = 0
        var index = body.startIndex
        while index < body.endIndex, body[index] == fence.marker {
            count += 1
            index = body.index(after: index)
        }

        guard count >= fence.length else { return false }
        return body[index...].allSatisfy(\.isWhitespace)
    }

    private static func consumeBlockquote(
        lines: [String],
        start: Int
    ) -> (text: String, nextIndex: Int) {
        var quoteLines: [String] = []
        var index = start

        while index < lines.count, let quoteLine = parseBlockquoteLine(lines[index]) {
            quoteLines.append(quoteLine)
            index += 1
        }

        return (
            quoteLines.joined(separator: "\n").trimmingCharacters(in: .newlines),
            index
        )
    }

    private static func parseBlockquoteLine(_ line: String) -> String? {
        let leading = leadingWhitespace(in: line)
        guard leading.columns <= 3 else { return nil }

        let body = line.dropFirst(leading.characters)
        guard body.first == ">" else { return nil }

        var index = body.index(after: body.startIndex)
        if index < body.endIndex, body[index] == " " {
            index = body.index(after: index)
        }

        return String(body[index...])
    }

    private static func consumeList(
        lines: [String],
        start: Int
    ) -> (items: [ListItem], nextIndex: Int) {
        var items: [ListItem] = []
        var index = start

        while index < lines.count {
            let line = lines[index]
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                break
            }

            if let parsed = parseListItem(line) {
                items.append(ListItem(
                    level: parsed.level,
                    marker: parsed.marker,
                    taskState: parsed.taskState,
                    text: parsed.text
                ))
                index += 1
                continue
            }

            guard let lastIndex = items.indices.last,
                  isListContinuation(line, item: items[lastIndex])
            else {
                break
            }

            let continuation = line.trimmingCharacters(in: .whitespaces)
            if !continuation.isEmpty {
                items[lastIndex].text += "\n" + continuation
            }
            index += 1
        }

        return (items, index)
    }

    private static func parseListItem(_ line: String) -> ParsedListItem? {
        let leading = leadingWhitespace(in: line)
        let body = line.dropFirst(leading.characters)
        guard let first = body.first else { return nil }

        if first == "-" || first == "*" || first == "+" {
            let markerEnd = body.index(after: body.startIndex)
            guard markerEnd < body.endIndex, body[markerEnd].isWhitespace else { return nil }
            let parsedText = parseTaskPrefix(String(body[markerEnd...]).trimmingCharacters(in: .whitespaces))
            return ParsedListItem(
                level: min(leading.columns / 2, 6),
                marker: .unordered,
                taskState: parsedText.taskState,
                text: parsedText.text
            )
        }

        guard first.isNumber else { return nil }

        var index = body.startIndex
        var digits = ""
        while index < body.endIndex, body[index].isNumber, digits.count < 9 {
            digits.append(body[index])
            index = body.index(after: index)
        }

        guard !digits.isEmpty,
              index < body.endIndex,
              body[index] == "." || body[index] == ")"
        else { return nil }

        let markerEnd = body.index(after: index)
        guard markerEnd < body.endIndex, body[markerEnd].isWhitespace else { return nil }

        let ordinal = Int(digits) ?? 1
        let parsedText = parseTaskPrefix(String(body[markerEnd...]).trimmingCharacters(in: .whitespaces))
        return ParsedListItem(
            level: min(leading.columns / 2, 6),
            marker: .ordered(ordinal),
            taskState: parsedText.taskState,
            text: parsedText.text
        )
    }

    private static func parseTaskPrefix(_ text: String) -> (taskState: TaskState?, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let prefix = trimmed.prefix(3).lowercased()

        if prefix == "[ ]" {
            return (.unchecked, String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces))
        }
        if prefix == "[x]" {
            return (.checked, String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces))
        }

        return (nil, text)
    }

    private static func isListContinuation(_ line: String, item: ListItem) -> Bool {
        let leading = leadingWhitespace(in: line)
        return leading.columns >= max(2, (item.level + 1) * 2)
    }

    private static func parseTable(
        lines: [String],
        start: Int
    ) -> (part: Part, nextIndex: Int)? {
        guard start + 1 < lines.count else { return nil }

        let header = parseTableCells(lines[start])
        guard header.count >= 2 else { return nil }

        let delimiter = parseTableCells(lines[start + 1])
        guard delimiter.count == header.count,
              delimiter.allSatisfy(isTableDelimiterCell)
        else { return nil }

        var rows: [[String]] = []
        var index = start + 2
        while index < lines.count {
            let line = lines[index]
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { break }

            let cells = parseTableCells(line)
            guard cells.count >= 2 else { break }

            rows.append(normalizeCells(cells, count: header.count))
            index += 1
        }

        return (
            .table(header: normalizeCells(header, count: header.count), rows: rows),
            index
        )
    }

    private static func parseTableCells(_ line: String) -> [String] {
        var body = line.trimmingCharacters(in: .whitespaces)
        guard body.contains("|") else { return [] }

        if body.hasPrefix("|") {
            body.removeFirst()
        }
        if body.hasSuffix("|") {
            body.removeLast()
        }

        return body
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespaces) }
    }

    private static func isTableDelimiterCell(_ cell: String) -> Bool {
        let trimmed = cell.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }

        var dashCount = 0
        for char in trimmed {
            if char == "-" {
                dashCount += 1
            } else if char == ":" || char.isWhitespace {
                continue
            } else {
                return false
            }
        }

        return dashCount >= 3
    }

    private static func normalizeCells(_ cells: [String], count: Int) -> [String] {
        if cells.count == count { return cells }
        if cells.count > count { return Array(cells.prefix(count)) }
        return cells + Array(repeating: "", count: count - cells.count)
    }

    private static func leadingWhitespace(in line: String) -> (characters: Int, columns: Int) {
        var characters = 0
        var columns = 0

        for char in line {
            if char == " " {
                characters += 1
                columns += 1
            } else if char == "\t" {
                characters += 1
                columns += 4
            } else {
                break
            }
        }

        return (characters, columns)
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        TextBlockView(block: Block(
            id: "1", turnId: "t1", type: .text, status: .completed, index: 0,
            text: "Here is some **bold** text and `inline code`.\n\n```swift\nlet x = 42\nprint(x)\n```\n\nAnd a follow-up paragraph."
        ))

        TextBlockView(block: Block(
            id: "2", turnId: "t1", type: .text, status: .streaming, index: 1,
            text: "Still writing this part..."
        ))
    }
    .padding()
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
