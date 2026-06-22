import Foundation
import Dispatch
import os

/// A Scout Mac discovered on the local network via its `_oscout-pair._tcp`
/// Bonjour advertisement. Unlike a QR payload, this carries only the Mac's
/// stable identity + relay coordinates (the per-session pairing `room` is not in
/// the TXT record); the app fetches the live payload from the Mac's `/pair`
/// endpoint once the operator taps a target.
public struct DiscoveredScoutMac: Sendable, Equatable, Identifiable {
    public let publicKeyHex: String
    public let fingerprint: String
    public let hostName: String
    public let relayPort: Int
    public let scheme: String

    public var id: String { publicKeyHex }

    public init(publicKeyHex: String, fingerprint: String, hostName: String, relayPort: Int, scheme: String) {
        self.publicKeyHex = publicKeyHex
        self.fingerprint = fingerprint
        self.hostName = hostName
        self.relayPort = relayPort
        self.scheme = scheme
    }
}

/// Browses `_oscout-pair._tcp` and returns every Scout Mac advertising on the
/// LAN — the sibling of `BonjourRelayDiscovery`, which filters to one already
/// known public key. This one knows no key in advance (the whole point of the
/// "Pair with this Mac" experience is that nothing was scanned yet), so it
/// collects all responders within a window instead of stopping at the first.
public final class BonjourMacDiscovery: NSObject, @unchecked Sendable {
    public static let serviceType = BonjourRelayDiscovery.serviceType

    private static let logger = Logger(
        subsystem: "app.openscout.scout.ioscore",
        category: "BonjourMacDiscovery"
    )

    private var browsers: [NetServiceBrowser] = []
    private var resolvingServices: [String: NetService] = [:]
    private var discovered: [String: DiscoveredScoutMac] = [:]
    private var continuation: CheckedContinuation<[DiscoveredScoutMac], Never>?

    public override init() {
        super.init()
    }

    @MainActor
    public static func discover(timeoutSeconds: Double = 2.5) async -> [DiscoveredScoutMac] {
        await BonjourMacDiscovery().start(timeoutSeconds: timeoutSeconds)
    }

    private func start(timeoutSeconds: Double) async -> [DiscoveredScoutMac] {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { [weak self] in
                guard let self else {
                    continuation.resume(returning: [])
                    return
                }
                self.continuation = continuation
                for serviceType in BonjourRelayDiscovery.serviceTypes {
                    let browser = NetServiceBrowser()
                    browser.delegate = self
                    browser.includesPeerToPeer = true
                    self.browsers.append(browser)
                    browser.searchForServices(ofType: serviceType, inDomain: "local.")
                }
                // Collect every responder for the full window — unlike the
                // single-target browser, we never finish early on a resolve.
                DispatchQueue.main.asyncAfter(deadline: .now() + max(0.3, timeoutSeconds)) { [weak self] in
                    self?.finish()
                }
            }
        }
    }

    private func finish() {
        guard let continuation else { return }
        self.continuation = nil
        browsers.forEach { $0.stop() }
        browsers.removeAll()
        resolvingServices.removeAll()
        let macs = discovered.values.sorted { $0.hostName.localizedCaseInsensitiveCompare($1.hostName) == .orderedAscending }
        continuation.resume(returning: macs)
    }

    private func serviceKey(_ service: NetService) -> String {
        service.name + service.type + service.domain
    }
}

extension BonjourMacDiscovery: NetServiceBrowserDelegate, NetServiceDelegate {
    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        let key = serviceKey(service)
        resolvingServices[key] = service
        service.delegate = self
        service.resolve(withTimeout: 3)
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        resolvingServices.removeValue(forKey: serviceKey(service))
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        resolvingServices.removeValue(forKey: serviceKey(sender))

        guard sender.port > 0,
              let txtData = sender.txtRecordData() else { return }
        let txt = Self.txtDictionary(from: txtData)
        guard let publicKey = txt["pk"]?.lowercased(), !publicKey.isEmpty,
              let host = sender.hostName?.trimmedNonEmpty else { return }

        let fingerprint = txt["fp"]?.trimmedNonEmpty ?? String(publicKey.prefix(16))
        let scheme = txt["scheme"] == "wss" ? "wss" : "ws"
        let mac = DiscoveredScoutMac(
            publicKeyHex: publicKey,
            fingerprint: fingerprint,
            hostName: Self.normalizedHostName(host),
            relayPort: sender.port,
            scheme: scheme
        )
        // Key by public key so a Mac advertised on multiple interfaces collapses
        // to one row.
        discovered[publicKey] = mac
        Self.logger.notice("Discovered Scout Mac via Bonjour: \(mac.hostName, privacy: .public)")
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        resolvingServices.removeValue(forKey: serviceKey(sender))
    }

    private static func txtDictionary(from data: Data) -> [String: String] {
        NetService.dictionary(fromTXTRecord: data).reduce(into: [:]) { result, entry in
            guard let value = String(data: entry.value, encoding: .utf8) else { return }
            result[entry.key] = value
        }
    }

    private static func normalizedHostName(_ hostName: String) -> String {
        hostName.hasSuffix(".") ? String(hostName.dropLast()) : hostName
    }
}
