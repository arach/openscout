import SwiftUI
import CryptoKit
import HudsonUI
import HudsonTerminal
import TerminiSSH
import ScoutCapabilities

/// Terminal — a real SSH/PTY into the paired Mac.
///
/// Flow on appear: generate (once) a device SSH identity, ask the broker to
/// authorize its public key on the Mac (`mobile/terminal/provision`), build the
/// connection from the returned host/user, then open a live PTY via Termini.
/// No mock console — when this can't connect it says exactly why.
struct TerminalSurface: View {
    let client: any ScoutBrokerClient
    /// Flips 0 → 1 when the bridge connection lands (`AppModel.dataReadyToken`).
    /// We key provisioning on it so the SSH handshake waits for the transport.
    var reloadToken: Int = 0
    /// The host we already reached the bridge through, when the route is direct
    /// (LAN / tailnet / loopback) so it IS the Mac. We SSH to this in preference
    /// to the broker's `.local` — it's the transport-correct, proven-reachable
    /// address (e.g. a Tailscale name when off-LAN). nil ⇒ use the broker host.
    var connectedHost: String? = nil

    @State private var workspace: TerminiSSHWorkspace?
    @State private var phase: Phase = .preparing
    @State private var endpoint: String = ""

    /// Terminal presentation. Font size is the single knob here; it will move to
    /// a per-terminal setting (small/standard presets). 8pt ≈ 70 cols on this
    /// device, so `ls -la` fits without wrapping.
    private var terminalAppearance: HudTerminalAppearance {
        HudTerminalAppearance(fontSize: 8)
    }

    private enum Phase: Equatable {
        case preparing
        case unavailable(String)
        case failed(String)
        case live
    }

    private enum TerminalPreparationError: LocalizedError {
        case missingHostKeyFingerprint

