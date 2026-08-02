import SwiftUI
import HudsonUI
import HudsonUIWeb
import ScoutCapabilities
import WebKit

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
            case .deck: return .deck
            case .dispatch: return .dispatch
            }
        }

        var assetDirectory: String {
            switch self {
            case .deck: return "WebSurfaces/deck"
            case .lanes, .dispatch: return "WebSurfaces/\(localSurface.rawValue)"
            }
        }

        /// Whether this kind's bundled page actually renders the fleet's data.
        /// Deck ships its own app and Lanes mounts the firehose renderer, so both
        /// draw real work. Dispatch's bundle mounts only the shared local-surface
        /// shell with no renderer attached, so it can never draw the broker feed —
        /// only a scaffold card. Until that bundle carries a renderer, the paired
        /// host's `/embed/dispatch` is the sole real Dispatch on iPad.
        var localSurfaceRendersFleetData: Bool {
            switch self {
            case .deck, .lanes: return true
            case .dispatch: return false
            }
        }

        var isDeck: Bool { self == .deck }
    }

    /// A single, honest way forward out of a degraded surface. Pairing problems
    /// get Connect; a page that failed to load gets Retry. Never both, never a
    /// dead-end sentence.
    private struct SurfaceRecovery {
        let title: String
        let icon: String
        let run: () -> Void
    }

    /// A real steer destination: an agent the paired Mac reports, carrying the
    /// broker conversation the message lands in. Agents whose `conversationId`
    /// is absent never enter this list — a target that cannot receive is not a
    /// target, and offering one would be an affordance with nothing behind it.
    private struct SteerTarget: Identifiable, Equatable {
        let id: String
        let name: String
        let project: String?
        let conversationId: String
        let needsAttention: Bool
        let lastActiveAt: Date?
    }

    let model: AppModel
    let kind: Kind
    let isActive: Bool
    let onOpenLanes: (() -> Void)?
    let onOpenDeck: (() -> Void)?
    let onConnect: (() -> Void)?
    /// Hands a draft to the New surface, which owns session creation end to end.
    /// Dispatch's create affordance routes there rather than growing a second
    /// creation path beside it.
    let onCompose: ((NewSessionSeed) -> Void)?

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
    /// Dispatch's steer dock: the agents that can actually receive, and the one
    /// this draft is addressed to.
    @State private var steerTargets: [SteerTarget] = []
    @State private var steerTargetId: String?
    @State private var steerNotice: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.scoutLayout) private var layout

    init(
        model: AppModel,
        kind: Kind,
        isActive: Bool,
        onOpenLanes: (() -> Void)? = nil,
        onOpenDeck: (() -> Void)? = nil,
        onConnect: (() -> Void)? = nil,
        onCompose: ((NewSessionSeed) -> Void)? = nil
    ) {
        self.model = model
        self.kind = kind
        self.isActive = isActive
        self.onOpenLanes = onOpenLanes
        self.onOpenDeck = onOpenDeck
        self.onConnect = onConnect
        self.onCompose = onCompose
        let initialMachineIds = Set(
            model.webSurfaceMachines().filter(\.isOnline).map(\.machineId)
        )
        _selectedMachineIds = State(initialValue: initialMachineIds)
        _localBridge = State(initialValue: ScoutWebSurfaceBridge(
            model: model,
            surface: kind.localSurface,
            selectedMachineIds: kind.isDeck ? initialMachineIds : nil,
            enablesDeckControls: kind.isDeck
        ))
    }

    private var usesLocalBundledPage: Bool {
        // A bundled page only earns the surface when it renders the fleet's real
        // work. Dispatch's bundle has no renderer behind the shell, so choosing it
        // would put scaffolding where the broker feed belongs — the paired host's
        // embed is the only real Dispatch, in every build.
        guard kind.localSurfaceRendersFleetData else { return false }
        // Deck's native host picker and composer depend on the signed page's
        // bridge messages. A host-served Lanes page cannot drive those native
        // controls, so Deck always uses its bundled surface in every build.
        if kind.isDeck { return true }
        #if DEBUG
        // Bundled pages are the normal iPad development path. Keep the old
        // host-served page available only as an explicit troubleshooting
        // escape hatch while the adapter-backed renderer migration continues.
        return ProcessInfo.processInfo.environment["SCOUT_REMOTE_WEB_SURFACES"] != "1"
        #else
        return false
        #endif
    }

    private var webActivity: ScoutWebViewActivity {
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
                    ScoutIntegratedWebSurface(
                        source: .bundled(
                            directory: kind.assetDirectory,
                            readAccessDirectory: "WebSurfaces"
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
                            unavailable(
                                title: "Couldn’t load \(kind.rawValue)",
                                detail: message,
                                recovery: retryRecovery
                            )
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
                            unavailable(
                                title: "Couldn’t reach \(kind.rawValue)",
                                detail: message,
                                recovery: hasOnlinePairedMac ? retryRecovery : connectRecovery
                            )
                        }
                    }
                } else {
                    unavailable(
                        title: "\(kind.rawValue) needs a paired Mac",
                        detail: "This view reads live work from a Mac on your LAN or Tailnet.",
                        recovery: connectRecovery
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(ScoutPalette.bg)
            .cockpitEntrance(index: 1, phase: entrance)

            // The feed reads; the dock acts. Dispatch is where you watch the
            // fleet's traffic, so the reply belongs at its foot rather than a
            // surface away.
            if kind == .dispatch {
                steerDock
                    .cockpitEntrance(index: 2, phase: entrance)
            }
        }
        .task(id: isActive) {
            await entrance.reveal(when: isActive, animated: !reduceMotion)
        }
        .task(id: steerRosterKey) {
            await loadSteerTargets()
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
            ScoutSectionLabel(kind.rawValue, tint: ScoutInk.muted)
            if usesLocalBundledPage {
                // Provenance, not signal: emerald stays reserved for connection
                // and selection state, the same rationing Deck's header uses.
                Text("LOCAL · SIGNED")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
            } else if let host = sourceURL?.host {
                Text(host.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.md)
            if kind == .lanes, let onOpenDeck {
                missionControlLink("Open Deck", glyph: .dispatch, action: onOpenDeck)
            }
            // Steering an agent already at work and starting a new one are the
            // two moves this surface implies. The dock does the first; this
            // hands the second — with whatever is drafted — to the New surface.
            if kind == .dispatch, onCompose != nil {
                missionControlLink("New", glyph: .plus, action: startNewSession)
            }
            if webState.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(ScoutPalette.accent)
            }
            Button("Reload") {
                webState = HudWebViewState()
                reloadGeneration += 1
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            // Muted, matching Deck's header — utility controls recede so the
            // accent is free for the connection and selection state the feed
            // below actually reports.
            .foregroundStyle(ScoutInk.muted)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    // The Deck header reads as a fleet host bank: a restrained identity line
    // (DECK · host count · local/signed provenance · loading · reload) over a
    // horizontally scrolling bank of instrument host cells. Utility controls stay
    // muted so the emerald signal is reserved for connection/selection state.
    private var deckToolbar: some View {
        VStack(spacing: 0) {
            HStack(spacing: HudSpacing.md) {
                ScoutSectionLabel("Deck", tint: ScoutInk.muted)
                deckHostCount
                if usesLocalBundledPage {
                    Text("LOCAL · SIGNED")
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(ScoutInk.dim)
                }
                Spacer(minLength: HudSpacing.md)
                if let onOpenLanes {
                    missionControlLink("Lanes", glyph: .lanes, action: onOpenLanes)
                }
                if webState.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(ScoutPalette.accent)
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
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    /// A header action, in this toolbar's own grammar: the glyph in the shared
    /// `Glyphic` family, the label in the same mono/micro/semibold face as
    /// `Reload` sitting beside it, muted ink, no plate.
    ///
    /// What this replaced was a tinted capsule — emerald text on an emerald wash
    /// inside an emerald rim — invented here and used nowhere else in the app.
    /// It broke two house rules at once. It was a NEW shape in a row that already
    /// had an action grammar (`Reload`, one line away, is a plain text button),
    /// and it spent the surface's one accent on navigation. The masthead
    /// complications state the rule outright: "Never the accent." A control that
    /// takes you somewhere is not a signal, and the brightest thing on a screen
    /// full of live delivery states should not be a link.
    ///
    /// One helper, so Lanes' "Open Deck", Deck's "Lanes" and Dispatch's "New" are
    /// visibly the same kind of thing.
    private func missionControlLink(
        _ title: String,
        glyph: GlyphShape.Kind,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Glyphic(kind: glyph, size: 13)
                Text(title.uppercased())
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .tracking(0.45)
            .foregroundStyle(ScoutInk.muted)
            .padding(.vertical, HudSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    // Real count only: the number of hosts currently in the union scope. The
    // number carries ink weight; the noun recedes — no accent decoration.
    private var deckHostCount: some View {
        HStack(spacing: 3) {
            Text("\(selectedMachineIds.count)")
                .foregroundStyle(ScoutPalette.ink)
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
                    .fill(online ? ScoutPalette.accent : ScoutInk.dim)
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
            .foregroundStyle(selected ? ScoutPalette.ink : ScoutInk.muted)
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.xs + 1)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(selected ? ScoutSurface.inset : ScoutSignalSurface.top)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(
                        selected ? ScoutPalette.accent.opacity(0.55) : ScoutSignalSurface.edge.opacity(0.55),
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
                        .fill(ScoutPalette.statusError)
                        .frame(width: 5, height: 5)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                    Text(composerError)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.statusError)
                        .lineLimit(2)
                }
            }

            HStack(alignment: .bottom, spacing: HudSpacing.md) {
                TextField(deckComposerPlaceholder, text: $composerText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...3)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutPalette.ink)
                    .tint(ScoutPalette.accent)
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
                    .foregroundStyle(canSendDeckMessage ? ScoutPalette.bg : ScoutInk.muted)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(canSendDeckMessage ? ScoutPalette.accent : ScoutSurface.raised))
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
                        composerFocused ? ScoutPalette.accent.opacity(0.58) : ScoutHairline.standard,
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
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    // Target identity is always legible before send. Agent identity carries the
    // larger mono weight; host recedes; a live/absent conversation signal and the
    // Open thread escape sit at the edges. The empty state calmly instructs.
    @ViewBuilder
    private var deckTargetReadout: some View {
        HStack(spacing: HudSpacing.sm) {
            Circle()
                .fill(laneSelection?.conversationId == nil ? ScoutInk.dim : ScoutPalette.accent)
                .frame(width: 6, height: 6)

            if let laneSelection {
                Text(laneSelection.agentName.uppercased())
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
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

    // MARK: - Dispatch steer dock

    /// The reply to the feed. Same composer component as Home's front door, the
    /// New dock, and every conversation — pill idiom, one line at rest — held to
    /// the iPad reading measure so it reads as furniture on the desk rather than
    /// a stretched phone field. The target readout sits above it, because who a
    /// message is addressed to must be legible before it is sent.
    private var steerDock: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            steerTargetPicker
            ScoutMessageComposer(
                text: $composerText,
                placeholder: steerPlaceholder,
                rows: 1,
                onSend: sendSteerMessage,
                canSend: canSteer,
                sending: isSending,
                disabled: steerTargets.isEmpty,
                error: composerError,
                notice: steerNotice.map { ScoutComposerNotice($0) },
                density: .compact,
                appearance: .pill
            )
        }
        .frame(maxWidth: layout.contentWidth, alignment: .leading)
        .frame(maxWidth: .infinity)
        .padding(.top, HudSpacing.sm)
        .padding(.bottom, HudSpacing.sm)
        .background(
            LinearGradient(
                colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .top) {
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    /// Addressing is a pick from what the Mac reports, never a free-text field:
    /// the app can only deliver to a conversation it already knows about, so the
    /// picker offers exactly those and nothing more.
    private var steerTargetPicker: some View {
        Menu {
            ForEach(steerTargets) { target in
                Button {
                    steerTargetId = target.id
                    steerNotice = nil
                    composerError = nil
                } label: {
                    Text(steerMenuLabel(target))
                }
            }
        } label: {
            // The runtime chip's seat — card fill, hairline rim, trailing
            // chevron — which is the app's settled grammar for "a token you tap
            // to change what this composer is pointed at". Home's accessory
            // pills name it as such, and the composer's own model token wears it
            // two rows below. A bare dot-and-caption, which is what this was,
            // reads as a status line: it said who the message was addressed to
            // without saying that you could change it.
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(
                    color: steerTarget == nil ? ScoutInk.dim : ScoutPalette.accent,
                    size: 5
                )
                Text(steerTargetLabel)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .tracking(0.45)
                    .foregroundStyle(steerTarget == nil ? ScoutInk.muted : ScoutPalette.ink)
                    .lineLimit(1)
                if let project = steerTarget?.project {
                    Text(project.uppercased())
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(ScoutInk.dim)
                        .lineLimit(1)
                }
                if !steerTargets.isEmpty {
                    Glyphic.chevron(.bottom, size: 9)
                        .foregroundStyle(ScoutInk.dim)
                }
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, 3)
            .background(steerSeat.fill(ScoutSurface.card))
            .overlay(steerSeat.stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
            .contentShape(steerSeat)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .disabled(steerTargets.isEmpty)
        .accessibilityLabel("Steer target")
    }

    /// A real capsule at this height, matching the runtime chip's resting shape.
    private var steerSeat: Capsule { Capsule(style: .continuous) }

    private var steerTarget: SteerTarget? {
        guard let steerTargetId else { return nil }
        return steerTargets.first { $0.id == steerTargetId }
    }

    private var steerTargetLabel: String {
        if let steerTarget { return steerTarget.name.uppercased() }
        return steerTargets.isEmpty ? "NO CONVERSATION TO STEER YET" : "CHOOSE AN AGENT"
    }

    private var steerPlaceholder: String {
        guard !steerTargets.isEmpty else { return "Nothing to steer from this Mac yet." }
        guard let steerTarget else { return "Choose an agent to steer…" }
        return "Steer \(steerTarget.name)…"
    }

    private var canSteer: Bool {
        steerTarget != nil
            && !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSending
    }

    private func steerMenuLabel(_ target: SteerTarget) -> String {
        var label = target.name
        if let project = target.project, !project.isEmpty { label += " · \(project)" }
        if target.needsAttention { label += " · needs you" }
        return label
    }

    /// Reload whenever the surface becomes the page or the fleet changes shape.
    private var steerRosterKey: String {
        "\(kind.rawValue)|\(isActive)|\(model.fleetRevision)"
    }

    /// One real broker read — the same `listAgents` call Home and the shell
    /// counters make. Attention first, then recency: the agents an operator
    /// reaches for, not a roster.
    private func loadSteerTargets() async {
        guard kind == .dispatch, isActive else { return }
        guard let rows = try? await model.client.listAgents(query: nil, limit: 200) else { return }
        let targets = rows
            .compactMap { agent -> SteerTarget? in
                guard let conversationId = agent.conversationId, !conversationId.isEmpty else { return nil }
                return SteerTarget(
                    id: agent.id,
                    name: agent.title,
                    project: agent.projectName,
                    conversationId: conversationId,
                    needsAttention: agent.needsAttention,
                    lastActiveAt: agent.lastActiveAt
                )
            }
            .sorted { lhs, rhs in
                if lhs.needsAttention != rhs.needsAttention { return lhs.needsAttention }
                return (lhs.lastActiveAt ?? .distantPast) > (rhs.lastActiveAt ?? .distantPast)
            }
        steerTargets = Array(targets.prefix(12))
        if let steerTargetId, !steerTargets.contains(where: { $0.id == steerTargetId }) {
            self.steerTargetId = nil
        }
    }

    /// The same write the conversation surface makes: `mobile/comms/send` into a
    /// real conversation id. A recoverable delivery is reported as such — the
    /// message is recorded, the routing needs another move — and a thrown error
    /// gives the draft back rather than swallowing it.
    private func sendSteerMessage() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let target = steerTarget, !text.isEmpty, !isSending else { return }
        composerText = ""
        composerError = nil
        steerNotice = nil
        isSending = true
        Task {
            do {
                let result = try await model.client.send(
                    PromptSpec(
                        conversationId: target.conversationId,
                        text: text,
                        clientMessageId: "ios-\(UUID().uuidString)"
                    )
                )
                if result.delivery?.state == .recoverable {
                    steerNotice = result.delivery?.detail ?? "Recorded, but delivery needs another move."
                } else {
                    steerNotice = "Sent to \(target.name)."
                }
                isSending = false
            } catch {
                composerText = text
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                isSending = false
            }
        }
    }

    /// The draft travels to the New surface rather than being retyped there —
    /// and leaves no copy behind that could be sent twice.
    private func startNewSession() {
        guard let onCompose else { return }
        let draft = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        composerText = ""
        composerError = nil
        steerNotice = nil
        composerFocused = false
        onCompose(NewSessionSeed(prompt: draft))
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
            selectedMachineIds: kind.isDeck ? next : nil,
            enablesDeckControls: kind.isDeck
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

    private var hasOnlinePairedMac: Bool {
        model.pairedMachines.contains(where: \.isOnline)
    }

    /// Pairing is the only thing that can fix an unreachable surface, and the app
    /// already owns that route — the same sheet Home's Connect card opens.
    private var connectRecovery: SurfaceRecovery? {
        guard let onConnect else { return nil }
        return SurfaceRecovery(title: "Connect", icon: "link", run: onConnect)
    }

    private var retryRecovery: SurfaceRecovery {
        SurfaceRecovery(title: "Retry", icon: "arrow.clockwise", run: reloadSurface)
    }

    /// The degraded state stays honest: it never draws a stand-in feed, it names
    /// what is missing, and it carries the one action that can resolve it.
    private func unavailable(
        title: String,
        detail: String,
        recovery: SurfaceRecovery? = nil
    ) -> some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "macbook.and.iphone")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(ScoutInk.dim)
                .accessibilityHidden(true)
            Text(title)
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(ScoutInk.muted)
                .multilineTextAlignment(.center)
            Text(detail)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutInk.dim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            if let recovery {
                Button(action: recovery.run) {
                    HStack(spacing: HudSpacing.xs) {
                        Image(systemName: recovery.icon)
                        Text(recovery.title)
                    }
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.bg)
                    .padding(.horizontal, HudSpacing.lg)
                    .padding(.vertical, HudSpacing.sm)
                    .background(Capsule().fill(ScoutPalette.accent))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(recovery.title)
                .padding(.top, HudSpacing.xs)
            }
        }
        .padding(HudSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutPalette.bg)
    }
}

// MARK: - App-owned WebKit integration

/// The signed Deck needs WebKit reply handlers and lifecycle callbacks that are
/// intentionally app-specific today. Keeping this adapter beside the iPad host
/// avoids coupling OpenScout's privileged bridge contract to HudsonUIWeb's
/// simpler general-purpose web view.
enum ScoutWebViewActivity: String {
    case visible
    case hiddenWarm
    case background
}

struct ScoutWebViewUserScript {
    let source: String
}

@MainActor
final class ScoutWebViewReply {
    private var completion: (@MainActor (Any?, String?) -> Void)?

    init(completion: @escaping @MainActor (Any?, String?) -> Void) {
        self.completion = completion
    }

    func succeed(_ value: Any?) {
        guard let completion else { return }
        self.completion = nil
        completion(value, nil)
    }

    func fail(_ message: String) {
        guard let completion else { return }
        self.completion = nil
        completion(nil, message)
    }
}

struct ScoutWebViewMessageHandler {
    let name: String
    let receive: @MainActor (Any, ScoutWebViewReply) -> Void

    init(name: String, receive: @escaping @MainActor (Any, ScoutWebViewReply) -> Void) {
        self.name = name
        self.receive = receive
    }
}

@MainActor
final class ScoutWebViewIntegration {
    let userScripts: [ScoutWebViewUserScript]
    let messageHandlers: [ScoutWebViewMessageHandler]
    let onActivityChange: (ScoutWebViewActivity) -> Void
    let onReset: (String) -> Void
    let onOpenExternalURL: (URL) -> Void

    init(
        userScripts: [ScoutWebViewUserScript],
        messageHandlers: [ScoutWebViewMessageHandler],
        onActivityChange: @escaping (ScoutWebViewActivity) -> Void,
        onReset: @escaping (String) -> Void,
        onOpenExternalURL: @escaping (URL) -> Void
    ) {
        self.userScripts = userScripts
        self.messageHandlers = messageHandlers
        self.onActivityChange = onActivityChange
        self.onReset = onReset
        self.onOpenExternalURL = onOpenExternalURL
    }
}

enum ScoutIntegratedWebSource: Equatable {
    case bundled(directory: String, readAccessDirectory: String)
}

struct ScoutIntegratedWebSurface: UIViewRepresentable {
    let source: ScoutIntegratedWebSource
    @Binding var state: HudWebViewState
    let configuration: HudWebViewConfiguration
    let integration: ScoutWebViewIntegration
    let activity: ScoutWebViewActivity

    func makeCoordinator() -> Coordinator {
        Coordinator(state: $state, integration: integration, activity: activity)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = configuration.allowsJavaScript
        if configuration.usesNonPersistentDataStore {
            webConfiguration.websiteDataStore = .nonPersistent()
        }
        for script in integration.userScripts {
            webConfiguration.userContentController.addUserScript(
                WKUserScript(source: script.source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        for handler in integration.messageHandlers {
            webConfiguration.userContentController.addScriptMessageHandler(
                context.coordinator,
                contentWorld: .page,
                name: handler.name
            )
        }

        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = context.coordinator
        apply(configuration, to: webView)
        context.coordinator.load(source, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.state = $state
        context.coordinator.update(activity: activity)
        apply(configuration, to: webView)
        context.coordinator.load(source, in: webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.tearDown(webView)
    }

    private func apply(_ configuration: HudWebViewConfiguration, to webView: WKWebView) {
        webView.allowsBackForwardNavigationGestures = configuration.allowsBackForwardNavigationGestures
        webView.customUserAgent = configuration.customUserAgent
        webView.scrollView.backgroundColor = .clear
        webView.isOpaque = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = configuration.isInspectable
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
        var state: Binding<HudWebViewState>
        private let integration: ScoutWebViewIntegration
        private var activity: ScoutWebViewActivity
        private var loadedSource: ScoutIntegratedWebSource?
        private let handlers: [String: ScoutWebViewMessageHandler]

        init(
            state: Binding<HudWebViewState>,
            integration: ScoutWebViewIntegration,
            activity: ScoutWebViewActivity
        ) {
            self.state = state
            self.integration = integration
            self.activity = activity
            self.handlers = Dictionary(uniqueKeysWithValues: integration.messageHandlers.map { ($0.name, $0) })
            super.init()
            integration.onActivityChange(activity)
        }

        func load(_ source: ScoutIntegratedWebSource, in webView: WKWebView) {
            guard loadedSource != source else { return }
            loadedSource = source
            state.wrappedValue.errorMessage = nil

            switch source {
            case .bundled(let directory, let readAccessDirectory):
                guard let indexURL = Bundle.main.url(
                    forResource: "index",
                    withExtension: "html",
                    subdirectory: directory
                ), let resourceURL = Bundle.main.resourceURL else {
                    publish(webView, loading: false, errorMessage: "Signed Deck assets are missing from this build.")
                    return
                }
                let readAccessURL = resourceURL.appendingPathComponent(readAccessDirectory, isDirectory: true)
                webView.loadFileURL(indexURL, allowingReadAccessTo: readAccessURL)
            }
        }

        func update(activity next: ScoutWebViewActivity) {
            guard activity != next else { return }
            activity = next
            integration.onActivityChange(next)
        }

        func tearDown(_ webView: WKWebView) {
            for name in handlers.keys {
                webView.configuration.userContentController.removeScriptMessageHandler(forName: name, contentWorld: .page)
            }
            webView.stopLoading()
            webView.navigationDelegate = nil
            integration.onReset("dismantled")
            loadedSource = nil
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping @MainActor (Any?, String?) -> Void
        ) {
            guard let handler = handlers[message.name] else {
                replyHandler(nil, "unsupported_handler")
                return
            }
            handler.receive(message.body, ScoutWebViewReply(completion: replyHandler))
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            publish(webView, loading: true, errorMessage: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            publish(webView, loading: false, errorMessage: nil)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            publish(webView, loading: false, errorMessage: error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            publish(webView, loading: false, errorMessage: error.localizedDescription)
        }

        private func publish(_ webView: WKWebView, loading: Bool, errorMessage: String?) {
            state.wrappedValue = HudWebViewState(
                title: webView.title,
                url: webView.url,
                isLoading: loading,
                estimatedProgress: webView.estimatedProgress,
                canGoBack: webView.canGoBack,
                canGoForward: webView.canGoForward,
                errorMessage: errorMessage
            )
        }
    }
}
