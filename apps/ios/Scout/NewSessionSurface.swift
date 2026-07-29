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
    /// Why the last inventory read failed, when it did. Kept apart from
    /// `workspaces.isEmpty` because the two are DIFFERENT facts: a Mac that
    /// answered with nothing has reported no projects, and a Mac we never got an
    /// answer out of has reported nothing at all. Conflating them is how the
    /// surface came to claim "This Mac hasn't reported any projects yet" over a
    /// timed-out RPC — an assertion about the Mac we had no standing to make.
    @State private var loadFailure: String?
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
    @State private var result: SessionInitiationResult?
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
                if let result {
                    resultCard(result)
                        .padding(.bottom, HudSpacing.md)
                        .cockpitEntrance(index: 2, phase: entrance)
                }
                destination
                    .cockpitEntrance(index: 0, phase: entrance)
                composerDock
                    .cockpitEntrance(index: 1, phase: entrance)
                keyboardBar
                // On a PHONE the block stays bottom-anchored: the composer is a
                // thumb target and belongs against the tab bar. On an iPad there
                // is no thumb and no reach argument — only a 13" sheet of glass
                // with the whole working column shoved into its bottom quarter
                // and ~75% void above. A second flexible spacer splits the air
                // evenly and the block sits on the centre line, which is what
                // makes it read as composed rather than stretched.
                if layout.isRegularWidth {
                    Spacer(minLength: 0)
                }
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
            // `fleetRevision` belongs in this key, exactly as it does in Home's
            // (`HomeSurface.reloadKey`). Without it New fetched ONCE, and a first
            // fire that landed while the bridge was still handshaking threw
            // `notConnected`, got swallowed, and left the surface empty for the
            // rest of the session with no way back. Now a fleet that comes up
            // re-asks by itself.
            .task(id: "\(reloadToken)|\(model.fleetRevision)|\(isActive)") {
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
            loadFailure = nil
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
        // fetch — only a successful load replaces it. But DO record why it
        // failed: the previous `try?` sank every timeout, decode miss and
        // not-yet-connected into the same silent no-op, and the empty state then
        // spoke for the Mac. Measured 2026-07-28: this Mac answers
        // `mobile/workspaces` with 58 rows in ~10.7s, against the bridge's 15s
        // RPC budget — so a real inventory losing that race is the common case,
        // not an edge one.
        let loaded: [WorkspaceSummary]
        do {
            loaded = try await activeClient.listWorkspaces(query: nil, limit: 200)
        } catch {
            loadFailure = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return
        }
        loadFailure = nil
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
            .fill(HudHairline.standard)
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
            } else {
                hostPicker(machines)
            }
            Spacer(minLength: 0)
        }
        // ① of the destination section, and in the common case — one paired Mac
        // — it costs exactly this one line. No eyebrow row of its own, no band,
        // no rule above it. An earlier pass charged host full price (eyebrow +
        // row + rule) on a screen where it is usually a readout.
        .frame(height: 30)
    }

    /// Which Mac, as a PICK rather than a caption. The old line rendered a lone
    /// paired Mac as a dot and a name — indistinguishable from a label, so the
    /// fact that a host is choosable at all was invisible until a second Mac
    /// paired. It now wears the runtime chip's seat (card fill, hairline rim,
    /// trailing chevron) — the same grammar Home's accessory pills name as "the
    /// runtime chip's grammar", and the same one the composer's model token uses
    /// two rows below — so "this opens something" reads at a glance and the two
    /// pickers on the surface look like siblings.
    ///
    /// The menu offers exactly the Macs that are paired. Offline ones are listed
    /// and disabled rather than hidden: a Mac you know about that has gone to
    /// sleep is information, and dropping it turns "your Mac is asleep" into
    /// "you have no Macs".
    private func hostPicker(_ machines: [AppModel.PairedMachine]) -> some View {
        let active = activeMachine
        let seat = Capsule(style: .continuous)
        return Menu {
            ForEach(machines) { machine in
                Button {
                    guard machine.isOnline else { return }
                    selectedMachineId = machine.id
                } label: {
                    Text(machine.isOnline ? machine.name : "\(machine.name) — offline")
                }
                .disabled(!machine.isOnline)
            }
        } label: {
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(color: (active?.isOnline ?? false) ? HudPalette.accent : ScoutInk.dim, size: 6)
                Text(active?.name ?? "Choose a Mac")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let active, !active.isOnline {
                    Text("offline")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.6)
                        .textCase(.uppercase)
                        .foregroundStyle(ScoutInk.dim)
                }
                Glyphic.chevron(.bottom, size: 9)
                    .foregroundStyle(ScoutInk.dim)
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, 3)
            .background(seat.fill(ScoutSurface.card))
            .overlay(seat.stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            .contentShape(seat)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityLabel("Host: \(active?.name ?? "none"). Choose a Mac")
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
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
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
                    .fill(HudHairline.subtle)
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
            // 268 is the phone's budget — what is left once a raised keyboard
            // and the composer have taken theirs. An iPad has neither problem
            // and a foot of unused glass either side of the column, so the open
            // picker there shows a section and a half instead of clipping the
            // first one mid-row.
            .frame(maxWidth: .infinity, maxHeight: layout.isRegularWidth ? 440 : 268, alignment: .top)
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

    /// The four piles the curation already computes, in reading order. Durable
    /// projects lead because they are what you almost always want; the swept-up
    /// kinds follow in descending trustworthiness.
    private static let kindOrder: [WorkspaceKind] = [.project, .worktree, .scratch, .umbrella]

    private func kindHeading(_ kind: WorkspaceKind) -> String {
        switch kind {
        case .project: return "Projects"
        case .worktree: return "Worktrees"
        case .scratch: return "Scratch"
        case .umbrella: return "Folders"
        }
    }

    /// The open picker, grouped. `moreFoot` already names the pile it is holding
    /// back — "5 worktrees · 4 scratch · 3 folders" — so opening it into one flat
    /// run of 58 rows contradicted the summary that got you there. The counts
    /// were always the outline; these are the sections they describe.
    ///
    /// Grouping is off the SAME `workspaceKinds` map the summary counts, so the
    /// two can never disagree, and it costs no extra pass: the classification is
    /// computed once per load in `recurate`.
    private var groupedVisibleWorkspaces: [(kind: WorkspaceKind, rows: [WorkspaceSummary])] {
        var buckets: [WorkspaceKind: [WorkspaceSummary]] = [:]
        for workspace in visibleWorkspaces {
            buckets[workspaceKinds[workspace.root] ?? .project, default: []].append(workspace)
        }
        return Self.kindOrder.compactMap { kind in
            guard let rows = buckets[kind], !rows.isEmpty else { return nil }
            return (kind, rows)
        }
    }

    @ViewBuilder
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
            if isPickerOpen {
                // Open: sectioned by kind. A heading only appears where there is
                // more than one pile to tell apart — a search that matches three
                // durable projects should not grow a "PROJECTS" banner over an
                // otherwise obvious list.
                let groups = groupedVisibleWorkspaces
                ForEach(groups, id: \.kind) { group in
                    if groups.count > 1 {
                        sectionHeading(kindHeading(group.kind), count: group.rows.count)
                    }
                    ForEach(group.rows) { workspace in
                        projectRow(
                            path: workspace.root,
                            name: displayName(for: workspace),
                            harness: workspace.defaultHarness,
                            // The per-row badge is redundant under a heading that
                            // already says which pile this is.
                            kind: groups.count > 1 ? nil : demotedKindLabel(workspace.root),
                            isTyped: false
                        )
                    }
                }
            } else {
                ForEach(visibleWorkspaces) { workspace in
                    projectRow(
                        path: workspace.root,
                        name: displayName(for: workspace),
                        harness: workspace.defaultHarness,
                        kind: nil,
                        isTyped: false
                    )
                }
            }
            if visibleWorkspaces.isEmpty, typedPath == nil { projectListNotice }
        }
        // The column has to CLAIM the width, or a short list (or a one-line
        // notice) sizes the stack to itself and the enclosing view centres it.
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A section rule in the lane's own instrument language — the `eyebrow`
    /// already used for HOST, plus the count and a filler rule. Same idea as
    /// Home's `laneHeader`, at this surface's tighter scale.
    private func sectionHeading(_ title: String, count: Int) -> some View {
        HStack(spacing: HudSpacing.sm) {
            eyebrow(title)
            Text("\(count)")
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(ScoutInk.dim)
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .padding(.leading, HudSpacing.lg)
        .frame(height: 26)
    }

    /// What to call a project.
    ///
    /// The Mac's `projectName` is a PRETTIFIED string — the relay registry
    /// persists a title-cased display name, so `/Users/art/dev/arach.io` arrives
    /// as "Arach Io" and `openscout-work-list-wt` as "Openscout Work List Wt".
    /// Neither is a thing that exists on that disk. The directory name is the
    /// verbatim ground truth and the only name the operator ever typed, so the
    /// row shows that and keeps the server's string only as a fallback for a
    /// root with no last component to speak of.
    private func displayName(for workspace: WorkspaceSummary) -> String {
        let leaf = (workspace.root as NSString).lastPathComponent
        if !leaf.isEmpty, leaf != "/" { return leaf }
        return workspace.projectName.isEmpty ? workspace.title : workspace.projectName
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
            projectPath = path
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
                // Monochrome, always. The harness mark is PROVENANCE — which
                // runtime this checkout recommends — not a live signal, and
                // tinting the selected one emerald spent the screen's one accent
                // on a fact the left bar and the bolder name already carry. The
                // selection reads through weight and ink here; emerald stays with
                // the host dot, which is the only thing on this surface reporting
                // something live.
                .foregroundStyle(selected ? ScoutInk.muted : ScoutInk.dim)

                // The name holds the row. It takes layout priority over the
                // path, so under pressure the PATH is the side that gives —
                // on the shipped surface `Openscout Work List Wt` and its
                // `/private/tmp` tail overlapped outright.
                Text(name)
                    .font(HudFont.ui(HudTextSize.sm, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? HudPalette.ink : ScoutInk.muted)
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
                                .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
                        )
                        .fixedSize()
                        .layoutPriority(1)
                }

                Spacer(minLength: HudSpacing.md)

                Text(isTyped ? "USE THIS PATH" : abbreviate((path as NSString).deletingLastPathComponent))
                    .font(HudFont.mono(isTyped ? HudTextSize.micro : HudTextSize.xxs, weight: isTyped ? .semibold : .regular))
                    .tracking(isTyped ? 0.6 : 0)
                    // Weight and tracking carry this one, not colour: it is an
                    // affordance, not a signal, and the surface has one accent to
                    // spend.
                    .foregroundStyle(isTyped ? ScoutInk.muted : ScoutInk.dim)
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
                        .fill(HudPalette.accent)
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

    /// Honest about which nothing this is — and there are FOUR, not one.
    ///
    /// The version this replaces had a single fall-through sentence, "This Mac
    /// hasn't reported any projects yet", and reached it from every dead end
    /// including a failed fetch. That sentence is a claim about the Mac. Making
    /// it after an RPC we never got an answer out of is asserting something we
    /// have no standing to assert — and on this fleet it was flatly untrue: the
    /// Mac holds 58 workspaces and answers in ~10.7s, against a 15s client
    /// budget it regularly loses.
    ///
    /// So: fetching gets ghost rows and a caption that says it is fetching; a
    /// failed read says so and offers the one move that can fix it; a genuine
    /// empty says the Mac reported nothing; and no Mac at all says connect one.
    @ViewBuilder
    private var projectListNotice: some View {
        if isLoadingWorkspaces {
            projectLoadingSkeleton
        } else if let loadFailure {
            projectLoadFailed(loadFailure)
        } else {
            noticeLine(
                {
                    if onlineMachines.isEmpty { return "Connect a Mac to choose a project." }
                    if !projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        return "No project matches. Type a full path to use one anyway."
                    }
                    return "This Mac hasn't reported any projects yet."
                }()
            )
        }
    }

    private func noticeLine(_ text: String) -> some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.xs))
            .foregroundStyle(ScoutInk.dim)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, HudSpacing.lg)
            .padding(.vertical, HudSpacing.xl)
    }

    /// The lane, holding its own shape while the Mac is asked.
    ///
    /// Three ghost rows on the real 38pt `projectRow` geometry — mark slot, name,
    /// trailing path — so the populated and loading states have the SAME
    /// silhouette and nothing jumps when the answer lands. Built with Home's
    /// recipe exactly (`HomeLoadingSkeleton`): real strings in the real fonts,
    /// dimmed, `.redacted(reason: .placeholder)`, `.opacity(0.46)` — redaction
    /// rather than invented data, because a placeholder that reads as content is
    /// a lie told briefly.
    ///
    /// The caption carries the progress: ghost rows alone are ambiguous between
    /// "fetching" and "broken", and this state must be unmistakably transient.
    private var projectLoadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<3, id: \.self) { index in
                HStack(spacing: HudSpacing.md) {
                    Circle()
                        .fill(ScoutInk.dim)
                        .frame(width: 11, height: 11)
                        .frame(width: 14)
                    Text(["openscout", "hudson", "talkie"][index])
                        .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    Spacer(minLength: HudSpacing.md)
                    Text("~/dev")
                        .font(HudFont.mono(HudTextSize.xxs))
                }
                .padding(.leading, HudSpacing.lg)
                .frame(height: 38)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(ScoutInk.dim)
            .redacted(reason: .placeholder)
            .opacity(0.46)

            HStack(spacing: HudSpacing.sm) {
                ProgressView()
                    .controlSize(.mini)
                    .tint(ScoutInk.dim)
                Text("Looking for projects…")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.dim)
            }
            .padding(.leading, HudSpacing.lg)
            .frame(height: 30)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Looking for projects")
    }

    /// A read that failed, said plainly, with the one move that can change it.
    /// Retry rather than Connect: the Mac is paired and online — the request is
    /// what did not come back.
    private func projectLoadFailed(_ detail: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text("Couldn't read this Mac's projects.")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
            Text(detail)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await loadWorkspaces() }
            } label: {
                HStack(spacing: HudSpacing.xs) {
                    // The same icon MissionControl's `retryRecovery` uses, so a
                    // retry looks like a retry wherever a Scout surface offers one.
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Retry")
                }
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
                .padding(.vertical, HudSpacing.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Retry reading this Mac's projects")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, HudSpacing.lg)
        .padding(.vertical, HudSpacing.lg)
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
    // MARK: - Result

    private func resultCard(_ result: SessionInitiationResult) -> some View {
        let promptSent = result.messageId?.isEmpty == false || result.flightId?.isEmpty == false
        return HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    HudStatusDot(color: promptSent ? HudPalette.statusOk : HudPalette.statusWarn, size: HudDotSize.medium)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(promptSent ? "Prompt sent" : "Session ready")
                            .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                            .foregroundStyle(HudPalette.ink)
                        Text(resultSummary(promptSent: promptSent))
                            .font(HudFont.ui(HudTextSize.xs))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(2)
                    }
                }
                idRow("conversation", result.conversationId)
                idRow("message", result.messageId)
                idRow("flight", result.flightId)
                idRow("agent", result.agentId)
                if let conversationId = result.conversationId, !conversationId.isEmpty {
                    HStack {
                        Spacer()
                        HudButton("Open conversation", icon: "bubble.left.and.bubble.right", style: .secondary) {
                            route = ConversationRoute(id: conversationId, title: sessionTitle)
                        }
                    }
                    .padding(.top, HudSpacing.xs)
                }
            }
        }
    }

    private func resultSummary(promptSent: Bool) -> String {
        let project = projectLeaf.isEmpty ? "the selected project" : projectLeaf
        if promptSent {
            return "\(selectedHarnessLabel) is working in \(project)."
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
                .foregroundStyle(HudPalette.ink)
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
        isSubmitting = true
        // The seeded pick has had its run; from here the workspace default is
        // free to lead again.
        runtimePinned = false
        errorText = nil
        result = nil
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
                isSubmitting = false
                result = outcome
                // Land in the new conversation when the broker returns one.
                if let conversationId = outcome.conversationId {
                    route = ConversationRoute(id: conversationId, title: sessionTitle)
                }
            } catch {
                pendingAttachments = attachments
                isSubmitting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
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
