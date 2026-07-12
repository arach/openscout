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
    enum Payload {
        case attachTarget(String)
    }

    private static let attachType = UTType(exportedAs: "app.openscout.terminal-attach-target")

    static let attachTypes: [UTType] = [attachType, .plainText]
    private static let attachPrefix = "scout-terminal-target:"

    static func itemProvider(_ payload: Payload) -> NSItemProvider {
        let value: String
        let type: UTType
        switch payload {
        case .attachTarget(let id):
            value = attachPrefix + id
            type = attachType
        }
        return NSItemProvider(item: value as NSString, typeIdentifier: type.identifier)
    }

    static func load(
        from providers: [NSItemProvider],
        acceptedTypes: [UTType],
        onPayload: @escaping @MainActor @Sendable (Payload) -> Void
    ) -> Bool {
        let candidates = providers.compactMap { provider -> (NSItemProvider, String)? in
            guard let type = acceptedTypes.first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            }) else { return nil }
            return (provider, type.identifier)
        }
        guard !candidates.isEmpty else { return false }

        for (provider, typeIdentifier) in candidates {
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                guard let value = string(from: item)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      let payload = decode(value) else {
                    return
                }
                Task { @MainActor in
                    onPayload(payload)
                }
            }
        }

        return true
    }

    private static func decode(_ value: String) -> Payload? {
        if value.hasPrefix(attachPrefix) {
            return .attachTarget(String(value.dropFirst(attachPrefix.count)))
        }
        return value.isEmpty ? nil : .attachTarget(value)
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

enum ScoutTerminalTileDropEdge: Equatable {
    case before
    case after
}

private enum ScoutTerminalTileDropAxis: Equatable {
    case horizontal
    case vertical
}

private struct ScoutTerminalTileDropTarget: Equatable {
    let id: String
    let edge: ScoutTerminalTileDropEdge
    let axis: ScoutTerminalTileDropAxis
}

private enum ScoutTerminalCoordinateSpace {
    static let nativeGrid = "scout-native-terminal-grid"
}

private struct ScoutTerminalTileFramePreferenceKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

enum ScoutTerminalRenderer: String, CaseIterable, Hashable {
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

enum ScoutTerminalSettings {
    static let rendererKey = "scout.terminals.renderer"
    static let fontFamilyKey = "scout.terminals.fontFamily"
    static let fontSizeKey = "scout.terminals.fontSize"
    static let showNativeHeadersKey = "scout.terminals.native.showHeaders"

    static let defaultFontSize = 13.0

    private static let preferredFontFamilies = [
        "JetBrainsMono Nerd Font",
        "JetBrainsMonoNL Nerd Font",
        "MesloLGS Nerd Font Mono",
        "Hack Nerd Font Mono",
        "CaskaydiaCove Nerd Font Mono",
        "FiraCode Nerd Font Mono",
        "SF Mono",
        "Menlo",
        "Monaco",
    ]

    static var availableFontFamilies: [String] {
        let installed = Set(NSFontManager.shared.availableFontFamilies)
        return preferredFontFamilies.filter(installed.contains)
    }

    static var defaultFontFamily: String {
        availableFontFamilies.first ?? "SF Mono"
    }
}

struct ScoutTerminalWebCommand: Equatable {
    let id = UUID()
    let line: String
}

#if HUDSON_TERMINAL
@MainActor
struct ScoutTerminalWorkspace: Identifiable {
    let id: String
    var name: String
    let nativeModel: ScoutNativeTerminalGridModel
    let webModel: ScoutTerminalWebTabsModel

    init(id: String = UUID().uuidString, name: String) {
        self.id = id
        self.name = name
        nativeModel = ScoutNativeTerminalGridModel()
        webModel = ScoutTerminalWebTabsModel()
    }
}

@MainActor
final class ScoutTerminalWorkspaceStore: ObservableObject {
    @Published private(set) var workspaces: [ScoutTerminalWorkspace]
    @Published private(set) var selectedWorkspaceID: String

    init() {
        let main = ScoutTerminalWorkspace(id: "main", name: "Main")
        workspaces = [main]
        selectedWorkspaceID = main.id
    }

    var selectedWorkspace: ScoutTerminalWorkspace {
        workspaces.first(where: { $0.id == selectedWorkspaceID }) ?? workspaces[0]
    }

    func select(_ id: String) {
        guard workspaces.contains(where: { $0.id == id }) else { return }
        selectedWorkspaceID = id
    }

    func addWorkspace() {
        let usedNames = Set(workspaces.map(\.name))
        var index = workspaces.count + 1
        while usedNames.contains("Workspace \(index)") {
            index += 1
        }
        let workspace = ScoutTerminalWorkspace(name: "Workspace \(index)")
        workspaces.append(workspace)
        selectedWorkspaceID = workspace.id
    }

    func renameSelected(_ name: String) {
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty,
              let index = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID })
        else { return }
        workspaces[index].name = cleaned
    }

    func closeSelected() {
        guard workspaces.count > 1,
              let index = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID })
        else { return }
        let workspace = workspaces.remove(at: index)
        workspace.nativeModel.stopAll()
        selectedWorkspaceID = workspaces[min(index, workspaces.count - 1)].id
    }
}

