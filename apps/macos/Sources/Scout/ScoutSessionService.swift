import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutCapabilities
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
#endif

typealias ScoutSessionStartResult = SessionInitiationResult

// MARK: - Network service

enum SessionInitiationError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status, let message):
            return message.isEmpty ? "Scout returned HTTP \(status)." : message
        }
    }
}

enum SessionInitiationService {
    static func start(_ spec: SessionInitiationSpec) async throws -> ScoutSessionStartResult {
        let url = ScoutWeb.baseURL().appending(path: "api/sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(spec)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SessionInitiationError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SessionInitiationError.httpStatus(http.statusCode, Self.decodeError(data))
        }
        return try JSONDecoder().decode(ScoutSessionStartResult.self, from: data)
    }

    static func userFacingError(_ error: Error) -> String {
        if let localized = error as? LocalizedError,
           let description = localized.errorDescription,
           !description.isEmpty {
            return description
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNotConnectedToInternet, NSURLErrorTimedOut:
                return "Scout web server isn't running. Start Scout services, then try again."
            default:
                break
            }
        }
        return error.localizedDescription
    }

    private static func decodeError(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String else {
            return ""
        }
        return message
    }
}

// MARK: - Composer

struct ScoutSessionProjectOption: Identifiable, Equatable {
    var path: String
    var name: String
    var detail: String

    var id: String { path }
}

/// Modal sheet that turns a `ScoutSessionDraft` into a session-initiation call.
/// Renders its own dimmed backdrop so the host only needs `if let draft`.
struct ScoutSessionComposer: View {
    let onClose: () -> Void
    let onComplete: (ScoutSessionStartResult, ScoutSessionDraft) -> Void

    @State private var draft: ScoutSessionDraft
    @State private var isSubmitting = false
    @State private var errorText: String?
    @State private var optionsExpanded = false
    @FocusState private var instructionsFocused: Bool
    @ObservedObject private var voice = ScoutVoiceService.shared
    @AppStorage("scout.session.lastProjectPath") private var lastProjectPath = ""

    private let agents: [ScoutAgent]
    private let projectOptions: [ScoutSessionProjectOption]

    init(
        draft: ScoutSessionDraft,
        agents: [ScoutAgent] = [],
        projectOptions: [ScoutSessionProjectOption] = [],
        onClose: @escaping () -> Void,
        onComplete: @escaping (ScoutSessionStartResult, ScoutSessionDraft) -> Void
    ) {
        self.onClose = onClose
        self.onComplete = onComplete
        self.agents = agents
        self.projectOptions = projectOptions
        _draft = State(initialValue: draft)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.42)
                .ignoresSafeArea()
                .onTapGesture { if !isSubmitting { onClose() } }

