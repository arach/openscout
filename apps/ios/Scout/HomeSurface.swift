import SwiftUI
import Foundation
import PhotosUI
import UniformTypeIdentifiers
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore

/// Home — the ambient fleet dashboard. A faithful native port of the
/// `Scout Mobile.html` canvas: a compact vitals strip with a live sparkline, an
/// attention band (Needs you), the Working strip, the broker Activity log, the
/// recent terminal readout, the "Ask the fleet" composer, and a compact running
/// TAIL as the last scroll section — everything in one flow that runs through
/// behind the crown chrome (no protected bottom zone).
///
/// Home section toggles — the "choose your own adventure" switches. Read
/// directly via @AppStorage in both `HomeSurface` (gating) and the Settings
/// HOME panel (the controls). Vitals/Working/Activity default ON; Terminals
/// and Tail are opt-in modules.
enum ScoutHomeSection {
    static let vitalsKey = "scout.home.sec.vitals"
    static let workingKey = "scout.home.sec.working"
    static let activityKey = "scout.home.sec.activity"
    static let terminalsKey = "scout.home.sec.terminals"
    static let tailKey = "scout.home.sec.tail"
}

/// Which front door Home presents. `.fleet` is the shipped dashboard (every
/// section above, unchanged); `.entry` is the composer-first treatment ported
/// from the studio (design/studio/components/scout-ios/entry-surface.tsx): the
/// phone is for STEERING, the Mac is for monitoring — air, whisper recents, and
/// the composer at thumb height. Attention deliberately does NOT live here: the
/// masthead bell and the Notifications ledger own it, and the fleet dashboard
/// keeps its Needs-you lane. Opt-in; the dashboard stays the default. Switched
/// in Settings → Home.
enum ScoutHomeStyle: String, CaseIterable {
    case fleet
    case entry

    var title: String {
        switch self {
        case .fleet: return "Fleet"
        case .entry: return "Entry"
        }
    }

    static let storageKey = "scout.home.style"
    static let `default`: ScoutHomeStyle = .fleet

    static func resolve(_ raw: String?) -> ScoutHomeStyle {
        ScoutHomeStyle(rawValue: raw ?? "") ?? .default
    }
}

