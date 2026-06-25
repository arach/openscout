import Foundation
#if os(macOS)
import AppKit
#endif

public enum ScoutAppError {
    public static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    public static func userFacing(_ error: Error, connectionMessage: String? = nil) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNotConnectedToInternet, NSURLErrorTimedOut:
                if let connectionMessage {
                    return connectionMessage
                }
            default:
                break
            }
        }
        return error.localizedDescription
    }
}

public enum ScoutWeb {
    private static let fallbackURL = URL(string: "http://127.0.0.1:43120")!

    public static func baseURL() -> URL {
        if let url = ScoutEndpointResolver.webURLFromEnvironment() {
            return url
        }
        if let url = ScoutEndpointResolver.webURLFromHostInfo() {
            return url
        }
        if let url = ScoutEndpointResolver.webURLFromConfig() {
            return url
        }
        return fallbackURL
    }

    public static func url(path: String) -> URL? {
        var normalized = path
        if !normalized.hasPrefix("/") {
            normalized = "/" + normalized
        }
        return URL(string: normalized, relativeTo: baseURL())?.absoluteURL
    }

    public static func open(path: String) {
        #if os(macOS)
        guard let url = url(path: path) else { return }
        NSWorkspace.shared.open(url)
        #endif
    }
}

public enum ScoutBroker {
    private static let fallbackURL = URL(string: "http://127.0.0.1:43110")!

    public static func baseURL() -> URL {
        if let url = ScoutEndpointResolver.brokerURLFromEnvironment() {
            return url
        }
        if let url = ScoutEndpointResolver.brokerURLFromHostInfo() {
            return url
        }
        if let url = ScoutEndpointResolver.brokerURLFromConfig() {
            return url
        }
        return fallbackURL
    }

    /// Broker host/port as declared in `~/.openscout/config.json`, when present.
    ///
    /// scoutd resolves its broker target purely from `OPENSCOUT_BROKER_*`
    /// environment variables and never reads the unified config file, so callers
    /// invoking scoutd must forward these values explicitly. Returns `nil` when
    /// the config file is absent or does not pin a broker port.
    public static func configuredEndpoint() -> (host: String, port: Int)? {
        ScoutEndpointResolver.brokerEndpointFromConfig()
    }
}

private enum ScoutEndpointResolver {
    private struct OpenScoutConfig: Decodable {
        struct Ports: Decodable {
            let web: Int?
            let broker: Int?
        }

        let host: String?
        let ports: Ports?
    }

    private struct OpenScoutHostInfo: Decodable {
        struct Ports: Decodable {
            let broker: Int?
            let web: Int?
        }

        struct Service: Decodable {
            let url: String?
            let host: String?
            let port: Int?
        }

        struct Services: Decodable {
            let broker: Service?
            let web: Service?
        }

        let updatedAtMs: Double?
        let brokerUrl: String?
        let webUrl: String?
        let ports: Ports?
        let services: Services?
    }

