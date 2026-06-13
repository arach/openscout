import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Renders a conversation text block's raw markdown as native, styled SwiftUI —
/// not a wall of literal `**`, `#`, and ``` ` ```. It splits the text into
/// semantic blocks via the shared `MessageMarkupParser` (same parse as macOS),
/// then renders each kind with Hudson atoms: paragraphs/headings/lists carry
/// inline emphasis through `AttributedString(markdown:)`, and fenced code gets
/// real per-line syntax highlighting via `HudCodeHighlighter`.
struct MessageMarkupView: View {
    let text: String

    var body: some View {
        let blocks = MessageMarkupParser.parse(text)
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ForEach(blocks) { block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MessageMarkupBlock) -> some View {
        switch block.kind {
        case .paragraph:
            paragraph(block.text)
        case .heading(let depth):
            heading(block.text, depth: depth)
        case .rule:
            Rectangle()
                .fill(HudHairline.standard)
                .frame(height: HudStrokeWidth.standard)
                .padding(.vertical, HudSpacing.xs)
        case .list(let ordered, let items):
            list(items, ordered: ordered)
        case .blockquote:
            blockquote(block.text)
        case .code(let language):
            codeBlock(block.text, language: language)
        case .table(let headers, let rows):
            table(headers: headers, rows: rows)
        }
    }

    // MARK: - Inline

    /// Parse inline emphasis (bold/italic/`code`/links) but keep block splitting
    /// to the parser. Falls back to the raw string if markdown can't parse.
    private func inline(_ string: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        return (try? AttributedString(markdown: string, options: options)) ?? AttributedString(string)
    }

    private func paragraph(_ text: String) -> some View {
        Text(inline(text.isEmpty ? "…" : text))
            .font(HudFont.ui(HudTextSize.md))
            .foregroundStyle(HudPalette.ink)
            .tint(HudPalette.accent)
            .lineSpacing(3)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heading(_ text: String, depth: Int) -> some View {
        let size: CGFloat = depth <= 1 ? HudTextSize.lg : (depth == 2 ? HudTextSize.md : HudTextSize.base)
        let weight: Font.Weight = depth <= 1 ? .bold : .semibold
        return Text(inline(text))
            .font(HudFont.ui(size, weight: weight))
            .foregroundStyle(HudPalette.ink)
            .tint(HudPalette.accent)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, HudSpacing.xs)
    }

    private func list(_ items: [String], ordered: Bool) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(ordered ? "\(idx + 1)." : "•")
                        .font(HudFont.mono(HudTextSize.sm, weight: ordered ? .regular : .bold))
                        .foregroundStyle(ScoutInk.muted)
                        .frame(minWidth: ordered ? 20 : 12, alignment: .leading)
                    Text(inline(item))
                        .font(HudFont.ui(HudTextSize.md))
                        .foregroundStyle(HudPalette.ink)
                        .tint(HudPalette.accent)
                        .lineSpacing(2)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func blockquote(_ text: String) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            Rectangle()
                .fill(HudPalette.accent.opacity(0.6))
                .frame(width: 2)
            Text(inline(text))
                .font(HudFont.ui(HudTextSize.md))
                .foregroundStyle(ScoutInk.muted)
                .lineSpacing(3)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func codeBlock(_ code: String, language: String?) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            if let language, !language.isEmpty {
                Text(language.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(ScoutInk.muted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(code.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                        Text(HudCodeHighlighter.highlight(line, language: language))
                            .font(HudFont.mono(HudTextSize.sm))
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(HudSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(HudSurface.raised)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard)
        )
    }

    private func table(headers: [String], rows: [[String]]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            tableRow(headers, isHeader: true)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Rectangle()
                    .fill(HudHairline.standard)
                    .frame(height: HudStrokeWidth.standard)
                tableRow(row, isHeader: false)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(HudSurface.raised)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard)
        )
    }

    private func tableRow(_ cells: [String], isHeader: Bool) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                Text(inline(cell))
                    .font(HudFont.ui(HudTextSize.sm, weight: isHeader ? .semibold : .regular))
                    .foregroundStyle(isHeader ? HudPalette.ink : ScoutInk.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
    }
}