/// Data provenance: Needs you / Working / Activity / the sparkline / the tail
/// are real broker reads. The dock opens the real New-session composer.
struct HomeSurface: View {
    let model: AppModel
    let motionEnabled: Bool
    let identityEnabled: Bool
    let isActive: Bool
    @Environment(\.scoutLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var onConversationStatusContext: (String?) -> Void = { _ in }
    var onSeeAllAgents: () -> Void = {}
    var onSeeAllActivity: () -> Void = {}
    /// Opens the Notifications destination — the ledger this lane is the live
    /// tip of. See `NotificationsSurface`.
    var onSeeAllNotifications: () -> Void = {}
    var onCompose: (NewSessionSeed) -> Void = { _ in }
    var onConnect: () -> Void = {}
    var reloadToken: Int = 0

    @State private var agents: [HomeAgent] = []
    @State private var isLoading = true
    @State private var route: HomeConversationRoute?
    @State private var routeClient: (any ScoutBrokerClient)?
    @State private var activity: [HomeActivity] = []
    @State private var agentsScopeKey: String?
    @State private var activityScopeKey: String?
    @State private var lastActivityReadFailed = false
    @State private var tailEvents: [TailEvent] = []
    @State private var tailLoaded = false
    @State private var tailIsFetching = false
    @StateObject private var entrance = CockpitEntrancePhase()
    @State private var askDraft = ""
    /// Entry only: the recent conversations the whisper lane reads from (the
    /// same list the Comms tab shows). Not fetched in the fleet dashboard.
    @State private var conversations: [HomeConversation] = []
    /// Entry only: whether the dock should be holding the keyboard. Starts up
    /// (composing IS the resting posture) and drops when the operator dismisses
    /// it; re-arms whenever Home becomes the page again.
    @State private var entryKeyboardRequested = true
    /// Entry only: the dock's REAL focus, reported by the composer. The
    /// accessory line rides this, not the request above, so tapping back into
    /// the field after a dismiss brings the line back with the keyboard.
    @State private var entryComposerFocused = false
    /// The runtime the ask will start on — SHARED by both front doors, because
    /// both now compose on `ScoutMessageComposer` with the runtime chip in its
    /// tools slot. A real creation-time choice: it rides the seed onto
    /// `SessionInitiationSpec.Execution`.
    @State private var askHarnessId = ComposerModelHarness.catalog[0].id
    @State private var askFamilyId = ComposerModelHarness.catalog[0].defaultFamily.id
    @State private var askEffortId = ComposerEffortOption.defaultId
    @State private var askRuntimeCatalog: RuntimeCapabilityCatalog? = ComposerRuntimeCatalogCache.load()
    @State private var showAskModelPicker = false
    /// Attachments staged on the front door, handed to New with the prompt (the
    /// paperclip is real — see `NewSessionSeed`). Shared, as above.
    @State private var askAttachments: [ScoutComposerAttachment] = []
    @State private var askPhotoItems: [PhotosPickerItem] = []
    @State private var showAskPhotoPicker = false
    @State private var showAskFileImporter = false
    @AppStorage(ScoutHomeStyle.storageKey) private var homeStyleRaw = ScoutHomeStyle.default.rawValue
    // Modular home sections (see ScoutHomeSection) — each switch gates its
    // section's rendering below; the tail switch also gates its 5s fetch.
    @AppStorage(ScoutHomeSection.vitalsKey) private var vitalsEnabled = true
    @AppStorage(ScoutHomeSection.workingKey) private var workingEnabled = true
    @AppStorage(ScoutHomeSection.activityKey) private var activityEnabled = true
    @AppStorage(ScoutHomeSection.terminalsKey) private var terminalsEnabled = false
    @AppStorage(ScoutHomeSection.tailKey) private var tailEnabled = false

    private enum HomeConversationRoute: Hashable, Identifiable {
        case session(id: String, title: String)
        case comms(CommsConversation)

        var id: String {
            switch self {
            case .session(let id, _): return "session:\(id)"
            case .comms(let conversation): return "comms:\(conversation.id)"
            }
        }
    }

    private var filterKey: String {
        switch model.machineFilter {
        case .all: return "all"
        case .machine(let id): return id
        }
    }

    private var reloadKey: String {
        "\(reloadToken).\(model.fleetRevision).\(filterKey)"
    }

    private var homeStyle: ScoutHomeStyle { ScoutHomeStyle.resolve(homeStyleRaw) }

    var body: some View {
        Group {
            switch homeStyle {
            case .fleet: fleetSurface
            case .entry: entrySurface
            }
        }
        // The composer plumbing lives HERE, not on either front door: both now
        // compose on `ScoutMessageComposer` with the same runtime chip and the
        // same paperclip, and the runtime panel has to be hosted by a container
        // that ENCLOSES the chip — that container is the coordinate space the
        // chip's anchor is read in.
        .scoutRuntimePicker(
            isPresented: $showAskModelPicker,
            harnesses: askRuntimeHarnesses,
            efforts: askRuntimeEfforts,
            harnessId: $askHarnessId,
            familyId: $askFamilyId,
            effortId: $askEffortId
        )
        .photosPicker(isPresented: $showAskPhotoPicker, selection: $askPhotoItems, maxSelectionCount: 8, matching: .images)
        .onChange(of: askPhotoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addAskPhotos(items) }
        }
        .fileImporter(isPresented: $showAskFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            addAskFiles(result)
        }
        #if DEBUG
        // Sim verification hook, sibling to RootView's `SCOUT_OPEN_VITALS` /
        // `SCOUT_OPEN_SETTINGS`: the runtime panel is a touch-only state, so
        // `SCOUT_OPEN_RUNTIME=1` opens it on launch and a headless capture can
        // photograph the real thing instead of a preview of it. Never ships in
        // release behavior.
        .onAppear {
            guard ProcessInfo.processInfo.environment["SCOUT_OPEN_RUNTIME"] == "1" else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(600))
                showAskModelPicker = true
            }
        }
        #endif
        // The style is part of the key: flipping to Entry has to go fetch the
        // whisper lane's conversations, which the dashboard never reads.
        .task(id: "\(reloadKey)|\(isActive)|\(homeStyleRaw)") {
            guard isActive else { return }
            await load()
            guard reloadToken != 0 else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                guard route == nil else { continue }
                await load()
            }
        }
        // The tail runs on the Tail surface's faster cadence — Home's own 30s
        // reload would leave it feeling stale. Skipped entirely while the tail
        // module is switched off (no fetch for a hidden section).
        .task(id: "tail|\(tailEnabled)|\(reloadKey)|\(isActive)") {
            guard isActive, tailEnabled, homeStyle == .fleet else { return }
            await fetchTail()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                guard route == nil else { continue }
                await fetchTail()
            }
        }
        .navigationDestination(item: $route) { route in
            switch route {
            case .session(let id, let title):
                ConversationSurface(
                    client: routeClient ?? model.client,
                    conversationId: id,
                    title: title,
                    onClose: { self.route = nil },
                    onStatusContextChange: onConversationStatusContext
                )
            case .comms(let conversation):
                CommsThreadView(
                    client: routeClient ?? model.client,
                    conversation: conversation,
                    onClose: { self.route = nil },
                    onRead: { _ = try? await (routeClient ?? model.client).markConversationRead(conversationId: conversation.id) }
                )
            }
        }
    }

    private var fleetSurface: some View {
        ScrollView {
            // Pin the column to a DEFINITE lane width, left-aligned, with a trailing
            // Spacer absorbing any surplus. This forces rows to truncate within the
            // lane (instead of the column inflating to its widest row and dragging
            // everything off the right edge) AND keeps it left-anchored (instead of
            // getting centered). The Spacer eats any inflation and clips harmlessly.
            HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                if isLoading {
                    HomeLoadingSkeleton()
                        .transition(.opacity)
                } else if showsQuietFleetEmblem {
                    quietFleetEmblem
                        .cockpitEntrance(index: 1, phase: entrance, motionEnabled: motionEnabled)
                } else {
                    if vitalsEnabled {
                        FleetVitals(
                            live: liveAgents.count,
                            samples: activityPulseSamples,
                            motionEnabled: instrumentMotionIsActive
                        )
                        .cockpitEntrance(index: 0, phase: entrance, motionEnabled: motionEnabled)
                    }
                    needsYouSection
                        .cockpitEntrance(index: 1, phase: entrance, motionEnabled: motionEnabled)
                    if workingEnabled {
                        workingSection
                            .cockpitEntrance(index: 2, phase: entrance, motionEnabled: motionEnabled)
                    }
                    // The one WRITE lane, above the read-only logs. Low enough
                    // that the attention lanes still open the page, high enough
                    // to clear the fold — the old position put it under an
                    // Activity lane that can run the length of the screen, so on
                    // a busy fleet you never saw it at all. It also needs room
                    // ABOVE it: the runtime panel grows upward out of its chip.
                    askSection
                        .cockpitEntrance(index: 3, phase: entrance, motionEnabled: motionEnabled)
                    if activityEnabled, !recentActivity.isEmpty || lastActivityReadFailed {
                        activitySection
                            .cockpitEntrance(index: 4, phase: entrance, motionEnabled: motionEnabled)
                    }
                    if isNotConnected {
                        notConnectedState
                            .cockpitEntrance(index: 4, phase: entrance, motionEnabled: motionEnabled)
                    }
                    if terminalsEnabled, !model.recentTerminals.isEmpty {
                        terminalsSection
                            .cockpitEntrance(index: 5, phase: entrance, motionEnabled: motionEnabled)
                    }
                    if tailEnabled {
                        tailSection
                            .cockpitEntrance(index: 6, phase: entrance, motionEnabled: motionEnabled)
                    }
                }
            }
            .frame(width: laneWidth, alignment: .leading)
            Spacer(minLength: 0)
            }
            .padding(.leading, layout.surfacePadding)
            .padding(.top, layout.surfaceTopPadding)
            .padding(.bottom, HudSpacing.md)
        }
        .animation(.easeOut(duration: 0.22), value: isLoading)
        .refreshable { if isActive { await load() } }
    }

    // MARK: - Entry (composer-first)

    /// The composer-first front door. The resting body is AIR, then the whisper
    /// of recents, then the composer — nothing that asks to be read. Attention
    /// is not duplicated here (it lives in the masthead bell / Notifications and
    /// in the fleet dashboard), so the front door never opens with a headline
    /// you have to process before you can type.
    private var entrySurface: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
                    if isNotConnected { notConnectedState }
                }
                // `contentWidth`/`contentInset`, not `laneWidth`/`surfacePadding`:
                // at regular width the working column stops at the readable
                // measure and centres, so the Connect card is a card and not a
                // banner across the whole desk. Identical on every phone width.
                .frame(width: layout.contentWidth, alignment: .leading)
                .padding(.horizontal, layout.contentInset)
                // The studio's 44px breath under the masthead, minus what the
                // shipped masthead already leaves below its rule.
                .padding(.top, HudSpacing.huge)
                // Content or not, the lane has to claim the space above the
                // recents — that emptiness IS the design, and it keeps the
                // pull-to-refresh gesture alive on a calm fleet.
                .frame(maxWidth: .infinity, minHeight: 1, alignment: .leading)
            }
            .refreshable { if isActive { await load() } }
            .scrollDismissesKeyboard(.interactively)
            entryRecents
            entryDock
            entryAccessoryLine
        }
        .animation(.easeOut(duration: 0.22), value: isLoading)
        .onChange(of: isActive) { _, active in
            // Coming back to Home re-arms the composing posture; leaving hands
            // the keyboard back so it can't hover over another surface.
            entryKeyboardRequested = active
        }
    }

    /// Recent conversations as a WHISPER — the composer is the page, recency is
    /// just the shortest path back. Several turns you could pick up again, kept
    /// the quietest thing on screen: muted name, dim preview, dim mono age.
    @ViewBuilder
    private var entryRecents: some View {
        let rows = Array(conversations.prefix(5))
        VStack(spacing: 0) {
            ForEach(rows) { row in
                Button {
                    routeClient = row.client
                    route = .comms(row.conversation)
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                        Text(row.conversation.title)
                            .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(1)
                            .layoutPriority(1)
                        Text(row.conversation.lastMessagePreview ?? "")
                            .font(HudFont.ui(11.5))
                            .foregroundStyle(ScoutInk.dim)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: HudSpacing.sm)
                        if let age = relativeAgeString(row.conversation.lastMessageAt) {
                            Text(age)
                                .font(HudFont.mono(9.5))
                                .foregroundStyle(ScoutInk.dim)
                                .monospacedDigit()
                                .fixedSize()
                        }
                    }
                    .padding(.vertical, 7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(row.conversation.title), \(row.conversation.lastMessagePreview ?? "no messages")")
            }
        }
        // Same discipline as the dashboard's lanes: a DEFINITE width, so the
        // preview truncates inside the row instead of inflating the column (and
        // with it the whole surface, which shoves the masthead off-screen).
        .frame(width: max(0, layout.contentWidth - HudSpacing.xxl * 2), alignment: .leading)
        .padding(.horizontal, layout.contentInset + HudSpacing.xxl)
    }

    /// OUR line where the system's QuickType strip used to be: the smart-action
    /// steers scrolling on the left, the keyboard toggle pinned right. It is
    /// PERSISTENT — the toggle raises the keyboard as readily as it drops it,
    /// so a row that vanished with the keyboard would take its own way back
    /// with it.
    ///
    /// It is a row in this stack rather than a `.toolbar(placement: .keyboard)`
    /// — that placement merges across every mounted surface (New's "Done" lands
    /// in it) and iOS 26 renders it as glass capsules.
    @ViewBuilder
    private var entryAccessoryLine: some View {
        let actions = entrySmartActions
        if !actions.isEmpty {
            HStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    // Distinct objects, not a run of text: each steer is a
                    // capsule in the runtime chip's grammar (card fill, hairline
                    // rim) so it reads as tappable at a glance.
                    HStack(spacing: HudSpacing.md) {
                        ForEach(actions) { action in
                            Button {
                                action.run()
                                // A prefill you can't immediately type after is
                                // half an action.
                                if action.opensKeyboard { entryKeyboardRequested = true }
                            } label: {
                                Text(action.label)
                                    .font(HudFont.ui(12.5, weight: .medium))
                                    .foregroundStyle(ScoutInk.muted)
                                    .lineLimit(1)
                                    .fixedSize()
                                    .padding(.horizontal, HudSpacing.xxl)
                                    .frame(height: entryAccessoryControl)
                                    .background(Capsule().fill(ScoutSurface.card))
                                    .overlay(Capsule().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    // The rail: the first pill starts where the draft line and
                    // the attach control do.
                    .padding(.leading, HudSpacing.xxl)
                    .padding(.trailing, HudSpacing.md)
                    .frame(height: entryAccessoryRow)
                }
                // Clipped, not greedy — the pinned slot owns the right end.
                // A fade rather than an opaque plate: the canvas behind this
                // row is a gradient, so any flat plate reads as a patch.
                .frame(maxWidth: .infinity, alignment: .leading)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.86),
                            .init(color: .clear, location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                entryKeyboardToggle
            }
            .frame(width: layout.contentWidth, height: entryAccessoryRow)
            .padding(.horizontal, layout.contentInset)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(HudHairline.subtle)
                    // Compact: the rule spans the surface, as designed (a nil
                    // width takes the full proposal). Regular: it stops with the
                    // column, so it reads as the composer's shoulder instead of
                    // a divider drawn clean across the desk.
                    .frame(width: layout.isRegularWidth ? layout.contentWidth : nil, height: HudStrokeWidth.thin)
            }
        }
    }

    /// The pinned slot, marked off by a hairline on its leading edge so the
    /// scrolling steers visibly end before it.
    private var entryKeyboardToggle: some View {
        Button(action: toggleEntryKeyboard) {
            Glyphic(kind: entryComposerFocused ? .keyboardDown : .keyboardUp, size: 18)
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 44, height: entryAccessoryRow)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(HudHairline.standard)
                        .frame(width: HudStrokeWidth.thin, height: 16)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(entryComposerFocused ? "Hide keyboard" : "Show keyboard")
    }

    /// One rhythm for the row: pills and the toggle share a centre line, and
    /// the pill height matches the composer's 28pt controls.
    private var entryAccessoryRow: CGFloat { 44 }
    private var entryAccessoryControl: CGFloat { 28 }

    /// The one obvious action, as the full sandwich: the draft on its own line,
    /// then attach · runtime · mic · send. The typed text is carried to the New
    /// composer as the seeded prompt — and so is the runtime pick, which lands
    /// verbatim on `SessionInitiationSpec.Execution`.
    private var entryDock: some View {
        ScoutMessageComposer(
            text: $askDraft,
            placeholder: "Ask the fleet…",
            rows: 1,
            autoFocus: entryDockHoldsKeyboard,
            onSend: sendAskDraft,
            attach: ScoutComposerAttach(
                onPhoto: { showAskPhotoPicker = true },
                onFile: { showAskFileImporter = true }
            ),
            attachments: $askAttachments,
            // Our accessory line takes that line; two suggestion bars stacked
            // is one too many.
            predictions: false,
            onFocusChange: { focused in
                entryComposerFocused = focused
                // Mirror reality back into the request, so the toggle always
                // has a false→true edge to raise on — including after an
                // interactive scroll-dismiss that this surface never asked for.
                entryKeyboardRequested = focused
            },
            density: .lead,
            appearance: .pill
        ) {
            ScoutRuntimeChip(
                harness: askHarnessId,
                model: askFamily.value,
                effort: askEffort.label,
                isPicking: showAskModelPicker,
                onPick: {
                    // The keyboard STAYS. The panel opens upward out of the
                    // chip, which is already sitting above the keys — dropping
                    // them would move the composer out from under the operator
                    // mid-gesture, and losing the draft line is exactly what
                    // the anchored panel exists to stop.
                    showAskModelPicker.toggle()
                }
            )
        }
        // The runtime panel takes its left and right edges from the composer,
        // so the two read as one column when it opens.
        .scoutRuntimeLane()
        .frame(width: layout.contentWidth)
        .padding(.horizontal, layout.contentInset)
        // A decent distance from the whisper lane: the recents are the quietest
        // thing on screen and must not crowd the one loud one.
        .padding(.top, HudSpacing.huge)
        .padding(.bottom, HudSpacing.xl)
    }

    /// The picker is deliberately NOT in this condition: an anchored panel sits
    /// above the keyboard rather than needing the room it holds, and a composer
    /// that resigned focus to open a settings panel would drop the draft line
    /// out from under the very gesture that opened it.
    private var entryDockHoldsKeyboard: Bool {
        entryKeyboardRequested && isActive && route == nil && !isLoading
    }

    /// The trailing control is a TOGGLE: down when the keyboard is up, up when
    /// it isn't. Raising is just re-asserting the request the composer's
    /// `autoFocus` reads; the request tracks real focus, so there is always an
    /// edge to raise on.
    private func toggleEntryKeyboard() {
        if entryComposerFocused {
            dismissEntryKeyboard()
        } else {
            entryKeyboardRequested = true
        }
    }

    /// Genuinely rest the keyboard. `autoFocus` says who SHOULD hold focus, so
    /// dropping the request alone can't resign a field the operator re-tapped —
    /// the responder chain can, and the two together leave nothing to re-arm it
    /// until the operator asks.
    private func dismissEntryKeyboard() {
        entryKeyboardRequested = false
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    // MARK: Ask runtime (both front doors)

    private var askRuntimeHarnesses: [ComposerModelHarness] {
        let fetched = askRuntimeCatalog?.composerHarnesses ?? []
        return fetched.isEmpty ? ComposerModelHarness.catalog : fetched
    }

    private var askRuntimeEfforts: [ComposerEffortOption] {
        askRuntimeCatalog?.composerEfforts ?? ComposerEffortOption.catalog
    }

    private var askHarness: ComposerModelHarness {
        askRuntimeHarnesses.first { $0.id == askHarnessId } ?? askRuntimeHarnesses[0]
    }

    private var askFamily: ComposerModelFamily {
        askHarness.families.first { $0.id == askFamilyId } ?? askHarness.defaultFamily
    }

    private var askEffort: ComposerEffortOption {
        ComposerEffortOption.catalog.first { $0.id == askEffortId } ?? ComposerEffortOption.catalog[0]
    }

    // MARK: Ask attachments (both front doors)

    @MainActor
    private func addAskPhotos(_ items: [PhotosPickerItem]) async {
        defer { askPhotoItems = [] }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mediaType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? (mediaType == "image/png" ? "png" : "jpg")
            askAttachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: "photo-\(askAttachments.count + 1).\(ext)")
            )
        }
    }

    private func addAskFiles(_ result: Result<[URL], Error>) {
        guard let urls = try? result.get() else { return }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)
            let mediaType = type?.preferredMIMEType ?? "application/octet-stream"
            askAttachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: url.lastPathComponent)
            )
        }
    }

    /// The app's best guess at your next steer, derived from real state only —
    /// never canned prompts. One tap either prefills the ask or takes you to the
    /// agent that is actually waiting; the label says which. The line scrolls,
    /// so more than three real derivations can sit there.
    private var entrySmartActions: [EntrySmartAction] {
        var actions: [EntrySmartAction] = []
        for row in needsYouRows.prefix(2) {
            guard let open = tap(row) else { continue }
            actions.append(
                EntrySmartAction(
                    id: "reply:\(row.id)",
                    label: "Reply to \(row.agent.title)",
                    opensKeyboard: false,
                    run: open
                )
            )
        }
        actions.append(
            EntrySmartAction(id: "recap", label: "Catch me up") {
                askDraft = "Catch me up on what the fleet has been working on."
            }
        )
        for project in entryRecentProjects {
            actions.append(
                EntrySmartAction(id: "project:\(project)", label: "Status on \(project)") {
                    askDraft = "What's the status on \(project)?"
                }
            )
        }
        return actions
    }

    /// The projects of the most recently active agents — the ones the operator
    /// is most likely steering next.
    private var entryRecentProjects: [String] {
        var seen = Set<String>()
        return workingRows
            .compactMap { $0.agent.projectName?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
            .prefix(2)
            .map { $0 }
    }

    private var isNotConnected: Bool {
        agents.isEmpty && activity.isEmpty && !model.pairedMachines.contains(where: \.isOnline)
    }

    private var instrumentMotionIsActive: Bool { motionEnabled && !reduceMotion }

    /// The emblem is intentionally stricter than a merely sparse snapshot: the
    /// bridge must be online, every content lane empty, and Activity must have
    /// completed successfully. A failed read never masquerades as "all clear."
    private var showsQuietFleetEmblem: Bool {
        identityEnabled
            && model.pairedMachines.contains(where: \.isOnline)
            && needsYouRows.isEmpty
            // "All clear" while alerts sit unlooked-at would be a false claim —
            // and the emblem replaces every lane, including the one that leads
            // to them.
            && model.notifications.unseenCount == 0
            && workingRows.isEmpty
            && recentActivity.isEmpty
            && !lastActivityReadFailed
    }

    /// The definite width of a full-bleed lane inside the surface padding — the
    /// same width the content column is pinned to. Derived from the design frame's
    /// layout width (not a nested GeometryReader, which a greedy horizontal card
    /// ScrollView inflates), so every lane fits exactly and nothing drags the
    /// column past the screen edge.
    private var laneWidth: CGFloat { max(0, layout.designWidth - layout.surfacePadding * 2) }

    private var notConnectedState: some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "macbook.and.iphone")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(ScoutInk.muted)
            Text("Connect a Mac to bring your fleet online.")
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutInk.muted)
                .multilineTextAlignment(.center)
            Button(action: onConnect) {
                HStack(spacing: HudSpacing.xs) {
                    Image(systemName: "link")
                    Text("Connect")
                }
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(HudPalette.bg)
                .padding(.horizontal, HudSpacing.lg)
                .padding(.vertical, HudSpacing.sm)
                .background(Capsule().fill(ScoutVibe.accent))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Connect a Mac")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HudSpacing.xxl)
        .background(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .fill(ScoutVibe.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }

    private var quietFleetEmblem: some View {
        VStack(spacing: HudSpacing.lg) {
            Glyphic(kind: .home, size: 70)
                .foregroundStyle(ScoutSignalSurface.neutralSignal)
            HStack(spacing: HudSpacing.xs) {
                Rectangle()
                    .fill(ScoutVibe.accent)
                    .frame(width: 46, height: HudStrokeWidth.standard)
                Circle()
                    .fill(ScoutVibe.accent)
                    .frame(width: 3, height: 3)
            }
            Text("ALL CLEAR — THE FLEET IS QUIET.")
                .font(HudFont.mono(10.5, weight: .medium))
                .tracking(1.4)
                .foregroundStyle(ScoutInk.dim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 72)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("All clear. The fleet is quiet.")
    }

    // MARK: - Vitals

    /// Real activity sparkline: bucket loaded broker events by recency. Empty
    /// (the card hides the spark) until there are a few events to plot.
    private var activityPulseSamples: [Double] {
        let dates = activity.compactMap { ScoutTimestamp.date(fromEpoch: TimeInterval($0.event.tsMs)) }
        guard dates.count >= 3, let newest = dates.max(), let oldest = dates.min() else { return [] }
        let span = max(newest.timeIntervalSince(oldest), 1)
        let bins = 16
        var buckets = [Double](repeating: 0, count: bins)
        for date in dates {
            let t = date.timeIntervalSince(oldest) / span
            buckets[min(bins - 1, max(0, Int(t * Double(bins))))] += 1
        }
        return buckets
    }

    // MARK: - Needs you (real attention)

    /// Agents the broker has flagged as needing the operator — approvals,
    /// questions, blocks. Attention outranks everything; newest first. The band
    /// hides entirely until an agent actually needs a move (no placeholder).
    private var needsYouRows: [HomeAgent] {
        agents
            .filter { $0.agent.needsAttention }
            .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
    }

    /// Two different objects share this slot, so they don't share a name:
    /// "Needs you" is AGENT-level attention (one card per agent waiting on you,
    /// tapping into its conversation), while "Notifications" is the ledger's
    /// unread count. Calling the card lane "Notifications" implied it was the
    /// same list as the destination, which it never was — the destination is
    /// per-alert and holds history too. Either way "All →" leads to the ledger,
    /// which now records both channels (see `NotificationsStore`).
    @ViewBuilder
    private var needsYouSection: some View {
        let unseen = model.notifications.unseenCount
        if !needsYouRows.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                laneHeader(
                    "Needs you",
                    count: needsYouRows.count,
                    attention: true,
                    onAll: onSeeAllNotifications
                )
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: HudSpacing.sm) {
                        ForEach(needsYouRows) { row in
                            NeedCard(agent: row.agent, onTap: { tap(row)?() })
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(width: laneWidth, alignment: .leading)
            }
        } else if unseen > 0 {
            laneHeader(
                "Notifications",
                count: unseen,
                trailing: "unread",
                onAll: onSeeAllNotifications
            )
        }
    }

    // MARK: - Working (live)

    private var liveAgents: [HomeAgent] {
        agents
            .filter { $0.agent.state == .live }
            .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
    }

    private var hasLiveWork: Bool { !liveAgents.isEmpty }

    /// The working set: agents running a turn right now, or — on a between-turns
    /// fleet — the handful that worked most recently, so the lane reflects who's
    /// active instead of sitting empty. Rows show real ages; only genuinely live
    /// agents get the "now" pulse.
    private var workingRows: [HomeAgent] {
        if hasLiveWork { return liveAgents }
        return Array(
            agents
                .filter { $0.agent.state != .offline && $0.agent.lastActiveAt != nil }
                .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
                .prefix(6)
        )
    }

    @ViewBuilder
    private var workingSection: some View {
        // Full-width one-liners inside a recessed terminal-window well, capped:
        // the phone shows a handful, the wide canvas has room for more.
        // Selection (who's "working") is unchanged.
        let rows = Array(workingRows.prefix(layout.physicalWidth >= 700 ? 8 : 5))
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                laneHeader(hasLiveWork ? "Working" : "Recently working", count: rows.count, signal: ScoutVibe.accent)
                VStack(spacing: 0) {
                    ForEach(rows) { row in
                        WorkingRow(agent: row.agent, onTap: { tap(row)?() })
                    }
                }
                .padding(.horizontal, HudSpacing.md)
                .padding(.vertical, HudSpacing.xs)
                // The terminal well: the model picker's near-black inset track,
                // a thin edge, and darkness pooled at the top inner rim so the
                // panel reads sunk into the canvas — no drop shadow.
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(ModelPickerTone.insetFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(ModelPickerTone.insetEdge, lineWidth: HudStrokeWidth.thin)
                )
                .overlay(TerminalInsetShadow(shape: RoundedRectangle(cornerRadius: 8, style: .continuous), color: .black.opacity(0.9), radius: 2, y: 1))
                .overlay(TerminalInsetShadow(shape: RoundedRectangle(cornerRadius: 8, style: .continuous), color: .black.opacity(0.55), radius: 5, y: 0))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
    }

    // MARK: - In-flow bottom sections (Terminals, Ask, Tail)

    /// Recent terminal (harness) sessions as a row of small terminal-y wells: a
    /// metadata line (harness · session · live/age) over a CLI prompt line showing
    /// the resume command. Display-only — a truthful readout, not a fake attach.
    /// In-flow in the scroll lane now — nothing is pinned above the crown.
    private var terminalsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            laneHeader("Terminals", count: model.recentTerminals.count)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    ForEach(model.recentTerminals) { terminal in
                        TerminalTile(terminal: terminal)
                    }
                }
                .padding(.vertical, 1)
            }
            .frame(width: laneWidth, alignment: .leading)
        }
    }

    /// Ask-the-fleet — the dashboard's ONE action, and the only lane here that
    /// writes rather than reads. It is the standard `ScoutMessageComposer`, the
    /// same component the Entry front door docks and the same one the atoms page
    /// documents — not a hand-rolled field. That is what buys it the controls the
    /// old strip was missing: the runtime chip (harness · model · effort) in the
    /// tools slot, the paperclip, on-device dictation, and a send that rests
    /// visible instead of appearing only once you have typed.
    ///
    /// Named with a lane header like every other section, and raised in the
    /// scroll order (above Activity), because an unlabelled well at the bottom of
    /// a dashboard reads as a footer, not as the thing you came to do.
    ///
    /// Send still routes to the New composer rather than submitting from here —
    /// but it now carries the runtime pick and any staged attachments across on
    /// the seed, so the controls are real, not decoration.
    private var askSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            laneHeader("Ask the fleet", signal: ScoutVibe.accent)
            ScoutMessageComposer(
                text: $askDraft,
                placeholder: "Ask the fleet…",
                rows: 1,
                onSend: sendAskDraft,
                attach: ScoutComposerAttach(
                    onPhoto: { showAskPhotoPicker = true },
                    onFile: { showAskFileImporter = true }
                ),
                attachments: $askAttachments,
                density: .lead,
                appearance: .panel
            ) {
                ScoutRuntimeChip(
                    harness: askHarnessId,
                    model: askFamily.value,
                    effort: askEffort.label,
                    isPicking: showAskModelPicker,
                    onPick: { showAskModelPicker.toggle() }
                )
            }
            // The panel takes its left and right edges from the composer, so the
            // two read as one column when it opens.
            .scoutRuntimeLane()
        }
        .frame(width: laneWidth, alignment: .leading)
    }

    private var askDraftCanSend: Bool {
        !askDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendAskDraft() {
        let text = askDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        askDraft = ""
        // BOTH front doors carry the runtime the chip is showing and anything
        // staged on the paperclip. The dashboard used to name neither and fell
        // back to New's workspace default; it names both now, and a control that
        // says "opus · high" has to actually start opus · high.
        let staged = askAttachments
        askAttachments = []
        onCompose(
            NewSessionSeed(
                prompt: text,
                harnessId: askHarnessId,
                familyId: askFamilyId,
                effortId: askEffortId,
                attachments: staged
            )
        )
    }

    /// The running tail — the cross-agent event log as Home's LAST section, free
    /// to flow through behind the crown chrome. Bare rows on the canvas in the
    /// Tail surface's grammar (time · kind glyph · summary), newest at the
    /// bottom, refreshed on the same cadence as the Tail surface.
    private var tailSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            laneHeader("Tail", detail: tailDetailLabel, signal: ScoutVibe.accent)
            VStack(spacing: 0) {
                ForEach(tailEvents) { event in
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                        Text(Self.tailClockFormatter.string(from: Date(timeIntervalSince1970: Double(event.tsMs) / 1_000)))
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.dim)
                            .frame(width: 54, alignment: .leading)
                        Text(tailKindGlyph(event.kind))
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(tailKindColor(event.kind))
                            .fixedSize()
                        Text(event.summary)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(HudPalette.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, HudSpacing.xs)
                    .overlay(alignment: .bottom) {
                        HudDivider(color: HudHairline.subtle)
                    }
                }
                if tailEvents.isEmpty, tailLoaded {
                    Text("No recent events")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, HudSpacing.xs)
                }
            }
        }
    }

    private var tailDetailLabel: String? {
        guard tailLoaded else { return "loading" }
        return "live"
    }

    private static let tailClockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private func tailKindGlyph(_ kind: TailEvent.Kind) -> String {
        switch kind {
        case .user: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .toolResult: return "="
        case .system: return "~"
        case .other: return "·"
        }
    }

    private func tailKindColor(_ kind: TailEvent.Kind) -> Color {
        switch kind {
        case .user: return Color(red: 0.50, green: 0.68, blue: 0.95)
        case .assistant: return Color(red: 0.45, green: 0.78, blue: 0.55)
        case .tool: return Color(red: 0.88, green: 0.62, blue: 0.38)
        case .toolResult: return Color(red: 0.52, green: 0.72, blue: 0.70)
        case .system: return ScoutInk.muted
        case .other: return ScoutInk.dim
        }
    }

    // MARK: - Activity

    /// Preview cap — doubled from the old five so the home log carries real
    /// signal; still bounded so the lane can't run endless. The fetch (48) and
    /// retention (24) windows already cover it, so nothing upstream changes.
    private var activityPreviewCap: Int { layout.physicalWidth >= 700 ? 14 : 10 }
    private static let activityRetainedCap = 24

    private var recentActivity: [HomeActivity] { Array(activity.prefix(activityPreviewCap)) }

    private var activitySection: some View {
        // Activity reads as a bare timeline directly on the canvas — no card box —
        // so it feels like the surface's own log rather than another panel.
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            laneHeader("Activity", detail: activitySpanLabel, allLabel: "Comms", onAll: onSeeAllActivity)
            if lastActivityReadFailed {
                Text("Activity unavailable — retrying")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, HudSpacing.xs)
            }
            VStack(spacing: 0) {
                ForEach(recentActivity) { row in
                    ActivityRow(event: row.event, onOpen: tapActivity(row))
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .top).combined(with: .opacity),
                                removal: .identity
                            )
                        )
                }
            }
        }
    }

    private var activitySpanLabel: String? {
        let dates = recentActivity.compactMap { ScoutTimestamp.date(fromEpoch: TimeInterval($0.event.tsMs)) }
        guard let oldest = dates.min() else { return nil }
        return ScoutTimestamp.relativeAge(since: oldest)
    }

    // MARK: - Ask the fleet (placeholder dock)

    // MARK: - Shared chrome

    /// Lane heading in the canvas grammar: caps-mono label, a bordered count, a
    /// hairline rule filling the remaining width, and an optional trailing marker
    /// (a "preview" note, or an "All" shortcut). `attention` tints it amber.
    private func laneHeader(
        _ title: String,
        count: Int? = nil,
        detail: String? = nil,
        signal: Color? = nil,
        attention: Bool = false,
        trailing: String? = nil,
        allLabel: String = "All",
        onAll: (() -> Void)? = nil
    ) -> some View {
        let tint = attention ? ScoutVibe.amber : signal
        return HStack(spacing: HudSpacing.sm) {
            Text(title.uppercased())
                .font(HudFont.mono(10.5, weight: .medium))
                .tracking(2)
                .foregroundStyle(tint ?? ScoutInk.dim)
            if let count {
                Text("\(count)")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .foregroundStyle(tint ?? ScoutInk.muted)
                    .monospacedDigit()
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, 1.5)
                    .overlay(Capsule().stroke(tint.map(HudSurface.tintBorder) ?? ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            } else if let detail {
                Text(detail.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.8)
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
            }
            if let trailing {
                Text(trailing.uppercased())
                    .font(HudFont.mono(HudTextSize.micro - 0.5, weight: .medium))
                    .tracking(1)
                    .foregroundStyle(ScoutInk.dim)
            }
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.standard)
                .frame(maxWidth: .infinity)
            if let onAll {
                Button(action: onAll) {
                    HStack(spacing: 1) {
                        Text(allLabel).font(HudFont.mono(HudTextSize.xs, weight: .medium))
                        Glyphic.chevron(.trailing, size: 10)
                    }
                    .foregroundStyle(ScoutVibe.accent)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See \(allLabel.lowercased()) — \(title.lowercased()) continues there")
            }
        }
    }

    @ViewBuilder
    private func cardSurface<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutVibe.card))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func rowSeparator() -> some View {
        Rectangle()
            .fill(HudHairline.subtle)
            .frame(height: HudStrokeWidth.thin)
            .padding(.leading, HudSpacing.xl)
    }

    private func tap(_ row: HomeAgent) -> (() -> Void)? {
        guard let conversationId = row.agent.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !conversationId.isEmpty else { return nil }
        return {
            routeClient = row.client
            route = .session(id: conversationId, title: row.agent.title)
        }
    }

    private func tapActivity(_ row: HomeActivity) -> (() -> Void)? {
        guard let conversationId = row.event.conversationId, !conversationId.isEmpty else { return nil }
        return {
            routeClient = row.client
            route = activityRoute(for: row.event, conversationId: conversationId)
        }
    }

    private func activityRoute(for event: TailEvent, conversationId: String) -> HomeConversationRoute {
        .comms(
            CommsConversation(
                id: conversationId,
                kind: .unknown,
                title: event.source,
                participants: [event.source],
                lastMessagePreview: event.summary,
                lastMessageAuthor: event.source,
                lastMessageAt: ScoutTimestamp.date(fromEpoch: TimeInterval(event.tsMs)),
                messageCount: 0,
                unreadCount: 0
            )
        )
    }

    private func sortedActivity(_ incoming: [HomeActivity]) -> [HomeActivity] {
        var seenEventIDs = Set<String>()
        let unique = incoming
            .sorted { $0.event.tsMs > $1.event.tsMs }
            .filter { seenEventIDs.insert($0.event.id).inserted }
        return Array(unique.prefix(Self.activityRetainedCap))
    }

    // MARK: - Load

    private func load() async {
        let loadKey = reloadKey
        let scopeKey = filterKey
        let machines = model.agentMachines()
        let noReadableMachines = machines.allSatisfy { $0.client == nil }
        var freshAgents: [HomeAgent] = []
        var freshActivity: [HomeActivity] = []
        var freshConversations: [HomeConversation] = []
        var sawAgentRead = false
        var sawActivityRead = false
        var sawConversationRead = false
        var freshRuntimeCatalog: RuntimeCapabilityCatalog?
        // The whisper lane is Entry's only extra read; the dashboard never
        // pays for it.
        let readsConversations = homeStyle == .entry

        for machine in machines {
            guard let client = machine.client else { continue }
            if let rows = try? await client.listAgents(query: nil, limit: 50) {
                sawAgentRead = true
                freshAgents.append(contentsOf: rows.map { agent in
                    HomeAgent(id: "\(machine.id)::\(agent.id)", machineId: machine.id, machineName: machine.name, client: client, agent: agent)
                })
            }
            if let rows = try? await client.recentActivity(limit: 48) {
                sawActivityRead = true
                freshActivity.append(contentsOf: rows.map { event in
                    HomeActivity(id: "\(machine.id)::\(event.id)", machineId: machine.id, machineName: machine.name, client: client, event: event)
                })
            }
            if readsConversations, let rows = try? await client.listConversations(kind: nil, limit: 12) {
                sawConversationRead = true
                freshConversations.append(contentsOf: rows.map { conversation in
                    HomeConversation(id: "\(machine.id)::\(conversation.id)", client: client, conversation: conversation)
                })
            }
            // NOT gated on the style any more: the dashboard's ask lane shows
            // the same runtime chip, and a chip fed only by the static fallback
            // catalog would offer harnesses this fleet may not even have.
            if freshRuntimeCatalog == nil,
               let catalog = try? await client.runtimeCapabilities(projectRoot: nil),
               catalog.schemaVersion == "openscout.runtime-capabilities.v1" {
                freshRuntimeCatalog = catalog
            }
        }

        guard !Task.isCancelled, loadKey == reloadKey else { return }

        if let freshRuntimeCatalog {
            askRuntimeCatalog = freshRuntimeCatalog
            ComposerRuntimeCatalogCache.save(freshRuntimeCatalog)
            let harnesses = freshRuntimeCatalog.composerHarnesses
            if let selectedHarness = harnesses.first(where: { $0.id == askHarnessId }) {
                if !selectedHarness.families.contains(where: { $0.id == askFamilyId }) {
                    askFamilyId = selectedHarness.defaultFamily.id
                }
            } else if let firstHarness = harnesses.first {
                askHarnessId = firstHarness.id
                askFamilyId = firstHarness.defaultFamily.id
            }
        }

        if sawAgentRead {
            agents = freshAgents
            agentsScopeKey = scopeKey
        } else if noReadableMachines || agentsScopeKey != scopeKey {
            agents = []
            agentsScopeKey = scopeKey
        }
        if sawActivityRead {
            let updated = sortedActivity(freshActivity)
            let oldIDs = Set(activity.map(\.id))
            let previousNewest = activity.map(\.event.tsMs).max() ?? .min
            let addedNewerRow = !isLoading
                && activityScopeKey == scopeKey
                && updated.contains { !oldIDs.contains($0.id) && $0.event.tsMs > previousNewest }
            if instrumentMotionIsActive && addedNewerRow {
                withAnimation(.easeOut(duration: 0.3)) { activity = updated }
            } else {
                activity = updated
            }
            activityScopeKey = scopeKey
            lastActivityReadFailed = false
        } else if noReadableMachines || activityScopeKey != scopeKey {
            activity = []
            activityScopeKey = scopeKey
            lastActivityReadFailed = !noReadableMachines
        } else {
            // Keep a same-scope successful snapshot on screen, but make the failed
            // leg explicit. The next 30-second cycle independently retries it.
            lastActivityReadFailed = true
        }
        if sawConversationRead {
            conversations = freshConversations.sorted {
                ($0.conversation.lastMessageAt ?? .distantPast) > ($1.conversation.lastMessageAt ?? .distantPast)
            }
        } else if noReadableMachines {
            conversations = []
        }
        await model.refreshFleetStats()
        isLoading = false
        await entrance.reveal(when: isActive, animated: instrumentMotionIsActive)
    }

    /// Home's compact tail: the newest few cross-agent events across all readable
    /// machines, newest LAST so the section reads like a running log. Same merge
    /// discipline as the Tail surface, smaller window.
    private func fetchTail() async {
        guard !tailIsFetching else { return }
        tailIsFetching = true
        defer { tailIsFetching = false }

        let machines = model.agentMachines()
        var snapshot: [TailEvent] = []
        var sawRead = false
        for machine in machines {
            guard let client = machine.client else { continue }
            if let rows = try? await client.recentTail(limit: 20) {
                sawRead = true
                snapshot.append(contentsOf: rows)
            }
        }
        guard !Task.isCancelled else { return }
        guard sawRead else { return }

        let newestFirst = snapshot.sorted {
            if $0.tsMs == $1.tsMs { return $0.id > $1.id }
            return $0.tsMs > $1.tsMs
        }
        // The wide canvas has the vertical room — let the log run further down
        // toward the chrome instead of stopping short with dead canvas below.
        let cap = layout.physicalWidth >= 700 ? 16 : 8
        let next = Array(newestFirst.prefix(cap).reversed())
        if next.map(\.id) != tailEvents.map(\.id) {
            tailEvents = next
        }
        tailLoaded = true
    }
}

