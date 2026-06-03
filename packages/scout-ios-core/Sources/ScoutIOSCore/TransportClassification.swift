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

public enum TransportKind: String, Sendable {
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

public func classifyTransport(host: String) -> TransportKind {
    let lower = host.lowercased()
    if lower == "localhost" {
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

func tailnetRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    if userDefaults.object(forKey: "scout.tsn.enabled") == nil {
        return true
    }
    return userDefaults.bool(forKey: "scout.tsn.enabled")
}

func openScoutNetworkRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    userDefaults.bool(forKey: "scout.osn.enabled")
}

func relayURLAllowedByRouteSettings(_ rawValue: String, userDefaults: UserDefaults = .standard) -> Bool {
    if relayURLUsesTailnetRoute(rawValue) {
        return tailnetRoutingEnabled(userDefaults: userDefaults)
    }
    if relayURLUsesOpenScoutNetworkRoute(rawValue) {
        return openScoutNetworkRoutingEnabled(userDefaults: userDefaults)
    }
    return true
}

public func relayURLsAllowedByRouteSettings(_ rawValues: [String], userDefaults: UserDefaults = .standard) -> [String] {
    rawValues.filter { relayURLAllowedByRouteSettings($0, userDefaults: userDefaults) }
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
