import SwiftUI
import CryptoKit
import HudsonUI
import HudsonTerminal
import HudsonVoice
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
    /// Focused machine id. A live terminal belongs to one Mac; switching focus
    /// must tear down/re-provision instead of keeping the old SSH workspace.
    var terminalTargetID: String? = nil
    /// The host we already reached the bridge through, when the route is direct
    /// (LAN / tailnet / loopback) so it IS the Mac. We SSH to this in preference
    /// to the broker's `.local` — it's the transport-correct, proven-reachable
    /// address (e.g. a Tailscale name when off-LAN). nil ⇒ use the broker host.
    var connectedHost: String? = nil
    /// Recovery hooks owned by Root/AppModel.
    var onReconnectBridge: () -> Void = {}
    var onOpenConnectionSettings: () -> Void = {}

    @State private var workspace: TerminiSSHWorkspace?
    @State private var phase: Phase = .preparing
    @State private var endpoint: String = ""
    @State private var preparedIdentityToken: String?

    /// Height the hosted terminal keyboard reports for itself; it self-sizes and
    /// can swipe between compact (full QWERTY) and minimal rows.
    @State private var keyboardHeight: CGFloat = 262

    /// On-device dictation, shared with the message composers (injected at the
    /// app root). The terminal keyboard's mic toggles it; transcripts land at the
    /// prompt. Engine is Parakeet (Vox) when warm, Apple Speech otherwise.
    @Environment(HudDictation.self) private var voice
    /// Ticks once per delivered transcript so the keyboard flashes a success check.
    @State private var dictationSuccessPulse = 0

    /// Terminal presentation. Font size is the single knob here; it will move to
    /// a per-terminal setting (small/standard presets). 8pt ≈ 70 cols on this
    /// device, so `ls -la` fits without wrapping.
    ///
    /// `fontFamily: nil` is deliberate — it tells Termini NOT to override the
    /// face, so Ghostty uses its built-in chain (JetBrains Mono + the embedded
    /// "Symbols Nerd Font" fallback). That fallback renders the Mac's powerline /
    /// Powerlevel10k prompt glyphs; forcing "SF Mono" (hudson's default) dropped
    /// it and left the prompt as a bare floating cursor. Zero added bytes — the
    /// Nerd symbols already ship inside the Ghostty binary, verified via
    /// `strings` ("Symbols Nerd Font 3.4.0").
    private var terminalAppearance: HudTerminalAppearance {
        HudTerminalAppearance(fontSize: 8, fontFamily: nil)
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

    private var terminalIdentityToken: String {
        "\(terminalTargetID ?? "unfocused")|\(connectedHost ?? "broker-host")"
    }

    private var preparationToken: String {
        "\(reloadToken)|\(terminalIdentityToken)"
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content
        }
        .background(HudPalette.bg)
        // The hosted keyboard IS the keyboard now (no system QWERTY underneath);
        // it rides the bottom safe area and the terminal lays out above it.
        .safeAreaInset(edge: .bottom, spacing: 0) { terminalKeyboard }
        .task(id: preparationToken) { await prepare() }
        // Dictated text lands at the prompt (no trailing newline) — you review it
        // and press RET yourself, so a misheard command never auto-executes. The
        // pulse makes the keyboard's mic flash a success check.
        .onChange(of: voice.finalCount) { _, _ in
            let text = voice.finalText
            guard !text.isEmpty else { return }
            workspace?.controller.onTransportWrite?(Data(text.utf8))
            dictationSuccessPulse += 1
        }
        .onDisappear {
            if voice.isListening { voice.cancel() }
            let activeWorkspace = workspace
            workspace = nil
            endpoint = ""
            preparedIdentityToken = nil
            Task { await activeWorkspace?.disconnect() }
        }
    }

    // MARK: - Keyboard

    /// hudson's in-app terminal keyboard (`HudHostedKeyboard`, extracted from
    /// talkie) — a full QWERTY that swipes down to a terminal quick-tray, both
    /// with a mic that drives `HudDictation`. Mounted only once the PTY is live;
    /// every key (and dictation transcript) writes straight to the channel.
    @ViewBuilder
    private var terminalKeyboard: some View {
        if case .live = phase {
            TerminalHostedKeyboard(
                send: { workspace?.controller.onTransportWrite?($0) },
                onDictate: { voice.toggleFromUserIntent() },
                dictationPhase: dictationPhase,
                successPulse: dictationSuccessPulse,
                preferredHeight: $keyboardHeight
            )
            .frame(height: keyboardHeight)
            // The keyboard reflows to its width but renders full-bleed (3pt
            // internal padding). On the 13 mini's narrow screen that's too wide,
            // so inset it into a contained tray that lines up with the terminal
            // grid (which is also inset) instead of running edge-to-edge.
            .padding(.horizontal, HudSpacing.xxl)
        }
    }

    /// Maps the live voice session onto the keyboard's dictate button.
    private var dictationPhase: TerminalDictationPhase {
        switch voice.state {
        case .listening:    return .recording
        case .transcribing: return .processing
        default:            return .idle
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Glyphic(kind: .terminal, size: 19)
                .foregroundStyle(HudTint.green.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("Terminal")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Text(endpoint.isEmpty ? "paired Mac" : endpoint)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
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
            : ScoutInk.dim
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
                        showsSystemKeyboard: false,
                        appearance: terminalAppearance
                    )
                    .padding(.horizontal, HudSpacing.sm)
                    if !workspace.isConnected {
                        terminalOverlay(workspace)
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

    @ViewBuilder
    private func terminalOverlay(_ workspace: TerminiSSHWorkspace) -> some View {
        switch workspace.status {
        case .connecting:
            blockingOverlay {
                ProgressView().tint(HudPalette.accent)
                Text(workspace.statusMessage.isEmpty ? "Connecting…" : workspace.statusMessage)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.muted)
                    .multilineTextAlignment(.center)
            }
        case .connected:
            EmptyView()
        case .failed(let message):
            recoveryOverlay(
                title: "Terminal disconnected",
                detail: message.isEmpty ? workspace.statusMessage : message
            )
        case .disconnected:
            recoveryOverlay(
                title: "Terminal disconnected",
                detail: workspace.statusMessage.isEmpty ? "The SSH session is not connected." : workspace.statusMessage
            )
        }
    }

    private func blockingOverlay<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            HudPalette.bg.opacity(0.92)
            VStack(spacing: HudSpacing.md) {
                content()
            }
            .padding(HudSpacing.huge)
        }
    }

    private func recoveryOverlay(title: String, detail: String) -> some View {
        blockingOverlay {
            Text(title)
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
            Text(detail)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
            HStack(spacing: HudSpacing.sm) {
                HudButton("Retry SSH", icon: "arrow.clockwise", style: .secondary) {
                    Task { await prepare(force: true) }
                }
                HudButton("Reconnect", icon: "antenna.radiowaves.left.and.right", style: .secondary) {
                    onReconnectBridge()
                }
            }
            HudButton("Connection", icon: "slider.horizontal.3", style: .secondary) {
                onOpenConnectionSettings()
            }
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
                .foregroundStyle(ScoutInk.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 260)
            if retry {
                HStack(spacing: HudSpacing.sm) {
                    HudButton("Retry", icon: "arrow.clockwise", style: .secondary) {
                        Task { await prepare(force: true) }
                    }
                    HudButton("Connection", icon: "slider.horizontal.3", style: .secondary) {
                        onOpenConnectionSettings()
                    }
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
        let identityToken = terminalIdentityToken
        let phaseIsLive: Bool
        if case .live = phase {
            phaseIsLive = true
        } else {
            phaseIsLive = false
        }
        let sameLiveTarget = preparedIdentityToken == identityToken && phaseIsLive
        let workspaceIsActive = workspace?.isConnected == true || workspace?.isConnecting == true
        if !force, sameLiveTarget, workspaceIsActive {
            return
        }

        if force || sameLiveTarget || preparedIdentityToken != identityToken {
            await workspace?.disconnect()
            workspace = nil
            endpoint = ""
            preparedIdentityToken = nil
        }

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
        let publicKey = TerminalIdentity.opensshPublicKey(for: key, comment: "scout-ios")

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
                startupCommand: "/bin/zsh -lc 'exec tmux new -A -s scout'",
                // Provisioning is over the already-authenticated Noise bridge;
                // require that it returns the Mac's host-key fingerprint and pin
                // it before SSH auth. No empty-fingerprint TOFU fallback.
                hostKeyPolicy: .trustOnFirstUse,
                hostKeyFingerprint: hostKeyFingerprint
            )

            let ws = TerminiSSHWorkspace(connection: connection)
            workspace = ws
            preparedIdentityToken = identityToken
            phase = .live
            await ws.connect()
            await paintPromptOnAttach(ws)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// On attach, tmux holds the pane's content but the iOS terminal doesn't
    /// repaint it until something nudges the stream — typing a key was enough to
    /// make the whole prompt appear. So once connected, send a clear-screen (⌃L):
    /// zsh repaints a clean prompt (no leftover input), which the emulator renders.
    /// Without this the pane opens on a bare floating cursor even though the prompt
    /// is right there in tmux. `onTransportWrite` is the session's own keystroke
    /// path to the channel, so this is exactly a typed ⌃L — no shared-package change.
    /// Two beats: the first kick can land before the inner shell is ready; the
    /// second catches it.
    private func paintPromptOnAttach(_ ws: TerminiSSHWorkspace) async {
        for _ in 0..<24 {
            if ws.isConnected { break }
            try? await Task.sleep(for: .milliseconds(150))
        }
        for delay in [450, 1100] {
            try? await Task.sleep(for: .milliseconds(delay))
            guard ws.isConnected else { return }
            ws.controller.onTransportWrite?(Data([0x0C]))
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
