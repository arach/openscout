import Foundation

public enum ScoutTailDiscoveryScope: String, Sendable {
    case hot
    case shallow
    case deep
}

public struct ScoutTailClient: Sendable {
    public init() {}

    public func fetchRecent(limit: Int, includeTranscripts: Bool) async throws -> ScoutTailRecentPayload {
        var items = [
            URLQueryItem(name: "limit", value: "\(limit)"),
        ]
        if includeTranscripts {
            items.append(URLQueryItem(name: "transcripts", value: "true"))
        }
        let url = ScoutWeb.baseURL()
            .appending(path: "api/tail/recent")
            .appending(queryItems: items)
        return try await ScoutHTTP.fetch(ScoutTailRecentPayload.self, from: url)
    }

    public func fetchDiscovery(
        force: Bool = false,
        scope: ScoutTailDiscoveryScope? = nil,
        limit: Int? = nil
    ) async throws -> ScoutTailDiscoverySnapshot {
        var items: [URLQueryItem] = []
        if force {
            items.append(URLQueryItem(name: "force", value: "1"))
        }
        if let scope {
            items.append(URLQueryItem(name: "scope", value: scope.rawValue))
        }
        if let limit, limit > 0 {
            items.append(URLQueryItem(name: "limit", value: "\(limit)"))
        }
        let url = ScoutWeb.baseURL()
            .appending(path: "api/tail/discover")
            .appending(queryItems: items)
        return try await ScoutHTTP.fetch(ScoutTailDiscoverySnapshot.self, from: url)
    }
}
