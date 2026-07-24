import SwiftUI
import HudsonUI
import HudsonUIWeb
import ScoutCapabilities

/// A native conversation route opened explicitly from the Deck composer. The
/// client is the exact host client resolved from the selected lane.
private struct LaneConversationRoute: Hashable, Identifiable {
    let id: String
    let client: any ScoutBrokerClient
    let conversationId: String
    let title: String

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
/// A native iPad host for Scout Web's purpose-built mission-control embeds.
/// The web app remains the single implementation of Lanes and Dispatch; iOS
/// supplies connection provenance, loading state, and a contained retry path.
struct MissionControlSurface: View {
    enum Kind: String, Equatable {
        case lanes = "Lanes"
        case deck = "Deck"
        case dispatch = "Dispatch"

        var embedPath: String {
            switch self {
            case .lanes: return "/embed/agent-lanes"
            case .deck: return "/embed/agent-lanes"
            case .dispatch: return "/embed/dispatch"
            }
        }

        var localSurface: ScoutWebSurfaceBridge.Surface {
            switch self {
            case .lanes: return .lanes
            case .deck: return .lanes
            case .dispatch: return .dispatch
            }
        }

        var assetDirectory: String {
            switch self {
            case .deck: return "WebSurfaces/deck"
            case .lanes, .dispatch: return "WebSurfaces/\(localSurface.rawValue)"
            }
        }

        var isDeck: Bool { self == .deck }
    }

    let model: AppModel
    let kind: Kind
    let isActive: Bool

    @State private var webState = HudWebViewState()
    @State private var reloadGeneration = 0
    @State private var localBridge: ScoutWebSurfaceBridge
    @State private var laneRoute: LaneConversationRoute?
    @State private var laneSelection: ScoutLaneSelection?
    @State private var selectedMachineIds: Set<String>
    @State private var followsAllHosts = true
    @State private var composerText = ""
    @State private var composerError: String?
    @State private var isSending = false
    @StateObject private var entrance = CockpitEntrancePhase()
    @FocusState private var composerFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    init(model: AppModel, kind: Kind, isActive: Bool) {
        self.model = model
        self.kind = kind
        self.isActive = isActive
        let initialMachineIds = Set(
            model.webSurfaceMachines().filter(\.isOnline).map(\.machineId)
        )
        _selectedMachineIds = State(initialValue: initialMachineIds)
        _localBridge = State(initialValue: ScoutWebSurfaceBridge(
            model: model,
            surface: kind.localSurface,
            selectedMachineIds: kind.isDeck ? initialMachineIds : nil
        ))
    }

    private var usesLocalBundledPage: Bool {
        // Deck's native host picker and composer depend on the signed page's
        // bridge messages. A host-served Lanes page cannot drive those native
        // controls, so Deck always uses its bundled surface in every build.
        if kind.isDeck { return true }
        #if DEBUG
        // Bundled pages are the normal iPad development path. Keep the old
        // host-served page available only as an explicit troubleshooting
        // escape hatch while the adapter-backed renderer migration continues.
        ProcessInfo.processInfo.environment["SCOUT_REMOTE_WEB_SURFACES"] != "1"
        #else
        false
        #endif
    }

    private var webActivity: HudWebViewActivity {
        guard scenePhase == .active else { return .background }
        return isActive ? .visible : .hiddenWarm
    }

