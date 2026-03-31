// NoiseProtocolTests — Verifies the Noise Protocol implementation.
//
// Tests cover:
//   - Key pair generation
//   - CipherState encrypt/decrypt roundtrip
//   - Nonce construction matches TS format
//   - XX handshake between two Swift instances
//   - IK handshake between two Swift instances
//   - Channel binding (handshake hash consistency)
//   - Nonce increment (non-replayability)
//
// These tests mirror the TypeScript tests in src/security/noise.test.ts.

import CryptoKit
import Foundation
import XCTest

@testable import Plexus

final class NoiseProtocolTests: XCTestCase {

    // MARK: - Key pair generation

    func testKeyPairGeneration() {
        let kp = generateNoiseKeyPair()
        XCTAssertEqual(kp.publicKey.count, 32, "Public key must be 32 bytes")
        XCTAssertEqual(kp.privateKey.rawRepresentation.count, 32, "Private key must be 32 bytes")
    }

    func testKeyPairUniqueness() {
        let kp1 = generateNoiseKeyPair()
        let kp2 = generateNoiseKeyPair()
        XCTAssertNotEqual(kp1.publicKey, kp2.publicKey, "Two key pairs should have different public keys")
    }

    func testKeyPairRoundtrip() throws {
        let kp = generateNoiseKeyPair()
        let privateData = Data(kp.privateKey.rawRepresentation)
        let restored = try noiseKeyPairFrom(privateKeyData: privateData)
        XCTAssertEqual(kp.publicKey, restored.publicKey, "Restored key pair should have same public key")
    }

    // MARK: - CipherState

    func testCipherStateNoKey() {
        let cipher = CipherState()
        XCTAssertFalse(cipher.hasKey)

        let plaintext = Data("hello".utf8)
        let ad = Data()

        // Without a key, encrypt returns plaintext unchanged.
        let encrypted = cipher.encryptWithAd(ad: ad, plaintext: plaintext)
        XCTAssertEqual(encrypted, plaintext)

        // Without a key, decrypt returns ciphertext unchanged.
        let decrypted = try! cipher.decryptWithAd(ad: ad, ciphertext: plaintext)
        XCTAssertEqual(decrypted, plaintext)
    }

    func testCipherStateEncryptDecryptRoundtrip() throws {
        // Create a random 32-byte key.
        let keyData = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let encCipher = CipherState(key: SymmetricKey(data: keyData))
        let decCipher = CipherState(key: SymmetricKey(data: keyData))

        XCTAssertTrue(encCipher.hasKey)
        XCTAssertTrue(decCipher.hasKey)

        let plaintext = Data("test message".utf8)
        let ad = Data("associated data".utf8)

        let ciphertext = encCipher.encryptWithAd(ad: ad, plaintext: plaintext)
        // Ciphertext should be plaintext + 16 byte tag.
        XCTAssertEqual(ciphertext.count, plaintext.count + 16)
        XCTAssertNotEqual(ciphertext.prefix(plaintext.count), plaintext)

        let decrypted = try decCipher.decryptWithAd(ad: ad, ciphertext: ciphertext)
        XCTAssertEqual(decrypted, plaintext)
    }

    func testCipherStateNonceIncrement() throws {
        let keyData = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let encCipher = CipherState(key: SymmetricKey(data: keyData))
        let decCipher = CipherState(key: SymmetricKey(data: keyData))

        let plaintext = Data("same message".utf8)
        let ad = Data()

        let ct1 = encCipher.encryptWithAd(ad: ad, plaintext: plaintext)
        let ct2 = encCipher.encryptWithAd(ad: ad, plaintext: plaintext)

        // Same plaintext, different ciphertext (nonce changed).
        XCTAssertNotEqual(ct1, ct2)

        // Both decrypt correctly in order.
        let dec1 = try decCipher.decryptWithAd(ad: ad, ciphertext: ct1)
        let dec2 = try decCipher.decryptWithAd(ad: ad, ciphertext: ct2)
        XCTAssertEqual(dec1, plaintext)
        XCTAssertEqual(dec2, plaintext)
    }

    // MARK: - Nonce construction

