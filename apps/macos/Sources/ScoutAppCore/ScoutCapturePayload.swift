import Foundation

/// Transient capture handoff between the always-running menu helper and Scout.
///
/// The helper can receive a drop before Scout is running. It writes this small
/// payload to a user-local temporary directory, launches Scout with the token,
/// and Scout atomically consumes the payload. This is ingress state only; task
/// and message records are still created by the broker through `/api/sessions`.
public struct ScoutCapturePayload: Codable, Equatable, Sendable {
    public struct Attachment: Codable, Equatable, Sendable {
        public let data: Data
        public let mediaType: String
        public let fileName: String

        public init(data: Data, mediaType: String, fileName: String) {
            self.data = data
            self.mediaType = mediaType
            self.fileName = fileName
        }
    }

    public let createdAt: Date
    public let corner: String?
    public let displayID: UInt32?
    public let filePaths: [String]
    public let attachments: [Attachment]
    public let text: String?

    public init(
        createdAt: Date = Date(),
        corner: String? = nil,
        displayID: UInt32? = nil,
        filePaths: [String] = [],
        attachments: [Attachment] = [],
        text: String? = nil
    ) {
        self.createdAt = createdAt
        self.corner = corner
        self.displayID = displayID
        self.filePaths = filePaths
        self.attachments = attachments
        self.text = text
    }
}

public enum ScoutCapturePayloadStoreError: LocalizedError, Equatable, Sendable {
    case invalidToken
    case missingPayload
    case payloadTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidToken:
            return "The quick-capture handoff token is invalid."
        case .missingPayload:
            return "The quick-capture handoff has expired."
        case .payloadTooLarge:
            return "The capture is too large to hand off safely. Drop fewer or smaller items."
        }
    }
}

public enum ScoutCapturePayloadStore {
    private static let directoryName = "openscout-capture-handoffs"
    private static let maximumAge: TimeInterval = 24 * 60 * 60
    private static let maximumPromiseAge: TimeInterval = 7 * 24 * 60 * 60
    public static let maximumFilePathCount = 64
    public static let maximumAttachmentCount = 16
    public static let maximumAttachmentBytes = 32 * 1024 * 1024
    public static let maximumTextBytes = 256 * 1024
    private static let maximumEncodedBytes = 48 * 1024 * 1024

    /// Save a payload and return the opaque token accepted by `take`.
    public static func save(
        _ payload: ScoutCapturePayload,
        directory: URL? = nil
    ) throws -> String {
        try validate(payload)
        let token = UUID().uuidString.lowercased()
        let root = try captureDirectory(directory)
        try removeExpiredPayloads(in: root)
        let data = try JSONEncoder().encode(payload)
        guard data.count <= maximumEncodedBytes else {
            throw ScoutCapturePayloadStoreError.payloadTooLarge
        }
        let url = payloadURL(token: token, in: root)
        try data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        return token
    }

    /// Read and delete a payload. Tokens are UUID-only to prevent path escape.
    public static func take(
        token: String,
        directory: URL? = nil
    ) throws -> ScoutCapturePayload {
        guard let normalized = normalizedToken(token) else {
            throw ScoutCapturePayloadStoreError.invalidToken
        }
        let root = try captureDirectory(directory)
        try removeExpiredPayloads(in: root)
        let url = payloadURL(token: normalized.uuidString, in: root)
        let claimURL = root
            .appendingPathComponent("\(normalized.uuidString.lowercased()).\(UUID().uuidString.lowercased())")
            .appendingPathExtension("claim")
        do {
            // A same-volume rename is atomic. Only one concurrent consumer can
            // claim the UUID-named source; replay attempts see it as missing.
            try FileManager.default.moveItem(at: url, to: claimURL)
        } catch {
            throw ScoutCapturePayloadStoreError.missingPayload
        }
        defer { try? FileManager.default.removeItem(at: claimURL) }
        return try decodePayload(at: claimURL)
    }