    private var sourceURL: URL? {
        // Re-resolve on connection changes: `webAccessHost` is nil while the
        // bridge handshake settles, and keep-alive mounting evaluates this long
        // before that. Reading `connectionState` subscribes the surface so the
        // embed appears once the route lands (previously the surface only
        // mounted on tap, when everything was already warm).
        _ = model.connectionState
        guard let base = model.missionControlURL(path: kind.embedPath),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "nativeReload", value: String(reloadGeneration))]
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
                .cockpitEntrance(index: 0, phase: entrance)
            Group {
                // Create each WKWebView lazily on first activation, then leave it
                // mounted and warm across every subsequent tab switch.
                if !entrance.hasEntered {
                    Color.clear
                } else if usesLocalBundledPage {
                    HudWebSurface(
                        HudWebSurfaceDescriptor(
                            id: "scout.ios.\(kind.rawValue.lowercased())",
                            title: kind.rawValue,
                            location: .bundled(
                                directory: kind.assetDirectory,
                                readAccessDirectory: "WebSurfaces"
                            ),
                            lifecycle: .keepWarm
                        ),
                        state: $webState,
                        configuration: HudWebViewConfiguration(
                            allowsBackForwardNavigationGestures: false,
                            allowsJavaScript: true,
                            customUserAgent: "Scout-iPad/1 LocalSurface",
                            usesNonPersistentDataStore: true,
                            isInspectable: false
                        ),
                        integration: localBridge.integration,
                        activity: webActivity
                    )
                    .id(reloadGeneration)
                    .overlay {
                        if let message = webState.errorMessage {
                            unavailable(title: "Couldn’t load local \(kind.rawValue)", detail: message)
                        }
                    }
                } else if let sourceURL {
                    HudWebSurface(
                        HudWebSurfaceDescriptor(
                            id: "scout.ios.\(kind.rawValue.lowercased())",
                            title: kind.rawValue,
                            location: .paired(sourceURL),
                            lifecycle: .keepWarm
                        ),
                        state: $webState,
                        configuration: HudWebViewConfiguration(
                            allowsBackForwardNavigationGestures: true,
                            allowsJavaScript: true,
                            customUserAgent: "Scout-iPad/1 MissionControl",
                            usesNonPersistentDataStore: false,
                            isInspectable: true
                        )
                    )
                    .id(reloadGeneration)
                    .overlay {
                        if let message = webState.errorMessage {
                            unavailable(title: "Couldn’t load \(kind.rawValue)", detail: message)
                        }
                    }
                } else {
                    unavailable(
                        title: "\(kind.rawValue) unavailable",
                        detail: "Connect this iPad to a paired Mac over LAN or Tailnet."
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HudPalette.bg)
            .cockpitEntrance(index: 1, phase: entrance)
            if kind.isDeck {
                deckComposer
                    .cockpitEntrance(index: 2, phase: entrance)
            }
        }
        .task(id: isActive) {
            await entrance.reveal(when: isActive, animated: !reduceMotion)
        }
        .onAppear {
            installLaneSelectionHandler(on: localBridge)
            if kind.isDeck { reconcileHostSelection() }
        }
        .onChange(of: model.fleetRevision) { _, _ in
            if kind.isDeck { reconcileHostSelection() }
        }
        .navigationDestination(item: $laneRoute) { route in
            ConversationSurface(
                client: route.client,
                conversationId: route.conversationId,
                title: route.title,
                onClose: { laneRoute = nil }
            )
        }
    }

    @ViewBuilder
    private var toolbar: some View {
        if kind.isDeck {
            deckToolbar
        } else {
            standardToolbar
        }
    }

    private var standardToolbar: some View {
        HStack(spacing: HudSpacing.md) {
            HudSectionLabel(kind.rawValue, tint: ScoutInk.muted)
            if usesLocalBundledPage {
                Text("LOCAL · SIGNED")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(HudPalette.accent)
            } else if let host = sourceURL?.host {
                Text(host.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.md)
            if webState.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(HudPalette.accent)
            }
            Button("Reload") {
                webState = HudWebViewState()
                reloadGeneration += 1
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .foregroundStyle(HudPalette.accent)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    // The Deck header reads as a fleet host bank: a restrained identity line
    // (DECK · host count · local/signed provenance · loading · reload) over a
    // horizontally scrolling bank of instrument host cells. Utility controls stay
    // muted so the emerald signal is reserved for connection/selection state.
    private var deckToolbar: some View {
        VStack(spacing: 0) {
            HStack(spacing: HudSpacing.md) {
                HudSectionLabel("Deck", tint: ScoutInk.muted)
                deckHostCount
                if usesLocalBundledPage {
                    Text("LOCAL · SIGNED")
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(ScoutInk.dim)
                }
                Spacer(minLength: HudSpacing.md)
                if webState.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(HudPalette.accent)
                }
                Button("Reload") { reloadSurface() }
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutInk.muted)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.top, HudSpacing.sm)
            .padding(.bottom, HudSpacing.xs)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    deckHostCell(
                        label: "ALL",
                        selected: followsAllHosts,
                        online: !onlineMachineIds.isEmpty
                    ) {
                        applyHostSelection(onlineMachineIds, followsAll: true)
                    }
                    ForEach(webSurfaceMachines, id: \.machineId) { machine in
                        deckHostCell(
                            label: machine.name,
                            selected: selectedMachineIds.contains(machine.machineId),
                            online: machine.isOnline
                        ) {
                            toggleHost(machine)
                        }
                    }
                }
                .padding(.horizontal, HudSpacing.xxl)
                .padding(.bottom, HudSpacing.sm)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    // Real count only: the number of hosts currently in the union scope. The
    // number carries ink weight; the noun recedes — no accent decoration.
    private var deckHostCount: some View {
        HStack(spacing: 3) {
            Text("\(selectedMachineIds.count)")
                .foregroundStyle(HudPalette.ink)
            Text(selectedMachineIds.count == 1 ? "HOST" : "HOSTS")
                .foregroundStyle(ScoutInk.dim)
        }
        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
        .tracking(0.5)
    }

    // One host cell in the fleet bank. Squared instrument geometry (not a generic
    // capsule) on a neutral graphite plane. The dot signals connection; the
    // emerald edge + lifted inset fill signal union membership; offline hosts stay
    // visible but clearly unavailable.
    private func deckHostCell(
        label: String,
        selected: Bool,
        online: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Circle()
                    .fill(online ? HudPalette.accent : ScoutInk.dim)
                    .frame(width: 5, height: 5)
                Text(label.uppercased())
                    .lineLimit(1)
                if !online {
                    Text("OFFLINE")
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(ScoutInk.dim)
                }
            }
            .font(HudFont.mono(HudTextSize.xxs, weight: selected ? .bold : .medium))
            .tracking(0.45)
            .foregroundStyle(selected ? HudPalette.ink : ScoutInk.muted)
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.xs + 1)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(selected ? ScoutSurface.inset : ScoutSignalSurface.top)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(
                        selected ? HudPalette.accent.opacity(0.55) : ScoutSignalSurface.edge.opacity(0.55),
                        lineWidth: HudStrokeWidth.thin
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!online)
        .opacity(online ? 1 : 0.5)
    }

