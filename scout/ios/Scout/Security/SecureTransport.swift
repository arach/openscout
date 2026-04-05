// SecureTransport — Encrypted WebSocket wrapper using Noise Protocol.
//
// Wire-compatible with the TypeScript SecureTransport at src/security/transport.ts.
//
// Wire format (JSON envelopes):
//   Handshake phase:  { "phase": "handshake", "payload": "<base64>" }
//   Transport phase:  { "phase": "transport", "payload": "<base64>" }
//
// The phone is always the Noise initiator.
//
// Conforms to SecureTransportProtocol (defined in Services/ConnectionManager.swift)
// so the ConnectionManager can drive connection lifecycle without knowing crypto details.

import Foundation

// MARK: - SecureTransportProtocol

/// Contract for encrypted transport — implemented by SecureTransport,
/// stubbed by NoOpTransport in previews/tests.
protocol SecureTransportProtocol: AnyObject {
    var isReady: Bool { get }
    var onReady: (@Sendable (Data) -> Void)? { get set }
    var onError: (@Sendable (Error) -> Void)? { get set }
    func performHandshake(webSocket: URLSessionWebSocketTask, remoteStaticKey: Data?) async throws
    func send(_ message: String) async throws
    func receive() -> AsyncStream<String>
    func shutdown()
}

// MARK: - Wire message

struct WireMessage: Codable, Sendable {
    let phase: Phase
    let payload: String  // base64

    enum Phase: String, Codable, Sendable {
        case handshake
        case transport
    }
}

// MARK: - SecureTransport

/// Manages a Noise-encrypted WebSocket connection.
///
/// Lifecycle (driven by ConnectionManager via SecureTransportProtocol):
///   1. ConnectionManager creates a SecureTransport via factory.
///   2. Calls `performHandshake(webSocket:remoteStaticKey:)` which blocks until complete.
///   3. Calls `receive()` to get an AsyncStream of decrypted messages.
///   4. Calls `send(_:)` to encrypt and send application messages.
///   5. Calls `shutdown()` on disconnect.
final class SecureTransport: SecureTransportProtocol, @unchecked Sendable {

    // MARK: - State

    private var handshake: NoiseHandshake?
    private var session: NoiseSession?
    private var webSocket: URLSessionWebSocketTask?
    private let staticKey: NoiseKeyPair
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// Stream continuation for pushing decrypted messages to ConnectionManager.
    private var messageContinuation: AsyncStream<String>.Continuation?
    /// Task that reads raw WebSocket messages and processes them.
    private var readLoopTask: Task<Void, Never>?

    /// True when the handshake is complete and transport messages can be sent.
    private(set) var isReady = false

    /// Called when the secure channel is established. The Data is the remote static public key.
    var onReady: (@Sendable (Data) -> Void)?

    /// Called when the transport encounters an unrecoverable error.
    var onError: (@Sendable (Error) -> Void)?

    // MARK: - Init

    /// Create a SecureTransport with the phone's static identity key.
    ///
    /// The handshake is not started until `performHandshake` is called.
    init(staticKey: NoiseKeyPair) {
        self.staticKey = staticKey
    }

    // MARK: - SecureTransportProtocol conformance

    /// Perform the Noise handshake as initiator (phone role).
    ///
    /// - Parameters:
    ///   - webSocket: The WebSocket to perform the handshake on.
    ///   - remoteStaticKey: If non-nil, use IK pattern (reconnect). If nil, use XX pattern (pairing).
    ///
    /// Timeout for the entire handshake (seconds).
    private static let handshakeTimeout: TimeInterval = 3

    /// Blocks until the handshake completes, throws on failure or timeout.
    func performHandshake(
        webSocket: URLSessionWebSocketTask,
        remoteStaticKey: Data?
    ) async throws {
        self.webSocket = webSocket

        let pattern: HandshakePattern = remoteStaticKey != nil ? .IK : .XX
        let hs = NoiseHandshake(
            pattern: pattern,
            role: .initiator,  // Phone is ALWAYS initiator.
            staticKey: staticKey,
            remoteStaticKey: remoteStaticKey
        )
        self.handshake = hs

        // Run the handshake with a timeout — if the bridge isn't in the room
        // (stale room ID after restart), receive() blocks forever without this.
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                try await Task.sleep(for: .seconds(Self.handshakeTimeout))
                throw SecureTransportError.handshakeTimeout
            }

            group.addTask { [self] in
                try await self.runHandshakeLoop(hs: hs, webSocket: webSocket)
            }

