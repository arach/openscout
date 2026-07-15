import Foundation

/// A durable, acknowledged command from the always-running helper to Scout.
///
/// Distributed notifications are only wake-up signals: the command stays in
/// this user-private inbox until Scout has handled and acknowledged it. That
/// closes the launch window where the process exists but its observer is not
/// installed yet.
public struct ScoutHUDPendingCommand: Codable, Equatable, Sendable {
    public let id: UUID
    public let createdAt: Date
    public let command: String
    public let value: String?

    public init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        command: String,
        value: String? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.command = command
        self.value = value
    }
}

public enum ScoutHUDCommandInbox {
    private static let directoryName = "openscout-hud-command-inbox"
    private static let maximumAge: TimeInterval = 24 * 60 * 60

    @discardableResult
    public static func enqueue(
        command: String,
        value: String? = nil,
        directory: URL? = nil,
        now: Date = Date()
    ) throws -> UUID {
        let normalized = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let root = try inboxDirectory(directory)
        try cleanup(in: root, now: now)
        let envelope = ScoutHUDPendingCommand(
            createdAt: now,
            command: normalized,
            value: value
        )
        let url = commandURL(id: envelope.id, in: root)
        try JSONEncoder().encode(envelope).write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        return envelope.id
    }

    public static func pending(
        directory: URL? = nil,
        now: Date = Date()
    ) throws -> [ScoutHUDPendingCommand] {
        let root = try inboxDirectory(directory)
        try cleanup(in: root, now: now)
        let urls = try FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }

        var commands: [ScoutHUDPendingCommand] = []
        for url in urls {
            do {
                let envelope = try JSONDecoder().decode(
                    ScoutHUDPendingCommand.self,
                    from: Data(contentsOf: url)
                )
                guard url.deletingPathExtension().lastPathComponent.lowercased()
                    == envelope.id.uuidString.lowercased()
                else {
                    try? FileManager.default.removeItem(at: url)
                    continue
                }
                commands.append(envelope)
            } catch {
                // A corrupt command is poison, not a reason to block every
                // later hotkey/drop behind it.
                try? FileManager.default.removeItem(at: url)
            }
        }
        return commands.sorted {
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    public static func acknowledge(
        _ id: UUID,
        directory: URL? = nil
    ) throws {
        let root = try inboxDirectory(directory)
        let url = commandURL(id: id, in: root)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    public static func cleanup(
        directory: URL? = nil,
        now: Date = Date()
    ) throws {
        try cleanup(in: inboxDirectory(directory), now: now)
    }

    private static func cleanup(in directory: URL, now: Date) throws {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )
        for url in urls where url.pathExtension == "json" {
            let values = try? url.resourceValues(forKeys: keys)
            guard values?.isRegularFile == true,
                  let modified = values?.contentModificationDate,
                  now.timeIntervalSince(modified) > maximumAge else { continue }
            try? FileManager.default.removeItem(at: url)
        }
    }

    private static func inboxDirectory(_ override: URL?) throws -> URL {
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

    private static func commandURL(id: UUID, in directory: URL) -> URL {
        directory
            .appendingPathComponent(id.uuidString.lowercased())
            .appendingPathExtension("json")
    }
}
