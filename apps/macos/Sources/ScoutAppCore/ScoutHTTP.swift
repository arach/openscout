import Foundation

public enum ScoutHTTP {
    public static func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        return try JSONDecoder().decode(type, from: data)
    }

    public static func send(_ request: URLRequest) async throws {
        let (_, response) = try await URLSession.shared.data(for: request)
        try validate(response)
    }

    public static func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ScoutHTTPError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutHTTPError.httpStatus(http.statusCode)
        }
    }
}

public enum ScoutHTTPError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status):
            return "Scout returned HTTP \(status)."
        }
    }
}