private struct ScoutTerminalWorkspaceBar: View {
    @ObservedObject var store: ScoutTerminalWorkspaceStore
    let tileCount: Int
    let persistenceNote: String

    @State private var renameDraft = ""
    @State private var isRenamePresented = false

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Text("WORKSPACES")
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(0.7)
                .foregroundStyle(ScoutPalette.dim)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.xxs) {
                    ForEach(store.workspaces) { workspace in
                        workspaceButton(workspace)
                    }
                }
            }

            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(width: HudStrokeWidth.thin, height: 20)

            ScoutTerminalIconButton(systemName: "pencil", help: "Rename workspace") {
                renameDraft = store.selectedWorkspace.name
                isRenamePresented = true
            }
            ScoutTerminalIconButton(systemName: "plus", help: "New workspace") {
                store.addWorkspace()
            }
            ScoutTerminalIconButton(
                systemName: "xmark",
                help: "Close workspace",
                disabled: store.workspaces.count <= 1
            ) {
                store.closeSelected()
            }

            Spacer(minLength: HudSpacing.md)

            Text("\(tileCount) TILE\(tileCount == 1 ? "" : "S") · \(persistenceNote.uppercased())")
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .tracking(0.55)
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        }
        .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
        .frame(height: 38)
        .background(ScoutSurface.inset.opacity(0.55))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(height: HudStrokeWidth.thin)
        }
        .alert("Rename workspace", isPresented: $isRenamePresented) {
            TextField("Workspace name", text: $renameDraft)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                store.renameSelected(renameDraft)
            }
            .disabled(renameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("Use a short name that describes this terminal layout.")
        }
    }

    private func workspaceButton(_ workspace: ScoutTerminalWorkspace) -> some View {
        let selected = workspace.id == store.selectedWorkspaceID
        return Button {
            store.select(workspace.id)
        } label: {
            Text(workspace.name)
                .font(HudFont.mono(HudTextSize.xs, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? ScoutPalette.ink : ScoutPalette.muted)
                .padding(.horizontal, HudSpacing.md)
                .frame(height: 26)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(selected ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .stroke(
                            selected ? ScoutPalette.accent.opacity(0.32) : Color.clear,
                            lineWidth: HudStrokeWidth.thin
                        )
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(selected ? "Current terminal workspace" : "Switch to \(workspace.name)")
    }
}
#endif

/// Terminal surface for the native Scout app.
///
/// When HudsonTerminal is enabled this hosts Termini/Ghostty-backed local PTYs.
/// The WKWebView terminal cockpit stays available as a fallback and for web
/// relay controls that have not moved to a native surface yet.
struct ScoutTerminalContent: View {
    #if HUDSON_TERMINAL
    @ObservedObject var workspaceStore: ScoutTerminalWorkspaceStore
    @AppStorage(ScoutTerminalSettings.rendererKey) private var rendererRaw = ScoutTerminalRenderer.xterm.rawValue

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
            ScoutNativeTerminalContent(
                renderer: rendererBinding,
                workspaceStore: workspaceStore,
                model: workspaceStore.selectedWorkspace.nativeModel
            )
        case .xterm:
            ScoutTerminalWebContent(
                renderer: rendererBinding,
                workspaceStore: workspaceStore,
                model: workspaceStore.selectedWorkspace.webModel
            )
        }
        #else
        ScoutTerminalWebContent()
        #endif
    }
}

