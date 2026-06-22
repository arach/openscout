import Foundation

struct OpenScoutNetworkSettings: Sendable {
    static let defaultDiscoveryEnabled = true
    static let defaultRendezvousURL = "https://mesh.oscout.net"
    static let defaultPairingRelayURL = "wss://mesh.oscout.net/v1/relay"

    var discoveryEnabled: Bool = defaultDiscoveryEnabled
    var rendezvousURL: String = defaultRendezvousURL
    var pairingRelayURL: String = defaultPairingRelayURL
    var keepPairingRelayRunning: Bool = true
}

enum OpenScoutNetworkSettingsStore {
    static func load() -> OpenScoutNetworkSettings {
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

    static func save(_ settings: OpenScoutNetworkSettings) throws {
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

    static func settingsPath() -> String {
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