    static func webURLFromEnvironment() -> URL? {
        let env = ProcessInfo.processInfo.environment

        for key in ["OPENSCOUT_WEB_URL", "OPENSCOUT_WEB_BUN_URL", "OPENSCOUT_WEB_PUBLIC_ORIGIN"] {
            guard let value = env[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  let url = httpURL(value) else {
                continue
            }
            return url
        }

        let portValue = env["OPENSCOUT_WEB_PORT"] ?? env["SCOUT_WEB_PORT"]
        guard let portText = portValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(portText),
              isValidPort(port) else {
            return nil
        }
        return URL(string: "http://\(clientHost(from: env["OPENSCOUT_WEB_HOST"])):\(port)")
    }

    static func webURLFromHostInfo() -> URL? {
        guard let info = readHostInfo() else { return nil }
        return urlFromHostInfo(
            explicitURL: info.webUrl,
            service: info.services?.web,
            port: info.ports?.web
        )
    }

    static func webURLFromConfig() -> URL? {
        guard let cfg = readConfig(),
              let port = cfg.ports?.web else {
            return nil
        }
        return URL(string: "http://\(clientHost(from: cfg.host)):\(port)")
    }

    static func brokerURLFromEnvironment() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if let value = env["OPENSCOUT_BROKER_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty,
           let url = httpURL(value) {
            return url
        }

        guard let portText = env["OPENSCOUT_BROKER_PORT"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(portText),
              isValidPort(port) else {
            return nil
        }
        return URL(string: "http://\(clientHost(from: env["OPENSCOUT_BROKER_HOST"])):\(port)")
    }

    static func brokerURLFromHostInfo() -> URL? {
        guard let info = readHostInfo() else { return nil }
        return urlFromHostInfo(
            explicitURL: info.brokerUrl,
            service: info.services?.broker,
            port: info.ports?.broker
        )
    }

    static func brokerURLFromConfig() -> URL? {
        guard let endpoint = brokerEndpointFromConfig() else {
            return nil
        }
        return URL(string: "http://\(endpoint.host):\(endpoint.port)")
    }

    static func brokerEndpointFromConfig() -> (host: String, port: Int)? {
        guard let cfg = readConfig(),
              let port = cfg.ports?.broker,
              isValidPort(port) else {
            return nil
        }
        return (clientHost(from: cfg.host), port)
    }

    static func httpURL(_ rawValue: String?) -> URL? {
        guard let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil else {
            return nil
        }
        return clientURL(from: url)
    }

    static func httpURL(host rawHost: String?, port: Int) -> URL? {
        guard isValidPort(port) else { return nil }
        var components = URLComponents()
        components.scheme = "http"
        components.host = clientHost(from: rawHost)
        components.port = port
        return components.url
    }

    private static func urlFromHostInfo(
        explicitURL: String?,
        service: OpenScoutHostInfo.Service?,
        port: Int?
    ) -> URL? {
        if let url = httpURL(explicitURL) {
            return url
        }

        if let url = httpURL(service?.url) {
            return url
        }

        if let servicePort = service?.port,
           let url = httpURL(host: service?.host, port: servicePort) {
            return url
        }

        if let port,
           let url = httpURL(host: service?.host, port: port) {
            return url
        }

        return nil
    }

    private static func readHostInfo() -> OpenScoutHostInfo? {
        let url = hostInfoFileURL()
        guard let data = try? Data(contentsOf: url),
              let info = try? JSONDecoder().decode(OpenScoutHostInfo.self, from: data),
              hostInfoIsFresh(info, fileURL: url) else {
            return nil
        }
        return info
    }

    private static func hostInfoFileURL() -> URL {
        supportDirectoryURL().appendingPathComponent(".host-info")
    }

    private static func supportDirectoryURL() -> URL {
        if let configured = ProcessInfo.processInfo.environment["OPENSCOUT_SUPPORT_DIRECTORY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !configured.isEmpty {
            return URL(fileURLWithPath: configured)
        }

        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("OpenScout")
    }

    private static func hostInfoIsFresh(_ info: OpenScoutHostInfo, fileURL: URL) -> Bool {
        let maxAge: TimeInterval = 24 * 60 * 60
        if let updatedAtMs = info.updatedAtMs {
            return Date().timeIntervalSince1970 - (updatedAtMs / 1000) <= maxAge
        }

        guard let values = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]),
              let modified = values.contentModificationDate else {
            return true
        }
        return Date().timeIntervalSince(modified) <= maxAge
    }

    private static func readConfig() -> OpenScoutConfig? {
        let path = ("~/.openscout/config.json" as NSString).expandingTildeInPath
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        return try? JSONDecoder().decode(OpenScoutConfig.self, from: data)
    }

    private static func clientHost(from rawHost: String?) -> String {
        guard let host = rawHost?.trimmingCharacters(in: .whitespacesAndNewlines),
              !host.isEmpty,
              host != "0.0.0.0",
              host != "::" else {
            return "127.0.0.1"
        }
        return host
    }

    private static func isValidPort(_ port: Int) -> Bool {
        (1...65_535).contains(port)
    }

    private static func clientURL(from url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        components.host = clientHost(from: components.host)
        return components.url ?? url
    }
}