#if HUDSON_TERMINAL
private struct ScoutNativeTerminalContent: View {
    @Binding var renderer: ScoutTerminalRenderer
    @ObservedObject var workspaceStore: ScoutTerminalWorkspaceStore
    @ObservedObject var model: ScoutNativeTerminalGridModel
    @AppStorage(ScoutTerminalSettings.showNativeHeadersKey) private var showHeaders = true
    @State private var dropTargeted = false
    @State private var draggedTileID: String?
    @State private var tileDropTarget: ScoutTerminalTileDropTarget?
    @State private var tileDragLocation: CGPoint?
    @State private var tileFrames: [String: CGRect] = [:]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutTerminalWorkspaceBar(
                store: workspaceStore,
                tileCount: model.tiles.count,
                persistenceNote: "kept while Scout runs"
            )
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
                ScoutTerminalRendererToggle(selection: $renderer)
                nativeNewShellMenu
                nativeOptionsMenu
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var nativeNewShellMenu: some View {
        Menu {
            nativeShellButton(title: "shell", mode: "shell", command: nil, icon: "terminal")
            Divider()
            nativeShellButton(title: "tmux", mode: "tmux", command: "tmux", icon: "rectangle.split.2x1")
            nativeShellButton(title: "zellij", mode: "zellij", command: "zellij", icon: "rectangle.3.group")
            nativeShellButton(title: "herdr", mode: "herdr", command: "herdr", icon: "square.grid.2x2")
            if !ScoutNativeTerminalTarget.commandAvailable("herdr") {
                Divider()
                Button("Install herdr…") {
                    if let url = URL(string: "https://herdr.dev/docs/install/") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        } label: {
            ScoutTerminalMenuLabel(title: "New shell", icon: "plus")
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: true, vertical: false)
        .disabled(model.isAddingShell)
        .help("Open a native shell in a supported terminal backend")
    }

    private func nativeShellButton(
        title: String,
        mode: String,
        command: String?,
        icon: String
    ) -> some View {
        let available = command.map(ScoutNativeTerminalTarget.commandAvailable) ?? true
        return Button {
            model.addLocalShell(mode: mode)
        } label: {
            Label(available ? title : "\(title) — not installed", systemImage: icon)
        }
        .disabled(!available)
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
                            nativeNewShellMenu
                            ScoutTerminalHeaderButton(title: model.isLoading ? "Loading" : "Refresh", icon: "arrow.clockwise") {
                                Task { await model.reload() }
                            }
                        }
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    .onDrop(
                        of: ScoutTerminalDragPayload.attachTypes,
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
            let dropAxis: ScoutTerminalTileDropAxis = columns > 1 ? .horizontal : .vertical
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
                                retargetTargets: model.retargetableTargets(for: tile),
                                dropTarget: tileDropTarget?.id == tile.id ? tileDropTarget : nil,
                                onDragChanged: { updateTileDrag(id: tile.id, location: $0, axis: dropAxis) },
                                onDragEnded: { finishTileDrag(id: tile.id, location: $0, axis: dropAxis) },
                                onRetarget: { model.retarget(tile, to: $0) },
                                onRefreshTargets: { Task { await model.reload() } },
                                onRestart: { model.restart(tile) },
                                onClose: { model.close(tile) }
                            )
                            .frame(height: tileHeight)
                            .background {
                                GeometryReader { tileGeometry in
                                    Color.clear.preference(
                                        key: ScoutTerminalTileFramePreferenceKey.self,
                                        value: [
                                            tile.id: tileGeometry.frame(
                                                in: .named(ScoutTerminalCoordinateSpace.nativeGrid)
                                            )
                                        ]
                                    )
                                }
                            }
                        }
                    }
                    .padding(.horizontal, ScoutTerminalMetrics.pageGutter)
                    .padding(.top, gap)
                    .onDrop(
                        of: ScoutTerminalDragPayload.attachTypes,
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
            .coordinateSpace(name: ScoutTerminalCoordinateSpace.nativeGrid)
            .onPreferenceChange(ScoutTerminalTileFramePreferenceKey.self) { tileFrames = $0 }
            .overlay {
                GeometryReader { overlayGeometry in
                    if let draggedTileID,
                       let tileDragLocation,
                       let tile = model.tiles.first(where: { $0.id == draggedTileID }) {
                        ScoutNativeTerminalDragPreview(tile: tile)
                            .position(
                                x: min(
                                    max(
                                        tileDragLocation.x + ScoutNativeTerminalDragPreview.cursorOffset.x,
                                        ScoutNativeTerminalDragPreview.size.width / 2
                                    ),
                                    overlayGeometry.size.width - ScoutNativeTerminalDragPreview.size.width / 2
                                ),
                                y: min(
                                    max(
                                        tileDragLocation.y + ScoutNativeTerminalDragPreview.cursorOffset.y,
                                        ScoutNativeTerminalDragPreview.size.height / 2
                                    ),
                                    overlayGeometry.size.height - ScoutNativeTerminalDragPreview.size.height / 2
                                )
                            )
                            .allowsHitTesting(false)
                    }
                }
            }
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

    private func updateTileDrag(
        id: String,
        location: CGPoint,
        axis: ScoutTerminalTileDropAxis
    ) {
        draggedTileID = id
        tileDragLocation = location
        tileDropTarget = tileDropTarget(for: id, location: location, axis: axis)
    }

    private func finishTileDrag(
        id: String,
        location: CGPoint,
        axis: ScoutTerminalTileDropAxis
    ) {
        if let target = tileDropTarget(for: id, location: location, axis: axis) {
            model.moveTile(id: id, relativeTo: target.id, edge: target.edge)
        }
        draggedTileID = nil
        tileDragLocation = nil
        tileDropTarget = nil
    }

    private func tileDropTarget(
        for sourceID: String,
        location: CGPoint,
        axis: ScoutTerminalTileDropAxis
    ) -> ScoutTerminalTileDropTarget? {
        guard let destination = model.tiles.first(where: { tile in
            tile.id != sourceID && tileFrames[tile.id]?.contains(location) == true
        }), let frame = tileFrames[destination.id] else {
            return nil
        }

        let edge: ScoutTerminalTileDropEdge
        switch axis {
        case .horizontal:
            edge = location.x < frame.midX ? .before : .after
        case .vertical:
            edge = location.y < frame.midY ? .before : .after
        }
        return ScoutTerminalTileDropTarget(id: destination.id, edge: edge, axis: axis)
    }

    private func attachDraggedTargets(_ providers: [NSItemProvider]) -> Bool {
        ScoutTerminalDragPayload.load(
            from: providers,
            acceptedTypes: ScoutTerminalDragPayload.attachTypes
        ) { payload in
            guard case .attachTarget(let id) = payload else { return }
            if model.attachTarget(id: id) {
                dropTargeted = false
            }
        }
    }
}

@MainActor
final class ScoutNativeTerminalGridModel: ObservableObject {
    @Published private(set) var tiles: [ScoutNativeTerminalTile] = []
    @Published private(set) var attachTargets: [ScoutNativeTerminalTarget] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private var didLoad = false
    private var localShellCounter = 0
    private var lastAddTime = Date.distantPast
    @Published private(set) var isAddingShell = false

