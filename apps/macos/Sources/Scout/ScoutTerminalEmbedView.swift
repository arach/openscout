import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import UniformTypeIdentifiers
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

private enum ScoutTerminalDragPayload {
    static let acceptedTypes: [UTType] = [.plainText]

    static func itemProvider(id: String) -> NSItemProvider {
        NSItemProvider(object: id as NSString)
    }

    static func loadIDs(
        from providers: [NSItemProvider],
        onID: @escaping @MainActor @Sendable (String) -> Void
    ) -> Bool {
        let typeIdentifier = UTType.plainText.identifier
        let candidates = providers.filter { $0.hasItemConformingToTypeIdentifier(typeIdentifier) }
        guard !candidates.isEmpty else { return false }

        for provider in candidates {
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                guard let id = string(from: item)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !id.isEmpty else {
                    return
                }
                Task { @MainActor in
                    onID(id)
                }
            }
        }

        return true
    }

    private static func string(from item: NSSecureCoding?) -> String? {
        if let value = item as? String {
            return value
        }
        if let value = item as? NSString {
            return value as String
        }
        if let data = item as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
}

private enum ScoutTerminalRenderer: String, CaseIterable, Hashable {
    case native
    case xterm

    var title: String {
        switch self {
        case .native: return "Native"
        case .xterm: return "xterm"
        }
    }

    var detail: String {
        switch self {
        case .native: return "Hudson Ghostty renderer"
        case .xterm: return "xterm in WKWebView"
        }
    }

    var icon: String {
        switch self {
        case .native: return "rectangle.connected.to.line.below"
        case .xterm: return "globe"
        }
    }
}

/// Terminal surface for the native Scout app.
///
/// When HudsonTerminal is enabled this hosts Termini/Ghostty-backed local PTYs.
/// The WKWebView terminal cockpit stays available as a fallback and for web
/// relay controls that have not moved to a native surface yet.
struct ScoutTerminalContent: View {
    #if HUDSON_TERMINAL
    @AppStorage("scout.terminals.renderer") private var rendererRaw = ScoutTerminalRenderer.xterm.rawValue

    private var renderer: ScoutTerminalRenderer {
        ScoutTerminalRenderer(rawValue: rendererRaw) ?? .xterm
    }

    private var rendererBinding: Binding<ScoutTerminalRenderer> {
        Binding {
            renderer
        } set: { next in
            rendererRaw = next.rawValue
        }
    }
    #endif

    @ViewBuilder
    var body: some View {
        #if HUDSON_TERMINAL
        switch renderer {
        case .native:
            ScoutNativeTerminalContent(renderer: rendererBinding)
        case .xterm:
            ScoutTerminalWebContent(renderer: rendererBinding)
        }
        #else
        ScoutTerminalWebContent()
        #endif
    }
}

