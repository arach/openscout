import Foundation

@MainActor
final class HudFleetService: ObservableObject {
    static let shared = HudFleetService()

    @Published private(set) var agents: [HudAgent]? = nil
    @Published private(set) var activity: [HudActivityItem]? = nil
    @Published private(set) var lastError: String? = nil
    @Published private(set) var isLoading: Bool = false

    private let brokerService = BrokerService()
    private let decoder = JSONDecoder()
    private let pollInterval: TimeInterval = 2.0
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?
    private var brokerBaseURL: URL?
    // Last-resort default if ~/.openscout/config.json can't be read.
    // The canonical source is the local openscout config (host + ports.web).
    private static let defaultBrokerURL = URL(string: "http://127.0.0.1:3200")!

    private init() {}

    func start() {
        guard pollTask == nil else { return }
        isLoading = agents == nil
        refresh(force: true)
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(2.0 * 1_000_000_000))
                guard let self else { return }
                self.refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        inFlight?.cancel()
        inFlight = nil
        isLoading = false
    }

    func refresh(force: Bool = false) {
        if inFlight != nil { return }
        if !force, pollTask == nil { return }
        let hadAgents = agents != nil
        isLoading = !hadAgents

        inFlight = Task { [weak self] in
            guard let self else { return }
            let started = Date()
            let baseURL: URL
            do {
                baseURL = try await resolveBrokerBaseURL()
            } catch {
                guard !Task.isCancelled else { return }
                self.lastError = Self.userFacingError(error)
                self.isLoading = false
                self.inFlight = nil
                return
            }

            // Independent fetches — one failing shouldn't cancel the other.
            // We use Result so a partial failure still updates whatever
            // succeeded and surfaces a soft error.
            async let agentsResult: Result<[HudAgent], Error> = await Self.fetchResult(
                [HudAgent].self,
                from: baseURL.appending(path: "api/agents"),
                decoder: decoder
            )
            async let activityResult: Result<[HudActivityItem], Error> = await Self.fetchResult(
                [HudActivityItem].self,
                from: baseURL.appending(path: "api/activity"),
                decoder: decoder
            )
            let (ar, vr) = await (agentsResult, activityResult)

            if !hadAgents {
                let elapsed = Date().timeIntervalSince(started)
                if elapsed < 0.2 {
                    try? await Task.sleep(nanoseconds: UInt64((0.2 - elapsed) * 1_000_000_000))
                }
            }

            guard !Task.isCancelled else { return }

            switch ar {
            case .success(let next): self.agents = next
            case .failure(let err):
                NSLog("[HudFleetService] agents fetch failed: %@", String(describing: err))
            }
            switch vr {
            case .success(let next): self.activity = next
            case .failure(let err):
                NSLog("[HudFleetService] activity fetch failed: %@", String(describing: err))
            }

            // Error state: both failed
            if case .failure(let err) = ar, case .failure = vr {
                self.lastError = Self.userFacingError(err)
            } else {
                self.lastError = nil
            }

            self.isLoading = false
            self.inFlight = nil
        }
    }

    private func resolveBrokerBaseURL() async throws -> URL {
        if let cached = brokerBaseURL {
            return cached
        }
        // Explicit env override wins (for remote brokers / future routing).
        if let env = ProcessInfo.processInfo.environment["OPENSCOUT_BROKER_URL"],
           let url = URL(string: env) {
            brokerBaseURL = url
            return url
        }
        // Canonical source: ~/.openscout/config.json. The "web" port is
        // the surface serving /api/agents, /api/activity, etc. The
        // separate "broker" port is the control plane and doesn't have
        // those routes.
        if let url = Self.readWebURLFromConfig() {
            brokerBaseURL = url
            return url
        }
        brokerBaseURL = Self.defaultBrokerURL
        return Self.defaultBrokerURL
    }

    nonisolated private static func readWebURLFromConfig() -> URL? {
        struct OpenScoutConfig: Decodable {
            struct Ports: Decodable { let web: Int? }
            let host: String?
            let ports: Ports?
        }
        let path = ("~/.openscout/config.json" as NSString).expandingTildeInPath
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        guard let cfg = try? JSONDecoder().decode(OpenScoutConfig.self, from: data) else { return nil }
        let host = cfg.host ?? "127.0.0.1"
        guard let port = cfg.ports?.web else { return nil }
        return URL(string: "http://\(host):\(port)")
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw HudFleetServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HudFleetServiceError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    nonisolated private static func fetchResult<T: Decodable>(
        _ type: T.Type,
        from url: URL,
        decoder: JSONDecoder
    ) async -> Result<T, Error> {
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse else {
                throw HudFleetServiceError.invalidResponse
            }
            guard (200..<300).contains(http.statusCode) else {
                throw HudFleetServiceError.httpStatus(http.statusCode)
            }
            return .success(try decoder.decode(type, from: data))
        } catch {
            return .failure(error)
        }
    }

    private static func userFacingError(_ error: Error) -> String {
        if let hudError = error as? HudFleetServiceError {
            return hudError.localizedDescription
        }
        return error.localizedDescription
    }
}

enum HudFleetServiceError: LocalizedError {
    case invalidBrokerURL(String)
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidBrokerURL(let value):
            return "Invalid broker URL: \(value)"
        case .invalidResponse:
            return "Broker returned an invalid response"
        case .httpStatus(let status):
            return "Broker returned HTTP \(status)"
        }
    }
}
