import Foundation

struct MeshRendezvousConfiguration: Equatable, Sendable {
    static let defaultBaseURL = URL(string: "https://mesh.oscout.net")!
    static let defaultMeshId = "openscout"

    let isEnabled: Bool
    let baseURL: URL
    let meshId: String
    let bearerToken: String?

    init(
        isEnabled: Bool = false,
        baseURL: URL = MeshRendezvousConfiguration.defaultBaseURL,
        meshId: String = MeshRendezvousConfiguration.defaultMeshId,
        bearerToken: String? = nil
    ) {
        self.isEnabled = isEnabled
        self.baseURL = baseURL
        self.meshId = meshId
        self.bearerToken = bearerToken?.trimmedNonEmpty
    }

    static func current(userDefaults: UserDefaults = .standard) -> MeshRendezvousConfiguration {
        let rawBaseURL = userDefaults.string(forKey: "scout.osn.baseURL")?.trimmedNonEmpty
        let baseURL = rawBaseURL.flatMap(URL.init(string:)) ?? defaultBaseURL
        let meshId = userDefaults.string(forKey: "scout.osn.meshId")?.trimmedNonEmpty ?? defaultMeshId
        let sessionToken = try? ScoutIdentity.loadOSNSessionToken()

        return MeshRendezvousConfiguration(
            isEnabled: userDefaults.bool(forKey: "scout.osn.enabled"),
            baseURL: baseURL,
            meshId: meshId,
            bearerToken: sessionToken
        )
    }
}

struct OpenScoutNetworkAccount: Codable, Equatable, Sendable {
    let provider: String
    let providerUserId: String
    let login: String
    let email: String
    let expiresAt: String
}

struct OpenScoutNetworkMesh: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let role: String
    let createdAt: Int64

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case role
        case createdAt = "created_at"
    }
}

struct OpenScoutNetworkSessionResponse: Codable, Equatable, Sendable {
    let authenticated: Bool
    let session: OpenScoutNetworkAccount?
}

struct OpenScoutNetworkMeshesResponse: Codable, Equatable, Sendable {
    let meshes: [OpenScoutNetworkMesh]
}

struct MeshRendezvousList: Codable, Equatable, Sendable {
    let v: Int
    let meshId: String
    let nodes: [MeshRendezvousNode]
}

struct MeshRendezvousNode: Codable, Equatable, Identifiable, Sendable {
    let v: Int
    let meshId: String
    let nodeId: String
    let nodeName: String
    let issuedAt: Int64
    let expiresAt: Int64
    let observedAt: Int64?
    let entrypoints: [MeshRendezvousEntrypoint]

    var id: String { nodeId }

    var connectableURLs: [URL] {
        entrypoints.compactMap(\.connectableURL)
    }

    var mobilePairingPayload: QRPayload? {
        entrypoints.compactMap(\.mobilePairingPayload).first
    }

    func isExpired(now: Date = Date()) -> Bool {
        expiresAt <= Int64(now.timeIntervalSince1970 * 1000)
    }
}

enum MeshRendezvousEntrypoint: Codable, Equatable, Sendable {
    case http(HTTPEntrypoint)
    case cloudflareTunnel(HTTPEntrypoint)
    case iroh(IrohEntrypoint)
    case mobilePairing(MobilePairingEntrypoint)
    case unknown(kind: String)

    var kind: String {
        switch self {
        case .http: "http"
        case .cloudflareTunnel: "cloudflare_tunnel"
        case .iroh: "iroh"
        case .mobilePairing: "mobile_pairing"
        case .unknown(let kind): kind
        }
    }

    var connectableURL: URL? {
        switch self {
        case .http(let entrypoint), .cloudflareTunnel(let entrypoint):
            URL(string: entrypoint.url)
        case .iroh, .mobilePairing, .unknown:
            nil
        }
    }

    var mobilePairingPayload: QRPayload? {
        guard case .mobilePairing(let entrypoint) = self else {
            return nil
        }
        return entrypoint.qrPayload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)