            card
                .frame(width: 460)
                .padding(HudSpacing.xxl)
        }
        .onExitCommand { if !isSubmitting { onClose() } }
        .onReceive(voice.$lastFinalText) { spliceDictatedFinal($0) }
        .onAppear { instructionsFocused = true }
    }

    private var isDictating: Bool { voice.state.isCaptureActive }

    private var isProjectTarget: Bool {
        if case .project = draft.target { return true }
        return false
    }

    private var availableAgents: [ScoutAgent] {
        var seen: Set<String> = []
        var result: [ScoutAgent] = []
        if let selected = draft.agent {
            seen.insert(selected.id)
            result.append(selected)
        }
        for agent in agents where !seen.contains(agent.id) {
            seen.insert(agent.id)
            result.append(agent)
        }
        return result.sorted { lhs, rhs in
            let lhsProject = projectLabel(for: lhs)
            let rhsProject = projectLabel(for: rhs)
            if lhsProject != rhsProject {
                return lhsProject.localizedCaseInsensitiveCompare(rhsProject) == .orderedAscending
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    private var effectiveProjectOptions: [ScoutSessionProjectOption] {
        var seen: Set<String> = []
        var result: [ScoutSessionProjectOption] = []
        func append(_ option: ScoutSessionProjectOption) {
            let path = option.path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !path.isEmpty, !seen.contains(path) else { return }
            seen.insert(path)
            result.append(.init(path: path, name: option.name, detail: option.detail))
        }

        if let current = draft.projectPath.nilIfEmpty {
            append(.init(path: current, name: projectName(for: current), detail: (current as NSString).abbreviatingWithTildeInPath))
        }
        if let last = lastProjectPath.nilIfEmpty {
            append(.init(path: last, name: projectName(for: last), detail: (last as NSString).abbreviatingWithTildeInPath))
        }
        for option in projectOptions { append(option) }
        return result
    }

    private var harnessChoices: [String] {
        var values = Set(agents.compactMap { $0.harness?.nilIfEmpty })
        if let harness = draft.harness?.nilIfEmpty { values.insert(harness) }
        return values.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private var showDictationPreview: Bool {
        draft.instructions.isEmpty && (voice.state.isCaptureActive || voice.state.isProcessing)
    }

    private var messagePlaceholder: String {
        switch draft.target {
        case .agent(let agent):
            return draft.mode == .continueContext
                ? "Message \(agent.displayName)…"
                : "What should \(agent.displayName) start on?"
        case .project:
            return "What should the new agent start on?"
        }
    }

    private func toggleDictation() {
        instructionsFocused = true
        Task {
            switch ScoutDictationController.toggleDecision(for: voice.state) {
            case .probeThenStartIfIdle:
                await voice.probe()
                if case .idle = voice.state { voice.start() }
            case .start:
                voice.start()
            case .stop:
                voice.stop()
            case .ignore:
                break
            }
        }
    }

    private func spliceDictatedFinal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft.instructions = ScoutDictationBuffer.appending(trimmed, to: draft.instructions)
        ScoutVoiceService.shared.consumeFinalText()
        instructionsFocused = true
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            header
            targetSection
            instructionsSection
            optionsSection
            if let errorText {
                Text(errorText)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            footer
        }
        .padding(HudSpacing.xxl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard)
        )
        .shadow(color: Color.black.opacity(0.35), radius: 30, y: 12)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text(draft.title)
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            Text(subtitle)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        }
    }

    private var subtitle: String {
        switch draft.target {
        case .agent(let agent):
            return draft.mode == .continueContext
                ? "Continue \(agent.displayName) with full context"
                : "New conversation with \(agent.displayName)"
        case .project:
            return "Start a new conversation in a project"
        }
    }

    private var targetSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(spacing: HudSpacing.md) {
                Text("Target")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                    .frame(width: 54, alignment: .leading)
                targetKindPicker
            }

            if isProjectTarget {
                projectPicker
            } else {
                agentPicker
                modePicker
            }
        }
    }

    private var targetKindPicker: some View {
        HStack(spacing: HudSpacing.xs) {
            targetKindButton(title: "Project", icon: "folder", isSelected: isProjectTarget) {
                draft.target = .project
            }
            targetKindButton(title: "Agent", icon: "person.crop.circle", isSelected: !isProjectTarget) {
                guard let agent = draft.agent ?? availableAgents.first else { return }
                selectAgent(agent)
            }
            .disabled(availableAgents.isEmpty)
            .help(availableAgents.isEmpty ? "No agents in roster" : "Target an existing agent")
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private func targetKindButton(title: String, icon: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(isSelected ? ScoutPalette.ink : ScoutPalette.muted)
            .frame(width: 94, height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isSelected ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
            )
        }
        .buttonStyle(.plain).scoutPointerCursor()
    }

    private var projectPicker: some View {
        Menu {
            ForEach(effectiveProjectOptions) { option in
                Button {
                    selectProject(option.path)
                } label: {
                    VStack(alignment: .leading) {
                        Text(option.name)
                        Text(option.detail)
                    }
                }
            }
            Divider()
            Button("Other...") {
                chooseProjectDirectory()
            }
        } label: {
            pickerField(
                icon: "folder",
                title: projectName(for: draft.projectPath),
                detail: draft.projectPath.nilIfEmpty.map { ($0 as NSString).abbreviatingWithTildeInPath } ?? "Choose a project"
            )
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain).scoutPointerCursor()
    }

    @ViewBuilder
    private var agentPicker: some View {
        if availableAgents.isEmpty {
            pickerField(icon: "person.crop.circle.badge.exclamationmark", title: "No agents", detail: "Open setup to register an agent")
        } else {
            Menu {
                ForEach(groupedAgents, id: \.label) { group in
                    Section(group.label) {
                        ForEach(group.agents) { agent in
                            Button {
                                selectAgent(agent)
                            } label: {
                                HStack {
                                    Text(agent.state.label)
                                    Text(agent.displayName)
                                    if let harness = agent.harness?.nilIfEmpty {
                                        Text(harness)
                                    }
                                }
                            }
                        }
                    }
                }
            } label: {
                let selected = draft.agent ?? availableAgents.first
                pickerField(
                    icon: "person.crop.circle",
                    title: selected?.displayName ?? "Choose an agent",
                    detail: selected.map { agentDetail($0) } ?? "No agent selected",
                    dot: selected?.state.tint
                )
            }
            .menuStyle(.borderlessButton)
            .buttonStyle(.plain).scoutPointerCursor()
        }
    }

    private func pickerField(icon: String, title: String, detail: String, dot: Color? = nil) -> some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                HStack(spacing: HudSpacing.xs) {
                    if let dot {
                        Circle()
                            .fill(dot)
                            .frame(width: 7, height: 7)
                    }
                    Text(title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)
                }
                Text(detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: HudSpacing.md)
            Image(systemName: "chevron.down")
                .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 48)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
    }

    private var modePicker: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.xs) {
                modeButton(.fresh, title: "Fresh start", icon: "plus.bubble")
                modeButton(.continueContext, title: "Continue (full context)", icon: "arrow.uturn.forward", disabled: !draft.canContinue)
            }
            if !draft.canContinue {
                Text("No resumable harness session for this agent")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private func modeButton(_ mode: ScoutSessionDraft.Mode, title: String, icon: String, disabled: Bool = false) -> some View {
        Button {
            guard !disabled else { return }
            draft.mode = mode
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(draft.mode == mode ? ScoutPalette.ink : ScoutPalette.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(draft.mode == mode ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
                )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .disabled(disabled)
        .help(disabled ? "No resumable harness session for this agent" : title)
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HudSectionLabel(draft.mode == .continueContext ? "Follow-up message" : "First message")
            if draft.fromMessageId?.nilIfEmpty != nil {
                seedChip
            }
            messageWell
        }
    }

    private var seedChip: some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            Image(systemName: "quote.bubble")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(draft.seedSourceName?.nilIfEmpty ?? "Source message")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Text(seedPreviewText)
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: HudSpacing.sm)
            Button {
                draft.fromMessageId = nil
                draft.fromConversationId = nil
                draft.seedSourceName = nil
                draft.seedPreview = nil
            } label: {
                Image(systemName: "xmark")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(ScoutSurface.hover))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("Detach source message")
        }
        .padding(HudSpacing.sm)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.control))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private var messageWell: some View {
        HStack(alignment: .bottom, spacing: HudSpacing.sm) {
            ZStack(alignment: .topLeading) {
                if draft.instructions.isEmpty && !showDictationPreview {
                    Text(messagePlaceholder)
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutPalette.dim)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, HudSpacing.md)
                        .allowsHitTesting(false)
                }

                TextEditor(text: $draft.instructions)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutPalette.ink)
                    .tint(showDictationPreview ? Color.clear : ScoutPalette.accent)
                    .scrollContentBackground(.hidden)
                    .focused($instructionsFocused)
                    .frame(minHeight: 64, maxHeight: 132)

                if showDictationPreview {
                    ScoutDictationPreview(text: voice.partial)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, HudSpacing.md)
                        .allowsHitTesting(false)
                }
            }

            ScoutMicButton(box: 30, glyph: 14, action: toggleDictation)
                .padding(.bottom, HudSpacing.xxs)
        }
        .padding(HudSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(instructionsFocused ? ScoutSurface.tintBorder(ScoutPalette.accent) : HudHairline.standard, lineWidth: HudStrokeWidth.thin)
        )
    }

    private var optionsSection: some View {
        DisclosureGroup(isExpanded: $optionsExpanded) {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                harnessMenu
                HudField("Model", text: modelBinding, icon: "cpu")
                if isProjectTarget {
                    identityOptions
                }
            }
            .padding(.top, HudSpacing.sm)
        } label: {
            Text("Options")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
        }
        .tint(ScoutPalette.accent)
    }

    private var harnessMenu: some View {
        Menu {
            Button("Default") {
                draft.harness = nil
            }
            if !harnessChoices.isEmpty {
                Divider()
                ForEach(harnessChoices, id: \.self) { harness in
                    Button(harness) {
                        draft.harness = harness
                    }
                }
            }
        } label: {
            pickerField(
                icon: "terminal",
                title: draft.harness?.nilIfEmpty ?? "Default",
                detail: "Harness"
            )
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain).scoutPointerCursor()
    }

    private var identityOptions: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            Toggle(isOn: $draft.keepAgent) {
                Text("Keep this agent")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
            }
            .toggleStyle(.switch)
            .tint(ScoutPalette.accent)

            if draft.keepAgent {
                HudField("Agent name", text: $draft.agentName, icon: "person.text.rectangle")
                HudField("Display name", text: $draft.displayName, icon: "character.cursor.ibeam")
            }
        }
    }

    private var footer: some View {
        HStack {
            HudButton("Cancel", style: .ghost) { onClose() }
                .disabled(isSubmitting)
            Spacer()
            if isSubmitting {
                ProgressView().controlSize(.small)
            }
            HudButton(startTitle, icon: "paperplane.fill", style: .primary(.green)) {
                submit()
            }
            .disabled(isSubmitting || !canSubmit)
            .keyboardShortcut(.return, modifiers: .command)
        }
    }

    private var startTitle: String {
        draft.mode == .continueContext ? "Continue" : "Start"
    }

    private var canSubmit: Bool {
        switch draft.target {
        case .agent:
            if draft.mode == .continueContext { return draft.canContinue }
            return true
        case .project:
            return !draft.projectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private var modelBinding: Binding<String> {
        Binding {
            draft.model ?? ""
        } set: { next in
            draft.model = next
        }
    }

    private var groupedAgents: [(label: String, agents: [ScoutAgent])] {
        let groups = Dictionary(grouping: availableAgents, by: projectLabel(for:))
        return groups
            .map { (label: $0.key, agents: $0.value) }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    private var seedPreviewText: String {
        let source = draft.seedPreview?.nilIfEmpty ?? draft.instructions
        let lines = source
            .split(whereSeparator: \.isNewline)
            .prefix(2)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let text = lines.joined(separator: " ")
        if text.count <= 220 { return text.isEmpty ? "Attached source message" : text }
        return "\(text.prefix(220))..."
    }

    private func selectProject(_ path: String) {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft.target = .project
        draft.projectPath = trimmed
        lastProjectPath = trimmed
    }

    private func selectAgent(_ agent: ScoutAgent) {
        draft.target = .agent(agent)
        if let path = (agent.projectRoot?.nilIfEmpty ?? agent.cwd?.nilIfEmpty) {
            draft.projectPath = path
        }
        if draft.mode == .continueContext, !draft.canContinue {
            draft.mode = .fresh
        }
    }

    private func chooseProjectDirectory() {
        #if os(macOS)
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        if let current = draft.projectPath.nilIfEmpty {
            panel.directoryURL = URL(fileURLWithPath: current)
        }
        if panel.runModal() == .OK, let url = panel.url {
            selectProject(url.path)
        }
        #endif
    }

    private func projectName(for path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Choose a project" }
        let name = URL(fileURLWithPath: trimmed).lastPathComponent
        return name.isEmpty ? trimmed : name
    }

    private func projectLabel(for agent: ScoutAgent) -> String {
        if let path = (agent.projectRoot?.nilIfEmpty ?? agent.cwd?.nilIfEmpty) {
            return projectName(for: path)
        }
        return "No project"
    }

    private func agentDetail(_ agent: ScoutAgent) -> String {
        let parts = [
            agent.detail.nilIfEmpty,
            (agent.projectRoot?.nilIfEmpty ?? agent.cwd?.nilIfEmpty).map { ($0 as NSString).abbreviatingWithTildeInPath },
        ].compactMap { $0 }
        return parts.isEmpty ? agent.state.label : parts.joined(separator: " · ")
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        isSubmitting = true
        errorText = nil
        let submittedDraft = draft
        let spec = submittedDraft.spec()
        if let projectPath = submittedDraft.projectPath.nilIfEmpty {
            lastProjectPath = projectPath
        }
        Task {
            do {
                let result = try await SessionInitiationService.start(spec)
                isSubmitting = false
                onComplete(result, submittedDraft)
            } catch {
                isSubmitting = false
                errorText = SessionInitiationService.userFacingError(error)
            }
        }
    }
}
