// TerminalModels - Codable terminal configuration for Scout iOS.
//
// Credentials and private keys are intentionally referenced by keychain IDs
// only. Do not add secret material to these Codable records.

import Foundation

enum ScoutTerminalCredentialKind: String, Codable, CaseIterable, Sendable {
    case none
    case password
    case privateKey

    var title: String {
        switch self {
        case .none: "None"
        case .password: "Password"
        case .privateKey: "Private Key"
        }
    }
}

enum ScoutTerminalStartupProfile: String, Codable, CaseIterable, Sendable, Identifiable {
    case loginShell
    case scoutShell
    case persistentTmux

    var id: String { rawValue }

    var title: String {
        switch self {
        case .loginShell: "Shell"
        case .scoutShell: "Scout"
        case .persistentTmux: "Tmux"
        }
    }

    var subtitle: String {
        switch self {
        case .loginShell:
            "Open the host's default login shell."
        case .scoutShell:
            "Start Scout's managed terminal helper when installed."
        case .persistentTmux:
            "Attach to a persistent Scout tmux workspace."
        }
    }

    var startupCommand: String {
        switch self {
        case .loginShell:
            ""
        case .scoutShell:
            Self.remoteHelperCommand(
                helperName: "scout-shell",
                fallbackMessage: "[Scout] Remote shell helper is missing. Opening a plain shell."
            )
        case .persistentTmux:
            Self.remoteHelperCommand(
                helperName: "scout-session",
                fallbackMessage: "[Scout] Remote session helper is missing. Opening a plain shell."
            )
        }
    }

    static func normalizedStartupCommandOverride(
        _ command: String?,
        for profile: ScoutTerminalStartupProfile
    ) -> String? {
        let trimmed = command?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty, trimmed != profile.startupCommand else {
            return nil
        }
        return trimmed
    }

    private static func remoteHelperCommand(helperName: String, fallbackMessage: String) -> String {
        let escapedFallbackMessage = fallbackMessage
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")

        return #"""
/bin/zsh -lc 'helper="$HOME/.openscout/bin/\#(helperName)"; if [[ -x "$helper" ]]; then exec "$helper"; fi; printf "\r\n\#(escapedFallbackMessage)\r\n"; exec "$(command -v zsh || printf /bin/zsh)" -il'
"""#
    }
}

struct ScoutTerminalSavedHost: Codable, Equatable, Identifiable, Sendable {
    var id: UUID = UUID()
    var label: String
    var host: String
    var port: Int
    var username: String
    var credentialKind: ScoutTerminalCredentialKind
    var credentialReference: String?
    var startupProfileRawValue: String
    var startupCommandOverride: String?
    var lastUsedAt: Date

    init(
        id: UUID = UUID(),
        label: String = "",
        host: String,
        port: Int = 22,
        username: String = "",
        credentialKind: ScoutTerminalCredentialKind = .none,
        credentialReference: String? = nil,
        startupProfile: ScoutTerminalStartupProfile = .loginShell,
        startupCommandOverride: String? = nil,
        lastUsedAt: Date = .now
    ) {
        self.id = id
        self.label = label
        self.host = host
        self.port = port
        self.username = username
        self.credentialKind = credentialKind
        self.credentialReference = credentialReference
        self.startupProfileRawValue = startupProfile.rawValue
        self.startupCommandOverride = ScoutTerminalStartupProfile.normalizedStartupCommandOverride(
            startupCommandOverride,
            for: startupProfile
        )
        self.lastUsedAt = lastUsedAt
    }

    var startupProfile: ScoutTerminalStartupProfile {
        get { ScoutTerminalStartupProfile(rawValue: startupProfileRawValue) ?? .loginShell }
        set {
            startupProfileRawValue = newValue.rawValue
            startupCommandOverride = ScoutTerminalStartupProfile.normalizedStartupCommandOverride(
                startupCommandOverride,
                for: newValue
            )
        }
    }

    var resolvedStartupCommand: String {
        ScoutTerminalStartupProfile.normalizedStartupCommandOverride(
            startupCommandOverride,
            for: startupProfile
        ) ?? startupProfile.startupCommand
    }

    var title: String {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLabel.isEmpty { return trimmedLabel }

        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return port == 22 ? trimmedHost : "\(trimmedHost):\(port)"
        }
        return port == 22 ? "\(username)@\(trimmedHost)" : "\(username)@\(trimmedHost):\(port)"
    }

    var endpoint: String {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let userPrefix = username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\(username)@"
        return port == 22 ? "\(userPrefix)\(trimmedHost)" : "\(userPrefix)\(trimmedHost):\(port)"
    }

    var normalizedEndpointKey: String {
        "\(username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())@\(host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()):\(port)"
    }
}
