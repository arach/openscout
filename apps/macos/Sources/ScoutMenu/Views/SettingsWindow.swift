import AppKit
import ScoutAppCore
import SwiftUI

@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
    static let shared = SettingsWindowController()

    private var window: NSWindow?
    private weak var controller: OpenScoutAppController?
    private let frameAutosaveName = "OpenScoutSettingsWindow"

    private override init() {
        super.init()
    }

    func show(controller: OpenScoutAppController) {
        self.controller = controller
        controller.setStatusSurfaceVisible(true, source: "settings")
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let hosting = NSHostingController(rootView: SettingsRootView(controller: controller))
        let window = NSWindow(contentViewController: hosting)
        window.title = "OpenScout Settings"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.setContentSize(NSSize(width: 720, height: 540))
        window.minSize = NSSize(width: 640, height: 460)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName(frameAutosaveName)
        if window.frame.origin == .zero {
            window.center()
        }
        window.appearance = NSAppearance(named: .darkAqua)

        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() {
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        controller?.setStatusSurfaceVisible(false, source: "settings")
        controller = nil
        window = nil
    }
}

// MARK: - Root

private enum SettingsTab: String, CaseIterable, Identifiable {
    case network, diagnostics, about

    var id: String { rawValue }

    var label: String {
        switch self {
        case .network:     return "Network"
        case .diagnostics: return "Diagnostics"
        case .about:       return "About"
        }
    }

    var symbol: String {
        switch self {
        case .network:     return "network"
        case .diagnostics: return "stethoscope"
        case .about:       return "info.circle"
        }
    }
}

private struct SettingsRootView: View {
    @ObservedObject var controller: OpenScoutAppController
    @State private var selected: SettingsTab = .network

