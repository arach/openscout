import Foundation
import ScoutCapabilities

public typealias ScoutSessionStartResult = SessionInitiationResult

public enum SessionInitiationError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status, let message):
            return message.isEmpty ? "Scout returned HTTP \(status)." : message
        }
    }
}

public enum SessionInitiationService {
    public static func start(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult {
        let url = ScoutWeb.baseURL().appending(path: "api/sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(spec)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SessionInitiationError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SessionInitiationError.httpStatus(http.statusCode, decodeError(data))
        }
        return try JSONDecoder().decode(SessionInitiationResult.self, from: data)
    }

    public static func userFacingError(_ error: Error) -> String {
        if let localized = error as? LocalizedError,
           let description = localized.errorDescription,
           !description.isEmpty {
            return description
        }
        return ScoutAppError.userFacing(
            error,
            connectionMessage: "Scout web server isn't running. Start Scout services, then try again."
        )
    }

    private static func decodeError(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String else {
            return ""
        }
        return message
    }
}
