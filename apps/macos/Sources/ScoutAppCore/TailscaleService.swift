import AppKit
import Foundation
import os.log

protocol TailscaleStatusProbeClient: Sendable {
    var socketPath: String { get }
    func socketExists() -> Bool
    func supportsProbe(_ probeId: String, forceRefresh: Bool) async throws -> Bool
    func snapshot(probeId: String, key: String?, maxAgeMs: UInt64) async throws -> ScoutdProbeSnapshot
}

extension ScoutdProbeClient: TailscaleStatusProbeClient {}

@MainActor
public final class TailscaleService {
    private enum ProbeLoadResult {
        case state(TailscaleViewState)
        case fallback(String)
    }

    private static let tailscaleStatusProbeId = "tailscale.status"
    private static let defaultProbeMaxAgeMs: UInt64 = 30_000

    private let fileManager: FileManager
    private let environment: [String: String]
    private let probeClient: any TailscaleStatusProbeClient
    private let commandRunner: (CommandDescriptor, TimeInterval) async throws -> CommandResult
    private let appURLProvider: (@MainActor () -> URL?)?
    private let cliURLProvider: (@MainActor () throws -> URL)?
    private let log = Logger(subsystem: "dev.openscout.menu", category: "tailscale")

    private var forceFreshProbeReason: String?
    private var lastLoggedFallbackReason: String?

    public convenience init() {
        self.init(
            probeClient: ScoutdProbeClient(),
            commandRunner: { descriptor, timeout in
                try await CommandRunner.run(descriptor, timeout: timeout)
            },
            environment: ProcessInfo.processInfo.environment,
            fileManager: .default,
            appURLProvider: nil,
            cliURLProvider: nil
        )
    }

    init(
        probeClient: any TailscaleStatusProbeClient,
        commandRunner: @escaping (CommandDescriptor, TimeInterval) async throws -> CommandResult,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        appURLProvider: (@MainActor () -> URL?)? = nil,
        cliURLProvider: (@MainActor () throws -> URL)? = nil
    ) {
        self.probeClient = probeClient
        self.commandRunner = commandRunner
        self.environment = environment
        self.fileManager = fileManager
        self.appURLProvider = appURLProvider
        self.cliURLProvider = cliURLProvider
    }

    public func loadState() async -> TailscaleViewState {
        let appInstalled = tailscaleAppURL() != nil
        let maxAgeMs = consumeProbeMaxAgeMs()

        switch await loadProbeState(appInstalled: appInstalled, maxAgeMs: maxAgeMs) {
        case .state(let state):
            noteProbeHealthy()
            return state
        case .fallback(let reason):
            noteProbeFallback(reason)
            return await loadLocalExecState(appInstalled: appInstalled, probeFallbackReason: reason)
        }
    }

    public func openApp() async throws -> TailscaleViewState {
        guard tailscaleAppURL() != nil else {
            throw CommandRunnerError.launchFailed("Tailscale.app is not installed on this machine.")
        }

        let result = try await commandRunner(
            CommandDescriptor(
                executableURL: URL(fileURLWithPath: "/usr/bin/open"),
                arguments: ["-a", "Tailscale"]
            ),
            60
        )

        guard result.exitCode == 0 else {
            throw CommandRunnerError.nonZeroExit(
                result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr
            )
        }

        invalidateProbe(reason: "tailscale.open")
        for _ in 0..<8 {
            try? await Task.sleep(for: .milliseconds(250))
            let state = await loadState()
            if state.running {
                return state
            }
        }

        invalidateProbe(reason: "tailscale.open")
        return await loadState()
    }

    public func invalidateProbe(reason: String) {
        forceFreshProbeReason = reason
    }

