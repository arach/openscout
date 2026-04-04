// NoiseProtocol — Noise Protocol Framework implementation for Dispatch iOS.
//
// Wire-compatible with the TypeScript bridge at src/security/noise.ts.
//
// Cipher suite: Noise_XX_25519_AESGCM_SHA256 / Noise_IK_25519_AESGCM_SHA256
//
// CryptoKit primitives used:
//   - Curve25519.KeyAgreement (X25519 DH)
//   - AES.GCM (AES-256-GCM)
//   - SHA256
//   - HKDF<SHA256>

import CryptoKit
import Foundation

// MARK: - Types

struct NoiseKeyPair: Sendable {
    let publicKey: Data   // 32 bytes
    let privateKey: Curve25519.KeyAgreement.PrivateKey
}

enum NoiseRole: Sendable {
    case initiator
    case responder
}

enum HandshakePattern: String, Sendable {
    case XX
    case IK
}

/// The result of a completed Noise handshake.
struct NoiseSession: Sendable {
    fileprivate let sendCipher: CipherState
    fileprivate let recvCipher: CipherState

    /// The remote peer's static public key (authenticated during handshake).
    let remoteStaticKey: Data

    /// The handshake hash -- unique channel binding value.
    let handshakeHash: Data

    func encrypt(_ plaintext: Data) -> Data {
        sendCipher.encryptWithAd(ad: Data(), plaintext: plaintext)
    }

    func decrypt(_ ciphertext: Data) throws -> Data {
        try recvCipher.decryptWithAd(ad: Data(), ciphertext: ciphertext)
    }
}

// MARK: - Constants

private let DHLEN = 32
private let HASHLEN = 32
private let TAGLEN = 16
private let MAX_NONCE: UInt64 = UInt64.max

// MARK: - Key generation

func generateNoiseKeyPair() -> NoiseKeyPair {
    let privateKey = Curve25519.KeyAgreement.PrivateKey()
    let publicKey = Data(privateKey.publicKey.rawRepresentation)
    return NoiseKeyPair(publicKey: publicKey, privateKey: privateKey)
}

func noiseKeyPairFrom(privateKeyData: Data) throws -> NoiseKeyPair {
    let privateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKeyData)
    let publicKey = Data(privateKey.publicKey.rawRepresentation)
    return NoiseKeyPair(publicKey: publicKey, privateKey: privateKey)
}

/// X25519 Diffie-Hellman key agreement.
private func noiseDH(
    privateKey: Curve25519.KeyAgreement.PrivateKey,
    publicKey: Data
) throws -> Data {
    let remotePublic = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey)
    let shared = try privateKey.sharedSecretFromKeyAgreement(with: remotePublic)
    // SharedSecret -> raw bytes via HKDF with no salt/info is wrong;
    // we need the raw shared secret bytes. Use withUnsafeBytes to extract.
    return shared.withUnsafeBytes { Data($0) }
}

// MARK: - CipherState

/// Symmetric encryption with nonce counter.
/// Matches the TypeScript CipherState class in noise.ts exactly.
final class CipherState: @unchecked Sendable {
    private var key: SymmetricKey?
    private var nonce: UInt64 = 0

    init(key: SymmetricKey? = nil) {
        self.key = key
    }

    var hasKey: Bool { key != nil }

    /// Encrypt plaintext with associated data.
    /// If no key is set, returns plaintext unchanged (per Noise spec).
    func encryptWithAd(ad: Data, plaintext: Data) -> Data {
        guard let key else { return plaintext }
        precondition(nonce < MAX_NONCE, "Noise: nonce exhausted")

        let nonceData = nonceBytes()
        let aesNonce = try! AES.GCM.Nonce(data: nonceData)
        let sealed = try! AES.GCM.seal(
            plaintext,
            using: key,
            nonce: aesNonce,
            authenticating: ad
        )
        nonce += 1
        // AES.GCM.seal returns ciphertext + tag. We need them concatenated.
        return sealed.ciphertext + sealed.tag
    }

    /// Decrypt ciphertext with associated data.
    /// If no key is set, returns ciphertext unchanged (per Noise spec).
    func decryptWithAd(ad: Data, ciphertext: Data) throws -> Data {
        guard let key else { return ciphertext }
        precondition(nonce < MAX_NONCE, "Noise: nonce exhausted")

        let nonceData = nonceBytes()
        let aesNonce = try AES.GCM.Nonce(data: nonceData)

        // Split ciphertext into body + tag (last 16 bytes).
        guard ciphertext.count >= TAGLEN else {
            throw NoiseError.decryptionFailed("ciphertext too short")
        }
        let body = ciphertext.prefix(ciphertext.count - TAGLEN)
        let tag = ciphertext.suffix(TAGLEN)

        let sealedBox = try AES.GCM.SealedBox(
            nonce: aesNonce,
            ciphertext: body,
            tag: tag
        )
        let plaintext = try AES.GCM.open(sealedBox, using: key, authenticating: ad)
        nonce += 1
        return plaintext
    }

