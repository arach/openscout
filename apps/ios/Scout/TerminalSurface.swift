import SwiftUI
import CryptoKit
import HudsonUI
import HudsonTerminal
import HudsonVoice
import ScoutCapabilities

/// Shared, metadata-only snapshot of the live Terminal surface. Root owns one
/// instance so contextual Settings can inspect the terminal while its full-page
/// cover is open. No transcript or typed command is retained here.
@MainActor
@Observable
final class TerminalDiagnosticsModel {
    enum SurfaceState: String {
        case neverOpened = "Not opened"
        case visible = "Visible"
        case settings = "Settings open"
        case hidden = "Hidden"
    }

    enum ProvisioningState: String {
        case idle = "Not started"
        case waitingForBridge = "Waiting for bridge"
        case authorizing = "Authorizing key"
        case ready = "Authorized"
        case unavailable = "Unavailable"
        case failed = "Failed"
    }

    enum SSHState: String {
        case idle = "Not started"
        case connecting = "Connecting"
        case connected = "Connected"
        case disconnected = "Disconnected"
        case failed = "Failed"
    }

    var surfaceState: SurfaceState = .neverOpened
    var provisioningState: ProvisioningState = .idle
    var provisioningDetail: String?
    var sshState: SSHState = .idle
    var sshDetail: String?
    var endpoint: String?
    var targetID: String?
    var routeHost: String?
    var hostKeyPinned = false
    var ptyColumns: Int?
    var ptyRows: Int?
    var cellWidthPixels: Int?
    var cellHeightPixels: Int?
    var rendererDiagnostics: [String] = []
    /// Text currently parsed into Ghostty's visible viewport. This is metadata
    /// for troubleshooting the renderer boundary: non-empty text with blank
    /// pixels means transport/parsing worked and compositing failed.
    var rendererVisibleText = ""
    var keyboardHeight: CGFloat = 0
    var hostStatus: TerminalHostStatus?
    var hostStatusError: String?
    var lastUpdatedAt: Date?

    func begin(targetID: String?, routeHost: String?) {
        surfaceState = .visible
        self.targetID = targetID
        self.routeHost = routeHost
        lastUpdatedAt = .now
    }

    func recordProvisioning(_ state: ProvisioningState, detail: String? = nil) {
        provisioningState = state
        provisioningDetail = detail
        lastUpdatedAt = .now
    }

    func recordAccess(_ access: TerminalAccess, resolvedHost: String) {
        endpoint = "\(access.username)@\(resolvedHost):\(access.port)"
        hostKeyPinned = access.hostKeyFingerprint?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        recordProvisioning(.ready)
    }

    func sample(_ session: HudTerminalSSHSession, keyboardHeight: CGFloat) {
        let snapshot = session.snapshot
        switch snapshot.status {
        case .connecting:
            sshState = .connecting
            sshDetail = snapshot.statusMessage
        case .connected:
            sshState = .connected
            sshDetail = snapshot.statusMessage
        case .disconnected:
            sshState = .disconnected
            sshDetail = snapshot.statusMessage
        case .failed(let message):
            sshState = .failed
            sshDetail = message.isEmpty ? snapshot.statusMessage : message
        }
        if let grid = snapshot.grid {
            ptyColumns = grid.columns
            ptyRows = grid.rows
            cellWidthPixels = grid.cellWidthPixels
            cellHeightPixels = grid.cellHeightPixels
        }
        rendererDiagnostics = snapshot.rendererDiagnostics
        rendererVisibleText = snapshot.rendererVisibleText
        self.keyboardHeight = keyboardHeight
        lastUpdatedAt = .now
    }

    func recordFailure(_ message: String) {
        provisioningState = .failed
        provisioningDetail = message
        sshState = .failed
        sshDetail = message
        lastUpdatedAt = .now
    }

    func refreshHostStatus(using client: any ScoutBrokerClient) async {
        guard let provider = client as? any TerminalStatusProviding else {
            hostStatus = nil
            hostStatusError = "This broker client does not expose terminal status."
            return
        }
        do {
            hostStatus = try await provider.terminalHostStatus()
            hostStatusError = nil
        } catch {
            hostStatusError = error.localizedDescription
        }
        lastUpdatedAt = .now
    }
}

