import Foundation
import Observation
import ScoutCore

enum ScoutRelayTransportMode {
    case inactive
    case watching
    case pollingFallback

    var title: String {
        switch self {
        case .inactive:
            return "Inactive"
        case .watching:
            return "Live"
        case .pollingFallback:
            return "Polling"
        }
    }
}

@MainActor
@Observable
final class ScoutShellViewModel {
    var selectedRoute: ScoutRoute = .home
    var sidebarExpanded = false
    var sidebarWidth: CGFloat = 52

    let modules: [ScoutModule]
    let supportPaths: ScoutSupportPaths
    let supervisor: ScoutAgentSupervisor
    let workflowTemplates: [ScoutWorkflowTemplate]

    var notes: [ScoutNote]
    var drafts: [ScoutComposeDraft]
    var agentProfiles: [ScoutAgentProfile]
    var workflowRuns: [ScoutWorkflowRun]
    var relayConfig = ScoutRelayConfig()
    var relayMessages: [ScoutRelayMessage] = []
    var relayStates: [String: String] = [:]
    var relayTransportMode: ScoutRelayTransportMode = .inactive
    var relayLastUpdatedAt: Date?
    var meshDiscoveryState: ScoutMeshDiscoveryState = .inactive
    var meshNodes: [ScoutMeshNode] = []
    var meshPeersScanned = 0
    var meshProbeResults: [ScoutMeshProbeResult] = []
    var meshLastUpdatedAt: Date?
    var meshLastError: String?
    var meshDiscoveryDetail = "Mesh discovery has not run yet."
    var meshLocalBrokerReachable = false
    var meshBrokerPort = 65556
    var relayComposerResetToken = 0
    var voiceBridgeStatus = ScoutVoiceBridgeStatus.unavailable
    var voiceRepliesEnabled = false
    var voicePartialTranscript = ""
    var voiceLastTranscript: String?
    var voiceLastError: String?
    var selectedNoteID: UUID?
    var selectedDraftID: UUID?
    var selectedWorkflowRunID: UUID?

    private let workspaceStore: ScoutWorkspaceStore
    private let voiceBridge: ScoutVoiceBridgeService
    private let meshDiscovery: ScoutMeshDiscoveryService
    private var hasStarted = false
    @ObservationIgnored private var relayFallbackTask: Task<Void, Never>?
    @ObservationIgnored private var relayRefreshTask: Task<Void, Never>?
    @ObservationIgnored private var meshMonitorTask: Task<Void, Never>?
    @ObservationIgnored private var relayMonitor: ScoutRelayMonitor?
    @ObservationIgnored private var relayHistorySeeded = false
    @ObservationIgnored private var voicePreferencesSeeded = false
    @ObservationIgnored private var voiceRouteChannel: String? = "voice"
    @ObservationIgnored private var voiceRouteTargets: [String] = []