        var errorDescription: String? {
            switch self {
            case .missingHostKeyFingerprint:
                return "The Mac did not provide an SSH host-key fingerprint to pin."
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content
        }
        .background(HudPalette.bg)
        .task(id: reloadToken) { await prepare() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudTint.green.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("Terminal")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Text(endpoint.isEmpty ? "paired Mac" : endpoint)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.muted)
            }
            Spacer()
            statusDot
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.lg)
    }

    private var statusDot: some View {
        let connected = workspace?.isConnected ?? false
        let connecting = workspace?.isConnecting ?? false
        let color: Color = connected ? HudPalette.accent
            : connecting ? HudPalette.statusWarn
            : HudPalette.dim
        return HudStatusDot(color: color, size: 7, pulses: connecting)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .live:
            if let workspace {
                ZStack {
                    // Terminal background fills the full area so the inset margins
                    // below read as part of the terminal, not the app chrome.
                    terminalAppearance.backgroundColor.ignoresSafeArea()
                    // A small horizontal inset keeps the grid off the screen edges
                    // (Ghostty renders edge-to-edge; the first/last columns were
                    // clipping). The PTY recomputes its column count for this
                    // narrower width, so nothing is ever wider than the screen.
                    HudTerminalSurface(
                        controller: workspace.controller,
                        showsSystemKeyboard: true,
                        appearance: terminalAppearance
                    )
                    .padding(.horizontal, HudSpacing.sm)
                    if !workspace.isConnected {
                        connectingOverlay(workspace.statusMessage)
                    }
                }
            }
        case .preparing:
            statusPanel(
                title: "Authorizing this device…",
                detail: "Registering your terminal key with the Mac.",
                showsSpinner: true
            )
        case let .failed(message):
            statusPanel(title: "Couldn't connect", detail: message, retry: true)
        case let .unavailable(message):
            statusPanel(title: "Terminal unavailable", detail: message)
        }
    }

    private func connectingOverlay(_ message: String) -> some View {
        ZStack {
            HudPalette.bg.opacity(0.92)
            VStack(spacing: HudSpacing.md) {
                ProgressView().tint(HudPalette.accent)
                Text(message.isEmpty ? "Connecting…" : message)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(HudPalette.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(HudSpacing.huge)
        }
    }

    private func statusPanel(
        title: String,
        detail: String,
        showsSpinner: Bool = false,
        retry: Bool = false
    ) -> some View {
        VStack(spacing: HudSpacing.lg) {
            Spacer()
            if showsSpinner {
                ProgressView().tint(HudPalette.accent)
            }
            Text(title)
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
            Text(detail)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 260)
            if retry {
                HudButton("Retry", icon: "arrow.clockwise", style: .secondary) {
                    Task { await prepare(force: true) }
                }
                .padding(.top, HudSpacing.sm)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(HudSpacing.xxl)
    }

    // MARK: - Provision + connect

    private func prepare(force: Bool = false) async {
        if !force, case .live = phase { return }

        guard let provider = client as? TerminalAccessProviding else {
            phase = .unavailable("This connection doesn't support the in-app terminal yet.")
            return
        }

        // Wait for the bridge handshake. `.task(id: reloadToken)` re-runs this
        // when the connection lands, so a launch-straight-into-Terminal doesn't
        // race ahead of the transport.
        guard force || reloadToken > 0 else {
            phase = .preparing
            return
        }

        phase = .preparing

        let key = TerminalIdentity.loadOrCreate()
        let publicKey = TerminalIdentity.opensshPublicKey(for: key, comment: "scoutnext-ios")

        do {
            let access = try await provisionWithRetry(provider, publicKey: publicKey)
            let hostKeyFingerprint = access.hostKeyFingerprint?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let hostKeyFingerprint, !hostKeyFingerprint.isEmpty else {
                throw TerminalPreparationError.missingHostKeyFingerprint
            }
            // Prefer the address we already reached the bridge through (direct
            // route ⇒ it's the Mac); fall back to the broker's `.local`.
            let sshHost = connectedHost ?? access.host
            endpoint = "\(access.username)@\(sshHost)"

            let connection = TerminiConnectionConfig(
                name: "Scout Terminal",
                host: sshHost,
                port: access.port,
                username: access.username,
                authenticationMode: .privateKey,
                privateKeyPEM: TerminalIdentity.privateKeyPEM(for: key),
                // Run tmux over an SSH *exec* channel (PTY + exec ==
                // `ssh -t host …`), not typed into an interactive shell. The
                // command is a *login, non-interactive* shell that re-execs into
                // tmux. Three things fall out of that exact shell flavor:
                //   1. Persistence — `-A` attaches the live "scout" session on
                //      reconnect (create-or-attach), so the phone re-joins the
                //      same panes instead of a fresh shell every time.
                //   2. PATH — sshd execs commands with a bare PATH, so `tmux`
                //      (Homebrew, /opt/homebrew/bin) isn't found. `-l` sources
                //      the login profile (~/.zprofile holds `brew shellenv`), so
                //      the real PATH is restored and tmux resolves.
                //   3. No keychain collision — `.zshrc` (which carries the
                //      SSH-triggered `security unlock-keychain` prompt) is sourced
                //      only by *interactive* shells, so `-lc` skips it entirely.
                //      The inner pane is interactive and prompts at most once, on
                //      first session create, answerable in-pane.
                execCommand: "/bin/zsh -lc 'exec tmux new -A -s scout'",
                // Provisioning is over the already-authenticated Noise bridge;
                // require that it returns the Mac's host-key fingerprint and pin
                // it before SSH auth. No empty-fingerprint TOFU fallback.
                hostKeyPolicy: .trustOnFirstUse,
                hostKeyFingerprint: hostKeyFingerprint
            )

            let ws = TerminiSSHWorkspace(connection: connection)
            workspace = ws
            phase = .live
            await ws.connect()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Provisioning can land a beat before the transport reports ready (or during
    /// a reconnect blip). Give it a few short attempts before surfacing failure.
    private func provisionWithRetry(
        _ provider: any TerminalAccessProviding,
        publicKey: String,
        attempts: Int = 4
    ) async throws -> TerminalAccess {
        var lastError: Error?
        for attempt in 0..<attempts {
            do {
                return try await provider.provisionTerminalAccess(sshPublicKey: publicKey)
            } catch {
                lastError = error
                try? await Task.sleep(for: .milliseconds(700))
                if attempt < attempts - 1 { continue }
            }
        }
        throw lastError ?? CancellationError()
    }
}
