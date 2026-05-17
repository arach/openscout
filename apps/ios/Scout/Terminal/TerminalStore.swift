// TerminalStore - Saved host persistence and launch state for Scout iOS.

import Foundation
import Observation

@MainActor
@Observable
final class ScoutTerminalStore {
    private static let hostsKey = "scout.terminal.savedHosts.v1"
    private static let selectedProfileKey = "scout.terminal.selectedStartupProfile.v1"

    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let credentialVault: ScoutTerminalCredentialVault

    private(set) var savedHosts: [ScoutTerminalSavedHost] = []
    var selectedHostID: UUID?
    var selectedStartupProfile: ScoutTerminalStartupProfile = .loginShell {
        didSet {
            defaults.set(selectedStartupProfile.rawValue, forKey: Self.selectedProfileKey)
        }
    }

    var selectedHost: ScoutTerminalSavedHost? {
        guard let selectedHostID else { return savedHosts.first }
        return savedHosts.first { $0.id == selectedHostID } ?? savedHosts.first
    }

    init(
        defaults: UserDefaults = .standard,
        credentialVault: ScoutTerminalCredentialVault = ScoutTerminalKeychainVault.shared
    ) {
        self.defaults = defaults
        self.credentialVault = credentialVault

        if let rawProfile = defaults.string(forKey: Self.selectedProfileKey),
           let profile = ScoutTerminalStartupProfile(rawValue: rawProfile) {
            selectedStartupProfile = profile
        }

        reload()
        selectedHostID = savedHosts.first?.id
    }

    func reload() {
        guard let data = defaults.data(forKey: Self.hostsKey),
              let decoded = try? decoder.decode([ScoutTerminalSavedHost].self, from: data) else {
            savedHosts = []
            return
        }

        savedHosts = decoded
            .map(normalizedHost)
            .sorted { $0.lastUsedAt > $1.lastUsedAt }
    }

    @discardableResult
    func saveHost(
        label: String,
        host: String,
        port: Int,
        username: String,
        credentialKind: ScoutTerminalCredentialKind,
        secret: String?,
        startupProfile: ScoutTerminalStartupProfile,
        startupCommandOverride: String?
    ) throws -> ScoutTerminalSavedHost {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let reference = credentialReference(
            host: trimmedHost,
            port: port,
            username: trimmedUsername,
            existing: savedHosts.first { existing in
                existing.host.caseInsensitiveCompare(trimmedHost) == .orderedSame
                    && existing.port == port
                    && existing.username.caseInsensitiveCompare(trimmedUsername) == .orderedSame
            }?.credentialReference
        )

        if let secret, !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, credentialKind != .none {
            try credentialVault.saveString(secret, kind: credentialKind, reference: reference)
        } else if credentialKind == .none {
            try? credentialVault.delete(reference: reference)
        }

        var savedHost = ScoutTerminalSavedHost(
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            host: trimmedHost,
            port: port,
            username: trimmedUsername,
            credentialKind: credentialKind,
            credentialReference: credentialKind == .none ? nil : reference,
            startupProfile: startupProfile,
            startupCommandOverride: startupCommandOverride,
            lastUsedAt: .now
        )

        if let index = savedHosts.firstIndex(where: { $0.normalizedEndpointKey == savedHost.normalizedEndpointKey }) {
            savedHost.id = savedHosts[index].id
            savedHosts[index] = savedHost
        } else {
            savedHosts.append(savedHost)
        }

        persist()
        selectedHostID = savedHost.id
        selectedStartupProfile = startupProfile
        return savedHost
    }

    func markUsed(_ host: ScoutTerminalSavedHost) {
        guard let index = savedHosts.firstIndex(where: { $0.id == host.id }) else { return }
        savedHosts[index].lastUsedAt = .now
        selectedHostID = host.id
        selectedStartupProfile = savedHosts[index].startupProfile
        persist()
    }

    func delete(_ host: ScoutTerminalSavedHost) {
        if let reference = host.credentialReference {
            try? credentialVault.delete(reference: reference)
        }
        savedHosts.removeAll { $0.id == host.id }
        if selectedHostID == host.id {
            selectedHostID = savedHosts.first?.id
        }
        persist()
    }

    func credential(for host: ScoutTerminalSavedHost) throws -> ScoutTerminalCredential? {
        guard let reference = host.credentialReference,
              let string = try credentialVault.loadString(reference: reference),
              let data = string.data(using: .utf8) else {
            return nil
        }
        return ScoutTerminalCredential(reference: reference, kind: host.credentialKind, data: data)
    }

    private func persist() {
        let trimmedHosts = Array(savedHosts.sorted { $0.lastUsedAt > $1.lastUsedAt }.prefix(20))
        savedHosts = trimmedHosts

        if let data = try? encoder.encode(trimmedHosts) {
            defaults.set(data, forKey: Self.hostsKey)
        } else {
            defaults.removeObject(forKey: Self.hostsKey)
        }
    }

    private func normalizedHost(_ host: ScoutTerminalSavedHost) -> ScoutTerminalSavedHost {
        var normalized = host
        normalized.host = normalized.host.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.username = normalized.username.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.label = normalized.label.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.startupCommandOverride = ScoutTerminalStartupProfile.normalizedStartupCommandOverride(
            normalized.startupCommandOverride,
            for: normalized.startupProfile
        )
        return normalized
    }

    private func credentialReference(host: String, port: Int, username: String, existing: String?) -> String {
        if let existing, !existing.isEmpty { return existing }
        let endpoint = "\(username)@\(host):\(port)"
            .lowercased()
            .unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) ? String($0) : "-" }
            .joined()
        return "terminal-\(endpoint)-\(UUID().uuidString)"
    }
}
