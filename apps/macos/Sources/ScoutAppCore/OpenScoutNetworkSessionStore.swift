import Foundation
import Security

public enum OpenScoutNetworkSessionError: LocalizedError {
    case missingSession
    case invalidExpiration
    case expired
    case encodingFailed
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .missingSession:
            return "OpenScout Network auth callback did not include a session."
        case .invalidExpiration:
            return "OpenScout Network auth callback had an invalid expiration."
        case .expired:
            return "OpenScout Network auth callback was already expired."
        case .encodingFailed:
            return "Could not encode OpenScout Network session."
        case .saveFailed(let status):
            return "Could not save OpenScout Network session to Keychain (OSStatus \(status))."
        case .loadFailed(let status):
            return "Could not load OpenScout Network session from Keychain (OSStatus \(status))."
        case .deleteFailed(let status):
            return "Could not delete OpenScout Network session from Keychain (OSStatus \(status))."
        }
    }
}

public enum OpenScoutNetworkSessionStore {
    private static let service = "net.oscout.session"
    private static let account = "session"

    public static func saveSession(from callbackURL: URL, now: Date = Date()) throws {
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "scout"
        else {
            throw OpenScoutNetworkSessionError.missingSession
        }

        let host = components.host?.lowercased()
        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        guard host == "osn-auth" || path == "osn-auth" else {
            throw OpenScoutNetworkSessionError.missingSession
        }

        let items = components.queryItems ?? []
        func value(_ key: String) -> String? {
            items.first { $0.name == key }?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        guard let session = value("session"), !session.isEmpty else {
            throw OpenScoutNetworkSessionError.missingSession
        }
        guard let expiresAtRaw = value("expires_at"),
              let expiresAtMs = Double(expiresAtRaw)
        else {
            throw OpenScoutNetworkSessionError.invalidExpiration
        }

        let expiresAt = Date(timeIntervalSince1970: expiresAtMs / 1_000)
        guard expiresAt > now else {
            throw OpenScoutNetworkSessionError.expired
        }

        try saveSessionToken(session)
    }

    public static func loadSessionToken() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            return nil
        }
        guard let data = item as? Data else {
            return nil
        }
        let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return token.isEmpty ? nil : token
    }

    public static func saveSessionToken(_ token: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8), !trimmed.isEmpty else {
            throw OpenScoutNetworkSessionError.encodingFailed
        }

        try deleteSessionToken()

        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw OpenScoutNetworkSessionError.saveFailed(status)
        }
    }

    public static func deleteSessionToken() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OpenScoutNetworkSessionError.deleteFailed(status)
        }
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