    func testNonceFormat() {
        // Verify the nonce format matches the TS implementation:
        // bytes 0-3: 0x00 0x00 0x00 0x00
        // bytes 4-11: counter as little-endian uint64
        //
        // We test this by creating a CipherState and encrypting with a known key,
        // then verifying we can decrypt with a manually constructed nonce.
        let keyData = Data(repeating: 0xAB, count: 32)
        let key = SymmetricKey(data: keyData)

        // Nonce 0: all zeros (4 zero + 8 zero)
        let nonce0 = Data(count: 12)
        XCTAssertEqual(nonce0, Data([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))

        // Nonce 1: 4 zeros + [1, 0, 0, 0, 0, 0, 0, 0] (little-endian)
        var nonce1 = Data(count: 12)
        nonce1[4] = 1
        XCTAssertEqual(nonce1, Data([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]))

        // Nonce 256: 4 zeros + [0, 1, 0, 0, 0, 0, 0, 0]
        var nonce256 = Data(count: 12)
        nonce256[4] = 0
        nonce256[5] = 1
        XCTAssertEqual(nonce256, Data([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]))

        // Encrypt with CipherState at nonce 0, decrypt manually with AES.GCM nonce 0.
        let cipher = CipherState(key: key)
        let plaintext = Data("nonce test".utf8)
        let ad = Data()
        let ciphertext = cipher.encryptWithAd(ad: ad, plaintext: plaintext)

        // Manual decrypt with nonce 0.
        let aesNonce = try! AES.GCM.Nonce(data: nonce0)
        let body = ciphertext.prefix(ciphertext.count - 16)
        let tag = ciphertext.suffix(16)
        let sealedBox = try! AES.GCM.SealedBox(nonce: aesNonce, ciphertext: body, tag: tag)
        let decrypted = try! AES.GCM.open(sealedBox, using: key, authenticating: ad)
        XCTAssertEqual(Data(decrypted), plaintext)
    }

    // MARK: - XX handshake

    func testXXHandshakeMutualAuthentication() throws {
        let aliceStatic = generateNoiseKeyPair()
        let bobStatic = generateNoiseKeyPair()

        let alice = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: aliceStatic)
        let bob = NoiseHandshake(pattern: .XX, role: .responder, staticKey: bobStatic)

        // Message 1: Alice -> Bob (-> e)
        XCTAssertTrue(alice.isMySend)
        XCTAssertFalse(bob.isMySend)
        let msg1 = try alice.writeMessage()
        let payload1 = try bob.readMessage(msg1)
        XCTAssertEqual(payload1.count, 0)

        // Message 2: Bob -> Alice (<- e, ee, s, es)
        XCTAssertTrue(bob.isMySend)
        XCTAssertFalse(alice.isMySend)
        let msg2 = try bob.writeMessage()
        let payload2 = try alice.readMessage(msg2)
        XCTAssertEqual(payload2.count, 0)

        // Message 3: Alice -> Bob (-> s, se)
        XCTAssertTrue(alice.isMySend)
        XCTAssertFalse(bob.isMySend)
        let msg3 = try alice.writeMessage(payload: Data("hello from alice".utf8))
        let payload3 = try bob.readMessage(msg3)
        XCTAssertEqual(String(data: payload3, encoding: .utf8), "hello from alice")

        // Both sides complete.
        XCTAssertTrue(alice.isComplete)
        XCTAssertTrue(bob.isComplete)

        // Finalize into transport sessions.
        let aliceSession = try alice.finalize()
        let bobSession = try bob.finalize()

        // Both learned each other's static keys.
        XCTAssertEqual(aliceSession.remoteStaticKey, bobStatic.publicKey)
        XCTAssertEqual(bobSession.remoteStaticKey, aliceStatic.publicKey)

        // Handshake hashes match (channel binding).
        XCTAssertEqual(aliceSession.handshakeHash, bobSession.handshakeHash)

        // Encrypted transport: Alice -> Bob.
        let plaintext = Data(#"{"method":"prompt/send","params":{}}"#.utf8)
        let ciphertext = aliceSession.encrypt(plaintext)
        XCTAssertNotEqual(ciphertext, plaintext)
        let decrypted = try bobSession.decrypt(ciphertext)
        XCTAssertEqual(decrypted, plaintext)

        // Encrypted transport: Bob -> Alice.
        let response = Data(#"{"event":"turn:start"}"#.utf8)
        let encResponse = bobSession.encrypt(response)
        let decResponse = try aliceSession.decrypt(encResponse)
        XCTAssertEqual(decResponse, response)
    }

    func testXXHandshakeEmptyPayloads() throws {
        let alice = NoiseHandshake(
            pattern: .XX, role: .initiator, staticKey: generateNoiseKeyPair()
        )
        let bob = NoiseHandshake(
            pattern: .XX, role: .responder, staticKey: generateNoiseKeyPair()
        )

        // All three messages with empty payloads.
        let msg1 = try alice.writeMessage()
        _ = try bob.readMessage(msg1)

        let msg2 = try bob.writeMessage()
        _ = try alice.readMessage(msg2)

        let msg3 = try alice.writeMessage()
        _ = try bob.readMessage(msg3)

        XCTAssertTrue(alice.isComplete)
        XCTAssertTrue(bob.isComplete)

        let sa = try alice.finalize()
        let sb = try bob.finalize()

        // Bidirectional transport works.
        let msg = Data("test".utf8)
        XCTAssertEqual(try sb.decrypt(sa.encrypt(msg)), msg)
        XCTAssertEqual(try sa.decrypt(sb.encrypt(msg)), msg)
    }

    // MARK: - IK handshake

    func testIKHandshakeTrustedReconnect() throws {
        let phoneStatic = generateNoiseKeyPair()
        let bridgeStatic = generateNoiseKeyPair()

        // Phone already knows the bridge's public key from previous pairing.
        let phone = NoiseHandshake(
            pattern: .IK,
            role: .initiator,
            staticKey: phoneStatic,
            remoteStaticKey: bridgeStatic.publicKey
        )
        let bridge = NoiseHandshake(
            pattern: .IK,
            role: .responder,
            staticKey: bridgeStatic
        )

        // Message 1: Phone -> Bridge (-> e, es, s, ss)
        XCTAssertTrue(phone.isMySend)
        let msg1 = try phone.writeMessage()
        _ = try bridge.readMessage(msg1)

        // Message 2: Bridge -> Phone (<- e, ee, se)
        XCTAssertTrue(bridge.isMySend)
        let msg2 = try bridge.writeMessage(payload: Data("welcome back".utf8))
        let payload = try phone.readMessage(msg2)
        XCTAssertEqual(String(data: payload, encoding: .utf8), "welcome back")

        XCTAssertTrue(phone.isComplete)
        XCTAssertTrue(bridge.isComplete)

        let phoneSession = try phone.finalize()
        let bridgeSession = try bridge.finalize()

        // Mutual key knowledge.
        XCTAssertEqual(phoneSession.remoteStaticKey, bridgeStatic.publicKey)
        XCTAssertEqual(bridgeSession.remoteStaticKey, phoneStatic.publicKey)

        // Channel binding.
        XCTAssertEqual(phoneSession.handshakeHash, bridgeSession.handshakeHash)

        // Bidirectional encrypted transport.
        let msg = Data("test".utf8)
        XCTAssertEqual(try bridgeSession.decrypt(phoneSession.encrypt(msg)), msg)
        XCTAssertEqual(try phoneSession.decrypt(bridgeSession.encrypt(msg)), msg)
    }

    func testIKHandshakeEmptyPayloads() throws {
        let phoneStatic = generateNoiseKeyPair()
        let bridgeStatic = generateNoiseKeyPair()

        let phone = NoiseHandshake(
            pattern: .IK,
            role: .initiator,
            staticKey: phoneStatic,
            remoteStaticKey: bridgeStatic.publicKey
        )
        let bridge = NoiseHandshake(
            pattern: .IK,
            role: .responder,
            staticKey: bridgeStatic
        )

        let msg1 = try phone.writeMessage()
        _ = try bridge.readMessage(msg1)

        let msg2 = try bridge.writeMessage()
        _ = try phone.readMessage(msg2)

        XCTAssertTrue(phone.isComplete)
        XCTAssertTrue(bridge.isComplete)

        let ps = try phone.finalize()
        let bs = try bridge.finalize()

        let msg = Data("ik test".utf8)
        XCTAssertEqual(try bs.decrypt(ps.encrypt(msg)), msg)
        XCTAssertEqual(try ps.decrypt(bs.encrypt(msg)), msg)
    }

    // MARK: - Channel binding

    func testHandshakeHashConsistencyXX() throws {
        let a = generateNoiseKeyPair()
        let b = generateNoiseKeyPair()

        let ha = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: a)
        let hb = NoiseHandshake(pattern: .XX, role: .responder, staticKey: b)

        _ = try hb.readMessage(ha.writeMessage())
        _ = try ha.readMessage(hb.writeMessage())
        _ = try hb.readMessage(ha.writeMessage())

        let sa = try ha.finalize()
        let sb = try hb.finalize()

        XCTAssertEqual(sa.handshakeHash, sb.handshakeHash)
        XCTAssertEqual(sa.handshakeHash.count, 32, "Handshake hash must be 32 bytes (SHA-256)")
    }

    func testHandshakeHashConsistencyIK() throws {
        let phone = generateNoiseKeyPair()
        let bridge = generateNoiseKeyPair()

        let hp = NoiseHandshake(
            pattern: .IK, role: .initiator, staticKey: phone,
            remoteStaticKey: bridge.publicKey
        )
        let hb = NoiseHandshake(pattern: .IK, role: .responder, staticKey: bridge)

        _ = try hb.readMessage(hp.writeMessage())
        _ = try hp.readMessage(hb.writeMessage())

        let sp = try hp.finalize()
        let sb = try hb.finalize()

        XCTAssertEqual(sp.handshakeHash, sb.handshakeHash)
        XCTAssertEqual(sp.handshakeHash.count, 32)
    }

    func testDifferentHandshakesProduceDifferentHashes() throws {
        // Two separate XX handshakes with different ephemeral keys should produce
        // different handshake hashes.
        let a = generateNoiseKeyPair()
        let b = generateNoiseKeyPair()

        let ha1 = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: a)
        let hb1 = NoiseHandshake(pattern: .XX, role: .responder, staticKey: b)
        _ = try hb1.readMessage(ha1.writeMessage())
        _ = try ha1.readMessage(hb1.writeMessage())
        _ = try hb1.readMessage(ha1.writeMessage())
        let s1 = try ha1.finalize()

        let ha2 = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: a)
        let hb2 = NoiseHandshake(pattern: .XX, role: .responder, staticKey: b)
        _ = try hb2.readMessage(ha2.writeMessage())
        _ = try ha2.readMessage(hb2.writeMessage())
        _ = try hb2.readMessage(ha2.writeMessage())
        let s2 = try ha2.finalize()