#if HUDSON_TERMINAL
private struct ScoutNativeTerminalContent: View {
    @Binding var renderer: ScoutTerminalRenderer
    @StateObject private var model = ScoutNativeTerminalGridModel()
    @AppStorage("scout.terminals.native.showHeaders") private var showHeaders = true
    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            header
            terminalBody
        }
        .background(ScoutDesign.bg)
        .task {
            await model.loadIfNeeded()
        }
        .onChange(of: renderer) { _, next in
            if next != .native {
                model.stopAll()
            }
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
                ScoutTerminalRendererToggle(selection: $renderer)
                ScoutTerminalHeaderButton(title: "New shell", icon: "plus", disabled: model.isAddingShell) {
                    model.addLocalShell(mode: "shell")
                }
                nativeOptionsMenu
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var nativeOptionsMenu: some View {
        Menu {
            Button(model.isLoading ? "Refreshing..." : "Refresh sessions") {
                Task { await model.reload() }
            }
            Button("Open xterm in browser") {
                ScoutWeb.open(path: "/terminal")
            }
            Divider()
            Button(showHeaders ? "Use compact tiles" : "Show tile headers") {
                showHeaders.toggle()
            }
        } label: {
            ScoutTerminalMenuLabel(title: "More", icon: "ellipsis")
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: true, vertical: false)
        .help("Terminal options")
    }

    private var subtitle: String {
        if let error = model.errorMessage {
            return error
        }
        let count = model.tiles.count
        let attachable = model.attachableTargets.count
        return "\(count) native tile\(count == 1 ? "" : "s") · \(attachable) attachable · Hudson Ghostty"
    }

    private var terminalBody: some View {
        ZStack(alignment: .topTrailing) {
            if model.tiles.isEmpty {
                VStack(spacing: HudSpacing.xl) {
                    ScoutTerminalDropLandingView(
                        isTargeted: dropTargeted,
                        title: model.isLoading ? "Finding Terminals" : "Drop Session",
                        subtitle: "\(model.attachableTargets.count) attachable · native tiles"
                    ) {
                        HStack(spacing: HudSpacing.sm) {
                            ScoutTerminalHeaderButton(title: "New shell", icon: "plus", disabled: model.isAddingShell) {
                                model.addLocalShell(mode: "shell")
                            }
                            ScoutTerminalHeaderButton(title: model.isLoading ? "Loading" : "Refresh", icon: "arrow.clockwise") {
                                Task { await model.reload() }
                            }
                        }
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    .onDrop(
                        of: ScoutTerminalDragPayload.acceptedTypes,
                        isTargeted: $dropTargeted,
                        perform: attachDraggedTargets
                    )
                    nativeAttachGrid
                        .padding(.bottom, HudSpacing.xl)
                }
            } else {
                nativeTerminalWorkspace
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

    private var nativeTerminalWorkspace: some View {
        GeometryReader { geo in
            let count = max(model.tiles.count, 1)
            let gap = showHeaders ? HudSpacing.md : HudSpacing.sm
            let width = max(ScoutTerminalMetrics.tileMinWidth, geo.size.width - ScoutTerminalMetrics.pageGutter * 2)
            let columns = simpleGridColumns(for: width, count: count, gap: gap)
            let rows = max(1, (count + columns - 1) / columns)
            let availableHeight = max(260, geo.size.height - gap * 2 - CGFloat(rows - 1) * gap)
            let tileHeight = max(showHeaders ? 260 : 220, availableHeight / CGFloat(rows))
            let gridItems = Array(
                repeating: GridItem(.flexible(minimum: ScoutTerminalMetrics.tileMinWidth), spacing: gap),
                count: columns
            )

            ScrollView {
                VStack(spacing: gap) {
                    LazyVGrid(columns: gridItems, spacing: gap) {
                        ForEach(model.tiles) { tile in
                            ScoutNativeTerminalTileView(
                                tile: tile,
                                showHeader: showHeaders,
                                onRestart: { model.restart(tile) },
                                onClose: { model.close(tile) }
                            )
                            .frame(height: tileHeight)
                        }
                    }
                    .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
                    .padding(.top, gap)
                    .onDrop(
                        of: ScoutTerminalDragPayload.acceptedTypes,
                        isTargeted: $dropTargeted,
                        perform: attachDraggedTargets
                    )
                    .overlay {
                        if dropTargeted {
                            ScoutTerminalDropRegionOverlay(
                                title: "Drop to attach",
                                subtitle: "Adds a native terminal tile"
                            )
                                .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
                                .padding(.top, gap)
                                .allowsHitTesting(false)
                        }
                    }

                    nativeAttachGrid
                }
                .padding(.bottom, gap)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    @ViewBuilder
    private var nativeAttachGrid: some View {
        let targets = model.attachableTargets
        if !targets.isEmpty || model.isLoading {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.sm) {
                    Text("Attachable Sessions")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(ScoutPalette.dim)
                    Spacer(minLength: 0)
                    Text(model.isLoading ? "SYNCING" : "\(targets.count)")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(ScoutPalette.dim)
                }

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 220), spacing: HudSpacing.sm)],
                    alignment: .leading,
                    spacing: HudSpacing.sm
                ) {
                    ForEach(targets) { target in
                        ScoutNativeAttachTargetCard(target: target) {
                            model.attach(target)
                        }
                    }
                }
            }
            .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
        }
    }

    private func simpleGridColumns(for width: CGFloat, count: Int, gap: CGFloat) -> Int {
        guard count > 1 else { return 1 }
        let targetWidth: CGFloat = 560
        let possible = max(1, Int((width + gap) / (targetWidth + gap)))
        return min(count, min(3, possible))
    }

    private func attachDraggedTargets(_ providers: [NSItemProvider]) -> Bool {
        ScoutTerminalDragPayload.loadIDs(from: providers) { id in
            Task { @MainActor in
                if model.attachTarget(id: id) {
                    dropTargeted = false
                }
            }
        }
    }
}

@MainActor
private final class ScoutNativeTerminalGridModel: ObservableObject {
    @Published private(set) var tiles: [ScoutNativeTerminalTile] = []
    @Published private(set) var attachTargets: [ScoutNativeTerminalTarget] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private var didLoad = false
    private var localShellCounter = 0
    private var lastAddTime = Date.distantPast
    @Published private(set) var isAddingShell = false

    var attachableTargets: [ScoutNativeTerminalTarget] {
        let tiledIDs = Set(tiles.map(\.id))
        return attachTargets.filter { !tiledIDs.contains($0.id) }
    }

    func loadIfNeeded() async {
        guard !didLoad else { return }
        didLoad = true
        await reload()
        if tiles.isEmpty {
            addLocalShell(mode: "shell")  // first one on load is always a plain shell
        }
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
            attachTargets = targets
            errorMessage = nil
            // No auto-add here; only on initial loadIfNeeded if still empty.
            // "New native" and visible attach cards are the user actions for adding tiles.
        } catch {
            errorMessage = ScoutAppError.userFacing(
                error,
                connectionMessage: "Could not reach Scout terminal sessions."
            )
        }
    }

    func addLocalShell(mode: String = "shell") {
        let now = Date()
        guard now.timeIntervalSince(lastAddTime) > 0.15 else { return } // debounce rapid clicks / double fires
        guard !isAddingShell else { return }
        lastAddTime = now
        isAddingShell = true

        localShellCounter += 1
        let target = ScoutNativeTerminalTarget.localShell(index: localShellCounter, mode: mode)
        attach(target)

        // Rate limit creation of new PTY workspaces to avoid crashes on high-speed adds
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            isAddingShell = false
        }
    }

    @discardableResult
    func attachTarget(id: String) -> Bool {
        guard let target = attachTargets.first(where: { $0.id == id }) else { return false }
        attach(target)
        return true
    }

    func attach(_ target: ScoutNativeTerminalTarget) {
        if let current = tiles.first(where: { $0.id == target.id }) {
            current.update(target)
            return
        }
        tiles.append(ScoutNativeTerminalTile(target: target))
    }

    fileprivate func restart(_ tile: ScoutNativeTerminalTile) {
        tile.restart()
    }

    fileprivate func close(_ tile: ScoutNativeTerminalTile) {
        tile.stop()
        tiles.removeAll { $0.id == tile.id }
    }

    fileprivate func stopAll() {
        for tile in tiles {
            tile.stop()
        }
    }

    private func merge(_ targets: [ScoutNativeTerminalTarget]) {
        var targetsByID: [String: ScoutNativeTerminalTarget] = [:]
        for target in targets {
            targetsByID[target.id] = target
        }
        var next: [ScoutNativeTerminalTile] = []

        for tile in tiles {
            if let target = targetsByID[tile.id] {
                tile.update(target)
                next.append(tile)
            } else if tile.target.isRegistryBacked {
                tile.stop()
            } else {
                next.append(tile)
            }
        }

        if next.count != tiles.count || zip(next, tiles).contains(where: { $0.0.id != $0.1.id }) {
            tiles = next
        }
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
    let showHeader: Bool
    let onRestart: () -> Void
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovering = false

    var body: some View {
        VStack(spacing: 0) {
            if showHeader {
                titleBar
            }
            HudTerminalSurface(
                controller: tile.workspace.controller,
                showsSystemKeyboard: true,
                appearance: HudTerminalAppearance(fontSize: 12),
                onTap: tile.focus
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(showHeader ? terminalBackground : Color.clear)
        .clipShape(RoundedRectangle(
            cornerRadius: showHeader ? HudRadius.card : 0,
            style: .continuous
        ))
        .overlay(
            RoundedRectangle(
                cornerRadius: showHeader ? HudRadius.card : 0,
                style: .continuous
            )
            .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .overlay(alignment: .topTrailing) {
            if !showHeader && isHovering {
                HStack(spacing: 2) {
                    ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Restart terminal", action: onRestart)
                    ScoutTerminalIconButton(systemName: "xmark", help: "Close terminal", action: onClose)
                }
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(ScoutSurface.control.opacity(0.9))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )
            }
        }
        .onHover { hovering in
            isHovering = hovering
        }
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

            ScoutTerminalBackendBadge("native")
            ScoutTerminalBackendBadge(tile.target.backendLabel)

            ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Restart terminal", action: onRestart)
            ScoutTerminalIconButton(systemName: "xmark", help: "Close terminal", action: onClose)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .padding(.horizontal, HudSpacing.xl)
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

private struct ScoutTerminalDropLandingView<Actions: View>: View {
    let isTargeted: Bool
    let title: String
    let subtitle: String
    let actions: () -> Actions

    init(
        isTargeted: Bool,
        title: String,
        subtitle: String,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        self.isTargeted = isTargeted
        self.title = title
        self.subtitle = subtitle
        self.actions = actions
    }

    var body: some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.accent)

            VStack(spacing: HudSpacing.xs) {
                Text(title)
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text(subtitle)
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            }

            actions()
        }
        .padding(.horizontal, HudSpacing.huge)
        .padding(.vertical, HudSpacing.xl)
        .frame(width: 340)
        .frame(minHeight: 154)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(isTargeted ? ScoutSurface.selected(ScoutPalette.accent) : ScoutSurface.inset.opacity(0.72))
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(
                    isTargeted ? ScoutPalette.accent.opacity(0.72) : ScoutDesign.hairlineStrong,
                    style: StrokeStyle(lineWidth: isTargeted ? 1.5 : HudStrokeWidth.thin, dash: isTargeted ? [] : [5, 4])
                )
        )
        .shadow(color: isTargeted ? ScoutPalette.accent.opacity(0.12) : Color.clear, radius: 12, x: 0, y: 4)
    }
}

