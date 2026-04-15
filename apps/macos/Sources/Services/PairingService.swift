import Foundation
import Darwin

enum PairingControlAction {
    case start
    case stop
    case restart
}

struct PairingRuntimeViewState: Sendable {
    let status: String
    let statusLabel: String
    let statusDetail: String
    let relay: String?
    let workspaceRoot: String?
    let identityFingerprint: String?
    let trustedPeerCount: Int
    let qrArt: String?
    let qrValue: String?
    let lastUpdatedLabel: String?
    let isRunning: Bool
    let controlAvailable: Bool
    let controlHint: String?
}

@MainActor
struct PairingService {
    private struct PairingConfig: Decodable {
        struct Workspace: Decodable {
            let root: String?
        }

        let relay: String?
        let workspace: Workspace?
    }

    private struct PairingIdentity: Decodable {
        let publicKey: String?
    }

    private struct RuntimePairingPayload: Decodable {
        let relay: String
        let room: String
        let publicKey: String
        let expiresAt: Int
        let qrArt: String
        let qrValue: String
    }

    private struct RuntimeSnapshot: Decodable {
        let version: Int
        let pid: Int
        let childPid: Int?
        let status: String
        let statusLabel: String
        let statusDetail: String?
        let relay: String?
        let workspaceRoot: String?
        let identityFingerprint: String?
        let trustedPeerCount: Int
        let pairing: RuntimePairingPayload?
        let updatedAt: Int
    }

    private let toolchain = OpenScoutToolchain()
    private let fileManager = FileManager.default
    private let decoder = JSONDecoder()

    func loadState() async -> OpenScoutAppController.PairingViewState {
        clearStaleArtifacts()

        let controlHint = toolchain.pairingControlHint()
        let controlAvailable = controlHint == nil
        let config = loadConfig()
        let identityFingerprint = readIdentityFingerprint()
        let trustedPeerCount = readTrustedPeerCount()

        if let snapshot = loadRuntimeSnapshot(), isRuntimeAlive(snapshot: snapshot) {
            return OpenScoutAppController.PairingViewState(
                status: snapshot.status,
                statusLabel: snapshot.statusLabel,
                statusDetail: snapshot.statusDetail ?? "Scout pairing is active.",
                relay: snapshot.relay ?? config?.relay,
                workspaceRoot: snapshot.workspaceRoot ?? config?.workspace?.root,
                identityFingerprint: snapshot.identityFingerprint ?? identityFingerprint,
                trustedPeerCount: snapshot.trustedPeerCount,
                qrArt: snapshot.pairing?.qrArt,
                qrValue: snapshot.pairing?.qrValue,
                lastUpdatedLabel: formatTimestamp(milliseconds: snapshot.updatedAt),
                isRunning: true,
                controlAvailable: controlAvailable,
                controlHint: controlHint
            )
        }

        return OpenScoutAppController.PairingViewState(
            status: "stopped",
            statusLabel: "Stopped",
            statusDetail: controlAvailable
                ? "Start pairing to generate a fresh QR code."
                : "Pairing control is unavailable until the supervisor entrypoint can be resolved.",
            relay: config?.relay,
            workspaceRoot: config?.workspace?.root,
            identityFingerprint: identityFingerprint,
            trustedPeerCount: trustedPeerCount,
            qrArt: nil,
            qrValue: nil,
            lastUpdatedLabel: nil,
            isRunning: false,
            controlAvailable: controlAvailable,
            controlHint: controlHint
        )
    }

    func control(_ action: PairingControlAction) async throws -> OpenScoutAppController.PairingViewState {
        switch action {
        case .start:
            try startRuntimeIfNeeded()
        case .stop:
            try stopRuntime()
        case .restart:
            try stopRuntime()
            try startRuntimeIfNeeded()
        }

        for _ in 0..<16 {
            try? await Task.sleep(for: .milliseconds(200))
            let state = await loadState()
            if action == .stop {
                if !state.isRunning {
                    return state
                }
            } else if state.isRunning {
                return state
            }
        }

        return await loadState()
    }