    init(
        supportPaths: ScoutSupportPaths = .default(),
        supervisor: ScoutAgentSupervisor? = nil
    ) {
        let seedSnapshot = ScoutWorkspaceSeed.snapshot()

        self.supportPaths = supportPaths
        self.supervisor = supervisor ?? ScoutAgentSupervisor(supportPaths: supportPaths)
        self.workflowTemplates = ScoutWorkspaceSeed.workflowTemplates
        self.workspaceStore = ScoutWorkspaceStore(
            supportPaths: supportPaths,
            seedSnapshot: seedSnapshot
        )
        self.voiceBridge = ScoutVoiceBridgeService()
        self.meshDiscovery = ScoutMeshDiscoveryService()
        self.notes = seedSnapshot.notes
        self.drafts = seedSnapshot.drafts
        self.agentProfiles = seedSnapshot.agents
        self.workflowRuns = seedSnapshot.workflowRuns
        self.selectedNoteID = seedSnapshot.notes.first?.id
        self.selectedDraftID = seedSnapshot.drafts.first?.id
        self.selectedWorkflowRunID = nil
        self.modules = [
            ScoutModule(
                id: "talkie",
                name: "Talkie",
                summary: "Notes, prompting workflows, and reusable context for agent interaction.",
                integrationMode: .embed,
                capabilities: ["Notes", "Compose", "Prompting"]
            ),
            ScoutModule(
                id: "lattices",
                name: "Lattices",
                summary: "Workspace and session context across local computer activity.",
                integrationMode: .link,
                capabilities: ["Workspace state", "Session context", "Desktop awareness"]
            ),
            ScoutModule(
                id: "action",
                name: "Action",
                summary: "Local actions, handoffs, and runtime affordances around the shell.",
                integrationMode: .link,
                capabilities: ["Actions", "Automation", "Runtime"]
            ),
            ScoutModule(
                id: "operate",
                name: "Operate",
                summary: "Prompt-first workflows and delegated agent task shaping.",
                integrationMode: .embed,
                capabilities: ["Delegation", "Workflows", "Briefs"]
            ),
            ScoutModule(
                id: "hudson",
                name: "Hudson",
                summary: "Multi-surface shell concepts for app composition and status-aware chrome.",
                integrationMode: .link,
                capabilities: ["Canvas ideas", "Shell slots", "Multi-app experience"]
            ),
        ]
        self.relayMonitor = ScoutRelayMonitor(
            fileURLs: supportPaths.relayMonitorFileURLs
        ) { [weak self] in
            Task { @MainActor [weak self] in
                self?.scheduleRelayRefresh()
            }
        }
        self.voiceBridge.onStatusChange = { [weak self] status in
            guard let self else {
                return
            }

            self.voiceBridgeStatus = status
            if status.captureState != .error {
                self.voiceLastError = nil
            }
        }
        self.voiceBridge.onPartialText = { [weak self] text in
            self?.voicePartialTranscript = text
        }
        self.voiceBridge.onFinalText = { [weak self] text in
            guard let self else {
                return
            }

            self.voicePartialTranscript = ""
            self.voiceLastTranscript = text

            Task { @MainActor [weak self] in
                await self?.submitVoiceTranscript(text)
            }
        }
        self.voiceBridge.onErrorMessage = { [weak self] message in
            self?.voiceLastError = message
        }
    }

    func start() {
        guard !hasStarted else {
            return
        }

        hasStarted = true
        supervisor.startIfNeeded()
        voiceBridge.startIfNeeded()
        Task {
            _ = await workspaceStore.prepareRelayHub()
            await loadWorkspace()
            startRelayMonitoring()
            startMeshMonitoring()
        }
    }

    func toggleSidebar() {
        sidebarExpanded.toggle()
        sidebarWidth = sidebarExpanded ? 176 : 52
    }

    func setSidebarWidth(_ width: CGFloat) {
        let clamped = min(max(width, 52), 220)
        sidebarWidth = clamped
        sidebarExpanded = clamped > 60
    }

    var selectedNote: ScoutNote? {
        guard let selectedNoteID else {
            return nil
        }

        return notes.first { $0.id == selectedNoteID }
    }

    var selectedDraft: ScoutComposeDraft? {
        guard let selectedDraftID else {
            return nil
        }

        return drafts.first { $0.id == selectedDraftID }
    }

    var selectedWorkflowRun: ScoutWorkflowRun? {
        guard let selectedWorkflowRunID else {
            return nil
        }

        return workflowRuns.first { $0.id == selectedWorkflowRunID }
    }

    func workflow(id: String) -> ScoutWorkflowTemplate? {
        workflowTemplates.first { $0.id == id }
    }

    func relayState(for agentID: String) -> String {
        relayStates[agentID] ?? "idle"
    }

    func latestRelayMessage(for agentID: String) -> ScoutRelayMessage? {
        relayMessages.last { message in
            message.from == agentID || message.mentionedAgents.contains(agentID)
        }
    }

    var relayIdentity: String {
        "operator"
    }

    var operatorRelayState: String {
        relayState(for: relayIdentity)
    }

    var relayVoiceChannelEnabled: Bool {
        relayConfig.voiceChannel?.audio ?? false
    }

    var meshKnownNodeCount: Int {
        meshNodes.count
    }