private struct ScoutTerminalDropRegionOverlay: View {
    let title: String
    let subtitle: String

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutSurface.selected(ScoutPalette.accent).opacity(0.78))
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutPalette.accent.opacity(0.72), lineWidth: 1.5)

            VStack(spacing: HudSpacing.xs) {
                Image(systemName: "arrow.down.to.line.compact")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                Text(title)
                    .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                    .tracking(0.7)
                    .foregroundStyle(ScoutPalette.ink)
                Text(subtitle)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(ScoutPalette.dim)
            }
            .padding(HudSpacing.lg)
        }
    }
}

private struct ScoutNativeAttachTargetCard: View {
    let target: ScoutNativeTerminalTarget
    let onAttach: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: target.backendLabel == "zellij" ? "rectangle.3.group" : "terminal")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.title)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Text(target.subtitle)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.sm)

            ScoutTerminalBackendBadge(target.backendLabel)
            ScoutTerminalIconButton(systemName: "plus", help: "Attach terminal tile", action: onAttach)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 48)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(hovering ? ScoutSurface.hover : ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(hovering ? ScoutPalette.accent.opacity(0.35) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        .onTapGesture(count: 2, perform: onAttach)
        .onHover { hovering = $0 }
        .onDrag {
            ScoutTerminalDragPayload.itemProvider(id: target.id)
        }
        .help(target.subtitle)
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

private struct ScoutNativeTerminalTarget: Identifiable, Hashable, Sendable {
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

    static func localShell(index: Int, mode: String = "shell") -> ScoutNativeTerminalTarget {
        let shellPath = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        let home = ProcessInfo.processInfo.environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()

        let attachCommand: [String]
        let title: String
        let subtitle: String
        let backendLabel: String
        let commandLabel: String

        if mode == "tmux" {
            let session = "scout-local-\(index)"
            attachCommand = ["tmux", "new-session", "-A", "-s", session]
            title = index == 1 ? "tmux" : "tmux \(index)"
            subtitle = "\(session) · \(Self.shortPath(home))"
            backendLabel = "tmux"
            commandLabel = "tmux"
        } else {
            attachCommand = [shellPath, "-l"]
            title = index == 1 ? "Local shell" : "Local shell \(index)"
            subtitle = "\(shellPath) · \(Self.shortPath(home))"
            backendLabel = "pty"
            commandLabel = shellPath
        }

        return ScoutNativeTerminalTarget(
            id: "local-shell-\(UUID().uuidString)",
            title: title,
            subtitle: subtitle,
            backendLabel: backendLabel,
            commandLabel: commandLabel,
            attachCommand: attachCommand,
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
                "OPENSCOUT_NATIVE_TERMINAL": "1",   // allow shell rc files to detect Scout native tiles (e.g. skip auto-tmux)
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

    fileprivate static func shortPath(_ path: String) -> String {
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
    var renderer: Binding<ScoutTerminalRenderer>? = nil

    var body: some View {
        #if HUDSON_TERMINAL
        if let renderer {
            ScoutTerminalTabbedWebContent(renderer: renderer)
        } else {
            ScoutTerminalSingleWebContent()
        }
        #else
        ScoutTerminalSingleWebContent()
        #endif
    }
}

private struct ScoutTerminalSingleWebContent: View {
    var renderer: Binding<ScoutTerminalRenderer>? = nil

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
            Text("live sessions · xterm in WKWebView")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                if let renderer {
                    ScoutTerminalRendererToggle(selection: renderer)
                }
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

#if HUDSON_TERMINAL
private struct ScoutTerminalTabbedWebContent: View {
    @Binding var renderer: ScoutTerminalRenderer
    @StateObject private var model = ScoutTerminalWebTabsModel()
    @Environment(\.colorScheme) private var colorScheme
    @State private var dropTargeted = false
    @State private var showAttachPicker = false
    private let showTileHeaders = true

    var body: some View {
        VStack(spacing: 0) {
            header
            terminalBody
        }
        .background(ScoutDesign.bg)
        .task {
            await model.loadAttachTargets()
        }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTerminalMetrics.pageGutter) {
            Text("Terminals")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text(headerSubtitle)
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(model.errorMessage == nil ? ScoutPalette.dim : ScoutPalette.statusWarn)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutTerminalRendererToggle(selection: $renderer)
                newTabMenu
                if !model.tabs.isEmpty {
                    attachPickerButton
                }
                terminalOptionsMenu
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var headerSubtitle: String {
        if let error = model.errorMessage {
            return error
        }
        let count = model.tabs.count
        return "\(count) xterm tile\(count == 1 ? "" : "s") · WKWebView"
    }

    @ViewBuilder
    private var terminalBody: some View {
        ZStack(alignment: .top) {
            if model.tabs.isEmpty {
                emptyState
            } else {
                terminalGrid
            }

            if showAttachPicker, !model.tabs.isEmpty {
                attachPickerOverlay
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeOut(duration: 0.16), value: showAttachPicker)
    }

    private var emptyState: some View {
        VStack(spacing: HudSpacing.lg) {
            ScoutTerminalDropLandingView(
                isTargeted: dropTargeted,
                title: "Drop Session",
                subtitle: model.isLoadingTargets ? "syncing attachable sessions" : "\(model.attachableTargets.count) attachable · xterm tiles"
            ) {
                newTabMenu
            }
            .onDrop(
                of: ScoutTerminalDragPayload.acceptedTypes,
                isTargeted: $dropTargeted,
                perform: attachDraggedTargets
            )

            webAttachGrid
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var terminalGrid: some View {
        return GeometryReader { geo in
            let count = max(model.tabs.count, 1)
            let gap = showTileHeaders ? HudSpacing.md : HudSpacing.sm
            let width = max(ScoutTerminalMetrics.tileMinWidth, geo.size.width - ScoutTerminalMetrics.pageGutter * 2)
            let columns = simpleGridColumns(for: width, count: count, gap: gap)
            let rows = max(1, (count + columns - 1) / columns)
            let availableHeight = max(260, geo.size.height - gap * 2 - CGFloat(rows - 1) * gap)
            let tileHeight = max(showTileHeaders ? 260 : 220, availableHeight / CGFloat(rows))
            let gridItems = Array(
                repeating: GridItem(.flexible(minimum: ScoutTerminalMetrics.tileMinWidth), spacing: gap),
                count: columns
            )

            ScrollView {
                VStack(spacing: gap) {
                    LazyVGrid(columns: gridItems, spacing: gap) {
                        ForEach(model.tabs) { tab in
                            ScoutTerminalStableTile(
                                tab: tab,
                                colorScheme: colorScheme,
                                reloadToken: tab.reloadToken,
                                isSelected: model.selectedTabID == tab.id,
                                showHeader: showTileHeaders,
                                onSelect: { model.select(tab) },
                                onReload: { model.reload(tab) },
                                onClose: { model.close(tab) },
                                onOpen: { ScoutWeb.open(path: tab.routePath) }
                            )
                            .frame(height: tileHeight)
                        }
                    }
                    .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
                    .padding(.top, gap)
                    .onDrop(
                        of: ScoutTerminalDragPayload.acceptedTypes,
                        isTargeted: $dropTargeted,
                        perform: attachDraggedTargets
                    )
                    .overlay {
                        if dropTargeted {
                            ScoutTerminalDropRegionOverlay(
                                title: "Drop to attach",
                                subtitle: "Adds an xterm tile"
                            )
                                .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
                                .padding(.top, gap)
                                .allowsHitTesting(false)
                        }
                    }

                }
                .padding(.bottom, gap)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    private struct ScoutTerminalStableTile: View {
        let tab: ScoutTerminalWebTab
        let colorScheme: ColorScheme
        let reloadToken: UUID
        let isSelected: Bool
        let showHeader: Bool
        let onSelect: () -> Void
        let onReload: () -> Void
        let onClose: () -> Void
        let onOpen: () -> Void

        var body: some View {
            ScoutTerminalWebTileView(
                tab: tab,
                isSelected: isSelected,
                canClose: true,
                showHeader: showHeader,
                url: scoutTerminalEmbedURL(
                    colorScheme: colorScheme,
                    routePath: tab.routePath,
                    cacheBuster: reloadToken.uuidString
                ),
                onSelect: onSelect,
                onReload: onReload,
                onClose: onClose,
                onOpen: onOpen
            )
            .id(tab.id)
        }
    }

    private func simpleGridColumns(for width: CGFloat, count: Int, gap: CGFloat) -> Int {
        guard count > 1 else { return 1 }
        let targetWidth: CGFloat = 560
        let possible = max(1, Int((width + gap) / (targetWidth + gap)))
        return min(count, min(3, possible))
    }

    @ViewBuilder
    private var webAttachGrid: some View {
        let targets = model.attachableTargets
        if !targets.isEmpty || model.isLoadingTargets {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.sm) {
                    Text("Attachable Sessions")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(ScoutPalette.dim)
                    Spacer(minLength: 0)
                    Text(model.isLoadingTargets ? "SYNCING" : "\(targets.count)")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(ScoutPalette.dim)
                }

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 220), spacing: HudSpacing.sm)],
                    alignment: .leading,
                    spacing: HudSpacing.sm
                ) {
                    ForEach(targets) { target in
                        ScoutTerminalWebAttachTargetCard(target: target) {
                            attachTargetFromPicker(target)
                        }
                    }
                }
            }
            .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
        }
    }

    private var attachPickerOverlay: some View {
        webAttachPickerSurface
            .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
            .padding(.top, HudSpacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var webAttachPickerSurface: some View {
        let targets = model.attachableTargets
        return VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: "link")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                Text("Attachable Sessions")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(0.7)
                    .foregroundStyle(ScoutPalette.dim)
                Text(model.isLoadingTargets ? "SYNCING" : "\(targets.count)")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(0.7)
                    .foregroundStyle(ScoutPalette.dim)
                Spacer(minLength: HudSpacing.md)
                ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Refresh attachable sessions") {
                    Task { await model.loadAttachTargets() }
                }
                ScoutTerminalIconButton(systemName: "xmark", help: "Hide attachable sessions") {
                    withAnimation(.easeOut(duration: 0.16)) {
                        showAttachPicker = false
                    }
                }
            }

            if targets.isEmpty, !model.isLoadingTargets {
                Text("No attachable sessions available")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.dim)
                    .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
            } else {
                ScrollView {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 240), spacing: HudSpacing.sm)],
                        alignment: .leading,
                        spacing: HudSpacing.sm
                    ) {
                        ForEach(targets) { target in
                            ScoutTerminalWebAttachTargetCard(target: target) {
                                attachTargetFromPicker(target)
                            }
                        }
                    }
                }
                .frame(maxHeight: 220)
                .scoutOverlayScrollers()
            }
        }
        .padding(HudSpacing.md)
        .frame(maxWidth: 980, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutSurface.control.opacity(0.97))
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: ScoutSurface.shadow(0.18), radius: 12, x: 0, y: 6)
    }

    private var attachPickerButton: some View {
        ScoutTerminalHeaderButton(
            title: showAttachPicker ? "Hide" : "Attach",
            icon: showAttachPicker ? "xmark" : "link",
            active: showAttachPicker,
            disabled: model.isLoadingTargets && model.attachTargets.isEmpty
        ) {
            if !showAttachPicker {
                Task { await model.loadAttachTargets() }
            }
            withAnimation(.easeOut(duration: 0.16)) {
                showAttachPicker.toggle()
            }
        }
    }

    private func attachTargetFromPicker(_ target: ScoutTerminalWebAttachTarget) {
        model.attach(target)
        withAnimation(.easeOut(duration: 0.16)) {
            showAttachPicker = false
        }
    }

    private func attachDraggedTargets(_ providers: [NSItemProvider]) -> Bool {
        ScoutTerminalDragPayload.loadIDs(from: providers) { id in
            Task { @MainActor in
                if model.attachTarget(id: id) {
                    dropTargeted = false
                    showAttachPicker = false
                }
            }
        }
    }

    private var newTabMenu: some View {
        Menu {
            Button("Shell") {
                model.addTerminalTab(backend: "pty", agent: "shell")
            }
            Button("Claude") {
                model.addTerminalTab(backend: "pty", agent: "claude")
            }
            Divider()
            Menu("tmux") {
                Button("Shell in tmux") {
                    model.addTerminalTab(backend: "tmux", agent: "shell")
                }
                Button("Claude in tmux") {
                    model.addTerminalTab(backend: "tmux", agent: "claude")
                }
            }
            Menu("zellij") {
                Button("Shell in zellij") {
                    model.addTerminalTab(backend: "zellij", agent: "shell")
                }
                Button("Claude in zellij") {
                    model.addTerminalTab(backend: "zellij", agent: "claude")
                }
            }
        } label: {
            ScoutTerminalMenuLabel(title: "New", icon: "plus.square.on.square")
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: true, vertical: false)
        .help("Open a terminal tile")
    }

    private var terminalOptionsMenu: some View {
        Menu {
            Button(model.isLoadingTargets ? "Refreshing..." : "Refresh attachable sessions") {
                Task { await model.loadAttachTargets() }
            }
            Button("Reload all tiles") {
                model.reloadAll()
            }
            .disabled(model.tabs.isEmpty)
            Divider()
            Button("Open in browser") {
                ScoutWeb.open(path: "/terminal")
            }
        } label: {
            ScoutTerminalMenuLabel(title: "More", icon: "ellipsis")
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: true, vertical: false)
        .help("Terminal options")
    }

}

