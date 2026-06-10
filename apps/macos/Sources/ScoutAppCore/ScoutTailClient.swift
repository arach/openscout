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
        return try await fetch(ScoutTailRecentPayload.self, from: url)
    }

    public func fetchDiscovery() async throws -> ScoutTailDiscoverySnapshot {
        try await fetch(ScoutTailDiscoverySnapshot.self, from: ScoutBroker.baseURL().appending(path: "v1/tail/discover"))
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutTailError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutTailError.httpStatus(http.statusCode)
        }
        return try JSONDecoder().decode(type, from: data)
    }
}

public enum ScoutTailError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid tail response."
        case .httpStatus(let status):
            return "Scout tail returned HTTP \(status)."
        }
    }
}
