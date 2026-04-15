import SwiftUI

private enum ShellPalette {
    static let shellBackground = Color(red: 244 / 255, green: 246 / 255, blue: 248 / 255)
    static let shellPanel = Color.white.opacity(0.92)
    static let card = Color.white.opacity(0.95)
    static let cardMuted = Color(red: 249 / 255, green: 250 / 255, blue: 252 / 255)
    static let ink = Color(red: 37 / 255, green: 42 / 255, blue: 49 / 255)
    static let copy = Color(red: 70 / 255, green: 76 / 255, blue: 85 / 255)
    static let dim = Color(red: 126 / 255, green: 135 / 255, blue: 147 / 255)
    static let muted = Color(red: 182 / 255, green: 188 / 255, blue: 197 / 255)
    static let line = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255).opacity(0.08)
    static let lineStrong = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255).opacity(0.14)
    static let sand = Color(red: 229 / 255, green: 225 / 255, blue: 215 / 255)
    static let accent = Color(red: 91 / 255, green: 132 / 255, blue: 255 / 255)
    static let accentSoft = Color(red: 91 / 255, green: 132 / 255, blue: 255 / 255).opacity(0.12)
    static let success = Color(red: 47 / 255, green: 122 / 255, blue: 85 / 255)
    static let successSoft = Color(red: 47 / 255, green: 122 / 255, blue: 85 / 255).opacity(0.12)
    static let warning = Color(red: 177 / 255, green: 120 / 255, blue: 34 / 255)
    static let warningSoft = Color(red: 177 / 255, green: 120 / 255, blue: 34 / 255).opacity(0.12)
    static let error = Color(red: 171 / 255, green: 73 / 255, blue: 63 / 255)
    static let errorSoft = Color(red: 171 / 255, green: 73 / 255, blue: 63 / 255).opacity(0.12)
}

private enum MenuType {
    static func title(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }

    static func body(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular, design: .rounded)
    }

    static func bodyMedium(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .rounded)
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

private struct StatusTone {
    let fill: Color
    let soft: Color
}

private struct ShellBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [ShellPalette.shellBackground, Color.white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [ShellPalette.accent.opacity(0.08), .clear],
                center: .topLeading,
                startRadius: 20,
                endRadius: 220
            )
            .offset(x: -30, y: -80)

            RadialGradient(
                colors: [ShellPalette.accent.opacity(0.14), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 200
            )
            .offset(x: 50, y: -120)

            DotGrid()
                .opacity(0.3)
                .mask(
                    LinearGradient(
                        colors: [.black.opacity(0.9), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        }
        .ignoresSafeArea()
    }
}

private struct DotGrid: View {
    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 28
            let dotSize: CGFloat = 1.3

            for x in stride(from: 10.0, through: size.width + spacing, by: spacing) {
                for y in stride(from: 8.0, through: size.height + spacing, by: spacing) {
                    let rect = CGRect(x: x, y: y, width: dotSize, height: dotSize)
                    context.fill(Path(ellipseIn: rect), with: .color(ShellPalette.muted))
                }
            }
        }
    }
}

