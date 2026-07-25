import Foundation
import HudsonVoice
import Security

/// Scout's own speech API keys, in the login Keychain.
///
/// The synthesis engine is in-process, so the key has to be here rather than on
/// a server — and the Keychain is the only place on this machine that is meant
/// to hold one. Keys are lent to the engine per synthesizer, never written to
/// disk in the clear and never logged.
public enum ScoutSpeechCredentials {
    private static let service = "app.openscout.scout.speech"

    /// Notified when a key is stored or cleared, so a live synthesizer can
    /// rebuild around it instead of holding a stale one.
    public static let didChangeNotification = Notification.Name("scout.speech.credentialsDidChange")

    public static func key(for provider: HudSpeechProvider) -> String? {
        guard provider.requiresCredential else { return nil }
        var query = baseQuery(provider: provider)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty
        else { return nil }
        return value
    }

    @discardableResult
    public static func setKey(_ value: String?, for provider: HudSpeechProvider) -> Bool {
        guard provider.requiresCredential else { return false }
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if trimmed.isEmpty {
            let status = SecItemDelete(baseQuery(provider: provider) as CFDictionary)
            let removed = status == errSecSuccess || status == errSecItemNotFound
            if removed { announce() }
            return removed
        }

        let data = Data(trimmed.utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(baseQuery(provider: provider) as CFDictionary, update as CFDictionary)

        if status == errSecItemNotFound {
            var insert = baseQuery(provider: provider)
            insert[kSecValueData as String] = data
            // Available without unlocking on this device only — a reply spoken
            // at login shouldn't need a prompt, and the key never syncs.
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }

        let stored = status == errSecSuccess
        if stored { announce() }
        return stored
    }

    public static func hasKey(for provider: HudSpeechProvider) -> Bool {
        key(for: provider) != nil
    }

    /// Every key Scout holds, in the shape `HudSpeechSynthesizer` lends.
    public static func all() -> [HudSpeechProvider: String] {
        var found: [HudSpeechProvider: String] = [:]
        for provider in HudSpeechProvider.allCases where provider.requiresCredential {
            if let value = key(for: provider) { found[provider] = value }
        }
        return found
    }

    /// Last four characters, for showing that a key is present without showing
    /// the key.
    public static func preview(for provider: HudSpeechProvider) -> String? {
        guard let value = key(for: provider), value.count > 4 else { return nil }
        return "••••\(value.suffix(4))"
    }

    private static func baseQuery(provider: HudSpeechProvider) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: provider.rawValue,
        ]
    }

    private static func announce() {
        NotificationCenter.default.post(name: didChangeNotification, object: nil)
    }
}