        XCTAssertNotEqual(
            s1.handshakeHash, s2.handshakeHash,
            "Different handshakes (different ephemeral keys) should produce different hashes"
        )
    }

    // MARK: - Non-replayability

    func testEncryptedMessagesNotReplayable() throws {
        let a = generateNoiseKeyPair()
        let b = generateNoiseKeyPair()

        let ha = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: a)
        let hb = NoiseHandshake(pattern: .XX, role: .responder, staticKey: b)

        _ = try hb.readMessage(ha.writeMessage())
        _ = try ha.readMessage(hb.writeMessage())
        _ = try hb.readMessage(ha.writeMessage())

        let sa = try ha.finalize()
        let sb = try hb.finalize()

        let msg = Data("secret".utf8)
        let ct1 = sa.encrypt(msg)
        let ct2 = sa.encrypt(msg)

        // Same plaintext, different ciphertext (nonce changed).
        XCTAssertNotEqual(ct1, ct2)

        // Both decrypt correctly in order.
        XCTAssertEqual(try sb.decrypt(ct1), msg)
        XCTAssertEqual(try sb.decrypt(ct2), msg)
    }

    func testOutOfOrderDecryptionFails() throws {
        let a = generateNoiseKeyPair()
        let b = generateNoiseKeyPair()

        let ha = NoiseHandshake(pattern: .XX, role: .initiator, staticKey: a)
        let hb = NoiseHandshake(pattern: .XX, role: .responder, staticKey: b)

        _ = try hb.readMessage(ha.writeMessage())
        _ = try ha.readMessage(hb.writeMessage())
        _ = try hb.readMessage(ha.writeMessage())

        let sa = try ha.finalize()
        let sb = try hb.finalize()

        let ct1 = sa.encrypt(Data("first".utf8))
        let ct2 = sa.encrypt(Data("second".utf8))

        // Decrypting ct2 first (skipping ct1) should fail because nonce is wrong.
        XCTAssertThrowsError(try sb.decrypt(ct2))
    }

    // MARK: - Error cases

    func testWriteWhenNotOurTurn() throws {
        let alice = NoiseHandshake(
            pattern: .XX, role: .initiator, staticKey: generateNoiseKeyPair()
        )
        let _ = try alice.writeMessage()

        // Now it's the responder's turn, alice should not be able to write.
        XCTAssertFalse(alice.isMySend)
        XCTAssertThrowsError(try alice.writeMessage()) { error in
            XCTAssertTrue(error is NoiseError)
        }
    }

    func testReadWhenNotTheirTurn() {
        let alice = NoiseHandshake(
            pattern: .XX, role: .initiator, staticKey: generateNoiseKeyPair()
        )

        // Alice should send first, not read.
        XCTAssertTrue(alice.isMySend)
        XCTAssertThrowsError(try alice.readMessage(Data(count: 32))) { error in
            XCTAssertTrue(error is NoiseError)
        }
    }

    func testFinalizeBeforeComplete() {
        let alice = NoiseHandshake(
            pattern: .XX, role: .initiator, staticKey: generateNoiseKeyPair()
        )
        XCTAssertThrowsError(try alice.finalize()) { error in
            XCTAssertTrue(error is NoiseError)
        }
    }

    // MARK: - QR payload tests (included here for completeness)

    func testQRPayloadParsing() throws {
        let json = """
        {"v":1,"relay":"ws://localhost:7889","room":"test-room","publicKey":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","expiresAt":9999999999999}
        """
        let payload = try QRPayload.parse(from: json)
        XCTAssertEqual(payload.v, 1)
        XCTAssertEqual(payload.relay, "ws://localhost:7889")
        XCTAssertEqual(payload.room, "test-room")
        XCTAssertEqual(payload.publicKey.count, 64)
        XCTAssertNil(payload.validate())
        XCTAssertTrue(payload.isValid)
        XCTAssertEqual(payload.bridgePublicKeyData.count, 32)
    }

    func testQRPayloadExpired() throws {
        let json = """
        {"v":1,"relay":"ws://localhost:7889","room":"test-room","publicKey":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","expiresAt":1000}
        """
        let payload = try QRPayload.parse(from: json)
        XCTAssertNotNil(payload.validate())
        XCTAssertFalse(payload.isValid)
    }

    func testQRPayloadBadVersion() throws {
        let json = """
        {"v":2,"relay":"ws://localhost:7889","room":"test-room","publicKey":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","expiresAt":9999999999999}
        """
        let payload = try QRPayload.parse(from: json)
        XCTAssertNotNil(payload.validate())
    }

    func testQRPayloadBadPublicKeyLength() throws {
        let json = """
        {"v":1,"relay":"ws://localhost:7889","room":"test-room","publicKey":"abcdef","expiresAt":9999999999999}
        """
        let payload = try QRPayload.parse(from: json)
        XCTAssertNotNil(payload.validate())
    }

    func testQRPayloadRelayURL() throws {
        let json = """
        {"v":1,"relay":"ws://localhost:7889","room":"my-room-id","publicKey":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","expiresAt":9999999999999}
        """
        let payload = try QRPayload.parse(from: json)
        let url = payload.relayURL
        XCTAssertNotNil(url)
        XCTAssertTrue(url!.absoluteString.contains("room=my-room-id"))
        XCTAssertTrue(url!.absoluteString.contains("role=client"))
    }
}
