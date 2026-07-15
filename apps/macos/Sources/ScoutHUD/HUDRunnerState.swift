import AppKit
import Combine
import Foundation
import ScoutAppCore
import ScoutNativeCore
import ScoutSharedUI

struct HUDRunnerLocalReference: Identifiable, Equatable {
    let url: URL

    var id: String { url.standardizedFileURL.path }
    var displayName: String {
        url.lastPathComponent.isEmpty ? url.path : url.lastPathComponent
    }
}

private struct HUDRunnerFileIntakeResult: Sendable {
    let url: URL
    let attachment: ScoutComposerImage?
}

@MainActor
enum HUDRunnerAccessibility {
    static func announce(
        _ message: String,
        priority: NSAccessibilityPriorityLevel = .high
    ) {
        NSAccessibility.post(
            element: NSApp as Any,
            notification: .announcementRequested,
            userInfo: [
                .announcement: message,
                .priority: priority.rawValue,
            ]
        )
    }
}

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
    @Published var reasoningEffort: String = "medium"
    @Published var persistence: String = "sticky"
    @Published var agentName: String = ""
    @Published var displayName: String = ""
    @Published var instructions: String = ""
    @Published var attachments: [ScoutComposerImage] = []
    @Published var localReferences: [HUDRunnerLocalReference] = []
    @Published var showAdvanced: Bool = false
    @Published var isLoading: Bool = false
    @Published var isSubmitting: Bool = false
    @Published private(set) var isCommittingTask = false
    @Published var lastError: String?
    @Published var lastResponse: ScoutSessionStartResult?
    @Published var projectFocusRequest = 0
    @Published var runtimeFocusRequest = 0
    @Published var instructionsFocusRequest = 0
    @Published var focusStepRequest = 0
    private(set) var focusStepDirection = 1
    @Published var projectInputFocused = false
    @Published private(set) var isStagingFiles = false
    @Published private(set) var isPreparingVoice = false

    private(set) var closesHUDOnDismiss = false

    private var didApplyDefaults = false
    private var capturedFileURLs: [URL] = []
    private var attachmentSourceURLs: [UUID: URL] = [:]
    private var automaticSelectedProjectId: String?
    private var submissionTask: Task<Void, Never>?
    private var submissionID: UUID?
    private var successDismissTask: Task<Void, Never>?
    private var activeFileIntakeIDs = Set<UUID>()
    private var voicePreparationID: UUID?

    private init() {}

    func open(
        prefillInstructions: String? = nil,
        projectRoot: String? = nil,
        closesHUDOnDismiss: Bool = false,
        freshDraft: Bool = false
    ) {
        successDismissTask?.cancel()
        successDismissTask = nil
        if freshDraft, !isSubmitting {
            resetDraft()
        }
        HUDRunnerActivationLease.shared.begin()
        self.closesHUDOnDismiss = closesHUDOnDismiss
        isPresented = true
        lastError = nil
        if let projectRoot = projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines),
           !projectRoot.isEmpty {
            directory = projectRoot
            projectQuery = URL(fileURLWithPath: projectRoot).lastPathComponent
            selectedProjectId = nil
            automaticSelectedProjectId = nil
            projectCursorIndex = 0
        }
        if let prefill = prefillInstructions?.trimmingCharacters(in: .whitespacesAndNewlines),
           !prefill.isEmpty,
           instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            instructions = prefill
        }
        Task { await loadOptionsIfNeeded() }
    }

    @discardableResult
    func dismiss() -> Bool {
        guard !isCommittingTask else {
            lastError = "Scout is confirming task creation; wait for the result."
            return false
        }
        cancelSubmission()
        finishPresentation()
        return true
    }

    private func finishPresentation() {
        cancelDictation()
        isPresented = false
        projectInputFocused = false
        HUDRunnerActivationLease.shared.end()
    }

    func cancel() {
        let shouldCloseHUD = closesHUDOnDismiss
        guard dismiss() else { return }
        if shouldCloseHUD {
            HUDController.shared.dismiss()
        }
    }

    private func cancelDictation() {
        voicePreparationID = nil
        isPreparingVoice = false
        let voice = HudVoiceService.shared
        if voice.state.isCaptureActive || voice.state.isProcessing {
            voice.cancel()
        }
        voice.consumeFinalText()
    }

    private func cancelSubmission() {
        submissionTask?.cancel()
        submissionTask = nil
        submissionID = nil
        isSubmitting = false
        isCommittingTask = false
    }

    private func resetDraft() {
        activeFileIntakeIDs.removeAll()
        isStagingFiles = false
        directory = options?.defaults?.directory ?? ""
        projectQuery = ""
        selectedProjectId = nil
        automaticSelectedProjectId = nil
        projectCursorIndex = 0
        agentName = ""
        displayName = ""
        instructions = ""
        attachments = []
        localReferences = []
        capturedFileURLs = []
        attachmentSourceURLs = [:]
        lastError = nil
        lastResponse = nil
        if let defaultProject = projectForDirectory(directory) {
            selectProject(defaultProject, automatic: true)
        } else if !directory.isEmpty {
            projectQuery = URL(fileURLWithPath: directory).lastPathComponent
        }
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
        selectProject(project, automatic: false)
    }

    private func selectProject(_ project: HudRunnerProjectOption, automatic: Bool) {
        selectedProjectId = project.id
        automaticSelectedProjectId = automatic ? project.id : nil
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
            automaticSelectedProjectId = nil
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
            projectQuery = url.path
            selectedProjectId = nil
            automaticSelectedProjectId = nil
        }
    }

    func browseForAttachments() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.canCreateDirectories = false
        panel.title = "Add Files or Folders"
        if panel.runModal() == .OK {
            _ = stageFileURLs(panel.urls)
        }
    }

    @discardableResult
    func stageAttachments(_ incoming: [ScoutComposerImage]) -> Bool {
        guard !incoming.isEmpty else {
            lastError = "Use markdown, code, images, or video clips."
            return false
        }
        guard !isSubmitting else {
            lastError = "Wait for the current task to finish before attaching files."
            return false
        }
        var remainingBytes = max(
            0,
            ScoutCapturePayloadStore.maximumAttachmentBytes
                - attachments.reduce(0) { $0 + $1.data.count }
        )
        var remainingCount = max(0, ScoutCapturePayloadStore.maximumAttachmentCount - attachments.count)
        var accepted: [ScoutComposerImage] = []
        for attachment in incoming where remainingCount > 0 {
            guard attachment.data.count <= remainingBytes else { continue }
            accepted.append(attachment)
            remainingBytes -= attachment.data.count
            remainingCount -= 1
        }
        guard !accepted.isEmpty else {
            lastError = "The attachment limit is 16 items / 32 MB total."
            return false
        }
        attachments.append(contentsOf: accepted)
        lastError = accepted.count == incoming.count
            ? nil
            : "Some attachments were left out (16 items / 32 MB total)."
        return true
    }

    @discardableResult
    func stageCapture(_ payload: ScoutCapturePayload) -> Bool {
        lastError = nil
        var staged = false
        if !payload.filePaths.isEmpty {
            staged = stageFileURLs(payload.filePaths.map { URL(fileURLWithPath: $0) }) || staged
        }
        if !payload.attachments.isEmpty {
            let incoming = payload.attachments.map {
                ScoutComposerImage(data: $0.data, mediaType: $0.mediaType, fileName: $0.fileName)
            }
            staged = stageAttachments(incoming) || staged
        }
        if let text = payload.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            staged = appendCapturedText(text) || staged
        }
        if staged {
            instructionsFocusRequest &+= 1
        }
        return staged
    }

    @discardableResult
    func stageFileURLs(_ urls: [URL]) -> Bool {
        guard !urls.isEmpty else { return false }
        guard !isSubmitting else {
            lastError = "Wait for the current task to finish before attaching files."
            return false
        }
        lastError = nil

        var seen = Set(capturedFileURLs.map { $0.standardizedFileURL.path })
        let unique = urls.prefix(ScoutCapturePayloadStore.maximumFilePathCount).compactMap { raw -> URL? in
            let url = raw.standardizedFileURL
            return seen.insert(url.path).inserted ? url : nil
        }
        guard !unique.isEmpty else {
            lastError = "Those files are already staged."
            return false
        }
        capturedFileURLs.append(contentsOf: unique)

        let automaticProject = automaticSelectedProjectId.flatMap { id in
            options?.projects.first { $0.id == id }
        }
        if automaticProject != nil {
            selectedProjectId = nil
            automaticSelectedProjectId = nil
            agentName = ""
            displayName = ""
            if let harness = options?.defaults?.harness, !harness.isEmpty {
                selectedHarness = harness
                selectedModel = options?.defaults?.model ?? preferredModel(for: harness)
            }
        }

        var remainingBytes = max(
            0,
            ScoutCapturePayloadStore.maximumAttachmentBytes
                - attachments.reduce(0) { $0 + $1.data.count }
        )
        var remainingCount = max(0, ScoutCapturePayloadStore.maximumAttachmentCount - attachments.count)
        var inlineCandidates: [URL] = []
        var addedReference = false
        for url in unique {
            let isDirectory = isDirectory(url)
            let fileSize = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
            let canAttemptInline = !isDirectory
                && ScoutMediaIntake.canInlineFileURL(url)
                && remainingCount > 0
                && (fileSize ?? ScoutMediaIntake.maximumInlineBytes) <= ScoutMediaIntake.maximumInlineBytes
                && (fileSize ?? ScoutMediaIntake.maximumInlineBytes) <= remainingBytes
            if canAttemptInline {
                inlineCandidates.append(url)
                remainingBytes -= fileSize ?? ScoutMediaIntake.maximumInlineBytes
                remainingCount -= 1
            } else if !localReferences.contains(where: { $0.id == url.path }) {
                localReferences.append(HUDRunnerLocalReference(url: url))
                addedReference = true
            }
        }
        if !inlineCandidates.isEmpty {
            beginFileIntake(inlineCandidates)
        }
        inferProject(from: unique)
        if selectedProject == nil,
           unique.count == 1,
           let folder = unique.first,
           isDirectory(folder) {
            directory = folder.path
            projectQuery = folder.path
        } else if selectedProject == nil, let automaticProject {
            selectProject(automaticProject, automatic: true)
        }
        instructionsFocusRequest &+= 1
        if urls.count > ScoutCapturePayloadStore.maximumFilePathCount {
            lastError = "Only the first 64 dropped items were considered."
        }
        return !inlineCandidates.isEmpty || addedReference
    }

    private func beginFileIntake(_ urls: [URL]) {
        let id = UUID()
        activeFileIntakeIDs.insert(id)
        isStagingFiles = true
        Task { @MainActor [weak self] in
            let results = await Task.detached(priority: .userInitiated) {
                urls.map { url in
                    HUDRunnerFileIntakeResult(
                        url: url,
                        attachment: ScoutMediaIntake.fromFileURL(url)
                    )
                }
            }.value
            self?.finishFileIntake(id: id, results: results)
        }
    }

    private func finishFileIntake(id: UUID, results: [HUDRunnerFileIntakeResult]) {
        guard activeFileIntakeIDs.remove(id) != nil else { return }
        isStagingFiles = !activeFileIntakeIDs.isEmpty

        var remainingBytes = max(
            0,
            ScoutCapturePayloadStore.maximumAttachmentBytes
                - attachments.reduce(0) { $0 + $1.data.count }
        )
        var remainingCount = max(0, ScoutCapturePayloadStore.maximumAttachmentCount - attachments.count)
        var referencedCount = 0
        for result in results {
            if let attachment = result.attachment,
               remainingCount > 0,
               attachment.data.count <= remainingBytes {
                attachments.append(attachment)
                attachmentSourceURLs[attachment.id] = result.url
                remainingCount -= 1
                remainingBytes -= attachment.data.count
            } else if !localReferences.contains(where: { $0.id == result.url.path }) {
                localReferences.append(HUDRunnerLocalReference(url: result.url))
                referencedCount += 1
            }
        }
        if referencedCount > 0, lastError == nil {
            lastError = "Some files could not be inlined and were kept as local references."
        }
    }

    @discardableResult
    func appendCapturedText(_ text: String) -> Bool {
        guard !isSubmitting else {
            lastError = "Wait for the current task to finish before adding text."
            return false
        }
        let captured = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !captured.isEmpty else { return false }
        guard captured.utf8.count <= ScoutCapturePayloadStore.maximumTextBytes else {
            lastError = "Dropped text is too large to add safely."
            return false
        }
        if instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            instructions = captured
        } else {
            instructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + captured
        }
        return true
    }

    func removeAttachment(_ id: UUID) {
        attachments.removeAll { $0.id == id }
        if let source = attachmentSourceURLs.removeValue(forKey: id) {
            removeCapturedFileURL(source)
        }
    }

    func removeLocalReference(_ id: String) {
        let source = localReferences.first { $0.id == id }?.url
        localReferences.removeAll { $0.id == id }
        if let source {
            removeCapturedFileURL(source)
        }
    }

    private func removeCapturedFileURL(_ url: URL) {
        let path = url.standardizedFileURL.path
        capturedFileURLs.removeAll { $0.standardizedFileURL.path == path }
    }

    var availableModels: [HudRunnerModelOption] {
        let all = options?.models ?? []
        let filtered = all.filter { model in
            model.harnesses.isEmpty
                || model.harnesses.contains(selectedHarness)
        }.filter { model in
            !isRetiredModel(model.id, harness: selectedHarness)
        }
        return filtered.isEmpty ? [HudRunnerModelOption(id: "", label: fallbackModelLabel(for: selectedHarness), harnesses: [], source: "fallback")] : filtered
    }

    var availableEfforts: [HudRunnerEffortOption] {
        let loaded = (options?.efforts ?? []).filter { effort in
            effort.harnesses.isEmpty || effort.harnesses.contains(selectedHarness)
        }
        if !loaded.isEmpty { return loaded }
        let fallbacks = [
            HudRunnerEffortOption(id: "none", label: "None", description: "No extra thinking", harnesses: ["codex"]),
            HudRunnerEffortOption(id: "minimal", label: "Minimal", description: "Smallest reasoning budget", harnesses: ["codex"]),
            HudRunnerEffortOption(id: "low", label: "Low", description: "Quick pass", harnesses: ["claude", "codex"]),
            HudRunnerEffortOption(id: "medium", label: "Medium", description: "Balanced default", harnesses: ["claude", "codex"]),
            HudRunnerEffortOption(id: "high", label: "High", description: "Deeper pass", harnesses: ["claude", "codex"]),
            HudRunnerEffortOption(id: "xhigh", label: "XHigh", description: "Highest supported", harnesses: ["claude", "codex"]),
            HudRunnerEffortOption(id: "max", label: "Max", description: "Maximum reasoning depth", harnesses: ["claude", "codex"]),
            HudRunnerEffortOption(id: "ultra", label: "Ultra", description: "Maximum with delegation", harnesses: ["codex"]),
        ]
        return fallbacks.filter { effort in
            effort.harnesses.isEmpty || effort.harnesses.contains(selectedHarness)
        }
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
        projectInputFocused
            && selectedProject == nil
            && !projectMatches(limit: 1).isEmpty
    }

    var shouldHandleProjectNavigation: Bool {
        shouldShowProjectMatches
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

    var effortLabel: String {
        availableEfforts.first { $0.id == reasoningEffort }?.label
            ?? reasoningEffort.trimmedNonEmpty
            ?? "Medium"
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
            beginSubmit()
            return true
        }
        if modifiers.contains(.command), keyCode == 37 { // ⌘L — project
            projectFocusRequest &+= 1
            return true
        }
        if modifiers.contains(.command), keyCode == 15 { // ⌘R — runtime
            runtimeFocusRequest &+= 1
            return true
        }
        if modifiers.contains(.command), keyCode == 31 { // ⌘O — attach
            browseForAttachments()
            return true
        }
        switch keyCode {
        case 125: // Down arrow
            guard shouldHandleProjectNavigation else { return false }
            moveProjectCursor(+1)
            return true
        case 126: // Up arrow
            guard shouldHandleProjectNavigation else { return false }
            moveProjectCursor(-1)
            return true
        case 36: // Return
            if shouldHandleProjectNavigation {
                return acceptProjectCursor()
            }
            return false
        case 48: // Tab; Shift-Tab must remain reverse focus traversal.
            let forbidden: NSEvent.ModifierFlags = [.control, .option, .command]
            guard modifiers.intersection(forbidden).isEmpty else { return false }
            if !modifiers.contains(.shift), shouldHandleProjectNavigation {
                return acceptProjectCursor()
            }
            focusStepDirection = modifiers.contains(.shift) ? -1 : 1
            focusStepRequest &+= 1
            return true
        default:
            return false
        }
    }

    func selectHarness(_ harness: String) {
        selectedHarness = harness
        if !availableModels.contains(where: { $0.id == selectedModel }) {
            selectedModel = preferredModel(for: harness)
        }
        if !availableEfforts.contains(where: { $0.id == reasoningEffort }) {
            reasoningEffort = availableEfforts.first(where: { $0.id == "medium" })?.id
                ?? availableEfforts.first?.id
                ?? "medium"
        }
    }

    func appendDictatedText(_ phrase: String) {
        instructions = ScoutDictationBuffer.appending(phrase, to: instructions)
    }

    func toggleDictation() async {
        let voice = HudVoiceService.shared
        switch ScoutDictationController.toggleDecision(for: voice.state) {
        case .probeThenStartIfIdle:
            guard let preparationID = beginVoicePreparation() else { return }
            defer { finishVoicePreparation(preparationID) }
            guard await ensureVoiceCaptureAccess(voice),
                  voicePreparationID == preparationID,
                  isPresented else { return }
            await voice.probe()
            guard voicePreparationID == preparationID, isPresented else { return }
            if case .idle = voice.state {
                voice.start()
                lastError = nil
            } else {
                surfaceVoiceError(voice.state)
            }
        case .start:
            guard let preparationID = beginVoicePreparation() else { return }
            defer { finishVoicePreparation(preparationID) }
            guard await ensureVoiceCaptureAccess(voice),
                  voicePreparationID == preparationID,
                  isPresented,
                  case .idle = voice.state else { return }
            voice.start()
            lastError = nil
        case .stop:
            voice.stop()
        case .ignore:
            return
        }
    }

    private func beginVoicePreparation() -> UUID? {
        guard !isPreparingVoice else { return nil }
        let id = UUID()
        voicePreparationID = id
        isPreparingVoice = true
        return id
    }

    private func finishVoicePreparation(_ id: UUID) {
        guard voicePreparationID == id else { return }
        voicePreparationID = nil
        isPreparingVoice = false
    }

    private func ensureVoiceCaptureAccess(_ voice: HudVoiceService) async -> Bool {
        guard await voice.ensureCaptureAccess() else {
            surfaceVoiceError(voice.state)
            return false
        }
        return true
    }

    private func surfaceVoiceError(_ state: ScoutDictationState) {
        if case .unavailable(let reason) = state {
            lastError = reason
        } else {
            lastError = "Voice dictation is not available right now."
        }
    }

    @discardableResult
    func escapePressed() -> Bool {
        let voice = HudVoiceService.shared
        if voice.state.isCaptureActive || voice.state.isProcessing {
            voice.cancel()
            voice.consumeFinalText()
            return true
        }
        if projectInputFocused,
           selectedProject == nil,
           !projectMatches(limit: 5).isEmpty {
            instructionsFocusRequest &+= 1
            return true
        }
        cancel()
        return true
    }

    func beginSubmit() {
        guard !isSubmitting else { return }
        guard !isPreparingVoice else {
            lastError = "Wait for voice dictation to finish preparing."
            instructionsFocusRequest &+= 1
            return
        }
        guard !isStagingFiles else {
            lastError = "Wait for dropped files to finish staging."
            return
        }
        let voice = HudVoiceService.shared
        guard !voice.state.isCaptureActive, !voice.state.isProcessing else {
            lastError = "Finish voice dictation before creating the task."
            instructionsFocusRequest &+= 1
            return
        }
        let id = UUID()
        submissionID = id
        isSubmitting = true
        submissionTask = Task { @MainActor [weak self] in
            await self?.submit(id: id)
        }
    }

    private func submit(id: UUID) async {
        defer { finishSubmission(id: id) }
        var submittedInstructions = Self.instructionsForSubmission(
            instructions,
            references: localReferences.map(\.url)
        )
        if submittedInstructions.isEmpty, !attachments.isEmpty {
            submittedInstructions = "Review the attached capture and complete the task it implies."
        }
        let trimmedDirectory = resolvedDirectoryForSubmit()
        guard !trimmedDirectory.isEmpty else {
            lastError = "Choose a project first."
            projectFocusRequest &+= 1
            return
        }
        guard !submittedInstructions.isEmpty || !attachments.isEmpty else {
            lastError = "Add instructions or attach a file first."
            instructionsFocusRequest &+= 1
            return
        }

        // Freeze the complete task spec before the first suspension point.
        // Cancel can safely tear down the visible draft without changing what
        // an already-started request would otherwise read after an await.
        let submittedAttachments = attachments
        let submittedHarness = selectedHarness.trimmedNonEmpty
        let submittedModel = selectedModel.trimmedNonEmpty
        let submittedReasoningEffort = reasoningEffort
        let submittedAgentName = agentName
        let submittedDisplayName = displayName
        let submittedPersistence = persistence

        do {
            try Task.checkCancellation()
            let uploadedAttachments = try await ScoutAttachmentUploadService.uploadAll(submittedAttachments)
            try Task.checkCancellation()
            let draft = ScoutSessionDraft(
                title: "Quick capture",
                target: .project,
                projectPath: trimmedDirectory,
                mode: .fresh,
                instructions: submittedInstructions,
                attachments: uploadedAttachments,
                harness: submittedHarness,
                model: submittedModel,
                reasoningEffort: submittedReasoningEffort,
                agentName: submittedAgentName,
                displayName: submittedDisplayName,
                agentPersistence: submittedPersistence
            )
            isCommittingTask = true
            let response = try await SessionInitiationService.start(draft.spec())
            try Task.checkCancellation()
            lastResponse = response
            lastError = nil
            let shouldCloseHUD = closesHUDOnDismiss
            finishPresentation()
            instructions = ""
            attachments = []
            localReferences = []
            capturedFileURLs = []
            attachmentSourceURLs = [:]
            let success = "started \(response.handle ?? response.agentId ?? response.conversationId ?? "Scout agent")"
            HUDFlashState.shared.flash(success, kind: .success)
            HUDRunnerAccessibility.announce("Task \(success).", priority: .medium)
            if shouldCloseHUD {
                successDismissTask?.cancel()
                successDismissTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(700))
                    guard !Task.isCancelled, self?.isPresented == false else { return }
                    HUDController.shared.dismiss()
                    self?.successDismissTask = nil
                }
            }
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                return
            }
            let message = SessionInitiationService.userFacingError(error)
            lastError = message
            HUDFlashState.shared.flash(message)
        }
    }

    private func finishSubmission(id: UUID) {
        guard submissionID == id else { return }
        submissionTask = nil
        submissionID = nil
        isSubmitting = false
        isCommittingTask = false
    }

    private func applyDefaultsIfNeeded(_ options: HudRunnerOptions) {
        guard !didApplyDefaults else { return }
        didApplyDefaults = true
        let userStartedProject = selectedProjectId != nil
            || !projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !userStartedProject,
           directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            directory = options.defaults?.directory ?? NSHomeDirectory()
        }
        if let harness = options.defaults?.harness, !harness.isEmpty {
            selectedHarness = harness
        } else if let first = options.harnesses.first?.id {
            selectedHarness = first
        }
        selectedModel = options.defaults?.model ?? preferredModel(for: selectedHarness)
        if let defaultEffort = options.defaults?.reasoningEffort,
           availableEfforts.contains(where: { $0.id == defaultEffort }) {
            reasoningEffort = defaultEffort
        }
        if let defaultPersistence = options.defaults?.persistence,
           defaultPersistence == "one_time" || defaultPersistence == "sticky" {
            persistence = defaultPersistence
        }
        if !userStartedProject {
            inferProject(from: capturedFileURLs)
            if selectedProject == nil, let project = projectForDirectory(directory) {
                selectProject(project, automatic: true)
            } else if selectedProject == nil,
                      projectQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                projectQuery = URL(fileURLWithPath: directory).lastPathComponent
            }
        }
    }

    static func instructionsForSubmission(_ raw: String, references: [URL]) -> String {
        let instructions = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var seen = Set<String>()
        let paths = references.compactMap { url -> String? in
            let path = url.standardizedFileURL.path
            return seen.insert(path).inserted ? path : nil
        }
        guard !paths.isEmpty else { return instructions }
        let referenceBlock = (["Local references available to this task:"] + paths.map {
            "- `\($0.replacingOccurrences(of: "`", with: "\\`"))`"
        }).joined(separator: "\n")
        return instructions.isEmpty ? referenceBlock : instructions + "\n\n" + referenceBlock
    }

    private func standardizedPath(_ value: String) -> String {
        guard !value.isEmpty else { return "" }
        return ((value as NSString).expandingTildeInPath as NSString).standardizingPath
    }

    private func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
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

    private func inferProject(from urls: [URL]) {
        guard selectedProject == nil, !urls.isEmpty else { return }
        let projects = options?.projects ?? []
        guard !projects.isEmpty else { return }

        let paths = urls.map { standardizedPath($0.path) }
        let matches = projects.filter { project in
            let root = standardizedPath(project.root)
            guard !root.isEmpty else { return false }
            return paths.contains { $0 == root || $0.hasPrefix(root + "/") }
        }.sorted { lhs, rhs in
            standardizedPath(lhs.root).count > standardizedPath(rhs.root).count
        }
        if let match = matches.first {
            chooseProject(match)
        }
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
        }.filter { model in
            !isRetiredModel(model.id, harness: harness)
        }
        let preference: [String]
        switch harness {
        case "claude":
            preference = ["claude-opus-4-8", "opus", "claude-sonnet-4-6", "sonnet", "claude-haiku-4-5", "haiku"]
        case "codex":
            preference = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-mini"]
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
        case "claude": return "Opus 4.8"
        case "codex": return "GPT-5.6 Sol"
        default: return "model"
        }
    }

    private func isRetiredModel(_ model: String, harness: String) -> Bool {
        guard harness.lowercased() == "codex" else { return false }
        let lower = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return lower == "gpt-5.3-codex-spark" || lower.hasPrefix("gpt-5.4")
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

@MainActor
private final class HUDRunnerActivationLease {
    static let shared = HUDRunnerActivationLease()

    private var previousPolicy: NSApplication.ActivationPolicy?

    private init() {}

    func begin() {
        if previousPolicy == nil {
            previousPolicy = NSApp.activationPolicy()
        }
        if NSApp.activationPolicy() != .regular {
            NSApp.setActivationPolicy(.regular)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func end() {
        guard let previousPolicy else { return }
        self.previousPolicy = nil
        if NSApp.activationPolicy() != previousPolicy {
            NSApp.setActivationPolicy(previousPolicy)
        }
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