            // Wait for first completion — either handshake succeeds or timeout fires.
            try await group.next()
            // Cancel the other task (either the timer or the handshake).
            group.cancelAll()
        }

        // Finalize: derive transport cipher states.
        session = try hs.finalize()
        isReady = true

        if let remoteKey = session?.remoteStaticKey {
            onReady?(remoteKey)
        }
    }

    /// Inner handshake loop — separated so it can race against a timeout.
    private func runHandshakeLoop(
        hs: NoiseHandshake,
        webSocket: URLSessionWebSocketTask
    ) async throws {
        // Drive the handshake loop: send our messages, read their messages,
        // until the handshake is complete.
        while !hs.isComplete {
            try Task.checkCancellation()

            if hs.isMySend {
                // Write our message and send it.
                let payload = try hs.writeMessage()
                let wire = WireMessage(
                    phase: .handshake,
                    payload: payload.base64EncodedString()
                )
                let json = try encoder.encode(wire)
                guard let jsonString = String(data: json, encoding: .utf8) else {
                    throw SecureTransportError.encodingFailed
                }
                try await webSocket.send(.string(jsonString))
            } else {
                // Read their message from the WebSocket (now cancellable via task group).
                let rawMessage = try await webSocket.receive()
                let text: String
                switch rawMessage {
                case .string(let s): text = s
                case .data(let d):
                    guard let s = String(data: d, encoding: .utf8) else {
                        throw SecureTransportError.decodingFailed
                    }
                    text = s
                @unknown default:
                    throw SecureTransportError.decodingFailed
                }

                guard let data = text.data(using: .utf8) else {
                    throw NoiseError.decryptionFailed("invalid UTF-8 in handshake message")
                }
                let wire = try decoder.decode(WireMessage.self, from: data)

                guard wire.phase == .handshake else {
                    throw SecureTransportError.transportBeforeHandshake
                }
                guard let payloadData = Data(base64Encoded: wire.payload) else {
                    throw NoiseError.decryptionFailed("invalid base64 in handshake")
                }

                _ = try hs.readMessage(payloadData)
            }
        }
        if let remoteKey = session?.remoteStaticKey {
            onReady?(remoteKey)
        }
    }

    /// Encrypt and send an application message.
    func send(_ message: String) async throws {
        guard isReady, let session, let webSocket else {
            throw SecureTransportError.notReady
        }

        let plaintext = Data(message.utf8)
        let ciphertext = session.encrypt(plaintext)
        let wire = WireMessage(
            phase: .transport,
            payload: ciphertext.base64EncodedString()
        )
        let json = try encoder.encode(wire)
        guard let jsonString = String(data: json, encoding: .utf8) else {
            throw SecureTransportError.encodingFailed
        }
        try await webSocket.send(.string(jsonString))
    }

    /// Returns an AsyncStream of decrypted application messages.
    ///
    /// Starts a background task that reads from the WebSocket, decrypts transport
    /// messages, and yields them into the stream. The stream ends when the WebSocket
    /// closes or `shutdown()` is called.
    func receive() -> AsyncStream<String> {
        let (stream, continuation) = AsyncStream.makeStream(of: String.self)
        self.messageContinuation = continuation

        readLoopTask = Task { [weak self] in
            guard let self, let ws = self.webSocket else {
                continuation.finish()
                return
            }

            while !Task.isCancelled {
                do {
                    let rawMessage = try await ws.receive()
                    let text: String
                    switch rawMessage {
                    case .string(let s): text = s
                    case .data(let d):
                        guard let s = String(data: d, encoding: .utf8) else { continue }
                        text = s
                    @unknown default:
                        continue
                    }

                    guard let data = text.data(using: .utf8) else { continue }
                    guard let wire = try? self.decoder.decode(WireMessage.self, from: data) else {
                        continue
                    }

                    switch wire.phase {
                    case .transport:
                        guard let payloadData = Data(base64Encoded: wire.payload),
                              let session = self.session else { continue }
                        do {
                            let plaintext = try session.decrypt(payloadData)
                            guard let message = String(data: plaintext, encoding: .utf8) else {
                                continue
                            }
                            continuation.yield(message)
                        } catch {
                            self.onError?(error)
                            // Decryption failure = stale session (bridge restarted).
                            // Break to trigger reconnect with fresh handshake.
                            break
                        }

                    case .handshake:
                        // Unexpected handshake message during transport phase -- skip.
                        continue
                    }
                } catch {
                    // WebSocket read error -- connection closed.
                    break
                }
            }

            continuation.finish()
        }

        return stream
    }

    /// Tear down the transport.
    func shutdown() {
        readLoopTask?.cancel()
        readLoopTask = nil
        messageContinuation?.finish()
        messageContinuation = nil
        session = nil
        handshake = nil
        isReady = false
        // Don't close the WebSocket here -- ConnectionManager owns that lifecycle.
    }
}

// MARK: - Errors

enum SecureTransportError: Error, LocalizedError {
    case notReady
    case transportBeforeHandshake
    case encodingFailed
    case decodingFailed
    case handshakeTimeout

    var errorDescription: String? {
        switch self {
        case .notReady: "SecureTransport: not ready (handshake incomplete)"
        case .transportBeforeHandshake: "SecureTransport: received transport message before handshake"
        case .encodingFailed: "SecureTransport: failed to encode wire message"
        case .decodingFailed: "SecureTransport: failed to decode decrypted message as UTF-8"
        case .handshakeTimeout: "SecureTransport: handshake timed out (bridge may be in a different room)"
        }
    }
}