    var meshPeerNodeCount: Int {
        meshNodes.filter { !$0.isLocal }.count
    }

    var meshBrokerNodeCount: Int {
        meshNodes.count
    }

    var meshStatusTitle: String {
        switch meshDiscoveryState {
        case .inactive:
            return "Mesh idle"
        case .scanning:
            return "Scanning"
        case .ready where meshPeerNodeCount > 0:
            return "\(meshPeerNodeCount) broker\(meshPeerNodeCount == 1 ? "" : "s")"
        case .ready where meshPeersScanned > 0:
            return "\(meshPeersScanned) peer\(meshPeersScanned == 1 ? "" : "s")"
        case .ready where meshLocalBrokerReachable:
            return "Local only"
        case .ready:
            return "No peers"
        case .unavailable:
            return "Unavailable"
        case .failed:
            return "Error"
        }
    }

    var meshInlineMetricLabel: String {
        switch meshDiscoveryState {
        case .scanning:
            return "Scanning"
        case .ready where meshPeerNodeCount > 0:
            return "\(meshPeerNodeCount) brokers"
        case .ready where meshPeersScanned > 0:
            return "\(meshPeersScanned) peers"
        case .ready where meshLocalBrokerReachable:
            return "Local only"
        case .ready:
            return "No peers"
        case .unavailable:
            return "No Tailscale"
        case .failed:
            return "Mesh error"
        case .inactive:
            return "Mesh idle"
        }
    }

    var meshStatusLine: String {
        switch meshDiscoveryState {
        case .scanning:
            return "scanning mesh"
        case .ready where meshPeerNodeCount > 0:
            return "\(meshPeerNodeCount) remote broker\(meshPeerNodeCount == 1 ? "" : "s")"
        case .ready where meshPeersScanned > 0:
            return "\(meshPeersScanned) tailscale peer\(meshPeersScanned == 1 ? "" : "s")"
        case .ready where meshLocalBrokerReachable:
            return "local broker only"
        case .ready:
            return "no tailscale peers"
        case .unavailable:
            return "mesh unavailable"
        case .failed:
            return "mesh error"
        case .inactive:
            return "mesh idle"
        }
    }

    var relayDefaultVoice: String {
        relayConfig.resolvedDefaultVoice
    }

    var voiceCaptureButtonTitle: String {
        switch voiceBridgeStatus.captureState {
        case .connecting:
            return "Connecting"
        case .recording, .processing:
            return "Stop"
        case .idle, .unavailable, .error:
            return "Listen"
        }
    }

    var voiceModeDetail: String {
        if let voiceLastError, !voiceLastError.isEmpty {
            return voiceLastError
        }

        if !voicePartialTranscript.isEmpty {
            return voicePartialTranscript
        }

        return voiceBridgeStatus.detail
    }

    var isVoiceCaptureActive: Bool {
        switch voiceBridgeStatus.captureState {
        case .connecting, .recording, .processing:
            return true
        case .idle, .unavailable, .error:
            return false
        }
    }

    func createNote() {
        let note = ScoutNote(
            title: "Untitled note",
            body: "",
            tags: [],
            linkedAgentIDs: [],
            createdAt: .now,
            updatedAt: .now
        )
        notes.insert(note, at: 0)
        selectedNoteID = note.id
        persistWorkspace()
    }

    func saveNote(
        id: UUID,
        title: String,
        body: String,
        tagsText: String,
        linkedAgentIDs: [String]
    ) {
        guard let index = notes.firstIndex(where: { $0.id == id }) else {
            return
        }

        notes[index].title = sanitizedTitle(from: title, fallback: "Untitled note")
        notes[index].body = body
        notes[index].tags = parseCommaSeparatedValues(from: tagsText)
        notes[index].linkedAgentIDs = linkedAgentIDs.sorted()
        notes[index].updatedAt = .now
        sortNotes()
        persistWorkspace()
    }