    private func loadProbeState(appInstalled: Bool, maxAgeMs: UInt64) async -> ProbeLoadResult {
        guard probeClient.socketExists() else {
            return .fallback("scoutd probe socket not found at \(probeClient.socketPath)")
        }

        do {
            let supported = try await probeClient.supportsProbe(Self.tailscaleStatusProbeId, forceRefresh: false)
            guard supported else {
                return .fallback("scoutd does not advertise \(Self.tailscaleStatusProbeId)")
            }

            let snapshot = try await probeClient.snapshot(
                probeId: Self.tailscaleStatusProbeId,
                key: nil,
                maxAgeMs: maxAgeMs
            )

            if let error = snapshot.error {
                return .state(unavailableState(
                    detail: error.message,
                    cliPath: nil,
                    appInstalled: appInstalled,
                    statusSource: "scoutd",
                    probeFallbackReason: nil,
                    probeSocketPath: probeClient.socketPath,
                    probeDaemonVersion: snapshot.daemonVersion,
                    probeGeneratedAtMs: snapshot.generatedAt
                ))
            }

            guard let valueData = snapshot.valueData else {
                return .state(unavailableState(
                    detail: "Tailscale status is unavailable on this machine.",
                    cliPath: nil,
                    appInstalled: appInstalled,
                    statusSource: "scoutd",
                    probeFallbackReason: nil,
                    probeSocketPath: probeClient.socketPath,
                    probeDaemonVersion: snapshot.daemonVersion,
                    probeGeneratedAtMs: snapshot.generatedAt
                ))
            }

            do {
                return .state(try decodeState(
                    data: valueData,
                    cliPath: nil,
                    appInstalled: appInstalled,
                    statusSource: "scoutd",
                    probeFallbackReason: nil,
                    probeSocketPath: probeClient.socketPath,
                    probeDaemonVersion: snapshot.daemonVersion,
                    probeGeneratedAtMs: snapshot.generatedAt
                ))
            } catch {
                return .fallback("scoutd returned malformed tailscale.status: \(error.localizedDescription)")
            }
        } catch {
            return .fallback("scoutd probe request failed: \(error.localizedDescription)")
        }
    }

    private func loadLocalExecState(
        appInstalled: Bool,
        probeFallbackReason: String
    ) async -> TailscaleViewState {
        do {
            let cliURL = try resolveCLIURL()
            let result = try await commandRunner(
                CommandDescriptor(
                    executableURL: cliURL,
                    arguments: ["status", "--json"]
                ),
                60
            )

            guard result.exitCode == 0 else {
                return unavailableState(
                    detail: result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr,
                    cliPath: cliURL.path,
                    appInstalled: appInstalled,
                    statusSource: "local-exec",
                    probeFallbackReason: probeFallbackReason
                )
            }

            return try decodeState(
                data: Data(result.stdout.utf8),
                cliPath: cliURL.path,
                appInstalled: appInstalled,
                statusSource: "local-exec",
                probeFallbackReason: probeFallbackReason
            )
        } catch {
            return unavailableState(
                detail: error.localizedDescription,
                cliPath: nil,
                appInstalled: appInstalled,
                statusSource: "local-exec",
                probeFallbackReason: probeFallbackReason
            )
        }
    }

    private func decodeState(
        data: Data,
        cliPath: String?,
        appInstalled: Bool,
        statusSource: String,
        probeFallbackReason: String?,
        probeSocketPath: String? = nil,
        probeDaemonVersion: String? = nil,
        probeGeneratedAtMs: UInt64? = nil
    ) throws -> TailscaleViewState {
        guard let root = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any] else {
            throw CommandRunnerError.nonZeroExit("Tailscale returned malformed status JSON.")
        }

