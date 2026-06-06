import SwiftUI
import HudsonUI
import ScoutCapabilities

/// New Session — a composer that builds a project-modality
/// `SessionInitiationSpec` (target.projectPath set, execution.session = .new,
/// seed.instructions) and dispatches it through the broker client, then shows
/// the returned ids. The reading order is the operator's: pick the **project**,
/// write the **instructions**, then confirm/adjust the **agent** (harness,
/// model, target) — which leads with a sensible default and stays calm and
/// value-like until you engage it.
struct NewSessionSurface: View {
    let client: any ScoutBrokerClient
    /// Friendly name of the Mac the live bridge is connected to, shown as the
    /// read-only "Target" — the session lands on the machine we're paired with.
    /// nil when unconnected. A live target *picker* (choosing among paired
    /// machines) waits on multi-machine routing; today the bridge is one link.
    var targetMachineName: String? = nil

    @State private var projectPath: String = "/Users/arach/dev/openscout"
    @State private var instructions: String = "Stand up the ScoutNext shell and get it running in the simulator."
    /// Selected harness id (the spec's `execution.harness`) and curated model id.
    /// Model is scoped to the harness, so changing harness resets it to Default.
    @State private var harnessId: String = HarnessOption.catalog[0].id
    @State private var modelId: String = ModelOption.defaultId
    @State private var showProjectPicker = false
    @State private var isSubmitting = false
    @State private var result: SessionInitiationResult?
    @State private var errorText: String?
    @State private var route: ConversationRoute?
    @FocusState private var instructionsFocused: Bool

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
                ModelOption(id: "opus", label: "Opus", value: "opus"),
                ModelOption(id: "sonnet", label: "Sonnet", value: "sonnet"),
                ModelOption(id: "haiku", label: "Haiku", value: "haiku"),
            ]),
            HarnessOption(id: "codex", label: "Codex", models: [
                .defaultOption,
                ModelOption(id: "gpt-5-codex", label: "GPT-5 Codex", value: "gpt-5-codex"),
                ModelOption(id: "gpt-5", label: "GPT-5", value: "gpt-5"),
                ModelOption(id: "gpt-5-pro", label: "GPT-5 Pro", value: "gpt-5-pro"),
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

    private var selectedHarness: HarnessOption {
        HarnessOption.catalog.first { $0.id == harnessId } ?? HarnessOption.catalog[0]
    }

    private var selectedModel: ModelOption {
        selectedHarness.models.first { $0.id == modelId } ?? ModelOption.defaultOption
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                projectSection
                instructionsSection
                agentSection
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
                onClose: { self.route = nil }
            )
        }
        .sheet(isPresented: $showProjectPicker) {
            ProjectPickerSheet(client: client, projectPath: $projectPath)
        }
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
                        .foregroundStyle(HudPalette.muted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(projectLeaf.isEmpty ? "Choose a project" : projectLeaf)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(projectLeaf.isEmpty ? HudPalette.dim : HudPalette.ink)
                            .lineLimit(1)
                        if !projectParent.isEmpty {
                            Text(projectParent)
                                .font(HudFont.mono(HudTextSize.xxs))
                                .foregroundStyle(HudPalette.dim)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                    Spacer(minLength: HudSpacing.md)
                    Glyphic.chevron(.trailing, size: 14)
                        .foregroundStyle(HudPalette.muted)
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
            HudSectionLabel("Instructions")
            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .scrollContentBackground(.hidden)
                .focused($instructionsFocused)
                .frame(minHeight: 120)
                .padding(HudSpacing.lg)
                .scoutCard(cornerRadius: HudRadius.standard)
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
                choiceMenu(value: selectedHarness.label) {
                    Picker("Harness", selection: $harnessId) {
                        ForEach(HarnessOption.catalog) { harness in
                            Text(harness.label).tag(harness.id)
                        }
                    }
                    .pickerStyle(.inline)
                }
                tokenSeparator
                choiceMenu(value: selectedModel.label) {
                    Picker("Model", selection: $modelId) {
                        ForEach(selectedHarness.models) { model in
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
                    .foregroundStyle(HudPalette.muted)
            }
        }
    }

    private var tokenSeparator: some View {
        Text("·")
            .font(HudFont.ui(HudTextSize.sm))
            .foregroundStyle(HudPalette.dim)
    }

    private var targetToken: some View {
        HStack(spacing: HudSpacing.xs) {
            HudStatusDot(color: targetMachineName == nil ? HudPalette.muted : HudPalette.accent, size: 6)
            Text(targetMachineName ?? "Not connected")
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(targetMachineName == nil ? HudPalette.dim : HudPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    // MARK: - Result

    private func resultCard(_ result: SessionInitiationResult) -> some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    HudStatusDot(color: HudPalette.statusOk, size: HudDotSize.medium)
                    Text("Session started")
                        .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                }
                idRow("conversation", result.conversationId)
                idRow("agent", result.agentId)
                idRow("flight", result.flightId)
                idRow("message", result.messageId)
            }
        }
    }

    private func idRow(_ label: String, _ value: String?) -> some View {
        HStack(spacing: HudSpacing.md) {
            Text(label)
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(HudPalette.dim)
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

    private func makeSpec() -> SessionInitiationSpec {
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        return SessionInitiationSpec(
            target: .init(projectPath: trimmedProjectPath),
            execution: .init(harness: harnessId, model: selectedModel.value, session: .new),
            agent: .init(persistence: "sticky"),
            seed: .init(instructions: trimmedInstructions.isEmpty ? nil : trimmedInstructions)
        )
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        isSubmitting = true
        errorText = nil
        result = nil
        instructionsFocused = false
        let spec = makeSpec()
        Task {
            do {
                let outcome = try await client.startSession(spec)
                isSubmitting = false
                result = outcome
                // Land in the new conversation when the broker returns one.
                if let conversationId = outcome.conversationId {
                    route = ConversationRoute(id: conversationId, title: sessionTitle)
                }
            } catch {
                isSubmitting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
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
                        .foregroundStyle(HudPalette.muted)
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
                                .foregroundStyle(HudPalette.muted)
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
                    .foregroundStyle(HudPalette.dim)
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