/// Terminal — a real SSH/PTY into the paired Mac.
///
/// Flow on appear: generate (once) a device SSH identity, ask the broker to
/// authorize its public key on the Mac (`mobile/terminal/provision`), build the
/// connection from the returned host/user, then open a Hudson terminal session.
/// No mock console — when this can't connect it says exactly why.
struct TerminalSurface: View {
    let client: any ScoutBrokerClient
    let diagnostics: TerminalDiagnosticsModel
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
    /// A full-screen Settings cover should not tear down the session it is
    /// actively diagnosing.
    var isPresentingSettings = false

    @State private var terminalSession: HudTerminalSSHSession?
    @State private var phase: Phase = .preparing
    @State private var endpoint: String = ""
    @State private var preparedIdentityToken: String?
    /// `.task(id:)` can restart when the bridge readiness token changes while
    /// an earlier provisioning call is still suspended. Only the newest
    /// generation may create/own an SSH workspace, otherwise one app launch
    /// attaches multiple tmux clients and duplicates terminal replies.
    @State private var preparationGeneration = 0

    /// The PTY owns keyboard presentation explicitly: hidden gives the terminal
    /// its full height, quick is a single terminal-actions row, and full is the
    /// complete QWERTY. Native swipes still move between quick and full.
    @State private var keyboardPresentation: KeyboardPresentation = .hidden
    @State private var keyboardHeight: CGFloat = 80

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
    /// Leave the family unset so Ghostty uses the renderer artifact's built-in
    /// monospace chain. GhosttyKit 0.1.5 currently substitutes private-use Nerd
    /// Font cells even when a patched family is registered and selected; that
    /// remaining fix belongs in the renderer artifact rather than app chrome.
    private var terminalAppearance: HudTerminalAppearance {
        HudTerminalAppearance(fontSize: 8, fontFamily: nil)
    }

    private enum KeyboardPresentation: Equatable {
        case hidden
        case quick
        case full