    var attachableTargets: [ScoutNativeTerminalTarget] {
        let tiledIDs = Set(tiles.map(\.target.id))
        return attachTargets.filter { !tiledIDs.contains($0.id) }
    }

    func retargetableTargets(for tile: ScoutNativeTerminalTile) -> [ScoutNativeTerminalTarget] {
        let occupiedIDs = Set(tiles.lazy.filter { $0.id != tile.id }.map(\.target.id))
        return attachTargets.filter { !occupiedIDs.contains($0.id) }
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
            let herdrTargets = await ScoutNativeTerminalTarget.discoverHerdrSessions()
            let targets = payload.sessions.flatMap(\.nativeTargets) + herdrTargets
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
        if let current = tiles.first(where: { $0.target.id == target.id }) {
            current.update(target)
            return
        }
        tiles.append(ScoutNativeTerminalTile(target: target))
    }

    func retarget(_ tile: ScoutNativeTerminalTile, to target: ScoutNativeTerminalTarget) {
        guard !tiles.contains(where: { $0.id != tile.id && $0.target.id == target.id }) else { return }
        tile.retarget(target)
        objectWillChange.send()
    }

    func moveTile(
        id: String,
        relativeTo destinationID: String,
        edge: ScoutTerminalTileDropEdge
    ) {
        guard id != destinationID,
              let sourceIndex = tiles.firstIndex(where: { $0.id == id }),
              tiles.contains(where: { $0.id == destinationID })
        else { return }

        let tile = tiles.remove(at: sourceIndex)
        guard let destinationIndex = tiles.firstIndex(where: { $0.id == destinationID }) else { return }
        let insertionIndex = edge == .after ? destinationIndex + 1 : destinationIndex
        tiles.insert(tile, at: min(insertionIndex, tiles.count))
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
            if let target = targetsByID[tile.target.id] {
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
final class ScoutNativeTerminalTile: ObservableObject, Identifiable, @unchecked Sendable {
    let id: String
    @Published private(set) var workspace: TerminiLocalPTYWorkspace

    @Published private(set) var target: ScoutNativeTerminalTarget
    @Published private(set) var statusMessage: String = "Ready"
    @Published private(set) var isRunning = false
    @Published private(set) var hasStarted = false

    private var statusTask: Task<Void, Never>?

    init(target: ScoutNativeTerminalTarget) {
        self.id = "native-tile-\(UUID().uuidString)"
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

    func retarget(_ next: ScoutNativeTerminalTarget) {
        statusTask?.cancel()
        statusTask = nil
        workspace.stop()

        target = next
        workspace = TerminiLocalPTYWorkspace(processSpec: next.processSpec)
        statusMessage = workspace.statusMessage
        isRunning = false
        hasStarted = false
        startIfNeeded()
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

    func toggleHerdrSidebar() {
        sendHerdrShortcut("b")
    }

    func showHerdrKeybindings() {
        sendHerdrShortcut("?")
    }

    private func sendHerdrShortcut(_ key: Character) {
        guard target.backendLabel == "herdr",
              let ascii = key.asciiValue
        else { return }
        workspace.send(Data([0x02, ascii]))
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
        let nextStatusMessage = workspace.statusMessage
        let nextIsRunning = workspace.isRunning
        if statusMessage != nextStatusMessage {
            statusMessage = nextStatusMessage
        }
        if isRunning != nextIsRunning {
            isRunning = nextIsRunning
        }
    }
}

private struct ScoutNativeTerminalTileView: View {
    @ObservedObject var tile: ScoutNativeTerminalTile
    let showHeader: Bool
    let retargetTargets: [ScoutNativeTerminalTarget]
    let dropTarget: ScoutTerminalTileDropTarget?
    let onDragChanged: (CGPoint) -> Void
    let onDragEnded: (CGPoint) -> Void
    let onRetarget: (ScoutNativeTerminalTarget) -> Void
    let onRefreshTargets: () -> Void
    let onRestart: () -> Void
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(ScoutTerminalSettings.fontFamilyKey) private var fontFamily = ScoutTerminalSettings.defaultFontFamily
    @AppStorage(ScoutTerminalSettings.fontSizeKey) private var fontSize = ScoutTerminalSettings.defaultFontSize
    @State private var isHovering = false
    @State private var isRetargetPickerPresented = false

    var body: some View {
        VStack(spacing: 0) {
            if showHeader {
                titleBar
            }
            HudTerminalSurface(
                controller: tile.workspace.controller,
                showsSystemKeyboard: true,
                appearance: HudTerminalAppearance(fontSize: fontSize, fontFamily: fontFamily),
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
            .stroke(
                dropTarget == nil ? ScoutDesign.hairlineStrong : ScoutPalette.accent.opacity(0.5),
                lineWidth: dropTarget == nil ? HudStrokeWidth.thin : HudStrokeWidth.standard
            )
        )
        .overlay {
            dropIndicator
        }
        .overlay(alignment: .topTrailing) {
            if !showHeader {
                HStack(spacing: 2) {
                    dragHandle
                    herdrControls
                    retargetMenu
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
                // A compact tile's menu opens outside the tile bounds. Keep
                // its anchor mounted when hover leaves the tile so AppKit does
                // not repeatedly dismiss and reposition the nested menu.
                .opacity(isHovering ? 1 : 0.62)
                .animation(.easeOut(duration: 0.12), value: isHovering)
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
            dragHandle

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

            herdrControls
            retargetMenu
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
        .contentShape(Rectangle())
        .gesture(tileDragGesture, including: .gesture)
    }

    @ViewBuilder
    private var herdrControls: some View {
        if tile.target.backendLabel == "herdr" {
            ScoutTerminalIconButton(
                systemName: "sidebar.left",
                help: "Toggle Herdr sidebar (Ctrl-B, B)",
                action: tile.toggleHerdrSidebar
            )
            ScoutTerminalIconButton(
                systemName: "questionmark.circle",
                help: "Show Herdr keybindings (Ctrl-B, ?)",
                action: tile.showHerdrKeybindings
            )
        }
    }

    @ViewBuilder
    private var dragHandle: some View {
        if showHeader {
            dragHandleLabel
        } else {
            dragHandleLabel
                .gesture(tileDragGesture)
        }
    }

    private var dragHandleLabel: some View {
        Image(systemName: "line.3.horizontal")
            .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
            .foregroundStyle(ScoutPalette.dim)
            .frame(width: 22, height: 22)
            .contentShape(Rectangle())
            .help("Drag to move tile")
            .accessibilityLabel("Move terminal tile")
    }

    private var tileDragGesture: some Gesture {
        DragGesture(
            minimumDistance: 4,
            coordinateSpace: .named(ScoutTerminalCoordinateSpace.nativeGrid)
        )
        .onChanged { onDragChanged($0.location) }
        .onEnded { onDragEnded($0.location) }
    }

    @ViewBuilder
    private var dropIndicator: some View {
        if let dropTarget {
            GeometryReader { geometry in
                switch dropTarget.axis {
                case .horizontal:
                    Rectangle()
                        .fill(ScoutPalette.accent)
                        .frame(width: 4, height: max(0, geometry.size.height - 16))
                        .position(
                            x: dropTarget.edge == .before ? 3 : geometry.size.width - 3,
                            y: geometry.size.height / 2
                        )
                case .vertical:
                    Rectangle()
                        .fill(ScoutPalette.accent)
                        .frame(width: max(0, geometry.size.width - 16), height: 4)
                        .position(
                            x: geometry.size.width / 2,
                            y: dropTarget.edge == .before ? 3 : geometry.size.height - 3
                        )
                }
            }
            .allowsHitTesting(false)
        }
    }

    private var retargetMenu: some View {
        Button {
            isRetargetPickerPresented.toggle()
        } label: {
            Image(systemName: "arrow.left.arrow.right")
                .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.muted)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .popover(isPresented: $isRetargetPickerPresented, arrowEdge: .bottom) {
            retargetPicker
        }
        .help("Change attached session")
        .accessibilityLabel("Change attached session")
    }

    private var retargetPicker: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(spacing: HudSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Change session")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                    Text("Attach this tile to another live terminal")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)
                }
                Spacer(minLength: HudSpacing.xl)
                ScoutTerminalIconButton(
                    systemName: "arrow.clockwise",
                    help: "Refresh sessions",
                    action: onRefreshTargets
                )
            }

            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(height: HudStrokeWidth.thin)

            if retargetBackends.isEmpty {
                Text("No other terminal sessions are available.")
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .padding(.vertical, HudSpacing.md)
            } else {
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: HudSpacing.lg) {
                        ForEach(retargetBackends, id: \.self) { backend in
                            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                                Text(backend)
                                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                                    .tracking(0.7)
                                    .foregroundStyle(ScoutPalette.dim)

                                ForEach(retargetTargets.filter { $0.backendLabel == backend }) { target in
                                    retargetButton(target)
                                }
                            }
                        }
                    }
                }
                .frame(maxHeight: 320)
                .scoutOverlayScrollers()
            }
        }
        .padding(HudSpacing.lg)
        .frame(width: 360)
        .background(ScoutDesign.chrome)
    }

    private func retargetButton(_ target: ScoutNativeTerminalTarget) -> some View {
        let selected = target.id == tile.target.id
        return Button {
            guard !selected else { return }
            onRetarget(target)
            isRetargetPickerPresented = false
        } label: {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: selected ? "checkmark.circle.fill" : "arrow.right.circle")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(selected ? ScoutPalette.accent : ScoutPalette.muted)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(target.title)
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(selected ? ScoutPalette.ink : ScoutPalette.muted)
                    Text(target.subtitle)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, HudSpacing.sm)
            .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(selected ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(selected)
    }

    private var retargetBackends: [String] {
        let preferredOrder = ["tmux", "zellij", "herdr"]
        return Array(Set(retargetTargets.map(\.backendLabel))).sorted { lhs, rhs in
            let left = preferredOrder.firstIndex(of: lhs) ?? preferredOrder.count
            let right = preferredOrder.firstIndex(of: rhs) ?? preferredOrder.count
            return left == right ? lhs < rhs : left < right
        }
    }

    private var terminalBackground: Color {
        colorScheme == .dark ? Color.black.opacity(0.24) : ScoutSurface.inset
    }
}

private struct ScoutNativeTerminalDragPreview: View {
    static let size = CGSize(width: 220, height: 112)
    static let cursorOffset = CGPoint(x: 92, y: 42)

    @ObservedObject var tile: ScoutNativeTerminalTile
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(ScoutPalette.dim)
                HudStatusDot(
                    color: tile.isRunning ? ScoutPalette.statusOk : ScoutPalette.statusWarn,
                    size: 6,
                    pulses: false
                )
                Text(tile.target.title)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.xs)
                ScoutTerminalBackendBadge(tile.target.backendLabel)
            }
            .frame(height: 34)
            .padding(.horizontal, HudSpacing.md)
            .background(ScoutSurface.control)

            Rectangle()
                .fill(colorScheme == .dark ? Color.black.opacity(0.82) : ScoutSurface.inset)
                .overlay(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(ScoutPalette.accent.opacity(0.22))
                        .frame(width: 118, height: 3)
                        .padding(HudSpacing.lg)
                }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutPalette.accent.opacity(0.58), lineWidth: HudStrokeWidth.standard)
        )
        .opacity(0.92)
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
            ScoutTerminalDragPayload.itemProvider(.attachTarget(target.id))
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
        Text(label.lowercased())
            .font(HudFont.mono(HudTextSize.micro, weight: .medium))
            .tracking(0.1)
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
    var disabled = false
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
        .disabled(disabled)
        .opacity(disabled ? 0.38 : 1)
        .scoutPointerCursor()
        .onHover { hovering = disabled ? false : $0 }
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

private struct ScoutHerdrSessionsPayload: Decodable, Sendable {
    var sessions: [ScoutHerdrSessionRecord]
}

private struct ScoutHerdrSessionRecord: Decodable, Sendable {
    var name: String
    var running: Bool
    var isDefault: Bool

