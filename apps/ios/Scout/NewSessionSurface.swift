import SwiftUI
import Foundation
import HudsonUI
import HudsonVoice
import ScoutCapabilities

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
    /// One-shot prompt seed (Home's inline ask composer routes here with typed
    /// text). Consumed on change: lands in the prompt box, focuses it, clears
    /// itself. A binding because this surface stays mounted for the app
    /// lifetime, so init-time state would never reseed.
    @Binding var promptSeed: String?

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
    @State private var showModelPicker = false
    /// Machine-backed workspaces from the connected Mac (`mobile/workspaces`),
    /// each carrying the harnesses actually installed there. Empty until loaded /
    /// when offline, in which case the harness picker falls back to the curated
    /// catalog below.
    @State private var workspaces: [WorkspaceSummary] = []
    @State private var showProjectPicker = false
    @State private var isSubmitting = false
    @State private var result: SessionInitiationResult?
    @State private var errorText: String?
    @State private var pendingAttachments: [ScoutComposerAttachment] = []
    @State private var route: ConversationRoute?
    @FocusState private var instructionsFocused: Bool
    /// Nav mode (tabs/crown) — crown mode reserves no bottom chrome, so the
    /// composer pads itself clear of the floating crown (CrownMetric.bottomReserve).
    @AppStorage(ScoutNavMode.storageKey) private var navModeRaw = ScoutNavMode.default.rawValue

    /// Shared on-device dictation (Parakeet via Vox + Apple fallback), injected at
    /// the app root — the same controller the Comms composer and Settings use.
    @Environment(HudDictation.self) private var voice
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scoutLayout) private var layout
    @State private var micPulse = false
    @StateObject private var entrance = CockpitEntrancePhase()

    /// Definite content width inside the surface padding — the same discipline
    /// Home uses so wide rows (the agent row, the Start button) fit and truncate
    /// within the screen instead of inflating the column and clipping off the
    /// right edge on a scaled/native phone.
    private var laneWidth: CGFloat { max(0, layout.designWidth - layout.surfacePadding * 2) }

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
        return ComposerModelHarness.catalog.map { HarnessChoice(id: $0.id, label: $0.label, readiness: nil) }
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
        var plates = ComposerModelHarness.catalog.filter { entry in
            choices.contains { $0.id == entry.id }
        }
        for choice in choices where !plates.contains(where: { $0.id == choice.id }) {
            plates.append(.fallback(id: choice.id, label: choice.label))
        }
        return plates.isEmpty ? ComposerModelHarness.catalog : plates
    }

    /// The picked model family — resolves through the same tolerant path the
    /// popover uses so a stale id (e.g. after a harness switch) lands on the
    /// harness's default instead of vanishing.
    private var selectedFamily: ComposerModelFamily {
        let harness = pickerHarnesses.first { $0.id == harnessId } ?? pickerHarnesses[0]
        return harness.families.first { $0.id == familyId } ?? harness.defaultFamily
    }

    var body: some View {
        // Fill the screen height (no scroll) so the Prompt box can grow into the
        // space between the agent row and the Start button. The column is pinned
        // to a DEFINITE lane width, left-anchored, with a trailing Spacer absorbing
        // any surplus — so wide rows truncate within the lane instead of inflating
        // the column and dragging the Start button (and agent row) off the edge.
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                topRow
                    .cockpitEntrance(index: 0, phase: entrance)
                instructionsSection
                    .frame(maxHeight: .infinity)
                    .cockpitEntrance(index: 1, phase: entrance)
                if let errorText {
                    Text(errorText)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.statusError)
                        .fixedSize(horizontal: false, vertical: true)
                        .cockpitEntrance(index: 2, phase: entrance)
                }
                if let result {
                    resultCard(result)
                        .cockpitEntrance(index: 3, phase: entrance)
                }
            }
            .frame(width: laneWidth, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .top)
            Spacer(minLength: 0)
        }
        .padding(.leading, layout.surfacePadding)
        .padding(.vertical, layout.surfacePadding)
        // Crown mode reserves nothing at the bottom — surfaces flow behind the
        // chrome — but the composer's action row is INTERACTIVE, so it must
        // clear the resting crown outright (same pattern as MissionControl).
        .padding(.bottom, ScoutNavMode.resolve(navModeRaw) == .crown ? CrownMetric.bottomReserve : 0)
        .overlay {
            if showModelPicker {
                modelPickerOverlay
            }
        }
        .animation(.spring(response: 0.24, dampingFraction: 0.88), value: showModelPicker)
        .onChange(of: promptSeed) { _, seed in
            guard let seed else { return }
            let trimmed = seed.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            if instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                instructions = trimmed
            } else {
                instructions += "\n" + trimmed
            }
            instructionsFocused = true
            promptSeed = nil
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
            .sheet(isPresented: $showProjectPicker) {
                ProjectPickerSheet(client: activeClient, projectPath: $projectPath)
            }
            .task(id: "\(reloadToken)|\(isActive)") {
                guard isActive else { return }
                await entrance.reveal(when: isActive, animated: !reduceMotion)
                await loadWorkspaces()
            }
        // When the project changes, adopt that machine workspace's harnesses.
        .onChange(of: projectPath) { _, _ in applyWorkspaceDefault() }
        // Picking a different Mac re-reads its workspaces (the project list + the
        // machine-backed harnesses are per-Mac); drop the old project so the load
        // re-picks a valid default on that host.
        .onChange(of: selectedMachineId) { _, _ in
            projectPath = ""
            if isActive { Task { await loadWorkspaces() } }
        }
    }

    // MARK: - Machine-backed harnesses

    private func loadWorkspaces() async {
        // Don't clobber the current list (or the curated fallback) on a failed
        // fetch — only a successful load replaces it.
        guard let loaded = try? await activeClient.listWorkspaces(query: nil, limit: 200) else { return }
        workspaces = loaded
        if trimmedProjectPath.isEmpty {
            let preferred = loaded.first { workspace in
                workspace.projectName.localizedCaseInsensitiveCompare("openscout") == .orderedSame
                    || workspace.title.localizedCaseInsensitiveCompare("openscout") == .orderedSame
            } ?? loaded.first
            projectPath = preferred?.root ?? ""
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

    // MARK: - Project

    /// Top line — the "where": the project picker (flexible) with the target Mac
    /// picker beside it, collapsed onto one row as two compact one-line cards.
    private var topRow: some View {
        HStack(spacing: HudSpacing.sm) {
            projectButton
                .frame(maxWidth: .infinity)
            machineMenu
        }
    }

    /// The project value, tapping through to the known-projects tree. One line
    /// (folder · name · caret) so it sits on the top row beside the machine.
    private var projectButton: some View {
        Button {
            showProjectPicker = true
        } label: {
            HStack(spacing: HudSpacing.sm) {
                Glyphic(kind: .folder, size: 16)
                    .foregroundStyle(ScoutInk.muted)
                Text(projectLeaf.isEmpty ? "Choose a project" : projectLeaf)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(projectLeaf.isEmpty ? ScoutInk.dim : HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: HudSpacing.xs)
                Glyphic.chevron(.bottom, size: 12)
                    .foregroundStyle(ScoutInk.muted)
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.sm + 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutCard(cornerRadius: HudRadius.standard)
        }
        .buttonStyle(.plain)
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

    // MARK: - Instructions

    /// The classic message input box: a filling prompt with, at the bottom, an
    /// action row — "+" attach (left), and the model token + dictation mic +
    /// circular send (right).
    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .scrollContentBackground(.hidden)
                .focused($instructionsFocused)
                .frame(maxHeight: .infinity)
                .overlay(alignment: .topLeading) {
                    if instructions.isEmpty {
                        Text("Describe the task, or leave blank to open a fresh session.")
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(ScoutInk.dim)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") { dismissKeyboard() }
                    }
                }
            if voice.isListening, !voice.partialText.isEmpty {
                Text(voice.partialText)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            if !pendingAttachments.isEmpty {
                ComposerAttachmentStrip(attachments: pendingAttachments) { id in
                    pendingAttachments.removeAll { $0.id == id }
                }
            }
            composerBar
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(HudSpacing.lg)
        .scoutCard(cornerRadius: HudRadius.standard)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    /// Bottom of the box: a live waveform line while dictation is recording,
    /// over the action row — "+" attach (left) and the model token, mic, and
    /// circular send (right, mic immediately left of send).
    private var composerBar: some View {
        VStack(spacing: HudSpacing.sm) {
            if voice.isListening {
                RecordingWaveform()
            }
            HStack(spacing: HudSpacing.sm) {
                ComposerAttachButton(attachments: $pendingAttachments, disabled: isSubmitting)
                Spacer(minLength: HudSpacing.sm)
                modelToken
                micButton
                sendButton
            }
        }
        // Menus inherit the system blue tint by default; pull onto the cockpit accent.
        .tint(HudPalette.accent)
    }

    /// The model token at rest — the family in bold with the effort secondary
    /// under a single caret, styled after the study's bordered chip. Tapping
    /// opens the model-picker popover (draft semantics: Done commits, scrim
    /// tap or swipe-down cancels).
    private var modelToken: some View {
        Button {
            instructionsFocused = false
            showModelPicker = true
        } label: {
            HStack(spacing: 5) {
                Text(selectedFamily.displayName)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 104, alignment: .trailing)
                Text(selectedEffort.label)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                Glyphic.chevron(.bottom, size: 9)
                    .foregroundStyle(ScoutInk.dim)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(showModelPicker ? ModelPickerTone.accentSoft : ModelPickerTone.chipFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(showModelPicker ? ModelPickerTone.accentDim : ModelPickerTone.tokenEdge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Model: \(selectedFamily.displayName), effort \(selectedEffort.label)")
    }

    /// Scrim + the rising machined plate (the approved study's popover). The
    /// scrim tap and the plate's swipe-down both CANCEL — only the plate's
    /// Done writes the draft back into the composer state.
    private var modelPickerOverlay: some View {
        ZStack(alignment: .bottom) {
            ModelPickerTone.scrim
                .background(.ultraThinMaterial)
                .ignoresSafeArea()
                .onTapGesture { showModelPicker = false }
                .transition(.opacity)
            ModelPickerPopover(
                harnesses: pickerHarnesses,
                harnessId: $harnessId,
                familyId: $familyId,
                effortId: $effortId,
                onCommit: { showModelPicker = false },
                onCancel: { showModelPicker = false }
            )
            .padding(.horizontal, 14)
            .padding(.bottom, 96)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// Circular send (bottom-right) — starts the session. The accent fill is always
    /// present (dimmed until a project is ready) so it doesn't pop in grey→green a
    /// beat after the box appears; it just brightens when submittable.
    private var sendButton: some View {
        Button {
            submit()
        } label: {
            Group {
                if isSubmitting {
                    ProgressView().controlSize(.small).tint(HudPalette.bg)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(HudPalette.bg)
                }
            }
            .frame(width: 30, height: 30)
            .background(Circle().fill(ScoutVibe.accent.opacity(canSubmit && !isSubmitting ? 1 : 0.32)))
            .animation(.easeInOut(duration: 0.2), value: canSubmit)
        }
        .buttonStyle(.plain)
        .disabled(isSubmitting || !canSubmit)
        .accessibilityLabel("Start session")
    }

    // MARK: - Dictation

    /// Dictation toggle, mirroring the Comms composer: tap to start/stop, a pulsing
    /// accent ring while listening, transcribed text appended to the prompt.
    private var micButton: some View {
        Button {
            voice.toggleFromUserIntent()
        } label: {
            ZStack {
                // An OPAQUE inset base so the mic reads as a floating control and
                // masks the waveform running behind it; it warms to the accent + a
                // pulse while active.
                Circle().fill(ScoutSurface.inset)
                if voice.isListening {
                    Circle().fill(HudPalette.accent.opacity(micPulse ? 0.26 : 0.14))
                }
                Circle()
                    .stroke(voice.isListening ? HudPalette.accent.opacity(0.5) : HudHairline.standard,
                            lineWidth: HudStrokeWidth.thin)
                MicGlyph()
                    .stroke(micColor, style: StrokeStyle(lineWidth: voice.isListening ? 1.8 : 1.3, lineCap: .round, lineJoin: .round))
                    .frame(width: 16, height: 16)
            }
            .frame(width: 40, height: 40)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onChange(of: voice.state) { _, newState in updatePulse(for: newState) }
        .onChange(of: voice.finalCount) { _, _ in
            let text = voice.finalText
            if !text.isEmpty { appendDictation(text) }
        }
    }

    private var micColor: Color {
        switch voice.state {
        case .listening: return HudPalette.accent
        case .transcribing, .preparing: return ScoutInk.muted
        case .unavailable: return ScoutInk.dim.opacity(0.5)
        case .idle: return ScoutInk.muted
        }
    }

    private func appendDictation(_ text: String) {
        instructions = instructions.isEmpty ? text : instructions + " " + text
    }

    private func updatePulse(for state: HudDictation.State) {
        micPulse = false
        if case .listening = state, shouldAnimateMicPulse {
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { micPulse = true }
        }
    }

    private var shouldAnimateMicPulse: Bool {
        !reduceMotion && !ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    // MARK: - Agent

    /// A value token that opens a menu on tap: ink text + a small muted caret.
    private func choiceMenu<Menu: View>(value: String, @ViewBuilder menu: () -> Menu) -> some View {
        SwiftUI.Menu {
            menu()
        } label: {
            HStack(spacing: HudSpacing.xxs) {
                Text(value)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                Glyphic.chevron(.bottom, size: 12)
                    .foregroundStyle(ScoutInk.muted)
            }
        }
    }

    private var tokenSeparator: some View {
        Text("·")
            .font(HudFont.ui(HudTextSize.sm))
            .foregroundStyle(ScoutInk.dim)
    }

    /// Target-machine picker in the agent row — which paired Mac the session lands
    /// on. A value token (dot · name · chevron) opening a menu of online Macs; the
    /// chevron shows only once there's more than one to choose between.
    private var machineMenu: some View {
        let machines = onlineMachines
        return SwiftUI.Menu {
            ForEach(machines) { machine in
                Button {
                    selectedMachineId = machine.id
                } label: {
                    if activeMachine?.id == machine.id {
                        Label(machine.name, systemImage: "checkmark")
                    } else {
                        Text(machine.name)
                    }
                }
            }
        } label: {
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(color: (activeMachine?.isOnline ?? false) ? HudPalette.accent : ScoutInk.muted, size: 6)
                Text(activeMachine?.name ?? "Not connected")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 108, alignment: .leading)
                // A caret marks it as a picker (beside the project on the top row).
                Glyphic.chevron(.bottom, size: 12)
                    .foregroundStyle(ScoutInk.muted)
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.sm + 2)
            .scoutCard(cornerRadius: HudRadius.standard)
        }
        .tint(HudPalette.accent)
        .disabled(machines.isEmpty)
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
        errorText = nil
        result = nil
        instructionsFocused = false
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
}

/// A recording indicator: a horizontal row of accent bars whose heights animate
/// while dictation is live, spanning the mic line above the composer's send row.
/// The motion is ambient (a time-driven wave), NOT live audio amplitude — the
/// dictation controller exposes no metering — so it reads as "recording" without
/// claiming to visualize the actual voice. Wire real levels here if the voice
/// package gains a meter.
private struct RecordingWaveform: View {
    private let barCount = 45
    private let barWidth: CGFloat = 2.5
    private let spacing: CGFloat = 2.5
    private let maxBar: CGFloat = 22

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: spacing) {
                ForEach(0..<barCount, id: \.self) { index in
                    Capsule()
                        .fill(ScoutVibe.accent.opacity(0.5))
                        .frame(width: barWidth, height: barHeight(index: index, time: t))
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .frame(height: maxBar + 6)
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private func barHeight(index: Int, time: Double) -> CGFloat {
        let a = sin(time * 5.5 + Double(index) * 0.55)
        let b = sin(time * 2.7 + Double(index) * 1.10)
        let v = (a * 0.6 + b * 0.4 + 1) / 2   // 0…1
        return 3 + CGFloat(v) * maxBar
    }
}

/// Known-projects picker: a tree of the paired Mac's current workspace roots
/// (grouped by parent directory), plus a manual path field for anything not yet
/// known. Session history is deliberately not a source of paths: it can outlive
/// a Mac account rename or migration.
private struct ProjectPickerSheet: View {
    let client: any ScoutBrokerClient
    @Binding var projectPath: String
    @Environment(\.dismiss) private var dismiss

    @State private var groups: [ProjectGroup] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var manualPath: String = ""

    private struct ProjectGroup: Identifiable {
        let id: String          // parent directory
        let parent: String
        let projects: [Project]
    }

    private struct Project: Identifiable {
        let id: String          // full path
        let name: String
        let path: String
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                    manualSection
                    knownSection
                }
                .padding(HudSpacing.xxl)
            }
            .background(HudPalette.bg)
            .navigationTitle("Choose project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(HudPalette.accent)
        .task { await load() }
    }

    // MARK: Manual entry

    private var manualSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Path")
            HudField("Project path", text: $manualPath, icon: "folder")
            HStack {
                Spacer()
                HudButton("Use this path", icon: "arrow.right", style: .secondary) {
                    commit(manualPath)
                }
                .disabled(manualPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    // MARK: Known projects

    private var knownSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Known projects")
            if isLoading {
                HStack(spacing: HudSpacing.md) {
                    ProgressView().controlSize(.small)
                    Text("Loading…")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.muted)
                }
                .padding(.vertical, HudSpacing.lg)
            } else if let loadError {
                Text(loadError)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.statusError)
                    .fixedSize(horizontal: false, vertical: true)
            } else if groups.isEmpty {
                HudEmptyState(title: "No known projects yet", icon: "folder")
            } else {
                VStack(alignment: .leading, spacing: HudSpacing.sm) {
                    ForEach(groups) { group in
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(group.projects) { project in
                                    projectRow(project)
                                }
                            }
                            .padding(.top, HudSpacing.xs)
                        } label: {
                            Text(group.parent)
                                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                                .foregroundStyle(ScoutInk.muted)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                }
            }
        }
    }

    private func projectRow(_ project: Project) -> some View {
        Button {
            commit(project.path)
        } label: {
            HStack(spacing: HudSpacing.md) {
                Glyphic(kind: .folder, size: 16)
                    .foregroundStyle(ScoutInk.dim)
                Text(project.name)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.md)
                if project.path == projectPath.trimmingCharacters(in: .whitespacesAndNewlines) {
                    Glyphic(kind: .check, size: 14)
                        .foregroundStyle(HudPalette.accent)
                }
            }
            .padding(.vertical, HudSpacing.sm)
            .padding(.leading, HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Data

    private func commit(_ path: String) {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        projectPath = trimmed
        dismiss()
    }

    private func load() async {
        if manualPath.isEmpty { manualPath = projectPath }
        do {
            let workspaces = try await client.listWorkspaces(query: nil, limit: 200)
            let roots = workspaces.compactMap { workspace -> String? in
                let root = workspace.root.trimmingCharacters(in: .whitespacesAndNewlines)
                return root.isEmpty ? nil : root
            }
            groups = Self.group(Array(Set(roots)))
            isLoading = false
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            isLoading = false
        }
    }

    private static func group(_ roots: [String]) -> [ProjectGroup] {
        let byParent = Dictionary(grouping: roots) { ($0 as NSString).deletingLastPathComponent }
        return byParent
            .map { parent, paths in
                ProjectGroup(
                    id: parent,
                    parent: parent,
                    projects: paths
                        .sorted { ($0 as NSString).lastPathComponent.localizedCaseInsensitiveCompare(($1 as NSString).lastPathComponent) == .orderedAscending }
                        .map { Project(id: $0, name: ($0 as NSString).lastPathComponent, path: $0) }
                )
            }
            .sorted { $0.parent.localizedCaseInsensitiveCompare($1.parent) == .orderedAscending }
    }
}