        var visibleLayout: HudTerminalKeyboardLayout? {
            switch self {
            case .hidden: nil
            case .quick: .quick
            case .full: .full
            }
        }
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
        content
        .background(HudPalette.bg)
        // The hosted keyboard IS the keyboard now (no system QWERTY underneath);
        // it rides the bottom safe area and the terminal lays out above it.
        .safeAreaInset(edge: .bottom, spacing: 0) { terminalKeyboard }
        .overlay(alignment: .bottomTrailing) { keyboardLauncher }
        .task(id: preparationToken) { await prepare() }
        .task(id: terminalSession.map(ObjectIdentifier.init)) {
            guard let observedSession = terminalSession else { return }
            while !Task.isCancelled, terminalSession === observedSession {
                diagnostics.sample(observedSession, keyboardHeight: presentedKeyboardHeight)
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        // Dictated text lands at the prompt (no trailing newline) — you review it
        // and press RET yourself, so a misheard command never auto-executes. The
        // pulse makes the keyboard's mic flash a success check.
        .onChange(of: voice.finalCount) { _, _ in
            let text = voice.finalText
            guard !text.isEmpty else { return }
            terminalSession?.send(text)
            dictationSuccessPulse += 1
        }
        .onDisappear {
            preparationGeneration &+= 1
            if voice.isListening { voice.cancel() }
            if let terminalSession { diagnostics.sample(terminalSession, keyboardHeight: presentedKeyboardHeight) }
            diagnostics.surfaceState = isPresentingSettings ? .settings : .hidden
            guard !isPresentingSettings else { return }
            let activeSession = terminalSession
            terminalSession = nil
            endpoint = ""
            preparedIdentityToken = nil
            Task { await activeSession?.disconnect() }
        }
    }

    // MARK: - Keyboard

    private var presentedKeyboardHeight: CGFloat {
        keyboardPresentation == .hidden ? 0 : keyboardHeight
    }

    /// hudson's in-app terminal keyboard (`HudHostedKeyboard`, extracted from
    /// talkie) — a full QWERTY that swipes down to a terminal quick-tray, both
    /// with a mic that drives `HudDictation`. Mounted only once the PTY is live;
    /// every key (and dictation transcript) writes straight to the channel.
    @ViewBuilder
    private var terminalKeyboard: some View {
        if case .live = phase, let layout = keyboardPresentation.visibleLayout {
            VStack(spacing: 0) {
                keyboardControlBar(layout: layout)
                HudTerminalHostedKeyboard(
                    send: { terminalSession?.send($0) },
                    onDictate: { voice.toggleFromUserIntent() },
                    dictationPhase: dictationPhase,
                    successPulse: dictationSuccessPulse,
                    preferredHeight: $keyboardHeight,
                    layout: layout,
                    onLayoutChange: { next in
                        keyboardPresentation = next == .quick ? .quick : .full
                    }
                )
                .frame(height: keyboardHeight)
                // The keyboard reflows to its width but renders full-bleed (3pt
                // internal padding). On compact phones this keeps it aligned with
                // the inset terminal grid instead of clipping at either edge.
                .padding(.horizontal, HudSpacing.xxl)
            }
            .background(HudPalette.bg)
        }
    }

    @ViewBuilder
    private var keyboardLauncher: some View {
        if case .live = phase, keyboardPresentation == .hidden {
            Button {
                keyboardPresentation = .quick
            } label: {
                Image(systemName: "keyboard")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                    .frame(width: 38, height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .fill(ScoutSurface.raised)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show terminal keyboard")
            .padding(.trailing, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.sm)
        }
    }

    private func keyboardControlBar(layout: HudTerminalKeyboardLayout) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Button {
                keyboardPresentation = .hidden
            } label: {
                Image(systemName: "keyboard.chevron.compact.down")
                    .frame(width: 34, height: 28)
            }
            .accessibilityLabel("Hide terminal keyboard")

            Spacer()

            Text(layout == .quick ? "QUICK KEYS" : "FULL KEYBOARD")
                .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                .foregroundStyle(ScoutInk.dim)

            Spacer()

            Button {
                keyboardPresentation = layout == .quick ? .full : .quick
            } label: {
                Image(systemName: layout == .quick ? "chevron.up" : "chevron.down")
                    .frame(width: 34, height: 28)
            }
            .accessibilityLabel(layout == .quick ? "Expand terminal keyboard" : "Use quick terminal keys")
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(ScoutInk.muted)
        .padding(.horizontal, HudSpacing.xxl)
        .frame(height: 30)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(HudHairline.standard)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    /// Maps the live voice session onto the keyboard's dictate button.
    private var dictationPhase: HudTerminalDictationPhase {
        switch voice.state {
        case .listening:    return .recording
        case .transcribing: return .processing
        default:            return .idle
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .live:
            if let terminalSession {
                ZStack {
                    // Terminal background fills the full area so the inset margins
                    // below read as part of the terminal, not the app chrome.
                    terminalAppearance.backgroundColor.ignoresSafeArea()
                    // A small horizontal inset keeps the grid off the screen edges
                    // (Ghostty renders edge-to-edge; the first/last columns were
                    // clipping). The PTY recomputes its column count for this
                    // narrower width, so nothing is ever wider than the screen.
                    HudTerminalSurface(
                        session: terminalSession,
                        showsSystemKeyboard: false,
                        appearance: terminalAppearance
                    )
                    .padding(.horizontal, HudSpacing.sm)
                    if !terminalSession.isConnected {
                        terminalOverlay(terminalSession)
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
    private func terminalOverlay(_ session: HudTerminalSSHSession) -> some View {
        switch session.status {
        case .connecting:
            blockingOverlay {
                ProgressView().tint(HudPalette.accent)
                Text(session.statusMessage.isEmpty ? "Connecting…" : session.statusMessage)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.muted)
                    .multilineTextAlignment(.center)
            }
        case .connected:
            EmptyView()
        case .failed(let message):
            recoveryOverlay(
                title: "Terminal disconnected",
                detail: message.isEmpty ? session.statusMessage : message
            )
        case .disconnected:
            recoveryOverlay(
                title: "Terminal disconnected",
                detail: session.statusMessage.isEmpty ? "The SSH session is not connected." : session.statusMessage
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
        diagnostics.begin(targetID: terminalTargetID, routeHost: connectedHost)
        let identityToken = terminalIdentityToken
        let phaseIsLive: Bool
        if case .live = phase {
            phaseIsLive = true
        } else {
            phaseIsLive = false
        }
        let sameLiveTarget = preparedIdentityToken == identityToken && phaseIsLive
        let sessionIsActive = terminalSession?.isConnected == true || terminalSession?.isConnecting == true
        if !force, sameLiveTarget, sessionIsActive {
            return
        }

        preparationGeneration &+= 1
        let generation = preparationGeneration

        if force || sameLiveTarget || preparedIdentityToken != identityToken {
            await terminalSession?.disconnect()
            guard generation == preparationGeneration, !Task.isCancelled else { return }
            terminalSession = nil
            endpoint = ""
            preparedIdentityToken = nil
        }

        guard let provider = client as? TerminalAccessProviding else {
            phase = .unavailable("This connection doesn't support the in-app terminal yet.")
            diagnostics.recordProvisioning(.unavailable, detail: "This connection does not support terminal provisioning.")
            return
        }

        // Wait for the bridge handshake. `.task(id: reloadToken)` re-runs this
        // when the connection lands, so a launch-straight-into-Terminal doesn't
        // race ahead of the transport.
        guard force || reloadToken > 0 else {
            phase = .preparing
            diagnostics.recordProvisioning(.waitingForBridge)
            return
        }

        phase = .preparing
        diagnostics.recordProvisioning(.authorizing)

        let key = TerminalIdentity.loadOrCreate()
        let publicKey = TerminalIdentity.opensshPublicKey(for: key, comment: "scout-ios")

        do {
            let access = try await provisionWithRetry(provider, publicKey: publicKey)
            guard generation == preparationGeneration, !Task.isCancelled else { return }
            let hostKeyFingerprint = access.hostKeyFingerprint?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let hostKeyFingerprint, !hostKeyFingerprint.isEmpty else {
                throw TerminalPreparationError.missingHostKeyFingerprint
            }
            // Prefer the address we already reached the bridge through (direct
            // route ⇒ it's the Mac); fall back to the broker's `.local`.
            let sshHost = connectedHost ?? access.host
            endpoint = "\(access.username)@\(sshHost)"
            diagnostics.recordAccess(access, resolvedHost: sshHost)

            let connection = HudTerminalSSHConnection(
                name: "Scout Terminal",
                host: sshHost,
                port: access.port,
                username: access.username,
                authentication: .privateKey(pem: TerminalIdentity.privateKeyPEM(for: key)),
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
                startup: .exec(command: "/bin/zsh -lc 'for p in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do if [[ -x $p ]]; then exec $p new -A -s scout; fi; done; print -u2 -- \"tmux is not installed in a supported location\"; exit 127'"),
                // Give tmux the PTY from the first byte. Typing this command
                // into a transient login shell lets terminal capability replies
                // contaminate that shell's input line before tmux attaches.
                // Provisioning is over the already-authenticated Noise bridge;
                // require that it returns the Mac's host-key fingerprint and pin
                // it before SSH auth. No empty-fingerprint TOFU fallback.
                hostKeyPolicy: .trustOnFirstUse,
                hostKeyFingerprint: hostKeyFingerprint
            )

            let session = HudTerminalSSHSession(connection: connection)
            terminalSession = session
            preparedIdentityToken = identityToken
            phase = .live
            await session.connect()
            guard generation == preparationGeneration, !Task.isCancelled else {
                await session.disconnect()
                if terminalSession === session { terminalSession = nil }
                return
            }
            diagnostics.sample(session, keyboardHeight: presentedKeyboardHeight)
            await paintPromptOnAttach(session)
        } catch {
            guard generation == preparationGeneration, !Task.isCancelled else { return }
            phase = .failed(error.localizedDescription)
            diagnostics.recordFailure(error.localizedDescription)
        }
    }

    /// On attach, tmux holds the pane's content but the iOS terminal doesn't
    /// repaint it until something nudges the stream — typing a key was enough to
    /// make the whole prompt appear. So once connected, send a clear-screen (⌃L):
    /// zsh repaints a clean prompt (no leftover input), which the emulator renders.
    /// Without this the pane opens on a bare floating cursor even though the prompt
    /// is right there in tmux. Hudson's `send` is the session's own keystroke
    /// path to the channel, so this is exactly a typed ⌃L.
    /// Two beats: the first kick can land before the inner shell is ready; the
    /// second catches it.
    private func paintPromptOnAttach(_ session: HudTerminalSSHSession) async {
        for _ in 0..<24 {
            if session.isConnected { break }
            try? await Task.sleep(for: .milliseconds(150))
        }
        for delay in [450, 1100] {
            try? await Task.sleep(for: .milliseconds(delay))
            guard session.isConnected else { return }
            session.send(Data([0x0C]))
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