private struct ScoutTerminalWebTileView: View {
    let tab: ScoutTerminalWebTab
    let isSelected: Bool
    let canClose: Bool
    let showHeader: Bool
    let url: URL
    let onSelect: () -> Void
    let onReload: () -> Void
    let onClose: () -> Void
    let onOpen: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovering = false

    var body: some View {
        VStack(spacing: 0) {
            if showHeader {
                titleBar
            }
            ScoutTerminalEmbedHost(url: url, reloadToken: tab.reloadToken, onRetry: onReload)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(tileBackground)
        .clipShape(RoundedRectangle(cornerRadius: showHeader ? HudRadius.card : HudRadius.tight, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: showHeader ? HudRadius.card : HudRadius.tight, style: .continuous)
                .stroke(isSelected ? ScoutPalette.accent : ScoutDesign.hairlineStrong, lineWidth: isSelected ? 1.5 : HudStrokeWidth.thin)
        )
        .overlay(alignment: .topLeading) {
            if !showHeader {
                Button(action: onSelect) {
                    HStack(spacing: HudSpacing.xs) {
                        ScoutTerminalBackendBadge("xterm")
                        ScoutTerminalBackendBadge(tab.badge)
                    }
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
                .padding(5)
                .opacity(isHovering || isSelected ? 1 : 0.78)
                .help("Select \(tab.title)")
            }
        }
        .overlay(alignment: .topTrailing) {
            if !showHeader && (isHovering || isSelected) {
                HStack(spacing: 2) {
                    ScoutTerminalIconButton(systemName: "safari", help: "Open tile in browser", action: onOpen)
                    ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Reload terminal tile", action: onReload)
                    if canClose {
                        ScoutTerminalIconButton(systemName: "xmark", help: "Close terminal tile", action: onClose)
                    }
                }
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(ScoutSurface.control.opacity(0.92))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )
            }
        }
        .onHover { isHovering = $0 }
        .help(tab.subtitle)
    }

    private var titleBar: some View {
        HStack(spacing: HudSpacing.md) {
            Button(action: onSelect) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: tab.icon)
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tab.title)
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                        Text(tab.subtitle)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()

            Spacer(minLength: HudSpacing.sm)

            ScoutTerminalBackendBadge("xterm")
            ScoutTerminalBackendBadge(tab.badge)

            ScoutTerminalIconButton(systemName: "safari", help: "Open tile in browser", action: onOpen)
            ScoutTerminalIconButton(systemName: "arrow.clockwise", help: "Reload terminal tile", action: onReload)
            if canClose {
                ScoutTerminalIconButton(systemName: "xmark", help: "Close terminal tile", action: onClose)
            }
        }
        .frame(height: HudLayout.rowHeightRegular)
        .padding(.horizontal, HudSpacing.xl)
        .background(isSelected ? ScoutSurface.hover : ScoutSurface.control)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(isSelected ? ScoutPalette.accent.opacity(0.65) : ScoutDesign.hairline)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    private var tileBackground: Color {
        colorScheme == .dark ? Color.black.opacity(0.24) : ScoutSurface.inset
    }
}