    /// Noise spec nonce: 4 zero bytes + 8-byte little-endian counter = 12 bytes.
    /// Matches the TypeScript implementation exactly.
    private func nonceBytes() -> Data {
        var buf = Data(count: 12)
        // Bytes 0-3: 0x00 (already zero from Data(count:))
        // Bytes 4-11: counter as little-endian UInt64
        let lo = UInt32(nonce & 0xFFFFFFFF)
        let hi = UInt32(nonce >> 32)
        buf.replaceSubrange(4..<8, with: withUnsafeBytes(of: lo.littleEndian) { Data($0) })
        buf.replaceSubrange(8..<12, with: withUnsafeBytes(of: hi.littleEndian) { Data($0) })
        return buf
    }
}

// MARK: - SymmetricState

/// Handshake hash and chaining key management.
/// Matches the TypeScript SymmetricState class in noise.ts.
final class SymmetricState: @unchecked Sendable {
    private var ck: Data    // chaining key
    private var h: Data     // handshake hash
    fileprivate var cipher: CipherState

    init(protocolName: String) {
        let nameBytes = Data(protocolName.utf8)
        if nameBytes.count <= HASHLEN {
            // Pad with zeros to HASHLEN.
            var padded = Data(count: HASHLEN)
            padded.replaceSubrange(0..<nameBytes.count, with: nameBytes)
            self.h = padded
        } else {
            self.h = Data(SHA256.hash(data: nameBytes))
        }
        self.ck = Data(self.h)
        self.cipher = CipherState()
    }

    var handshakeHash: Data { Data(h) }

    /// Mix a DH result into the chaining key and derive a new CipherState.
    func mixKey(_ inputKeyMaterial: Data) {
        // HKDF: extract with salt=ck, ikm=inputKeyMaterial, then expand with info=empty, length=64
        let output = noiseHKDF(salt: ck, ikm: inputKeyMaterial, info: Data(), length: 64)
        ck = output.prefix(32)
        let tempK = output.suffix(32)
        cipher = CipherState(key: SymmetricKey(data: tempK))
    }

    /// Mix data into the handshake hash.
    func mixHash(_ data: Data) {
        h = Data(SHA256.hash(data: h + data))
    }

    /// Encrypt plaintext, using h as associated data, then mix ciphertext into h.
    func encryptAndHash(_ plaintext: Data) -> Data {
        let ciphertext = cipher.encryptWithAd(ad: h, plaintext: plaintext)
        mixHash(ciphertext)
        return ciphertext
    }

    /// Decrypt ciphertext, using h as associated data, then mix ciphertext into h.
    func decryptAndHash(_ ciphertext: Data) throws -> Data {
        let plaintext = try cipher.decryptWithAd(ad: h, ciphertext: ciphertext)
        mixHash(ciphertext)
        return plaintext
    }

    /// Split into two CipherStates for transport (initiator->responder, responder->initiator).
    func split() -> (CipherState, CipherState) {
        // HKDF: extract with salt=ck, ikm=empty, then expand with info=empty, length=64
        let output = noiseHKDF(salt: ck, ikm: Data(), info: Data(), length: 64)
        let k1 = output.prefix(32)
        let k2 = output.suffix(32)
        return (
            CipherState(key: SymmetricKey(data: k1)),
            CipherState(key: SymmetricKey(data: k2))
        )
    }
}

// MARK: - HKDF helper

/// HKDF matching the noble/hashes implementation used in noise.ts.
///
/// The noble hkdf call is: `hkdf(sha256, ikm, salt, info, length)`
/// which does: `expand(sha256, extract(sha256, ikm, salt), info, length)`
///
/// CryptoKit's HKDF<SHA256> uses the same RFC 5869 definitions.
private func noiseHKDF(salt: Data, ikm: Data, info: Data, length: Int) -> Data {
    // We use CryptoKit's HKDF but need raw bytes output, not a SymmetricKey.
    // HKDF<SHA256>.deriveKey gives us a SymmetricKey of the requested size.
    let derived = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: ikm),
        salt: salt,
        info: info,
        outputByteCount: length
    )
    return derived.withUnsafeBytes { Data($0) }
}

// MARK: - Pattern definitions

/// Noise pattern definitions matching the PATTERNS constant in noise.ts.
private struct PatternDef {
    let pre: [[String]]
    let messages: [[String]]
}