// MARK: - Home row provenance

private struct HomeAgent: Identifiable {
    let id: String
    let machineId: String
    let machineName: String
    let client: any ScoutBrokerClient
    let agent: AgentSummary
}

private struct HomeActivity: Identifiable {
    let id: String
    let machineId: String
    let machineName: String
    let client: any ScoutBrokerClient
    let event: TailEvent
}

/// One recent conversation behind Entry's whisper lane — the same rows the
/// Comms tab lists, carried with the client that can open them.
private struct HomeConversation: Identifiable {
    let id: String
    let client: any ScoutBrokerClient
    let conversation: CommsConversation
}

/// One steer on Entry's accessory line. `opensKeyboard` separates the two
/// shapes: a PREFILL leaves you mid-draft and should hand you the keyboard, a
/// NAVIGATION takes you somewhere else and must not.
private struct EntrySmartAction: Identifiable {
    let id: String
    let label: String
    var opensKeyboard: Bool = true
    let run: () -> Void
}

// MARK: - Needs you kind display

/// The KIND-tag label for a pending-ask. Names the *move* the operator must make.
private func needKindLabel(_ kind: PendingAsk.Kind) -> String {
    switch kind {
    case .permission: return "Permission"
    case .decision: return "Decision"
    case .confirm: return "Confirm"
    case .blocked: return "Blocked"
    case .question: return "Question"
    case .other: return "Needs you"
    }
}

