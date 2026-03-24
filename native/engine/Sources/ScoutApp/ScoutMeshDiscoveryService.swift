import Foundation

enum ScoutMeshDiscoveryState: Equatable {
    case inactive
    case scanning
    case ready
    case unavailable
    case failed

    var title: String {
        switch self {
        case .inactive:
            return "Idle"
        case .scanning:
            return "Scanning"
        case .ready:
            return "Ready"
        case .unavailable:
            return "Unavailable"
        case .failed:
            return "Error"
        }
    }
}

struct ScoutMeshNode: Identifiable, Equatable {
    let id: String
    let meshID: String
    let name: String
    let hostName: String?
    let brokerURL: URL
    let advertiseScope: String
    let capabilities: [String]
    let lastSeenAt: Date?
    let registeredAt: Date
    let isLocal: Bool

    var displayHost: String {
        hostName ?? brokerURL.host() ?? brokerURL.absoluteString
    }

    var brokerLabel: String {
        if let host = brokerURL.host() {
            return "\(host):\(brokerURL.port ?? 65556)"
        }

        return brokerURL.absoluteString
    }

    var detail: String {
        let scope = advertiseScope == "mesh" ? "mesh" : "local"
        if isLocal {
            return "Local broker · \(scope)"
        }

        return "Broker online · \(scope)"
    }
}

struct ScoutMeshSnapshot {
    let nodes: [ScoutMeshNode]
    let tailscalePeerCount: Int
    let brokerPort: Int
    let localBrokerReachable: Bool
    let tailscaleAvailable: Bool
    let state: ScoutMeshDiscoveryState
    let detail: String
    let lastError: String?
    let probes: [ScoutMeshProbeResult]
}

struct ScoutMeshProbeResult: Identifiable, Equatable {
    let target: String
    let detail: String
    let success: Bool

    var id: String {
        target
    }
}

