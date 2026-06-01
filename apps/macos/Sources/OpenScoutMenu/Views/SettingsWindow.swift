import AppKit
import Combine
import SwiftUI

@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
    static let shared = SettingsWindowController()

    private var window: NSWindow?
    private var themeCancellable: AnyCancellable?
    private let frameAutosaveName = "OpenScoutSettingsWindow"

    private override init() {
        super.init()
    }

    func show(controller: OpenScoutAppController) {
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
        window.appearance = ThemeManager.shared.nsAppearance

        themeCancellable = ThemeManager.shared.$mode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.window?.appearance = ThemeManager.shared.nsAppearance
            }

        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() {
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        themeCancellable = nil
        window = nil
    }
}

// MARK: - Root

private enum SettingsTab: String, CaseIterable, Identifiable {
    case diagnostics, about, advanced, appearance

    var id: String { rawValue }

    var label: String {
        switch self {
        case .diagnostics: return "Diagnostics"
        case .about:       return "About"
        case .advanced:    return "Advanced"
        case .appearance:  return "Appearance"
        }
    }

    var symbol: String {
        switch self {
        case .diagnostics: return "stethoscope"
        case .about:       return "info.circle"
        case .advanced:    return "slider.horizontal.3"
        case .appearance:  return "paintbrush"
        }
    }
}

private struct SettingsRootView: View {
    @ObservedObject var controller: OpenScoutAppController
    @ObservedObject private var theme = ThemeManager.shared
    @State private var selected: SettingsTab = .diagnostics

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
                            case .diagnostics: DiagnosticsTab(controller: controller)
                            case .about:       AboutTab(controller: controller)
                            case .advanced:    AdvancedTab()
                            case .appearance:  AppearanceTab(theme: theme)
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                }
            }
        }
        .preferredColorScheme(theme.colorScheme)
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
                detail: controller.broker.statusDetail,
                rows: [
                    KVEntry(key: "URL", value: controller.broker.brokerURL),
                    KVEntry(
                        key: "Launch agent",
                        value: controller.broker.launchAgentPath.isEmpty ? "Not installed" : controller.broker.launchAgentPath,
                        path: controller.broker.launchAgentPath.isEmpty ? nil : controller.broker.launchAgentPath
                    ),
                    KVEntry(key: "PID", value: controller.broker.pid.map(String.init) ?? "—"),
                ],
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
        if controller.broker.reachable { return .healthy }
        if controller.broker.loaded { return .warn }
        if controller.broker.installed { return .warn }
        return .fail
    }

    private func brokerSummary() -> String {
        if controller.brokerActionPending { return "Working" }
        if controller.broker.reachable { return "Online" }
        if controller.broker.loaded { return "Loaded, no answer" }
        if controller.broker.installed { return "Dormant" }
        return "Not installed"
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
            return "Web surface is responding on http://127.0.0.1:3200."
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

// MARK: - Advanced

private struct AdvancedTab: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(ShellPalette.muted)

            Text("MORE CONTROLS COMING")
                .font(MenuType.mono(11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ShellPalette.dim)

            Text("Advanced options will land here once they're ready. You haven't broken anything.")
                .font(MenuType.body(11))
                .foregroundStyle(ShellPalette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .padding(36)
        .frame(maxWidth: .infinity)
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

// MARK: - Appearance

private struct AppearanceTab: View {
    @ObservedObject var theme: ThemeManager

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Text("THEME")
                    .font(MenuType.mono(10, weight: .bold))
                    .tracking(1.4)
                    .foregroundStyle(ShellPalette.dim)

                Text("Affects the menu bar popover and this settings window. Auto follows the system appearance.")
                    .font(MenuType.body(12))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    ForEach(ThemeManager.Mode.allCases) { mode in
                        ThemeChip(
                            mode: mode,
                            isSelected: theme.mode == mode
                        ) {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                theme.mode = mode
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 6) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(ShellPalette.muted)
                    Text("Saved automatically. Persists across launches.")
                        .font(MenuType.mono(10))
                        .foregroundStyle(ShellPalette.muted)
                }
                .padding(.top, 2)
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

            ThemePreviewCard()
        }
    }
}

private struct ThemeChip: View {
    let mode: ThemeManager.Mode
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: mode.symbol)
                    .font(.system(size: 11, weight: .semibold))
                Text(mode.label.uppercased())
                    .font(MenuType.mono(10, weight: .semibold))
                    .tracking(0.9)
            }
            .foregroundStyle(isSelected ? ShellPalette.accent : ShellPalette.copy)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(isSelected ? ShellPalette.accentSoft : ShellPalette.surfaceFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(isSelected ? ShellPalette.accentBorder : ShellPalette.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct ThemePreviewCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PREVIEW")
                .font(MenuType.mono(10, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(ShellPalette.dim)

            HStack(spacing: 10) {
                swatch(label: "BG",    color: ShellPalette.shellBackground, border: ShellPalette.line)
                swatch(label: "CARD",  color: ShellPalette.card,            border: ShellPalette.line)
                swatch(label: "OK",    color: ShellPalette.success,         border: .clear)
                swatch(label: "WARN",  color: ShellPalette.warning,         border: .clear)
                swatch(label: "FAIL",  color: ShellPalette.error,           border: .clear)
                swatch(label: "ACCNT", color: ShellPalette.violet,          border: .clear)
                Spacer(minLength: 0)
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

    private func swatch(label: String, color: Color, border: Color) -> some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(color)
                .frame(width: 56, height: 36)
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .stroke(border == .clear ? Color.clear : border, lineWidth: 1)
                )
            Text(label)
                .font(MenuType.mono(8, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ShellPalette.muted)
        }
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