/// Tint for a pending-ask kind. NOT vendor color — this categorizes the *kind of
/// decision* (approve / decide / unblock), which is real operator signal.
private func needKindTint(_ kind: PendingAsk.Kind) -> Color {
    switch kind {
    case .permission, .confirm, .other: return ScoutVibe.amber
    case .decision, .question: return ScoutVibe.blue
    case .blocked: return ScoutVibe.red
    }
}

// MARK: - First-load skeleton

/// A quiet first-read placeholder shaped like Home itself. Solid Scout surfaces
/// keep it in the cockpit palette; redaction avoids presenting invented data.
private struct HomeLoadingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .fill(ScoutVibe.card)
                .frame(height: 58)

            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                skeletonHeader("Working")
                HStack(spacing: HudSpacing.sm) {
                    skeletonCard
                    skeletonCard
                }
            }

            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                skeletonHeader("Activity")
                ForEach(0..<3, id: \.self) { index in
                    HStack(spacing: HudSpacing.md) {
                        Circle().fill(ScoutInk.dim).frame(width: 6, height: 6)
                        Text(index == 0 ? "Agent activity" : "Broker event")
                            .font(HudFont.mono(HudTextSize.xs))
                        Spacer(minLength: 0)
                        Text("now").font(HudFont.mono(HudTextSize.micro))
                    }
                    .frame(height: 28)
                }
            }
        }
        .foregroundStyle(ScoutInk.dim)
        .redacted(reason: .placeholder)
        .opacity(0.46)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading fleet")
    }

    private func skeletonHeader(_ title: String) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(title.uppercased())
                .font(HudFont.mono(10.5, weight: .medium))
                .tracking(2)
            Rectangle().fill(ScoutVibe.hairline).frame(height: HudStrokeWidth.standard)
        }
    }

    private var skeletonCard: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            Text("Agent name").font(HudFont.ui(HudTextSize.sm, weight: .medium))
            Text("Current goal across the fleet").font(HudFont.ui(HudTextSize.xs))
            Text("project/branch").font(HudFont.mono(10.5))
        }
        .padding(HudSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .fill(ScoutVibe.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }
}