actor ScoutMeshDiscoveryService {
    private let brokerPort: Int
    private let session: URLSession

    init(brokerPort: Int? = nil) {
        self.brokerPort = brokerPort ?? Self.resolvedBrokerPort()

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 1.25
        configuration.timeoutIntervalForResource = 2.0
        self.session = URLSession(configuration: configuration)
    }

    func discover() async -> ScoutMeshSnapshot {
        let localNode = await probeLocalBroker()
        let localBrokerReachable = localNode != nil

        do {
            let peers = try await readTailscalePeers()
            let candidates = buildSeedURLs(from: peers)
            let outcomes = await probeSeedURLs(candidates)
            let remoteNodes = outcomes.compactMap(\.node)
            let probes = outcomes.map(\.probe)
            let mergedNodes = mergeNodes(localNode: localNode, remoteNodes: remoteNodes)
            let detail: String

            if mergedNodes.isEmpty {
                detail = peers.isEmpty
                    ? "Tailscale is available, but there are no online peers to scan."
                    : "Scanned \(peers.count) online peer\(peers.count == 1 ? "" : "s"), but no brokers answered on port \(brokerPort)."
            } else {
                detail = "Found \(mergedNodes.count) broker node\(mergedNodes.count == 1 ? "" : "s") after scanning \(peers.count) online peer\(peers.count == 1 ? "" : "s")."
            }

            return ScoutMeshSnapshot(
                nodes: mergedNodes,
                tailscalePeerCount: peers.count,
                brokerPort: brokerPort,
                localBrokerReachable: localBrokerReachable,
                tailscaleAvailable: true,
                state: .ready,
                detail: detail,
                lastError: nil,
                probes: probes
            )
        } catch {
            let message = friendlyErrorMessage(for: error)
            let nodes = localNode.map { [$0] } ?? []
            let state: ScoutMeshDiscoveryState = nodes.isEmpty ? .unavailable : .failed
            let detail = nodes.isEmpty
                ? message
                : "Local broker is reachable, but mesh discovery failed: \(message)"

            return ScoutMeshSnapshot(
                nodes: nodes,
                tailscalePeerCount: 0,
                brokerPort: brokerPort,
                localBrokerReachable: localBrokerReachable,
                tailscaleAvailable: false,
                state: state,
                detail: detail,
                lastError: message,
                probes: []
            )
        }
    }

    private func probeLocalBroker() async -> ScoutMeshNode? {
        let candidates = [
            URL(string: "http://127.0.0.1:\(brokerPort)"),
            URL(string: "http://localhost:\(brokerPort)"),
        ]

        for candidate in candidates.compactMap({ $0 }) {
            if let node = await probeBroker(at: candidate, isLocal: true) {
                return node
            }
        }

        return nil
    }

    private func probeSeedURLs(_ seeds: [URL]) async -> [ScoutMeshProbeOutcome] {
        await withTaskGroup(of: ScoutMeshProbeOutcome.self) { group in
            for seed in seeds {
                group.addTask { [session] in
                    await Self.probeBroker(at: seed, session: session, isLocal: false)
                }
            }

            var outcomes: [ScoutMeshProbeOutcome] = []
            for await outcome in group {
                outcomes.append(outcome)
            }

            return outcomes.sorted { lhs, rhs in
                lhs.probe.target.localizedCaseInsensitiveCompare(rhs.probe.target) == .orderedAscending
            }
        }
    }

    private func buildSeedURLs(from peers: [ScoutTailscalePeer]) -> [URL] {
        let rawSeeds = peers.flatMap { peer in
            candidateSeeds(for: peer)
        }

        return Array(Set(rawSeeds))
            .compactMap { value in
                seedURL(for: value)
            }
            .sorted { lhs, rhs in
                lhs.absoluteString < rhs.absoluteString
            }
    }

    private func mergeNodes(localNode: ScoutMeshNode?, remoteNodes: [ScoutMeshNode]) -> [ScoutMeshNode] {
        var byID: [String: ScoutMeshNode] = [:]

        for node in remoteNodes {
            byID[node.id] = node
        }

        if let localNode {
            byID[localNode.id] = localNode
        }

        return byID.values.sorted { lhs, rhs in
            if lhs.isLocal != rhs.isLocal {
                return lhs.isLocal
            }

            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    private func readTailscalePeers() async throws -> [ScoutTailscalePeer] {
        let binary = resolvedTailscaleBinary()
        let data = try await runCommand(arguments: [binary, "status", "--json"])
        let status = try JSONDecoder().decode(ScoutTailscaleStatus.self, from: data)

        return status.peers.values
            .filter { $0.online ?? false }
            .map { peer in
                ScoutTailscalePeer(
                    name: peer.hostName ?? "peer",
                    dnsName: peer.dnsName,
                    addresses: peer.addresses ?? []
                )
            }
            .sorted { lhs, rhs in
                lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    private func runCommand(arguments: [String]) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                process.executableURL = URL(filePath: "/usr/bin/env")
                process.arguments = arguments

                let outputPipe = Pipe()
                process.standardOutput = outputPipe
                process.standardError = outputPipe

                do {
                    try process.run()
                    process.waitUntilExit()
                    let data = outputPipe.fileHandleForReading.readDataToEndOfFile()

                    guard process.terminationStatus == 0 else {
                        let output = String(data: data, encoding: .utf8)?
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        let detail = output?.isEmpty == false ? output! : "command exited with status \(process.terminationStatus)"
                        continuation.resume(throwing: NSError(
                            domain: "OpenScout.Mesh",
                            code: Int(process.terminationStatus),
                            userInfo: [NSLocalizedDescriptionKey: detail]
                        ))
                        return
                    }

                    continuation.resume(returning: data)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func friendlyErrorMessage(for error: Error) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)

        if message.contains("No such file") || message.contains("command not found") {
            return "Tailscale CLI is not installed or not available on PATH."
        }

        if message.contains("status --json") {
            return "Tailscale CLI failed while reading peer status."
        }

        return message.isEmpty ? "Mesh discovery failed." : message
    }

    private func normalizeSeed(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    private func candidateSeeds(for peer: ScoutTailscalePeer) -> [String] {
        var values: [String] = []

        if let dnsName = peer.dnsName {
            let normalized = normalizeSeed(dnsName)
            if !normalized.isEmpty {
                values.append(normalized)
            }
        }

        for address in peer.addresses {
            let normalized = normalizeSeed(address)
            if !normalized.isEmpty {
                values.append(normalized)
            }
        }

        if values.isEmpty {
            let normalized = normalizeSeed(peer.name)
            if isValidHostSeed(normalized) {
                values.append(normalized)
            }
        }

        return values
    }

    private func seedURL(for seed: String) -> URL? {
        guard !seed.isEmpty else {
            return nil
        }

        if seed.contains(":") && !seed.contains("[") {
            return URL(string: "http://[\(seed)]:\(brokerPort)")
        }

        return URL(string: "http://\(seed):\(brokerPort)")
    }

    private func isValidHostSeed(_ seed: String) -> Bool {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.")
        return !seed.isEmpty && seed.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func probeBroker(at baseURL: URL, session: URLSession, isLocal: Bool) async -> ScoutMeshProbeOutcome {
        var request = URLRequest(url: baseURL.appending(path: "v1").appending(path: "node"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 1.25
        let target = baseURL.host() ?? baseURL.absoluteString

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  200 ..< 300 ~= httpResponse.statusCode else {
                return ScoutMeshProbeOutcome(
                    probe: ScoutMeshProbeResult(
                        target: target,
                        detail: "HTTP \(String(describing: (response as? HTTPURLResponse)?.statusCode ?? 0))",
                        success: false
                    ),
                    node: nil
                )
            }

            let node = try JSONDecoder().decode(ScoutBrokerNodeRecord.self, from: data)
            return ScoutMeshProbeOutcome(
                probe: ScoutMeshProbeResult(
                    target: target,
                    detail: "Broker responded as \(node.name)",
                    success: true
                ),
                node: ScoutMeshNode(
                    id: node.id,
                    meshID: node.meshID,
                    name: node.name,
                    hostName: node.hostName,
                    brokerURL: node.brokerURL.flatMap(URL.init(string:)) ?? baseURL,
                    advertiseScope: node.advertiseScope,
                    capabilities: node.capabilities ?? [],
                    lastSeenAt: node.lastSeenAt.flatMap(Self.dateFromMilliseconds),
                    registeredAt: Self.dateFromMilliseconds(node.registeredAt),
                    isLocal: isLocal
                )
            )
        } catch {
            return ScoutMeshProbeOutcome(
                probe: ScoutMeshProbeResult(
                    target: target,
                    detail: shortenedProbeError(error.localizedDescription),
                    success: false
                ),
                node: nil
            )
        }
    }

    private func probeBroker(at baseURL: URL, isLocal: Bool) async -> ScoutMeshNode? {
        let outcome = await Self.probeBroker(at: baseURL, session: session, isLocal: isLocal)
        return outcome.node
    }

    private static func dateFromMilliseconds(_ milliseconds: Double) -> Date {
        Date(timeIntervalSince1970: milliseconds / 1000)
    }

    private static func resolvedBrokerPort() -> Int {
        let raw = ProcessInfo.processInfo.environment["OPENSCOUT_BROKER_PORT"] ?? "65556"
        return Int(raw) ?? 65556
    }

    private func resolvedTailscaleBinary() -> String {
        if let override = ProcessInfo.processInfo.environment["OPENSCOUT_TAILSCALE_BIN"],
           !override.isEmpty {
            return override
        }

        let candidates = [
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }

        return "tailscale"
    }

    private static func shortenedProbeError(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("Connection refused") {
            return "Connection refused"
        }
        if trimmed.contains("timed out") {
            return "Timed out"
        }
        if trimmed.contains("cannot find host") || trimmed.contains("could not be found") {
            return "Host lookup failed"
        }
        return trimmed.isEmpty ? "Probe failed" : trimmed
    }
}

private struct ScoutTailscalePeer {
    let name: String
    let dnsName: String?
    let addresses: [String]
}

private struct ScoutTailscaleStatus: Decodable {
    let peers: [String: ScoutTailscalePeerRecord]

    private enum CodingKeys: String, CodingKey {
        case peers = "Peer"
    }
}

private struct ScoutTailscalePeerRecord: Decodable {
    let hostName: String?
    let dnsName: String?
    let addresses: [String]?
    let online: Bool?

    private enum CodingKeys: String, CodingKey {
        case hostName = "HostName"
        case dnsName = "DNSName"
        case addresses = "TailscaleIPs"
        case online = "Online"
    }
}

private struct ScoutBrokerNodeRecord: Decodable {
    let id: String
    let meshID: String
    let name: String
    let hostName: String?
    let advertiseScope: String
    let brokerURL: String?
    let capabilities: [String]?
    let lastSeenAt: Double?
    let registeredAt: Double

    private enum CodingKeys: String, CodingKey {
        case id
        case meshID = "meshId"
        case name
        case hostName
        case advertiseScope
        case brokerURL = "brokerUrl"
        case capabilities
        case lastSeenAt
        case registeredAt
    }
}

private struct ScoutMeshProbeOutcome {
    let probe: ScoutMeshProbeResult
    let node: ScoutMeshNode?
}