private struct ScoutTerminalMenuLabel: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            Text(title.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.45)
        }
        .foregroundStyle(ScoutPalette.muted)
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
    }
}

private struct ScoutTerminalWebTab: Identifiable, Equatable {
    let id: String
    var title: String
    var subtitle: String
    var badge: String
    var icon: String
    var routePath: String
    var reloadToken = UUID()
}

private struct ScoutTerminalWebAttachTarget: Identifiable, Hashable {
    var id: String
    var title: String
    var subtitle: String
    var routePath: String

    init(session: ScoutTerminalSessionRecord, surface: ScoutTerminalSurfaceRecord) {
        let key = "\(surface.backend):\(surface.sessionName)"
        id = "\(session.id)::\(key)"
        title = [
            session.harness.isEmpty ? nil : session.harness,
            surface.sessionName,
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        subtitle = [
            surface.backend,
            surface.state,
            ScoutNativeTerminalTarget.shortPath(session.cwd),
        ]
        .compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
        .joined(separator: " · ")
        routePath = Self.attachRoute(sessionId: session.id, surfaceKey: key)
    }

    private static func attachRoute(sessionId: String, surfaceKey: String) -> String {
        var components = URLComponents()
        components.path = "/terminal"
        components.queryItems = [
            URLQueryItem(name: "session", value: sessionId),
            URLQueryItem(name: "surface", value: surfaceKey),
            URLQueryItem(name: "mode", value: "takeover"),
        ]
        return components.string ?? "/terminal"
    }
}

private struct ScoutTerminalWebAttachTargetCard: View {
    let target: ScoutTerminalWebAttachTarget
    let onAttach: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "link")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.title)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Text(target.subtitle)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.sm)

            ScoutTerminalBackendBadge("xterm")
            ScoutTerminalIconButton(systemName: "plus", help: "Attach terminal tile", action: onAttach)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 48)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(hovering ? ScoutSurface.hover : ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(hovering ? ScoutPalette.accent.opacity(0.35) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        .onTapGesture(count: 2, perform: onAttach)
        .onHover { hovering = $0 }
        .onDrag {
            ScoutTerminalDragPayload.itemProvider(id: target.id)
        }
        .help(target.subtitle)
    }
}

