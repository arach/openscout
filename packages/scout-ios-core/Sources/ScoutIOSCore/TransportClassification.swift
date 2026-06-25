// TransportClassification — relay route classification and gating helpers.
//
// Ported from apps/ios/Scout/Services/ConnectionManager.swift. Pure functions that
// classify a relay host into a TransportKind and decide which relay URLs are
// permitted by the user's route settings (Tailnet / OpenScout Network toggles).

import Foundation

// MARK: - String helper (ported from Models/Primitives.swift)

extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Transport classification

public enum TransportKind: String, Hashable, Sendable {
    /// RFC1918 private LAN: 10/8, 192.168/16, 172.16-31/12; link-local 169.254/16.
    case lan
    /// Tailscale CGNAT 100.64.0.0/10 or `*.ts.net` MagicDNS host.
    case tailnet
    /// OpenScout-managed front door hosts.
    case oscout
    /// Public IP / generic DNS hostname — neither LAN, Tailnet, nor OpenScout Network.
    case remote
    /// 127.0.0.0/8 loopback (mostly bridge-to-self, rare from phone).
    case loopback
    /// Not connected or no host known.
    case none

    public var label: String {
        switch self {
        case .lan: return "LAN"
        case .tailnet: return "TSN"
        case .oscout: return "OSN"
        case .remote: return "WAN"
        case .loopback: return "LOCAL"
        case .none: return ""
        }
    }
}

// MARK: - Route preferences

public enum BridgeRoutePreferences {
    public static let lanUserDefaultsKey = "scout.lan.enabled"
    public static let tailnetUserDefaultsKey = "scout.tsn.enabled"
    public static let openScoutNetworkUserDefaultsKey = "scout.osn.enabled"

    public static func lanRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
        if userDefaults.object(forKey: lanUserDefaultsKey) == nil {
            return true
        }
        return userDefaults.bool(forKey: lanUserDefaultsKey)
    }

    public static func setLanRoutingEnabled(_ enabled: Bool, userDefaults: UserDefaults = .standard) {
        userDefaults.set(enabled, forKey: lanUserDefaultsKey)
    }

    public static func tailnetRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
        if userDefaults.object(forKey: tailnetUserDefaultsKey) == nil {
            return true
        }
        return userDefaults.bool(forKey: tailnetUserDefaultsKey)
    }

    public static func setTailnetRoutingEnabled(_ enabled: Bool, userDefaults: UserDefaults = .standard) {
        userDefaults.set(enabled, forKey: tailnetUserDefaultsKey)
    }

    public static func openScoutNetworkRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
        userDefaults.bool(forKey: openScoutNetworkUserDefaultsKey)
    }

    public static func hasExplicitOpenScoutNetworkRoutingPreference(userDefaults: UserDefaults = .standard) -> Bool {
        userDefaults.object(forKey: openScoutNetworkUserDefaultsKey) != nil
    }

    public static func setOpenScoutNetworkRoutingEnabled(_ enabled: Bool, userDefaults: UserDefaults = .standard) {
        userDefaults.set(enabled, forKey: openScoutNetworkUserDefaultsKey)
    }
}

public struct BridgeRouteSummary: Equatable, Sendable {
    public let relayCount: Int
    public let allowedRelayCount: Int
    public let routeCounts: [TransportKind: Int]
    public let allowedRouteCounts: [TransportKind: Int]

    public var hasLANRelay: Bool { (routeCounts[.lan] ?? 0) > 0 }
    public var hasAllowedLANRelay: Bool { (allowedRouteCounts[.lan] ?? 0) > 0 }
    public var hasTailnetRelay: Bool { (routeCounts[.tailnet] ?? 0) > 0 }
    public var hasAllowedTailnetRelay: Bool { (allowedRouteCounts[.tailnet] ?? 0) > 0 }
    public var hasOpenScoutNetworkRelay: Bool { (routeCounts[.oscout] ?? 0) > 0 }
    public var hasAllowedOpenScoutNetworkRelay: Bool { (allowedRouteCounts[.oscout] ?? 0) > 0 }