    private enum CodingKeys: String, CodingKey {
        case name
        case running
        case isDefault = "default"
    }
}

struct ScoutNativeTerminalTarget: Identifiable, Hashable, Sendable {
    var id: String
    var title: String
    var subtitle: String
    var backendLabel: String
    var commandLabel: String
    var attachCommand: [String]
    var workingDirectoryPath: String
    var isRegistryBacked: Bool

    fileprivate init(session: ScoutTerminalSessionRecord, surface: ScoutTerminalSurfaceRecord) {
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
        } else if mode == "zellij" {
            let session = "scout-local-\(index)"
            attachCommand = ["zellij", "attach", "--create", session]
            title = index == 1 ? "zellij" : "zellij \(index)"
            subtitle = "\(session) · \(Self.shortPath(home))"
            backendLabel = "zellij"
            commandLabel = "zellij"
        } else if mode == "herdr" {
            let session = "scout-local-\(index)"
            attachCommand = ["herdr", "--session", session]
            title = index == 1 ? "herdr" : "herdr \(index)"
            subtitle = "\(session) · \(Self.shortPath(home))"
            backendLabel = "herdr"
            commandLabel = "herdr"
        } else {
            attachCommand = [shellPath, "-l"]
            title = index == 1 ? "Local shell" : "Local shell \(index)"
            subtitle = "\(shellPath) · \(Self.shortPath(home))"
            backendLabel = "pty"
            commandLabel = shellPath
        }

