import AppKit
import HudsonObservability
import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct MainView: View {
    @ObservedObject var controller: OpenScoutAppController

    @State private var showQR: Bool = false
    @State private var showingActivityLog = false
    @ObservedObject private var activityLog = HudLogStore.shared

    static let baseHeight: CGFloat = 422
    static let errorHeight: CGFloat = 470
    static let qrHeight: CGFloat = 674
    static let qrWithErrorHeight: CGFloat = 726
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

                VStack(spacing: 14) {
                    surfaceLauncher

                    if let lastError = controller.lastError, !lastError.isEmpty {
                        Button {
                            showingActivityLog = true
                        } label: {
                            errorBanner(lastError)
                        }
                        .buttonStyle(.plain)
                        .help("Open activity log")
                    }

                    if let request = controller.pendingPairingRequests.first {
                        pairingApprovalCard(request)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

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
                }
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 14)

                Rectangle()
                    .fill(ShellPalette.line)
                    .frame(height: 1)

                footerBar
            }
        }
        .frame(width: 430, height: popoverHeight)
        // Action-log toggles run alongside restart actions that also flip
        // the menu-bar symbol; animating the frame here makes NSPopover
        // re-anchor against a status item that's mid-redraw and snap the
        // popover to a default screen position. Keep the size change atomic.
        .animation(.easeInOut(duration: 0.18), value: showQR)
        .animation(.easeInOut(duration: 0.18), value: controller.pendingPairingRequests.count)
        .hudEdgeSheet(isPresented: $showingActivityLog, edge: .trailing, fraction: 0.92) {
            ScoutLogPanel(title: "Activity Log") {
                showingActivityLog = false
            }
        }
        .onChange(of: controller.lastError ?? "") { _, value in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            HudLogger(category: "menu-status").error(trimmed)
        }
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
        HStack(spacing: 8) {
            Text("OpenScout")
                .font(MenuType.bodyMedium(14))
                .foregroundStyle(ShellPalette.ink)

            HStack(spacing: 4) {
                Circle()
                    .fill(menuStatusTint)
                    .frame(width: 5, height: 5)
                Text(menuStatusLabel)
                    .font(MenuType.bodyMedium(9))
                    .foregroundStyle(ShellPalette.dim)
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(ShellPalette.muted)
                    .opacity(controller.isRefreshing ? 1 : 0)
                    .frame(width: 9)
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(menuStatusAccessibilityLabel)

            Spacer()

            HStack(spacing: 6) {
                HeaderActionButton(
                    glyph: "qrcode",
                    label: showQR ? "Hide pairing QR" : "Show pairing QR",
                    isSelected: showQR
                ) {
                    showQR.toggle()
                    if showQR && !controller.pairing.isRunning {
                        controller.startPairing()
                    }
                }

                HeaderActionButton(
                    glyph: "arrow.clockwise",
                    label: "Refresh status",
                    disabled: controller.isRefreshing
                ) {
                    controller.refresh()
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .frame(height: 52)
        .background(ShellPalette.chrome)
    }

    private var menuStatusLabel: String {
        if controller.brokerActionPending { return "Starting" }
        if !controller.hasCompletedInitialRefresh { return "Checking" }
        return controller.broker.reachable ? "Ready" : "Offline"
    }

    private var menuStatusTint: Color {
        if controller.brokerActionPending { return ShellPalette.warning }
        if !controller.hasCompletedInitialRefresh { return ShellPalette.muted }
        return controller.broker.reachable ? ShellPalette.success : ShellPalette.error
    }

    private var menuStatusAccessibilityLabel: String {
        controller.isRefreshing ? "\(menuStatusLabel), refreshing" : menuStatusLabel
    }

    private var footerBar: some View {
        HStack(spacing: 12) {
            Button {
                showingActivityLog = true
            } label: {
                ScoutLogStatusItem(store: activityLog, label: "Logs", showCounts: true)
            }
            .buttonStyle(.plain)
            .help("Open activity log")

            Button {
                SettingsWindowController.shared.show(controller: controller)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Settings")
                        .font(MenuType.bodyMedium(11))
                }
                .foregroundStyle(ShellPalette.copy)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            Text("v\(buildVersion())")
                .font(MenuType.mono(9))
                .foregroundStyle(ShellPalette.muted)

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Text("Quit")
                    .font(MenuType.bodyMedium(11))
                    .foregroundStyle(ShellPalette.dim)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(ShellPalette.chromeFooter)
    }

    // MARK: - Surfaces launcher
    //
    // The primary places/actions you reach from the menu bar: Scout, a new
    // task, the HUD overlay, and tail mode. Services (broker/relay/web)
    // live in the deck below — this row is "take me there", up top where it's
    // the first thing you reach.
    private var surfaceLauncher: some View {
        VStack(spacing: 8) {
            LaunchTile(
                glyph: "paperplane.fill",
                label: "Open Scout",
                detail: "Agents, chats, repos, and terminals",
                help: "Open native Scout",
                prominent: true
            ) {
                ScoutAppBridge.openScout()
            }
            HStack(spacing: 8) {
                LaunchTile(
                    glyph: "plus.square.on.square",
                    label: "New Task",
                    help: "Create an agent task  ·  ⌃⌥⇧⌘A"
                ) {
                    ScoutAppBridge.openHUD(command: "task")
                }
                LaunchTile(
                    glyph: "viewfinder",
                    label: "Show HUD",
                    help: "Toggle the HUD overlay  ·  ⌃⌥⇧⌘H"
                ) {
                    ScoutAppBridge.openHUD(command: "toggle")
                }
                LaunchTile(
                    glyph: "terminal",
                    label: "Open Tail",
                    help: "Toggle tail mode  ·  ⌃⌥⇧⌘T"
                ) {
                    ScoutAppBridge.openHUD(command: "tail-toggle")
                }
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
        VStack(alignment: .leading, spacing: 8) {
            Text("Services")
                .font(MenuType.bodyMedium(12))
                .foregroundStyle(ShellPalette.copy)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 1)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(ShellPalette.line)
                        .frame(height: 1)
                        .offset(y: 7)
                }
                .padding(.bottom, 7)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3),
                spacing: 8
            ) {
                DeckTileButton(
                    glyph: .broker,
                    label: "Broker",
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
                DeckTileButton(
                    glyph: .relay,
                    label: "Relay",
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
                DeckTileButton(
                    glyph: .web,
                    label: "Web",
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
                DeckTileButton(
                    glyph: .terminal,
                    label: "Terminal",
                    value: terminalValue,
                    tint: terminalTint,
                    action: terminalAction,
                    helpText: terminalHelp
                )
                DeckTileButton(
                    glyph: .mesh,
                    label: "Mesh",
                    value: meshValue,
                    tint: meshTint,
                    action: meshAction,
                    helpText: "Open mesh view"
                )
                DeckTileButton(
                    glyph: .peers,
                    label: "Devices",
                    value: devicesValue,
                    tint: devicesTint,
                    action: devicesAction,
                    helpText: "Open paired devices"
                )
            }
        }
    }

    // MARK: - Tile data

    private var brokerValue: String {
        if controller.brokerActionPending { return "Starting…" }
        if !controller.broker.reachable {
            return controller.broker.loaded ? "Waiting" : "Start"
        }
        let url = controller.broker.brokerURL
        if let parsed = URL(string: url), let port = parsed.port {
            return "Port \(port)"
        }
        return "—"
    }

    private var brokerTint: Color {
        if controller.brokerActionPending { return ShellPalette.warning }
        if controller.broker.hasRestartWarning { return ShellPalette.warning }
        if controller.broker.reachable { return ShellPalette.success }
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
        if controller.pairingActionPending { return "Starting…" }
        if !controller.pairing.isRunning { return "Start" }
        if controller.pairing.qrArt != nil { return "Pair device" }
        if controller.pairing.trustedPeerCount > 0 { return "Paired" }
        return "Running"
    }

    private var relayTint: Color {
        if controller.pairingActionPending { return ShellPalette.warning }
        if !controller.pairing.isRunning { return ShellPalette.error }
        if controller.pairing.qrArt != nil { return ShellPalette.warning }
        return ShellPalette.success
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
        let count = controller.pairing.trustedPeerCount
        return count == 1 ? "1 paired" : "\(count) paired"
    }

    private var devicesTint: Color {
        controller.pairing.trustedPeerCount > 0 ? ShellPalette.success : ShellPalette.dim
    }

    private var devicesAction: (() -> Void)? {
        return { controller.openWebPath("/settings#trusted-peers") }
    }

    private var meshValue: String {
        let ts = controller.tailscale
        if !ts.available { return "Unavailable" }
        if !ts.running { return "Stopped" }
        return "\(ts.onlinePeerCount) of \(ts.peerCount) online"
    }

    private var meshTint: Color {
        let ts = controller.tailscale
        if !ts.available { return ShellPalette.dim }
        if !ts.running { return ShellPalette.warning }
        return ShellPalette.success
    }

    private var meshAction: (() -> Void)? {
        return { controller.openWebPath("/mesh") }
    }

    private var terminalValue: String {
        if controller.webActionPending { return "Starting…" }
        return controller.webReachable ? "Open" : "Start"
    }

    private var terminalTint: Color {
        if controller.webActionPending { return ShellPalette.warning }
        if controller.webSurfaceStatus == .slow { return ShellPalette.warning }
        return controller.webReachable ? ShellPalette.success : ShellPalette.error
    }

    private var terminalAction: (() -> Void)? {
        return { controller.openWebPath("/terminal") }
    }

    private var terminalHelp: String {
        if !controller.webReachable && !controller.webActionPending {
            return "Start web app and open terminals"
        }
        return "Open terminals"
    }

    private var webValue: String {
        if controller.webActionPending { return "Starting…" }
        guard controller.webReachable else { return "Start" }
        let port = controller.webSurfacePortLabel.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        return port.isEmpty ? "Open" : "Port \(port)"
    }

    private var webTint: Color {
        if controller.webActionPending { return ShellPalette.warning }
        if controller.webSurfaceStatus == .slow { return ShellPalette.warning }
        return controller.webReachable ? ShellPalette.success : ShellPalette.error
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

private struct HeaderActionButton: View {
    let glyph: String
    let label: String
    var isSelected = false
    var disabled = false
    let action: () -> Void

    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(foreground)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(border, lineWidth: isFocused ? 2 : 1)
                )
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .disabled(disabled)
        .help(label)
        .accessibilityLabel(label)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.1)) {
                isHovered = hovering
            }
            if hovering && !disabled {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }

    private var foreground: Color {
        if disabled { return ShellPalette.muted }
        return isSelected ? ShellPalette.accent : ShellPalette.copy
    }

    private var background: Color {
        if isSelected { return ShellPalette.accentSoft }
        if isHovered && !disabled { return ShellPalette.surfaceFill }
        return .clear
    }

    private var border: Color {
        if isFocused { return ShellPalette.accent }
        if isSelected { return ShellPalette.accentBorder }
        return .clear
    }
}

private struct LaunchTile: View {
    let glyph: String
    let label: String
    var detail: String? = nil
    let help: String
    var disabled: Bool = false
    var prominent: Bool = false
    let action: () -> Void

    @State private var hover = false
    @FocusState private var isFocused: Bool

    private var isInteractive: Bool {
        !disabled
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: prominent ? 12 : 9) {
                Image(systemName: glyph)
                    .font(.system(size: prominent ? 17 : 14, weight: .semibold))
                    .frame(width: prominent ? 38 : 28, height: prominent ? 38 : 28)
                    .background(
                        RoundedRectangle(cornerRadius: prominent ? 9 : 7, style: .continuous)
                            .fill(prominent ? ShellPalette.accentSoft : ShellPalette.surfaceFill)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(MenuType.bodyMedium(prominent ? 13 : 12))
                    if let detail {
                        Text(detail)
                            .font(prominent ? MenuType.body(10) : MenuType.mono(9))
                            .foregroundStyle(ShellPalette.dim)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 4)

                if prominent {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ShellPalette.dim)
                }
            }
            .foregroundStyle(disabled ? ShellPalette.dim : ShellPalette.ink)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, prominent ? 12 : 10)
            .padding(.vertical, prominent ? 10 : 8)
            .background(
                RoundedRectangle(cornerRadius: prominent ? 10 : 8, style: .continuous)
                    .fill(tileFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: prominent ? 10 : 8, style: .continuous)
                    .stroke(tileBorder, lineWidth: isFocused ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .disabled(!isInteractive)
        .help(help)
        .accessibilityLabel(label)
        .accessibilityHint(help)
        .onHover { hovering in
            hover = hovering
            if hovering && isInteractive {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }

    private var tileFill: Color {
        if hover && isInteractive { return ShellPalette.surfaceFillStrong }
        return prominent ? ShellPalette.card : ShellPalette.chrome
    }

    private var tileBorder: Color {
        if isFocused { return ShellPalette.accent }
        if prominent && hover { return ShellPalette.accentBorder }
        return prominent ? ShellPalette.lineStrong : ShellPalette.line
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
    @FocusState private var isFocused: Bool

    private var isClickable: Bool { action != nil }

    var body: some View {
        Group {
            if let action {
                Button(action: action) { tile }
                    .buttonStyle(.plain)
                    .focused($isFocused)
                    .help(helpText)
                    .accessibilityLabel("\(label), \(value)")
                    .accessibilityHint(helpText)
            } else {
                tile
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(label), \(value)")
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                ServiceGlyph(kind: glyph, size: 13, lineWidth: 1.6, color: tint)
                    .frame(width: 24, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(ShellPalette.surfaceFill)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(ShellPalette.line, lineWidth: 1)
                    )

                Spacer(minLength: 2)

                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
                    .padding(.top, 3)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(MenuType.bodyMedium(11))
                    .foregroundStyle(ShellPalette.ink)

                Text(value)
                    .font(MenuType.body(10.5))
                    .foregroundStyle(ShellPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 54)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isClickable && isHovered ? ShellPalette.surfaceFillStrong : ShellPalette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(tileBorder, lineWidth: isFocused ? 2 : 1)
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

    private var tileBorder: Color {
        if isFocused { return ShellPalette.accent }
        return isClickable && isHovered ? ShellPalette.lineStrong : ShellPalette.line
    }
}
