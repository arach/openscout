import AppKit
import SwiftUI

struct MainView: View {
    @ObservedObject var controller: OpenScoutAppController
    @ObservedObject private var theme = ThemeManager.shared

    @State private var showQR: Bool = false

    static let baseHeight: CGFloat = 168
    static let errorHeight: CGFloat = 240
    static let qrHeight: CGFloat = 484
    static let qrWithErrorHeight: CGFloat = 556

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
                    if let lastError = controller.lastError, !lastError.isEmpty {
                        errorBanner(lastError)
                    }

                    Spacer(minLength: 0)
                    deckStrip

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
        .animation(.easeInOut(duration: 0.18), value: showQR)
        .preferredColorScheme(theme.colorScheme)
    }

    private var hasError: Bool {
        if let last = controller.lastError, !last.isEmpty { return true }
        return false
    }

    private var popoverHeight: CGFloat {
        switch (showQR, hasError) {
        case (true, true):   return Self.qrWithErrorHeight
        case (true, false):  return Self.qrHeight
        case (false, true):  return Self.errorHeight
        case (false, false): return Self.baseHeight
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            statusDot

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

    private var statusDot: some View {
        Circle()
            .fill(overallStatusColor)
            .frame(width: 7, height: 7)
    }

    private var overallStatusColor: Color {
        if !controller.broker.reachable { return ShellPalette.error }
        if !controller.webReachable { return ShellPalette.error }
        if controller.tailscale.available && !controller.tailscale.running {
            return ShellPalette.warning
        }
        return ShellPalette.success
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

    // MARK: - Deck strip

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
                    helpText: brokerHelp
                )
                deckDivider
                DeckTileButton(
                    glyph: .relay,
                    label: "RELAY",
                    value: relayValue,
                    tint: relayTint,
                    action: relayAction,
                    helpText: relayHelp
                )
                deckDivider
                DeckTileButton(
                    glyph: .web,
                    label: "WEB",
                    value: webValue,
                    tint: webTint,
                    action: webAction,
                    helpText: webHelp
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
        if !controller.pairing.isRunning { return ShellPalette.error }
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
        return controller.webReachable ? ":3200" : "START"
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
                Text("Starting pair-supervisor…")
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

private struct DeckTileButton: View {
    let glyph: ServiceGlyph.Kind
    let label: String
    let value: String
    let tint: Color
    let action: (() -> Void)?
    let helpText: String

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