    func createDraft(forWorkflowID workflowID: String? = nil) {
        let chosenWorkflow = workflow(id: workflowID ?? workflowTemplates.first?.id ?? "agent-brief") ?? workflowTemplates[0]
        let draft = ScoutComposeDraft(
            title: "Untitled brief",
            request: "",
            context: "",
            deliverable: "",
            selectedWorkflowID: chosenWorkflow.id,
            targetAgentIDs: chosenWorkflow.defaultTargetAgentIDs,
            linkedNoteIDs: [],
            state: .draft,
            createdAt: .now,
            updatedAt: .now
        )

        drafts.insert(draft, at: 0)
        selectedDraftID = draft.id
        persistWorkspace()
    }

    func createDraftFromSelectedNote() {
        createDraft(from: selectedNote)
    }

    func createDraft(from note: ScoutNote?) {
        let chosenWorkflow = workflow(id: "agent-brief") ?? workflowTemplates[0]
        let draft = ScoutComposeDraft(
            title: note?.title ?? "Untitled brief",
            request: note?.body ?? "",
            context: note.map { "Derived from note: \($0.title)" } ?? "",
            deliverable: "Return a focused implementation or product response.",
            selectedWorkflowID: chosenWorkflow.id,
            targetAgentIDs: note?.linkedAgentIDs.isEmpty == false ? note?.linkedAgentIDs ?? chosenWorkflow.defaultTargetAgentIDs : chosenWorkflow.defaultTargetAgentIDs,
            linkedNoteIDs: note.map { [$0.id] } ?? [],
            state: .ready,
            createdAt: .now,
            updatedAt: .now
        )

        drafts.insert(draft, at: 0)
        selectedDraftID = draft.id
        persistWorkspace()
    }

    func saveDraft(
        id: UUID,
        title: String,
        request: String,
        context: String,
        deliverable: String,
        workflowID: String,
        targetAgentIDs: [String],
        linkedNoteIDs: [UUID]
    ) {
        guard let index = drafts.firstIndex(where: { $0.id == id }) else {
            return
        }

        drafts[index].title = sanitizedTitle(from: title, fallback: "Untitled brief")
        drafts[index].request = request
        drafts[index].context = context
        drafts[index].deliverable = deliverable
        drafts[index].selectedWorkflowID = workflowID
        drafts[index].targetAgentIDs = targetAgentIDs.sorted()
        drafts[index].linkedNoteIDs = linkedNoteIDs
        drafts[index].state = request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .draft : .ready
        drafts[index].updatedAt = .now
        sortDrafts()
        persistWorkspace()
    }

    func previewRun(
        title: String,
        request: String,
        context: String,
        deliverable: String,
        workflowID: String,
        targetAgentIDs: [String],
        linkedNoteIDs: [UUID]
    ) -> ScoutWorkflowRun? {
        guard let workflow = workflow(id: workflowID) else {
            return nil
        }

        let trimmedTitle = sanitizedTitle(from: title, fallback: "Untitled brief")
        let draft = ScoutComposeDraft(
            title: trimmedTitle,
            request: request,
            context: context,
            deliverable: deliverable,
            selectedWorkflowID: workflowID,
            targetAgentIDs: targetAgentIDs.sorted(),
            linkedNoteIDs: linkedNoteIDs,
            state: request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .draft : .ready,
            createdAt: .now,
            updatedAt: .now
        )

        let linkedNotes = notes.filter { linkedNoteIDs.contains($0.id) }
        return ScoutPromptPacketBuilder.makeRun(
            draft: draft,
            workflow: workflow,
            notes: linkedNotes,
            agents: agentProfiles
        )
    }

    func generateRunForSelectedDraft() {
        guard let draft = selectedDraft,
              let workflow = workflow(id: draft.selectedWorkflowID) else {
            return
        }

        let linkedNotes = notes.filter { draft.linkedNoteIDs.contains($0.id) }
        let run = ScoutPromptPacketBuilder.makeRun(
            draft: draft,
            workflow: workflow,
            notes: linkedNotes,
            agents: agentProfiles
        )

        workflowRuns.insert(run, at: 0)
        selectedWorkflowRunID = run.id

        if let draftIndex = drafts.firstIndex(where: { $0.id == draft.id }) {
            drafts[draftIndex].state = .ready
            drafts[draftIndex].updatedAt = .now
        }

        persistWorkspace()
    }

