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

// MARK: - Composer

struct ScoutSessionProjectOption: Identifiable, Equatable {
    var path: String
    var name: String
    var detail: String

    var id: String { path }
}

private struct ScoutSessionModelChoice: Identifiable, Equatable {
    var harness: String
    var value: String
    var label: String
    var detail: String?

    var id: String { "\(harness):\(value)" }
}

private struct ScoutSessionHarnessCatalog: Identifiable, Equatable {
    var id: String
    var label: String
    var models: [ScoutSessionModelChoice]

    static let all: [ScoutSessionHarnessCatalog] = [
        .init(id: "claude", label: "Claude Code", models: [
            .init(harness: "claude", value: "fable", label: "Fable", detail: "Claude Code alias"),
            .init(harness: "claude", value: "opus", label: "Opus", detail: "Claude Code alias"),
            .init(harness: "claude", value: "claude-opus-4-8", label: "Opus 4.8", detail: "Pinned ID"),
            .init(harness: "claude", value: "sonnet", label: "Sonnet", detail: "Claude Code alias"),
            .init(harness: "claude", value: "claude-sonnet-4-6", label: "Sonnet 4.6", detail: "Pinned ID"),
            .init(harness: "claude", value: "haiku", label: "Haiku", detail: "Claude Code alias"),
            .init(harness: "claude", value: "claude-haiku-4-5", label: "Haiku 4.5", detail: "Claude API alias"),
        ]),
        .init(id: "codex", label: "Codex", models: [
            .init(harness: "codex", value: "gpt-5.5", label: "GPT-5.5", detail: "Recommended"),
            .init(harness: "codex", value: "gpt-5.5-mini", label: "GPT-5.5 mini", detail: "Fast"),
        ]),
    ]
}

private struct ScoutSessionEffortChoice: Identifiable, Equatable {
    var value: String
    var label: String
    var detail: String?

    var id: String { value }

    static let all: [ScoutSessionEffortChoice] = [
        .init(value: "none", label: "None", detail: "No extra thinking"),
        .init(value: "minimal", label: "Minimal", detail: "Smallest reasoning budget"),
        .init(value: "low", label: "Low", detail: "Quick pass"),
        .init(value: "medium", label: "Medium", detail: "Default"),
        .init(value: "high", label: "High", detail: "Deeper pass"),
        .init(value: "xhigh", label: "XHigh", detail: "Highest supported"),
    ]
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
    @State private var agentFieldHovering = false
    @State private var messageBoxHovering = false
    @FocusState private var instructionsFocused: Bool
    @FocusState private var agentFieldFocused: Bool
    @ObservedObject private var voice = ScoutRemoteVoiceService.shared
    @AppStorage("scout.session.lastProjectPath") private var lastProjectPath = ""
    @AppStorage("scout.session.lastHarness") private var lastHarness = ""
    @AppStorage("scout.session.lastModel") private var lastModel = ""
    @AppStorage("scout.session.lastReasoningEffort") private var lastReasoningEffort = ""

