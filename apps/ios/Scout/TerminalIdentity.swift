import Foundation
import CryptoKit
import Security

/// A stable per-install SSH identity for the in-app Terminal.
///
/// Backed by a P256 key (`ecdsa-sha2-nistp256`) — chosen deliberately: CryptoKit
/// emits a PEM that Termini/NIOSSH parses directly (`P256.Signing.PrivateKey`),
/// so we sidestep the fiddly OpenSSH private-key binary framing entirely and
/// only have to serialize the *public* half to OpenSSH wire format ourselves.
///
/// The private key never leaves the device; only the OpenSSH public key line is
/// sent to the Mac to be appended to `authorized_keys`.
enum TerminalIdentity {
    private static let keychainService = "app.openscout.scout.terminal"
    private static let keychainAccount = "ssh.p256.v1"
    #if targetEnvironment(simulator)
    private static let simulatorDefaultsKey = "simulator.\(keychainService).\(keychainAccount)"
    #endif

    private enum StorageError: LocalizedError {
        case loadFailed(OSStatus)
        case deleteFailed(OSStatus)
        case saveFailed(OSStatus)

        var errorDescription: String? {
            switch self {
            case .loadFailed(let status):
                "Terminal identity could not be read from Keychain (OSStatus: \(status))."
            case .deleteFailed(let status):
                "Terminal identity could not be replaced in Keychain (OSStatus: \(status))."
            case .saveFailed(let status):
                "Terminal identity could not be stored in Keychain (OSStatus: \(status))."
            }
        }
    }

    /// Load the persisted identity, generating + storing one on first use.
    static func loadOrCreate() throws -> P256.Signing.PrivateKey {
        if let raw = try identityRead(),
           let key = try? P256.Signing.PrivateKey(rawRepresentation: raw) {
            return key
        }
        let key = P256.Signing.PrivateKey()
        try identityWrite(key.rawRepresentation)
        return key
    }

    /// OpenSSH single-line public key: `ecdsa-sha2-nistp256 <base64> <comment>`.
    static func opensshPublicKey(for key: P256.Signing.PrivateKey, comment: String) -> String {
        // x963 = 0x04 || X || Y (65 bytes), exactly the SSH ecdsa point encoding.
        let q = key.publicKey.x963Representation
        var blob = Data()
        blob.append(sshWireString(Data("ecdsa-sha2-nistp256".utf8)))
        blob.append(sshWireString(Data("nistp256".utf8)))
        blob.append(sshWireString(q))
        return "ecdsa-sha2-nistp256 \(blob.base64EncodedString()) \(comment)"
    }

    /// PEM Termini/NIOSSH parses via `P256.Signing.PrivateKey(pemRepresentation:)`.
    static func privateKeyPEM(for key: P256.Signing.PrivateKey) -> String {
        key.pemRepresentation
    }

    // MARK: - SSH wire helpers

    /// SSH string: `uint32` big-endian length prefix followed by the bytes.
    private static func sshWireString(_ payload: Data) -> Data {
        var out = Data()
        var length = UInt32(payload.count).bigEndian
        withUnsafeBytes(of: &length) { out.append(contentsOf: $0) }
        out.append(payload)
        return out
    }

    // MARK: - Persistence

    /// Device builds keep the private key in Keychain. Simulator builds use
    /// their app-scoped defaults container because recent simulator runtimes
    /// reject ad-hoc Keychain writes without the restricted access-group
    /// entitlement. This mirrors ScoutIdentity's storage boundary.

    #if !targetEnvironment(simulator)
    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }
    #endif

    private static func identityRead() throws -> Data? {
        #if targetEnvironment(simulator)
        return UserDefaults.standard.data(forKey: simulatorDefaultsKey)
        #else
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw StorageError.loadFailed(status) }
        return item as? Data
        #endif
    }

    private static func identityWrite(_ data: Data) throws {
        #if targetEnvironment(simulator)
        UserDefaults.standard.set(data, forKey: simulatorDefaultsKey)
        #else
        let deleteStatus = SecItemDelete(baseQuery() as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw StorageError.deleteFailed(deleteStatus)
        }
        var attributes = baseQuery()
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw StorageError.saveFailed(status) }
        #endif
    }
}
