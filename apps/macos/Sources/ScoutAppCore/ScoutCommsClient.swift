import Foundation
import os.log

public struct ScoutCommsClient: Sendable {
    private static let log = Logger(subsystem: "dev.openscout.menu", category: "comms")

    public init() {}

    public func fetchChannels(limit: Int) async throws -> [ScoutChannel] {
        let base = ScoutWeb.baseURL()
        let commsURL = base
            .appending(path: "api/comms")
            .appending(queryItems: [URLQueryItem(name: "limit", value: "\(limit)")])
        let fallbackURL = base
            .appending(path: "api/conversations")
            .appending(queryItems: [URLQueryItem(name: "limit", value: "\(limit)")])
        return try await fetchWithFallback([ScoutChannel].self, primary: commsURL, fallback: fallbackURL)
    }

    public func fetchAgents(limit: Int? = nil, summary: Bool = false) async throws -> [ScoutAgent] {
        var url = ScoutWeb.baseURL().appending(path: "api/agents")
        var queryItems: [URLQueryItem] = []
        if let limit, limit > 0 {
            queryItems.append(URLQueryItem(name: "limit", value: "\(limit)"))
        }
        if summary {
            queryItems.append(URLQueryItem(name: "detail", value: "summary"))
        }
        if !queryItems.isEmpty {
            url = url.appending(queryItems: queryItems)
        }
        return try await ScoutHTTP.fetch([ScoutAgent].self, from: url)
    }

    public func fetchMessages(cId: String, limit: Int) async throws -> [ScoutMessage] {
        let url = ScoutWeb.baseURL()
            .appending(path: "api/messages")
            .appending(queryItems: [
                URLQueryItem(name: "chatId", value: cId),
                URLQueryItem(name: "cId", value: cId),
                URLQueryItem(name: "conversationId", value: cId),
                URLQueryItem(name: "limit", value: "\(limit)"),
            ])
        return try await ScoutHTTP.fetch([ScoutMessage].self, from: url)
            .sorted { $0.createdAt < $1.createdAt }
    }

    public func fetchReadCursors(cId: String) async throws -> [ScoutReadCursor] {
        try await ScoutHTTP.fetch(
            [ScoutReadCursor].self,
            from: ScoutWeb.baseURL().appending(path: "api/conversations/\(cId)/read-cursors")
        )
    }

    public func send(body: String, cId: String, replyToMessageId: String? = nil) async throws {
        let url = ScoutWeb.baseURL().appending(path: "api/send")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = [
            "body": body,
            "chatId": cId,
            "cId": cId,
            "conversationId": cId,
        ]
        if let replyToMessageId = replyToMessageId?.trimmingCharacters(in: .whitespacesAndNewlines),
           !replyToMessageId.isEmpty {
            payload["replyToMessageId"] = replyToMessageId
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        try await ScoutHTTP.send(request)
    }

    /// Advance the operator's read cursor for a conversation. Best-effort: the
    /// caller fires this when a conversation is opened, so any failure must stay
    /// out of the UI — we log and move on. The server defaults `actorId` to
    /// "operator", so we omit it here.
    public func advanceReadCursor(
        cId: String,
        lastReadMessageId: String?,
        lastReadSeq: Int? = nil,
        lastReadAt: TimeInterval? = nil
    ) async {
        // Conversation ids mint as "c.<uuid>" (no path separators), so a single
        // path segment is safe; appending(path:) percent-encodes any stray
        // reserved characters for us.
        let url = ScoutWeb.baseURL()
            .appending(path: "api/conversations/\(cId)/read-cursor")
        var payload: [String: Any] = [:]
        if let lastReadMessageId, !lastReadMessageId.isEmpty {
            payload["lastReadMessageId"] = lastReadMessageId
        }
        if let lastReadSeq {
            payload["lastReadSeq"] = lastReadSeq
        }
        // Always carry a timestamp so the cursor advances even when we only know
        // "the user looked just now" (e.g. messages haven't loaded yet). The
        // server takes epoch milliseconds.
        let resolvedAt = lastReadAt ?? Date().timeIntervalSince1970
        payload["lastReadAt"] = Int(resolvedAt * 1000)
        payload["metadata"] = ["source": "scout-macos"]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            try await ScoutHTTP.send(request)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            Self.log.warning("advanceReadCursor failed for \(cId, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    private func fetchWithFallback<T: Decodable>(_ type: T.Type, primary: URL, fallback: URL) async throws -> T {
        do {
            return try await ScoutHTTP.fetch(type, from: primary)
        } catch {
            return try await ScoutHTTP.fetch(type, from: fallback)
        }
    }
}
