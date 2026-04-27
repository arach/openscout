// QRPayload — QR pairing payload model for Dispatch iOS.
//
// Matches PROTOCOL.md S1 and the TypeScript QRPayload in src/security/identity.ts.
//
// The QR code contains a JSON string with:
//   { v: 1, relay: "ws://...", room: "uuid", publicKey: "hex64", expiresAt: unixMs }

import Foundation

struct QRPayload: Codable, Sendable {
    /// Protocol version. Must be 1.
    let v: Int

    /// Relay WebSocket URL.
    let relay: String

    /// Additional relay WebSocket URLs to try after the primary URL.
    let fallbackRelays: [String]?

    /// Room ID on the relay (UUID).
    let room: String

    /// Bridge's static public key as 64 hex characters (32 bytes).
    let publicKey: String

    /// Expiry timestamp in milliseconds since Unix epoch.
    let expiresAt: Int64
}

// MARK: - Validation

extension QRPayload {

    /// Validate the payload. Returns nil if valid, or an error message if invalid.
    func validate() -> String? {
        if v != 1 {
            return "Unsupported protocol version: \(v). Please update the app."
        }
        if publicKey.count != 64 {
            return "Invalid bridge public key length: \(publicKey.count) (expected 64 hex chars)"
        }
        // Verify all characters are valid hex.
        let hexCharSet = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        if publicKey.unicodeScalars.contains(where: { !hexCharSet.contains($0) }) {
            return "Invalid bridge public key: contains non-hex characters"
        }
        if relay.isEmpty {
            return "Missing relay URL"
        }
        if room.isEmpty {
            return "Missing room ID"
        }
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if nowMs > expiresAt {
            return "QR code has expired. Please generate a new one on the bridge."
        }
        return nil
    }

    /// Whether the payload is valid (convenience).
    var isValid: Bool { validate() == nil }
}

// MARK: - Computed properties

extension QRPayload {

    /// Bridge's public key as raw bytes (32 bytes).
    var bridgePublicKeyData: Data {
        hexToData(publicKey)
    }

    /// WebSocket URL for connecting to the relay room as a client.
    var relayURL: URL? {
        var components = URLComponents(string: relay)
        // Append query parameters for room and role.
        var queryItems = components?.queryItems ?? []
        queryItems.append(URLQueryItem(name: "room", value: room))
        queryItems.append(URLQueryItem(name: "role", value: "client"))
        components?.queryItems = queryItems
        return components?.url
    }

    /// Relay URLs in the order the app should attempt them.
    var orderedRelayURLs: [String] {
        deduplicatedRelayURLs(primary: relay, fallbacks: fallbackRelays ?? [])
    }

    /// Expiry date.
    var expiryDate: Date {
        Date(timeIntervalSince1970: Double(expiresAt) / 1000.0)
    }

    /// Seconds remaining until expiry (negative if expired).
    var secondsRemaining: TimeInterval {
        expiryDate.timeIntervalSinceNow
    }
}

// MARK: - Parsing

extension QRPayload {

    /// Parse a QR payload from a JSON string (the raw QR code content).
    static func parse(from jsonString: String) throws -> QRPayload {
        guard let data = jsonString.data(using: .utf8) else {
            throw QRPayloadError.invalidEncoding
        }
        return try JSONDecoder().decode(QRPayload.self, from: data)
    }
}

enum QRPayloadError: Error, LocalizedError {
    case invalidEncoding
    case invalidPayload(String)

    var errorDescription: String? {
        switch self {
        case .invalidEncoding: "QR code content is not valid UTF-8"
        case .invalidPayload(let reason): "Invalid QR payload: \(reason)"
        }
    }
}

// MARK: - Hex helper

private func hexToData(_ hex: String) -> Data {
    var data = Data(capacity: hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
        let nextIndex = hex.index(index, offsetBy: 2)
        let byteString = hex[index..<nextIndex]
        if let byte = UInt8(byteString, radix: 16) {
            data.append(byte)
        }
        index = nextIndex
    }
    return data
}
