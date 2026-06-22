import Foundation

/// Product settings for OpenScout Network, persisted under
/// `~/Library/Application Support/OpenScout/settings.json`.
///
/// Shared between the main Scout app (user-facing controls) and the menu
/// helper (supervision). The store reads and writes the same JSON file and
/// preserves unrelated keys so neither surface clobbers the other's settings.
public struct OpenScoutNetworkSettings: Sendable {
    public static let defaultDiscoveryEnabled = true
    public static let defaultRendezvousURL = "https://mesh.oscout.net"
    public static let defaultPairingRelayURL = "wss://mesh.oscout.net/v1/relay"

    public var discoveryEnabled: Bool
    public var rendezvousURL: String
    public var pairingRelayURL: String
    public var keepPairingRelayRunning: Bool

    public init(
        discoveryEnabled: Bool = defaultDiscoveryEnabled,
        rendezvousURL: String = defaultRendezvousURL,
        pairingRelayURL: String = defaultPairingRelayURL,
        keepPairingRelayRunning: Bool = true
    ) {
        self.discoveryEnabled = discoveryEnabled
        self.rendezvousURL = rendezvousURL
        self.pairingRelayURL = pairingRelayURL
        self.keepPairingRelayRunning = keepPairingRelayRunning
    }
}

public enum OpenScoutNetworkSettingsStore {
    public static func load() -> OpenScoutNetworkSettings {
        guard let root = readRootObject(),
              let network = root["network"] as? [String: Any],
              let osn = network["openScoutNetwork"] as? [String: Any] else {
            return OpenScoutNetworkSettings()
        }

        return OpenScoutNetworkSettings(
            discoveryEnabled: osn["discoveryEnabled"] as? Bool ?? OpenScoutNetworkSettings.defaultDiscoveryEnabled,
            rendezvousURL: normalizedURL(osn["rendezvousUrl"], fallback: OpenScoutNetworkSettings.defaultRendezvousURL),
            pairingRelayURL: normalizedURL(osn["pairingRelayUrl"], fallback: OpenScoutNetworkSettings.defaultPairingRelayURL),
            keepPairingRelayRunning: osn["keepPairingRelayRunning"] as? Bool ?? true
        )
    }

    public static func save(_ settings: OpenScoutNetworkSettings) throws {
        var root = readRootObject() ?? [:]
        if root["version"] == nil {
            root["version"] = 1
        }

        var network = root["network"] as? [String: Any] ?? [:]
        var osn = network["openScoutNetwork"] as? [String: Any] ?? [:]
        osn["discoveryEnabled"] = settings.discoveryEnabled
        osn["rendezvousUrl"] = settings.rendezvousURL
        osn["pairingRelayUrl"] = settings.pairingRelayURL
        osn["keepPairingRelayRunning"] = settings.keepPairingRelayRunning
        network["openScoutNetwork"] = osn
        root["network"] = network

        let url = settingsURL()
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: [.atomic])
    }

    public static func settingsPath() -> String {
        settingsURL().path
    }

    private static func readRootObject() -> [String: Any]? {
        guard let data = try? Data(contentsOf: settingsURL()),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object
    }

    private static func settingsURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Application Support/OpenScout/settings.json")
    }

    private static func normalizedURL(_ value: Any?, fallback: String) -> String {
        guard let raw = value as? String else {
            return fallback
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return fallback
        }
        return trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
    }
}
