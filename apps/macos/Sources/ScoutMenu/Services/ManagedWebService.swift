import Foundation

enum ManagedWebControlAction: String, Sendable {
    case start
    case restart
}

struct ManagedWebControlStatus: Decodable, Sendable {
    let ok: Bool
    let running: Bool?
    let starting: Bool?
    let managed: Bool?
    let webURL: String?
    let port: Int?
    let pid: Int?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case running
        case starting
        case managed
        case webURL = "webUrl"
        case port
        case pid
        case error
    }
}

enum ManagedWebServiceError: LocalizedError {
    case invalidBrokerURL(String)
    case invalidResponse
    case rejected(String)

    var errorDescription: String? {
        switch self {
        case .invalidBrokerURL(let value):
            return "Scout broker URL is invalid: \(value)"
        case .invalidResponse:
            return "Scout broker returned an unreadable web-control response."
        case .rejected(let detail):
            return detail
        }
    }
}

struct ManagedWebService {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func control(_ action: ManagedWebControlAction, brokerURL: String) async throws -> ManagedWebControlStatus {
        let request = try Self.controlRequest(action, brokerURL: brokerURL)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ManagedWebServiceError.rejected(
                "Scout broker did not respond while trying to \(action.rawValue) the managed web app: \(error.localizedDescription)"
            )
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ManagedWebServiceError.invalidResponse
        }

        let status = try? JSONDecoder().decode(ManagedWebControlStatus.self, from: data)
        guard (200..<300).contains(httpResponse.statusCode), let status else {
            throw ManagedWebServiceError.rejected(
                status?.error ?? "Scout broker web control returned HTTP \(httpResponse.statusCode)."
            )
        }
        guard status.ok else {
            throw ManagedWebServiceError.rejected(
                status.error ?? "Scout broker could not \(action.rawValue) the managed web app."
            )
        }
        return status
    }

    static func controlRequest(_ action: ManagedWebControlAction, brokerURL: String) throws -> URLRequest {
        guard var components = URLComponents(string: brokerURL),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil else {
            throw ManagedWebServiceError.invalidBrokerURL(brokerURL)
        }
        if components.host == "0.0.0.0" || components.host == "::" || components.host == "[::]" {
            components.host = "127.0.0.1"
        }
        components.path = "/v1/web/\(action.rawValue)"
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw ManagedWebServiceError.invalidBrokerURL(brokerURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("close", forHTTPHeaderField: "Connection")
        request.setValue("scout.local", forHTTPHeaderField: "X-Forwarded-Host")
        request.setValue("http", forHTTPHeaderField: "X-Forwarded-Proto")
        return request
    }

    static func logPath(
        supportDirectory: String?,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> String {
        let reported = supportDirectory?.trimmingCharacters(in: .whitespacesAndNewlines)
        let overridden = environment["OPENSCOUT_SUPPORT_DIRECTORY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let root: URL
        if let reported, !reported.isEmpty {
            root = URL(fileURLWithPath: reported)
        } else if let overridden, !overridden.isEmpty {
            root = URL(fileURLWithPath: overridden)
        } else {
            root = homeDirectory.appending(path: "Library/Application Support/OpenScout")
        }
        return root.appending(path: "logs/web/supervised-web.log").path
    }
}
