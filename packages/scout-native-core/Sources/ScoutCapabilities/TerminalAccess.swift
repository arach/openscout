// TerminalAccess — provisioning an in-app SSH/PTY session into the paired Mac.
//
// This is an *optional* capability, deliberately NOT folded into the
// `ScoutBrokerClient` composition: only the iOS bridge conformer implements it,
// and demo / macOS conformers shouldn't be forced to. Consumers feature-detect
// with `client as? TerminalAccessProviding`.

import Foundation

/// Reachable connection details the broker returns after authorizing this
/// device's SSH public key on the Mac (its key appended to `authorized_keys`).
public struct TerminalAccess: Codable, Sendable, Equatable {
    public let host: String
    public let port: Int
    public let username: String
    /// `SHA256:…` of the Mac's host key. New brokers require this for pinning.
    public let hostKeyFingerprint: String?

    public init(host: String, port: Int, username: String, hostKeyFingerprint: String?) {
        self.host = host
        self.port = port
        self.username = username
        self.hostKeyFingerprint = hostKeyFingerprint
    }
}

/// Provision an SSH terminal session into the paired Mac for this device.
public protocol TerminalAccessProviding: Sendable {
    /// Authorize `sshPublicKey` (OpenSSH single-line form) for this device on the
    /// Mac and return the reachable connection details for opening a PTY.
    func provisionTerminalAccess(sshPublicKey: String) async throws -> TerminalAccess
}
