import AppKit
import Foundation

@MainActor
struct TailscaleService {
    private let fileManager = FileManager.default

    func loadState() async -> OpenScoutAppController.TailscaleViewState {
        let appInstalled = tailscaleAppURL() != nil

        do {
            let cliURL = try resolveCLIURL()
            let result = try await CommandRunner.run(
                CommandDescriptor(
                    executableURL: cliURL,
                    arguments: ["status", "--json"]
                )
            )

            guard result.exitCode == 0 else {
                return unavailableState(
                    detail: result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr,
                    cliPath: cliURL.path,
                    appInstalled: appInstalled
                )
            }

            return try decodeState(
                data: Data(result.stdout.utf8),
                cliPath: cliURL.path,
                appInstalled: appInstalled
            )
        } catch {
            return unavailableState(
                detail: error.localizedDescription,
                cliPath: nil,
                appInstalled: appInstalled
            )
        }
    }

    func openApp() async throws -> OpenScoutAppController.TailscaleViewState {
        guard tailscaleAppURL() != nil else {
            throw CommandRunnerError.launchFailed("Tailscale.app is not installed on this machine.")
        }

        let result = try await CommandRunner.run(
            CommandDescriptor(
                executableURL: URL(fileURLWithPath: "/usr/bin/open"),
                arguments: ["-a", "Tailscale"]
            )
        )

        guard result.exitCode == 0 else {
            throw CommandRunnerError.nonZeroExit(
                result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr
            )
        }

        for _ in 0..<8 {
            try? await Task.sleep(for: .milliseconds(250))
            let state = await loadState()
            if state.running {
                return state
            }
        }

        return await loadState()
    }

    private func decodeState(
        data: Data,
        cliPath: String,
        appInstalled: Bool
    ) throws -> OpenScoutAppController.TailscaleViewState {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CommandRunnerError.nonZeroExit("Tailscale returned malformed status JSON.")
        }

        let backendState = (root["BackendState"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let health = (root["Health"] as? [Any])?.compactMap { $0 as? String } ?? []
        let selfPayload = root["Self"] as? [String: Any]
        let dnsName = normalizeDNSName(selfPayload?["DNSName"] as? String)
        let address = (selfPayload?["TailscaleIPs"] as? [Any])?.compactMap { $0 as? String }.first
        let peers = (root["Peer"] as? [String: Any])?.values.compactMap { $0 as? [String: Any] } ?? []
        let peerCount = peers.count
        let onlinePeerCount = peers.filter { ($0["Online"] as? Bool) == true }.count
        let running = backendState?.caseInsensitiveCompare("running") == .orderedSame
        let statusLabel = running
            ? "Running"
            : ((backendState?.isEmpty == false ? backendState : nil) ?? "Stopped")
        let statusDetail = running
            ? "\(onlinePeerCount)/\(peerCount) visible peers online."
            : (health.first ?? "Cached peers may appear, but Tailscale is not running on this machine.")

        return OpenScoutAppController.TailscaleViewState(
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
            controlHint: appInstalled ? nil : "Install Tailscale.app to launch it from OpenScout."
        )
    }

    private func unavailableState(
        detail: String,
        cliPath: String?,
        appInstalled: Bool
    ) -> OpenScoutAppController.TailscaleViewState {
        OpenScoutAppController.TailscaleViewState(
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
            controlHint: appInstalled ? nil : "Install Tailscale.app to launch it from OpenScout."
        )
    }

    private func tailscaleAppURL() -> URL? {
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
