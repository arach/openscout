import Foundation

public struct ScoutActivityClient: Sendable {
    public init() {}

    public func fetchActivity() async throws -> [ScoutActivityItem] {
        try await fetch([ScoutActivityItem].self, from: ScoutWeb.baseURL().appending(path: "api/activity"))
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutActivityClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutActivityClientError.httpStatus(http.statusCode)
        }
        return try JSONDecoder().decode(type, from: data)
    }
}

public enum ScoutActivityClientError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid activity response."
        case .httpStatus(let status):
            return "Scout activity returned HTTP \(status)."
        }
    }
}