    public init(relayURLs: [String], userDefaults: UserDefaults = .standard) {
        let routes = relayURLs.map(transportKind(forRelayURL:))
        let allowedRelayURLs = relayURLsAllowedByRouteSettings(relayURLs, userDefaults: userDefaults)
        let allowedRoutes = allowedRelayURLs.map(transportKind(forRelayURL:))
        relayCount = relayURLs.count
        allowedRelayCount = allowedRelayURLs.count
        routeCounts = Self.count(routes)
        allowedRouteCounts = Self.count(allowedRoutes)
    }

    private static func count(_ routes: [TransportKind]) -> [TransportKind: Int] {
        routes.reduce(into: [:]) { result, route in
            result[route, default: 0] += 1
        }
    }
}

public func classifyTransport(host: String) -> TransportKind {
    let lower = host.lowercased()
    // `localhost` and IPv6 loopback `::1` are local-only — the `a == 127` IPv4
    // check below never sees `::1` (it has no dotted quads), so name it here to
    // stay consistent with `isLocalOnlyRelayHost`.
    if lower == "localhost" || lower == "::1" {
        return .loopback
    }
    // Tailscale MagicDNS hostnames look like `<machine>.<tailnet>.ts.net`.
    if lower.hasSuffix(".ts.net") {
        return .tailnet
    }
    if isOpenScoutNetworkRelayHost(lower) {
        return .oscout
    }
    // Bonjour / mDNS hostnames (`<host>.local`) are by definition link-local LAN.
    if lower.hasSuffix(".local") {
        return .lan
    }

    let parts = host.split(separator: ".").compactMap { UInt8($0) }
    guard parts.count == 4 else {
        // Hostname or IPv6 we can't classify cheaply — fall through to remote.
        return .remote
    }

    let a = parts[0], b = parts[1]
    if a == 127 { return .loopback }
    if a == 10 { return .lan }
    if a == 192 && b == 168 { return .lan }
    if a == 172 && (16...31).contains(b) { return .lan }
    if a == 169 && b == 254 { return .lan }
    // Tailscale CGNAT: 100.64.0.0/10 → 100.64.x.x through 100.127.x.x.
    if a == 100 && (64...127).contains(b) { return .tailnet }
    return .remote
}

/// Classify a full relay URL string by parsing out its host.
public func transportKind(forRelayURL rawValue: String) -> TransportKind {
    guard let host = URLComponents(string: rawValue)?.host?.trimmedNonEmpty else {
        return .none
    }
    return classifyTransport(host: host)
}

/// Machine hostname suitable for UI labels — skips shared relay front doors like
/// `mesh.oscout.net` that would otherwise collapse to the word "mesh".
public func bridgeMachineHost(from relayURL: String) -> String? {
    guard let host = URLComponents(string: relayURL)?.host?.trimmedNonEmpty else {
        return nil
    }
    switch classifyTransport(host: host) {
    case .oscout, .loopback, .none:
        return nil
    default:
        return host
    }
}

// MARK: - Route helpers

func relayURLIndicatesLocalOnlyTailscaleRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isLocalOnlyRelayHost(host)
}

func relayURLUsesTailnetRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isTailnetRelayHost(host)
}

func relayURLUsesOpenScoutNetworkRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isOpenScoutNetworkRelayHost(host)
}

public func tailnetRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    BridgeRoutePreferences.tailnetRoutingEnabled(userDefaults: userDefaults)
}

public func openScoutNetworkRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    BridgeRoutePreferences.openScoutNetworkRoutingEnabled(userDefaults: userDefaults)
}

public func lanRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    BridgeRoutePreferences.lanRoutingEnabled(userDefaults: userDefaults)
}

func relayURLAllowedByRouteSettings(_ rawValue: String, userDefaults: UserDefaults = .standard) -> Bool {
    switch transportKind(forRelayURL: rawValue) {
    case .lan:
        return lanRoutingEnabled(userDefaults: userDefaults)
    case .tailnet:
        return tailnetRoutingEnabled(userDefaults: userDefaults)
    case .oscout:
        return openScoutNetworkRoutingEnabled(userDefaults: userDefaults)
    case .remote, .loopback, .none:
        return true
    }
}

