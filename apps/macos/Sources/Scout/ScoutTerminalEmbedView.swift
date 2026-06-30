import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

#if HUDSON_TERMINAL
import HudsonTerminal
import Termini
#endif

private enum ScoutTerminalMetrics {
    static let pageGutter: CGFloat = 20
    static let tileMinWidth: CGFloat = 360
    static let tileMinHeight: CGFloat = 240
}

/// Terminal surface for the native Scout app.
///
/// When HudsonTerminal is enabled this hosts Termini/Ghostty-backed local PTYs.
/// The WKWebView terminal cockpit stays available as a fallback and for web
/// relay controls that have not moved to a native surface yet.
struct ScoutTerminalContent: View {
    var body: some View {
        #if HUDSON_TERMINAL
        ScoutNativeTerminalContent()
        #else
        ScoutTerminalWebContent()
        #endif
    }
}

#if HUDSON_TERMINAL
private struct ScoutNativeTerminalContent: View {
    @StateObject private var model = ScoutNativeTerminalGridModel()

    var body: some View {
        VStack(spacing: 0) {
            header
            terminalBody
        }
        .background(ScoutDesign.bg)
        .task {
            await model.loadIfNeeded()
        }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTerminalMetrics.pageGutter) {
            Text("Terminals")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text(subtitle)
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(model.errorMessage == nil ? ScoutPalette.dim : ScoutPalette.statusWarn)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutTerminalHeaderButton(title: "New shell", icon: "plus") {
                    model.addLocalShell()
                }
                ScoutTerminalHeaderButton(title: model.isLoading ? "Loading" : "Refresh", icon: "arrow.clockwise") {
                    Task { await model.reload() }
                }
                ScoutTerminalHeaderButton(title: "Open web", icon: "safari") {
                    ScoutWeb.open(path: "/terminal")
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var subtitle: String {
        if let error = model.errorMessage {
            return error
        }
        let count = model.tiles.count
        return "\(count) native PTY tile\(count == 1 ? "" : "s") · Hudson Ghostty"
    }

    private var terminalBody: some View {
        ZStack(alignment: .topTrailing) {
            if model.tiles.isEmpty {
                ScoutNativeTerminalEmptyView(
                    isLoading: model.isLoading,
                    onNewShell: model.addLocalShell,
                    onRefresh: { Task { await model.reload() } }
                )
            } else {
                HudTiling(
                    items: model.tiles,
                    constraints: TilingConstraints(
                        gap: HudSpacing.md,
                        minItemWidth: ScoutTerminalMetrics.tileMinWidth,
                        minItemHeight: ScoutTerminalMetrics.tileMinHeight,
                        fillStrategy: .maximize,
                        alignLastRow: .stretch,
                        preferMoreColumns: true
                    )
                ) { tile in
                    ScoutNativeTerminalTileView(
                        tile: tile,
                        onRestart: { model.restart(tile) },
                        onClose: { model.close(tile) }
                    )
                }
                .padding(ScoutTerminalMetrics.pageGutter)
            }

            if model.isLoading, !model.tiles.isEmpty {
                HStack(spacing: HudSpacing.sm) {
                    ScoutBrailleSpinner(size: HudTextSize.xs, tint: ScoutPalette.accent)
                    Text("SYNC")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(ScoutPalette.dim)
                }
                .padding(.horizontal, HudSpacing.md)
                .frame(height: 26)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutSurface.inset)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
                .padding(ScoutTerminalMetrics.pageGutter)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

@MainActor
private final class ScoutNativeTerminalGridModel: ObservableObject {
    @Published private(set) var tiles: [ScoutNativeTerminalTile] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private var didLoad = false
    private var localShellCounter = 0

    func loadIfNeeded() async {
        guard !didLoad else { return }
        didLoad = true
        await reload()
    }

    func reload() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let url = ScoutWeb.url(path: "/api/terminal-sessions?includeDiscovered=1")
                ?? ScoutWeb.baseURL().appending(path: "api/terminal-sessions")
            let payload = try await ScoutHTTP.fetch(
                ScoutTerminalSessionsPayload.self,
                from: url
            )
            let targets = payload.sessions.flatMap(\.nativeTargets)
            merge(targets)
            errorMessage = nil
            if tiles.isEmpty {
                addLocalShell()
            }
        } catch {
            errorMessage = ScoutAppError.userFacing(
                error,
                connectionMessage: "Could not reach Scout terminal sessions."
            )
            if tiles.isEmpty {
                addLocalShell()
            }
        }
    }

    func addLocalShell() {
        localShellCounter += 1
        let target = ScoutNativeTerminalTarget.localShell(index: localShellCounter)
        tiles.append(ScoutNativeTerminalTile(target: target))
    }

    func restart(_ tile: ScoutNativeTerminalTile) {
        tile.restart()
    }

    func close(_ tile: ScoutNativeTerminalTile) {
        tile.stop()
        tiles.removeAll { $0.id == tile.id }
    }

    private func merge(_ targets: [ScoutNativeTerminalTarget]) {
        guard !targets.isEmpty else { return }

        var existing = Dictionary(uniqueKeysWithValues: tiles.map { ($0.id, $0) })
        var next: [ScoutNativeTerminalTile] = []
        next.reserveCapacity(targets.count + tiles.count)

        for target in targets {
            if let tile = existing.removeValue(forKey: target.id) {
                tile.update(target)
                next.append(tile)
            } else {
                next.append(ScoutNativeTerminalTile(target: target))
            }
        }

        let targetIDs = Set(targets.map(\.id))
        let localShells = tiles.filter { !targetIDs.contains($0.id) && !$0.target.isRegistryBacked }
        next.append(contentsOf: localShells)
        tiles = next
    }
}

@MainActor
private final class ScoutNativeTerminalTile: ObservableObject, Identifiable, @unchecked Sendable {
    let id: String
    let workspace: TerminiLocalPTYWorkspace

    @Published private(set) var target: ScoutNativeTerminalTarget
    @Published private(set) var statusMessage: String = "Ready"
    @Published private(set) var isRunning = false
    @Published private(set) var hasStarted = false

    private var statusTask: Task<Void, Never>?

    init(target: ScoutNativeTerminalTarget) {
        self.id = target.id
        self.target = target
        self.workspace = TerminiLocalPTYWorkspace(processSpec: target.processSpec)
        self.statusMessage = workspace.statusMessage
    }

    deinit {
        statusTask?.cancel()
    }

    func update(_ next: ScoutNativeTerminalTarget) {
        target = next
        if !hasStarted {
            workspace.processSpec = next.processSpec ?? workspace.processSpec
        }
    }

    func startIfNeeded() {
        guard !hasStarted else { return }
        workspace.processSpec = target.processSpec ?? workspace.processSpec
        workspace.start()
        hasStarted = true
        refreshStatus()
        startStatusPolling()
    }

    func restart() {
        workspace.processSpec = target.processSpec ?? workspace.processSpec
        workspace.start()
        hasStarted = true
        refreshStatus()
        startStatusPolling()
    }

    func stop() {
        statusTask?.cancel()
        statusTask = nil
        workspace.stop()
        refreshStatus()
    }

    func focus() {
        workspace.controller.focus()
    }

    private func startStatusPolling() {
        statusTask?.cancel()
        statusTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                self?.refreshStatus()
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    private func refreshStatus() {
        statusMessage = workspace.statusMessage
        isRunning = workspace.isRunning
    }
}

private struct ScoutNativeTerminalTileView: View {
    @ObservedObject var tile: ScoutNativeTerminalTile
    let onRestart: () -> Void
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            HudTerminalSurface(
                controller: tile.workspace.controller,
                showsSystemKeyboard: true,
                appearance: HudTerminalAppearance(fontSize: 12),
                onTap: tile.focus
            )
        }
        .background(terminalBackground)
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .onAppear {
            tile.startIfNeeded()
        }
    }

    private var titleBar: some View {
        HStack(spacing: HudSpacing.md) {
            HudStatusDot(
                color: tile.isRunning ? ScoutPalette.statusOk : ScoutPalette.statusWarn,
                size: 6,
                pulses: tile.isRunning
            )

            VStack(alignment: .leading, spacing: 1) {
                Text(tile.target.title)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Text(tile.statusMessage)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.sm)

            ScoutTerminalBackendBadge(tile.target.backendLabel)

            ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Restart terminal", action: onRestart)
            ScoutTerminalIconButton(systemName: "xmark", help: "Close terminal", action: onClose)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .padding(.horizontal, HudSpacing.md)
        .background(ScoutSurface.control)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(height: HudStrokeWidth.thin)
        }
        .help(tile.target.subtitle)
    }

    private var terminalBackground: Color {
        colorScheme == .dark ? Color.black.opacity(0.24) : ScoutSurface.inset
    }
}

private struct ScoutNativeTerminalEmptyView: View {
    let isLoading: Bool
    let onNewShell: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.accent)

            VStack(spacing: HudSpacing.xs) {
                Text(isLoading ? "Finding terminals" : "No terminal tiles")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Local shells · Scout sessions")
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            }

            HStack(spacing: HudSpacing.sm) {
                ScoutTerminalHeaderButton(title: "New shell", icon: "plus", action: onNewShell)
                ScoutTerminalHeaderButton(title: "Refresh", icon: "arrow.clockwise", action: onRefresh)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ScoutTerminalBackendBadge: View {
    let label: String

    init(_ label: String) {
        self.label = label
    }

    var body: some View {
        Text(label.uppercased())
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .tracking(0.6)
            .foregroundStyle(ScoutPalette.dim)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 20)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
    }
}

private struct ScoutTerminalIconButton: View {
    let systemName: String
    let help: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
                .frame(width: 22, height: 22)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(hovering ? ScoutSurface.hover : Color.clear)
                )
                .contentShape(RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous))
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

private struct ScoutTerminalSessionsPayload: Decodable {
    var sessions: [ScoutTerminalSessionRecord]
}

private struct ScoutTerminalSessionRecord: Decodable, Sendable {
    var id: String
    var harness: String
    var sourceSessionId: String
    var cwd: String
    var resumeCommand: String
    var surfaces: [ScoutTerminalSurfaceRecord]

