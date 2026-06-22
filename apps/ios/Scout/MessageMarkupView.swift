import SwiftUI
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

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
        guard var attributed = try? AttributedString(markdown: string, options: options) else {
            return AttributedString(string)
        }
        // SwiftUI does not style inline `code` spans on its own — the markdown
        // parser only tags them with `.inlinePresentationIntent.code`. Give those
        // runs a monospaced face and a faint chip background so inline code,
        // identifiers, and paths read as code instead of plain prose. Foreground
        // is left to the surrounding context (ink in body, muted in quotes).
        let codeRanges = attributed.runs.compactMap { run -> Range<AttributedString.Index>? in
            guard let intent = run.inlinePresentationIntent, intent.contains(.code) else { return nil }
            return run.range
        }
        for range in codeRanges {
            attributed[range].font = HudFont.mono(HudTextSize.sm)
            attributed[range].backgroundColor = HudPalette.ink.opacity(0.08)
        }
        return attributed
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
                        // Render blank lines as a space so they keep their height
                        // instead of collapsing and compressing the block.
                        Text(HudCodeHighlighter.highlight(line.isEmpty ? " " : line, language: language))
                            .font(HudFont.mono(HudTextSize.sm))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false)
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

// MARK: - Attachments

struct ScoutComposerAttachment: Identifiable, Equatable {
    let id = UUID()
    let data: Data
    let mediaType: String
    let fileName: String

    var upload: AttachmentUpload {
        AttachmentUpload(data: data, mediaType: mediaType, fileName: fileName)
    }

    var isImage: Bool {
        mediaType.lowercased().hasPrefix("image/")
    }
}

struct ComposerAttachmentStrip: View {
    let attachments: [ScoutComposerAttachment]
    let onRemove: (UUID) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: HudSpacing.sm) {
                ForEach(attachments) { attachment in
                    ComposerAttachmentChip(attachment: attachment) {
                        onRemove(attachment.id)
                    }
                }
            }
            .padding(.horizontal, HudSpacing.xs)
        }
    }
}

private struct ComposerAttachmentChip: View {
    let attachment: ScoutComposerAttachment
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: HudSpacing.xxs) {
                AttachmentPreview(
                    mediaType: attachment.mediaType,
                    fileName: attachment.fileName,
                    data: attachment.data,
                    url: nil
                )
                .frame(width: 58, height: 58)
                Text(attachment.fileName)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .frame(width: 72)
            }

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: HudTextSize.md))
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .offset(x: 4, y: -4)
            .accessibilityLabel("Remove attachment")
        }
    }
}

struct MessageAttachmentList: View {
    let attachments: [MessageAttachment]

    var body: some View {
        if !attachments.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(attachments) { attachment in
                    MessageAttachmentCard(attachment: attachment)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct MessageAttachmentCard: View {
    let attachment: MessageAttachment
    var data: Data? = nil

    var body: some View {
        let mediaType = attachment.mediaType.lowercased()
        if mediaType.hasPrefix("image/") {
            imageCard
        } else {
            fileChip
        }
    }

    private var imageCard: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            AttachmentPreview(
                mediaType: attachment.mediaType,
                fileName: displayName,
                data: data,
                url: attachment.url.flatMap(URL.init(string:))
            )
            .frame(maxWidth: 220, minHeight: 120, maxHeight: 180)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            Text(displayName)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutInk.muted)
                .lineLimit(1)
        }
        .padding(HudSpacing.sm)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.raised.opacity(0.7)))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(HudHairline.subtle, lineWidth: HudStrokeWidth.standard)
        )
    }

    private var fileChip: some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: "doc")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(HudPalette.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Text(attachment.mediaType)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.sm)
            if attachment.url != nil {
                Image(systemName: "link")
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
            }
        }
        .padding(HudSpacing.md)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard)
        )
    }

    private var displayName: String {
        attachment.fileName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? attachment.url.flatMap { URL(string: $0)?.lastPathComponent.nilIfEmpty }
            ?? attachment.id
    }
}

private struct AttachmentPreview: View {
    let mediaType: String
    let fileName: String
    let data: Data?
    let url: URL?

    var body: some View {
        Group {
            if mediaType.lowercased().hasPrefix("image/") {
                image
            } else {
                fileIcon
            }
        }
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(HudHairline.subtle, lineWidth: HudStrokeWidth.standard)
        )
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
    }

    @ViewBuilder
    private var image: some View {
        #if canImport(UIKit)
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                case .failure:
                    fileIcon
                case .empty:
                    ProgressView().controlSize(.small)
                @unknown default:
                    fileIcon
                }
            }
        } else {
            fileIcon
        }
        #else
        fileIcon
        #endif
    }

    private var fileIcon: some View {
        VStack(spacing: HudSpacing.xs) {
            Image(systemName: mediaType.lowercased().hasPrefix("image/") ? "photo" : "doc")
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
            Text(fileName)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