        let summaryPayload = root["backendState"] != nil || root["peers"] != nil || root["self"] != nil
        let backendState = summaryPayload
            ? (root["backendState"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            : (root["BackendState"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let health = (root[summaryPayload ? "health" : "Health"] as? [Any])?.compactMap { $0 as? String } ?? []

        let dnsName: String?
        let address: String?
        let peerCount: Int
        let onlinePeerCount: Int
        let running: Bool

        if summaryPayload {
            let selfPayload = root["self"] as? [String: Any]
            dnsName = normalizeDNSName(selfPayload?["dnsName"] as? String)
            address = (selfPayload?["addresses"] as? [Any])?.compactMap { $0 as? String }.first
            let peers = root["peers"] as? [[String: Any]] ?? []
            peerCount = peers.count
            onlinePeerCount = peers.filter { ($0["online"] as? Bool) == true }.count
            running = (root["running"] as? Bool)
                ?? (backendState?.caseInsensitiveCompare("running") == .orderedSame)
        } else {
            let selfPayload = root["Self"] as? [String: Any]
            dnsName = normalizeDNSName(selfPayload?["DNSName"] as? String)
            address = (selfPayload?["TailscaleIPs"] as? [Any])?.compactMap { $0 as? String }.first
            let peers = (root["Peer"] as? [String: Any])?.values.compactMap { $0 as? [String: Any] } ?? []
            peerCount = peers.count
            onlinePeerCount = peers.filter { ($0["Online"] as? Bool) == true }.count
            running = backendState?.caseInsensitiveCompare("running") == .orderedSame
        }

        let statusLabel = running
            ? "Running"
            : ((backendState?.isEmpty == false ? backendState : nil) ?? "Stopped")
        let statusDetail = running
            ? "\(onlinePeerCount)/\(peerCount) visible peers online."
            : (health.first ?? "Cached peers may appear, but Tailscale is not running on this machine.")

        return TailscaleViewState(
            status: running ? "running" : statusLabel.lowercased(),
            statusLabel: statusLabel,
            statusDetail: statusDetail,
            backendState: backendState,
            dnsName: dnsName,
            address: address,
            peerCount: peerCount,
            onlinePeerCount: onlinePeerCount,
            health: health,
            cliPath: cliPath,
            available: true,
            running: running,
            controlAvailable: appInstalled,
            controlHint: appInstalled ? nil : "Install Tailscale.app to launch it from OpenScout.",
            statusSource: statusSource,
            probeFallbackReason: probeFallbackReason,
            probeSocketPath: probeSocketPath,
            probeDaemonVersion: probeDaemonVersion,
            probeGeneratedAtMs: probeGeneratedAtMs
        )
    }

    private func unavailableState(
        detail: String,
        cliPath: String?,
        appInstalled: Bool,
        statusSource: String,
        probeFallbackReason: String?,
        probeSocketPath: String? = nil,
        probeDaemonVersion: String? = nil,
        probeGeneratedAtMs: UInt64? = nil
    ) -> TailscaleViewState {
        TailscaleViewState(
            status: "unavailable",
            statusLabel: "Unavailable",
            statusDetail: detail.isEmpty ? "Tailscale status is unavailable on this machine." : detail,
            backendState: nil,
            dnsName: nil,
            address: nil,
            peerCount: 0,
            onlinePeerCount: 0,
            health: [],
            cliPath: cliPath,
            available: false,
            running: false,
            controlAvailable: appInstalled,
            controlHint: appInstalled ? nil : "Install Tailscale.app to launch it from OpenScout.",
            statusSource: statusSource,
            probeFallbackReason: probeFallbackReason,
            probeSocketPath: probeSocketPath,
            probeDaemonVersion: probeDaemonVersion,
            probeGeneratedAtMs: probeGeneratedAtMs
        )
    }

    private func consumeProbeMaxAgeMs() -> UInt64 {
        guard let reason = forceFreshProbeReason else {
            return Self.defaultProbeMaxAgeMs
        }
        forceFreshProbeReason = nil
        log.debug("forcing fresh tailscale.status probe after \(reason, privacy: .public)")
        return 0
    }

    private func noteProbeFallback(_ reason: String) {
        guard lastLoggedFallbackReason != reason else { return }
        lastLoggedFallbackReason = reason
        log.info("Tailscale status falling back to local exec: \(reason, privacy: .public)")
    }

    private func noteProbeHealthy() {
        guard lastLoggedFallbackReason != nil else { return }
        log.info("Tailscale status using scoutd probe socket")
        lastLoggedFallbackReason = nil
    }

    private func tailscaleAppURL() -> URL? {
        if let appURLProvider {
            return appURLProvider()
        }

        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "io.tailscale.ipn.macos") {
            return url
        }

        let fallback = "/Applications/Tailscale.app"
        guard fileManager.fileExists(atPath: fallback) else {
            return nil
        }

        return URL(fileURLWithPath: fallback)
    }

    private func resolveCLIURL() throws -> URL {
        if let cliURLProvider {
            return try cliURLProvider()
        }

        let pathResolver = OpenScoutPathResolver(environment: environment, fileManager: fileManager)
        for key in ["OPENSCOUT_TAILSCALE_BIN", "TAILSCALE_BIN"] {
            if let explicit = pathResolver.resolvePath(fromEnvironmentKey: key),
               fileManager.isExecutableFile(atPath: explicit.path) {
                return explicit.standardizedFileURL
            }
        }

        let candidates = [
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]

        for candidate in candidates where fileManager.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }

        throw CommandRunnerError.launchFailed("Tailscale CLI is unavailable on this machine.")
    }

    private func normalizeDNSName(_ value: String?) -> String? {
        guard var value, !value.isEmpty else {
            return nil
        }

        while value.hasSuffix(".") {
            value.removeLast()
        }

        return value
    }
}
