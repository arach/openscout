// TerminalKeychain - Secret boundary for Scout iOS terminal credentials.

import Foundation
import Security

struct ScoutTerminalCredential: Sendable {
    let reference: String
    let kind: ScoutTerminalCredentialKind
    let data: Data
}

enum ScoutTerminalKeychainError: Error, LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)
    case invalidString

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status): "Terminal credential save failed (OSStatus: \(status))"
        case .loadFailed(let status): "Terminal credential load failed (OSStatus: \(status))"
        case .deleteFailed(let status): "Terminal credential delete failed (OSStatus: \(status))"
        case .invalidString: "Terminal credential could not be decoded as UTF-8"
        }
    }
}

protocol ScoutTerminalCredentialVault: Sendable {
    func saveString(_ value: String, kind: ScoutTerminalCredentialKind, reference: String) throws
    func loadString(reference: String) throws -> String?
    func delete(reference: String) throws
}

struct ScoutTerminalKeychainVault: ScoutTerminalCredentialVault {
    static let shared = ScoutTerminalKeychainVault()

    private let service = "com.openscout.scout.terminal"

    func saveString(_ value: String, kind: ScoutTerminalCredentialKind, reference: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw ScoutTerminalKeychainError.invalidString
        }
        try save(data: data, kind: kind, reference: reference)
    }

    func loadString(reference: String) throws -> String? {
        guard let data = try load(reference: reference) else { return nil }
        guard let value = String(data: data, encoding: .utf8) else {
            throw ScoutTerminalKeychainError.invalidString
        }
        return value
    }

    func delete(reference: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: reference,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ScoutTerminalKeychainError.deleteFailed(status)
        }
    }

    private func save(data: Data, kind: ScoutTerminalCredentialKind, reference: String) throws {
        try delete(reference: reference)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: reference,
            kSecAttrLabel as String: kind.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw ScoutTerminalKeychainError.saveFailed(status)
        }
    }

    private func load(reference: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: reference,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw ScoutTerminalKeychainError.loadFailed(status)
        }
        return result as? Data
    }
}