    var body: some View {
        ZStack {
            ShellPalette.shellBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar

                Hairline()

                HStack(spacing: 0) {
                    sidebar

                    Rectangle()
                        .fill(ShellPalette.line)
                        .frame(width: 1)

                    ScrollView(.vertical, showsIndicators: false) {
                        Group {
                            switch selected {
                            case .network:     NetworkTab(controller: controller)
                            case .diagnostics: DiagnosticsTab(controller: controller)
                            case .about:       AboutTab(controller: controller)
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            // Reserve space for the traffic-light buttons.
            Color.clear.frame(width: 64, height: 1)

            Text("OPENSCOUT")
                .font(MenuType.mono(11, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(ShellPalette.ink)

            Text("·")
                .font(MenuType.mono(11))
                .foregroundStyle(ShellPalette.muted)

            Text("SETTINGS")
                .font(MenuType.mono(10, weight: .medium))
                .tracking(1.2)
                .foregroundStyle(ShellPalette.dim)

            Spacer()

            Button {
                controller.refresh()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(HeaderIconButtonStyle())
            .disabled(controller.isRefreshing)
            .help("Refresh status")

            Text("v\(buildVersion())")
                .font(MenuType.mono(10))
                .foregroundStyle(ShellPalette.muted)
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(ShellPalette.chrome)
    }

    private var sidebar: some View {
        VStack(spacing: 4) {
            ForEach(SettingsTab.allCases) { tab in
                sidebarItem(tab)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 8)
        .frame(width: 132, alignment: .topLeading)
        .background(ShellPalette.chromeFooter)
    }

    private func sidebarItem(_ tab: SettingsTab) -> some View {
        let active = selected == tab
        return Button {
            selected = tab
        } label: {
            HStack(spacing: 8) {
                Image(systemName: tab.symbol)
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 14)

                Text(tab.label.uppercased())
                    .font(MenuType.mono(10, weight: active ? .semibold : .regular))
                    .tracking(0.8)
                    .lineLimit(1)

                Spacer(minLength: 0)
            }
            .foregroundStyle(active ? ShellPalette.ink : ShellPalette.dim)
            .padding(.horizontal, 9)
            .frame(height: 28)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(active ? ShellPalette.surfaceFill : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(active ? ShellPalette.lineStrong : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func buildVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }
}

// MARK: - Diagnostics

private struct DiagnosticsTab: View {
    @ObservedObject var controller: OpenScoutAppController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DiagnosticsCard(
                label: "Broker",
                status: brokerStatus(),
                summary: brokerSummary(),
                detail: brokerDetail(),
                rows: brokerRows(),
                logPath: nil,
                actions: []
            )

            DiagnosticsCard(
                label: "Relay",
                status: relayStatus(),
                summary: relaySummary(),
                detail: relayDetail(),
                rows: [
                    KVEntry(key: "Pairing", value: controller.pairing.statusLabel),
                    KVEntry(key: "Tailscale", value: controller.tailscale.statusLabel),
                    KVEntry(
                        key: "Workspace",
                        value: controller.pairing.workspaceRoot ?? "—",
                        path: controller.pairing.workspaceRoot
                    ),
                    KVEntry(key: "Trusted peers", value: "\(controller.pairing.trustedPeerCount)"),
                ],
                logPath: nil,
                actions: []
            )

            DiagnosticsCard(
                label: "Web",
                status: webStatus(),
                summary: webSummary(),
                detail: webDetail(),
                rows: [
                    KVEntry(key: "Reachable", value: controller.webReachable ? "Yes" : "No"),
                    KVEntry(key: "Started by app", value: controller.webServerStartedByApp ? "Yes" : "No"),
                ],
                logPath: webLogPath(),
                actions: [
                    ("Reveal log", { revealInFinder(webLogPath()) }),
                    ("Open in Console", { openInConsole(webLogPath()) }),
                ]
            )

            if let lastError = controller.lastError, !lastError.isEmpty {
                ErrorCard(message: lastError)
            }
        }
    }

    // MARK: status helpers

    private func brokerStatus() -> ServiceLightStatus {
        if controller.brokerActionPending { return .pending }
        if controller.broker.hasRestartWarning { return .warn }
        if controller.broker.reachable { return .healthy }
        if controller.broker.loaded { return .warn }
        if controller.broker.installed { return .warn }
        return .fail
    }

    private func brokerSummary() -> String {
        if controller.brokerActionPending { return "Working" }
        if controller.broker.hasRestartWarning { return "Restart warning" }
        if controller.broker.reachable { return "Online" }
        if controller.broker.loaded { return "Loaded, no answer" }
        if controller.broker.installed { return "Dormant" }
        return "Not installed"
    }

    private func brokerDetail() -> String {
        var lines = [controller.broker.statusDetail]
        if let warning = controller.broker.restartWarningSummary {
            lines.append(warning)
        }
        return lines.joined(separator: "\n\n")
    }

    private func brokerRows() -> [KVEntry] {
        var rows = [
            KVEntry(key: "URL", value: controller.broker.brokerURL),
            KVEntry(
                key: "Launch agent",
                value: controller.broker.launchAgentPath.isEmpty ? "Not installed" : controller.broker.launchAgentPath,
                path: controller.broker.launchAgentPath.isEmpty ? nil : controller.broker.launchAgentPath
            ),
            KVEntry(key: "PID", value: controller.broker.pid.map(String.init) ?? "—"),
        ]

        guard let telemetry = controller.broker.restartTelemetry else {
            return rows
        }

        if let restartCount = telemetry.restartCount {
            rows.append(KVEntry(key: "Runtime restarts", value: "\(restartCount)"))
        }
        if let baseState = telemetry.baseState {
            rows.append(KVEntry(key: "Runtime state", value: baseState))
        }
        if let basePid = telemetry.basePid {
            rows.append(KVEntry(key: "Runtime PID", value: "\(basePid)"))
        }
        if let backoff = telemetry.backoffLabel() {
            rows.append(KVEntry(key: "Restart backoff", value: backoff))
        }
        if let nextRestartAt = telemetry.nextRestartAt {
            rows.append(KVEntry(key: "Next restart", value: formatTimestamp(nextRestartAt)))
        }
        if let lastExitAt = telemetry.lastExitAt {
            rows.append(KVEntry(key: "Last exit", value: formatTimestamp(lastExitAt)))
        }
        if let lastRestartAt = telemetry.lastRestartAt {
            rows.append(KVEntry(key: "Last restart", value: formatTimestamp(lastRestartAt)))
        }
        if let updatedAt = telemetry.updatedAt {
            rows.append(KVEntry(key: "Runtime updated", value: formatTimestamp(updatedAt)))
        }

        return rows
    }

    private func relayStatus() -> ServiceLightStatus {
        if controller.pairingActionPending || controller.tailscaleActionPending { return .pending }
        if controller.tailscale.available && !controller.tailscale.running { return .warn }
        switch controller.pairing.status {
        case "paired":               return .healthy
        case "connected", "connecting": return .warn
        case "error":                return .fail
        default:                     return controller.pairing.isRunning ? .warn : .fail
        }
    }

    private func relaySummary() -> String {
        if controller.pairingActionPending || controller.tailscaleActionPending { return "Working" }
        if controller.tailscale.available && !controller.tailscale.running { return "Tailscale stopped" }
        switch controller.pairing.status {
        case "paired":      return "Paired"
        case "connected", "connecting": return "Connecting"
        case "error":       return "Error"
        default:            return controller.pairing.isRunning ? "Awaiting peer" : "Not paired"
        }
    }

    private func relayDetail() -> String {
        var lines: [String] = []
        lines.append(controller.pairing.statusDetail)
        if controller.tailscale.available {
            lines.append("Tailscale: \(controller.tailscale.statusDetail)")
        }
        if let hint = controller.pairing.controlHint, !hint.isEmpty {
            lines.append(hint)
        }
        return lines.joined(separator: "\n\n")
    }

    private func webStatus() -> ServiceLightStatus {
        if controller.webActionPending { return .pending }
        return controller.webReachable ? .healthy : .fail
    }

    private func webSummary() -> String {
        if controller.webActionPending { return "Booting" }
        return controller.webReachable ? "Ready" : "Down"
    }

    private func webDetail() -> String {
        if controller.webReachable {
            return "Web surface is responding on \(ScoutWeb.baseURL().absoluteString)."
        }
        if controller.webActionPending {
            return "Web app is starting. This may take up to 15 seconds on first boot."
        }
        return "Web surface is not running. Start it from the menu or via `scout server start`."
    }

    private func webLogPath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".scout/logs/web-server.log").path
    }

    private func formatTimestamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .standard)
    }

    private func revealInFinder(_ path: String) {
        let url = URL(fileURLWithPath: path)
        if FileManager.default.fileExists(atPath: path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
        }
    }

    private func openInConsole(_ path: String) {
        let url = URL(fileURLWithPath: path)
        if FileManager.default.fileExists(atPath: path) {
            let consoleURL = URL(fileURLWithPath: "/System/Applications/Utilities/Console.app")
            NSWorkspace.shared.open([url], withApplicationAt: consoleURL, configuration: NSWorkspace.OpenConfiguration())
        } else {
            revealInFinder(path)
        }
    }
}

private struct KVEntry {
    let key: String
    let value: String
    /// If non-nil, the value renders with a "reveal in Finder" affordance.
    let path: String?

    init(key: String, value: String, path: String? = nil) {
        self.key = key
        self.value = value
        self.path = path
    }
}

private struct DiagnosticsCard: View {
    let label: String
    let status: ServiceLightStatus
    let summary: String
    let detail: String
    let rows: [KVEntry]
    let logPath: String?
    let actions: [(String, () -> Void)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                statusDot

                ServiceGlyph(
                    kind: ServiceGlyph.kind(forServiceID: label.lowercased()),
                    size: 15,
                    color: ShellPalette.ink
                )

                Text(label.uppercased())
                    .font(MenuType.mono(11, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(ShellPalette.ink)

                Text(summary)
                    .font(MenuType.mono(12, weight: .semibold))
                    .foregroundStyle(ShellPalette.ink)

                Spacer()
            }

            if !detail.isEmpty {
                Text(detail)
                    .font(MenuType.body(11.5))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if !rows.isEmpty {
                VStack(spacing: 5) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        KVRow(entry: row)
                    }
                }
                .padding(.top, 2)
            }

            if let logPath, !logPath.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(ShellPalette.muted)
                    Text(logPath)
                        .font(MenuType.mono(9))
                        .foregroundStyle(ShellPalette.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if !actions.isEmpty {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                        Button(action.0, action: action.1)
                            .buttonStyle(SecondaryPillStyle())
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(borderColor, lineWidth: 1)
        )
    }

    private var statusDot: some View {
        Circle()
            .fill(status.dotColor)
            .frame(width: 8, height: 8)
            .frame(width: 14, height: 14)
    }

    private var borderColor: Color {
        ShellPalette.line
    }
}

private struct KVRow: View {
    let entry: KVEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(entry.key.uppercased())
                .font(MenuType.mono(9, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ShellPalette.muted)
                .frame(width: 92, alignment: .leading)

            Text(entry.value)
                .font(MenuType.mono(11))
                .foregroundStyle(ShellPalette.copy)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let path = entry.path, !path.isEmpty,
               FileManager.default.fileExists(atPath: path) ||
               FileManager.default.fileExists(atPath: (path as NSString).deletingLastPathComponent) {
                Button {
                    revealInFinder(path)
                } label: {
                    Image(systemName: "arrow.up.forward.app")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(ShellPalette.muted)
                }
                .buttonStyle(.plain)
                .help("Reveal in Finder")
            }
        }
    }

    private func revealInFinder(_ path: String) {
        let url = URL(fileURLWithPath: path)
        if FileManager.default.fileExists(atPath: path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
        }
    }
}

private struct ErrorCard: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ShellPalette.error)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                Text("LAST ERROR")
                    .font(MenuType.mono(9, weight: .bold))
                    .tracking(1.0)
                    .foregroundStyle(ShellPalette.error)

                Text(message)
                    .font(MenuType.mono(11))
                    .foregroundStyle(ShellPalette.copy)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(12)
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
}

// MARK: - About

private struct AboutTab: View {
    @ObservedObject var controller: OpenScoutAppController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("OPENSCOUT")
                        .font(MenuType.mono(20, weight: .bold))
                        .tracking(2.4)
                        .foregroundStyle(ShellPalette.ink)

                    Text("MENU")
                        .font(MenuType.mono(11, weight: .medium))
                        .tracking(1.4)
                        .foregroundStyle(ShellPalette.dim)

                    Spacer()
                }

                Text("Local control plane for the Scout mesh. Lives in your menu bar and keeps the broker, relay, and web shell honest.")
                    .font(MenuType.body(12))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 5) {
                    KVRow(entry: KVEntry(key: "Version", value: versionString()))
                    KVRow(entry: KVEntry(key: "Build", value: buildNumber()))
                    KVRow(entry: KVEntry(key: "Identifier", value: bundleIdentifier()))
                }

                HStack(spacing: 16) {
                    Link(destination: URL(string: "https://github.com/arach/openscout")!) {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.right.square")
                                .font(.system(size: 10, weight: .semibold))
                            Text("OPENSCOUT ON GITHUB")
                                .font(MenuType.mono(10, weight: .semibold))
                                .tracking(0.8)
                        }
                        .foregroundStyle(ShellPalette.accent)
                    }

                    Button {
                        controller.openFeedback()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "paperplane")
                                .font(.system(size: 10, weight: .semibold))
                            Text("SEND FEEDBACK")
                                .font(MenuType.mono(10, weight: .semibold))
                                .tracking(0.8)
                        }
                        .foregroundStyle(ShellPalette.accent)
                    }
                    .buttonStyle(.plain)

                    Spacer()
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(ShellPalette.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(ShellPalette.line, lineWidth: 1)
            )
        }
    }

    private func versionString() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    private func buildNumber() -> String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
    }

    private func bundleIdentifier() -> String {
        Bundle.main.bundleIdentifier ?? "—"
    }
}