private let patterns: [HandshakePattern: PatternDef] = [
    .XX: PatternDef(
        pre: [],
        messages: [
            ["e"],                    // -> e
            ["e", "ee", "s", "es"],  // <- e, ee, s, es
            ["s", "se"],             // -> s, se
        ]
    ),
    .IK: PatternDef(
        pre: [[], ["s"]],            // pre: initiator=[], responder=[s]
        messages: [
            ["e", "es", "s", "ss"],  // -> e, es, s, ss
            ["e", "ee", "se"],       // <- e, ee, se
        ]
    ),
]

// MARK: - HandshakeState

/// Executes a Noise handshake pattern.
/// Wire-compatible with the TypeScript NoiseHandshake class in noise.ts.
final class NoiseHandshake: @unchecked Sendable {
    private let ss: SymmetricState
    private let s: NoiseKeyPair                      // local static
    private var e: NoiseKeyPair?                      // local ephemeral
    private var rs: Data?                             // remote static public
    private var re: Data?                             // remote ephemeral public
    private let role: NoiseRole
    private let pattern: [[String]]
    private var messageIndex = 0

    /// Create a handshake state.
    ///
    /// - Parameters:
    ///   - pattern: XX or IK
    ///   - role: initiator or responder
    ///   - staticKey: local static key pair
    ///   - remoteStaticKey: remote static public key (required for IK initiator)
    init(
        pattern: HandshakePattern,
        role: NoiseRole,
        staticKey: NoiseKeyPair,
        remoteStaticKey: Data? = nil
    ) {
        let protocolName = "Noise_\(pattern.rawValue)_25519_AESGCM_SHA256"
        self.ss = SymmetricState(protocolName: protocolName)
        self.s = staticKey
        self.role = role

        let patternDef = patterns[pattern]!
        self.pattern = patternDef.messages

        // Process pre-messages -- mix known static keys into the hash.
        let pre = patternDef.pre
        if !pre.isEmpty {
            // pre[0] = initiator pre-message tokens, pre[1] = responder pre-message tokens
            if pre.count > 0 {
                for token in pre[0] {
                    if token == "s" {
                        let key: Data
                        if role == .initiator {
                            key = staticKey.publicKey
                        } else {
                            guard let rsk = remoteStaticKey else {
                                fatalError("Noise: missing initiator static key for pre-message")
                            }
                            key = rsk
                            self.rs = key
                        }
                        ss.mixHash(key)
                    }
                }
            }
            if pre.count > 1 {
                for token in pre[1] {
                    if token == "s" {
                        let key: Data
                        if role == .responder {
                            key = staticKey.publicKey
                        } else {
                            guard let rsk = remoteStaticKey else {
                                fatalError("Noise: missing responder static key for pre-message (IK requires it)")
                            }
                            key = rsk
                            self.rs = key
                        }
                        ss.mixHash(key)
                    }
                }
            }
        }

        // Store remoteStaticKey if provided but not yet assigned via pre-messages.
        if let remoteStaticKey, self.rs == nil {
            self.rs = remoteStaticKey
        }
    }

    /// True when it's our turn to send the next message.
    var isMySend: Bool {
        // Message 0 is initiator's send, message 1 is responder's send, etc.
        let senderIsInitiator = messageIndex % 2 == 0
        return (role == .initiator) == senderIsInitiator
    }

    /// True when the handshake is complete (all messages exchanged).
    var isComplete: Bool {
        messageIndex >= pattern.count
    }

    /// Write the next handshake message (our turn to send).
    /// Returns the message bytes to transmit.
    func writeMessage(payload: Data = Data()) throws -> Data {
        guard isMySend else { throw NoiseError.notOurTurn }
        guard !isComplete else { throw NoiseError.handshakeComplete }

        let tokens = pattern[messageIndex]
        var parts: [Data] = []

        for token in tokens {
            switch token {
            case "e":
                let ephemeral = generateNoiseKeyPair()
                self.e = ephemeral
                parts.append(ephemeral.publicKey)
                ss.mixHash(ephemeral.publicKey)

            case "s":
                let encrypted = ss.encryptAndHash(s.publicKey)
                parts.append(encrypted)

            default:
                // DH tokens: ee, es, se, ss
                try performDH(token)
            }
        }

        // Encrypt and append payload (possibly empty).
        parts.append(ss.encryptAndHash(payload))

        messageIndex += 1
        return concat(parts)
    }

