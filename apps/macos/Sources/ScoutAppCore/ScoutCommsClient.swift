import Foundation

public struct ScoutCommsClient: Sendable {
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

    public func fetchAgents() async throws -> [ScoutAgent] {
        try await ScoutHTTP.fetch([ScoutAgent].self, from: ScoutWeb.baseURL().appending(path: "api/agents"))
    }

    public func fetchMessages(cId: String, limit: Int) async throws -> [ScoutMessage] {
        let url = ScoutWeb.baseURL()
            .appending(path: "api/messages")
            .appending(queryItems: [
                URLQueryItem(name: "cId", value: cId),
                URLQueryItem(name: "conversationId", value: cId),
                URLQueryItem(name: "limit", value: "\(limit)"),
            ])
        return try await ScoutHTTP.fetch([ScoutMessage].self, from: url)
            .sorted { $0.createdAt < $1.createdAt }
    }

    public func send(body: String, cId: String) async throws {
        let url = ScoutWeb.baseURL().appending(path: "api/send")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "body": body,
            "cId": cId,
            "conversationId": cId,
        ])
        try await ScoutHTTP.send(request)
    }

    private func fetchWithFallback<T: Decodable>(_ type: T.Type, primary: URL, fallback: URL) async throws -> T {
        do {
            return try await ScoutHTTP.fetch(type, from: primary)
        } catch {
            return try await ScoutHTTP.fetch(type, from: fallback)
        }
    }
}
