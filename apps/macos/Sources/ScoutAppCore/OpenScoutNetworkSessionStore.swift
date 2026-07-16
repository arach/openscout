import Foundation
import LocalAuthentication
import os
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
    private static let cache = SessionTokenCache()
    private static let logger = Logger(
        subsystem: "app.openscout.scout",
        category: "network-keychain"
    )

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

    /// Loads the OSN session without allowing a background refresh to summon
    /// Keychain UI. User-initiated setup can opt in to authentication UI.
    public static func loadSessionToken(allowAuthenticationUI: Bool = false) -> String? {
        if let cached = cache.value() {
            if cached != nil || !allowAuthenticationUI {
                return cached
            }
        }

        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let authenticationContext = LAContext()
        authenticationContext.interactionNotAllowed = !allowAuthenticationUI
        query[kSecUseAuthenticationContext as String] = authenticationContext

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            cache.store(nil)
            logger.debug("OSN session is not present in Keychain")
            return nil
        }
        if status == errSecInteractionNotAllowed {
            logger.notice("OSN session needs Keychain authorization; background UI was suppressed")
            cache.store(nil)
            return nil
        }
        guard status == errSecSuccess else {
            // A denied Keychain prompt should not recur on every status poll.
            // A user-initiated authenticated read can bypass a cached miss;
            // a subsequent auth save also updates the cache.
            logger.error("OSN session Keychain load failed with status \(status, privacy: .public)")
            cache.store(nil)
            return nil
        }
        guard let data = item as? Data else {
            logger.error("OSN session Keychain result did not contain data")
            cache.store(nil)
            return nil
        }
        let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let result = token.isEmpty ? nil : token
        logger.debug("OSN session loaded from Keychain")
        cache.store(result)
        return result
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
        cache.store(trimmed)
    }

    public static func deleteSessionToken() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OpenScoutNetworkSessionError.deleteFailed(status)
        }
        cache.store(nil)
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

private final class SessionTokenCache: @unchecked Sendable {
    private let lock = NSLock()
    private var loaded = false
    private var token: String?

    /// The outer optional says whether Keychain has been queried; the inner
    /// optional is the cached presence/absence of a session.
    func value() -> String?? {
        lock.lock()
        defer { lock.unlock() }
        return loaded ? .some(token) : nil
    }

    func store(_ token: String?) {
        lock.lock()
        self.token = token
        loaded = true
        lock.unlock()
    }
}
