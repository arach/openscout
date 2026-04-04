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
        let parts = MarkdownParser.parse(displayText)

        ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
            switch part {
            case .text(let str):
                inlineText(str)
            case .codeBlock(let language, let code):
                codeBlockView(language: language, code: code)
            }
        }

        if isStreaming {
            StreamingCursor()
                .padding(.top, DispatchSpacing.xxs)
        }
    }

    @ViewBuilder
    private func inlineText(_ text: String) -> some View {
        if let attributed = try? AttributedString(markdown: text,
                                                   options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            Text(attributed)
                .font(DispatchTypography.body())
                .foregroundStyle(DispatchColors.textPrimary)
                .textSelection(.enabled)
                .lineSpacing(3)
        } else {
            Text(text)
                .font(DispatchTypography.body())
                .foregroundStyle(DispatchColors.textPrimary)
                .textSelection(.enabled)
                .lineSpacing(3)
        }
    }

    private func codeBlockView(language: String?, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(DispatchTypography.codeCaption)
                    .foregroundStyle(DispatchColors.textMuted)
                    .padding(.horizontal, DispatchSpacing.md)
                    .padding(.top, DispatchSpacing.sm)
                    .padding(.bottom, DispatchSpacing.xs)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(DispatchTypography.codeBody)
                    .foregroundStyle(DispatchColors.textPrimary)
                    .textSelection(.enabled)
                    .padding(.horizontal, DispatchSpacing.md)
                    .padding(.vertical, DispatchSpacing.sm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DispatchColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous))
        .padding(.vertical, DispatchSpacing.xs)
    }

    // MARK: - Streaming Placeholder

    private var streamingPlaceholder: some View {
        HStack(spacing: DispatchSpacing.sm) {
            PulseIndicator()
            Text("Writing...")
                .font(DispatchTypography.caption())
                .foregroundStyle(DispatchColors.textMuted)
        }
    }
}

// MARK: - Simple Markdown Parser

/// Splits markdown text into inline text segments and fenced code blocks.
/// This is intentionally minimal -- we rely on AttributedString for inline
/// markdown (bold, italic, links, inline code) and only need to extract
/// fenced code blocks ourselves.
private enum MarkdownParser {
    enum Part {
        case text(String)
        case codeBlock(language: String?, code: String)
    }

    static func parse(_ input: String) -> [Part] {
        var parts: [Part] = []
        var current = ""
        let lines = input.components(separatedBy: "\n")
        var inCodeBlock = false
        var codeLang: String?
        var codeLines: [String] = []

        for line in lines {
            if !inCodeBlock, line.hasPrefix("```") {
                // Start of code block
                if !current.isEmpty {
                    parts.append(.text(current.trimmingCharacters(in: .newlines)))
                    current = ""
                }
                inCodeBlock = true
                let lang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                codeLang = lang.isEmpty ? nil : lang
                codeLines = []
            } else if inCodeBlock, line.hasPrefix("```") {
                // End of code block
                parts.append(.codeBlock(language: codeLang, code: codeLines.joined(separator: "\n")))
                inCodeBlock = false
                codeLang = nil
                codeLines = []
            } else if inCodeBlock {
                codeLines.append(line)
            } else {
                if !current.isEmpty { current += "\n" }
                current += line
            }
        }

        // Flush remaining content
        if inCodeBlock {
            // Unclosed code block (still streaming) -- render as code
            parts.append(.codeBlock(language: codeLang, code: codeLines.joined(separator: "\n")))
        } else if !current.isEmpty {
            parts.append(.text(current.trimmingCharacters(in: .newlines)))
        }

        return parts
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