    private let agents: [ScoutAgent]
    private let projectOptions: [ScoutSessionProjectOption]
    private static let lastHarnessKey = "scout.session.lastHarness"
    private static let lastModelKey = "scout.session.lastModel"
    private static let lastReasoningEffortKey = "scout.session.lastReasoningEffort"

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
        _draft = State(initialValue: Self.applyLastRuntimeChoices(to: draft))
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.thinMaterial)
                .overlay(Color.black.opacity(0.36))
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { if !isSubmitting { onClose() } }

            card
                .frame(width: Self.modalWidth)
                .padding(HudSpacing.xxl)
        }
        .onExitCommand { if !isSubmitting { onClose() } }
        .onReceive(voice.$lastFinalText) { spliceDictatedFinal($0) }
        .onAppear { instructionsFocused = true }
        .onChange(of: draft.harness) { _, _ in persistLastRuntimeChoices() }
        .onChange(of: draft.model) { _, _ in persistLastRuntimeChoices() }
        .onChange(of: draft.reasoningEffort) { _, _ in persistLastRuntimeChoices() }
    }

    private var isDictating: Bool { voice.state.isCaptureActive }

    private var voiceUnavailableReason: String? {
        if case .unavailable(let reason) = voice.state { return reason }
        return nil
    }

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
        var seen: Set<String> = []
        var choices: [String] = []

        func append(_ value: String?) {
            guard let harness = value?.nilIfEmpty else { return }
            let key = harness.lowercased()
            guard seen.insert(key).inserted else { return }
            choices.append(harness)
        }

        append(draft.harness)
        append(draft.agent?.harness)
        for catalog in ScoutSessionHarnessCatalog.all { append(catalog.id) }
        for agent in agents { append(agent.harness) }
        return choices
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
            return "What should the agent start on?"
        }
    }

    private static func applyLastRuntimeChoices(to draft: ScoutSessionDraft) -> ScoutSessionDraft {
        guard draft.mode != .continueContext else { return draft }
        var copy = draft
        let defaults = UserDefaults.standard
        let storedHarness = defaults.string(forKey: lastHarnessKey)?.nilIfEmpty
        let storedModel = defaults.string(forKey: lastModelKey)?.nilIfEmpty
        let storedEffort = defaults.string(forKey: lastReasoningEffortKey)?.nilIfEmpty
        let hadExplicitHarness = copy.harness?.nilIfEmpty != nil

        if copy.harness?.nilIfEmpty == nil, let storedHarness {
            copy.harness = storedHarness
        }
        if copy.model?.nilIfEmpty == nil, let storedModel {
            if !hadExplicitHarness {
                copy.model = storedModel
            } else if let storedHarness, let explicitHarness = copy.harness?.nilIfEmpty,
                      storedHarness.caseInsensitiveCompare(explicitHarness) == .orderedSame {
                copy.model = storedModel
            }
        }
        // Default draft effort is "medium". Only restore the last choice when the
        // caller left that default in place; an explicit non-default effort wins.
        if copy.reasoningEffort.nilIfEmpty == "medium" || copy.reasoningEffort.nilIfEmpty == nil,
           let storedEffort {
            copy.reasoningEffort = storedEffort
        }
        return copy
    }

    private func persistLastRuntimeChoices() {
        guard draft.mode != .continueContext else { return }
        lastHarness = draft.harness?.nilIfEmpty ?? ""
        lastModel = draft.model?.nilIfEmpty ?? ""
        lastReasoningEffort = draft.reasoningEffort.nilIfEmpty ?? "medium"
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
        ScoutRemoteVoiceService.shared.consumeFinalText()
        instructionsFocused = true
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
            header
            targetSection
            if isProjectTarget {
                optionalAliasField
            }
            messageSection
            if let reason = voiceUnavailableReason {
                ScoutVoiceIssueRow(message: reason) {
                    Task { await voice.openMicrophoneSettings() }
                }
            }
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
                let harness = effectiveHarnessValue
                ScoutDropdownSectionLabel(text: harnessDisplayName(harness))
                ForEach(modelChoices(for: harness)) { model in
                    ScoutDropdownRow(
                        label: model.label,
                        detail: model.detail,
                        selected: draft.model == model.value
                    ) {
                        draft.harness = harness
                        draft.model = model.value
                        openDropdown = nil
                    }
                }
            }
        case "harness":
            ScoutDropdownPanel {
                ScoutDropdownRow(label: "Default", selected: draft.harness == nil) {
                    draft.harness = nil
                    clearModelIfNeeded()
                    openDropdown = nil
                }
                ForEach(harnessChoices, id: \.self) { harness in
                    ScoutDropdownRow(
                        label: harnessDisplayName(harness),
                        detail: harnessDisplayDetail(harness),
                        dot: ScoutPalette.accent,
                        selected: draft.harness == harness
                    ) {
                        draft.harness = harness
                        clearModelIfNeeded()
                        openDropdown = nil
                    }
                }
            }
        case "effort":
            ScoutDropdownPanel {
                ForEach(ScoutSessionEffortChoice.all) { effort in
                    ScoutDropdownRow(
                        label: effort.label,
                        detail: effort.detail,
                        selected: draft.reasoningEffort == effort.value
                    ) {
                        draft.reasoningEffort = effort.value
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
                : "New chat with \(agent.displayName)"
        case .project:
            return "Choose project and first message"
        }
    }

    private var targetSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            if isProjectTarget {
                HudSectionLabel("Project", tint: ScoutPalette.dim)
                projectModelHarnessRow
            } else {
                HudSectionLabel("Agent", tint: ScoutPalette.dim)
                agentComboField
                harnessModelChips
                modePicker
            }
        }
    }

    private var optionalAliasField: some View {
        aliasTextField(
            key: "@",
            placeholder: "Optional alias",
            text: $draft.agentName,
            mono: true
        )
        .help("Optional agent alias")
    }

    private func aliasTextField(key: String, placeholder: String, text: Binding<String>, mono: Bool = false) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(key)
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
                .textCase(.uppercase)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(mono ? HudFont.mono(HudTextSize.xs, weight: .medium) : HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .tint(ScoutPalette.accent)
                .lineLimit(1)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 38)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin))
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
        let engaged = isOpen || agentFieldFocused || agentFieldHovering
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
                .foregroundStyle(engaged ? ScoutPalette.accent : ScoutPalette.dim)
                .rotationEffect(.degrees(isOpen ? 180 : 0))
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 42)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(engaged ? ScoutSurface.hover : ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(
                    (isOpen || agentFieldFocused) ? ScoutPalette.accent.opacity(0.50) : ScoutDesign.hairlineStrong,
                    lineWidth: HudStrokeWidth.thin
                )
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .anchorPreference(key: DropdownAnchorKey.self, value: .bounds) { ["agent": $0] }
        .onHover { agentFieldHovering = $0 }
        .onTapGesture {
            agentFieldFocused = true
            openDropdown = "agent"
        }
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
    // footer. Rounded well → quiet focus border, never a left bar
    // (see feedback_no_left_bar_on_rounded).
    private var consolidatedMessageBox: some View {
        let engaged = messageBoxEngaged
        return VStack(spacing: 0) {
            messageInputZone
            messageToolbarBar
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(instructionsFocused ? ScoutSurface.controlFocused : (engaged ? ScoutSurface.control : ScoutSurface.inset))
        )
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(
                    instructionsFocused ? ScoutPalette.accent.opacity(0.50) : ScoutDesign.hairlineStrong,
                    lineWidth: HudStrokeWidth.thin
                )
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .onHover { messageBoxHovering = $0 }
        .onTapGesture {
            openDropdown = nil
            instructionsFocused = true
        }
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
                .onKeyPress(phases: .down) { press in
                    guard press.key == .return else { return .ignored }
                    guard press.modifiers.contains(.command) || press.modifiers.contains(.control) else { return .ignored }
                    submit()
                    return .handled
                }
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
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.muted)
                    .padding(.horizontal, HudSpacing.sm)
                    .frame(height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .disabled(isSubmitting)
            .help("Cancel")

            Spacer(minLength: HudSpacing.sm)

            Text("⌘↵")
                .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundColor(ScoutPalette.muted)
                .lineLimit(1)
                .frame(height: 30)
                .padding(.horizontal, HudSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutSurface.inset)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )

            ScoutMicButton(box: 30, glyph: 15, action: toggleDictation)

            messageSendButton
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(ScoutDesign.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(instructionsFocused ? ScoutPalette.accent.opacity(0.40) : ScoutDesign.hairlineStrong)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    private var messageBoxEngaged: Bool {
        instructionsFocused
            || messageBoxHovering
            || !draft.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || voice.state.isCaptureActive
            || voice.state.isProcessing
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
                    ScoutBrailleSpinner(size: 12, tint: ScoutPalette.accent)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: HudTextSize.md, weight: .bold))
                        .foregroundStyle(ready ? ScoutDesign.bg : ScoutPalette.dim)
                }
            }
            .frame(width: 30, height: 30)
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .disabled(!ready)
        .keyboardShortcut(.return, modifiers: .command)
        .help(startTitle)
    }

    // Harness + model — first-class, always-visible (not buried in Options).
    // Harness leads (project -> harness -> model); picking a harness scopes the
    // model list. Both fall back to the selected agent's values, shown as
    // "Default" when nothing is explicitly set.
    // Project · Harness · Model — three equal, flush chips on one line (project
    // target). The chips flex to share the row (ScoutDropdownTrigger fills when its
    // `width` is nil), so the same components serve the 2-chip agent row below.
    private var projectModelHarnessRow: some View {
        HStack(spacing: HudSpacing.sm) {
            projectChip
            harnessChip
            modelChip
            effortChip
        }
    }

    private var harnessModelChips: some View {
        HStack(spacing: HudSpacing.sm) {
            harnessChip
            modelChip
            effortChip
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

    private var effortChip: some View {
        ScoutDropdownTrigger(
            id: "effort",
            key: "Effort",
            value: effortDisplayName(draft.reasoningEffort),
            isOpen: openDropdown == "effort"
        ) { toggleDropdown("effort") }
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
        if let model = draft.model?.nilIfEmpty ?? draft.agent?.model?.nilIfEmpty {
            return modelDisplayName(model)
        }
        return "Default"
    }

    private var effectiveHarnessLabel: String {
        guard let harness = draft.harness?.nilIfEmpty ?? draft.agent?.harness?.nilIfEmpty else {
            return "Default"
        }
        return harnessDisplayName(harness)
    }

    private var effectiveHarnessValue: String {
        draft.harness?.nilIfEmpty
            ?? draft.agent?.harness?.nilIfEmpty
            ?? ScoutSessionHarnessCatalog.all.first?.id
            ?? "claude"
    }

    private func effortDisplayName(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Medium" }
        return ScoutSessionEffortChoice.all.first { $0.value == trimmed }?.label
            ?? trimmed.prefix(1).uppercased() + String(trimmed.dropFirst())
    }

    // Curated current model names, plus any models observed in the local roster.
    private func modelChoices(for harness: String, includeDraftModel: Bool = true) -> [ScoutSessionModelChoice] {
        let canonicalHarness = harness.lowercased()
        var seen: Set<String> = []
        var choices: [ScoutSessionModelChoice] = []

        func append(_ choice: ScoutSessionModelChoice) {
            guard !isRetiredCodexModel(choice.value, harness: choice.harness) else { return }
            guard seen.insert(choice.value.lowercased()).inserted else { return }
            choices.append(choice)
        }

        if let catalog = ScoutSessionHarnessCatalog.all.first(where: { $0.id == canonicalHarness }) {
            for model in catalog.models { append(model) }
        }

        for agent in agents {
            guard
                let model = agent.model?.nilIfEmpty,
                (agent.harness?.nilIfEmpty ?? "").lowercased() == canonicalHarness
            else { continue }
            append(.init(
                harness: harness,
                value: model,
                label: modelDisplayName(model),
                detail: observedModelDetail(model)
            ))
        }

        if includeDraftModel, let model = draft.model?.nilIfEmpty, !seen.contains(model.lowercased()) {
            append(.init(
                harness: harness,
                value: model,
                label: modelDisplayName(model),
                detail: observedModelDetail(model)
            ))
        }

        return choices
    }

    private func clearModelIfNeeded() {
        guard let model = draft.model?.nilIfEmpty else { return }
        let valid = modelChoices(for: effectiveHarnessValue, includeDraftModel: false).contains {
            $0.value.caseInsensitiveCompare(model) == .orderedSame
        }
        if !valid {
            draft.model = nil
        }
    }

    private func harnessDisplayName(_ harness: String) -> String {
        let trimmed = harness.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Default" }
        if let catalog = ScoutSessionHarnessCatalog.all.first(where: { $0.id == trimmed.lowercased() }) {
            return catalog.label
        }
        return trimmed.prefix(1).uppercased() + String(trimmed.dropFirst())
    }

    private func harnessDisplayDetail(_ harness: String) -> String? {
        let trimmed = harness.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let label = harnessDisplayName(trimmed)
        return label.caseInsensitiveCompare(trimmed) == .orderedSame ? nil : trimmed
    }

    private func observedModelDetail(_ model: String) -> String? {
        let label = modelDisplayName(model)
        return label.caseInsensitiveCompare(model) == .orderedSame ? nil : model
    }

    private func modelDisplayName(_ model: String) -> String {
        let trimmed = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Default" }

        for catalog in ScoutSessionHarnessCatalog.all {
            if let choice = catalog.models.first(where: { $0.value.caseInsensitiveCompare(trimmed) == .orderedSame }) {
                return choice.label
            }
        }

        let lower = trimmed.lowercased()
        if ["fable", "opus", "sonnet", "haiku"].contains(lower) {
            return lower.prefix(1).uppercased() + String(lower.dropFirst())
        }
        if lower.hasPrefix("claude-") {
            let parts = lower.split(separator: "-").map(String.init)
            if parts.count >= 4 {
                let family = parts[1].prefix(1).uppercased() + String(parts[1].dropFirst())
                let version = parts[2...].prefix(2).joined(separator: ".")
                return "\(family) \(version)"
            }
        }
        if lower.hasPrefix("gpt-") {
            let body = trimmed.dropFirst(4)
            let words = body.split(separator: "-").map { part -> String in
                let text = String(part)
                if text.lowercased() == "mini" { return "mini" }
                return text.prefix(1).uppercased() + String(text.dropFirst())
            }
            return "GPT-\(words.joined(separator: " "))"
        }
        return trimmed
    }

    private func isRetiredCodexModel(_ model: String, harness: String) -> Bool {
        guard harness.lowercased() == "codex" else { return false }
        let lower = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return lower == "gpt-5.3-codex-spark" || lower.hasPrefix("gpt-5.4")
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

    private func shortSessionLabel(_ sessionId: String) -> String {
        let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Session" }
        return trimmed.count <= 12 ? trimmed : String(trimmed.suffix(12))
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
        persistLastRuntimeChoices()
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