@MainActor
private final class ScoutTerminalWebTabsModel: ObservableObject {
    @Published private(set) var tabs: [ScoutTerminalWebTab] = []
    @Published var selectedTabID: String?
    @Published private(set) var attachTargets: [ScoutTerminalWebAttachTarget] = []
    @Published private(set) var isLoadingTargets = false
    @Published private(set) var errorMessage: String?

    var attachableTargets: [ScoutTerminalWebAttachTarget] {
        let tiledRoutes = Set(tabs.map(\.routePath))
        return attachTargets.filter { !tiledRoutes.contains($0.routePath) }
    }

    func select(_ tab: ScoutTerminalWebTab) {
        selectedTabID = tab.id
    }

    func addTerminalTab(backend: String, agent: String) {
        let id = UUID().uuidString
        let short = String(id.prefix(8)).lowercased()
        let backendLabel = backend == "pty" ? "pty" : backend
        let agentLabel = agent == "shell" ? "Shell" : agent == "pi" ? "Pi" : "Claude"
        let sessionName = backend == "pty" ? nil : "\(backend == "zellij" ? "scout-zj" : "scout-tmux")-\(short)"
        let route = Self.newRoute(backend: backend, agent: agent, sessionName: sessionName, tabID: short)
        appendOrSelect(ScoutTerminalWebTab(
            id: "new-\(short)",
            title: backend == "pty" ? agentLabel : "\(agentLabel) \(backend)",
            subtitle: sessionName ?? "fresh PTY session",
            badge: backendLabel,
            icon: backend == "zellij" ? "rectangle.3.group" : backend == "tmux" ? "rectangle.split.2x1" : "terminal",
            routePath: route
        ))
    }

