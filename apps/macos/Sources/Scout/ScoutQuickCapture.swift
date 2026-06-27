import HudsonUI
import ScoutAppCore
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

extension ScoutComposerImage {
    var isImage: Bool { mediaType.lowercased().hasPrefix("image/") }
    var isVideo: Bool { mediaType.lowercased().hasPrefix("video/") }
    var isMarkdown: Bool {
        let lower = mediaType.lowercased()
        if lower == "text/markdown" || lower == "text/x-markdown" { return true }
        return ScoutMediaIntake.isMarkdownFileName(fileName)
    }
    var isCode: Bool {
        !isMarkdown && ScoutMediaIntake.isCodeFileName(fileName)
    }
}

/// Full-window drag overlay — appears when files cross the app chrome so drops
/// read as intentional capture, not an accident on a list row.
struct ScoutWindowCaptureOverlay: View {
    var body: some View {
        ZStack {
            ScoutPalette.accent.opacity(0.08)
                .background(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: HudSpacing.lg) {
                Image(systemName: "arrow.down.doc.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                Text("Drop to attach")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Markdown · code · images · clips")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
            }
            .padding(HudSpacing.huge)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutPalette.accent.opacity(0.55), lineWidth: HudStrokeWidth.standard)
            )
            .shadow(color: ScoutSurface.shadow(0.18), radius: 18, y: 8)
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

/// Comms empty state — a capture-first surface instead of a dead composer.
struct ScoutQuickChatSurface: View {
    let recentChannels: [ScoutChannel]
    let stagedAttachments: [ScoutComposerImage]
    let dropHint: String?
    let onNewChat: () -> Void
    let onSelectChannel: (ScoutChannel) -> Void
    let onStageAttachments: ([ScoutComposerImage]) -> Bool
    let onBrowse: () -> Void
    let onRemoveAttachment: (ScoutComposerImage) -> Void

    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: HudSpacing.xxl)

            ScoutCaptureDropZone(
                isTargeted: dropTargeted,
                stagedCount: stagedAttachments.count,
                dropHint: dropHint,
                onBrowse: onBrowse,
                onStageAttachments: onStageAttachments,
                onTargeted: { dropTargeted = $0 }
            )
            .frame(maxWidth: 520)
            .padding(.horizontal, HudSpacing.huge)

            if !stagedAttachments.isEmpty {
                stagedStrip
                    .padding(.top, HudSpacing.xl)
            }

            quickActions
                .padding(.top, HudSpacing.xxl)

            if !recentChannels.isEmpty {
                recentChats
                    .padding(.top, HudSpacing.xxl)
            }

            Spacer(minLength: HudSpacing.huge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
    }

    private var stagedStrip: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel("Staged")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    ForEach(stagedAttachments) { attachment in
                        ScoutCaptureAttachmentChip(attachment: attachment) {
                            onRemoveAttachment(attachment)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .padding(.horizontal, HudSpacing.huge)
    }

    private var quickActions: some View {
        HStack(spacing: HudSpacing.md) {
            Button(action: onNewChat) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "square.and.pencil")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    Text("New chat")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                }
                .foregroundStyle(ScoutPalette.bg)
                .padding(.horizontal, HudSpacing.xl)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutPalette.accent)
                )
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            .help("Start a new agent chat")

            Button(action: onBrowse) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "folder")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    Text("Browse…")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                }
                .foregroundStyle(ScoutPalette.muted)
                .padding(.horizontal, HudSpacing.lg)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutSurface.control)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
        }
    }

    private var recentChats: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HudSectionLabel("Recent")
            VStack(spacing: HudSpacing.xs) {
                ForEach(recentChannels) { channel in
                    Button {
                        onSelectChannel(channel)
                    } label: {
                        HStack(spacing: HudSpacing.md) {
                            Image(systemName: channel.scope == .shared ? "number" : "bubble.left")
                                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                                .foregroundStyle(ScoutPalette.dim)
                                .frame(width: 16)
                            Text(channel.displayHandle)
                                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            if !channel.ageLabel.isEmpty {
                                Text(channel.ageLabel)
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .foregroundStyle(ScoutPalette.dim)
                            }
                        }
                        .padding(.horizontal, HudSpacing.lg)
                        .frame(height: 34)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(ScoutSurface.control)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                        )
                    }
                    .buttonStyle(.plain)
                    .scoutPointerCursor()
                }
            }
            .frame(maxWidth: 420)
        }
        .padding(.horizontal, HudSpacing.huge)
    }
}

