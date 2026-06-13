import Foundation

public struct ScoutTailClient: Sendable {
    public init() {}

    public func fetchRecent(limit: Int, includeTranscripts: Bool) async throws -> ScoutTailRecentPayload {
        var items = [
            URLQueryItem(name: "limit", value: "\(limit)"),
        ]
        if includeTranscripts {
            items.append(URLQueryItem(name: "transcripts", value: "true"))
        }
        let url = ScoutBroker.baseURL()
            .appending(path: "v1/tail/recent")
            .appending(queryItems: items)
        return try await ScoutHTTP.fetch(ScoutTailRecentPayload.self, from: url)
    }

    public func fetchDiscovery() async throws -> ScoutTailDiscoverySnapshot {
        try await ScoutHTTP.fetch(ScoutTailDiscoverySnapshot.self, from: ScoutBroker.baseURL().appending(path: "v1/tail/discover"))
    }
}