private struct PrimaryPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MenuType.mono(10, weight: .semibold))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? ShellPalette.accent.opacity(0.88) : ShellPalette.accent)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private struct SecondaryPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MenuType.mono(10, weight: .medium))
            .foregroundStyle(ShellPalette.ink)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? Color.white.opacity(0.7) : ShellPalette.cardMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(ShellPalette.sand, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private struct HeaderIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(ShellPalette.ink)
            .frame(width: 30, height: 30)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(configuration.isPressed ? Color.white.opacity(0.68) : Color.white.opacity(0.82))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(ShellPalette.lineStrong, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct MainView: View {
    @ObservedObject var controller: OpenScoutAppController

    var body: some View {
        ZStack {
            ShellBackdrop()

            VStack(spacing: 10) {
                headerPanel

                if let lastError = controller.lastError, !lastError.isEmpty {
                    errorBanner(lastError)
                }

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 10) {
                        brokerCard
                        pairingCard
                        utilitiesCard
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(ShellPalette.shellPanel)
                    .overlay(
                        RoundedRectangle(cornerRadius: 26, style: .continuous)
                            .stroke(ShellPalette.sand, lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.08), radius: 26, x: 0, y: 16)
            )
            .padding(8)
        }
        .frame(width: 408, height: 574)
        .preferredColorScheme(.light)
    }

    private var headerPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("OPENSCOUT")
                        .font(MenuType.mono(10))
                        .tracking(1.8)
                        .foregroundStyle(ShellPalette.dim)

                    Text("Local control plane")
                        .font(MenuType.title(19))
                        .foregroundStyle(ShellPalette.ink)

                    Text("Broker, pairing, and the local operator surface.")
                        .font(MenuType.body(11.5))
                        .foregroundStyle(ShellPalette.copy)
                }

                Spacer(minLength: 8)

                HStack(spacing: 6) {
                    Button {
                        controller.openWebApp()
                    } label: {
                        Image(systemName: "safari")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(HeaderIconButtonStyle())
                    .disabled(controller.webActionPending)

                    Button {
                        controller.refresh()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(HeaderIconButtonStyle())
                    .disabled(controller.isRefreshing)
                }
                .opacity((controller.webActionPending || controller.isRefreshing) ? 0.55 : 1)
            }

            HStack(spacing: 6) {
                headerStatusPill(label: "Broker", value: brokerSummaryValue(), tone: brokerTone())
                headerStatusPill(label: "Pairing", value: pairingSummaryValue(), tone: pairingTone())
                headerStatusPill(
                    label: "Web",
                    value: controller.webReachable ? "Ready" : (controller.webServerStartedByApp ? "Booting" : "Closed"),
                    tone: controller.webReachable
                        ? StatusTone(fill: ShellPalette.accent, soft: ShellPalette.accentSoft)
                        : neutralTone()
                )
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.96), ShellPalette.cardMuted],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(ShellPalette.sand, lineWidth: 1)
        )
        .padding(.horizontal, 10)
        .padding(.top, 10)
    }

    private var brokerCard: some View {
        sectionCard(
            eyebrow: "Broker",
            title: brokerHeadline(),
            detail: brokerDetailSummary(),
            badge: brokerSummaryValue(),
            tone: brokerTone()
        ) {
            detailRows([
                ("URL", controller.broker.brokerURL),
                ("Agent", compactPath(controller.broker.launchAgentPath) ?? "Not installed"),
                ("PID", controller.broker.pid.map(String.init) ?? "—"),
            ])

            HStack(spacing: 6) {
                if !controller.broker.installed {
                    Button("Install") {
                        controller.installBroker()
                    }
                    .buttonStyle(PrimaryPillStyle())
                } else if controller.broker.loaded {
                    Button("Restart") {
                        controller.restartBroker()
                    }
                    .buttonStyle(PrimaryPillStyle())

                    Button("Stop") {
                        controller.stopBroker()
                    }
                    .buttonStyle(SecondaryPillStyle())
                } else {
                    Button("Start") {
                        controller.startBroker()
                    }
                    .buttonStyle(PrimaryPillStyle())
                }
            }
            .disabled(controller.brokerActionPending)
            .opacity(controller.brokerActionPending ? 0.55 : 1)
        }
    }

    private var pairingCard: some View {
        sectionCard(
            eyebrow: "Pairing",
            title: pairingHeadline(),
            detail: controller.pairing.statusDetail,
            badge: pairingSummaryValue(),
            tone: pairingTone()
        ) {
            detailRows([
                ("Relay", controller.pairing.relay ?? "Managed relay on demand"),
                ("Workspace", compactPath(controller.pairing.workspaceRoot) ?? "—"),
                ("Identity", controller.pairing.identityFingerprint ?? "—"),
                ("Trusted", "\(controller.pairing.trustedPeerCount)"),
            ])

            if let controlHint = controller.pairing.controlHint, !controlHint.isEmpty {
                noteRow(controlHint)
            }

            if let qrArt = controller.pairing.qrArt,
               controller.pairing.isRunning,
               controller.pairing.status != "paired" {
                qrPanel(qrArt)
            }

            HStack(spacing: 6) {
                Button("Start") {
                    controller.startPairing()
                }
                .buttonStyle(PrimaryPillStyle())
                .disabled(!controller.pairing.controlAvailable || controller.pairingActionPending || controller.pairing.isRunning)

                Button("Restart") {
                    controller.restartPairing()
                }
                .buttonStyle(SecondaryPillStyle())
                .disabled(!controller.pairing.controlAvailable || controller.pairingActionPending)

                Button("Stop") {
                    controller.stopPairing()
                }
                .buttonStyle(SecondaryPillStyle())
                .disabled(!controller.pairing.controlAvailable || controller.pairingActionPending || !controller.pairing.isRunning)
            }
            .opacity(controller.pairingActionPending ? 0.55 : 1)

            if let updatedAt = controller.pairing.lastUpdatedLabel {
                Text("Updated \(updatedAt)")
                    .font(MenuType.mono(10))
                    .foregroundStyle(ShellPalette.dim)
            }
        }
    }

    private var utilitiesCard: some View {
        sectionCard(
            eyebrow: "Utilities",
            title: "Operator shortcuts",
            detail: "Fast local actions from the menu bar, without opening the full app shell.",
            badge: controller.webReachable ? "Ready" : "Local",
            tone: controller.webReachable
                ? StatusTone(fill: ShellPalette.accent, soft: ShellPalette.accentSoft)
                : neutralTone()
        ) {
            VStack(spacing: 5) {
                utilityRow(
                    title: controller.webReachable ? "Open web app" : "Start web app",
                    subtitle: controller.webReachable
                        ? "Launch the local operator surface."
                        : "Boot the local web shell and open it.",
                    symbol: "safari",
                    emphasized: true,
                    disabled: controller.webActionPending
                ) {
                    controller.openWebApp()
                }

                utilityRow(
                    title: controller.webServerStartedByApp ? "Stop web server" : "Refresh state",
                    subtitle: controller.webServerStartedByApp
                        ? "Terminate the local web process started from this menu."
                        : "Poll broker, pairing, and web state right now.",
                    symbol: controller.webServerStartedByApp ? "pause.circle" : "arrow.clockwise",
                    emphasized: false,
                    disabled: controller.webServerStartedByApp ? false : controller.isRefreshing
                ) {
                    if controller.webServerStartedByApp {
                        controller.stopWebApp()
                    } else {
                        controller.refresh()
                    }
                }

                utilityRow(
                    title: "Feedback",
                    subtitle: "Open the support and diagnostics surface.",
                    symbol: "paperplane",
                    emphasized: false,
                    disabled: false
                ) {
                    controller.openFeedback()
                }

                utilityRow(
                    title: "About",
                    subtitle: "Show version and app metadata.",
                    symbol: "info.circle",
                    emphasized: false,
                    disabled: false
                ) {
                    controller.openAboutPanel()
                }
            }
        }
    }

    private func headerStatusPill(label: String, value: String, tone: StatusTone) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tone.fill)
                .frame(width: 5.5, height: 5.5)

            Text(label.uppercased())
                .font(MenuType.mono(8.5))
                .tracking(1.1)
                .foregroundStyle(ShellPalette.dim)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .allowsTightening(true)

            Text(value)
                .font(MenuType.bodyMedium(10.5))
                .foregroundStyle(ShellPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.84)
                .allowsTightening(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6.5)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(Color.white.opacity(0.82))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(tone.soft.opacity(0.9), lineWidth: 1)
        )
    }

    private func sectionCard<Content: View>(
        eyebrow: String,
        title: String,
        detail: String,
        badge: String,
        tone: StatusTone,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(tone.fill)
                    .frame(width: 3, height: 34)
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 4) {
                    Text(eyebrow.uppercased())
                        .font(MenuType.mono(9))
                        .tracking(1.6)
                        .foregroundStyle(ShellPalette.dim)

                    Text(title)
                        .font(MenuType.title(15))
                        .foregroundStyle(ShellPalette.ink)

                    Text(detail)
                        .font(MenuType.body(11))
                        .foregroundStyle(ShellPalette.copy)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(badge.uppercased())
                    .font(MenuType.mono(8.5, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(tone.fill)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                    .allowsTightening(true)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(tone.soft)
                    )
            }

            content()
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ShellPalette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(ShellPalette.sand, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.035), radius: 12, x: 0, y: 8)
    }

    private func detailRows(_ items: [(String, String)]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .top, spacing: 10) {
                    Text(item.0.uppercased())
                        .font(MenuType.mono(8.5))
                        .tracking(1.2)
                        .foregroundStyle(ShellPalette.dim)
                        .frame(width: 68, alignment: .leading)

                    Text(item.1)
                        .font(MenuType.mono(10, weight: .regular))
                        .foregroundStyle(ShellPalette.ink)
                        .lineLimit(3)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)

                if index < items.count - 1 {
                    Divider()
                        .overlay(ShellPalette.line)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(ShellPalette.cardMuted)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ShellPalette.sand, lineWidth: 1)
        )
    }

    private func noteRow(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ShellPalette.warning)
                .padding(.top, 1)

            Text(message)
                .font(MenuType.body(11.5))
                .foregroundStyle(ShellPalette.copy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ShellPalette.warningSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(ShellPalette.warning.opacity(0.25), lineWidth: 1)
        )
    }

    private func qrPanel(_ qrArt: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SCAN FROM SCOUT")
                .font(MenuType.mono(9))
                .tracking(1.5)
                .foregroundStyle(ShellPalette.dim)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(qrArt)
                    .font(.system(size: 5.9, weight: .regular, design: .monospaced))
                    .foregroundStyle(ShellPalette.ink)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(ShellPalette.sand, lineWidth: 1)
            )
        }
    }

    private func utilityRow(
        title: String,
        subtitle: String,
        symbol: String,
        emphasized: Bool,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(emphasized ? ShellPalette.accentSoft : Color.white.opacity(0.78))
                        .frame(width: 28, height: 28)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(emphasized ? ShellPalette.accentSoft : ShellPalette.sand, lineWidth: 1)
                        )

                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(emphasized ? ShellPalette.accent : ShellPalette.ink)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(MenuType.bodyMedium(12))
                        .foregroundStyle(ShellPalette.ink)

                    Text(subtitle)
                        .font(MenuType.body(10.8))
                        .foregroundStyle(ShellPalette.copy)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 6)

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ShellPalette.dim)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(emphasized ? Color.white.opacity(0.96) : ShellPalette.cardMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(emphasized ? ShellPalette.accentSoft : ShellPalette.sand, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .opacity(disabled ? 0.55 : 1)
        .disabled(disabled)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "xmark.octagon.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ShellPalette.error)
                .padding(.top, 1)

            Text(message)
                .font(MenuType.body(11.5))
                .foregroundStyle(ShellPalette.copy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(ShellPalette.errorSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ShellPalette.error.opacity(0.22), lineWidth: 1)
        )
        .padding(.horizontal, 10)
    }

    private func compactPath(_ value: String?) -> String? {
        guard let value, !value.isEmpty else {
            return nil
        }

        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if value.hasPrefix(home) {
            return "~" + value.dropFirst(home.count)
        }

        return value
    }

    private func brokerHeadline() -> String {
        if controller.broker.reachable {
            return "Live on the local mesh"
        }
        if controller.broker.installed {
            return controller.broker.loaded ? "Installed but not answering" : "Installed and waiting"
        }
        return "Not installed yet"
    }

    private func brokerDetailSummary() -> String {
        if controller.broker.reachable {
            return "Broker is answering locally. Full endpoint details are listed below."
        }
        if controller.broker.loaded {
            return "Launch agent is loaded, but broker health checks are failing."
        }
        if controller.broker.installed {
            return "Launch agent is installed and ready to start."
        }
        return "Launch agent is not installed yet."
    }

    private func pairingHeadline() -> String {
        switch controller.pairing.status {
        case "paired":
            return "Secure peer is connected"
        case "connected", "connecting":
            return "Relay session is active"
        case "error":
            return "Pairing needs attention"
        default:
            return "Ready when you want it"
        }
    }

    private func brokerSummaryValue() -> String {
        if controller.broker.reachable {
            return "Online"
        }
        if controller.broker.installed {
            return controller.broker.loaded ? "Waiting" : "Dormant"
        }
        return "Offline"
    }

    private func pairingSummaryValue() -> String {
        switch controller.pairing.status {
        case "paired":
            return "Paired"
        case "connected", "connecting":
            return "Active"
        case "error":
            return "Error"
        default:
            return "Idle"
        }
    }

    private func brokerTone() -> StatusTone {
        if controller.broker.reachable {
            return StatusTone(fill: ShellPalette.accent, soft: ShellPalette.accentSoft)
        }
        if controller.broker.installed {
            return StatusTone(fill: ShellPalette.warning, soft: ShellPalette.warningSoft)
        }
        return neutralTone()
    }

    private func pairingTone() -> StatusTone {
        switch controller.pairing.status {
        case "paired":
            return StatusTone(fill: ShellPalette.success, soft: ShellPalette.successSoft)
        case "connected", "connecting":
            return StatusTone(fill: ShellPalette.warning, soft: ShellPalette.warningSoft)
        case "error":
            return StatusTone(fill: ShellPalette.error, soft: ShellPalette.errorSoft)
        default:
            return neutralTone()
        }
    }

    private func neutralTone() -> StatusTone {
        StatusTone(fill: ShellPalette.dim, soft: ShellPalette.lineStrong)
    }
}