private struct ScoutCaptureDropZone: View {
    let isTargeted: Bool
    let stagedCount: Int
    let dropHint: String?
    let onBrowse: () -> Void
    let onStageAttachments: ([ScoutComposerImage]) -> Bool
    let onTargeted: (Bool) -> Void

    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: isTargeted ? "arrow.down.circle.fill" : "photo.on.rectangle.angled")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(isTargeted ? ScoutPalette.accent : ScoutPalette.dim)
                .symbolEffect(.bounce, value: isTargeted)

            VStack(spacing: HudSpacing.xs) {
                Text(isTargeted ? "Release to stage" : "Drop markdown, code, images, or clips")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Drag source files, screenshots, recordings, or pick from disk")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .multilineTextAlignment(.center)
            }

            if let dropHint {
                Text(dropHint)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.statusWarn)
                    .multilineTextAlignment(.center)
            } else if stagedCount > 0 {
                Text("\(stagedCount) staged · pick a chat or start new")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HudSpacing.huge)
        .padding(.horizontal, HudSpacing.xxl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(isTargeted ? ScoutPalette.accentSoft.opacity(0.55) : ScoutSurface.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .strokeBorder(
                    isTargeted ? ScoutPalette.accent.opacity(0.72) : ScoutDesign.hairlineStrong,
                    style: StrokeStyle(lineWidth: isTargeted ? 1.5 : 1, dash: isTargeted ? [] : [7, 5])
                )
        )
        .background {
            ScoutAttachmentDropCatcher(
                onTargeted: onTargeted,
                onStageAttachments: onStageAttachments
            )
        }
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .animation(.easeOut(duration: 0.14), value: isTargeted)
        .onTapGesture(perform: onBrowse)
    }
}

struct ScoutCaptureAttachmentChip: View {
    let attachment: ScoutComposerImage
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if attachment.isImage, let nsImage = NSImage(data: attachment.data) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    VStack(spacing: HudSpacing.xs) {
                        Image(systemName: attachmentSymbol(for: attachment))
                            .font(.system(size: HudTextSize.lg, weight: .semibold))
                            .foregroundStyle(ScoutPalette.muted)
                        Text(attachment.fileName)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 72)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ScoutSurface.inset)
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: HudTextSize.md))
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            .offset(x: 5, y: -5)
        }
    }
}

