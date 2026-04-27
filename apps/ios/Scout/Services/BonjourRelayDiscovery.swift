import Foundation
import os

final class BonjourRelayDiscovery: NSObject {
    static let serviceType = "_scout-pair._tcp."

    private static let logger = Logger(
        subsystem: "com.openscout.scout",
        category: "BonjourRelayDiscovery"
    )

    private let targetPublicKeyHex: String
    private let browser = NetServiceBrowser()
    private var resolvingServices: [String: NetService] = [:]
    private var discoveredRelayURLs: [String] = []
    private var continuation: CheckedContinuation<[String], Never>?
    private var timeoutTimer: Timer?

    init(publicKeyHex: String) {
        self.targetPublicKeyHex = publicKeyHex.lowercased()
        super.init()
        browser.delegate = self
        browser.includesPeerToPeer = true
    }

    @MainActor
    static func discoverRelayURLs(
        publicKeyHex: String,
        timeoutSeconds: Double = 1.5
    ) async -> [String] {
        let discovery = BonjourRelayDiscovery(publicKeyHex: publicKeyHex)
        return await discovery.start(timeoutSeconds: timeoutSeconds)
    }

    private func start(timeoutSeconds: Double) async -> [String] {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            browser.searchForServices(ofType: Self.serviceType, inDomain: "local.")

            timeoutTimer = Timer.scheduledTimer(withTimeInterval: max(0.1, timeoutSeconds), repeats: false) { [weak self] _ in
                self?.finish()
            }
        }
    }

    private func finish() {
        guard let continuation else { return }
        self.continuation = nil
        timeoutTimer?.invalidate()
        timeoutTimer = nil
        browser.stop()
        resolvingServices.removeAll()
        continuation.resume(returning: deduplicatedRelayURLs(discoveredRelayURLs))
    }

    private func serviceKey(_ service: NetService) -> String {
        service.name + service.type + service.domain
    }

    private func relayURL(for service: NetService) -> String? {
        guard service.port > 0 else { return nil }
        guard let txtData = service.txtRecordData() else { return nil }

        let txt = Self.txtDictionary(from: txtData)
        guard txt["pk"]?.lowercased() == targetPublicKeyHex else {
            return nil
        }

        let scheme = txt["scheme"] == "wss" ? "wss" : "ws"
        guard let hostName = service.hostName?.trimmedNonEmpty else { return nil }
        let host = normalize(hostName: hostName)
        guard !host.isEmpty else { return nil }

        return "\(scheme)://\(host):\(service.port)"
    }

    private func normalize(hostName: String) -> String {
        guard hostName.hasSuffix(".") else { return hostName }
        return String(hostName.dropLast())
    }

    private static func txtDictionary(from data: Data) -> [String: String] {
        NetService.dictionary(fromTXTRecord: data).reduce(into: [:]) { result, entry in
            guard let value = String(data: entry.value, encoding: .utf8) else {
                return
            }
            result[entry.key] = value
        }
    }
}

extension BonjourRelayDiscovery: NetServiceBrowserDelegate, NetServiceDelegate {
    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        let key = serviceKey(service)
        resolvingServices[key] = service
        service.delegate = self
        service.resolve(withTimeout: 3)
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didRemove service: NetService,
        moreComing: Bool
    ) {
        let key = serviceKey(service)
        resolvingServices.removeValue(forKey: key)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        let key = serviceKey(sender)
        resolvingServices.removeValue(forKey: key)

        guard let relayURL = relayURL(for: sender) else {
            return
        }

        Self.logger.notice("Discovered trusted Scout relay via Bonjour: \(relayURL, privacy: .public)")
        discoveredRelayURLs.append(relayURL)
        finish()
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        resolvingServices.removeValue(forKey: serviceKey(sender))
    }
}

private func deduplicatedRelayURLs(_ relayURLs: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for relayURL in relayURLs {
        let value = relayURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, seen.insert(value).inserted else {
            continue
        }
        result.append(value)
    }
    return result
}