    var nativeTargets: [ScoutNativeTerminalTarget] {
        surfaces
            .filter { !$0.attachCommand.isEmpty }
            .map { surface in
                ScoutNativeTerminalTarget(session: self, surface: surface)
            }
    }
}

private struct ScoutTerminalSurfaceRecord: Decodable, Hashable, Sendable {
    var backend: String
    var sessionName: String
    var paneId: String?
    var attachCommand: [String]
    var observeCommand: [String]?
    var state: String?
    var socketDir: String?
}

private struct ScoutNativeTerminalTarget: Hashable, Sendable {
    var id: String
    var title: String
    var subtitle: String
    var backendLabel: String
    var commandLabel: String
    var attachCommand: [String]
    var workingDirectoryPath: String
    var isRegistryBacked: Bool

    init(session: ScoutTerminalSessionRecord, surface: ScoutTerminalSurfaceRecord) {
        id = "\(session.id)::\(surface.backend)::\(surface.sessionName)"
        title = Self.title(session: session, surface: surface)
        commandLabel = Self.commandLabel(surface.attachCommand)
        subtitle = [
            surface.state?.uppercased(),
            surface.backend,
            surface.sessionName,
            Self.shortPath(session.cwd),
            commandLabel,
        ]
        .compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
        .joined(separator: " · ")
        backendLabel = surface.backend
        attachCommand = surface.attachCommand
        workingDirectoryPath = session.cwd
        isRegistryBacked = true
    }