    /// Read without consuming. The HUD command inbox uses this so a process
    /// exit before command acknowledgement can safely replay the handoff.
    public static func read(
        token: String,
        directory: URL? = nil
    ) throws -> ScoutCapturePayload {
        guard let normalized = normalizedToken(token) else {
            throw ScoutCapturePayloadStoreError.invalidToken
        }
        let root = try captureDirectory(directory)
        try removeExpiredPayloads(in: root)
        let url = payloadURL(token: normalized.uuidString, in: root)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw ScoutCapturePayloadStoreError.missingPayload
        }
        return try decodePayload(at: url)
    }

    public static func discard(
        token: String,
        directory: URL? = nil
    ) throws {
        guard let normalized = normalizedToken(token) else {
            throw ScoutCapturePayloadStoreError.invalidToken
        }
        let root = try captureDirectory(directory)
        let url = payloadURL(token: normalized.uuidString, in: root)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    public static func cleanupExpired(
        directory: URL? = nil,
        now: Date = Date()
    ) throws {
        try removeExpiredPayloads(in: captureDirectory(directory), now: now)
    }

    /// Create a private destination for AppKit file promises (for example,
    /// drags from Mail or Photos). The caller should retain successful files;
    /// stale promise directories are removed by the normal capture cleanup.
    public static func makePromiseStagingDirectory(
        directory: URL? = nil
    ) throws -> URL {
        let root = try captureDirectory(directory)
        try removeExpiredPayloads(in: root)
        let destination = root
            .appendingPathComponent(UUID().uuidString.lowercased())
            .appendingPathExtension("promise")
        try FileManager.default.createDirectory(
            at: destination,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: destination.path
        )
        return destination
    }

    static func removeExpiredPayloads(
        in directory: URL,
        now: Date = Date()
    ) throws {
        let keys: Set<URLResourceKey> = [
            .contentModificationDateKey,
            .isDirectoryKey,
            .isRegularFileKey,
        ]
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )
        for url in urls {
            let values = try? url.resourceValues(forKeys: keys)
            guard let modified = values?.contentModificationDate else { continue }
            let age = now.timeIntervalSince(modified)
            if values?.isRegularFile == true,
               (url.pathExtension == "json" || url.pathExtension == "claim"),
               age > maximumAge {
                try? FileManager.default.removeItem(at: url)
            } else if values?.isDirectory == true,
                      url.pathExtension == "promise",
                      age > maximumPromiseAge {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    private static func captureDirectory(_ override: URL?) throws -> URL {
        let url = override ?? FileManager.default.temporaryDirectory
            .appendingPathComponent(directoryName, isDirectory: true)
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        return url
    }

    private static func payloadURL(token: String, in directory: URL) -> URL {
        directory.appendingPathComponent(token.lowercased()).appendingPathExtension("json")
    }

    private static func normalizedToken(_ raw: String) -> UUID? {
        UUID(uuidString: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func decodePayload(at url: URL) throws -> ScoutCapturePayload {
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
           size > maximumEncodedBytes {
            throw ScoutCapturePayloadStoreError.payloadTooLarge
        }
        let data = try Data(contentsOf: url)
        guard data.count <= maximumEncodedBytes else {
            throw ScoutCapturePayloadStoreError.payloadTooLarge
        }
        let payload = try JSONDecoder().decode(ScoutCapturePayload.self, from: data)
        try validate(payload)
        guard Date().timeIntervalSince(payload.createdAt) <= maximumAge else {
            throw ScoutCapturePayloadStoreError.missingPayload
        }
        return payload
    }

    private static func validate(_ payload: ScoutCapturePayload) throws {
        guard payload.filePaths.count <= maximumFilePathCount,
              payload.attachments.count <= maximumAttachmentCount,
              payload.attachments.reduce(0, { $0 + $1.data.count }) <= maximumAttachmentBytes,
              (payload.text?.utf8.count ?? 0) <= maximumTextBytes else {
            throw ScoutCapturePayloadStoreError.payloadTooLarge
        }
    }
}
