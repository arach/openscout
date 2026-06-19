import Foundation

/// One incoming LAN pairing request, as served by the web server's
/// `/api/pairing/requests` (see packages/web/server/pairing-pair-requests.ts).
///
/// Initial pairing is trust-on-first-use, so a phone tapping an idle Mac parks
/// here until a human approves it on the Mac. Both native apps surface these and
/// POST a decision back to `/api/pairing/requests/:token/decide`.
public struct ScoutPairingRequest: Decodable, Identifiable, Sendable, Equatable {
    public let token: String
    public let status: String
    public let requesterIp: String?
    public let requesterLabel: String?
    public let route: String?
    public let createdAt: Double
    public let updatedAt: Double
    public let expiresAt: Double

    public var id: String { token }

    /// Human-facing requester name for the prompt ("iPhone wants to pair").
    public var displayName: String {
        if let label = requesterLabel?.trimmingCharacters(in: .whitespacesAndNewlines),
           !label.isEmpty {
            return label
        }
        return "A device"
    }

    public var isPending: Bool { status == "pending" }
}

/// Thin client over the web server's pairing-request endpoints. Reuses the
/// shared `ScoutWeb` base-URL resolution + `ScoutHTTP`.
public enum ScoutPairingRequests {
    private struct ListResponse: Decodable {
        let requests: [ScoutPairingRequest]
    }

    /// Pending requests awaiting a human decision on this Mac.
    public static func fetchPending() async throws -> [ScoutPairingRequest] {
        guard let url = ScoutWeb.url(path: "/api/pairing/requests") else { return [] }
        let response = try await ScoutHTTP.fetch(ListResponse.self, from: url)
        return response.requests.filter { $0.isPending }
    }

    /// Approve or deny a request. Approving starts pair mode + serves the
    /// payload so the waiting device can complete the handshake.
    public static func decide(token: String, approve: Bool) async throws {
        let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        guard let url = ScoutWeb.url(path: "/api/pairing/requests/\(encoded)/decide") else {
            throw ScoutHTTPError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(
            withJSONObject: ["decision": approve ? "approve" : "deny"],
        )
        try await ScoutHTTP.send(request)
    }
}