#if os(macOS)
enum ScoutMediaIntake {
    static let supportedImageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "tif", "bmp",
    ]
    static let supportedVideoExtensions: Set<String> = [
        "mp4", "mov", "m4v", "webm",
    ]
    static let supportedMarkdownExtensions: Set<String> = [
        "md", "markdown", "mdx", "mdown", "mkd",
    ]
    static let supportedCodeExtensions: Set<String> = [
        "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx",
        "cjs", "mjs", "js", "jsx", "ts", "tsx",
        "py", "pyw", "pyi", "rs", "go", "java", "kt", "kts", "swift",
        "cs", "rb", "php", "lua", "r",
        "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
        "sql", "prisma", "json", "jsonc", "json5", "yaml", "yml", "toml", "xml",
        "html", "htm", "xhtml", "css", "scss", "sass", "less",
        "vue", "svelte", "astro", "graphql", "gql",
        "zig", "ex", "exs", "erl", "hrl", "hs", "clj", "cljs", "cljc", "dart",
        "tf", "hcl", "nix", "env", "ini", "cfg", "conf", "properties",
        "txt", "log", "cmake", "gradle", "groovy", "patch", "diff", "proto", "wat",
    ]
    static let supportedCodeBasenames: Set<String> = [
        "dockerfile", "containerfile", "makefile", "gemfile", "rakefile", "procfile", "brewfile",
    ]

    static func isMarkdownFileName(_ fileName: String) -> Bool {
        supportedMarkdownExtensions.contains(fileExtension(for: fileName))
    }

    static func isCodeFileName(_ fileName: String) -> Bool {
        let base = fileBaseName(for: fileName)
        if supportedCodeBasenames.contains(base) { return true }
        return supportedCodeExtensions.contains(fileExtension(for: fileName))
    }

    static func isTextCaptureFileName(_ fileName: String) -> Bool {
        isMarkdownFileName(fileName) || isCodeFileName(fileName)
    }

    static var pickerContentTypes: [UTType] {
        var types: [UTType] = [.image, .movie, .mpeg4Movie, .quickTimeMovie, .video, .sourceCode, .json]
        for ext in supportedMarkdownExtensions.union(supportedCodeExtensions) {
            if let type = UTType(filenameExtension: ext) {
                types.append(type)
            }
        }
        return types
    }

    static var textCapturePasteboardTypes: [NSPasteboard.PasteboardType] {
        var types = supportedMarkdownExtensions.union(supportedCodeExtensions).compactMap { ext in
            UTType(filenameExtension: ext).map { NSPasteboard.PasteboardType($0.identifier) }
        }
        types.append(NSPasteboard.PasteboardType(UTType.sourceCode.identifier))
        return types
    }

    private static func fileBaseName(for fileName: String) -> String {
        (fileName as NSString).lastPathComponent.lowercased()
    }

    private static func fileExtension(for fileName: String) -> String {
        (fileName as NSString).pathExtension.lowercased()
    }

    static func fromPasteboard(_ pasteboard: NSPasteboard = .general) -> [ScoutComposerImage] {
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], !urls.isEmpty {
            let media = fromFileURLs(urls)
            if !media.isEmpty { return media }
        }
        if let data = pasteboard.data(forType: .png) {
            return [ScoutComposerImage(data: data, mediaType: "image/png", fileName: "pasted-image.png")]
        }
        if let tiff = pasteboard.data(forType: .tiff),
           let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            return [ScoutComposerImage(data: png, mediaType: "image/png", fileName: "pasted-image.png")]
        }
        return []
    }

    static func fromFileURLs(_ urls: [URL]) -> [ScoutComposerImage] {
        urls.compactMap(fromFileURL)
    }

    static func fromFileURL(_ url: URL) -> ScoutComposerImage? {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        let resolvedURL = url.isFileURL ? url.standardizedFileURL : url
        guard let data = try? Data(contentsOf: resolvedURL) else { return nil }
        let fileName = resolvedURL.lastPathComponent
        let ext = resolvedURL.pathExtension.lowercased()
        let resolved = mediaTypeForExtension(ext)
            ?? sniffMediaType(data)
            ?? inferredMediaType(fileName: fileName, data: data)
        guard let resolved, isSupportedMediaType(resolved, fileName: fileName) else { return nil }
        return ScoutComposerImage(
            data: data,
            mediaType: resolved,
            fileName: fileName
        )
    }

    static func isSupportedMediaType(_ mediaType: String, fileName: String? = nil) -> Bool {
        let lower = mediaType.lowercased()
        if lower.hasPrefix("image/") || lower.hasPrefix("video/") { return true }
        guard let fileName else { return false }
        return resolveTextCaptureMediaType(lower, fileName: fileName) != nil
    }

    private static func mediaTypeForExtension(_ ext: String) -> String? {
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "tiff", "tif": return "image/tiff"
        case "bmp": return "image/bmp"
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "webm": return "video/webm"
        case "md", "markdown", "mdx", "mdown", "mkd": return "text/markdown"
        case "json", "jsonc", "json5": return "application/json"
        case "yaml", "yml": return "text/yaml"
        case "toml": return "text/toml"
        case "html", "htm", "xhtml": return "text/html"
        case "css", "scss", "sass", "less": return "text/css"
        case "js", "jsx", "mjs", "cjs": return "text/javascript"
        case "ts", "tsx": return "text/typescript"
        case "sh", "bash", "zsh", "fish": return "text/x-shellscript"
        default:
            return supportedCodeExtensions.contains(ext) ? "text/plain" : nil
        }
    }

    private static func inferredMediaType(fileName: String, data: Data) -> String? {
        guard !data.isEmpty, isTextCaptureFileName(fileName) else { return nil }
        return resolveTextCaptureMediaType("", fileName: fileName)
    }

    private static func resolveTextCaptureMediaType(_ mediaType: String, fileName: String) -> String? {
        guard isTextCaptureFileName(fileName) else { return nil }
        if isMarkdownFileName(fileName) { return "text/markdown" }
        if let mapped = mediaTypeForExtension(fileExtension(for: fileName)),
           mapped != "text/plain" {
            return mapped
        }
        let lower = mediaType.lowercased()
        switch lower {
        case "text/markdown", "text/x-markdown", "text/plain",
             "text/javascript", "text/typescript", "text/css", "text/html",
             "text/yaml", "text/toml", "text/x-shellscript",
             "application/json", "application/javascript":
            return lower
        default:
            return "text/plain"
        }
    }

    private static func sniffMediaType(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.count >= 4, bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 {
            return "image/png"
        }
        if bytes.count >= 3, bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF {
            return "image/jpeg"
        }
        if bytes.count >= 3, bytes[0] == 0x47, bytes[1] == 0x49, bytes[2] == 0x46 {
            return "image/gif"
        }
        if bytes.count >= 12, bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46, bytes[3] == 0x46,
           bytes[8] == 0x57, bytes[9] == 0x45, bytes[10] == 0x42, bytes[11] == 0x50 {
            return "image/webp"
        }
        if bytes.count >= 8,
           bytes[4] == 0x66, bytes[5] == 0x74, bytes[6] == 0x79, bytes[7] == 0x70 {
            return "video/mp4"
        }
        return nil
    }
}

private func attachmentSymbol(for attachment: ScoutComposerImage) -> String {
    if attachment.isVideo { return "film" }
    if attachment.isMarkdown { return "doc.richtext" }
    if attachment.isCode { return "chevron.left.forwardslash.chevron.right" }
    return "doc"
}
#endif