    func sendRun(_ runID: UUID) async {
        guard let index = workflowRuns.firstIndex(where: { $0.id == runID }) else {
            return
        }

        do {
            _ = try await workspaceStore.sendRelayPacket(
                from: relayIdentity,
                to: workflowRuns[index].targetAgentIDs,
                packet: workflowRuns[index].packet
            )

            workflowRuns[index].state = .delivered

            if let draftIndex = drafts.firstIndex(where: { $0.id == workflowRuns[index].draftID }) {
                drafts[draftIndex].state = .sent
                drafts[draftIndex].updatedAt = .now
            }

            persistWorkspace()
            await refreshRelayData()
        } catch {
            return
        }
    }

    func quickSendMessage(_ message: String, to targets: [String]) async {
        await quickSendMessage(message, to: targets, speaksAloud: false, channel: nil, type: nil)
    }

    func quickSendMessage(
        _ message: String,
        to targets: [String],
        speaksAloud: Bool,
        channel: String? = nil,
        type: ScoutRelayMessageType? = nil
    ) async {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        let normalizedChannel = normalizedRelayChannel(channel)
        let resolvedType = type ?? (normalizedChannel == "system" ? .sys : .msg)

        do {
            let sentMessage = try await workspaceStore.sendRelayMessage(
                from: relayIdentity,
                to: targets,
                body: trimmed,
                speaksAloud: speaksAloud,
                type: resolvedType,
                channel: normalizedChannel
            )
            await refreshRelayData()
            if let spokenText = sentMessage.spokenText {
                voiceBridge.speak(text: spokenText, voice: relayDefaultVoice)
            }
        } catch {
            return
        }
    }

    func setOperatorRelayState(_ state: String?) async {
        do {
            relayStates = try await workspaceStore.setRelayState(for: relayIdentity, state: state)
            relayLastUpdatedAt = .now
        } catch {
            return
        }
    }

    func refreshRelayNow() async {
        voiceBridge.refreshHealth()
        await refreshRelayData()
    }

    func refreshWorkersNow() async {
        await refreshRelayNow()
        await refreshMeshNow()
    }

    func refreshMeshNow() async {
        guard meshDiscoveryState != .scanning else {
            return
        }

        meshDiscoveryState = .scanning
        let snapshot = await meshDiscovery.discover()
        meshNodes = snapshot.nodes
        meshPeersScanned = snapshot.tailscalePeerCount
        meshProbeResults = snapshot.probes
        meshLastUpdatedAt = .now
        meshLastError = snapshot.lastError
        meshDiscoveryDetail = snapshot.detail
        meshLocalBrokerReachable = snapshot.localBrokerReachable
        meshBrokerPort = snapshot.brokerPort
        meshDiscoveryState = snapshot.state
    }

    func prepareNewRelayMessage() {
        selectedRoute = .workers
        relayComposerResetToken &+= 1
    }

    func setVoiceRepliesEnabled(_ enabled: Bool) {
        voiceRepliesEnabled = enabled
        if enabled {
            voiceBridge.refreshHealth()
        } else {
            voiceBridge.stopSpeaking()
        }
    }

    func toggleVoiceRepliesEnabled() {
        setVoiceRepliesEnabled(!voiceRepliesEnabled)
    }

    func toggleVoiceCapture() {
        if isVoiceCaptureActive {
            stopVoiceCapture()
        } else {
            startVoiceCapture()
        }
    }

    func startVoiceCapture() {
        voiceLastError = nil
        voicePartialTranscript = ""
        voiceBridge.startCapture()
    }

    func stopVoiceCapture() {
        voiceBridge.stopCapture()
    }

    func setVoiceRouting(channel: String?, targets: [String]) {
        voiceRouteChannel = normalizedRelayChannel(channel)
        voiceRouteTargets = targets.sorted()
    }