        let id = mode == "herdr"
            ? "herdr-session-scout-local-\(index)"
            : "local-shell-\(UUID().uuidString)"
        return ScoutNativeTerminalTarget(
            id: id,
            title: title,
            subtitle: subtitle,
            backendLabel: backendLabel,
            commandLabel: commandLabel,
            attachCommand: attachCommand,
            workingDirectoryPath: home,
            isRegistryBacked: false
        )
    }

    static func discoverHerdrSessions() async -> [ScoutNativeTerminalTarget] {
        guard let executableURL = commandURL("herdr") else { return [] }
        do {
            let result = try await CommandRunner.run(
                CommandDescriptor(
                    executableURL: executableURL,
                    arguments: ["session", "list", "--json"]
                ),
                timeout: 2
            )
            guard result.exitCode == 0,
                  let data = result.stdout.data(using: .utf8),
                  let payload = try? JSONDecoder().decode(ScoutHerdrSessionsPayload.self, from: data)
            else { return [] }

            let home = ProcessInfo.processInfo.environment["HOME"]
                .flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
            return payload.sessions.map { session in
                ScoutNativeTerminalTarget(
                    id: "herdr-session-\(session.name)",
                    title: session.isDefault ? "herdr default" : session.name,
                    subtitle: "\(session.running ? "RUNNING" : "RESTORABLE") · herdr session",
                    backendLabel: "herdr",
                    commandLabel: session.isDefault ? "herdr" : "herdr session attach \(session.name)",
                    attachCommand: session.isDefault
                        ? ["herdr"]
                        : ["herdr", "session", "attach", session.name],
                    workingDirectoryPath: home,
                    isRegistryBacked: true
                )
            }
        } catch {
            return []
        }
    }

    fileprivate static func commandAvailable(_ command: String) -> Bool {
        commandURL(command) != nil
    }