public func relayURLsAllowedByRouteSettings(_ rawValues: [String], userDefaults: UserDefaults = .standard) -> [String] {
    rawValues.filter { relayURLAllowedByRouteSettings($0, userDefaults: userDefaults) }
}

func orderedRelayCandidates(
    discoveredRelayURLs: [String],
    storedRelayURLs: [String],
    userDefaults: UserDefaults = .standard
) -> [String] {
    let allowed = relayURLsAllowedByRouteSettings(
        discoveredRelayURLs + storedRelayURLs,
        userDefaults: userDefaults
    )
    let candidates = relayURLsIncludingInsecureLocalFallbacks(allowed)
    guard let primary = candidates.first else { return [] }
    return deduplicatedRelayURLs(primary: primary, fallbacks: Array(candidates.dropFirst()))
}

func orderedPairingRelayCandidates(
    discoveredRelayURLs: [String],
    payloadRelayURLs: [String],
    userDefaults: UserDefaults = .standard
) -> [String] {
    let allowedDiscovered = relayURLsAllowedByRouteSettings(
        discoveredRelayURLs,
        userDefaults: userDefaults
    )
    let candidates = relayURLsIncludingInsecureLocalFallbacks(allowedDiscovered + payloadRelayURLs)
    guard let primary = candidates.first else { return [] }
    return deduplicatedRelayURLs(primary: primary, fallbacks: Array(candidates.dropFirst()))
}

public func relayURLDependsOnTailscale(_ rawValue: String) -> Bool {
    relayURLUsesTailnetRoute(rawValue)
}

public func isTailscaleRouteNetworkFailure(_ error: Error) -> Bool {
    guard let urlError = error as? URLError else {
        return false
    }

    switch urlError.code {
    case .cannotFindHost,
         .cannotConnectToHost,
         .dnsLookupFailed,
         .networkConnectionLost,
         .notConnectedToInternet,
         .timedOut:
        return true
    default:
        return false
    }
}

/// Move the relay URL that just succeeded to the front of the candidate list so
/// the next connect attempt reuses it first. Ported verbatim from the donor.
func relayURLsPromotingSuccessfulRelay(_ successfulRelayURL: String, within relayURLs: [String]) -> [String] {
    let promoted = successfulRelayURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !promoted.isEmpty else {
        return relayURLsAllowedByRouteSettings(relayURLs)
    }
    return deduplicatedRelayURLs(primary: promoted, fallbacks: relayURLs)
}

func deduplicatedRelayURLs(primary: String, fallbacks: [String]) -> [String] {
    var seen = Set<String>()
    var urls: [String] = []

    for rawValue in [primary] + fallbacks {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, seen.insert(value).inserted else {
            continue
        }
        urls.append(value)
    }

    return urls
}

func relayURLsIncludingInsecureLocalFallbacks(_ relayURLs: [String]) -> [String] {
    relayURLs.flatMap { relayURL in
        guard let fallback = insecureLocalRelayFallback(for: relayURL) else {
            return [relayURL]
        }
        return [relayURL, fallback]
    }
}

private func insecureLocalRelayFallback(for rawValue: String) -> String? {
    guard var components = URLComponents(string: rawValue),
          components.scheme?.lowercased() == "wss" else {
        return nil
    }

    switch transportKind(forRelayURL: rawValue) {
    case .lan, .tailnet, .loopback:
        components.scheme = "ws"
        return components.url?.absoluteString
    case .oscout, .remote, .none:
        return nil
    }
}

func isLocalOnlyRelayHost(_ host: String) -> Bool {
    host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "0.0.0.0"
}

func isTailnetRelayHost(_ host: String) -> Bool {
    host.hasSuffix(".ts.net") || isTailscaleAddress(host)
}

func isOpenScoutNetworkRelayHost(_ host: String) -> Bool {
    host == "oscout.net" || host.hasSuffix(".oscout.net")
}

func isTailscaleAddress(_ host: String) -> Bool {
    let components = host.split(separator: ".")
    guard components.count == 4,
          let first = Int(components[0]),
          let second = Int(components[1]) else {
        return false
    }
    return first == 100 && (64...127).contains(second)
}