// MARK: - FleetVitals

/// The top strip: the live activity pulse sparkline only — the glance-value
/// that actually helps. Subscription quota gauges left Home for the fleet-LED
/// vitals panel (`CrownVitalsPanel`), so the strip disappears entirely until
/// there are a few events to plot.
private struct FleetVitals: View {
    let live: Int
    let samples: [Double]
    let motionEnabled: Bool

    private var hasPulse: Bool { samples.count >= 3 }

    @ViewBuilder
    var body: some View {
        if hasPulse {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                segHead(live > 0 ? "Live" : "Activity", detail: live > 0 ? "\(live) now" : "1d", accent: live > 0)
                FleetSparkline(samples: samples, motionEnabled: motionEnabled)
                    .frame(height: 30)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 2)
            .padding(.top, HudSpacing.xs)
            .padding(.bottom, HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            // A flat strip, the studio way — no card outline; a single hairline
            // rules it off from the log beneath.
            .overlay(alignment: .bottom) {
                Rectangle().fill(ScoutVibe.hairline).frame(height: HudStrokeWidth.thin)
            }
        }
    }

    private func segHead(_ label: String, detail: String, accent: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(label.uppercased())
                .font(HudFont.mono(9, weight: .bold))
                .tracking(1.0)
                .foregroundStyle(accent ? ScoutVibe.accent : ScoutVibe.ink)
                .lineLimit(1)
            if !detail.isEmpty {
                Text(detail.uppercased())
                    .font(HudFont.mono(7.5, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
        }
    }
}

/// One quota window with a shared animatable scalar driving both the fill and
/// the monospaced percentage. That keeps the readout and instrument physically
/// in sync instead of snapping the text to its destination. Shared with the
/// fleet-LED vitals panel (`CrownVitalsPanel`), the gauges' home since they
/// left the Home strip.
struct QuotaWindowMeter: View {
    let window: ServiceBudget.Window
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayedPercent = 0.0

    private var targetPercent: Double { min(100, max(0, window.usedPercent)) }
    private var tint: Color { window.usedPercent >= 80 ? ScoutVibe.amber : ScoutInk.muted }
    private var shouldAnimate: Bool { motionEnabled && !reduceMotion }

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Text(window.label)
                .font(HudFont.mono(8.5, weight: .semibold))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 15, alignment: .leading)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(ScoutVibe.hairline)
                    Capsule()
                        .fill(tint)
                        .frame(width: max(0, geometry.size.width * displayedPercent / 100))
                }
            }
            .frame(height: 3)
            AnimatedPercentText(value: displayedPercent, tint: tint)
                .frame(minWidth: 22, alignment: .trailing)
        }
        .onAppear { setInitialPercent() }
        .onChange(of: window.usedPercent) { _, _ in setUpdatedPercent() }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { withAnimation(nil) { displayedPercent = targetPercent } }
        }
    }

    private func setInitialPercent() {
        guard shouldAnimate else {
            displayedPercent = targetPercent
            return
        }
        displayedPercent = 0
        DispatchQueue.main.async {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                displayedPercent = targetPercent
            }
        }
    }

    private func setUpdatedPercent() {
        guard shouldAnimate else {
            withAnimation(nil) { displayedPercent = targetPercent }
            return
        }
        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
            displayedPercent = targetPercent
        }
    }
}