    func attach(_ target: ScoutTerminalWebAttachTarget) {
        appendOrSelect(ScoutTerminalWebTab(
            id: "attach-\(target.id)",
            title: target.title,
            subtitle: target.subtitle,
            badge: "attach",
            icon: "link",
            routePath: target.routePath
        ))
    }

    @discardableResult
    func attachTarget(id: String) -> Bool {
        guard let target = attachTargets.first(where: { $0.id == id }) else { return false }
        attach(target)
        return true
    }

    func close(_ tab: ScoutTerminalWebTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tabs.remove(at: index)
        if selectedTabID == tab.id {
            selectedTabID = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        }
    }

    func reload(_ tab: ScoutTerminalWebTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tabs[index].reloadToken = UUID()
    }

    func reloadAll() {
        for index in tabs.indices {
            tabs[index].reloadToken = UUID()
        }
    }

    func loadAttachTargets() async {
        isLoadingTargets = true
        defer { isLoadingTargets = false }

        do {
            let url = ScoutWeb.url(path: "/api/terminal-sessions?includeDiscovered=1")
                ?? ScoutWeb.baseURL().appending(path: "api/terminal-sessions")
            let payload = try await ScoutHTTP.fetch(
                ScoutTerminalSessionsPayload.self,
                from: url
            )
            attachTargets = payload.sessions
                .flatMap { session in
                    session.surfaces.map { surface in
                        ScoutTerminalWebAttachTarget(session: session, surface: surface)
                    }
                }
                .filter { !$0.title.isEmpty }
            errorMessage = nil
        } catch {
            errorMessage = ScoutAppError.userFacing(
                error,
                connectionMessage: "Could not reach Scout terminal sessions."
            )
        }
    }

