import AppKit
import CryptoKit
import Foundation
import ScoutAppCore

/// Routes `scout://` URLs to menu-app actions. Wired from AppDelegate's
/// NSAppleEventManager kAEGetURL handler.
///
/// Supported paths (host = `hud`):
///   scout://hud/show          — present the panel
///   scout://hud/hide          — dismiss
///   scout://hud/toggle        — flip current state
///   scout://hud/tab/<name>    — agents | activity | tail | sessions | assistant
///   scout://hud/size/<name>   — compact | medium | large  (also accepts s | m | l)
///
/// Supported paths (host = `services`):
///   scout://services/restart/broker  — restart the local broker
///   scout://services/restart/relay   — restart the pairing relay
///   scout://services/restart/web     — restart the web server
///   scout://services/restart/all     — restart broker, relay, and web
///
/// HUD actions are forwarded to Scout, which owns the panel and mirrors
/// current state to `/tmp/openscout-hud-state.json`.
@MainActor
enum HUDURLRouter {
    static func handle(url: URL) {
        guard url.scheme?.lowercased() == "scout" else { return }
        guard let host = url.host?.lowercased() else { return }

        let parts = url.pathComponents.filter { $0 != "/" }
        let head = parts.first?.lowercased()
        let tail = Array(parts.dropFirst())
        NSLog("[scout://] %@/%@/%@", host, head ?? "", tail.joined(separator: "/"))

        switch host {
        case "osn-auth":
            handleOpenScoutNetworkAuth(url: url)
        case "hud":
            guard let head else { return }
            forwardHUD(head: head, tail: tail)
        case "services":
            guard let head else { return }
            handleServices(url: url, head: head, tail: tail)
        default:
            NSLog("[scout://] unhandled host: %@", host)
        }
    }

    private static func forwardHUD(head: String, tail: [String]) {
        ScoutAppBridge.openHUD(command: head, value: tail.first)
    }

    private static func handleServices(url: URL, head: String, tail: [String]) {
        guard head == "restart" else {
            NSLog("[scout://] services: unhandled action %@", head)
            return
        }

        guard let target = tail.first?.lowercased() else {
            NSLog("[scout://] services/restart: missing target")
            return
        }

        guard verifyServiceSignature(action: head, target: target, url: url) else {
            NSLog("[scout://] services/restart: rejected unsigned or expired target %@", target)
            return
        }

        let controller = OpenScoutAppController.shared
        switch target {
        case "broker":
            controller.restartBroker()
        case "relay":
            controller.restartPairing()
        case "web":
            controller.restartWebApp()
        case "all":
            controller.restartBroker()
            controller.restartPairing()
            controller.restartWebApp()
        default:
            NSLog("[scout://] services/restart: unrecognized target %@", target)
        }
    }

    private static func handleOpenScoutNetworkAuth(url: URL) {
        do {
            try OpenScoutAppController.shared.completeOpenScoutNetworkAuth(from: url)
            NSLog("[scout://] OpenScout Network session saved")
        } catch {
            NSLog("[scout://] OpenScout Network auth failed: %@", error.localizedDescription)
        }
    }

    private static func verifyServiceSignature(action: String, target: String, url: URL) -> Bool {
        guard ["broker", "relay", "web", "all"].contains(target) else {
            return false
        }

        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }

        func queryValue(_ name: String) -> String? {
            components.queryItems?.first(where: { $0.name == name })?.value
        }

        guard
            let expires = queryValue("expires"),
            let nonce = queryValue("nonce"),
            let sig = queryValue("sig"),
            !expires.isEmpty,
            !nonce.isEmpty,
            !sig.isEmpty,
            let expiresMs = Double(expires),
            let secret = readServiceLinkSecret()
        else {
            return false
        }

        let nowMs = Date().timeIntervalSince1970 * 1000
        if expiresMs < nowMs || expiresMs > nowMs + 120_000 {
            return false
        }

        let payload = [
            "v1",
            "services",
            action,
            target,
            expires,
            nonce,
        ].joined(separator: "\n")
        let key = SymmetricKey(data: secret)
        let mac = HMAC<SHA256>.authenticationCode(
            for: Data(payload.utf8),
            using: key
        )
        let expected = base64URLEncoded(Data(mac))
        return timingSafeEqual(expected, sig)
    }

    private static func readServiceLinkSecret() -> Data? {
        let env = ProcessInfo.processInfo.environment
        let supportDirectory: URL
        if let raw = env["OPENSCOUT_SUPPORT_DIRECTORY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty {
            supportDirectory = URL(fileURLWithPath: raw)
        } else {
            supportDirectory = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library")
                .appendingPathComponent("Application Support")
                .appendingPathComponent("OpenScout")
        }

        let secretURL = supportDirectory.appendingPathComponent("service-link-signing.key")
        guard
            let raw = try? String(contentsOf: secretURL, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty
        else {
            return nil
        }
        return base64URLDecoded(raw)
    }

    private static func base64URLEncoded(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func base64URLDecoded(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: base64)
    }

    private static func timingSafeEqual(_ left: String, _ right: String) -> Bool {
        let leftBytes = Array(left.utf8)
        let rightBytes = Array(right.utf8)
        guard leftBytes.count == rightBytes.count else {
            return false
        }

        var diff: UInt8 = 0
        for index in leftBytes.indices {
            diff |= leftBytes[index] ^ rightBytes[index]
        }
        return diff == 0
    }
}