// MARK: - Network

private struct NetworkTab: View {
    @ObservedObject var controller: OpenScoutAppController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SettingsCard {
                HStack(spacing: 10) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                        .frame(width: 14, height: 14)

                    Image(systemName: "network")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(ShellPalette.ink)

                    Text("OPENSCOUT NETWORK")
                        .font(MenuType.mono(11, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(ShellPalette.ink)

                    Text(controller.openScoutNetwork.statusLabel)
                        .font(MenuType.mono(12, weight: .semibold))
                        .foregroundStyle(ShellPalette.ink)

                    Spacer()
                }

                Text(controller.openScoutNetwork.statusDetail)
                    .font(MenuType.body(11.5))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)

                SettingsToggleRow(
                    title: "Publish this Mac",
                    detail: "Make this Mac discoverable through OpenScout Network for paired devices and mesh-aware Scout peers.",
                    isOn: Binding(
                        get: { controller.openScoutNetwork.discoveryEnabled },
                        set: { controller.setOpenScoutNetworkDiscoveryEnabled($0) }
                    ),
                    disabled: controller.openScoutNetworkActionPending
                )

                SettingsToggleRow(
                    title: "Keep mobile relay available",
                    detail: "Keep the OSN pairing bridge running so paired iPhone and iPad clients can reconnect without scanning again.",
                    isOn: Binding(
                        get: { controller.openScoutNetwork.keepPairingRelayRunning },
                        set: { controller.setOpenScoutNetworkKeepPairingRelayRunning($0) }
                    ),
                    disabled: !controller.openScoutNetwork.discoveryEnabled
                        || controller.openScoutNetworkActionPending
                        || controller.pairingActionPending
                )

                VStack(spacing: 5) {
                    KVRow(entry: KVEntry(key: "Account", value: controller.openScoutNetwork.sessionAvailable ? "Signed in" : "Not signed in"))
                    KVRow(entry: KVEntry(key: "Discovery", value: controller.openScoutNetwork.rendezvousURL))
                    KVRow(entry: KVEntry(key: "Relay", value: controller.openScoutNetwork.pairingRelayURL))
                }

                HStack(spacing: 8) {
                    Spacer(minLength: 0)

                    if !controller.openScoutNetwork.sessionAvailable {
                        Button("Sign in") {
                            controller.signInOpenScoutNetwork()
                        }
                        .buttonStyle(PrimaryPillStyle())
                    }

                    Button("Restart relay") {
                        controller.restartPairing()
                    }
                    .buttonStyle(SecondaryPillStyle())
                    .disabled(controller.pairingActionPending || !controller.openScoutNetwork.discoveryEnabled)
                }
            }

