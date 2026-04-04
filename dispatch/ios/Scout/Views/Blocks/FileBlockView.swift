// FileBlockView — Renders file blocks (images inline, other files as download cards).

import SwiftUI

struct FileBlockView: View {
    let block: Block

    private var isImage: Bool {
        block.mimeType?.hasPrefix("image/") ?? false
    }

    private var fileName: String {
        block.name ?? "Untitled file"
    }

    var body: some View {
        if isImage {
            imageView
        } else {
            fileCard
        }
    }

    // MARK: - Image

    @ViewBuilder
    private var imageView: some View {
        VStack(alignment: .leading, spacing: DispatchSpacing.xs) {
            if let data = block.data {
                if data.hasPrefix("data:") || data.hasPrefix("http://") || data.hasPrefix("https://") {
                    // URL-based image
                    if let url = URL(string: data) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .empty:
                                imagePlaceholder
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous))
                            case .failure:
                                imageError
                            @unknown default:
                                imagePlaceholder
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(maxHeight: 400)
                    } else {
                        imageError
                    }
                } else {
                    // Base64-encoded image
                    if let imageData = Data(base64Encoded: data),
                       let uiImage = UIImage(data: imageData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous))
                            .frame(maxWidth: .infinity)
                            .frame(maxHeight: 400)
                    } else {
                        imageError
                    }
                }
            } else {
                imagePlaceholder
            }

            if let name = block.name {
                Text(name)
                    .font(DispatchTypography.caption(12))
                    .foregroundStyle(DispatchColors.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Image: \(fileName)")
    }

    private var imagePlaceholder: some View {
        RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous)
            .fill(DispatchColors.surfaceAdaptive)
            .frame(height: 120)
            .overlay {
                ProgressView()
                    .tint(DispatchColors.textMuted)
            }
    }

    private var imageError: some View {
        RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous)
            .fill(DispatchColors.surfaceAdaptive)
            .frame(height: 80)
            .overlay {
                VStack(spacing: DispatchSpacing.xs) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.system(size: 20))
                        .foregroundStyle(DispatchColors.textMuted)
                    Text("Failed to load image")
                        .font(DispatchTypography.caption())
                        .foregroundStyle(DispatchColors.textMuted)
                }
            }
    }

    // MARK: - File Card

    private var fileCard: some View {
        HStack(spacing: DispatchSpacing.md) {
            Image(systemName: fileIcon)
                .font(.system(size: 22))
                .foregroundStyle(DispatchColors.accent)
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: DispatchSpacing.xxs) {
                Text(fileName)
                    .font(DispatchTypography.body(14, weight: .medium))
                    .foregroundStyle(DispatchColors.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                if let mimeType = block.mimeType {
                    Text(mimeType)
                        .font(DispatchTypography.caption(11))
                        .foregroundStyle(DispatchColors.textMuted)
                }
            }

            Spacer()

            Image(systemName: "arrow.down.circle")
                .font(.system(size: 18))
                .foregroundStyle(DispatchColors.textMuted)
        }
        .dispatchCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("File: \(fileName)")
    }

    // MARK: - Helpers

    private var fileIcon: String {
        guard let mimeType = block.mimeType else { return "doc" }
        if mimeType.hasPrefix("text/") { return "doc.text" }
        if mimeType.hasPrefix("application/json") { return "curlybraces" }
        if mimeType.hasPrefix("application/pdf") { return "doc.richtext" }
        if mimeType.hasPrefix("video/") { return "film" }
        if mimeType.hasPrefix("audio/") { return "waveform" }
        return "doc"
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        FileBlockView(block: Block(
            id: "1", turnId: "t1", type: .file, status: .completed, index: 0,
            mimeType: "application/json", name: "package.json", data: nil
        ))

        FileBlockView(block: Block(
            id: "2", turnId: "t1", type: .file, status: .completed, index: 1,
            mimeType: "image/png", name: "screenshot.png",
            data: "https://via.placeholder.com/300x200"
        ))
    }
    .padding()
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
