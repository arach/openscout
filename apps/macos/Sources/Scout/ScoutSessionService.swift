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
    @State private var openDropdown: String?
    @State private var agentQuery: String = ""
    @State private var agentHighlight: Int = 0
    @FocusState private var instructionsFocused: Bool
    @FocusState private var agentFieldFocused: Bool
    @ObservedObject private var voice = ScoutVoiceService.shared
    @AppStorage("scout.session.lastProjectPath") private var lastProjectPath = ""

    private let agents: [ScoutAgent]
    private let projectOptions: [ScoutSessionProjectOption]

    // Fixed modal geometry — wide enough that Project / Model / Harness sit as three
    // equal chips on one line and the message box reads close to the main composer.
    private static let modalWidth: CGFloat = 700

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
                .frame(width: Self.modalWidth)
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
        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
            header
            targetSection
            messageSection
            if let errorText {
                Text(errorText)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(HudSpacing.xxxl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutDesign.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: ScoutSurface.shadow(0.34), radius: 14, y: 6)
        // Flush dropdown panels float here, anchored under their trigger chip —
        // no popover, no system arrow.
        .overlayPreferenceValue(DropdownAnchorKey.self) { anchors in
            dropdownOverlay(anchors)
        }
    }

    // Positions the open dropdown panel under its trigger and lays a transparent
    // catcher behind it so an outside click dismisses (not the whole modal).
    @ViewBuilder
    private func dropdownOverlay(_ anchors: [String: Anchor<CGRect>]) -> some View {
        GeometryReader { proxy in
            if let id = openDropdown, let anchor = anchors[id] {
                let rect = proxy[anchor]
                ZStack(alignment: .topLeading) {
                    // Outside-click catcher for the value chips. The agent
                    // combobox dismisses via field focus instead, so its field
                    // and message box stay directly clickable.
                    if id != "agent" {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture { openDropdown = nil }
                    }
                    dropdownContent(for: id)
                        .frame(width: max(rect.width, 220))
                        .offset(x: rect.minX, y: rect.maxY + HudSpacing.xs)
                }
            }
        }
    }

    @ViewBuilder
    private func dropdownContent(for id: String) -> some View {
        switch id {
        case "project":
            ScoutDropdownPanel {
                ForEach(effectiveProjectOptions) { option in
                    ScoutDropdownRow(
                        label: option.name,
                        detail: option.detail.nilIfEmpty,
                        selected: option.path == draft.projectPath
                    ) {
                        selectProject(option.path)
                        openDropdown = nil
                    }
                }
                ScoutDropdownRow(label: "Other…", selected: false, leadingSymbol: "folder") {
                    openDropdown = nil
                    chooseProjectDirectory()
                }
            }
        case "model":
            ScoutDropdownPanel {
                ScoutDropdownRow(label: "Default", selected: draft.model == nil) {
                    draft.model = nil
                    openDropdown = nil
                }
                ForEach(modelChoices, id: \.harness) { group in
                    ScoutDropdownSectionLabel(text: group.harness)
                    ForEach(group.models, id: \.self) { model in
                        ScoutDropdownRow(label: model, selected: draft.model == model) {
                            draft.model = model
                            draft.harness = group.harness == "Other" ? nil : group.harness
                            openDropdown = nil
                        }
                    }
                }
            }
        case "harness":
            ScoutDropdownPanel {
                ScoutDropdownRow(label: "Default", selected: draft.harness == nil) {
                    draft.harness = nil
                    openDropdown = nil
                }
                ForEach(harnessChoices, id: \.self) { harness in
                    ScoutDropdownRow(label: harness, dot: ScoutPalette.accent, selected: draft.harness == harness) {
                        draft.harness = harness
                        openDropdown = nil
                    }
                }
            }
        case "agent":
            ScoutDropdownPanel {
                if agentFlat.isEmpty {
                    Text("No agents match “\(agentQuery)”")
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.dim)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, HudSpacing.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(agentGroups, id: \.project) { group in
                        ScoutDropdownSectionLabel(text: group.project)
                        ForEach(group.agents) { agent in
                            ScoutDropdownRow(
                                label: agent.displayName,
                                detail: agent.model?.nilIfEmpty ?? agent.harness?.nilIfEmpty,
                                dot: agent.state.tint,
                                selected: draft.agent?.id == agent.id,
                                active: agentIndex(agent) == agentHighlight
                            ) { chooseAgent(agent) }
                        }
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    private func toggleDropdown(_ id: String) {
        openDropdown = (openDropdown == id) ? nil : id
    }

    // Accent mark + title + sub-identity, with a ghost close affordance — ports
    // the study header (design/studio/.../scout-new-conversation).
    private var header: some View {
        HStack(alignment: .top, spacing: HudSpacing.xl) {
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutPalette.accentSoft)
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .stroke(ScoutSurface.tintBorder(ScoutPalette.accent), lineWidth: HudStrokeWidth.thin)
                )
                .frame(width: 32, height: 32)
                .overlay(
                    Image(systemName: "plus.bubble")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                )

            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(draft.title)
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text(subtitle)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }

            Spacer(minLength: HudSpacing.md)

            Button { if !isSubmitting { onClose() } } label: {
                Image(systemName: "xmark")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                    .frame(width: 24, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .fill(Color.clear)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .disabled(isSubmitting)
            .help("Close")
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
            HudSectionLabel("Target", tint: ScoutPalette.dim)
            targetKindPicker

            if isProjectTarget {
                projectModelHarnessRow
            } else {
                agentComboField
                harnessModelChips
                modePicker
            }
        }
    }

    /// A single grouped segmented control: one hairline track over an inset
    /// well, segments sharing it; the active segment is a solid accent block
    /// with a bg-color label (mirrors the Comms `.filters`/`.filter` toggle).
    private var targetKindPicker: some View {
        HStack(spacing: HudSpacing.xxs) {
            segment(title: "Project", icon: "folder", isSelected: isProjectTarget) {
                draft.target = .project
            }
            segment(title: "Agent", icon: "person.crop.circle", isSelected: !isProjectTarget) {
                guard let agent = draft.agent ?? availableAgents.first else { return }
                selectAgent(agent)
            }
            .disabled(availableAgents.isEmpty)
            .help(availableAgents.isEmpty ? "No agents in roster" : "Target an existing agent")
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }

    /// One segment of a grouped toggle. Active = solid `accent` block + bg-color
    /// semibold label; inactive = clear fill + muted label.
    private func segment(title: String, icon: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(isSelected ? ScoutPalette.bg : ScoutPalette.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(isSelected ? ScoutPalette.accent : Color.clear)
            )
        }
        .buttonStyle(.plain).scoutPointerCursor()
    }

    // The agent target picker — a type-to-filter combobox over the roster,
    // grouped by project (project → agent → model). Replaces the old `Menu`;
    // its dropdown is rendered flush via `dropdownContent(for: "agent")`.
    @ViewBuilder
    private var agentComboField: some View {
        if availableAgents.isEmpty {
            pickerField(icon: "person.crop.circle.badge.exclamationmark", title: "No agents", detail: "Open setup to register an agent")
        } else {
            agentSearchField
        }
    }

    private var agentSearchField: some View {
        let isOpen = openDropdown == "agent"
        let showStatic = !agentFieldFocused && agentQuery.isEmpty
        return HStack(spacing: HudSpacing.sm) {
            Circle()
                .fill(agentFieldDotColor)
                .frame(width: 7, height: 7)

            ZStack(alignment: .leading) {
                TextField("Search agents…", text: $agentQuery)
                    .textFieldStyle(.plain)
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .tint(ScoutPalette.accent)
                    .focused($agentFieldFocused)
                    .opacity(showStatic ? 0 : 1)
                    .onKeyPress(phases: .down) { handleAgentKey($0) }

                if showStatic {
                    Text(draft.agent?.displayName ?? "Search agents…")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(draft.agent == nil ? ScoutPalette.dim : ScoutPalette.ink)
                        .lineLimit(1)
                        .allowsHitTesting(false)
                }
            }

            Spacer(minLength: HudSpacing.sm)

            if showStatic, let agent = draft.agent {
                Text("\(projectLabel(for: agent)) · \(agent.model?.nilIfEmpty ?? agent.harness?.nilIfEmpty ?? "—")")
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }

            Image(systemName: "chevron.down")
                .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
                .rotationEffect(.degrees(isOpen ? 180 : 0))
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 42)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke((isOpen || agentFieldFocused) ? ScoutPalette.accent.opacity(0.6) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin))
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .anchorPreference(key: DropdownAnchorKey.self, value: .bounds) { ["agent": $0] }
        .onTapGesture { agentFieldFocused = true }
        .onChange(of: agentFieldFocused) { _, focused in
            if focused { openDropdown = "agent"; agentHighlight = 0 } else { scheduleAgentClose() }
        }
        .onChange(of: agentQuery) { _, _ in
            if agentFieldFocused { openDropdown = "agent"; agentHighlight = 0 }
        }
    }

    private var agentFieldDotColor: Color {
        if !agentQuery.isEmpty { return agentFlat.first?.state.tint ?? ScoutPalette.dim }
        return draft.agent?.state.tint ?? ScoutPalette.dim
    }

    // Filtered + project-grouped roster.
    private var filteredAgents: [ScoutAgent] {
        let q = agentQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return availableAgents }
        return availableAgents.filter {
            $0.displayName.lowercased().contains(q) || projectLabel(for: $0).lowercased().contains(q)
        }
    }

    private var agentGroups: [(project: String, agents: [ScoutAgent])] {
        var order: [String] = []
        var byProject: [String: [ScoutAgent]] = [:]
        for agent in filteredAgents {
            let project = projectLabel(for: agent)
            if byProject[project] == nil { byProject[project] = []; order.append(project) }
            byProject[project, default: []].append(agent)
        }
        return order.map { (project: $0, agents: byProject[$0] ?? []) }
    }

    private var agentFlat: [ScoutAgent] { agentGroups.flatMap(\.agents) }

    private func agentIndex(_ agent: ScoutAgent) -> Int {
        agentFlat.firstIndex { $0.id == agent.id } ?? -1
    }

    private func chooseAgent(_ agent: ScoutAgent) {
        selectAgent(agent)
        agentQuery = ""
        agentFieldFocused = false
        openDropdown = nil
    }

    private func handleAgentKey(_ press: KeyPress) -> KeyPress.Result {
        switch press.key {
        case .downArrow:
            openDropdown = "agent"
            agentHighlight = min(agentHighlight + 1, max(agentFlat.count - 1, 0))
            return .handled
        case .upArrow:
            agentHighlight = max(agentHighlight - 1, 0)
            return .handled
        case .return:
            if agentFlat.indices.contains(agentHighlight) {
                chooseAgent(agentFlat[agentHighlight])
                return .handled
            }
            return .ignored
        case .tab:
            if agentFlat.indices.contains(agentHighlight) {
                chooseAgent(agentFlat[agentHighlight])
                return .handled
            }
            return .ignored
        case .escape:
            if openDropdown == "agent" {
                openDropdown = nil
                agentFieldFocused = false
                return .handled
            }
            return .ignored
        default:
            return .ignored
        }
    }

    // Don't close on blur immediately — a row click blurs the field first, so a
    // short grace period lets the row's action register before we dismiss.
    private func scheduleAgentClose() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            if !agentFieldFocused && openDropdown == "agent" {
                openDropdown = nil
                agentQuery = ""
            }
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin))
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
    }

    private var modePicker: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.xxs) {
                modeSegment(.fresh, title: "Fresh start", icon: "plus.bubble")
                modeSegment(.continueContext, title: "Continue", icon: "arrow.uturn.forward", disabled: !draft.canContinue)
            }
            .padding(HudSpacing.xxs)
            .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
            if !draft.canContinue {
                Text("No resumable harness session for this agent")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
    }

    private func modeSegment(_ mode: ScoutSessionDraft.Mode, title: String, icon: String, disabled: Bool = false) -> some View {
        let isSelected = draft.mode == mode
        return Button {
            guard !disabled else { return }
            draft.mode = mode
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(isSelected ? ScoutPalette.bg : ScoutPalette.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(isSelected ? ScoutPalette.accent : Color.clear)
                )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .help(disabled ? "No resumable harness session for this agent" : title)
    }

    private var messageSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HudSectionLabel(draft.mode == .continueContext ? "Follow-up message" : "First message", tint: ScoutPalette.dim)
            if draft.fromMessageId?.nilIfEmpty != nil {
                seedChip
            }
            consolidatedMessageBox
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.control))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }

    // Consolidated two-zone box (input top / toolbar bottom) — mirrors the
    // conversation-stream composer (ScoutRootView `composerInputWell`). Cancel ·
    // ⌘↵ guide · mic · send all live in the bottom bar, so there's no separate
    // footer. Rounded well → focus border + a soft accent ring, never a left bar
    // (see feedback_no_left_bar_on_rounded).
    private var consolidatedMessageBox: some View {
        VStack(spacing: 0) {
            messageInputZone
            messageToolbarBar
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(instructionsFocused ? ScoutSurface.controlFocused : ScoutSurface.inset)
        )
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(instructionsFocused ? ScoutPalette.accent.opacity(0.6) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: instructionsFocused ? ScoutPalette.accent.opacity(0.12) : .clear, radius: 4, y: 1)
    }

    // A vertical TextField (not a TextEditor) so the placeholder is native and
    // the caret sits on the text baseline — mirrors the conversation composer's
    // `composerFieldRow`. Grows to ~10 lines; ⌘↵ submits via the send button.
    private var messageInputZone: some View {
        ZStack(alignment: .topLeading) {
            TextField(showDictationPreview ? "" : messagePlaceholder, text: $draft.instructions, axis: .vertical)
                .textFieldStyle(.plain)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.ink)
                .tint(showDictationPreview ? Color.clear : ScoutPalette.accent)
                .lineLimit(1...10)
                .focused($instructionsFocused)
                .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)

            if showDictationPreview {
                ScoutDictationPreview(text: voice.partial)
                    .allowsHitTesting(false)
            }
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.md)
    }

    // The internal toolbar plane sits a step below the field — the canvas bg, so
    // the bar reads as a recessed footer (studio `.boxBar`): Cancel left, the
    // ⌘↵ guide + mic + send clustered right, under a hairline.
    private var messageToolbarBar: some View {
        HStack(spacing: HudSpacing.sm) {
            Button { if !isSubmitting { onClose() } } label: {
                Text("Cancel")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xs)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .disabled(isSubmitting)
            .help("Cancel")

            Spacer(minLength: HudSpacing.sm)

            (Text("⌘↵")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundColor(ScoutPalette.muted)
             + Text(" to \(startTitle.lowercased())")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundColor(ScoutPalette.dim))
                .lineLimit(1)

            ScoutMicButton(box: 26, glyph: 13, action: toggleDictation)

            messageSendButton
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(ScoutDesign.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(instructionsFocused ? ScoutPalette.accent.opacity(0.6) : ScoutDesign.hairlineStrong)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    // Send glyph — accent square + ↑ (studio `.barSend`), mirroring the
    // conversation composer's ScoutSendButton. Drives `submit()` + ⌘↵.
    private var messageSendButton: some View {
        let ready = canSubmit && !isSubmitting
        return Button { submit() } label: {
            ZStack {
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(ready ? ScoutPalette.accent : ScoutSurface.inset)
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ready ? ScoutPalette.accent.opacity(0.46) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                if isSubmitting {
                    ProgressView().controlSize(.small).scaleEffect(0.56).tint(ScoutPalette.dim)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: HudTextSize.sm, weight: .bold))
                        .foregroundStyle(ready ? ScoutDesign.bg : ScoutPalette.dim)
                }
            }
            .frame(width: 26, height: 26)
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .disabled(!ready)
        .keyboardShortcut(.return, modifiers: .command)
        .help(startTitle)
    }

    // Model + harness — first-class, always-visible (not buried in Options).
    // Model leads (project → model → harness); picking a model sets its harness,
    // picking a harness scopes the model. Both fall back to the selected agent's
    // values, shown as "Default" when nothing is explicitly set.
    // Project · Model · Harness — three equal, flush chips on one line (project
    // target). The chips flex to share the row (ScoutDropdownTrigger fills when its
    // `width` is nil), so the same components serve the 2-chip agent row below.
    private var projectModelHarnessRow: some View {
        HStack(spacing: HudSpacing.sm) {
            projectChip
            modelChip
            harnessChip
        }
    }

    private var harnessModelChips: some View {
        HStack(spacing: HudSpacing.sm) {
            modelChip
            harnessChip
        }
    }

    private var projectChip: some View {
        ScoutDropdownTrigger(
            id: "project",
            key: "Project",
            value: draft.projectPath.nilIfEmpty.map { projectName(for: $0) } ?? "Choose…",
            isOpen: openDropdown == "project"
        ) { toggleDropdown("project") }
    }

    private var modelChip: some View {
        ScoutDropdownTrigger(
            id: "model",
            key: "Model",
            value: effectiveModelLabel,
            isOpen: openDropdown == "model"
        ) { toggleDropdown("model") }
    }

    private var harnessChip: some View {
        ScoutDropdownTrigger(
            id: "harness",
            key: "Harness",
            value: effectiveHarnessLabel,
            valueDot: ScoutPalette.accent,
            isOpen: openDropdown == "harness"
        ) { toggleDropdown("harness") }
    }

    private var effectiveModelLabel: String {
        draft.model?.nilIfEmpty ?? draft.agent?.model?.nilIfEmpty ?? "Default"
    }

    private var effectiveHarnessLabel: String {
        draft.harness?.nilIfEmpty ?? draft.agent?.harness?.nilIfEmpty ?? "Default"
    }

    // Distinct models grouped by harness, observed across the roster — the real
    // catalog (native has no static model list). Picking one also sets harness.
    private var modelChoices: [(harness: String, models: [String])] {
        var order: [String] = []
        var byHarness: [String: [String]] = [:]
        for agent in agents {
            guard let model = agent.model?.nilIfEmpty else { continue }
            let harness = agent.harness?.nilIfEmpty ?? "Other"
            if byHarness[harness] == nil {
                byHarness[harness] = []
                order.append(harness)
            }
            if !(byHarness[harness]?.contains(model) ?? false) {
                byHarness[harness, default: []].append(model)
            }
        }
        return order.map { (harness: $0, models: byHarness[$0] ?? []) }
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
