import SwiftUI
import Foundation
import PhotosUI
import UniformTypeIdentifiers
import HudsonUI
import HudsonVoice
import ScoutCapabilities

/// What another surface hands New when it wants a session started from its own
/// composer. The prompt is the only required part; a surface that offers a REAL
/// runtime choice (Home · Entry's chip) carries the pick too, and it lands on
/// `SessionInitiationSpec.Execution` verbatim. Attachments ride along so the
/// front door's paperclip is a real one rather than a decoration.
struct NewSessionSeed: Equatable {
    var prompt: String
    var harnessId: String?
    var familyId: String?
    var effortId: String?
    var attachments: [ScoutComposerAttachment] = []

    init(
        prompt: String,
        harnessId: String? = nil,
        familyId: String? = nil,
        effortId: String? = nil,
        attachments: [ScoutComposerAttachment] = []
    ) {
        self.prompt = prompt
        self.harnessId = harnessId
        self.familyId = familyId
        self.effortId = effortId
        self.attachments = attachments
    }
}

/// New Session — a composer that builds a project-modality
/// `SessionInitiationSpec` (target.projectPath set, execution.session = .new,
/// seed.instructions) and dispatches it through the broker client, then shows
/// the returned ids. The reading order is the operator's: pick the **project**,
/// confirm/adjust the **agent** (harness · model · target — leads with a sensible
/// default and stays calm until engaged), write the **prompt** (typed or
/// dictated), then **Start**.
struct NewSessionSurface: View {
    /// The fleet — for the machine picker (which paired Mac the session lands on)
    /// and resolving that Mac's live client.
    let model: AppModel
    /// The focused Mac's client — the fallback target when no machine is explicitly
    /// picked (and the sole link today; the picker becomes live once a second Mac
    /// pairs).
    let client: any ScoutBrokerClient
    /// Bumps when the bridge becomes ready (data loaded) — re-runs the workspace
    /// load so the machine-backed harness list fills in once connected, not just
    /// on first appear (which can land before the connection is up).
    var reloadToken: Int = 0
    let isActive: Bool
    /// Publishes the pushed conversation's runtime/project/model context into
    /// the global protected-area status bar.
    var onConversationStatusContext: (String?) -> Void = { _ in }
    /// One-shot seed (Home's ask composers route here). Consumed on change: the
    /// runtime pick lands first, then the prompt, then focus; the seed clears
    /// itself. A binding because this surface stays mounted for the app
    /// lifetime, so init-time state would never reseed.
    @Binding var promptSeed: NewSessionSeed?

    /// Empty until the paired Mac returns its current workspace inventory. A
    /// device must never guess the Mac account name or carry a developer-specific
    /// absolute path into a create-session RPC.
    @State private var projectPath: String = ""
    /// Explicitly-picked target Mac; nil follows the focused machine.
    @State private var selectedMachineId: String? = nil
    @State private var instructions: String = ""
    /// Selected harness id (the spec's `execution.harness`), model family, and
    /// effort. Family is scoped to the harness, so changing harness resets it
    /// to that harness's DEFAULT-tagged family (see ModelPickerPopover).
    @State private var harnessId: String = ComposerModelHarness.catalog[0].id
    @State private var familyId: String = ComposerModelHarness.catalog[0].defaultFamily.id
    @State private var effortId: String = ComposerEffortOption.defaultId
    @State private var runtimeCatalog: RuntimeCapabilityCatalog? = ComposerRuntimeCatalogCache.load()
    /// A seed carried an explicit runtime pick — so the machine's workspace
    /// recommendation must not quietly overwrite it. Held until that seeded ask
    /// is actually submitted.
    @State private var runtimePinned = false
    @State private var showModelPicker = false
    /// Machine-backed workspaces from the connected Mac (`mobile/workspaces`),
    /// each carrying the harnesses actually installed there. Empty until loaded /
    /// when offline, in which case the harness picker falls back to the curated
    /// catalog below.
    @State private var workspaces: [WorkspaceSummary] = []
    /// In flight — so the list can say "looking" instead of "nothing here" on a
    /// surface whose whole top half is that list.
    @State private var isLoadingWorkspaces = false
    /// The project search. Doubles as the manual-path field: a query that looks
    /// like a path and matches no known workspace is offered verbatim.
    @State private var projectQuery = ""
    /// The lane is three rows at rest; this is the whole inventory, opened in
    /// place. Not a sheet — the composer stays put and stays reachable, and
    /// backing out costs the same tap that opened it.
    @State private var isPickerOpen = false
    /// The curated split, computed once per load (see `recurate`). Kept as
    /// state rather than derived in `body`: the umbrella test is O(n²) over the
    /// inventory and has no business running per row per frame.
    @State private var durableWorkspaces: [WorkspaceSummary] = []
    @State private var workspaceKinds: [String: WorkspaceKind] = [:]
    /// Device-local recency — newline-separated roots, most recent first.
    @AppStorage("scout.new.recentProjectRoots") private var recentRootsRaw = ""
    @State private var isSubmitting = false
    /// The last create the broker ACCEPTED — nil until one lands, and nil again
    /// the moment the operator dismisses it. See `LaunchRecord` for why this is
    /// a captured record rather than the raw result.
    @State private var launch: LaunchRecord?
    @State private var errorText: String?
    @State private var pendingAttachments: [ScoutComposerAttachment] = []
    /// The composer owns focus; this only says who SHOULD be holding it. False
    /// at rest — unlike Home, composing is not this surface's opening posture
    /// (you choose where the work lands first). A seeded ask flips it true.
    @State private var composerWantsKeyboard = false
    /// Focus for the project filter. The composer owns its own; this surface has
    /// TWO fields, so it has to know which one is up to offer the right toggle.
    @FocusState private var searchFocused: Bool
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var route: ConversationRoute?
    /// Nav mode (tabs/crown) — crown mode reserves no bottom chrome, so the
    /// composer pads itself clear of the floating crown (CrownMetric.bottomReserve).
    @AppStorage(ScoutNavMode.storageKey) private var navModeRaw = ScoutNavMode.default.rawValue

    // Dictation is the shared composer's own business now — it reads
    // `HudDictation` from the environment and runs the mic, the trail and the
    // transcript append itself, exactly as it does on Home.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scoutLayout) private var layout
    @StateObject private var entrance = CockpitEntrancePhase()
    /// One marker travels down the project list, as it does across the runtime
    /// panel's harness rail.
    @Namespace private var projectMarker

    /// Definite content width inside the surface padding — the same discipline
    /// Home uses so wide rows (the agent row, the Start button) fit and truncate
    /// within the screen instead of inflating the column and clipping off the
    /// right edge on a scaled/native phone.
    ///
    /// This whole surface IS the working column (destination lane + composer +
    /// keyboard line), so it takes the shared measure wholesale: unchanged at
    /// every phone width, capped and centred at regular width so New reads the
    /// same as the Entry home on an iPad.
    private var laneWidth: CGFloat { layout.contentWidth }

