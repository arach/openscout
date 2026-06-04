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
    private static let keychainService = "com.openscout.scoutnext.terminal"
    private static let keychainAccount = "ssh.p256.v1"

    /// Load the persisted identity, generating + storing one on first use.
    static func loadOrCreate() -> P256.Signing.PrivateKey {
        if let raw = keychainRead(),
           let key = try? P256.Signing.PrivateKey(rawRepresentation: raw) {
            return key
        }
        let key = P256.Signing.PrivateKey()
        _ = keychainWrite(key.rawRepresentation)
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

    // MARK: - Keychain (generic password item)

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private static func keychainRead() -> Data? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    @discardableResult
    private static func keychainWrite(_ data: Data) -> Bool {
        SecItemDelete(baseQuery() as CFDictionary)
        var attributes = baseQuery()
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status != errSecSuccess {
            assertionFailure("Failed to store terminal SSH identity in Keychain: \(status)")
            return false
        }
        return true
    }
}