    /// Read an incoming handshake message (their turn to send).
    /// Returns any decrypted payload.
    func readMessage(_ message: Data) throws -> Data {
        guard !isMySend else { throw NoiseError.notTheirTurn }
        guard !isComplete else { throw NoiseError.handshakeComplete }

        let tokens = pattern[messageIndex]
        var offset = 0

        for token in tokens {
            switch token {
            case "e":
                guard offset + DHLEN <= message.count else {
                    throw NoiseError.messageTooShort
                }
                re = message.subdata(in: offset..<(offset + DHLEN))
                offset += DHLEN
                ss.mixHash(re!)

            case "s":
                // If the cipher has a key, the static key is encrypted (+ 16 byte tag).
                let len = ss.cipher.hasKey ? DHLEN + TAGLEN : DHLEN
                guard offset + len <= message.count else {
                    throw NoiseError.messageTooShort
                }
                let temp = message.subdata(in: offset..<(offset + len))
                offset += len
                rs = try ss.decryptAndHash(temp)

            default:
                try performDH(token)
            }
        }

        // Remaining bytes are the encrypted payload.
        let remaining = message.subdata(in: offset..<message.count)
        let payload = try ss.decryptAndHash(remaining)

        messageIndex += 1
        return payload
    }

    /// After the handshake is complete, split into transport cipher states.
    func finalize() throws -> NoiseSession {
        guard isComplete else { throw NoiseError.handshakeNotComplete }
        guard let rs else { throw NoiseError.missingRemoteStaticKey }

        let (c1, c2) = ss.split()
        let handshakeHash = ss.handshakeHash

        // c1 is initiator->responder, c2 is responder->initiator.
        let (sendCipher, recvCipher) = role == .initiator ? (c1, c2) : (c2, c1)

        return NoiseSession(
            sendCipher: sendCipher,
            recvCipher: recvCipher,
            remoteStaticKey: Data(rs),
            handshakeHash: handshakeHash
        )
    }

    // MARK: - DH token processing

    /// Perform a Diffie-Hellman operation for the given token.
    ///
    /// Token letters: first = initiator's key type, second = responder's key type.
    /// Each side uses its own private key + the remote public key of the matching type.
    private func performDH(_ token: String) throws {
        let chars = Array(token)
        guard chars.count == 2 else { throw NoiseError.invalidToken(token) }

        let initiatorKeyType = chars[0] // "e" or "s"
        let responderKeyType = chars[1] // "e" or "s"

        let isInitiator = role == .initiator
        let myType: Character = isInitiator ? initiatorKeyType : responderKeyType
        let theirType: Character = isInitiator ? responderKeyType : initiatorKeyType

        let myPrivate: Curve25519.KeyAgreement.PrivateKey
        switch myType {
        case "e":
            guard let ephemeral = e else {
                throw NoiseError.missingKey("local ephemeral for DH(\(token))")
            }
            myPrivate = ephemeral.privateKey
        case "s":
            myPrivate = s.privateKey
        default:
            throw NoiseError.invalidToken(token)
        }

        let theirPublic: Data
        switch theirType {
        case "e":
            guard let remoteEphemeral = re else {
                throw NoiseError.missingKey("remote ephemeral for DH(\(token))")
            }
            theirPublic = remoteEphemeral
        case "s":
            guard let remoteStatic = rs else {
                throw NoiseError.missingKey("remote static for DH(\(token))")
            }
            theirPublic = remoteStatic
        default:
            throw NoiseError.invalidToken(token)
        }

        let dhResult = try noiseDH(privateKey: myPrivate, publicKey: theirPublic)
        ss.mixKey(dhResult)
    }
}

// MARK: - Errors

enum NoiseError: Error, LocalizedError {
    case notOurTurn
    case notTheirTurn
    case handshakeComplete
    case handshakeNotComplete
    case missingRemoteStaticKey
    case missingKey(String)
    case invalidToken(String)
    case messageTooShort
    case decryptionFailed(String)

    var errorDescription: String? {
        switch self {
        case .notOurTurn: "Noise: not our turn to send"
        case .notTheirTurn: "Noise: not our turn to receive"
        case .handshakeComplete: "Noise: handshake already complete"
        case .handshakeNotComplete: "Noise: handshake not complete"
        case .missingRemoteStaticKey: "Noise: remote static key not established"
        case .missingKey(let detail): "Noise: missing \(detail)"
        case .invalidToken(let token): "Noise: invalid DH token '\(token)'"
        case .messageTooShort: "Noise: message too short"
        case .decryptionFailed(let reason): "Noise: decryption failed - \(reason)"
        }
    }
}

// MARK: - Helpers

private func concat(_ arrays: [Data]) -> Data {
    var result = Data(capacity: arrays.reduce(0) { $0 + $1.count })
    for array in arrays {
        result.append(array)
    }
    return result
}