    /// Macs you can start a session on right now.
    private var onlineMachines: [AppModel.PairedMachine] {
        model.pairedMachines.filter(\.isOnline)
    }

    /// The Mac the session will land on: the explicit pick, else the focused Mac,
    /// else the first online one.
    private var activeMachine: AppModel.PairedMachine? {
        if let id = selectedMachineId, let picked = model.pairedMachines.first(where: { $0.id == id }) {
            return picked
        }
        return model.pairedMachines.first(where: \.isActive)
            ?? model.pairedMachines.first(where: \.isOnline)
            ?? model.pairedMachines.first
    }

    /// The live client for the active Mac (falls back to the passed focused client).
    private var activeClient: any ScoutBrokerClient {
        if let machine = activeMachine, let resolved = model.client(forMachineId: machine.id) {
            return resolved
        }
        return client
    }

    /// A Hashable navigation target — contract models stay transport-pure.
    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    /// What a create actually WAS, captured at the moment the broker accepted it.
    ///
    /// The card must not read live form state. The composer resets on success and
    /// the operator is free to re-point the destination straight after, so a card
    /// sourced from `harnessId` / `projectLeaf` would quietly re-describe a
    /// finished create with whatever the form happens to say now — "Codex is
    /// working in talkie" over a session that was Claude in openscout. A receipt
    /// that changes after the fact is not a receipt.
    private struct LaunchRecord {
        let outcome: SessionInitiationResult
        let harnessLabel: String
        let projectLeaf: String
        let title: String

        /// The prompt actually reached the agent, rather than only a session
        /// being opened for it.
        var promptSent: Bool {
            outcome.messageId?.isEmpty == false || outcome.flightId?.isEmpty == false
        }
    }

    /// The harness/family/effort catalog now lives with the picker — see
    /// ComposerModelHarness / ComposerModelFamily / ComposerEffortOption in
    /// ModelPickerPopover.swift (ported from the approved studio study).

    private var selectedEffort: ComposerEffortOption {
        ComposerEffortOption.catalog.first { $0.id == effortId } ?? ComposerEffortOption.catalog[0]
    }

    private var catalogHarnesses: [ComposerModelHarness] {
        let fetched = runtimeCatalog?.composerHarnesses ?? []
        return fetched.isEmpty ? ComposerModelHarness.catalog : fetched
    }

    private var catalogEfforts: [ComposerEffortOption] {
        runtimeCatalog?.composerEfforts ?? ComposerEffortOption.catalog
    }

    /// One selectable harness in the picker — sourced from the connected machine
    /// when known, else the curated fallback.
    private struct HarnessChoice: Identifiable, Hashable {
        let id: String
        let label: String
        let readiness: WorkspaceSummary.Harness.Readiness?
    }

    /// The workspace whose root matches the chosen project, if the machine knows it.
    private var selectedWorkspace: WorkspaceSummary? {
        workspaces.first { $0.root == trimmedProjectPath }
    }

    /// Harness options: the machine's installed harnesses for the selected
    /// project when available, otherwise the curated catalog (e.g. while offline).
    private var harnessChoices: [HarnessChoice] {
        // The machine's full harness set — the union of every usable harness across
        // its known workspaces — so the picker reflects what's actually installed on
        // that Mac, not just one project's default. Curated fallback when offline.
        let live = workspaces.flatMap(\.harnesses).filter(\.isUsable)
        if !live.isEmpty {
            var seen = Set<String>()
            return live
                .filter { seen.insert($0.harness).inserted }
                .map { HarnessChoice(id: $0.harness, label: harnessLabel($0.harness), readiness: $0.readiness) }
                .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        }
        return catalogHarnesses.map { HarnessChoice(id: $0.id, label: $0.label, readiness: nil) }
    }

    /// Friendly label for a harness id — the curated label when we have one, else
    /// a capitalized form of the raw id (for harnesses we don't curate models for).
    private func harnessLabel(_ id: String) -> String {
        if let curated = ComposerModelHarness.curated(id) { return curated.label }
        return id.isEmpty ? id : id.prefix(1).uppercased() + id.dropFirst()
    }

    private var selectedHarnessLabel: String {
        harnessChoices.first(where: { $0.id == harnessId })?.label ?? harnessLabel(harnessId)
    }

    /// Plates for the model popover: the curated catalog trimmed to the
    /// harnesses the selected machine actually reports, plus a single-Auto
    /// fallback plate for any live harness we don't curate models for (so it
    /// stays startable). Offline, `harnessChoices` IS the curated catalog.
    private var pickerHarnesses: [ComposerModelHarness] {
        let choices = harnessChoices
        var plates = catalogHarnesses.filter { entry in
            choices.contains { $0.id == entry.id }
        }
        for choice in choices where !plates.contains(where: { $0.id == choice.id }) {
            plates.append(.fallback(id: choice.id, label: choice.label))
        }
        return plates.isEmpty ? catalogHarnesses : plates
    }

    /// The picked model family — resolves through the same tolerant path the
    /// popover uses so a stale id (e.g. after a harness switch) lands on the
    /// harness's default instead of vanishing.
    private var selectedFamily: ComposerModelFamily {
        let harness = pickerHarnesses.first { $0.id == harnessId } ?? pickerHarnesses[0]
        return harness.families.first { $0.id == familyId } ?? harness.defaultFamily
    }