    private func startRuntimeIfNeeded() throws {
        if let snapshot = loadRuntimeSnapshot(), isRuntimeAlive(snapshot: snapshot) {
            return
        }

        let descriptor = try toolchain.pairSupervisorCommand()
        _ = try CommandRunner.spawn(descriptor)
    }

    private func stopRuntime() throws {
        if let pid = readRuntimeOwnerPID(), isProcessRunning(pid) {
            kill(pid_t(pid), SIGTERM)
            waitForExit(pid: pid, timeoutMs: 5_000)
        }

        clearStaleArtifacts()
    }

    private func waitForExit(pid: Int, timeoutMs: Int) {
        let startedAt = Date()
        while Date().timeIntervalSince(startedAt) * 1_000 < Double(timeoutMs) {
            if !isProcessRunning(pid) {
                return
            }
            usleep(100_000)
        }
    }

    private func loadConfig() -> PairingConfig? {
        guard let data = try? Data(contentsOf: configPath()) else {
            return nil
        }
        return try? decoder.decode(PairingConfig.self, from: data)
    }

    private func loadRuntimeSnapshot() -> RuntimeSnapshot? {
        guard let data = try? Data(contentsOf: runtimeStatePath()) else {
            return nil
        }
        return try? decoder.decode(RuntimeSnapshot.self, from: data)
    }

    private func readIdentityFingerprint() -> String? {
        guard let data = try? Data(contentsOf: identityPath()),
              let identity = try? decoder.decode(PairingIdentity.self, from: data),
              let publicKey = identity.publicKey,
              !publicKey.isEmpty else {
            return nil
        }

        return String(publicKey.prefix(16))
    }

    private func readTrustedPeerCount() -> Int {
        guard let data = try? Data(contentsOf: trustedPeersPath()),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
            return 0
        }

        return array.count
    }

    private func readRuntimeOwnerPID() -> Int? {
        guard let raw = try? String(contentsOf: runtimePIDPath(), encoding: .utf8) else {
            return nil
        }

        return Int(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func clearStaleArtifacts() {
        guard let pid = readRuntimeOwnerPID(), !isProcessRunning(pid) else {
            return
        }

        try? fileManager.removeItem(at: runtimePIDPath())
        try? fileManager.removeItem(at: runtimeStatePath())
    }

    private func isRuntimeAlive(snapshot: RuntimeSnapshot) -> Bool {
        if let ownerPID = readRuntimeOwnerPID(), isProcessRunning(ownerPID) {
            return true
        }

        if let childPID = snapshot.childPid, isProcessRunning(childPID) {
            return true
        }

        return isProcessRunning(snapshot.pid)
    }

    private func isProcessRunning(_ pid: Int) -> Bool {
        guard pid > 0 else {
            return false
        }

        if kill(pid_t(pid), 0) == 0 {
            return true
        }

        return errno == EPERM
    }

    private func pairingRoot() -> URL {
        fileManager.homeDirectoryForCurrentUser.appending(path: ".scout/pairing")
    }

    private func configPath() -> URL {
        pairingRoot().appending(path: "config.json")
    }

    private func identityPath() -> URL {
        pairingRoot().appending(path: "identity.json")
    }

    private func trustedPeersPath() -> URL {
        pairingRoot().appending(path: "trusted-peers.json")
    }

    private func runtimeStatePath() -> URL {
        pairingRoot().appending(path: "runtime.json")
    }

    private func runtimePIDPath() -> URL {
        pairingRoot().appending(path: "runtime.pid")
    }

    private func formatTimestamp(milliseconds: Int) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
        return DateFormatter.pairingTimestamp.string(from: date)
    }
}

private extension DateFormatter {
    static let pairingTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}
