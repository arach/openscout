import SwiftUI
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

/// Renders a conversation text block's raw markdown as native, styled SwiftUI —
/// not a wall of literal `**`, `#`, and ``` ` ```.
///
/// This is a thin adapter over Hudson's standard `HudMarkdownView`, not a second
/// renderer. Scout used to carry its own copy of the whole block switch
/// (paragraph / heading / list / quote / code / table) over a forked copy of
/// Hudson's parser; `HudMarkdownStyle.agent` exists precisely so that fork could
/// be retired. What stays Scout-specific is the skin (`.scoutMessage`), the
/// secondary inks (`.scout` theme), and the inline `code` treatment below.
struct MessageMarkupView: View {
    let text: String

    var body: some View {
        HudMarkdownView(
            text: text,
            // `contentSize` reaches the fenced-code body (`HudCodeBlock`); the
            // prose sizes come from the style, which ignores it.
            contentSize: HudTextSize.sm,
            style: .scoutMessage,
            inlineTransform: Self.styleInlineCode
        )
        .environment(\.hudTheme, .scout)
        .tint(HudPalette.accent)
    }

    /// SwiftUI's markdown parser tags inline `code` spans with
    /// `.inlinePresentationIntent.code` but gives them no styling of their own,
    /// so the treatment is ours to supply.
    ///
    /// It is deliberately face-only. The previous version also painted each run
    /// with a background color, which `Text` draws as an unpadded band the full
    /// height of the line — so a long inline path like
    /// `apps/mac/Sources/Core/System/DiagnosticLog.swift` wrapped into ragged
    /// grey slabs that broke mid-token and collided with the line above. There
    /// is no way to pad or round a background inside a single `Text`, so the
    /// monospaced face carries the signal instead, one step down from the sans
    /// body so it sits optically level rather than looming.
    private static func styleInlineCode(_ input: AttributedString) -> AttributedString {
        var output = input
        // Collect first: mutating `output` while iterating its own runs would
        // invalidate the indices mid-walk.
        let codeRanges = output.runs.compactMap { run -> Range<AttributedString.Index>? in
            guard let intent = run.inlinePresentationIntent, intent.contains(.code) else { return nil }
            return run.range
        }
        for range in codeRanges {
            output[range].font = HudFont.mono(HudTextSize.sm)
        }
        return output
    }
}

private extension HudMarkdownStyle {
    /// Hudson's `.agent` preset (sans prose, mono markers and code) with two
    /// deliberate deviations for a phone-sized message surface:
    ///   • body one step up to `md` — message prose is the primary read here,
    ///     not chrome, and `base` is tuned for dense desktop panes;
    ///   • muted list markers instead of accent, so a ten-item numbered list
    ///     doesn't spend the app's one rationed accent on its bullets.
    static var scoutMessage: HudMarkdownStyle {
        var style = HudMarkdownStyle.agent
        style.bodyFont = { @Sendable _ in HudFont.ui(HudTextSize.md) }
        style.listMarkerColor = .muted
        return style
    }
}

private extension HudTheme {
    /// Hudson's default dark theme carrying Scout's brightened secondary inks,
    /// so the shared renderer resolves `.muted` / `.dim` to the same values as
    /// the rest of the app. Hudson's own defaults are darker and were failing
    /// WCAG AA against this canvas — see `ScoutInk`.
    static var scout: HudTheme {
        var theme = HudTheme.default
        theme.palette.muted = ScoutInk.muted
        theme.palette.dim = ScoutInk.dim
        return theme
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.raised.opacity(0.7)))
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
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
