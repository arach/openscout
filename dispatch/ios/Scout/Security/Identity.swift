// Identity — Keychain-based identity persistence for Dispatch iOS.
//
// Manages the phone's static X25519 key pair and trusted bridge records.
// All sensitive data is stored in the iOS Keychain -- never in UserDefaults or files.
//
// Reference: src/security/identity.ts (bridge-side equivalent using filesystem)

import CryptoKit
import Foundation
import Security

// MARK: - Trusted bridge record

struct TrustedBridge: Codable, Sendable, Identifiable {
    let publicKey: Data      // 32 bytes (raw X25519 public key)
    var name: String?
    let pairedAt: Date
    var lastSeen: Date?

    var id: Data { publicKey }

    /// Hex representation of the public key (for display and matching).
    var publicKeyHex: String {
        publicKey.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - DispatchIdentity

/// Manages the phone's long-lived identity and trusted bridge records.
///
/// Invariants:
///   - The static key pair is persisted in the iOS Keychain.
///   - Trusted bridge records are persisted in the iOS Keychain.
///   - No sensitive data is stored outside the Keychain.
final class DispatchIdentity: Sendable {

    // Keychain service identifiers
    private static let service = "com.openscout.scout.identity"
    private static let staticKeyAccount = "static-key-private"
    private static let trustedBridgesAccount = "trusted-bridges"

    // MARK: - Static key pair

    /// Load the existing static key pair from Keychain, or generate and save a new one.
    static func loadOrCreateIdentity() throws -> NoiseKeyPair {
        if let existing = try loadStaticKey() {
            return existing
        }
        let keyPair = generateNoiseKeyPair()
        try saveStaticKey(keyPair)
        return keyPair
    }

    /// Load the static key pair from Keychain. Returns nil if not found.
    private static func loadStaticKey() throws -> NoiseKeyPair? {
        guard let privateKeyData = try keychainLoad(
            service: service,
            account: staticKeyAccount
        ) else {
            return nil
        }
        return try noiseKeyPairFrom(privateKeyData: privateKeyData)
    }

    /// Save a static key pair to Keychain.
    private static func saveStaticKey(_ keyPair: NoiseKeyPair) throws {
        let privateKeyData = keyPair.privateKey.rawRepresentation
        try keychainSave(
            service: service,
            account: staticKeyAccount,
            data: Data(privateKeyData)
        )
    }

    /// Delete the static key pair from Keychain (for testing or key rotation).
    static func deleteIdentity() throws {
        try keychainDelete(service: service, account: staticKeyAccount)
    }

    // MARK: - Trusted bridges

    /// Save a bridge as trusted after a successful handshake.
    static func saveTrustedBridge(publicKey: Data, name: String? = nil) throws {
        var bridges = try getTrustedBridges()

        // Update existing or add new.
        if let index = bridges.firstIndex(where: { $0.publicKey == publicKey }) {
            bridges[index].lastSeen = Date()
            if let name { bridges[index].name = name }
        } else {
            let bridge = TrustedBridge(
                publicKey: publicKey,
                name: name,
                pairedAt: Date(),
                lastSeen: Date()
            )
            bridges.append(bridge)
        }

        try saveTrustedBridges(bridges)
    }

    /// Check whether a bridge with the given public key is trusted.
    static func isTrustedBridge(publicKey: Data) -> Bool {
        guard let bridges = try? getTrustedBridges() else { return false }
        return bridges.contains { $0.publicKey == publicKey }
    }

    /// Get all trusted bridge records.
    static func getTrustedBridges() throws -> [TrustedBridge] {
        guard let data = try keychainLoad(
            service: service,
            account: trustedBridgesAccount
        ) else {
            return []
        }
        return try JSONDecoder().decode([TrustedBridge].self, from: data)
    }

    /// Update the lastSeen timestamp for a trusted bridge.
    static func touchTrustedBridge(publicKey: Data) throws {
        var bridges = try getTrustedBridges()
        if let index = bridges.firstIndex(where: { $0.publicKey == publicKey }) {
            bridges[index].lastSeen = Date()
            try saveTrustedBridges(bridges)
        }
    }

    /// Remove a trusted bridge (for re-pairing).
    static func removeTrustedBridge(publicKey: Data) throws {
        var bridges = try getTrustedBridges()
        bridges.removeAll { $0.publicKey == publicKey }
        try saveTrustedBridges(bridges)
    }

    /// Remove all trusted bridges.
    static func removeAllTrustedBridges() throws {
        try keychainDelete(service: service, account: trustedBridgesAccount)
    }

    // MARK: - Private helpers

    private static func saveTrustedBridges(_ bridges: [TrustedBridge]) throws {
        let data = try JSONEncoder().encode(bridges)
        try keychainSave(
            service: service,
            account: trustedBridgesAccount,
            data: data
        )
    }
}

// MARK: - Keychain Operations

private func keychainSave(service: String, account: String, data: Data) throws {
    // Delete any existing item first.
    let deleteQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    // Add the new item.
    let addQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(addQuery as CFDictionary, nil)
    guard status == errSecSuccess else {
        throw KeychainError.saveFailed(status)
    }
}

private func keychainLoad(service: String, account: String) throws -> Data? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecItemNotFound {
        return nil
    }
    guard status == errSecSuccess else {
        throw KeychainError.loadFailed(status)
    }
    return result as? Data
}

private func keychainDelete(service: String, account: String) throws {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        throw KeychainError.deleteFailed(status)
    }
}

enum KeychainError: Error, LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status): "Keychain save failed (OSStatus: \(status))"
        case .loadFailed(let status): "Keychain load failed (OSStatus: \(status))"
        case .deleteFailed(let status): "Keychain delete failed (OSStatus: \(status))"
        }
    }
}