    private init(
        id: String,
        title: String,
        subtitle: String,
        backendLabel: String,
        commandLabel: String,
        attachCommand: [String],
        workingDirectoryPath: String,
        isRegistryBacked: Bool
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.backendLabel = backendLabel
        self.commandLabel = commandLabel
        self.attachCommand = attachCommand
        self.workingDirectoryPath = workingDirectoryPath
        self.isRegistryBacked = isRegistryBacked
    }

    static func localShell(index: Int) -> ScoutNativeTerminalTarget {
        let shellPath = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        let home = ProcessInfo.processInfo.environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
        return ScoutNativeTerminalTarget(
            id: "local-shell-\(UUID().uuidString)",
            title: index == 1 ? "Local shell" : "Local shell \(index)",
            subtitle: "\(shellPath) · \(Self.shortPath(home))",
            backendLabel: "pty",
            commandLabel: shellPath,
            attachCommand: [shellPath, "-l"],
            workingDirectoryPath: home,
            isRegistryBacked: false
        )
    }

    var processSpec: TerminiProcessSpec? {
        guard !attachCommand.isEmpty else { return nil }

        let executable = attachCommand[0]
        let executableURL: URL
        let arguments: [String]
        if executable.hasPrefix("/") {
            executableURL = URL(fileURLWithPath: executable)
            arguments = Array(attachCommand.dropFirst())
        } else if executable == "env" {
            executableURL = URL(fileURLWithPath: "/usr/bin/env")
            arguments = Array(attachCommand.dropFirst())
        } else {
            executableURL = URL(fileURLWithPath: "/usr/bin/env")
            arguments = attachCommand
        }

        return TerminiProcessSpec(
            executableURL: executableURL,
            arguments: arguments,
            environment: [
                "TERM": "xterm-256color",
                "OPENSCOUT_NATIVE_TERMINAL": "1",
            ],
            workingDirectoryURL: workingDirectoryURL
        )
    }

