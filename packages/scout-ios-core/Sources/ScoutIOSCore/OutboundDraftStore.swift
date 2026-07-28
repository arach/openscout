import Foundation
import ScoutCapabilities

/// A send attempt persisted before the composer clears its visible text.
///
/// Records live outside transport/session state: losing the bridge, backgrounding
/// the app, or replacing an ended agent session cannot erase the operator's
/// payload or its stable idempotency key.
public struct OutboundDraftRecord: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var conversationId: String
    public var body: String
    public var attachments: [AttachmentUpload]
    public var createdAt: Date

    public init(
        id: String,
        conversationId: String,
        body: String,
        attachments: [AttachmentUpload] = [],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.conversationId = conversationId
        self.body = body
        self.attachments = attachments
        self.createdAt = createdAt
    }
}

/// Binary-plist outbox with one atomically-written file per send. Keeping
/// attachment bytes out of UserDefaults avoids its small-value assumptions and
/// makes a partially-written draft impossible to decode as valid state.
public actor OutboundDraftStore {
    public static let shared = OutboundDraftStore()

    private let directoryURL: URL
    private let fileManager: FileManager

    public init(
        directoryURL: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        if let directoryURL {
            self.directoryURL = directoryURL
        } else {
            let applicationSupport = fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? fileManager.temporaryDirectory
            self.directoryURL = applicationSupport
                .appendingPathComponent("OpenScout", isDirectory: true)
                .appendingPathComponent("Outbound", isDirectory: true)
        }
    }

    public func save(_ draft: OutboundDraftRecord) throws {
        try fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        let data = try encoder.encode(draft)
        try data.write(to: fileURL(for: draft.id), options: .atomic)
    }

    public func latest(conversationId: String) throws -> OutboundDraftRecord? {
        try all()
            .filter { $0.conversationId == conversationId }
            .max { $0.createdAt < $1.createdAt }
    }

    public func draft(id: String) throws -> OutboundDraftRecord? {
        let url = fileURL(for: id)
        guard fileManager.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? PropertyListDecoder().decode(OutboundDraftRecord.self, from: data)
    }

    public func remove(id: String) throws {
        let url = fileURL(for: id)
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    public func all() throws -> [OutboundDraftRecord] {
        guard fileManager.fileExists(atPath: directoryURL.path) else { return [] }
        return try fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        .filter { $0.pathExtension == "outbound" }
        .compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? PropertyListDecoder().decode(OutboundDraftRecord.self, from: data)
        }
    }

    private func fileURL(for id: String) -> URL {
        let safe = id.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) || scalar == "-" || scalar == "_"
                ? Character(String(scalar))
                : "_"
        }
        return directoryURL
            .appendingPathComponent(String(safe), isDirectory: false)
            .appendingPathExtension("outbound")
    }
}