        switch kind {
        case "http":
            self = .http(try HTTPEntrypoint(from: decoder))
        case "cloudflare_tunnel":
            self = .cloudflareTunnel(try HTTPEntrypoint(from: decoder))
        case "iroh":
            self = .iroh(try IrohEntrypoint(from: decoder))
        case "mobile_pairing":
            self = .mobilePairing(try MobilePairingEntrypoint(from: decoder))
        default:
            self = .unknown(kind: kind)
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .http(let entrypoint), .cloudflareTunnel(let entrypoint):
            try entrypoint.encode(to: encoder)
        case .iroh(let entrypoint):
            try entrypoint.encode(to: encoder)
        case .mobilePairing(let entrypoint):
            try entrypoint.encode(to: encoder)
        case .unknown(let kind):
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(kind, forKey: .kind)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case kind
    }

    struct HTTPEntrypoint: Codable, Equatable, Sendable {
        let kind: String
        let url: String
        let lastSeenAt: Int64?
        let expiresAt: Int64?
    }

    struct IrohEntrypoint: Codable, Equatable, Sendable {
        let kind: String
        let endpointId: String
        let alpn: String?
        let bridgeProtocolVersion: Int?
        let lastSeenAt: Int64?
        let expiresAt: Int64?
    }

    struct MobilePairingEntrypoint: Codable, Equatable, Sendable {
        let kind: String
        let relay: String
        let fallbackRelays: [String]?
        let room: String
        let publicKey: String
        let expiresAt: Int64
        let lastSeenAt: Int64?

        var qrPayload: QRPayload {
            QRPayload(
                v: 1,
                relay: relay,
                fallbackRelays: fallbackRelays,
                room: room,
                publicKey: publicKey,
                expiresAt: expiresAt
            )
        }
    }
}

final class MeshRendezvousClient {
    private let configuration: MeshRendezvousConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder

    init(
        configuration: MeshRendezvousConfiguration,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.configuration = configuration
        self.session = session
        self.decoder = decoder
    }

    func fetchNodes() async throws -> [MeshRendezvousNode] {
        guard configuration.isEnabled else {
            throw MeshRendezvousError.disabled
        }

        var components = URLComponents(url: configuration.baseURL.appending(path: "/v1/nodes"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "meshId", value: configuration.meshId)
        ]
        guard let url = components?.url else {
            throw MeshRendezvousError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let bearerToken = configuration.bearerToken {
            request.setValue("Bearer osn_session_\(bearerToken)", forHTTPHeaderField: "authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MeshRendezvousError.invalidResponse
        }
        switch httpResponse.statusCode {
        case 200:
            return try decoder.decode(MeshRendezvousList.self, from: data)
                .nodes
                .filter { !$0.isExpired() }
        case 401, 403:
            throw MeshRendezvousError.unauthorized
        default:
            throw MeshRendezvousError.httpStatus(httpResponse.statusCode)
        }
    }

    func fetchSession() async throws -> OpenScoutNetworkAccount? {
        let response: OpenScoutNetworkSessionResponse = try await fetchJSON(path: "/v1/auth/session")
        return response.authenticated ? response.session : nil
    }

    func fetchMeshes() async throws -> [OpenScoutNetworkMesh] {
        let response: OpenScoutNetworkMeshesResponse = try await fetchJSON(path: "/v1/meshes")
        return response.meshes
    }

    private func fetchJSON<T: Decodable>(path: String) async throws -> T {
        let url = configuration.baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let bearerToken = configuration.bearerToken {
            request.setValue("Bearer osn_session_\(bearerToken)", forHTTPHeaderField: "authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MeshRendezvousError.invalidResponse
        }
        switch httpResponse.statusCode {
        case 200:
            return try decoder.decode(T.self, from: data)
        case 401, 403:
            throw MeshRendezvousError.unauthorized
        default:
            throw MeshRendezvousError.httpStatus(httpResponse.statusCode)
        }
    }
}

enum MeshRendezvousError: LocalizedError, Equatable {
    case disabled
    case invalidURL
    case invalidResponse
    case unauthorized
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .disabled:
            return "OSN is off on this iPhone."
        case .invalidURL:
            return "OSN directory URL is invalid."
        case .invalidResponse:
            return "OSN directory returned an invalid response."
        case .unauthorized:
            return "Sign in to OSN before this iPhone can read the directory."
        case .httpStatus(let status):
            return "OSN directory request failed with HTTP \(status)."
        }
    }
}
