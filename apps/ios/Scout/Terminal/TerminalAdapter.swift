// TerminalAdapter - Boundary for Termini / TerminiSSH integration.

import Foundation
import SwiftUI

#if canImport(Termini) && canImport(TerminiSSH)
import Termini
import TerminiSSH
#endif

enum ScoutTerminalConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case failed(String)

    var title: String {
        switch self {
        case .idle: "Ready"
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .failed: "Failed"
        }
    }
}

struct ScoutTerminalLaunchRequest: Sendable {
    let host: ScoutTerminalSavedHost
    let startupProfile: ScoutTerminalStartupProfile
    let credential: ScoutTerminalCredential?

    var startupCommand: String {
        ScoutTerminalStartupProfile.normalizedStartupCommandOverride(
            host.startupCommandOverride,
            for: startupProfile
        ) ?? startupProfile.startupCommand
    }
}

enum ScoutTerminalShortcut: String, CaseIterable, Identifiable, Sendable {
    case escape
    case controlC
    case controlD
    case tab
    case up
    case down

    var id: String { rawValue }

    var title: String {
        switch self {
        case .escape: "Esc"
        case .controlC: "Ctrl-C"
        case .controlD: "Ctrl-D"
        case .tab: "Tab"
        case .up: "Up"
        case .down: "Down"
        }
    }

    var transportBytes: [UInt8] {
        switch self {
        case .escape: [0x1B]
        case .controlC: [0x03]
        case .controlD: [0x04]
        case .tab: [0x09]
        case .up: Array("\u{1B}[A".utf8)
        case .down: Array("\u{1B}[B".utf8)
        }
    }
}

@MainActor
protocol ScoutTerminalAdapter: AnyObject {
    var state: ScoutTerminalConnectionState { get }
    func connect(_ request: ScoutTerminalLaunchRequest) async
    func disconnect()
    func sendShortcut(_ shortcut: ScoutTerminalShortcut)
    func makeTerminalView() -> AnyView
}

@MainActor
@Observable
final class PlaceholderScoutTerminalAdapter: ScoutTerminalAdapter {
    private(set) var state: ScoutTerminalConnectionState = .idle
    private var lastRequest: ScoutTerminalLaunchRequest?
    private var lastShortcut: ScoutTerminalShortcut?

    func connect(_ request: ScoutTerminalLaunchRequest) async {
        state = .connecting
        lastRequest = request
        try? await Task.sleep(for: .milliseconds(250))
        state = .failed("TerminiSSH is not linked yet")
    }

    func disconnect() {
        state = .idle
    }

    func sendShortcut(_ shortcut: ScoutTerminalShortcut) {
        lastShortcut = shortcut
    }

    func makeTerminalView() -> AnyView {
        AnyView(ScoutTerminalPlaceholderSurface(request: lastRequest, state: state, lastShortcut: lastShortcut))
    }
}

#if canImport(Termini) && canImport(TerminiSSH)
@MainActor
@Observable
final class TerminiScoutTerminalAdapter: ScoutTerminalAdapter {
    private let workspace = TerminiSSHWorkspace()
    private(set) var state: ScoutTerminalConnectionState = .idle

    func connect(_ request: ScoutTerminalLaunchRequest) async {
        state = .connecting
        workspace.connection = termConfig(for: request)
        await workspace.connect()
        state = mapStatus(workspace.status)
    }

    func disconnect() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            await workspace.disconnect()
            state = .idle
        }
    }

    func sendShortcut(_ shortcut: ScoutTerminalShortcut) {
        workspace.controller.onTransportWrite?(Data(shortcut.transportBytes))
    }

    func makeTerminalView() -> AnyView {
        AnyView(
            TerminiTerminalView(
                controller: workspace.controller,
                showsSystemKeyboard: true,
                appearance: .init(theme: .jadeNight, fontSize: 13, fontFamily: "SF Mono")
            )
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
            )
        )
    }

    private func termConfig(for request: ScoutTerminalLaunchRequest) -> TerminiConnectionConfig {
        let secret = request.credential
            .flatMap { String(data: $0.data, encoding: .utf8) } ?? ""
        let authenticationMode: TerminiConnectionConfig.AuthenticationMode =
            request.credential?.kind == .password ? .password : .privateKey

        return TerminiConnectionConfig(
            name: request.host.title,
            host: request.host.host,
            port: request.host.port,
            username: request.host.username,
            authenticationMode: authenticationMode,
            password: authenticationMode == .password ? secret : "",
            privateKeyPEM: authenticationMode == .privateKey ? secret : "",
            term: "xterm-256color",
            startupCommand: request.startupCommand,
            hostKeyPolicy: .trustOnFirstUse,
            hostKeyFingerprint: ""
        )
    }

    private func mapStatus(_ status: TerminiSSHSession.Status) -> ScoutTerminalConnectionState {
        switch status {
        case .disconnected: .idle
        case .connecting: .connecting
        case .connected: .connected
        case .failed(let message): .failed(message)
        }
    }
}

typealias DefaultScoutTerminalAdapter = TerminiScoutTerminalAdapter
#else
typealias DefaultScoutTerminalAdapter = PlaceholderScoutTerminalAdapter
#endif

@MainActor
func makeDefaultScoutTerminalAdapter() -> DefaultScoutTerminalAdapter {
    DefaultScoutTerminalAdapter()
}

private struct ScoutTerminalPlaceholderSurface: View {
    let request: ScoutTerminalLaunchRequest?
    let state: ScoutTerminalConnectionState
    let lastShortcut: ScoutTerminalShortcut?

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.lg) {
            HStack {
                Image(systemName: "terminal")
                    .font(.system(size: 18, weight: .semibold))
                Text("TerminiSSH adapter")
                    .font(ScoutTypography.code(13, weight: .semibold))
                Spacer()
                Text(state.title.uppercased())
                    .font(ScoutTypography.code(10, weight: .bold))
                    .foregroundStyle(stateColor)
            }

            Divider()
                .overlay(ScoutColors.divider)

            VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                terminalLine("$ scout terminal")
                if let request {
                    terminalLine("# \(request.host.endpoint)")
                    if !request.startupCommand.isEmpty {
                        terminalLine(request.startupCommand)
                    } else {
                        terminalLine("# login shell")
                    }
                } else {
                    terminalLine("# choose a host to start")
                }
                terminalLine("")
                terminalLine("Termini and TerminiSSH should mount here once the package is added.")
                if let lastShortcut {
                    terminalLine("# shortcut queued: \(lastShortcut.title)")
                }
            }

            Spacer()
        }
        .padding(ScoutSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.black.opacity(0.92))
        .foregroundStyle(Color(white: 0.82))
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
        )
    }

    private var stateColor: Color {
        switch state {
        case .idle: ScoutColors.textMuted
        case .connecting: ScoutColors.ledAmber
        case .connected: ScoutColors.ledGreen
        case .failed: ScoutColors.ledRed
        }
    }

    private func terminalLine(_ value: String) -> some View {
        Text(value.isEmpty ? " " : value)
            .font(ScoutTypography.code(12))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
