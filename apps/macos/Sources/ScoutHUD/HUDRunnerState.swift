import AppKit
import Combine
import Foundation
import ScoutAppCore
import ScoutNativeCore
import ScoutSharedUI

@MainActor
final class HUDRunnerState: ObservableObject {
    static let shared = HUDRunnerState()

    @Published var isPresented: Bool = false
    @Published var options: HudRunnerOptions?
    @Published var directory: String = ""
    @Published var projectQuery: String = ""
    @Published var selectedProjectId: String?
    @Published var projectCursorIndex: Int = 0
    @Published var selectedHarness: String = "claude"
    @Published var selectedModel: String = ""
    @Published var persistence: String = "sticky"
    @Published var agentName: String = ""
    @Published var displayName: String = ""
    @Published var instructions: String = ""
    @Published var showAdvanced: Bool = false
    @Published var isLoading: Bool = false
    @Published var isSubmitting: Bool = false
    @Published var lastError: String?
    @Published var lastResponse: HudRunnerAskResponse?

    private var didApplyDefaults = false

    private init() {}

    func open(prefillInstructions: String? = nil, projectRoot: String? = nil) {
        isPresented = true
        lastError = nil
        if let projectRoot = projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines),
           !projectRoot.isEmpty {
            directory = projectRoot
            projectQuery = URL(fileURLWithPath: projectRoot).lastPathComponent
            selectedProjectId = nil
            projectCursorIndex = 0
        }
        if let prefill = prefillInstructions?.trimmingCharacters(in: .whitespacesAndNewlines),
           !prefill.isEmpty,
           instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            instructions = prefill
        }
        Task { await loadOptionsIfNeeded() }
    }

    func dismiss() {
        isPresented = false
    }

    func loadOptionsIfNeeded() async {
        guard options == nil, !isLoading else { return }
        await reloadOptions()
    }

    func reloadOptions() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await HudRunnerService.fetchOptions()
            options = loaded
            applyDefaultsIfNeeded(loaded)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func chooseProject(_ project: HudRunnerProjectOption) {
        selectedProjectId = project.id
        projectQuery = project.title
        projectCursorIndex = 0
        directory = project.root
        if let defaultHarness = project.defaultHarness, !defaultHarness.isEmpty {
            selectHarness(defaultHarness)
        }
        if agentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            agentName = slug(project.title)
        }
        if displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            displayName = project.title
        }
    }

    func updateProjectQuery(_ value: String) {
        projectQuery = value
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let project = exactProjectMatch(for: trimmed) {
            chooseProject(project)
        } else {
            selectedProjectId = nil
            projectCursorIndex = 0
            if looksLikePath(trimmed) {
                directory = trimmed
            }
        }
    }

    func browseForDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.title = "Choose Agent Directory"
        if !directory.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: directory)
        }
        if panel.runModal() == .OK, let url = panel.url {
            directory = url.path
        }
    }

    var availableModels: [HudRunnerModelOption] {
        let all = options?.models ?? []
        let filtered = all.filter { model in
            model.harnesses.isEmpty
                || model.harnesses.contains(selectedHarness)
        }
        return filtered.isEmpty ? [HudRunnerModelOption(id: "", label: fallbackModelLabel(for: selectedHarness), harnesses: [], source: "fallback")] : filtered
    }

    var matchingAgents: [HudRunnerAgentOption] {
        let normalizedDirectory = standardizedPath(directory)
        guard !normalizedDirectory.isEmpty else { return [] }
        return options?.agents.filter { agent in
            standardizedPath(agent.projectRoot ?? agent.cwd ?? "") == normalizedDirectory
        } ?? []
    }

    var selectedProject: HudRunnerProjectOption? {
        guard let selectedProjectId else { return nil }
        return options?.projects.first { $0.id == selectedProjectId }
    }

    var shouldShowProjectMatches: Bool {
        selectedProject == nil && !projectMatches(limit: 1).isEmpty
    }

    var directoryHint: String {
        let value = selectedProject?.root ?? directory
        guard !value.isEmpty else { return "" }
        return displayPath(value)
    }

    func pathLabel(for value: String) -> String {
        displayPath(value)
    }

    var runnerPresetLabel: String {
        let harness = (options?.harnesses.first { $0.id == selectedHarness }?.label ?? selectedHarness).trimmedNonEmpty ?? "Scout"
        let model = availableModels.first { $0.id == selectedModel }?.label
            ?? selectedModel.trimmedNonEmpty
            ?? fallbackModelLabel(for: selectedHarness)
        return "\(harness) · \(model)"
    }

    var routingLabel: String {
        persistence == "sticky" ? "Agent card" : "One-time card"
    }

    func projectMatches(limit: Int = 6) -> [HudRunnerProjectOption] {
        let projects = options?.projects ?? []
        let query = normalizedSearch(projectQuery)
        let selected = selectedProject

        if query.isEmpty {
            var result: [HudRunnerProjectOption] = []
            if let selected {
                result.append(selected)
            }
            for project in projects where !result.contains(where: { $0.id == project.id }) {
                result.append(project)
                if result.count >= limit { break }
            }
            return result
        }

        return projects
            .compactMap { project -> (HudRunnerProjectOption, Int)? in
                let title = normalizedSearch(project.title)
                let basename = normalizedSearch(URL(fileURLWithPath: project.root).lastPathComponent)
                let root = normalizedSearch(project.root)
                if title == query || basename == query { return (project, 0) }
                if title.hasPrefix(query) || basename.hasPrefix(query) { return (project, 1) }
                if title.contains(query) || basename.contains(query) { return (project, 2) }
                if root.contains(query) { return (project, 3) }
                return nil
            }
            .sorted { lhs, rhs in
                if lhs.1 != rhs.1 { return lhs.1 < rhs.1 }
                return lhs.0.title.localizedCaseInsensitiveCompare(rhs.0.title) == .orderedAscending
            }
            .prefix(limit)
            .map { $0.0 }
    }

    func isProjectCursored(_ project: HudRunnerProjectOption, limit: Int = 5) -> Bool {
        let matches = projectMatches(limit: limit)
        guard !matches.isEmpty else { return false }
        let index = min(max(projectCursorIndex, 0), matches.count - 1)
        return matches[index].id == project.id
    }

    func moveProjectCursor(_ delta: Int) {
        let matches = projectMatches(limit: 5)
        guard !matches.isEmpty else { return }
        let next = projectCursorIndex + delta
        projectCursorIndex = min(max(next, 0), matches.count - 1)
    }

    @discardableResult
    func acceptProjectCursor() -> Bool {
        let matches = projectMatches(limit: 5)
        guard !matches.isEmpty else { return false }
        let index = min(max(projectCursorIndex, 0), matches.count - 1)
        chooseProject(matches[index])
        return true
    }

    @discardableResult
    func handleKey(keyCode: UInt16, modifiers: NSEvent.ModifierFlags) -> Bool {
        guard isPresented else { return false }
        if modifiers.contains(.command), (keyCode == 36 || keyCode == 76) {
            Task { await submit() }
            return true
        }
        switch keyCode {
        case 125: // Down arrow
            guard shouldShowProjectMatches else { return true }
            moveProjectCursor(+1)
            return true
        case 126: // Up arrow
            guard shouldShowProjectMatches else { return true }
            moveProjectCursor(-1)
            return true
        case 36, 48: // Return, Tab
            if shouldShowProjectMatches {
                return acceptProjectCursor()
            }
            return false
        default:
            return false
        }
    }

    func selectHarness(_ harness: String) {
        selectedHarness = harness
        if !availableModels.contains(where: { $0.id == selectedModel }) {
            selectedModel = preferredModel(for: harness)
        }
    }

    func appendDictatedText(_ phrase: String) {
        instructions = ScoutDictationBuffer.appending(phrase, to: instructions)
    }

    func toggleDictation() async {
        let voice = HudVoiceService.shared
        switch ScoutDictationController.toggleDecision(for: voice.state) {
        case .probeThenStartIfIdle:
            await voice.probe()
            if case .idle = voice.state {
                voice.start()
            }
        case .start:
            voice.start()
        case .stop:
            voice.stop()
        case .ignore:
            return
        }
    }

    func submit() async {
        guard !isSubmitting else { return }
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDirectory = resolvedDirectoryForSubmit()
        guard !trimmedDirectory.isEmpty else {
            lastError = "Choose a project first."
            return
        }
        guard !trimmedInstructions.isEmpty else {
            lastError = "Add instructions first."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let response = try await HudRunnerService.ask(
                directory: trimmedDirectory,
                harness: selectedHarness,
                model: selectedModel,
                persistence: persistence,
                agentName: agentName,
                displayName: displayName,
                instructions: trimmedInstructions
            )
            lastResponse = response
            lastError = nil
            isPresented = false
            instructions = ""
            HUDFlashState.shared.flash(
                "asked \(response.targetAgentId ?? response.flight?.targetAgentId ?? "Scout agent")",
                kind: .success
            )
        } catch {
            lastError = error.localizedDescription
            HUDFlashState.shared.flash(error.localizedDescription)
        }
    }

    private func applyDefaultsIfNeeded(_ options: HudRunnerOptions) {
        guard !didApplyDefaults else { return }
        didApplyDefaults = true
        if directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            directory = options.defaults?.directory ?? NSHomeDirectory()
        }
        if let harness = options.defaults?.harness, !harness.isEmpty {
            selectedHarness = harness
        } else if let first = options.harnesses.first?.id {
            selectedHarness = first
        }
        selectedModel = options.defaults?.model ?? preferredModel(for: selectedHarness)
        if let defaultPersistence = options.defaults?.persistence,
           defaultPersistence == "one_time" || defaultPersistence == "sticky" {
            persistence = defaultPersistence
        }
        if let project = projectForDirectory(directory) {
            chooseProject(project)
        } else if projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            projectQuery = URL(fileURLWithPath: directory).lastPathComponent
        }
    }

    private func standardizedPath(_ value: String) -> String {
        guard !value.isEmpty else { return "" }
        return ((value as NSString).expandingTildeInPath as NSString).standardizingPath
    }

    private func resolvedDirectoryForSubmit() -> String {
        if let selected = selectedProject {
            return selected.root
        }
        let query = projectQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = exactProjectMatch(for: query) {
            return exact.root
        }
        let matches = projectMatches(limit: 2)
        if matches.count == 1 {
            return matches[0].root
        }
        if !query.isEmpty {
            return looksLikePath(query) ? query : ""
        }
        if !directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return directory.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return query
    }

    private func projectForDirectory(_ value: String) -> HudRunnerProjectOption? {
        let normalized = standardizedPath(value)
        guard !normalized.isEmpty else { return nil }
        return options?.projects.first { standardizedPath($0.root) == normalized }
    }

    private func exactProjectMatch(for value: String) -> HudRunnerProjectOption? {
        let query = normalizedSearch(value)
        guard !query.isEmpty else { return nil }
        return options?.projects.first { project in
            normalizedSearch(project.title) == query
                || normalizedSearch(URL(fileURLWithPath: project.root).lastPathComponent) == query
                || standardizedPath(project.root) == standardizedPath(value)
        }
    }

    private func preferredModel(for harness: String) -> String {
        let candidates = (options?.models ?? []).filter { model in
            !model.id.isEmpty && (model.harnesses.isEmpty || model.harnesses.contains(harness))
        }
        let preference: [String]
        switch harness {
        case "claude":
            preference = ["claude-opus-4-7", "opus", "sonnet", "haiku"]
        case "codex":
            preference = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]
        default:
            preference = []
        }
        for preferred in preference {
            if let match = candidates.first(where: { $0.id.lowercased() == preferred }) {
                return match.id
            }
        }
        return candidates.first?.id ?? ""
    }

    private func fallbackModelLabel(for harness: String) -> String {
        switch harness {
        case "claude": return "Opus"
        case "codex": return "GPT-5.5"
        default: return "model"
        }
    }

    private func normalizedSearch(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
    }

    private func displayPath(_ value: String) -> String {
        let home = NSHomeDirectory()
        if value == home { return "~" }
        if value.hasPrefix(home + "/") {
            return "~" + value.dropFirst(home.count)
        }
        return value
    }

    private func looksLikePath(_ value: String) -> Bool {
        value.hasPrefix("/") || value.hasPrefix("~") || value.contains("/")
    }

    private func slug(_ value: String) -> String {
        let lowered = value.lowercased()
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) ? Character(scalar) : "-"
        }
        return String(scalars)
            .split(separator: "-")
            .joined(separator: "-")
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
