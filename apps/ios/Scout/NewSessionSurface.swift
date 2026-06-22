import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
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
    let client: any ScoutBrokerClient
    /// Friendly name of the Mac the live bridge is connected to, shown as the
    /// read-only "Target" — the session lands on the machine we're paired with.
    /// nil when unconnected. A live target *picker* (choosing among paired
    /// machines) waits on multi-machine routing; today the bridge is one link.
    var targetMachineName: String? = nil
    /// Bumps when the bridge becomes ready (data loaded) — re-runs the workspace
    /// load so the machine-backed harness list fills in once connected, not just
    /// on first appear (which can land before the connection is up).
    var reloadToken: Int = 0
    /// Publishes the pushed conversation's runtime/project/model context into
    /// the global protected-area status bar.
    var onConversationStatusContext: (String?) -> Void = { _ in }

    @State private var projectPath: String = "/Users/arach/dev/openscout"
    @State private var instructions: String = "Stand up the Scout shell and get it running in the simulator."
    /// Selected harness id (the spec's `execution.harness`) and curated model id.
    /// Model is scoped to the harness, so changing harness resets it to Default.
    @State private var harnessId: String = HarnessOption.catalog[0].id
    @State private var modelId: String = ModelOption.defaultId
    /// Machine-backed workspaces from the connected Mac (`mobile/workspaces`),
    /// each carrying the harnesses actually installed there. Empty until loaded /
    /// when offline, in which case the harness menu falls back to the curated
    /// catalog below.
    @State private var workspaces: [WorkspaceSummary] = []
    @State private var showProjectPicker = false
    @State private var isSubmitting = false
    @State private var result: SessionInitiationResult?
    @State private var errorText: String?
    @State private var pendingAttachments: [ScoutComposerAttachment] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var showFileImporter = false
    @State private var route: ConversationRoute?
    @FocusState private var instructionsFocused: Bool

    /// Shared on-device dictation (Parakeet via Vox + Apple fallback), injected at
    /// the app root — the same controller the Comms composer and Settings use.
    @Environment(HudDictation.self) private var voice
    @State private var micPulse = false

    /// A Hashable navigation target — contract models stay transport-pure.
    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    /// A curated harness + its hand-picked model menu. Until the bridge exposes
    /// the live `harness-catalog` (with per-machine readiness), this is the two
    /// featured workspace harnesses with a short, valid model list each — the
    /// strings are passed verbatim to the CLI as `--model`.
    private struct HarnessOption: Identifiable, Hashable {
        let id: String        // spec `execution.harness`, e.g. "claude"
        let label: String     // menu label, e.g. "Claude Code"
        let models: [ModelOption]

        static let catalog: [HarnessOption] = [
            HarnessOption(id: "claude", label: "Claude Code", models: [
                .defaultOption,
                ModelOption(id: "fable", label: "Fable", value: "fable"),
                ModelOption(id: "opus", label: "Opus", value: "opus"),
                ModelOption(id: "claude-opus-4-8", label: "Opus 4.8", value: "claude-opus-4-8"),
                ModelOption(id: "sonnet", label: "Sonnet", value: "sonnet"),
                ModelOption(id: "claude-sonnet-4-6", label: "Sonnet 4.6", value: "claude-sonnet-4-6"),
                ModelOption(id: "haiku", label: "Haiku", value: "haiku"),
            ]),
            HarnessOption(id: "codex", label: "Codex", models: [
                .defaultOption,
                ModelOption(id: "gpt-5.5", label: "GPT-5.5", value: "gpt-5.5"),
                ModelOption(id: "gpt-5.5-mini", label: "GPT-5.5 mini", value: "gpt-5.5-mini"),
            ]),
        ]
    }

    /// One model menu entry. `value` is the `--model` string, or nil for
    /// "Default" — which omits the field so the harness picks its own default.
    private struct ModelOption: Identifiable, Hashable {
        let id: String
        let label: String
        let value: String?

        static let defaultId = "default"
        static let defaultOption = ModelOption(id: defaultId, label: "Default", value: nil)
    }

    /// One selectable harness in the menu — sourced from the connected machine
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

    /// Harness menu options: the machine's installed harnesses for the selected
    /// project when available, otherwise the curated catalog (e.g. while offline).
    private var harnessChoices: [HarnessChoice] {
        // The machine's full harness set — the union of every usable harness across
        // its known workspaces — so the menu reflects what's actually installed on
        // that Mac, not just one project's default. Curated fallback when offline.
        let live = workspaces.flatMap(\.harnesses).filter(\.isUsable)
        if !live.isEmpty {
            var seen = Set<String>()
            return live
                .filter { seen.insert($0.harness).inserted }
                .map { HarnessChoice(id: $0.harness, label: harnessLabel($0.harness), readiness: $0.readiness) }
                .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        }
        return HarnessOption.catalog.map { HarnessChoice(id: $0.id, label: $0.label, readiness: nil) }
    }

    /// Friendly label for a harness id — the curated label when we have one, else
    /// a capitalized form of the raw id (for harnesses we don't curate models for).
    private func harnessLabel(_ id: String) -> String {
        if let curated = HarnessOption.catalog.first(where: { $0.id == id }) { return curated.label }
        return id.isEmpty ? id : id.prefix(1).uppercased() + id.dropFirst()
    }

    /// Model menu for a harness — the curated list when we have one, else just
    /// "Default" (models are free-form CLI strings, not machine-cataloged).
    private func modelChoices(_ harness: String) -> [ModelOption] {
        HarnessOption.catalog.first(where: { $0.id == harness })?.models ?? [.defaultOption]
    }

    private var selectedHarnessLabel: String {
        harnessChoices.first(where: { $0.id == harnessId })?.label ?? harnessLabel(harnessId)
    }

    private var selectedModel: ModelOption {
        modelChoices(harnessId).first { $0.id == modelId } ?? ModelOption.defaultOption
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                projectSection
                agentSection
                instructionsSection
                if let errorText {
                    Text(errorText)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.statusError)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let result {
                    resultCard(result)
                }
                footer
            }
            .padding(HudSpacing.xxl)
        }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil },
                onStatusContextChange: onConversationStatusContext
            )
        }
            .sheet(isPresented: $showProjectPicker) {
                ProjectPickerSheet(client: client, projectPath: $projectPath)
            }
            .onChange(of: selectedPhotoItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await addPhotos(items) }
            }
            .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                addFiles(result)
            }
            .task(id: reloadToken) { await loadWorkspaces() }
        // When the project changes, adopt that machine workspace's harnesses.
        .onChange(of: projectPath) { _, _ in applyWorkspaceDefault() }
    }

    // MARK: - Machine-backed harnesses

    private func loadWorkspaces() async {
        // Don't clobber the current list (or the curated fallback) on a failed
        // fetch — only a successful load replaces it.
        guard let loaded = try? await client.listWorkspaces(query: nil, limit: 200) else { return }
        workspaces = loaded
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
        modelId = ModelOption.defaultId
    }

    // MARK: - Project

    /// The project row reads as a value — name on top, parent dimmed beneath —
    /// and the whole row taps through to the known-projects tree.
    private var projectSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Project")
            Button {
                showProjectPicker = true
            } label: {
                HStack(spacing: HudSpacing.md) {
                    Glyphic(kind: .folder, size: 18)
                        .foregroundStyle(ScoutInk.muted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(projectLeaf.isEmpty ? "Choose a project" : projectLeaf)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(projectLeaf.isEmpty ? ScoutInk.dim : HudPalette.ink)
                            .lineLimit(1)
                        if !projectParent.isEmpty {
                            Text(projectParent)
                                .font(HudFont.mono(HudTextSize.xxs))
                                .foregroundStyle(ScoutInk.dim)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                    Spacer(minLength: HudSpacing.md)
                    Glyphic.chevron(.trailing, size: 14)
                        .foregroundStyle(ScoutInk.muted)
                }
                .padding(HudSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .scoutCard(cornerRadius: HudRadius.standard)
            }
            .buttonStyle(.plain)
        }
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

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Prompt")
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                TextEditor(text: $instructions)
                    .font(HudFont.ui(HudTextSize.base))
                    .foregroundStyle(HudPalette.ink)
                    .scrollContentBackground(.hidden)
                    .focused($instructionsFocused)
                    .frame(minHeight: 168)
                // Floating dictation mic, centered along the bottom of the box —
                // the live partial transcript surfaces just above it while active.
                VStack(spacing: HudSpacing.xs) {
                    if voice.isListening, !voice.partialText.isEmpty {
                        Text(voice.partialText)
                            .font(HudFont.mono(HudTextSize.xxs))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    micButton
                }
                .frame(maxWidth: .infinity, alignment: .center)
                if !pendingAttachments.isEmpty {
                    ComposerAttachmentStrip(attachments: pendingAttachments) { id in
                        pendingAttachments.removeAll { $0.id == id }
                    }
                    .padding(.top, HudSpacing.sm)
                }
                HStack(spacing: HudSpacing.sm) {
                    attachPhotoButton
                    attachFileButton
                    if !pendingAttachments.isEmpty {
                        Text("\(pendingAttachments.count) attached")
                            .font(HudFont.mono(HudTextSize.xxs))
                            .foregroundStyle(ScoutInk.muted)
                    }
                    Spacer()
                }
                .padding(.top, HudSpacing.xs)
            }
            .padding(HudSpacing.lg)
            .scoutCard(cornerRadius: HudRadius.standard)
        }
    }

    // MARK: - Dictation

    /// Dictation toggle, mirroring the Comms composer: tap to start/stop, a pulsing
    /// accent ring while listening, transcribed text appended to the prompt.
    private var micButton: some View {
        Button {
            voice.toggle()
        } label: {
            ZStack {
                // A persistent inset disc so the mic reads as a floating control,
                // not a stray glyph; it warms to the accent + a pulse while active.
                Circle()
                    .fill(voice.isListening ? HudPalette.accent.opacity(micPulse ? 0.24 : 0.12) : HudSurface.inset)
                Circle()
                    .stroke(voice.isListening ? HudPalette.accent.opacity(0.45) : HudHairline.standard,
                            lineWidth: HudStrokeWidth.thin)
                MicGlyph()
                    .stroke(micColor, style: StrokeStyle(lineWidth: voice.isListening ? 1.8 : 1.3, lineCap: .round, lineJoin: .round))
                    .frame(width: 17, height: 17)
            }
            .frame(width: 38, height: 38)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onChange(of: voice.state) { _, newState in updatePulse(for: newState) }
        .onChange(of: voice.finalCount) { _, _ in
            let text = voice.finalText
            if !text.isEmpty { appendDictation(text) }
        }
    }

    private var attachPhotoButton: some View {
        PhotosPicker(selection: $selectedPhotoItems, maxSelectionCount: 8, matching: .images) {
            Label("Photo", systemImage: "photo")
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
        }
        .disabled(isSubmitting)
    }

    private var attachFileButton: some View {
        Button { showFileImporter = true } label: {
            Label("File", systemImage: "paperclip")
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
        }
        .buttonStyle(.plain)
        .disabled(isSubmitting)
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

    @MainActor
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        defer { selectedPhotoItems = [] }
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
        do {
            let urls = try result.get()
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                let type = UTType(filenameExtension: url.pathExtension)
                let mediaType = type?.preferredMIMEType ?? "application/octet-stream"
                pendingAttachments.append(
                    ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: url.lastPathComponent)
                )
            }
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func updatePulse(for state: HudDictation.State) {
        micPulse = false
        if case .listening = state {
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { micPulse = true }
        }
    }

    // MARK: - Agent

    /// Harness · model · target on one calm line. They lead with the default and
    /// present as values (ink text + a small caret), not loud controls; the
    /// harness and model carets open inline menus. Target is read-only until
    /// multi-machine routing exists.
    private var agentSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Agent")
            HStack(spacing: HudSpacing.md) {
                choiceMenu(value: selectedHarnessLabel) {
                    Picker("Harness", selection: $harnessId) {
                        ForEach(harnessChoices) { choice in
                            Text(choice.label).tag(choice.id)
                        }
                    }
                    .pickerStyle(.inline)
                }
                tokenSeparator
                choiceMenu(value: selectedModel.label) {
                    Picker("Model", selection: $modelId) {
                        ForEach(modelChoices(harnessId)) { model in
                            Text(model.label).tag(model.id)
                        }
                    }
                    .pickerStyle(.inline)
                }
                Spacer(minLength: HudSpacing.md)
                targetToken
            }
            .padding(HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutCard(cornerRadius: HudRadius.standard)
            // The menus inherit the system blue tint by default; pull them onto
            // the cockpit accent so the open menu reads with the rest of the app.
            .tint(HudPalette.accent)
        }
        // A model belongs to its harness — switching harness drops back to the
        // harness's Default rather than carrying a now-invalid model id.
        .onChange(of: harnessId) { _, _ in modelId = ModelOption.defaultId }
    }

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

    private var targetToken: some View {
        HStack(spacing: HudSpacing.xs) {
            HudStatusDot(color: targetMachineName == nil ? ScoutInk.muted : HudPalette.accent, size: 6)
            Text(targetMachineName ?? "Not connected")
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(targetMachineName == nil ? ScoutInk.dim : ScoutInk.muted)
                .lineLimit(1)
                .truncationMode(.tail)
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

    // MARK: - Footer

    private var footer: some View {
        HStack {
            if isSubmitting {
                ProgressView().controlSize(.small)
            }
            Spacer()
            HudButton("Start", icon: "paperplane.fill", style: .primary(.green)) {
                submit()
            }
            .disabled(isSubmitting || !canSubmit)
        }
    }

    private var canSubmit: Bool {
        !trimmedProjectPath.isEmpty
    }

    private func makeSpec(attachments: [MessageAttachment]? = nil) -> SessionInitiationSpec {
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        return SessionInitiationSpec(
            target: .init(projectPath: trimmedProjectPath),
            execution: .init(harness: harnessId, model: selectedModel.value, session: .new),
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
                let outcome = try await client.startSession(spec)
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
            hosted.append(try await client.uploadAttachment(attachment.upload))
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

/// Known-projects picker: a tree of the project roots Scout has seen (grouped by
/// parent directory), plus a manual path field for anything not yet known. The
/// known list comes from the broker's sessions — empty until connected, which
/// is why the manual field always stays available.
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
            let sessions = try await client.listSessions(query: nil, limit: 200)
            let roots = sessions.compactMap { session -> String? in
                guard let root = session.workspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !root.isEmpty else { return nil }
                return root
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