struct AnimatedPercentText: View, @MainActor Animatable {
    var value: Double
    let tint: Color

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text("\(Int(min(100, max(0, value)).rounded()))%")
            .font(HudFont.mono(9, weight: .semibold))
            .foregroundStyle(tint)
            .monospacedDigit()
    }
}

/// Real activity pulse — thin accent stroke over a soft vertical fade + end mark.
private struct FleetSparkline: View {
    let samples: [Double]
    let motionEnabled: Bool
    @State private var reveal = 0.0

    var body: some View {
        GeometryReader { geo in
            let points = points(in: geo.size)
            ZStack {
                SparklineShape(samples: samples, closesArea: true)
                    .fill(LinearGradient(colors: [ScoutVibe.accent.opacity(0.24), ScoutVibe.accent.opacity(0)], startPoint: .top, endPoint: .bottom))
                    .mask(alignment: .leading) {
                        Rectangle().frame(width: geo.size.width * reveal)
                    }
                SparklineShape(samples: samples, closesArea: false)
                    .trim(from: 0, to: reveal)
                    .stroke(ScoutVibe.accent, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                if let end = points.last {
                    Circle()
                        .fill(ScoutVibe.accent)
                        .frame(width: 4, height: 4)
                        .position(end)
                        .opacity(reveal > 0.96 ? (reveal - 0.96) / 0.04 : 0)
                }
            }
            .animation(motionEnabled ? .easeOut(duration: 0.45) : nil, value: samples)
        }
        .task {
            guard motionEnabled else {
                reveal = 1
                return
            }
            reveal = 0
            await Task.yield()
            withAnimation(.easeOut(duration: 0.9)) { reveal = 1 }
        }
        .onChange(of: motionEnabled) { _, enabled in
            if !enabled { withAnimation(nil) { reveal = 1 } }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard !samples.isEmpty else { return [] }
        let maxV = max(samples.max() ?? 1, 1)
        let usableH = max(size.height - 4, 1)
        return samples.enumerated().map { index, value in
            let x = samples.count > 1 ? CGFloat(index) / CGFloat(samples.count - 1) * size.width : size.width / 2
            return CGPoint(x: x, y: size.height - 2 - CGFloat(value / maxV) * usableH)
        }
    }

}

/// Array-backed VectorArithmetic lets SwiftUI interpolate the broker's 16 pulse
/// buckets when a poll changes their shape. It also tolerates a future bucket
/// count change by padding the shorter side with zero during the transition.
private struct SparklineVector: VectorArithmetic {
    var values: [Double]

    static var zero: SparklineVector { SparklineVector(values: []) }

    static func + (lhs: SparklineVector, rhs: SparklineVector) -> SparklineVector {
        combine(lhs, rhs, +)
    }

    static func - (lhs: SparklineVector, rhs: SparklineVector) -> SparklineVector {
        combine(lhs, rhs, -)
    }

    mutating func scale(by rhs: Double) {
        for index in values.indices { values[index] *= rhs }
    }

    var magnitudeSquared: Double {
        values.reduce(0) { $0 + $1 * $1 }
    }

    private static func combine(
        _ lhs: SparklineVector,
        _ rhs: SparklineVector,
        _ operation: (Double, Double) -> Double
    ) -> SparklineVector {
        let count = max(lhs.values.count, rhs.values.count)
        return SparklineVector(values: (0..<count).map { index in
            operation(
                index < lhs.values.count ? lhs.values[index] : 0,
                index < rhs.values.count ? rhs.values[index] : 0
            )
        })
    }
}

private struct SparklineShape: Shape {
    var samples: [Double]
    let closesArea: Bool

    var animatableData: SparklineVector {
        get { SparklineVector(values: samples) }
        set { samples = newValue.values }
    }

    func path(in rect: CGRect) -> Path {
        let points = normalizedPoints(in: rect.size)
        return Path { path in
            guard let first = points.first else { return }
            if closesArea {
                path.move(to: CGPoint(x: first.x, y: rect.maxY))
                path.addLine(to: first)
            } else {
                path.move(to: first)
            }
            // Catmull-Rom through every sample — rounded curves like the web's,
            // instead of straight segment-to-segment joints.
            for index in 1 ..< points.count {
                let p0 = points[max(index - 2, 0)]
                let p1 = points[index - 1]
                let p2 = points[index]
                let p3 = points[min(index + 1, points.count - 1)]
                let control1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
                let control2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
                path.addCurve(to: p2, control1: control1, control2: control2)
            }
            if closesArea, let last = points.last {
                path.addLine(to: CGPoint(x: last.x, y: rect.maxY))
                path.closeSubpath()
            }
        }
    }

    private func normalizedPoints(in size: CGSize) -> [CGPoint] {
        guard !samples.isEmpty else { return [] }
        let maxValue = max(samples.max() ?? 1, 1)
        let usableHeight = max(size.height - 4, 1)
        return samples.enumerated().map { index, value in
            let x = samples.count > 1
                ? CGFloat(index) / CGFloat(samples.count - 1) * size.width
                : size.width / 2
            return CGPoint(
                x: x,
                y: size.height - 2 - CGFloat(value / maxValue) * usableHeight
            )
        }
    }
}

// MARK: - NeedCard

/// One Needs-you card, backed by a real agent that `needsAttention`: KIND tag,
/// age, the pending ask, and a tap that opens the conversation to respond. No
/// inline Approve/Deny yet — responding happens in the thread, so the card is a
/// truthful jump-in, not a fake control.
private struct NeedCard: View {
    let agent: AgentSummary
    /// Card width. The dashboard's horizontal lane wants a fixed 212pt tile;
    /// Entry stacks the same card down the full lane.
    var width: CGFloat = 212
    let onTap: () -> Void

    private var kind: PendingAsk.Kind { agent.pendingAsk?.kind ?? .question }
    private var tint: Color { needKindTint(kind) }
    private var prompt: String {
        if let ask = agent.pendingAsk?.prompt, !ask.isEmpty { return ask }
        return meaningfulActionString(agent.statusLabel) ?? "Waiting on your input."
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutVibe.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: HudSpacing.xs)
                    if let age = relativeAgeString(agent.lastActiveAt) {
                        Text(age)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.dim)
                            .monospacedDigit()
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                    Text(needKindLabel(kind).uppercased())
                        .font(HudFont.mono(8, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(tint)
                        .fixedSize()
                    Text(prompt)
                        .font(HudFont.mono(10.5))
                        .foregroundStyle(ScoutInk.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.vertical, HudSpacing.sm)
            .padding(.horizontal, HudSpacing.md)
            .frame(width: width, alignment: .leading)
            // A small refined chip (studio `.iNotif`): rounded well, hairline, the
            // tinted kind tag carries the signal — no left bar on a rounded box.
            .background(RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous).fill(ScoutSurface.raised))
            .overlay(RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .contentShape(RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - WorkingRow

/// One working agent as a terminal line inside the Working well: a ❯ prompt,
/// the harness monogram (the model picker's glyph set), the dim project path,
/// the agent's current one-line action (truncated), and recency — a live dot +
/// "now" while running, else a relative age. The live row's line ends in a
/// blinking block cursor. Tap opens the agent's conversation, same as before.
private struct WorkingRow: View {
    let agent: AgentSummary
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: HudSpacing.sm) {
                Text("❯")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(isLive ? ScoutVibe.accent : ScoutInk.dim)
                Text(monogram)
                    .font(.system(size: 11))
                    .foregroundStyle(isLive ? ScoutVibe.accent : ScoutInk.muted)
                if let project = agent.projectName, !project.isEmpty {
                    Text(project)
                        .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                        .foregroundStyle(ScoutInk.dim)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                Text(summaryText)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(isLive ? ScoutInk.muted : ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if isLive { TerminalCursor() }
                Spacer(minLength: 0)
                recency
            }
            .frame(height: 26)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.title), \(summaryText)")
    }

    private var isLive: Bool { agent.state == .live }

    /// The one-line summary — the agent's current action while live, or its last
    /// meaningful status. Falls back to the agent's title so a between-turns agent
    /// with nothing to say still names itself rather than rendering a blank row.
    private var summaryText: String {
        meaningfulActionString(agent.statusLabel) ?? agent.title
    }

    private var monogram: String {
        guard let harness = agent.harness?.lowercased(), !harness.isEmpty else { return "·" }
        if let entry = ComposerModelHarness.catalog.first(where: { $0.id == harness }) {
            return entry.monogram
        }
        return harness.prefix(1).uppercased()
    }

    @ViewBuilder
    private var recency: some View {
        if isLive {
            HStack(spacing: HudSpacing.xxs) {
                HudStatusDot(color: ScoutVibe.accent, size: 5, pulses: true)
                Text("now").font(HudFont.mono(HudTextSize.micro, weight: .medium)).foregroundStyle(ScoutVibe.accent)
            }
        } else if let age = relativeAgeString(agent.lastActiveAt) {
            Text(age)
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutInk.dim)
                .monospacedDigit()
        }
    }
}

/// A blinking block cursor (the revived LiveCaret idea, as a terminal block):
/// the Working well's one bit of motion, parked at the end of the live row's
/// line. ~1s blink cycle.
private struct TerminalCursor: View {
    @State private var visible = true
    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(ScoutVibe.accent)
            .frame(width: 7, height: 12)
            .opacity(visible ? 1 : 0)
            .onAppear { withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) { visible = false } }
    }
}

/// An inner shadow for RECESSED wells: a blurred shape stroke nudged downward
/// and masked to the fill, so darkness pools at the top inner edge (the crown
/// chrome's inset-well technique, reused for the terminal panel).
private struct TerminalInsetShadow<S: Shape>: View {
    let shape: S
    var color: Color
    var radius: CGFloat
    var y: CGFloat = 1

    var body: some View {
        shape
            .stroke(color, lineWidth: radius * 2)
            .blur(radius: radius)
            .offset(y: y)
            .mask(shape.fill())
            .allowsHitTesting(false)
    }
}

// MARK: - TerminalTile

/// One recent terminal (harness) session, as a small terminal-y well: a metadata
/// line (harness · session · live/age) over a CLI prompt line showing the resume
/// command. The details that matter on a single-machine fleet are the session and
/// the harness; the prompt line gives it the shell "juice". A live surface reads
/// with an accent edge. Display-only — a truthful readout, not a fake attach.
private struct TerminalTile: View {
    let terminal: MobileTerminal

    /// A short, stable session tag from the harness-native session id (falls back
    /// to the record id, dropping its `ts.` prefix). Enough to tell sessions apart.
    private var sessionShort: String {
        let raw = terminal.sessionId.isEmpty ? terminal.id : terminal.sessionId
        let core = raw.hasPrefix("ts.") ? String(raw.dropFirst(3)) : raw
        return String(core.prefix(8))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: HudSpacing.xs) {
                Text(terminal.harness.lowercased())
                    .font(HudFont.mono(9.5, weight: .semibold))
                    .foregroundStyle(ScoutVibe.ink)
                    .lineLimit(1)
                Text(sessionShort)
                    .font(HudFont.mono(9))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.xs)
                if terminal.running {
                    Text("live")
                        .font(HudFont.mono(8.5, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                } else if let age = relativeAgeString(terminal.updatedAt) {
                    Text(age)
                        .font(HudFont.mono(8.5))
                        .foregroundStyle(ScoutInk.dim)
                        .monospacedDigit()
                }
            }
            HStack(spacing: HudSpacing.xxs) {
                Text("\u{276F}")
                    .font(HudFont.mono(10, weight: .semibold))
                    .foregroundStyle(ScoutInk.dim)
                Text(terminal.command)
                    .font(HudFont.mono(10))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(width: 190, alignment: .leading)
        // A dark, recessed terminal well — no accent; the shell reads on its own.
        .background(RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous).fill(Color.black.opacity(0.40)))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Terminal, \(terminal.harness) session \(sessionShort)\(terminal.running ? ", running" : ""), \(terminal.command)")
    }
}

// MARK: - ActivityRow

private struct ActivityRow: View {
    let event: TailEvent
    var onOpen: (() -> Void)?

    var body: some View {
        Button(action: { onOpen?() }) {
            HStack(alignment: .center, spacing: HudSpacing.md) {
                Circle().fill(kindColor).frame(width: 6, height: 6)
                Text(event.source)
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutVibe.ink)
                    .lineLimit(1)
                    .layoutPriority(1)
                Text(event.summary)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
                if let ageLabel {
                    Text(ageLabel)
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .foregroundStyle(ScoutInk.dim)
                        .monospacedDigit()
                        .fixedSize()
                }
            }
            .padding(.vertical, HudSpacing.xs + 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(onOpen == nil)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(event.source) \(event.summary)")
    }

    private var ageLabel: String? {
        guard let date = ScoutTimestamp.date(fromEpoch: TimeInterval(event.tsMs)) else { return nil }
        return ScoutTimestamp.relativeAge(since: date)
    }

    private var kindColor: Color { homeActivitySignalColor(event.kind) }
}

// MARK: - Shared helpers

private func homeActivitySignalColor(_ kind: TailEvent.Kind) -> Color {
    switch kind {
    case .assistant: return ScoutVibe.accent
    case .tool, .toolResult: return ScoutVibe.amber
    case .user: return ScoutInk.muted
    case .system, .other: return ScoutInk.dim
    }
}

private func relativeAgeString(_ date: Date?) -> String? {
    ScoutTimestamp.relativeAge(since: date)
}

private func meaningfulActionString(_ label: String?) -> String? {
    guard let s = label?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    let generic: Set<String> = ["available", "idle", "offline", "online", "ready", "working", "unknown", "live"]
    return generic.contains(s.lowercased()) ? nil : s
}