    private var workingDirectoryURL: URL {
        let path = workingDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !path.isEmpty, FileManager.default.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        let home = ProcessInfo.processInfo.environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home)
    }

    private static func title(
        session: ScoutTerminalSessionRecord,
        surface: ScoutTerminalSurfaceRecord
    ) -> String {
        let backend = surface.backend.uppercased()
        let harness = session.harness.trimmingCharacters(in: .whitespacesAndNewlines)
        if harness.isEmpty || harness.caseInsensitiveCompare(surface.backend) == .orderedSame {
            return "\(backend) \(surface.sessionName)"
        }
        return "\(harness) · \(surface.sessionName)"
    }

    private static func commandLabel(_ command: [String]) -> String {
        command.map(shellDisplayToken).joined(separator: " ")
    }

    private static func shellDisplayToken(_ value: String) -> String {
        if value.isEmpty {
            return "''"
        }
        if value.range(of: #"[^A-Za-z0-9_@%+=:,./-]"#, options: .regularExpression) == nil {
            return value
        }
        return "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
    }

    private static func shortPath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let home = ProcessInfo.processInfo.environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
        if trimmed == home {
            return "~"
        }
        if trimmed.hasPrefix(home + "/") {
            return "~/" + trimmed.dropFirst(home.count + 1)
        }
        return URL(fileURLWithPath: trimmed).lastPathComponent
    }
}
#endif

