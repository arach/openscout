import ScoutSharedUI
import SwiftUI

struct CommsMessageMarkup: View {
    let text: String

    private var blocks: [MessageMarkupBlock] {
        MessageMarkupParser.parse(text)
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
                    MessageCodeBlock(language: language, text: block.text, style: .comms)
                case .table(let headers, let rows):
                    CommsMarkdownTable(headers: headers, rows: rows)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

private extension MessageCodeBlockStyle {
    static let comms = MessageCodeBlockStyle(
        labelFont: HUDType.mono(8, weight: .bold),
        codeFont: HUDType.mono(11),
        labelColor: HUDChrome.inkFaint,
        codeColor: HUDChrome.ink,
        backgroundColor: HUDChrome.canvas.opacity(0.72),
        borderColor: HUDChrome.borderSoft,
        cornerRadius: 6,
        borderWidth: 1,
        contentInsets: EdgeInsets(top: 9, leading: 10, bottom: 9, trailing: 10),
        blockSpacing: 7,
        labelTracking: 1.0,
        showsScrollIndicators: false
    )
}