    // The selected-lane command dock: a lifted graphite region that makes the
    // routing target unmistakable before send. Compact when idle, growing modestly
    // for a multi-line draft. Route/host/lane problems surface as actionable copy
    // in the error strip (see ScoutDeckSendError), never raw roster diagnostics.
    private var deckComposer: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            deckTargetReadout

            if let composerError {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle()
                        .fill(HudPalette.statusError)
                        .frame(width: 5, height: 5)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                    Text(composerError)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.statusError)
                        .lineLimit(2)
                }
            }

            HStack(alignment: .bottom, spacing: HudSpacing.md) {
                TextField(deckComposerPlaceholder, text: $composerText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...3)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.ink)
                    .tint(HudPalette.accent)
                    .focused($composerFocused)
                    .onSubmit(sendDeckMessage)
                    .disabled(laneSelection?.conversationId == nil || isSending)
                    .padding(.vertical, HudSpacing.xs)

                Button(action: sendDeckMessage) {
                    Group {
                        if isSending {
                            ProgressView().controlSize(.small)
                        } else {
                            Glyphic.arrow(.top, size: 17)
                        }
                    }
                    .foregroundStyle(canSendDeckMessage ? HudPalette.bg : ScoutInk.muted)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(canSendDeckMessage ? HudPalette.accent : ScoutSurface.raised))
                }
                .buttonStyle(.plain)
                .disabled(!canSendDeckMessage)
            }
            .padding(.leading, HudSpacing.lg)
            .padding(.trailing, HudSpacing.sm)
            .padding(.vertical, HudSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(
                        composerFocused ? HudPalette.accent.opacity(0.58) : HudHairline.standard,
                        lineWidth: HudStrokeWidth.standard
                    )
            )
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.md)
        .background(
            LinearGradient(
                colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .top) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    // Target identity is always legible before send. Agent identity carries the
    // larger mono weight; host recedes; a live/absent conversation signal and the
    // Open thread escape sit at the edges. The empty state calmly instructs.
    @ViewBuilder
    private var deckTargetReadout: some View {
        HStack(spacing: HudSpacing.sm) {
            Circle()
                .fill(laneSelection?.conversationId == nil ? ScoutInk.dim : HudPalette.accent)
                .frame(width: 6, height: 6)

            if let laneSelection {
                Text(laneSelection.agentName.uppercased())
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .layoutPriority(1)
                Text("·")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.dim)
                Text(laneSelection.hostName.uppercased())
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .tracking(0.4)
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                if laneSelection.conversationId == nil {
                    Text("NO THREAD")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(ScoutInk.dim)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(ScoutSurface.inset))
                }
            } else {
                Text("SELECT A LANE TO DIRECT A MESSAGE")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }

            Spacer(minLength: HudSpacing.md)

            if laneSelection?.conversationId != nil {
                Button("Open thread", action: openSelectedLane)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutInk.muted)
                    .buttonStyle(.plain)
            }
        }
    }

    private var webSurfaceMachines: [AppModel.WebSurfaceMachine] {
        model.webSurfaceMachines()
    }

    private var onlineMachineIds: Set<String> {
        Set(webSurfaceMachines.filter(\.isOnline).map(\.machineId))
    }

    private var deckComposerPlaceholder: String {
        guard let laneSelection else { return "Select a lane above…" }
        guard laneSelection.conversationId != nil else { return "This lane cannot receive messages yet." }
        return "Message \(laneSelection.agentName)…"
    }

    private var canSendDeckMessage: Bool {
        laneSelection?.conversationId != nil
            && !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSending
    }

    private func installLaneSelectionHandler(on bridge: ScoutWebSurfaceBridge) {
        bridge.onLaneSelection = { selection in
            guard kind.isDeck else {
                if kind == .lanes,
                   let selection,
                   let conversationId = selection.conversationId,
                   !conversationId.isEmpty {
                    laneRoute = LaneConversationRoute(
                        id: "\(selection.hostId)::\(selection.agentId)::\(conversationId)",
                        client: selection.client,
                        conversationId: conversationId,
                        title: selection.agentName
                    )
                }
                return
            }
            let previousKey = laneSelection.map { "\($0.machineId)::\($0.agentId)::\($0.conversationId ?? "")" }
            let nextKey = selection.map { "\($0.machineId)::\($0.agentId)::\($0.conversationId ?? "")" }
            if previousKey != nextKey {
                composerText = ""
                composerFocused = false
            }
            laneSelection = selection
            composerError = nil
        }
    }

    private func toggleHost(_ machine: AppModel.WebSurfaceMachine) {
        guard machine.isOnline else { return }
        var next = selectedMachineIds
        if next.contains(machine.machineId) {
            guard next.count > 1 else { return }
            next.remove(machine.machineId)
        } else {
            next.insert(machine.machineId)
        }
        applyHostSelection(next, followsAll: next == onlineMachineIds)
    }

    private func reconcileHostSelection() {
        let online = onlineMachineIds
        var next = followsAllHosts ? online : selectedMachineIds.intersection(online)
        if next.isEmpty, let firstOnline = webSurfaceMachines.first(where: \.isOnline)?.machineId {
            next.insert(firstOnline)
        }
        let nextFollowsAll = followsAllHosts || next == online
        guard next != selectedMachineIds || nextFollowsAll != followsAllHosts else { return }
        applyHostSelection(next, followsAll: nextFollowsAll)
    }

    private func applyHostSelection(_ next: Set<String>, followsAll: Bool) {
        guard next != selectedMachineIds || followsAll != followsAllHosts else { return }
        selectedMachineIds = next
        followsAllHosts = followsAll
        laneSelection = nil
        laneRoute = nil
        composerText = ""
        composerError = nil
        composerFocused = false

        let bridge = ScoutWebSurfaceBridge(
            model: model,
            surface: kind.localSurface,
            selectedMachineIds: kind.isDeck ? next : nil
        )
        localBridge = bridge
        installLaneSelectionHandler(on: bridge)
        reloadSurface()
    }

    private func reloadSurface() {
        laneSelection = nil
        laneRoute = nil
        composerError = nil
        composerFocused = false
        webState = HudWebViewState()
        reloadGeneration += 1
    }

    private func openSelectedLane() {
        guard let selection = laneSelection,
              let conversationId = selection.conversationId,
              !conversationId.isEmpty
        else { return }
        laneRoute = LaneConversationRoute(
            id: "\(selection.hostId)::\(selection.agentId)::\(conversationId)",
            client: selection.client,
            conversationId: conversationId,
            title: selection.agentName
        )
    }

    private func sendDeckMessage() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let selection = laneSelection, !text.isEmpty, !isSending else { return }
        composerText = ""
        composerError = nil
        isSending = true
        Task {
            do {
                _ = try await localBridge.sendLaneMessage(text, to: selection)
                isSending = false
            } catch {
                composerText = text
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                isSending = false
            }
        }
    }

    private func unavailable(title: String, detail: String) -> some View {
        HudEmptyState(title: title, subtitle: detail, icon: "rectangle.connected.to.line.below")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.xxl)
            .background(HudPalette.bg)
    }
}