    private static func commandURL(_ command: String) -> URL? {
        let environmentPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let directories = environmentPath.split(separator: ":").map(String.init)
            + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
        for directory in Array(Set(directories)).sorted() {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent(command)
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
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
        } else if let resolvedURL = Self.commandURL(executable) {
            executableURL = resolvedURL
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
        let backend = surface.backend.lowercased()
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
    #if HUDSON_TERMINAL
    @ObservedObject var workspaceStore: ScoutTerminalWorkspaceStore
    @ObservedObject var model: ScoutTerminalWebTabsModel
    #endif

    var body: some View {
        #if HUDSON_TERMINAL
        if let renderer {
            ScoutTerminalTabbedWebContent(
                renderer: renderer,
                workspaceStore: workspaceStore,
                model: model
            )
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
    @AppStorage(ScoutTerminalSettings.fontFamilyKey) private var fontFamily = ScoutTerminalSettings.defaultFontFamily
    @AppStorage(ScoutTerminalSettings.fontSizeKey) private var fontSize = ScoutTerminalSettings.defaultFontSize
    @State private var reloadToken = UUID()

    private var url: URL {
        scoutTerminalEmbedURL(
            colorScheme: colorScheme,
            cacheBuster: reloadToken.uuidString,
            fontFamily: fontFamily,
            fontSize: fontSize
        )
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
    @ObservedObject var workspaceStore: ScoutTerminalWorkspaceStore
    @ObservedObject var model: ScoutTerminalWebTabsModel
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(ScoutTerminalSettings.fontFamilyKey) private var fontFamily = ScoutTerminalSettings.defaultFontFamily
    @AppStorage(ScoutTerminalSettings.fontSizeKey) private var fontSize = ScoutTerminalSettings.defaultFontSize
    @State private var dropTargeted = false
    @State private var showAttachPicker = false
    private let showTileHeaders = true

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutTerminalWorkspaceBar(
                store: workspaceStore,
                tileCount: model.tabs.count,
                persistenceNote: "kept while Scout runs"
            )
            terminalBody
        }
        .background(ScoutDesign.bg)
        .task {
            await model.loadTerminalContext()
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
                of: ScoutTerminalDragPayload.attachTypes,
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
                                fontFamily: fontFamily,
                                fontSize: fontSize,
                                reloadToken: tab.reloadToken,
                                isSelected: model.selectedTabID == tab.id,
                                showHeader: showTileHeaders,
                                onSelect: { model.select(tab) },
                                projectDestinations: model.projectDestinations,
                                onSendLine: { model.sendLine($0, to: tab) },
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
                        of: ScoutTerminalDragPayload.attachTypes,
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
        let fontFamily: String
        let fontSize: Double
        let reloadToken: UUID
        let isSelected: Bool
        let showHeader: Bool
        let onSelect: () -> Void
        let projectDestinations: [ScoutTerminalProjectDestination]
        let onSendLine: (String) -> Void
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
                    cacheBuster: reloadToken.uuidString,
                    fontFamily: fontFamily,
                    fontSize: fontSize
                ),
                onSelect: onSelect,
                projectDestinations: projectDestinations,
                onSendLine: onSendLine,
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
        ScoutTerminalDragPayload.load(
            from: providers,
            acceptedTypes: ScoutTerminalDragPayload.attachTypes
        ) { payload in
            guard case .attachTarget(let id) = payload else { return }
            if model.attachTarget(id: id) {
                dropTargeted = false
                showAttachPicker = false
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
    let projectDestinations: [ScoutTerminalProjectDestination]
    let onSendLine: (String) -> Void
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
            ScoutTerminalEmbedHost(
                url: url,
                reloadToken: tab.reloadToken,
                command: tab.command,
                onRetry: onReload
            )
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

            if tab.acceptsProjectDestinations, !projectDestinations.isEmpty {
                projectDestinationMenu
            }

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

    private var projectDestinationMenu: some View {
        Menu {
            ForEach(projectDestinations) { destination in
                Button {
                    onSendLine(destination.cdCommand)
                } label: {
                    Text("\(destination.title) — \(ScoutNativeTerminalTarget.shortPath(destination.root))")
                }
            }
        } label: {
            HStack(spacing: HudSpacing.xxs) {
                Image(systemName: "folder")
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text("cd")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                Image(systemName: "chevron.down")
                    .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: true, vertical: false)
        .help("Change this shell to a known project directory")
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
            Text(title)
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .tracking(0.1)
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

struct ScoutTerminalWebTab: Identifiable, Equatable {
    let id: String
    var title: String
    var subtitle: String
    var badge: String
    var icon: String
    var routePath: String
    var acceptsProjectDestinations: Bool
    var reloadToken = UUID()
    var command: ScoutTerminalWebCommand?
}

struct ScoutTerminalProjectDestination: Identifiable, Hashable {
    let id: String
    let title: String
    let root: String

    var cdCommand: String {
        if root.hasPrefix("~/") {
            let remainder = String(root.dropFirst(2)).replacingOccurrences(of: "'", with: "'\\''")
            return "cd -- ~/'\(remainder)'"
        }
        return "cd -- '\(root.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}

private struct ScoutTerminalProjectSnapshot: Decodable {
    struct Context: Decodable {
        let currentDirectory: String
    }

    struct Project: Decodable {
        let id: String
        let title: String
        let root: String
    }

    let context: Context
    let projects: [Project]
}

struct ScoutTerminalWebAttachTarget: Identifiable, Hashable {
    var id: String
    var title: String
    var subtitle: String
    var routePath: String

    fileprivate init(session: ScoutTerminalSessionRecord, surface: ScoutTerminalSurfaceRecord) {
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
            ScoutTerminalDragPayload.itemProvider(.attachTarget(target.id))
        }
        .help(target.subtitle)
    }
}

@MainActor
final class ScoutTerminalWebTabsModel: ObservableObject {
    @Published private(set) var tabs: [ScoutTerminalWebTab] = []
    @Published var selectedTabID: String?
    @Published private(set) var attachTargets: [ScoutTerminalWebAttachTarget] = []
    @Published private(set) var projectDestinations: [ScoutTerminalProjectDestination] = []
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
            routePath: route,
            acceptsProjectDestinations: agent == "shell"
        ))
    }

    func attach(_ target: ScoutTerminalWebAttachTarget) {
        appendOrSelect(ScoutTerminalWebTab(
            id: "attach-\(target.id)",
            title: target.title,
            subtitle: target.subtitle,
            badge: "attach",
            icon: "link",
            routePath: target.routePath,
            acceptsProjectDestinations: false
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

    func sendLine(_ line: String, to tab: ScoutTerminalWebTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tabs[index].command = ScoutTerminalWebCommand(line: line)
        selectedTabID = tab.id
    }

    func loadTerminalContext() async {
        async let targets: Void = loadAttachTargets()
        async let projects: Void = loadProjectDestinations()
        _ = await (targets, projects)
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

    private func loadProjectDestinations() async {
        do {
            let url = ScoutWeb.url(path: "/api/agent-config/snapshot")
                ?? ScoutWeb.baseURL().appending(path: "api/agent-config/snapshot")
            let snapshot = try await ScoutHTTP.fetch(ScoutTerminalProjectSnapshot.self, from: url)
            let currentDirectory = snapshot.context.currentDirectory
            let currentProject = snapshot.projects
                .filter { project in
                    currentDirectory == project.root || currentDirectory.hasPrefix(project.root + "/")
                }
                .max { $0.root.count < $1.root.count }
            var ordered = snapshot.projects
            if let currentProject,
               let index = ordered.firstIndex(where: { $0.id == currentProject.id }) {
                ordered.insert(ordered.remove(at: index), at: 0)
            }
            var seenRoots = Set<String>()
            projectDestinations = ordered.compactMap { project in
                let root = project.root.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !root.isEmpty,
                      !root.contains("\n"),
                      !root.contains("\r"),
                      seenRoots.insert(root).inserted else {
                    return nil
                }
                return ScoutTerminalProjectDestination(
                    id: project.id,
                    title: project.title,
                    root: root
                )
            }
        } catch {
            projectDestinations = []
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
                Text(option.title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.1)
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
    cacheBuster: String? = nil,
    fontFamily: String = ScoutTerminalSettings.defaultFontFamily,
    fontSize: Double = ScoutTerminalSettings.defaultFontSize
) -> URL {
    let base = ScoutWeb.url(path: "/embed/terminal")
        ?? ScoutWeb.baseURL().appending(path: "embed/terminal")
    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
        return base
    }

    var items = components.queryItems ?? []
    items.removeAll { ["route", "profile", "terminalFontFamily", "terminalFontSize", "_cb"].contains($0.name) }
    items.append(URLQueryItem(name: "route", value: routePath))
    items.append(URLQueryItem(name: "profile", value: "macos.terminal"))
    items.append(URLQueryItem(name: "terminalFontFamily", value: fontFamily))
    items.append(URLQueryItem(name: "terminalFontSize", value: String(format: "%.1f", fontSize)))
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
    var command: ScoutTerminalWebCommand? = nil
    let onRetry: () -> Void

    @State private var phase: ScoutTerminalEmbedLoadPhase = .loading

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutTerminalEmbedWebView(
                url: url,
                reloadToken: reloadToken,
                command: command,
                phase: $phase
            )
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
    let command: ScoutTerminalWebCommand?
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
        if let command, context.coordinator.lastCommandID != command.id {
            context.coordinator.pendingCommand = command
        }
        let needsLoad = context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken
        guard needsLoad else {
            context.coordinator.dispatchPendingCommand(in: webView)
            return
        }
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
        var lastCommandID: UUID?
        var pendingCommand: ScoutTerminalWebCommand?

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
                        self.markReady(url, in: webView)
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + self.renderPollInterval) {
                        self.waitForTerminalRender(in: webView, url: url, token: token)
                    }
                }
            }
        }

        private func markReady(_ url: URL, in webView: WKWebView) {
            guard readyURL != url else { return }
            readyURL = url
            setPhase(.ready)
            dispatchPendingCommand(in: webView)
        }

        func dispatchPendingCommand(in webView: WKWebView) {
            guard readyURL == currentURL,
                  let command = pendingCommand,
                  lastCommandID != command.id,
                  let data = try? JSONSerialization.data(
                    withJSONObject: command.line,
                    options: [.fragmentsAllowed]
                  ),
                  let lineLiteral = String(data: data, encoding: .utf8) else {
                return
            }
            pendingCommand = nil
            lastCommandID = command.id
            let script = "window.dispatchEvent(new CustomEvent('scout:terminal-send-line',{detail:{line:\(lineLiteral)}}))"
            webView.evaluateJavaScript(script, completionHandler: nil)
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
    let command: ScoutTerminalWebCommand?
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
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.1)
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