            SettingsCard {
                HStack(spacing: 10) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ShellPalette.muted)

                    Text("SETTINGS FILE")
                        .font(MenuType.mono(10, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(ShellPalette.muted)

                    Spacer()
                }

                KVRow(entry: KVEntry(
                    key: "Path",
                    value: controller.openScoutNetwork.settingsPath,
                    path: controller.openScoutNetwork.settingsPath
                ))
            }
        }
    }

    private var statusColor: Color {
        if controller.openScoutNetworkActionPending || controller.pairingActionPending {
            return ShellPalette.warning
        }
        if !controller.openScoutNetwork.discoveryEnabled {
            return ShellPalette.muted
        }
        return controller.openScoutNetwork.sessionAvailable ? ShellPalette.success : ShellPalette.warning
    }
}

private struct SettingsCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.line, lineWidth: 1)
        )
    }
}

private struct SettingsToggleRow: View {
    let title: String
    let detail: String
    @Binding var isOn: Bool
    var disabled = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(MenuType.mono(11, weight: .semibold))
                    .foregroundStyle(disabled ? ShellPalette.muted : ShellPalette.ink)

                Text(detail)
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .disabled(disabled)
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
}

// MARK: - Hairline

private struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(ShellPalette.line)
            .frame(height: 1)
    }
}