    private func appendOrSelect(_ tab: ScoutTerminalWebTab) {
        if let existing = tabs.first(where: { $0.routePath == tab.routePath }) {
            selectedTabID = existing.id
            return
        }
        tabs.append(tab)
        selectedTabID = tab.id
    }

    private static func newRoute(
        backend: String,
        agent: String,
        sessionName: String?,
        tabID: String
    ) -> String {
        var components = URLComponents()
        components.path = "/terminal/new"
        components.queryItems = [
            URLQueryItem(name: "backend", value: backend),
            URLQueryItem(name: "agent", value: agent),
            URLQueryItem(name: "tab", value: tabID),
        ]
        if let sessionName {
            components.queryItems?.append(URLQueryItem(name: "name", value: sessionName))
        }
        return components.string ?? "/terminal/new"
    }
}
#endif

private struct ScoutTerminalRendererToggle: View {
    @Binding var selection: ScoutTerminalRenderer

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutTerminalRenderer.allCases, id: \.self) { option in
                rendererSegment(option)
            }
        }
        .padding(2)
        .frame(height: 26)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .help("Switch terminal renderer")
    }

    private func rendererSegment(_ option: ScoutTerminalRenderer) -> some View {
        let isSelected = selection == option
        return Button {
            selection = option
        } label: {
            HStack(spacing: HudSpacing.xxs) {
                Image(systemName: option.icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(option.title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.4)
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? ScoutPalette.bg : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(isSelected ? ScoutPalette.accent : Color.clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous))
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .help(option.detail)
        .accessibilityLabel(option.detail)
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
        DispatchQueue.main.async {
            phase = .loading
        }
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
            ScoutAppError.userFacing(error, connectionMessage: ScoutServicesHelper.servicesOfflineMessage)
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
    let disabled: Bool
    let active: Bool

    @State private var hovering = false

    init(title: String, icon: String, active: Bool = false, disabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.disabled = disabled
        self.active = active
        self.action = action
    }

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
            .foregroundStyle(active ? ScoutPalette.ink : (hovering ? ScoutPalette.ink : ScoutPalette.muted))
            .padding(.horizontal, HudSpacing.md)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(active ? ScoutSurface.selected(ScoutPalette.accent) : (hovering ? ScoutSurface.hover : ScoutSurface.inset))
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(active ? ScoutPalette.accent.opacity(0.3) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .onHover { if !disabled { hovering = $0 } }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1.0)
        .help(title)
    }
}