    private func loadWorkspace() async {
        do {
            let snapshot = try await workspaceStore.loadWorkspace()
            apply(snapshot)
            await refreshRelayData()
        } catch {
            return
        }
    }

    private func apply(_ snapshot: ScoutWorkspaceSnapshot) {
        notes = snapshot.notes.sorted(by: { $0.updatedAt > $1.updatedAt })
        drafts = snapshot.drafts.sorted(by: { $0.updatedAt > $1.updatedAt })
        agentProfiles = snapshot.agents
        workflowRuns = snapshot.workflowRuns.sorted(by: { $0.createdAt > $1.createdAt })
        selectedNoteID = notes.first?.id
        selectedDraftID = drafts.first?.id
        selectedWorkflowRunID = workflowRuns.first?.id
    }

    private func startRelayMonitoring() {
        relayFallbackTask?.cancel()
        relayRefreshTask?.cancel()
        relayMonitor?.stop()

        if relayMonitor?.start() == true {
            relayTransportMode = .watching
            scheduleRelayRefresh()
            return
        }

        relayTransportMode = .pollingFallback
        relayFallbackTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshRelayData()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func startMeshMonitoring() {
        meshMonitorTask?.cancel()
        meshMonitorTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshMeshNow()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func scheduleRelayRefresh() {
        relayRefreshTask?.cancel()
        relayRefreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(120))
            guard let self, !Task.isCancelled else {
                return
            }

            await self.refreshRelayData()
        }
    }

    private func refreshRelayData() async {
        let previousMessageIDs = Set(relayMessages.map(\.id))
        relayConfig = await workspaceStore.loadRelayConfig()
        let messages = await workspaceStore.loadRelayMessages(limit: 80)
        relayMessages = messages
        relayStates = await workspaceStore.loadRelayStates()
        relayLastUpdatedAt = .now

        if !voicePreferencesSeeded {
            voicePreferencesSeeded = true
        }

        handleVoicePlayback(for: messages, previousMessageIDs: previousMessageIDs)
    }

    private func persistWorkspace() {
        let snapshot = ScoutWorkspaceSnapshot(
            notes: notes,
            drafts: drafts,
            agents: agentProfiles,
            workflowRuns: workflowRuns,
            lastUpdatedAt: .now
        )

        Task {
            try? await workspaceStore.saveWorkspace(snapshot)
        }
    }

    private func sortNotes() {
        notes.sort { $0.updatedAt > $1.updatedAt }
    }

    private func sortDrafts() {
        drafts.sort { $0.updatedAt > $1.updatedAt }
    }

    private func parseCommaSeparatedValues(from value: String) -> [String] {
        value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func sanitizedTitle(from value: String, fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }

    private func normalizedRelayChannel(_ value: String?) -> String? {
        let trimmed = value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        guard let trimmed, !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }

    private func submitVoiceTranscript(_ transcript: String) async {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        await quickSendMessage(
            trimmed,
            to: voiceRouteTargets,
            speaksAloud: false,
            channel: voiceRouteChannel ?? "voice",
            type: voiceRouteChannel == "system" ? .sys : .msg
        )
    }

    private func handleVoicePlayback(
        for messages: [ScoutRelayMessage],
        previousMessageIDs: Set<String>
    ) {
        guard relayHistorySeeded else {
            relayHistorySeeded = true
            return
        }

        guard voiceRepliesEnabled else {
            return
        }

        guard let newestMessage = messages.last(where: { message in
            !previousMessageIDs.contains(message.id) && shouldSpeak(message)
        }) else {
            return
        }

        voiceBridge.speak(
            text: newestMessage.spokenText ?? newestMessage.renderedBody,
            voice: newestMessage.isVoiceChannelMessage ? relayConfig.voiceChannel?.voice : relayDefaultVoice
        )
    }

    private func shouldSpeak(_ message: ScoutRelayMessage) -> Bool {
        guard message.from != relayIdentity else {
            return false
        }

        guard !message.renderedBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }

        guard !message.isSystemChannelMessage else {
            return false
        }

        return message.spokenText != nil
    }
}