    var body: some View {
        // The SAME room as the Entry home, with different furniture. Home is
        // air, then a quiet lane of recents, then the docked composer. New is
        // air, then a quiet lane of the two things that gate Start — ① which
        // Mac, ② which project — then the same docked composer, with the
        // keyboard toggle on its own line beneath it.
        //
        // What this replaced: a project list that owned the whole screen. It
        // was the honest reading of "the destination is the page", and on real
        // data it was wrong twice over — the operator does not re-choose the
        // repo most visits, and the raw inventory is 57 rows of which a third
        // are worktree clones and /tmp checkouts. Three curated rows and a way
        // to the rest says the same thing in a fifth of the screen.
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                // The air IS the design: it absorbs whatever the lane does not
                // need, so the destination hugs the composer at rest and simply
                // takes the room when the picker is open.
                Spacer(minLength: 0)
                launchSlot
                destination
                    .cockpitEntrance(index: 0, phase: entrance)
                composerDock
                    .cockpitEntrance(index: 1, phase: entrance)
                keyboardBar
            }
            .frame(width: laneWidth, alignment: .leading)
            .frame(maxHeight: .infinity)
            Spacer(minLength: 0)
        }
        // Leading gutter carries the centring (the trailing `Spacer` absorbs the
        // rest); the vertical rhythm stays on the surface padding — the measure
        // is a horizontal idea only.
        .padding(.leading, layout.contentInset)
        .padding(.vertical, layout.surfacePadding)
        // Crown mode reserves nothing at the bottom — surfaces flow behind the
        // chrome — but the composer's action row is INTERACTIVE, so it must
        // clear the resting crown outright (same pattern as MissionControl).
        .padding(.bottom, ScoutNavMode.resolve(navModeRaw) == .crown ? CrownMetric.bottomReserve : 0)
        // Same anchored panel as the Entry composer — it grows out of the model
        // token in the composer card rather than covering it with a sheet.
        .scoutRuntimePicker(
            isPresented: $showModelPicker,
            harnesses: pickerHarnesses,
            efforts: catalogEfforts,
            harnessId: $harnessId,
            familyId: $familyId,
            effortId: $effortId
        )
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItems, maxSelectionCount: 8, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            addFiles(result)
        }
        .onChange(of: promptSeed) { _, seed in
            guard let seed else { return }
            defer { promptSeed = nil }
            if let harness = seed.harnessId {
                harnessId = harness
                familyId = seed.familyId
                    ?? ComposerModelHarness.curated(harness)?.defaultFamily.id
                    ?? familyId
                effortId = seed.effortId ?? effortId
                runtimePinned = true
            }
            pendingAttachments.append(contentsOf: seed.attachments)
            let trimmed = seed.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            if instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                instructions = trimmed
            } else {
                instructions += "\n" + trimmed
            }
            composerWantsKeyboard = true
        }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: activeClient,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil },
                onStatusContextChange: onConversationStatusContext
            )
        }
            .task(id: "\(reloadToken)|\(isActive)") {
                guard isActive else { return }
                await entrance.reveal(when: isActive, animated: !reduceMotion)
                async let catalogRefresh: Void = refreshRuntimeCatalog()
                await loadWorkspaces()
                await catalogRefresh
            }
        #if DEBUG
        // Sibling of Home's `SCOUT_OPEN_RUNTIME`: the open picker is a
        // touch-only state, so this lets a headless capture photograph the real
        // thing rather than a preview of it. DEBUG only.
        .onAppear {
            guard ProcessInfo.processInfo.environment["SCOUT_OPEN_PICKER"] == "1" else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(900))
                isPickerOpen = true
                if let query = ProcessInfo.processInfo.environment["SCOUT_PICKER_QUERY"] {
                    projectQuery = query
                }
            }
        }
        #endif
        // When the project changes, adopt that machine workspace's harnesses.
        .onChange(of: projectPath) { _, _ in
            applyWorkspaceDefault()
            if isActive {
                Task { await refreshRuntimeCatalog() }
            }
        }
        // Picking a different Mac re-reads its workspaces (the project list + the
        // machine-backed harnesses are per-Mac); drop the old project so the load
        // re-picks a valid default on that host.
        .onChange(of: selectedMachineId) { _, _ in
            projectPath = ""
            if isActive {
                Task {
                    async let catalogRefresh: Void = refreshRuntimeCatalog()
                    await loadWorkspaces()
                    await catalogRefresh
                }
            }
        }
    }

    // MARK: - Machine-backed harnesses

    private func refreshRuntimeCatalog() async {
        let project = trimmedProjectPath.isEmpty ? nil : trimmedProjectPath
        guard let fetched = try? await activeClient.runtimeCapabilities(projectRoot: project),
              fetched.schemaVersion == "openscout.runtime-capabilities.v1"
        else { return }
        runtimeCatalog = fetched
        ComposerRuntimeCatalogCache.save(fetched)
    }

    private func loadWorkspaces() async {
        isLoadingWorkspaces = workspaces.isEmpty
        defer { isLoadingWorkspaces = false }
        #if DEBUG
        // Sim verification hook, sibling to Home's `SCOUT_OPEN_RUNTIME`: the
        // loaded state of this surface is only interesting against a POLLUTED
        // inventory, and a sim that cannot reach a Mac reporting one has no way
        // to show it. `SCOUT_WORKSPACE_FIXTURE=1` substitutes the inventory
        // transcribed off the phone on 2026-07-28 so a headless capture can
        // photograph the real shape. DEBUG only; never ships in release
        // behavior, and it replaces the fetch rather than padding it — a
        // fixture mixed into live data would be a lie.
        if ProcessInfo.processInfo.environment["SCOUT_WORKSPACE_FIXTURE"] == "1" {
            let loaded = Self.captureFixture
            workspaces = loaded
            recurate(loaded)
            if trimmedProjectPath.isEmpty {
                projectPath = shortlist.first?.root ?? loaded.first?.root ?? ""
            }
            applyWorkspaceDefault()
            return
        }
        #endif
        // Don't clobber the current list (or the curated fallback) on a failed
        // fetch — only a successful load replaces it.
        guard let loaded = try? await activeClient.listWorkspaces(query: nil, limit: 200) else { return }
        workspaces = loaded
        recurate(loaded)
        if trimmedProjectPath.isEmpty {
            // The default lands on a project you have actually worked in, then
            // on the first DURABLE root — never on whatever the index happened
            // to return first, which on the real Mac was a worktree clone.
            projectPath = shortlist.first?.root ?? loaded.first?.root ?? ""
        }
        applyWorkspaceDefault()
    }

    /// Adopt the machine's recommended harness for the selected project — its
    /// `defaultHarness` when usable, else the first usable one — but only when the
    /// current choice isn't valid for this workspace. No-op when the project isn't
    /// a known workspace, so the curated fallback selection stays put.
    private func applyWorkspaceDefault() {
        let valid = harnessChoices.map(\.id)
        guard !valid.isEmpty else { return }
        // An explicit pick made on the front door outranks the recommendation —
        // but only while this machine can actually run it.
        if runtimePinned, valid.contains(harnessId) { return }
        // Prefer the selected project's recommended harness; otherwise keep the
        // current choice if it's still valid, else fall back to the first.
        if let preferred = selectedWorkspace?.defaultHarness, valid.contains(preferred) {
            guard harnessId != preferred else { return }
            harnessId = preferred
        } else if valid.contains(harnessId) {
            return
        } else {
            harnessId = valid[0]
        }
        // Harness changed — re-seat the family on that harness's default.
        familyId = pickerHarnesses.first { $0.id == harnessId }?.defaultFamily.id ?? familyId
    }

    // MARK: - Destination
    //
    // Where the work lands, and it gets the whole body. Two decisions, coarse to
    // fine: which Mac, then which project — the same reading order the surface
    // always claimed but never had the room to show. The project list is the
    // machine's own `listWorkspaces` inventory, searched in place, so choosing
    // is one tap rather than a chip that opens a sheet that opens a tree.

    /// Instrument language, not form language. The two controls here used to be
    /// a labelled line and a filled rounded search box — and that box was the
    /// problem: stacked above a filled rounded composer pill, the eye could not
    /// tell which of the two was the one you type the task into. So the search
    /// is a bare line on a rule (a readout you can type in), the composer keeps
    /// the only pill on the screen, and hairlines carry the structure the boxes
    /// used to.
    private var destination: some View {
        VStack(alignment: .leading, spacing: 0) {
            hostLine
            rule
            // The query only exists while the picker is open. At rest the lane
            // is four lines — host, three projects, and the way to the rest —
            // and a field you use one visit in five does not earn a permanent
            // row on a screen whose whole point is calm.
            if isPickerOpen {
                projectSearchField
                    // Unfolds down out of the host line it sits under, rather
                    // than blinking into existence between two rules.
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .top)),
                                removal: .opacity
                            )
                    )
            }
            projectList
            if !workspaces.isEmpty {
                moreFoot
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var rule: some View {
        Rectangle()
            .fill(ScoutHairline.standard)
            .frame(height: HudStrokeWidth.thin)
    }

    /// Which Mac. One paired Mac is a readout, not a choice — several become a
    /// scrollable strip of chips with the target lit. Same grammar as the
    /// masthead's host chips, so "which machine" reads the same everywhere.
    ///
    /// Every PAIRED Mac shows, not just the reachable ones: a Mac you know about
    /// that has gone offline is information, and hiding it turns "your Mac is
    /// asleep" into "you have no Macs". Offline chips are simply not selectable —
    /// you cannot start a session on a machine that can't hear you.
    @ViewBuilder
    private var hostLine: some View {
        let machines = model.pairedMachines
        HStack(spacing: HudSpacing.md) {
            eyebrow("Host")
            if machines.isEmpty {
                Text("Not connected")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.dim)
            } else if machines.count == 1, let only = machines.first {
                HStack(spacing: HudSpacing.xs) {
                    HudStatusDot(color: only.isOnline ? ScoutPalette.accent : ScoutInk.dim, size: 6)
                    Text(only.name)
                        .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                        .lineLimit(1)
                    if !only.isOnline {
                        Text("offline")
                            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                            .tracking(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(ScoutInk.dim)
                    }
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: HudSpacing.xs) {
                        ForEach(machines) { machine in
                            hostChip(machine)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        // ① of the destination section, and in the common case — one paired Mac
        // — it costs exactly this one line. No eyebrow row of its own, no band,
        // no rule above it. An earlier pass charged host full price (eyebrow +
        // row + rule) on a screen where it is usually a readout.
        .frame(height: 30)
    }

    private func hostChip(_ machine: AppModel.PairedMachine) -> some View {
        let selected = activeMachine?.id == machine.id
        let plate = RoundedRectangle(cornerRadius: 5, style: .continuous)
        return Button {
            guard machine.isOnline else { return }
            selectedMachineId = machine.id
        } label: {
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(color: machine.isOnline ? ScoutPalette.accent : ScoutInk.dim, size: 5)
                Text(machine.name)
                    .font(HudFont.mono(10.5, weight: .medium))
                    .foregroundStyle(selected ? ScoutPalette.ink : ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 108, alignment: .leading)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, 3)
            .background(plate.fill(selected ? ScoutSurface.raised : ScoutSurface.inset))
            .overlay(plate.stroke(selected ? ScoutInk.dim : ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Start on \(machine.name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// Search over the machine's known projects — and the manual-path escape
    /// hatch, because a query that looks like a path IS one. That folds what
    /// used to be a separate sheet (a "Path" field over a disclosure tree) into
    /// the one field the operator was going to type in anyway.
    ///
    /// Deliberately unboxed: a glyph, the text, and the rules above and below it
    /// are the whole control. See `destination` for why it must not look like
    /// the composer.
    private var projectSearchField: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ScoutInk.dim)
            TextField("Filter projects, or type a path", text: $projectQuery)
                .textFieldStyle(.plain)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.ink)
                .tint(ScoutPalette.accent)
                .focused($searchFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
            if !projectQuery.isEmpty {
                Button {
                    projectQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(ScoutInk.dim)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .frame(height: 42)
        // The WHOLE line is the field. A bare TextField only takes focus inside
        // its own text box, so tapping the magnifier — or the empty half of the
        // row, which is most of it — did nothing and the keyboard stayed down.
        .contentShape(Rectangle())
        .onTapGesture { searchFocused = true }
    }

    /// The foot of the lane: the way out to everything else, carrying the count
    /// so no eyebrow row has to, and NAMING what is being kept back — a hidden
    /// pile you cannot name is just a missing list.
    private var moreFoot: some View {
        Button {
            withAnimation(reduceMotion ? nil : ScoutMotion.grow) {
                isPickerOpen.toggle()
            }
            if isPickerOpen {
                searchFocused = true
            } else {
                projectQuery = ""
                searchFocused = false
            }
        } label: {
            HStack(spacing: HudSpacing.md) {
                Text(isPickerOpen ? "Close" : "All \(workspaces.count) projects")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutInk.muted)
                    .fixedSize()
                if !isPickerOpen, let summary = demotedSummary {
                    Text(summary)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 0)
                if !isPickerOpen {
                    Glyphic(kind: .chevron, size: 11)
                        .foregroundStyle(ScoutInk.dim)
                }
            }
            .padding(.leading, HudSpacing.lg)
            .frame(height: 34)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(ScoutHairline.subtle)
                    .frame(height: HudStrokeWidth.thin)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isPickerOpen ? "Close the project list" : "All \(workspaces.count) projects")
    }

    private var keyboardIsUp: Bool { searchFocused || composerWantsKeyboard }

    /// The way back out of the keyboard — and back in. It sits BELOW the
    /// composer on a line of its own: the operator drew a line from the old seat
    /// (the project heading, where it read as a list control) down to here. Home
    /// puts the same toggle in the pinned slot of its accessory strip; New has
    /// no honest smart actions to fill such a strip with, so the control gets a
    /// thin line to itself and nothing keeps it company.
    ///
    /// Not a `.toolbar(placement: .keyboard)`: that placement merges across
    /// every mounted surface, and iOS 26 renders it as glass capsules.
    private var keyboardBar: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            Button(action: toggleKeyboard) {
                Glyphic(kind: keyboardIsUp ? .keyboardDown : .keyboardUp, size: 17)
                    .foregroundStyle(ScoutInk.dim)
                    .frame(width: 44, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(keyboardIsUp ? "Hide keyboard" : "Show keyboard")
        }
        .frame(width: laneWidth)
        .padding(.top, HudSpacing.xs)
    }

    /// Down when the keyboard is up, up when it isn't. Which field it raises
    /// depends on what is on screen: with the picker open the live field is the
    /// filter, otherwise it is the composer — the same rule Home follows, where
    /// the composer is the only field there is.
    private func toggleKeyboard() {
        if keyboardIsUp {
            searchFocused = false
            composerWantsKeyboard = false
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
            )
        } else if isPickerOpen {
            searchFocused = true
        } else {
            composerWantsKeyboard = true
        }
    }

    /// `~` for the Mac's home, so the parent path is readable at 11pt instead of
    /// spending a third of the row on `/Users/<someone>`.
    private func abbreviate(_ path: String) -> String {
        guard path.hasPrefix("/Users/") else { return path }
        let rest = path.dropFirst("/Users/".count)
        guard let slash = rest.firstIndex(of: "/") else { return "~" }
        return "~" + rest[slash...]
    }

    private var filteredWorkspaces: [WorkspaceSummary] {
        let query = projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return workspaces }
        return workspaces.filter {
            $0.projectName.lowercased().contains(query)
                || $0.title.lowercased().contains(query)
                || $0.root.lowercased().contains(query)
        }
    }

    /// A query the operator clearly means as a path, that no known workspace
    /// answers. Offered verbatim rather than swallowed — the Mac may well have a
    /// checkout the workspace index hasn't seen.
    private var typedPath: String? {
        let raw = projectQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.hasPrefix("/") || raw.hasPrefix("~") else { return nil }
        guard !filteredWorkspaces.contains(where: { $0.root == raw }) else { return nil }
        return raw
    }

    // MARK: - Curation
    //
    // The Mac's inventory is not a list of projects; it is a list of directories
    // that happen to contain code. On this Mac, 57 rows: three umbrella folders
    // (`Art` = /Users/art, `Dev` = ~/dev), six worktree clones under
    // `~/.codex/worktrees/<hash>` (four of them called some case of
    // "openscout"), and five /tmp checkouts — and the surface had one of the
    // CLONES selected by default. Interleaved as peers they made the list
    // unreadable and the default wrong.
    //
    // So: durable project roots lead and are the only thing the resting lane
    // shows; the swept-up rest is kept, labelled and one tap away. This is pure
    // path arithmetic over `root` — no new field, no extra fetch — and the
    // classification is computed once per load, not per row per frame.

    enum WorkspaceKind: String {
        case project, umbrella, worktree, scratch
    }

    private static let scratchPrefixes = [
        "/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/",
    ]
    private static let worktreeMarkers = [
        "/.codex/worktrees/", "/.claude/worktrees/", "/worktrees/", "/.git/worktrees/",
    ]

    /// Which of the four a root is. `all` is needed only for the umbrella test:
    /// a directory is an umbrella when the index also knows what is inside it.
    static func workspaceKind(root: String, in all: [WorkspaceSummary]) -> WorkspaceKind {
        if scratchPrefixes.contains(where: { root.hasPrefix($0) }) { return .scratch }
        if worktreeMarkers.contains(where: { root.contains($0) }) { return .worktree }
        // The home directory itself is never a project.
        let parts = root.split(separator: "/")
        if parts.count == 2, parts[0] == "Users" { return .umbrella }
        // A directory that merely CONTAINS other indexed roots. Two, not one,
        // so a real project with a single vendored checkout stays a project.
        let contained = all.reduce(into: 0) { count, other in
            if other.root != root, other.root.hasPrefix(root + "/") { count += 1 }
        }
        return contained >= 2 ? .umbrella : .project
    }

    /// Recompute the split. Called when a load lands, never from `body`.
    private func recurate(_ loaded: [WorkspaceSummary]) {
        var kinds: [String: WorkspaceKind] = [:]
        var durable: [WorkspaceSummary] = []
        for workspace in loaded {
            let kind = Self.workspaceKind(root: workspace.root, in: loaded)
            kinds[workspace.root] = kind
            if kind == .project { durable.append(workspace) }
        }
        workspaceKinds = kinds
        durableWorkspaces = durable
    }

    /// The badge text for a root that is NOT a durable project — nil for the
    /// ordinary case, so ordinary rows carry nothing extra.
    private func demotedKindLabel(_ root: String) -> String? {
        switch workspaceKinds[root] {
        case .worktree: return "worktree"
        case .scratch: return "scratch"
        case .umbrella: return "folder"
        default: return nil
        }
    }

    /// One line for the pile being held back, honest about what is in it.
    private var demotedSummary: String? {
        var worktree = 0, scratch = 0, umbrella = 0
        for kind in workspaceKinds.values {
            switch kind {
            case .worktree: worktree += 1
            case .scratch: scratch += 1
            case .umbrella: umbrella += 1
            case .project: break
            }
        }
        var parts: [String] = []
        if worktree > 0 { parts.append("\(worktree) worktree\(worktree == 1 ? "" : "s")") }
        if scratch > 0 { parts.append("\(scratch) scratch") }
        if umbrella > 0 { parts.append("\(umbrella) folder\(umbrella == 1 ? "" : "s")") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The short list: device-recent roots first, in recency order, then the
    /// Mac's own order. Never a demoted root, and the current pick is always in
    /// it — a chosen row that vanishes from under the selection marker reads as
    /// a bug.
    private var shortlist: [WorkspaceSummary] {
        let byRoot = Dictionary(durableWorkspaces.map { ($0.root, $0) }, uniquingKeysWith: { a, _ in a })
        var picked: [WorkspaceSummary] = []
        var seen = Set<String>()
        func add(_ workspace: WorkspaceSummary?) {
            guard let workspace, seen.insert(workspace.root).inserted else { return }
            picked.append(workspace)
        }
        add(workspaces.first { $0.root == trimmedProjectPath })
        for root in recentRoots { add(byRoot[root]) }
        // Before falling back to the Mac's own order — which is arbitrary, and
        // on a fresh device is ALL you have — prefer roots the Mac has actually
        // configured a harness for. `defaultHarness` is a real field off the
        // machine, and "this checkout has a coding agent set up in it" is the
        // closest honest proxy for "this is a project you work in". It is not a
        // ranking by agent activity: that would need a project PATH on
        // AgentSummary, which the contract does not carry.
        for workspace in durableWorkspaces where workspace.defaultHarness?.isEmpty == false {
            add(workspace)
        }
        for workspace in durableWorkspaces { add(workspace) }
        return Array(picked.prefix(shortlistLength))
    }

    /// Three, per the operator: enough to be the answer most visits, few enough
    /// that the screen still reads as mostly air.
    private var shortlistLength: Int { 3 }

    /// What the lane actually renders: the shortlist at rest, the curated
    /// matches when the picker is open (durable first, then the swept-up rest,
    /// because a search for "openscout" on the real Mac returns four of them).
    private var visibleWorkspaces: [WorkspaceSummary] {
        guard isPickerOpen else { return shortlist }
        let matches = filteredWorkspaces
        let durable = matches.filter { workspaceKinds[$0.root] == .project }
        let rest = matches.filter { workspaceKinds[$0.root] != .project }
        return durable + rest
    }

    /// The roots THIS DEVICE last started work in — the only ranking signal that
    /// is actually backed today. `AgentSummary` carries no project path
    /// (ScoutCapabilities/Listing.swift), so ordering by "where your agents are"
    /// is not available, and inventing an order would be worse than none.
    private var recentRoots: [String] {
        recentRootsRaw.split(separator: "\n").map(String.init)
    }

    private func rememberRoot(_ root: String) {
        guard !root.isEmpty, !root.contains("\n") else { return }
        var list = recentRoots.filter { $0 != root }
        list.insert(root, at: 0)
        recentRootsRaw = list.prefix(8).joined(separator: "\n")
    }

    /// ② PROJECT. Three rows at rest, the curated inventory when the picker is
    /// open. Three is enough because the three are CHOSEN — device-recency
    /// first, then the Mac's own order, and never a swept-up root.
    @ViewBuilder
    private var projectList: some View {
        if isPickerOpen {
            // Open, the lane scrolls and stops well short of the composer.
            ScrollView(showsIndicators: false) {
                projectRows
            }
            .scrollDismissesKeyboard(.interactively)
            .frame(maxWidth: .infinity, maxHeight: 268, alignment: .top)
        } else {
            // Closed, it is EXACTLY as tall as its rows. It must not be a
            // ScrollView here: a scroll view is greedy, and a greedy view in
            // this stack eats the air the calm layout is made of — the lane
            // ends up pinned under the masthead instead of hugging the
            // composer, which is the whole shape.
            projectRows
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var projectRows: some View {
        VStack(alignment: .leading, spacing: 0) {
                if isPickerOpen, let typedPath {
                    projectRow(
                        path: typedPath,
                        name: (typedPath as NSString).lastPathComponent,
                        harness: nil,
                        kind: nil,
                        isTyped: true
                    )
                }
                ForEach(visibleWorkspaces) { workspace in
                    projectRow(
                        path: workspace.root,
                        name: workspace.projectName.isEmpty ? workspace.title : workspace.projectName,
                        harness: workspace.defaultHarness,
                        // The badge only appears where it is news: in the open
                        // picker, on a root that is not a durable project.
                        kind: isPickerOpen ? demotedKindLabel(workspace.root) : nil,
                        isTyped: false
                    )
                }
            if visibleWorkspaces.isEmpty, typedPath == nil { projectListNotice }
        }
        // The column has to CLAIM the width, or a short list (or a one-line
        // notice) sizes the stack to itself and the enclosing view centres it.
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// One project.
    ///
    /// The pick carries a left accent BAR rather than a dot — these are flat
    /// full-width list rows, which is the one shape the house rules let an edge
    /// marker sit on, and it is the same travelling marker the runtime panel's
    /// harness rail uses. Same act, same grammar.
    ///
    /// The mark on the left is the harness this workspace actually recommends
    /// (`defaultHarness`, straight off the Mac), so the row answers "and what
    /// will run here" before you have to look down at the composer's chip — and
    /// picking the project is visibly what re-points that chip.
    private func projectRow(path: String, name: String, harness: String?, kind: String?, isTyped: Bool) -> some View {
        let selected = trimmedProjectPath == path
        return Button {
            // TRAVEL, not teleport. The marker is a `matchedGeometryEffect`, so
            // without a transaction around the write it simply reappears on the
            // new row and the one piece of continuity in the list is thrown
            // away. Same motion the runtime panel's harness rail uses for the
            // same act.
            withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.travel)) {
                projectPath = path
            }
            // Picking from the open picker is the end of picking.
            if isPickerOpen {
                withAnimation(reduceMotion ? nil : ScoutMotion.grow) { isPickerOpen = false }
                projectQuery = ""
                searchFocused = false
            }
        } label: {
            HStack(spacing: HudSpacing.md) {
                Group {
                    if isTyped {
                        Glyphic(kind: .folder, size: 13)
                    } else if let harness, HarnessMark.identifies(harness) {
                        HarnessMark(harness: harness, size: 13)
                    }
                }
                // A fixed slot whether or not there is a mark, so every name in
                // the list starts on one x.
                .frame(width: 14)
                .foregroundStyle(selected ? ScoutPalette.accent : ScoutInk.dim)

                // The name holds the row. It takes layout priority over the
                // path, so under pressure the PATH is the side that gives —
                // on the shipped surface `Openscout Work List Wt` and its
                // `/private/tmp` tail overlapped outright.
                Text(name)
                    .font(HudFont.ui(HudTextSize.sm, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? ScoutPalette.ink : ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(2)

                if let kind {
                    Text(kind)
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.7)
                        .textCase(.uppercase)
                        .foregroundStyle(ScoutInk.dim)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
                        )
                        .fixedSize()
                        .layoutPriority(1)
                }

                Spacer(minLength: HudSpacing.md)

                Text(isTyped ? "USE THIS PATH" : abbreviate((path as NSString).deletingLastPathComponent))
                    .font(HudFont.mono(isTyped ? HudTextSize.micro : HudTextSize.xxs, weight: isTyped ? .semibold : .regular))
                    .tracking(isTyped ? 0.6 : 0)
                    .foregroundStyle(isTyped ? ScoutPalette.accent : ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .frame(maxWidth: 128, alignment: .trailing)
                    .layoutPriority(0)
            }
            .padding(.leading, HudSpacing.lg)
            .frame(height: 38)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .leading) {
                if selected {
                    Capsule()
                        .fill(ScoutPalette.accent)
                        .frame(width: 2, height: 18)
                        .matchedGeometryEffect(id: "project-marker", in: projectMarker)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isTyped ? "Use path \(path)" : name)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// Honest about which nothing this is: still fetching, nothing matched, or
    /// no Mac to ask.
    @ViewBuilder
    private var projectListNotice: some View {
        let text: String = {
            if isLoadingWorkspaces { return "Looking for projects…" }
            if onlineMachines.isEmpty { return "Connect a Mac to choose a project." }
            if !projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "No project matches. Type a full path to use one anyway."
            }
            return "This Mac hasn't reported any projects yet."
        }()
        Text(text)
            .font(HudFont.mono(HudTextSize.xs))
            .foregroundStyle(ScoutInk.dim)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, HudSpacing.lg)
            .padding(.vertical, HudSpacing.xl)
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(ScoutInk.dim)
    }

    private var projectLeaf: String {
        (trimmedProjectPath as NSString).lastPathComponent
    }

    private var projectParent: String {
        let parent = (trimmedProjectPath as NSString).deletingLastPathComponent
        return parent == "/" || parent == trimmedProjectPath ? "" : parent
    }

    private var trimmedProjectPath: String {
        projectPath.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Composer
    //
    // The SAME object as Home's front-door composer: `ScoutMessageComposer` at
    // `lead` density in the `pill` appearance, with attach anchoring the base
    // row and the runtime chip in the tools slot. What used to live here was a
    // second implementation of that contract — its own TextEditor and
    // placeholder, its own "+" attach, its own mic and pulse and waveform, its
    // own accent-filled send, its own model token. Every one of those is a way
    // for the two screens to drift apart, and several already had.
    //
    // Two things stay New's own, because they are genuinely different here:
    //  · Send is armed by having a PROJECT, not by having typed something —
    //    "leave blank to open a fresh session" is a real flow, which is exactly
    //    what the contract's `canSend` override exists for.
    //  · The keyboard is not raised on arrival. Home opens composing; New opens
    //    on a choice, and only a seeded ask (Home routing an ask here) asks for
    //    the keyboard.

    private var composerDock: some View {
        ScoutMessageComposer(
            text: $instructions,
            // Short enough to survive the lane at `lead`'s 16pt — the long form
            // ("…to open a fresh session") truncated, which taught nobody
            // anything. Send arms on having a project, so the blank-is-fine
            // affordance is discoverable from the control itself.
            placeholder: "Describe the task, or leave blank…",
            rows: 1,
            autoFocus: composerWantsKeyboard && isActive,
            onSend: submit,
            canSend: canSubmit && !isSubmitting,
            sending: isSubmitting,
            attach: ScoutComposerAttach(
                onPhoto: { showPhotoPicker = true },
                onFile: { showFileImporter = true }
            ),
            attachments: $pendingAttachments,
            error: errorText,
            onFocusChange: { composerWantsKeyboard = $0 },
            density: .lead,
            appearance: .pill
        ) {
            ScoutRuntimeChip(
                harness: harnessId,
                model: selectedFamily.value,
                effort: selectedEffort.label,
                isPicking: showModelPicker,
                onPick: { showModelPicker.toggle() }
            )
        }
        // The runtime panel takes its left and right edges from the composer,
        // so the two read as one column when it opens.
        .scoutRuntimeLane()
        .padding(.top, HudSpacing.xl)
    }

    // MARK: - Attachments
    //
    // The shared composer hands the host two intents rather than a picker, so
    // the surface that has to surface a read failure is the one that owns the
    // pickers. Same shape as Home.

    @MainActor
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        defer { photoItems = [] }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mediaType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? (mediaType == "image/png" ? "png" : "jpg")
            pendingAttachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: "photo-\(pendingAttachments.count + 1).\(ext)")
            )
        }
    }

    private func addFiles(_ result: Result<[URL], Error>) {
        guard let urls = try? result.get() else { return }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)
            let mediaType = type?.preferredMIMEType ?? "application/octet-stream"
            pendingAttachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: url.lastPathComponent)
            )
        }
    }
    // MARK: - Launch
    //
    // ONE seat, directly above the destination lane, for the whole arc of a
    // create: the sweep while the broker is working, the receipt when it
    // answers. Pressing Send used to change nothing on this screen until the
    // conversation pushed itself — on a slow Mac that is a dead beat where the
    // only honest reading is "did that even register". Same seat for both
    // states means the answer arrives where you were already looking.

    @ViewBuilder
    private var launchSlot: some View {
        Group {
            if isSubmitting {
                launchingCard
            } else if let launch {
                resultCard(launch)
            }
        }
        .padding(.bottom, HudSpacing.md)
        // Grows up out of the composer you just pressed Send in, and shrinks
        // back into it when dismissed — this card is that press's answer, so it
        // arrives from where the press was rather than appearing over the lane.
        .transition(
            reduceMotion
                ? .opacity
                : .asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .bottom)),
                    removal: .opacity.combined(with: .scale(scale: 0.97, anchor: .bottom))
                )
        )
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow), value: isSubmitting)
    }

    /// In flight. Names the two things the operator chose — the runtime and the
    /// project — so the wait shows what is being acted on, not just that
    /// something is.
    private var launchingCard: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    HudStatusDot(color: ScoutPalette.accent, size: HudDotSize.medium)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Starting…")
                            .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                        Text("\(selectedHarnessLabel) in \(projectLeaf.isEmpty ? "the selected project" : projectLeaf)")
                            .font(HudFont.ui(HudTextSize.xs))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 0)
                }
                LaunchTrace()
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Starting \(selectedHarnessLabel) in \(projectLeaf)")
    }

    // MARK: - Result

    private func resultCard(_ launch: LaunchRecord) -> some View {
        let promptSent = launch.promptSent
        return HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(alignment: .top, spacing: HudSpacing.md) {
                    HudStatusDot(color: promptSent ? ScoutPalette.statusOk : ScoutPalette.statusWarn, size: HudDotSize.medium)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(promptSent ? "Prompt sent" : "Session ready")
                            .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                        Text(resultSummary(launch))
                            .font(HudFont.ui(HudTextSize.xs))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(2)
                    }
                    Spacer(minLength: HudSpacing.sm)
                    // The card is a receipt, and a receipt you cannot put down
                    // is litter. It survives navigating into the conversation
                    // and back — that is the point of it — so the only thing
                    // that can retire it is the operator saying so.
                    Button {
                        withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow)) {
                            self.launch = nil
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(ScoutInk.dim)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss")
                }
                idRow("conversation", launch.outcome.conversationId)
                idRow("message", launch.outcome.messageId)
                idRow("flight", launch.outcome.flightId)
                idRow("agent", launch.outcome.agentId)
                if let conversationId = launch.outcome.conversationId, !conversationId.isEmpty {
                    HStack {
                        Spacer()
                        HudButton("Open conversation", icon: "bubble.left.and.bubble.right", style: .secondary) {
                            route = ConversationRoute(id: conversationId, title: launch.title)
                        }
                    }
                    .padding(.top, HudSpacing.xs)
                }
            }
        }
    }

    private func resultSummary(_ launch: LaunchRecord) -> String {
        let project = launch.projectLeaf.isEmpty ? "the selected project" : launch.projectLeaf
        if launch.promptSent {
            return "\(launch.harnessLabel) is working in \(project)."
        }
        return "No prompt was sent; open the conversation to start."
    }

    private func idRow(_ label: String, _ value: String?) -> some View {
        HStack(spacing: HudSpacing.md) {
            Text(label)
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 96, alignment: .leading)
            Text(value ?? "—")
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.ink)
            Spacer(minLength: 0)
        }
    }

    private var canSubmit: Bool {
        !trimmedProjectPath.isEmpty
    }

    private func makeSpec(attachments: [MessageAttachment]? = nil) -> SessionInitiationSpec {
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        return SessionInitiationSpec(
            target: .init(projectPath: trimmedProjectPath),
            execution: .init(harness: harnessId, model: selectedFamily.value, reasoningEffort: selectedEffort.value, session: .new),
            agent: .init(persistence: "sticky"),
            seed: .init(
                instructions: trimmedInstructions.isEmpty ? nil : trimmedInstructions,
                attachments: attachments
            )
        )
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        errorText = nil
        // What this create IS, read off the form while the form still describes
        // it. Everything downstream — the in-flight card, the receipt, the
        // pushed conversation's title — uses these rather than re-reading state
        // that is about to be reset.
        let launchedHarness = selectedHarnessLabel
        let launchedProject = projectLeaf
        let launchedTitle = sessionTitle
        // The previous create's receipt belongs to the previous create; it
        // leaves before this one's sweep takes the seat.
        withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow)) {
            launch = nil
            isSubmitting = true
        }
        // The one ranking signal this surface owns: you started work here, so
        // this root leads the short list next time.
        rememberRoot(trimmedProjectPath)
        // Hand the keyboard back: the composer resigns when nobody is asking
        // for it, and the surface is about to push a conversation.
        composerWantsKeyboard = false
        searchFocused = false
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let attachments = pendingAttachments
        pendingAttachments = []
        Task {
            do {
                let hosted = try await upload(attachments)
                let spec = makeSpec(attachments: hosted)
                let outcome = try await activeClient.startSession(spec)
                let record = LaunchRecord(
                    outcome: outcome,
                    harnessLabel: launchedHarness,
                    projectLeaf: launchedProject,
                    title: launchedTitle
                )
                // ACCEPTED — and only now does the draft go. One transaction, so
                // the sweep hands the seat to the receipt while the composer
                // collapses back to a single empty line behind it.
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow)) {
                    isSubmitting = false
                    resetComposition()
                    launch = record
                }
                // Land in the new conversation when the broker returns one.
                if let conversationId = outcome.conversationId {
                    route = ConversationRoute(id: conversationId, title: launchedTitle)
                }
            } catch {
                // Nothing landed, so nothing is cleared: the draft and the
                // staged files are still the operator's, and they are about to
                // need them for the retry.
                pendingAttachments = attachments
                withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow)) {
                    isSubmitting = false
                }
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// The composer after a create the broker ACCEPTED: empty draft, nothing
    /// staged, no stale error, and the runtime back on this project's own
    /// recommendation.
    ///
    /// Called only on the success path. A create that failed still owns your
    /// draft — clearing it would destroy words nothing ever took, and the retry
    /// is the very next thing you want to do.
    ///
    /// The DESTINATION deliberately survives. Project and host are where you are
    /// working, not what you just wrote; re-picking the repo before every
    /// follow-up task is exactly the friction this surface exists to remove.
    private func resetComposition() {
        instructions = ""
        pendingAttachments = []
        errorText = nil
        effortId = ComposerEffortOption.defaultId
        // The seeded pick has had its run; the workspace recommendation is free
        // to lead again for the next task.
        runtimePinned = false
        applyWorkspaceDefault()
        familyId = pickerHarnesses.first { $0.id == harnessId }?.defaultFamily.id ?? familyId
        // Nothing is staged to pick FOR any more, so no panel should be left
        // standing over an empty composer.
        showModelPicker = false
        if isPickerOpen {
            isPickerOpen = false
            projectQuery = ""
        }
    }

    private func upload(_ attachments: [ScoutComposerAttachment]) async throws -> [MessageAttachment]? {
        guard !attachments.isEmpty else { return nil }
        var hosted: [MessageAttachment] = []
        for attachment in attachments {
            hosted.append(try await activeClient.uploadAttachment(attachment.upload))
        }
        return hosted
    }

    /// Title for the pushed conversation: the project's last path component,
    /// falling back to a generic label.
    private var sessionTitle: String {
        let last = projectLeaf
        return last.isEmpty ? "New session" : last
    }

    #if DEBUG
    /// The head of a REAL `mobile/workspaces` reply, transcribed off the phone
    /// (2026-07-28, `PROJECT 57`), plus enough durable roots to make the curated
    /// split visible. Names are verbatim, including the inconsistent casing the
    /// index produces. Only reachable via `SCOUT_WORKSPACE_FIXTURE=1`.
    static let captureFixture: [WorkspaceSummary] = {
        let both = [
            WorkspaceSummary.Harness(harness: "claude", readiness: .ready),
            WorkspaceSummary.Harness(harness: "codex", readiness: .ready),
        ]
        func ws(_ name: String, _ root: String, _ harness: String?) -> WorkspaceSummary {
            WorkspaceSummary(
                id: root, title: name, projectName: name, root: root,
                defaultHarness: harness, harnesses: both
            )
        }
        return [
            ws("Art", "/Users/art", nil),
            ws("Dev", "/Users/art/dev", nil),
            ws("Openscout", "/Users/art/.codex/worktrees/a5d0f1c2/openscout", "claude"),
            ws("Openscout Work List Wt", "/private/tmp/openscout-work-list-wt", "claude"),
            ws("openscout", "/Users/art/.codex/worktrees/c50e77a1/openscout", "codex"),
            ws("openscout", "/Users/art/.codex/worktrees/b4229d30/openscout", "codex"),
            ws("talkie", "/tmp/talkie", "claude"),
            ws("All", "/Users/art/dev/all", nil),
            ws("Action", "/Users/art/dev/action", nil),
            ws("Arach Io", "/Users/art/dev/arach.io", "claude"),
            ws("openscout", "/Users/art/.codex/worktrees/7f31b8c4/openscout", "codex"),
            ws("hudson", "/Users/art/.codex/worktrees/9ab4e025/hudson", "codex"),
            ws("Scout Ios Nav", "/private/tmp/scout-ios-nav", "claude"),
            ws("Studio Craft Pass", "/private/tmp/studio-craft-pass", "claude"),
            ws("Src", "/Users/art/src", nil),
            ws("openscout", "/Users/art/dev/openscout", "claude"),
            ws("talkie", "/Users/art/dev/talkie", "claude"),
            ws("hudson", "/Users/art/dev/hudson", "codex"),
            ws("lattices", "/Users/art/dev/lattices", "claude"),
            ws("studio", "/Users/art/dev/studio", "claude"),
            ws("herdr", "/Users/art/dev/herdr", "claude"),
            ws("parakeet-ios", "/Users/art/dev/parakeet-ios", "claude"),
            ws("glyphd", "/Users/art/dev/glyphd", nil),
            ws("oscout-net", "/Users/art/dev/oscout-net", "codex"),
            ws("kernel-notes", "/Users/art/src/kernel-notes", nil),
            ws("wasm-lab", "/Users/art/src/wasm-lab", "codex"),
            ws("rustlings", "/Users/art/src/rustlings", nil),
        ]
    }()
    #endif
}

/// The in-flight sweep on the launching card.
///
/// Indeterminate on purpose: the broker reports no progress for a create, and a
/// bar that claims a fraction it does not have is a lie told smoothly. A segment
/// travelling a hairline says "working" and claims nothing more than that.
///
/// Sibling of ConnectScreen's `LocalScanTrace` — same act (a wait we cannot
/// quantify), so deliberately the same shape. Under Reduce Motion it parks
/// centred: the mark still reads as an active state, it just doesn't travel.
private struct LaunchTrace: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var travels = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(ScoutHairline.standard)
                    .frame(height: HudStrokeWidth.standard)

                Capsule()
                    .fill(ScoutPalette.accent)
                    .frame(width: 54, height: 2)
                    .offset(
                        x: reduceMotion
                            ? max(0, proxy.size.width / 2 - 27)
                            : (travels ? max(0, proxy.size.width - 54) : 0)
                    )
            }
        }
        .frame(height: 2)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.05).repeatForever(autoreverses: true)) {
                travels = true
            }
        }
        .accessibilityHidden(true)
    }
}