private struct ScoutTerminalWebContent: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var reloadToken = UUID()

    private var url: URL {
        scoutTerminalEmbedURL(colorScheme: colorScheme, cacheBuster: reloadToken.uuidString)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutTerminalEmbedHost(url: url, reloadToken: reloadToken) {
                reloadToken = UUID()
            }
        }
        .background(ScoutDesign.bg)
        .onChange(of: colorScheme) { _, _ in reloadToken = UUID() }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTerminalMetrics.pageGutter) {
            Text("Terminals")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text("live sessions · web terminal cockpit")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutTerminalHeaderButton(title: "Reload", icon: "arrow.clockwise") {
                    reloadToken = UUID()
                }
                ScoutTerminalHeaderButton(title: "Open in browser", icon: "safari") {
                    ScoutWeb.open(path: "/terminal")
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

func scoutTerminalEmbedURL(
    colorScheme: ColorScheme,
    routePath: String = "/terminal",
    cacheBuster: String? = nil
) -> URL {
    let base = ScoutWeb.url(path: "/embed/terminal")
        ?? ScoutWeb.baseURL().appending(path: "embed/terminal")
    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
        return base
    }

    var items = components.queryItems ?? []
    items.removeAll { ["route", "profile", "_cb"].contains($0.name) }
    items.append(URLQueryItem(name: "route", value: routePath))
    items.append(URLQueryItem(name: "profile", value: "macos.terminal"))
    for item in ScoutEmbedTheme.queryItems(for: colorScheme) where !items.contains(where: { $0.name == item.name }) {
        items.append(item)
    }
    if let cacheBuster, !cacheBuster.isEmpty {
        items.append(URLQueryItem(name: "_cb", value: cacheBuster))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum ScoutTerminalEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

private struct ScoutTerminalEmbedHost: View {
    let url: URL
    let reloadToken: UUID
    let onRetry: () -> Void

    @State private var phase: ScoutTerminalEmbedLoadPhase = .loading

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutTerminalEmbedWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    ScoutTerminalMaterializingView()
                        .transition(.opacity)
                case .failed(let message):
                    errorState(message)
                case .ready:
                    EmptyView()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
        .animation(.easeOut(duration: 0.24), value: isReady)
        .onChange(of: url) { _, _ in phase = .loading }
        .onChange(of: reloadToken) { _, _ in phase = .loading }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
            Text("Terminal cockpit unavailable")
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            Text(message)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Text(url.absoluteString)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 420)
            ScoutTerminalHeaderButton(title: "Retry", icon: "arrow.clockwise", action: onRetry)
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if os(macOS)
private struct ScoutTerminalEmbedWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTerminalEmbedLoadPhase

    func makeCoordinator() -> Coordinator {
        Coordinator(phase: $phase)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        context.coordinator.readyURL = nil
        context.coordinator.navigationStartedAt = Date()
        context.coordinator.navigationToken = UUID()
        phase = .loading
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringCacheData, timeoutInterval: 30))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var phase: ScoutTerminalEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        private let minimumLoaderDwell: TimeInterval = 0.32
        private let maximumRenderWait: TimeInterval = 5.0
        private let renderPollInterval: TimeInterval = 0.06

        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()
        var readyURL: URL?

        init(phase: Binding<ScoutTerminalEmbedLoadPhase>) {
            _phase = phase
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForTerminalRender(in: webView, url: currentURL, token: navigationToken)
        }

        private func waitForTerminalRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            let script = """
            (() => {
              const term = Boolean(document.querySelector('.s-term'));
              const home = Boolean(document.querySelector('.s-term-home'));
              const bar = Boolean(document.querySelector('.s-term-bar'));
              const xterm = Boolean(document.querySelector('.xterm'));
              const bodyText = document.body?.innerText || '';
              return {
                ready: term && (home || bar || xterm || bodyText.includes('Terminal Control')),
                hasText: bodyText.trim().length > 8 || xterm
              };
            })()
            """

            webView.evaluateJavaScript(script) { result, _ in
                DispatchQueue.main.async {
                    guard token == self.navigationToken, self.readyURL != url else { return }
                    let elapsed = Date().timeIntervalSince(self.navigationStartedAt)
                    let payload = result as? [String: Any]
                    let rendered = payload?["ready"] as? Bool ?? false
                    let hasText = payload?["hasText"] as? Bool ?? false
                    let canReveal = rendered && hasText && elapsed >= self.minimumLoaderDwell
                    if canReveal || elapsed >= self.maximumRenderWait {
                        self.markReady(url)
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + self.renderPollInterval) {
                        self.waitForTerminalRender(in: webView, url: url, token: token)
                    }
                }
            }
        }

        private func markReady(_ url: URL) {
            guard readyURL != url else { return }
            readyURL = url
            setPhase(.ready)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        private func setPhase(_ next: ScoutTerminalEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func message(for error: Error) -> String {
            ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app.")
        }
    }
}
#else
private struct ScoutTerminalEmbedWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTerminalEmbedLoadPhase

    var body: some View {
        EmptyView()
    }
}
#endif

private struct ScoutTerminalMaterializingView: View {
    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.accent)
            VStack(spacing: HudSpacing.xs) {
                Text("Opening terminal control")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Syncing live sessions and agent terminal targets")
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
    }
}

private struct ScoutTerminalHeaderButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                Text(title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.45)
                    .lineLimit(1)
            }
            .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(hovering ? ScoutSurface.hover : ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(title)
    }
}
