import Foundation
import ScoutCapabilities
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

/// A staged native attachment, ready to upload as link-backed metadata.
/// Holds raw bytes, not AppKit image objects, so upload work can stay Sendable.
public struct ScoutComposerImage: Identifiable, Sendable, Equatable {
    public let id: UUID
    public let data: Data
    public let mediaType: String
    public let fileName: String

    public init(id: UUID = UUID(), data: Data, mediaType: String, fileName: String) {
        self.id = id
        self.data = data
        self.mediaType = mediaType
        self.fileName = fileName
    }
}

public extension ScoutComposerImage {
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

/// Response from POST /api/blobs: a fetchable blob URL plus normalized metadata.
public struct ScoutBlobUploadResponse: Decodable, Sendable, Equatable {
    public let id: String?
    public let url: String
    public let mediaType: String
    public let fileName: String?
}

public enum ScoutAttachmentUploadError: LocalizedError, Sendable {
    case invalidResponse
    case uploadFailed(Int, String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid attachment upload response."
        case .uploadFailed(let status, let message):
            return message.isEmpty ? "Scout attachment upload failed with HTTP \(status)." : message
        }
    }
}

public enum ScoutAttachmentUploadService {
    public static func uploadAll(_ attachments: [ScoutComposerImage]) async throws -> [MessageAttachment] {
        var result: [MessageAttachment] = []
        for attachment in attachments {
            result.append(try await upload(attachment))
        }
        return result
    }

    public static func upload(_ attachment: ScoutComposerImage) async throws -> MessageAttachment {
        let uploaded = try await uploadBlob(attachment)
        return MessageAttachment(
            id: uploaded.id ?? "att-\(UUID().uuidString)",
            mediaType: uploaded.mediaType,
            fileName: uploaded.fileName ?? attachment.fileName,
            url: ScoutWeb.attachmentURL(uploaded.url)?.absoluteString ?? uploaded.url
        )
    }

    private static func uploadBlob(_ attachment: ScoutComposerImage) async throws -> ScoutBlobUploadResponse {
        let url = ScoutWeb.baseURL().appending(path: "api/blobs")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "data": attachment.data.base64EncodedString(),
            "mediaType": attachment.mediaType,
            "fileName": attachment.fileName,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutAttachmentUploadError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutAttachmentUploadError.uploadFailed(http.statusCode, decodeErrorMessage(data))
        }
        return try JSONDecoder().decode(ScoutBlobUploadResponse.self, from: data)
    }

    private static func decodeErrorMessage(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String else {
            return ""
        }
        return message
    }
}

#if os(macOS)
public enum ScoutMediaIntake {
    public static let supportedImageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "tif", "bmp",
    ]
    public static let supportedVideoExtensions: Set<String> = [
        "mp4", "mov", "m4v", "webm",
    ]
    public static let supportedMarkdownExtensions: Set<String> = [
        "md", "markdown", "mdx", "mdown", "mkd",
    ]
    public static let supportedCodeExtensions: Set<String> = [
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
    public static let supportedCodeBasenames: Set<String> = [
        "dockerfile", "containerfile", "makefile", "gemfile", "rakefile", "procfile", "brewfile",
    ]

    public static func isMarkdownFileName(_ fileName: String) -> Bool {
        supportedMarkdownExtensions.contains(fileExtension(for: fileName))
    }

    public static func isCodeFileName(_ fileName: String) -> Bool {
        let base = fileBaseName(for: fileName)
        if supportedCodeBasenames.contains(base) { return true }
        return supportedCodeExtensions.contains(fileExtension(for: fileName))
    }

    public static func isTextCaptureFileName(_ fileName: String) -> Bool {
        isMarkdownFileName(fileName) || isCodeFileName(fileName)
    }

    public static var pickerContentTypes: [UTType] {
        var types: [UTType] = [.image, .movie, .mpeg4Movie, .quickTimeMovie, .video, .sourceCode, .json]
        for ext in supportedMarkdownExtensions.union(supportedCodeExtensions) {
            if let type = UTType(filenameExtension: ext) {
                types.append(type)
            }
        }
        return types
    }

    public static var textCapturePasteboardTypes: [NSPasteboard.PasteboardType] {
        var types = supportedMarkdownExtensions.union(supportedCodeExtensions).compactMap { ext in
            UTType(filenameExtension: ext).map { NSPasteboard.PasteboardType($0.identifier) }
        }
        types.append(NSPasteboard.PasteboardType(UTType.sourceCode.identifier))
        return types
    }

    public static func fromPasteboard(_ pasteboard: NSPasteboard = .general) -> [ScoutComposerImage] {
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

    public static func fromFileURLs(_ urls: [URL]) -> [ScoutComposerImage] {
        urls.compactMap(fromFileURL)
    }

    public static func fromFileURL(_ url: URL) -> ScoutComposerImage? {
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

    public static func isSupportedMediaType(_ mediaType: String, fileName: String? = nil) -> Bool {
        let lower = mediaType.lowercased()
        if lower.hasPrefix("image/") || lower.hasPrefix("video/") { return true }
        guard let fileName else { return false }
        return resolveTextCaptureMediaType(lower, fileName: fileName) != nil
    }

    private static func fileBaseName(for fileName: String) -> String {
        (fileName as NSString).lastPathComponent.lowercased()
    }

    private static func fileExtension(for fileName: String) -> String {
        (fileName as NSString).pathExtension.lowercased()
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
#endif
