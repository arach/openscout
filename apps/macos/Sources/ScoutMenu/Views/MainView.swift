import AppKit
import ScoutAppCore
import SwiftUI

struct MainView: View {
    @ObservedObject var controller: OpenScoutAppController

    @State private var showQR: Bool = false

    static let baseHeight: CGFloat = 232
    static let errorHeight: CGFloat = 240
    static let qrHeight: CGFloat = 484
    static let qrWithErrorHeight: CGFloat = 556
    static let actionLogPanelHeight: CGFloat = 168
    static let runtimeWarningHeight: CGFloat = 36
    static let pairingApprovalCardHeight: CGFloat = 128

    var body: some View {
        ZStack {
            ShellPalette.shellBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar

                Rectangle()
                    .fill(ShellPalette.line)
                    .frame(height: 1)

                VStack(spacing: 10) {
                    surfaceLauncher

                    if let lastError = controller.lastError, !lastError.isEmpty {
                        errorBanner(lastError)
                    }

                    if let request = controller.pendingPairingRequests.first {
                        pairingApprovalCard(request)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    Spacer(minLength: 0)

                    if controller.broker.hasRestartWarning {
                        runtimeWarningRow
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    deckStrip

                    if !controller.actionLog.isEmpty {
                        ActionLogPanel(entries: controller.actionLog)
                            .frame(height: Self.actionLogPanelHeight)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    if showQR {
                        qrPanel
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 10)

                Rectangle()
                    .fill(ShellPalette.line)
                    .frame(height: 1)

                footerBar
            }
        }
        .frame(width: 408, height: popoverHeight)
        // Action-log toggles run alongside restart actions that also flip
        // the menu-bar symbol; animating the frame here makes NSPopover
        // re-anchor against a status item that's mid-redraw and snap the
        // popover to a default screen position. Keep the size change atomic.
        .animation(.easeInOut(duration: 0.18), value: showQR)
        .animation(.easeInOut(duration: 0.18), value: controller.pendingPairingRequests.count)
        .preferredColorScheme(.dark)
    }

    private var hasError: Bool {
        if let last = controller.lastError, !last.isEmpty { return true }
        return false
    }

    private var popoverHeight: CGFloat {
        let base: CGFloat
        switch (showQR, hasError) {
        case (true, true):   base = Self.qrWithErrorHeight
        case (true, false):  base = Self.qrHeight
        case (false, true):  base = Self.errorHeight
        case (false, false): base = Self.baseHeight
        }
        if !controller.actionLog.isEmpty {
            return base + warningHeight + pairingApprovalHeight + Self.actionLogPanelHeight + 10
        }
        return base + warningHeight + pairingApprovalHeight
    }

    private var warningHeight: CGFloat {
        controller.broker.hasRestartWarning ? Self.runtimeWarningHeight : 0
    }

    private var pairingApprovalHeight: CGFloat {
        controller.pendingPairingRequests.isEmpty ? 0 : Self.pairingApprovalCardHeight + 10
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Text("OPENSCOUT")
                .font(MenuType.mono(11, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(ShellPalette.ink)

            Text("·")
                .font(MenuType.mono(11))
                .foregroundStyle(ShellPalette.muted)

            Text("MENU")
                .font(MenuType.mono(10, weight: .medium))
                .tracking(1.2)
                .foregroundStyle(ShellPalette.dim)

            Spacer()

            HStack(spacing: 6) {
                Button {
                    showQR.toggle()
                    if showQR && !controller.pairing.isRunning {
                        controller.startPairing()
                    }
                } label: {
                    Image(systemName: "qrcode")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(HeaderIconButtonStyle())
                .help(showQR ? "Hide pairing QR" : "Show pairing QR")

                Button {
                    controller.openComms()
                } label: {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(HeaderIconButtonStyle())
                .disabled(controller.webActionPending)
                .help("Open Scout")

                Button {
                    controller.openWebApp()
                } label: {
                    Image(systemName: "safari")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(HeaderIconButtonStyle())
                .disabled(controller.webActionPending)

                Button {
                    controller.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(HeaderIconButtonStyle())
                .disabled(controller.isRefreshing)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(ShellPalette.chrome)
    }

    private var footerBar: some View {
        HStack(spacing: 12) {
            Button {
                SettingsWindowController.shared.show(controller: controller)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 10, weight: .semibold))
                    Text("SETTINGS")
                        .font(MenuType.mono(10, weight: .semibold))
                        .tracking(1.0)
                }
                .foregroundStyle(ShellPalette.copy)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            Text("v\(buildVersion())")
                .font(MenuType.mono(9))
                .foregroundStyle(ShellPalette.muted)

            Spacer(minLength: 0)

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Text("QUIT")
                    .font(MenuType.mono(10, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(ShellPalette.dim)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .frame(height: 32)
        .background(ShellPalette.chromeFooter)
    }

    // MARK: - Surfaces launcher
    //
    // The two things you actually *go to* from the menu bar: the full app and
    // the HUD overlay (plus the tail/logs overlay). Services (broker/relay/web)
    // live in the deck below — this row is "take me there", up top where it's
    // the first thing you reach.
    private var surfaceLauncher: some View {
        HStack(spacing: 8) {
            LaunchTile(
                glyph: "safari",
                label: "WEB",
                help: "Open the OpenScout web app",
                disabled: controller.webActionPending
            ) {
                controller.openWebApp()
            }
            LaunchTile(
                glyph: "square.bottomhalf.filled",
                label: "HUD",
                help: "Toggle the HUD overlay  ·  ⌃⌥⌘H"
            ) {
                ScoutAppBridge.openHUD(command: "toggle")
            }
            LaunchTile(
                glyph: "list.bullet.rectangle",
                label: "TAIL",
                help: "Open the tail / logs overlay  ·  ⌃⌥⌘T"
            ) {
                ScoutAppBridge.openHUD(command: "tail")
            }
        }
    }

    // MARK: - Deck strip

    private var runtimeWarningRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(ShellPalette.warning)

            Text(controller.broker.restartWarningSummary ?? "Runtime restart warning")
                .font(MenuType.bodyMedium(11))
                .foregroundStyle(ShellPalette.copy)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 8)

            if let restartCount = controller.broker.restartTelemetry?.restartCount {
                Text("\(restartCount)x")
                    .font(MenuType.mono(9, weight: .bold))
                    .foregroundStyle(ShellPalette.warning)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(ShellPalette.warningSoft)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .stroke(ShellPalette.warning.opacity(0.45), lineWidth: 1)
                    )
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.warningSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.warning.opacity(0.35), lineWidth: 1)
        )
        .help(controller.broker.statusDetail)
    }

    /// Compact info strip shown below the service stack. Surfaces the latent
    /// data the controller already exposes (broker port, peer count, mesh
    /// state) so the bottom of the popover isn't dead space.
    private var deckStrip: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(ShellPalette.line)
                .frame(height: 1)

            HStack(alignment: .center, spacing: 0) {
                DeckTileButton(
                    glyph: .broker,
                    label: "BROKER",
                    value: brokerValue,
                    tint: brokerTint,
                    action: brokerAction,
                    helpText: brokerHelp,
                    menuItems: [
                        DeckTileMenuItem(
                            label: "Restart Broker",
                            isEnabled: !controller.brokerActionPending,
                            action: { controller.restartBroker() }
                        )
                    ]
                )
                deckDivider
                DeckTileButton(
                    glyph: .relay,
                    label: "RELAY",
                    value: relayValue,
                    tint: relayTint,
                    action: relayAction,
                    helpText: relayHelp,
                    menuItems: [
                        DeckTileMenuItem(
                            label: "Restart Relay",
                            isEnabled: !controller.pairingActionPending,
                            action: { controller.restartPairing() }
                        )
                    ]
                )
                deckDivider
                DeckTileButton(
                    glyph: .web,
                    label: "WEB",
                    value: webValue,
                    tint: webTint,
                    action: webAction,
                    helpText: webHelp,
                    menuItems: [
                        DeckTileMenuItem(
                            label: "Restart Web Server",
                            isEnabled: !controller.webActionPending,
                            action: { controller.restartWebApp() }
                        )
                    ]
                )
                deckDivider
                DeckTileButton(
                    glyph: .mesh,
                    label: "MESH",
                    value: meshValue,
                    tint: meshTint,
                    action: meshAction,
                    helpText: "Open mesh view"
                )
                deckDivider
                DeckTileButton(
                    glyph: .peers,
                    label: "DEVICES",
                    value: devicesValue,
                    tint: ShellPalette.ink,
                    action: devicesAction,
                    helpText: "Open agents view"
                )
            }
            .padding(.vertical, 8)

            Rectangle()
                .fill(ShellPalette.line)
                .frame(height: 1)
        }
    }

    private var deckDivider: some View {
        Rectangle()
            .fill(ShellPalette.line)
            .frame(width: 1)
    }

    // MARK: - Tile data

    private var brokerValue: String {
        if controller.brokerActionPending { return "BOOT" }
        if !controller.broker.reachable {
            return controller.broker.loaded ? "WAIT" : "START"
        }
        let url = controller.broker.brokerURL
        if let parsed = URL(string: url), let port = parsed.port {
            return ":\(port)"
        }
        return "—"
    }

    private var brokerTint: Color {
        if controller.brokerActionPending { return ShellPalette.warning }
        if controller.broker.hasRestartWarning { return ShellPalette.warning }
        if controller.broker.reachable { return ShellPalette.ink }
        if controller.broker.loaded { return ShellPalette.warning }
        return ShellPalette.error
    }

    private var brokerAction: (() -> Void)? {
        if !controller.broker.reachable && !controller.brokerActionPending {
            return { controller.startBroker() }
        }
        let url = controller.broker.brokerURL
        guard !url.isEmpty else { return nil }
        return {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(url, forType: .string)
        }
    }

    private var brokerHelp: String {
        if let warning = controller.broker.restartWarningSummary {
            return warning
        }
        if !controller.broker.reachable && !controller.brokerActionPending {
            return "Start broker"
        }
        return "Copy broker URL"
    }

    private var relayValue: String {
        if controller.pairingActionPending { return "BOOT" }
        if !controller.pairing.isRunning { return "START" }
        if controller.pairing.qrArt != nil { return "WAIT" }
        if controller.pairing.trustedPeerCount > 0 { return "PAIRED" }
        return "ON"
    }

    private var relayTint: Color {
        if controller.pairingActionPending { return ShellPalette.warning }
        if !controller.pairing.isRunning { return ShellPalette.ink }
        if controller.pairing.qrArt != nil { return ShellPalette.warning }
        return ShellPalette.ink
    }

    private var relayAction: (() -> Void)? {
        return {
            if !controller.pairing.isRunning {
                controller.startPairing()
            }
            showQR = true
        }
    }

    private var relayHelp: String {
        if !controller.pairing.isRunning { return "Start relay & show QR" }
        return "Show pairing QR"
    }

    private var devicesValue: String {
        "\(controller.pairing.trustedPeerCount)"
    }

    private var devicesAction: (() -> Void)? {
        return { controller.openWebPath("/agents") }
    }

    private var meshValue: String {
        let ts = controller.tailscale
        if !ts.available { return "OFF" }
        if !ts.running { return "OFF" }
        return "\(ts.onlinePeerCount)/\(ts.peerCount)"
    }

    private var meshTint: Color {
        let ts = controller.tailscale
        if !ts.available { return ShellPalette.dim }
        if !ts.running { return ShellPalette.warning }
        return ShellPalette.ink
    }

    private var meshAction: (() -> Void)? {
        return { controller.openWebPath("/mesh") }
    }

    private var webValue: String {
        if controller.webActionPending { return "BOOT" }
        return controller.webReachable ? controller.webSurfacePortLabel : "START"
    }

    private var webTint: Color {
        if controller.webActionPending { return ShellPalette.warning }
        return controller.webReachable ? ShellPalette.ink : ShellPalette.error
    }

    private var webAction: (() -> Void)? {
        return { controller.openWebApp() }
    }

    private var webHelp: String {
        if !controller.webReachable && !controller.webActionPending {
            return "Start web app"
        }
        return "Open web app"
    }

    // MARK: - QR Panel

    private var qrPanel: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "qrcode")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ShellPalette.ink)
                Text("PAIR DEVICE")
                    .font(MenuType.mono(10, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(ShellPalette.ink)
                Spacer()
                if controller.pairingActionPending {
                    Text("STARTING…")
                        .font(MenuType.mono(9, weight: .medium))
                        .foregroundStyle(ShellPalette.warning)
                } else if controller.pairing.qrArt != nil {
                    Button {
                        controller.restartPairing()
                    } label: {
                        Text("REFRESH")
                            .font(MenuType.mono(9, weight: .semibold))
                            .foregroundStyle(ShellPalette.copy)
                    }
                    .buttonStyle(.plain)
                    .help("Regenerate QR")
                }
                Button {
                    showQR = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(ShellPalette.ink)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Hide QR")
            }

            qrPanelBody
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.surfaceFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.line, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var qrPanelBody: some View {
        if let qrArt = controller.pairing.qrArt, !qrArt.isEmpty {
            VStack(spacing: 6) {
                Text(qrArt)
                    .font(.system(size: 6, weight: .regular, design: .monospaced))
                    .lineSpacing(0)
                    .foregroundStyle(ShellPalette.ink)
                    .fixedSize()

                if let qrValue = controller.pairing.qrValue, !qrValue.isEmpty {
                    HStack(spacing: 4) {
                        Text("URL")
                            .font(MenuType.mono(8, weight: .semibold))
                            .foregroundStyle(ShellPalette.muted)
                        Text(qrValue)
                            .font(MenuType.mono(9))
                            .foregroundStyle(ShellPalette.copy)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                        Button {
                            let pasteboard = NSPasteboard.general
                            pasteboard.clearContents()
                            pasteboard.setString(qrValue, forType: .string)
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(ShellPalette.copy)
                        }
                        .buttonStyle(.plain)
                        .help("Copy URL")
                    }
                }

                Text("Scan with the Scout app on your phone.")
                    .font(MenuType.body(10))
                    .foregroundStyle(ShellPalette.muted)
            }
            .frame(maxWidth: .infinity)
        } else if controller.pairingActionPending {
            VStack(spacing: 6) {
                ProgressView()
                    .scaleEffect(0.6)
                Text("Starting pairing controller...")
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.copy)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        } else if !controller.pairing.isRunning {
            VStack(spacing: 8) {
                Text("Relay isn't running.")
                    .font(MenuType.bodyMedium(12))
                    .foregroundStyle(ShellPalette.copy)
                Button {
                    controller.startPairing()
                } label: {
                    Text("Start Pairing")
                        .font(MenuType.mono(10, weight: .semibold))
                        .foregroundStyle(ShellPalette.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(ShellPalette.surfaceFill)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(ShellPalette.line, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        } else {
            VStack(spacing: 8) {
                Text("Relay is idle. Generate a fresh QR to pair a new device.")
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.copy)
                    .multilineTextAlignment(.center)
                Button {
                    controller.restartPairing()
                } label: {
                    Text("Generate QR")
                        .font(MenuType.mono(10, weight: .semibold))
                        .foregroundStyle(ShellPalette.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(ShellPalette.surfaceFill)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(ShellPalette.line, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        }
    }

    private func pairingApprovalCard(_ request: ScoutPairingRequest) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ShellPalette.accent)
                Text("PAIRING REQUEST")
                    .font(MenuType.mono(9, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(ShellPalette.accent)
                Spacer()
                if controller.pendingPairingRequests.count > 1 {
                    Text("+\(controller.pendingPairingRequests.count - 1) more")
                        .font(MenuType.mono(9, weight: .bold))
                        .foregroundStyle(ShellPalette.muted)
                }
            }

            Text("\(request.displayName) wants to pair")
                .font(MenuType.bodyMedium(12))
                .foregroundStyle(ShellPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)

            Text("On your network\(request.requesterIp.map { " · \($0)" } ?? ""). Allowing trusts this device.")
                .font(MenuType.body(10))
                .foregroundStyle(ShellPalette.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button {
                    controller.denyPairingRequest(request.token)
                } label: {
                    Text("Deny")
                        .font(MenuType.mono(10, weight: .semibold))
                        .foregroundStyle(ShellPalette.copy)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(ShellPalette.line, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .disabled(controller.pairingApprovalPending)

                Button {
                    controller.approvePairingRequest(request.token)
                } label: {
                    Text(controller.pairingApprovalPending ? "Allowing…" : "Allow")
                        .font(MenuType.mono(10, weight: .semibold))
                        .foregroundStyle(ShellPalette.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 5)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(ShellPalette.accent.opacity(0.18))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(ShellPalette.accent.opacity(0.55), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .disabled(controller.pairingApprovalPending)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.accentSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.accent.opacity(0.4), lineWidth: 1)
        )
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(ShellPalette.error)
                .padding(.top, 1)

            Text(message)
                .font(MenuType.body(11))
                .foregroundStyle(ShellPalette.copy)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.errorSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.errorBorder, lineWidth: 1)
        )
    }

    private func buildVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

}

private struct LaunchTile: View {
    let glyph: String
    let label: String
    let help: String
    var disabled: Bool = false
    let action: () -> Void

    @State private var hover = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: glyph)
                    .font(.system(size: 15, weight: .semibold))
                Text(label)
                    .font(MenuType.mono(10, weight: .bold))
                    .tracking(1.2)
            }
            .foregroundStyle(disabled ? ShellPalette.dim : ShellPalette.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(hover && !disabled ? ShellPalette.surfaceFill : ShellPalette.chrome)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(ShellPalette.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(help)
        .onHover { hovering in
            hover = hovering
            if hovering && !disabled {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }
}

private struct DeckTileMenuItem {
    let label: String
    let action: () -> Void
    let isEnabled: Bool

    init(label: String, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.label = label
        self.isEnabled = isEnabled
        self.action = action
    }
}

private struct DeckTileButton: View {
    let glyph: ServiceGlyph.Kind
    let label: String
    let value: String
    let tint: Color
    let action: (() -> Void)?
    let helpText: String
    var menuItems: [DeckTileMenuItem] = []

    @State private var isHovered = false

    private var isClickable: Bool { action != nil }

    var body: some View {
        Group {
            if let action {
                Button(action: action) { tile }
                    .buttonStyle(.plain)
                    .help(helpText)
            } else {
                tile
            }
        }
        .contextMenu {
            if !menuItems.isEmpty {
                ForEach(0..<menuItems.count, id: \.self) { index in
                    let item = menuItems[index]
                    Button(item.label, action: item.action)
                        .disabled(!item.isEnabled)
                }
            }
        }
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                ServiceGlyph(kind: glyph, size: 11, color: ShellPalette.ink)
                Text(label)
                    .font(MenuType.mono(9, weight: .medium))
                    .tracking(0.6)
                    .foregroundStyle(ShellPalette.ink)
            }

            HStack(spacing: 4) {
                Text(value)
                    .font(MenuType.mono(11, weight: .bold))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .truncationMode(.middle)

                if isClickable {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(ShellPalette.ink)
                        .opacity(isHovered ? 1 : 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .background(
            Rectangle()
                .fill(isClickable && isHovered ? ShellPalette.surfaceFill : Color.clear)
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.12)) {
                isHovered = hovering
            }
            guard isClickable else { return }
            if hovering {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }
}
