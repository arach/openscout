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

struct ScoutRelaySendOutcome {
    let message: ScoutRelayMessage
    let flights: [ScoutControlPlaneFlightRecord]
    let skippedInvokeTargets: [String]
}

struct ScoutRuntimeAgentInventoryItem: Identifiable, Equatable {
    let id: String
    let displayName: String
    let state: String
    let transport: String?
    let harness: String?
    let nodeID: String
    let source: String?
    let cwd: String?
    let projectRoot: String?

    var detail: String {
        var parts: [String] = []

        if let transport, let harness {
            parts.append("\(transport) / \(harness)")
        } else if let transport {
            parts.append(transport)
        } else if let harness {
            parts.append(harness)
        }

        if let source, !source.isEmpty {
            parts.append(source)
        }

        if let cwd, !cwd.isEmpty {
            parts.append(cwd)
        } else if let projectRoot, !projectRoot.isEmpty {
            parts.append(projectRoot)
        }

        parts.append(nodeID)
        return parts.joined(separator: " · ")
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
    let brokerSupervisor: ScoutBrokerSupervisor
    let workflowTemplates: [ScoutWorkflowTemplate]

    var notes: [ScoutNote]
    var drafts: [ScoutComposeDraft]
    var agentProfiles: [ScoutAgentProfile]
    var workflowRuns: [ScoutWorkflowRun]
    var relayConfig = ScoutRelayConfig()
    var relayMessages: [ScoutRelayMessage] = []
    var relayStates: [String: String] = [:]
    var relayReachableAgentIDs: Set<String> = []
    var relayCoreAgentIDs: Set<String> = []
    var relayFlights: [ScoutControlPlaneFlightRecord] = []
    var relayEvents: [ScoutControlPlaneEvent] = []
    var runtimeAgents: [ScoutRuntimeAgentInventoryItem] = []
    var diagnosticsLogLines: [String] = []
    var relayTransportMode: ScoutRelayTransportMode = .inactive
    var relayLastUpdatedAt: Date?
    var tmuxInventoryState: ScoutTmuxInventoryState = .inactive
    var tmuxInventoryDetail = "tmux discovery has not run yet."
    var tmuxInventoryLastError: String?
    var tmuxSessions: [ScoutTmuxInventorySession] = []
    var tmuxHosts: [ScoutTmuxInventoryHostStatus] = []
    var tmuxInventoryLastUpdatedAt: Date?
    var meshDiscoveryState: ScoutMeshDiscoveryState = .inactive
    var meshNodes: [ScoutMeshNode] = []
    var meshPeersScanned = 0
    var meshProbeResults: [ScoutMeshProbeResult] = []
    var meshLastUpdatedAt: Date?
    var meshLastError: String?
    var meshDiscoveryDetail = "Mesh discovery has not run yet."
    var meshLocalBrokerReachable = false
    var meshBrokerPort = 65535
    var relayComposerResetToken = 0
    var voiceBridgeStatus = ScoutVoiceBridgeStatus.unavailable
    var voiceRepliesEnabled = false
    var voicePartialTranscript = ""
    var voiceLastTranscript: String?
    var voiceLastError: String?
    var selectedNoteID: UUID?
    var selectedDraftID: UUID?
    var selectedWorkflowRunID: UUID?

    var visibleRuntimeAgents: [ScoutRuntimeAgentInventoryItem] {
        let primary = runtimeAgents.isEmpty ? fallbackRuntimeAgentInventory() : runtimeAgents
        return primary.sorted {
            $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
        }
    }

    private let workspaceStore: ScoutWorkspaceStore
    private let voiceBridge: ScoutVoiceBridgeService
    private let meshDiscovery: ScoutMeshDiscoveryService
    private let tmuxInventory: ScoutTmuxInventoryService
    private var hasStarted = false
    @ObservationIgnored private var relayFallbackTask: Task<Void, Never>?
    @ObservationIgnored private var relayRefreshTask: Task<Void, Never>?
    @ObservationIgnored private var meshMonitorTask: Task<Void, Never>?
    @ObservationIgnored private var tmuxMonitorTask: Task<Void, Never>?
    @ObservationIgnored private var relayRefreshInFlight = false
    @ObservationIgnored private var relayHistorySeeded = false
    @ObservationIgnored private var voicePreferencesSeeded = false
    @ObservationIgnored private var voiceRouteChannel: String? = "voice"
    @ObservationIgnored private var voiceRouteTargets: [String] = []
    @ObservationIgnored private var controlPlaneBootstrapNodeID: String?

    init(
        supportPaths: ScoutSupportPaths = .default(),
        supervisor: ScoutAgentSupervisor? = nil,
        brokerSupervisor: ScoutBrokerSupervisor? = nil
    ) {
        let seedSnapshot = ScoutWorkspaceSeed.snapshot()

        self.supportPaths = supportPaths
        self.supervisor = supervisor ?? ScoutAgentSupervisor(supportPaths: supportPaths)
        self.brokerSupervisor = brokerSupervisor ?? ScoutBrokerSupervisor(supportPaths: supportPaths)
        self.workflowTemplates = ScoutWorkspaceSeed.workflowTemplates
        self.workspaceStore = ScoutWorkspaceStore(
            supportPaths: supportPaths,
            seedSnapshot: seedSnapshot
        )
        self.voiceBridge = ScoutVoiceBridgeService()
        self.meshDiscovery = ScoutMeshDiscoveryService()
        self.tmuxInventory = ScoutTmuxInventoryService()
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
            ScoutDiagnosticsLogger.log("ScoutShellViewModel.start ignored because startup already ran.")
            return
        }

        hasStarted = true
        ScoutDiagnosticsLogger.log("ScoutShellViewModel.start beginning.")
        brokerSupervisor.startIfNeeded()
        supervisor.startIfNeeded()
        voiceBridge.startIfNeeded()
        Task {
            await loadWorkspace()
            startRelayMonitoring()
            startMeshMonitoring()
            startTmuxMonitoring()
            ScoutDiagnosticsLogger.log("ScoutShellViewModel startup tasks complete.")
        }
    }

    func shutdown() {
        ScoutDiagnosticsLogger.log("ScoutShellViewModel.shutdown beginning.")
        relayFallbackTask?.cancel()
        relayRefreshTask?.cancel()
        meshMonitorTask?.cancel()
        tmuxMonitorTask?.cancel()
        supervisor.stop()
        voiceBridge.stop()
        ScoutDiagnosticsLogger.log("ScoutShellViewModel.shutdown complete.")
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
            message.isDirectConversation && (message.from == agentID || message.recipients.contains(agentID))
        }
    }

    var relayIdentity: String {
        "operator"
    }

    private var controlPlaneClient: ScoutControlPlaneClient {
        brokerSupervisor.client
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

    var latestRelayFailure: ScoutControlPlaneFlightRecord? {
        relayFlights.first(where: { $0.state == "failed" })
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
            _ = try await postControlPlaneMessage(
                workflowRuns[index].packet,
                targets: workflowRuns[index].targetAgentIDs,
                invokeTargets: workflowRuns[index].targetAgentIDs,
                channel: "shared",
                type: .msg,
                speaksAloud: false,
                invocationAction: "execute",
                metadata: [
                    "source": "workflow-run",
                    "workflowRunId": workflowRuns[index].id.uuidString.lowercased(),
                ]
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

    @discardableResult
    func quickSendMessage(_ message: String, to targets: [String]) async throws -> ScoutRelaySendOutcome {
        try await quickSendMessage(message, to: targets, invokeTargets: targets, speaksAloud: false, channel: nil, type: nil)
    }

    @discardableResult
    func quickSendMessage(
        _ message: String,
        to targets: [String],
        invokeTargets: [String]? = nil,
        speaksAloud: Bool,
        channel: String? = nil,
        type: ScoutRelayMessageType? = nil
    ) async throws -> ScoutRelaySendOutcome {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw NSError(
                domain: "OpenScout",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Cannot send an empty message."]
            )
        }

        let normalizedChannel = normalizedRelayChannel(channel)
        let resolvedType = type ?? (normalizedChannel == "system" ? .sys : .msg)
        let resolvedInvokeTargets = (invokeTargets ?? targets).sorted()

        let outcome = try await postControlPlaneMessage(
            trimmed,
            targets: targets,
            invokeTargets: resolvedInvokeTargets,
            channel: normalizedChannel,
            type: resolvedType,
            speaksAloud: speaksAloud,
            invocationAction: "consult"
        )
        mergeLocalRelayMessage(outcome.message)
        await refreshRelayData()
        if let spokenText = outcome.message.spokenText {
            voiceBridge.speak(text: spokenText, voice: relayDefaultVoice)
        }
        return outcome
    }

    func setOperatorRelayState(_ state: String?) async {
        let normalized = state?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if normalized == nil || normalized == "" || normalized == "idle" || normalized == "clear" {
            relayStates.removeValue(forKey: relayIdentity)
        } else if let normalized {
            relayStates[relayIdentity] = normalized
        }

        relayLastUpdatedAt = .now
    }

    func refreshRelayNow() async {
        voiceBridge.refreshHealth()
        await refreshRelayData()
    }

    func refreshWorkersNow() async {
        await brokerSupervisor.refreshNow()
        await refreshRelayNow()
        await refreshMeshNow()
        await refreshTmuxInventoryNow()
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
        await refreshTmuxInventoryNow()
    }

    func refreshTmuxInventoryNow() async {
        guard tmuxInventoryState != .scanning else {
            return
        }

        tmuxInventoryState = .scanning
        let snapshot = await tmuxInventory.discover(meshNodes: meshNodes)
        tmuxSessions = snapshot.sessions
        tmuxHosts = snapshot.hosts
        tmuxInventoryLastUpdatedAt = .now
        tmuxInventoryLastError = snapshot.lastError
        tmuxInventoryDetail = snapshot.detail
        tmuxInventoryState = snapshot.state
        if runtimeAgents.isEmpty {
            runtimeAgents = fallbackRuntimeAgentInventory()
        }
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
        relayTransportMode = .pollingFallback
        relayRefreshTask = Task { [weak self] in
            guard let self else {
                return
            }

            while !Task.isCancelled {
                do {
                    try await self.waitForBrokerReady()
                    await self.startRelayPollingFallback()
                    await self.refreshRelayDataIfNeeded()
                    ScoutDiagnosticsLogger.log("Connecting to broker event stream at \(self.controlPlaneClient.baseURL.absoluteString).")

                    for try await message in await self.controlPlaneClient.eventStream() {
                        guard !Task.isCancelled else {
                            break
                        }

                        switch message {
                        case .hello:
                            self.relayFallbackTask?.cancel()
                            self.relayFallbackTask = nil
                            self.relayTransportMode = .watching
                            ScoutDiagnosticsLogger.log("Connected to broker event stream.")
                            await self.refreshRelayData()
                        case let .event(event):
                            self.relayFallbackTask?.cancel()
                            self.relayFallbackTask = nil
                            self.relayTransportMode = .watching
                            ScoutDiagnosticsLogger.log("Broker event received: \(event.kind) (\(event.id)).")
                            await self.refreshRelayDataIfNeeded()
                        }
                    }

                    if Task.isCancelled {
                        break
                    }
                } catch {
                    self.relayTransportMode = .pollingFallback
                    ScoutDiagnosticsLogger.log("Broker event stream failed: \(error.localizedDescription)")
                    await self.startRelayPollingFallback()
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        }
    }

    private func waitForBrokerReady() async throws {
        var lastError: Error?

        for _ in 0 ..< 40 {
            do {
                _ = try await controlPlaneClient.fetchHealth()
                return
            } catch {
                lastError = error
                try? await Task.sleep(for: .milliseconds(250))
            }
        }

        throw lastError ?? NSError(
            domain: "OpenScout",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "Broker did not become ready in time."]
        )
    }

    private func startRelayPollingFallback() async {
        guard relayFallbackTask == nil else {
            return
        }

        relayFallbackTask = Task { [weak self] in
            while let self, !Task.isCancelled, self.relayTransportMode == .pollingFallback {
                await self.refreshRelayDataIfNeeded()
                try? await Task.sleep(for: .seconds(2))
            }

            await MainActor.run {
                self?.relayFallbackTask = nil
            }
        }
    }

    private func refreshRelayDataIfNeeded() async {
        guard !relayRefreshInFlight else {
            return
        }

        relayRefreshInFlight = true
        defer { relayRefreshInFlight = false }
        await refreshRelayData()
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

    private func startTmuxMonitoring() {
        tmuxMonitorTask?.cancel()
        tmuxMonitorTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshTmuxInventoryNow()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func refreshRelayData() async {
        let previousMessageIDs = Set(relayMessages.map(\.id))
        let supportPaths = self.supportPaths

        do {
            _ = try await ensureControlPlaneBootstrap()
            async let snapshotTask = controlPlaneClient.fetchSnapshot()
            async let eventsTask = controlPlaneClient.fetchRecentEvents(limit: 40)
            let diagnosticsTask = Task.detached(priority: .utility) {
                ScoutDiagnosticsLogger.recentLines(limit: 80, supportPaths: supportPaths)
            }

            let snapshot = try await snapshotTask
            let messages = controlPlaneRelayMessages(from: snapshot)
            let flights = snapshot.flights.values.sorted { lhs, rhs in
                let lhsTimestamp = lhs.completedAt ?? lhs.startedAt ?? 0
                let rhsTimestamp = rhs.completedAt ?? rhs.startedAt ?? 0
                return lhsTimestamp > rhsTimestamp
            }
            relayMessages = messages
            relayFlights = flights
            relayEvents = (try? await eventsTask) ?? []
            runtimeAgents = runtimeAgentInventory(from: snapshot)
            diagnosticsLogLines = await diagnosticsTask.value
            relayConfig = ScoutRelayConfig(roster: snapshot.agents.keys.sorted())
            relayReachableAgentIDs = Set(
                snapshot.endpoints.values.compactMap { endpoint in
                    endpoint.state == "offline" ? nil : endpoint.agentID
                }
            )
            relayCoreAgentIDs = Set(
                snapshot.endpoints.values.compactMap { endpoint in
                    guard endpoint.transport == "tmux",
                          endpoint.state != "offline",
                          endpoint.metadata?["source"] == "relay-twin-registry" else {
                        return nil
                    }

                    return endpoint.agentID
                }
            )
            syncAgentProfiles(with: snapshot)
            syncRelayStates(with: snapshot)
            relayLastUpdatedAt = .now

            if !voicePreferencesSeeded {
                voicePreferencesSeeded = true
            }

            handleVoicePlayback(for: messages, previousMessageIDs: previousMessageIDs)
        } catch {
            if runtimeAgents.isEmpty {
                runtimeAgents = fallbackRuntimeAgentInventory()
            }
            diagnosticsLogLines = ScoutDiagnosticsLogger.recentLines(limit: 80, supportPaths: supportPaths)
            relayTransportMode = .inactive
        }
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

        if trimmed == "mentions" {
            return "shared"
        }

        return trimmed
    }

    private func ensureControlPlaneBootstrap() async throws -> ScoutControlPlaneNode {
        let node = try await controlPlaneClient.fetchNode()
        guard controlPlaneBootstrapNodeID != node.id else {
            return node
        }

        try await controlPlaneClient.upsertActor(
            id: relayIdentity,
            kind: "person",
            displayName: "Operator",
            handle: relayIdentity,
            labels: ["native", "operator"],
            metadata: ["surface": "scout-app"]
        )

        for agent in agentProfiles {
            try await upsertControlPlaneAgent(agent, nodeID: node.id)
        }

        let defaultParticipants = [relayIdentity] + agentProfiles.map(\.id)

        try await controlPlaneClient.upsertConversation(
            id: "channel.shared",
            kind: "channel",
            title: "shared-channel",
            visibility: "workspace",
            authorityNodeID: node.id,
            participantIDs: defaultParticipants,
            metadata: ["surface": "relay"]
        )

        try await controlPlaneClient.upsertConversation(
            id: "channel.voice",
            kind: "channel",
            title: "voice",
            visibility: "workspace",
            authorityNodeID: node.id,
            participantIDs: defaultParticipants,
            metadata: ["surface": "relay"]
        )

        try await controlPlaneClient.upsertConversation(
            id: "channel.system",
            kind: "system",
            title: "system",
            visibility: "system",
            authorityNodeID: node.id,
            participantIDs: [relayIdentity],
            metadata: ["surface": "relay"]
        )

        for agent in agentProfiles {
            try await controlPlaneClient.upsertConversation(
                id: controlPlaneConversationID(channel: nil, targets: [agent.id]),
                kind: "direct",
                title: agent.name,
                visibility: "private",
                authorityNodeID: node.id,
                participantIDs: [relayIdentity, agent.id],
                metadata: ["surface": "relay"]
            )
        }

        controlPlaneBootstrapNodeID = node.id
        return node
    }

    private func upsertControlPlaneAgent(_ profile: ScoutAgentProfile, nodeID: String) async throws {
        try await controlPlaneClient.upsertAgent(
            id: profile.id,
            displayName: profile.name,
            handle: profile.id,
            labels: ["native", "default-agent"],
            metadata: [
                "role": profile.role,
                "summary": profile.summary,
                "systemImage": profile.systemImage,
            ],
            agentClass: controlPlaneAgentClass(for: profile),
            capabilities: controlPlaneCapabilities(for: profile),
            homeNodeID: nodeID,
            authorityNodeID: nodeID,
            ownerID: relayIdentity
        )
    }

    private func upsertProjectTwinEndpointIfAvailable(
        agentID: String,
        displayName: String,
        role: String,
        summary: String,
        nodeID: String
    ) async throws -> Bool {
        guard let projectRootURL = ScoutRuntimeLocator.developerProjectURL(named: agentID) else {
            return false
        }

        let projectRoot = projectRootURL.path(percentEncoded: false)
        try await controlPlaneClient.upsertEndpoint(
            id: "endpoint.\(agentID).\(nodeID).tmux",
            agentID: agentID,
            nodeID: nodeID,
            harness: "claude",
            transport: "tmux",
            state: "waiting",
            sessionID: "relay-\(agentID)",
            cwd: projectRoot,
            projectRoot: projectRoot,
            metadata: [
                "displayName": displayName,
                "role": role,
                "summary": summary,
                "source": "project-inferred",
                "twinName": agentID,
                "tmuxSession": "relay-\(agentID)",
                "projectRoot": projectRoot,
            ]
        )

        ScoutDiagnosticsLogger.log("Registered tmux project endpoint for \(agentID) at \(projectRoot).")
        return true
    }

    private func controlPlaneAgentClass(for profile: ScoutAgentProfile) -> String {
        switch profile.id {
        case "builder":
            return "builder"
        case "reviewer":
            return "reviewer"
        case "research":
            return "researcher"
        case "scout":
            return "operator"
        default:
            return "general"
        }
    }

    private func controlPlaneCapabilities(for profile: ScoutAgentProfile) -> [String] {
        switch profile.id {
        case "builder":
            return ["chat", "invoke", "execute", "deliver"]
        case "reviewer":
            return ["chat", "review", "summarize"]
        case "research":
            return ["chat", "summarize"]
        case "scout":
            return ["chat", "invoke", "deliver", "summarize"]
        default:
            return ["chat"]
        }
    }

    private func postControlPlaneMessage(
        _ body: String,
        targets: [String],
        invokeTargets: [String],
        channel: String?,
        type: ScoutRelayMessageType,
        speaksAloud: Bool,
        invocationAction: String,
        metadata: [String: String]? = nil
    ) async throws -> ScoutRelaySendOutcome {
        let node = try await ensureControlPlaneBootstrap()
        let composed = extractSpeechAnnotatedContent(
            from: body.trimmingCharacters(in: .whitespacesAndNewlines),
            fallbackSpeaksAloud: speaksAloud
        )
        let normalizedChannel = normalizedRelayChannel(channel)
        let mentionDirective = parseInlineMentionDirective(in: composed.displayBody)
        let bootstrapSnapshot = try? await controlPlaneClient.fetchSnapshot()
        let broadcastTargets = mentionDirective.includesAll
            ? controlPlaneCoreAgentIDs(from: bootstrapSnapshot)
            : []
        if mentionDirective.includesAll, broadcastTargets.isEmpty {
            throw NSError(
                domain: "OpenScout",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "@all has no core agents available yet."]
            )
        }

        let allTargets = Array(Set(targets + mentionDirective.explicitTargets + broadcastTargets)).sorted()
        let requestedInvokeTargets = Array(Set(invokeTargets + mentionDirective.explicitTargets + broadcastTargets)).sorted()
        try await ensureControlPlaneReachableTargets(allTargets, nodeID: node.id)
        try await ensureControlPlaneConversation(
            channel: normalizedChannel,
            targets: allTargets,
            nodeID: node.id
        )
        let snapshot = try? await controlPlaneClient.fetchSnapshot()
        let routedInvokeTargets = controlPlaneInvokableTargets(
            requestedInvokeTargets,
            snapshot: snapshot
        )
        let skippedInvokeTargets = requestedInvokeTargets.filter { !routedInvokeTargets.contains($0) }
        let conversationID = controlPlaneConversationID(channel: normalizedChannel, targets: allTargets)
        let speechDirective = composed.speechText.map {
            ScoutControlPlaneSpeechDirective(text: $0, voice: nil, interruptible: nil)
        }
        let mentions = allTargets.map {
            ScoutControlPlaneMessageMention(actorID: $0, label: "@\($0)")
        }
        let messageID = "msg-\(UUID().uuidString.lowercased())"

        ScoutDiagnosticsLogger.log(
            "Posting control-plane message \(messageID) to \(conversationID) targets=\(allTargets.joined(separator: ",")) invoke=\(routedInvokeTargets.joined(separator: ",")) skipped=\(skippedInvokeTargets.joined(separator: ","))."
        )

        let postedMessage = try await controlPlaneClient.postMessage(
            id: messageID,
            conversationID: conversationID,
            actorID: relayIdentity,
            originNodeID: node.id,
            messageClass: controlPlaneMessageClass(for: type, channel: normalizedChannel),
            body: composed.displayBody,
            mentions: mentions,
            audience: controlPlaneAudience(
                channel: normalizedChannel,
                targets: allTargets,
                invokeTargets: routedInvokeTargets
            ),
            speech: speechDirective,
            visibility: controlPlaneVisibility(
                conversationID: conversationID,
                channel: normalizedChannel,
                type: type
            ),
            metadata: metadata
        )

        let flights = try await invokeControlPlaneTargets(
            routedInvokeTargets,
            nodeID: node.id,
            action: invocationAction,
            task: composed.displayBody,
            conversationID: conversationID,
            messageID: messageID,
            metadata: metadata
        )

        let message = relayMessageFromControlPlane(
            postedMessage,
            conversation: ScoutControlPlaneConversation(
                id: conversationID,
                kind: conversationID.hasPrefix("dm.") ? "direct" : (normalizedChannel == "system" ? "system" : "channel"),
                title: normalizedChannel ?? inferredRelayDisplayName(for: allTargets.first ?? relayIdentity),
                visibility: controlPlaneVisibility(
                    conversationID: conversationID,
                    channel: normalizedChannel,
                    type: type
                ),
                shareMode: "local",
                authorityNodeID: node.id,
                participantIDs: conversationID.hasPrefix("dm.")
                    ? Array(Set([relayIdentity] + allTargets)).sorted()
                    : Array(Set([relayIdentity] + agentProfiles.map(\.id) + allTargets)).sorted(),
                topic: nil
            ),
            snapshot: ScoutControlPlaneSnapshot(
                nodes: [:],
                actors: [:],
                agents: [:],
                endpoints: [:],
                conversations: [:],
                messages: [:],
                flights: [:]
            )
        ) ?? ScoutRelayMessage(
            timestamp: Int(Date.now.timeIntervalSince1970),
            from: relayIdentity,
            type: type,
            body: composed.displayBody,
            messageClass: controlPlaneRelayMessageClass(
                for: controlPlaneMessageClass(for: type, channel: normalizedChannel)
            ),
            speechText: composed.speechText,
            eventID: postedMessage.id,
            tags: speechDirective == nil ? [] : ["speak"],
            recipients: allTargets,
            channel: normalizedChannel,
            isDirectConversation: conversationID.hasPrefix("dm.")
        )

        return ScoutRelaySendOutcome(
            message: message,
            flights: flights,
            skippedInvokeTargets: skippedInvokeTargets
        )
    }

    private func mergeLocalRelayMessage(_ message: ScoutRelayMessage) {
        if let index = relayMessages.firstIndex(where: { $0.id == message.id }) {
            relayMessages[index] = message
        } else {
            relayMessages.append(message)
        }

        relayMessages.sort { lhs, rhs in
            if lhs.timestamp == rhs.timestamp {
                return lhs.id < rhs.id
            }

            return lhs.timestamp < rhs.timestamp
        }
        relayLastUpdatedAt = .now
    }

    private func invokeControlPlaneTargets(
        _ targets: [String],
        nodeID: String,
        action: String,
        task: String,
        conversationID: String,
        messageID: String,
        metadata: [String: String]?
    ) async throws -> [ScoutControlPlaneFlightRecord] {
        let uniqueTargets = Array(Set(targets)).sorted()
        guard !uniqueTargets.isEmpty else {
            return []
        }

        var flights: [ScoutControlPlaneFlightRecord] = []
        for target in uniqueTargets {
            let flight = try await controlPlaneClient.invokeAgent(
                requesterID: relayIdentity,
                requesterNodeID: nodeID,
                targetAgentID: target,
                action: action,
                task: task,
                conversationID: conversationID,
                messageID: messageID,
                context: [
                    "source": "scout-app",
                    "conversationId": conversationID,
                ],
                metadata: metadata
            )

            if let flight {
                flights.append(flight)
                ScoutDiagnosticsLogger.log(
                    "Invocation for \(target) created flight \(flight.id) in state \(flight.state)."
                )
            } else {
                ScoutDiagnosticsLogger.log("Invocation for \(target) returned no flight.")
            }
        }

        return flights
    }

    private func controlPlaneConversationID(channel: String?, targets: [String]) -> String {
        if let channel {
            return "channel.\(channel)"
        }

        if targets.count == 1, let target = targets.first {
            return "dm.\(relayIdentity).\(target)"
        }

        return "channel.shared"
    }

    private func controlPlaneVisibility(
        conversationID: String,
        channel: String?,
        type: ScoutRelayMessageType
    ) -> String {
        if type == .sys || channel == "system" {
            return "system"
        }

        if conversationID.hasPrefix("dm.") {
            return "private"
        }

        return "workspace"
    }

    private func controlPlaneMessageClass(for type: ScoutRelayMessageType, channel: String?) -> String {
        if type == .sys || channel == "system" {
            return "system"
        }

        return "agent"
    }

    private func controlPlaneAudience(
        channel: String?,
        targets: [String],
        invokeTargets: [String]
    ) -> ScoutControlPlaneMessageAudience? {
        let sortedTargets = targets.sorted()
        let sortedInvokeTargets = invokeTargets.sorted()

        if channel == nil {
            return sortedInvokeTargets.isEmpty
                ? nil
                : ScoutControlPlaneMessageAudience(
                    visibleTo: nil,
                    notify: nil,
                    invoke: sortedInvokeTargets
                )
        }

        if sortedTargets.isEmpty, sortedInvokeTargets.isEmpty {
            return nil
        }

        return ScoutControlPlaneMessageAudience(
            visibleTo: nil,
            notify: sortedTargets.isEmpty ? nil : sortedTargets,
            invoke: sortedInvokeTargets.isEmpty ? nil : sortedInvokeTargets
        )
    }

    private func controlPlaneRelayMessages(from snapshot: ScoutControlPlaneSnapshot) -> [ScoutRelayMessage] {
        snapshot.messages.values
            .compactMap { message in
                relayMessageFromControlPlane(
                    message,
                    conversation: snapshot.conversations[message.conversationID],
                    snapshot: snapshot
                )
            }
            .sorted { lhs, rhs in
                if lhs.timestamp == rhs.timestamp {
                    return lhs.id < rhs.id
                }

                return lhs.timestamp < rhs.timestamp
            }
    }

    private func relayMessageFromControlPlane(
        _ message: ScoutControlPlaneMessageRecord,
        conversation: ScoutControlPlaneConversation?,
        snapshot: ScoutControlPlaneSnapshot
    ) -> ScoutRelayMessage? {
        if message.metadata?["transportOnly"] == "true" {
            return nil
        }

        let recipients = relayRecipients(for: message, conversation: conversation)
        let messageClass = controlPlaneRelayMessageClass(for: message.messageClass)
        let channel = relayChannel(for: conversation)
        let type: ScoutRelayMessageType = (message.messageClass == "system" || conversation?.kind == "system") ? .sys : .msg
        let endpoint = activeEndpoint(for: message.actorID, in: snapshot)

        return ScoutRelayMessage(
            timestamp: normalizedMessageTimestamp(message.createdAt),
            from: message.actorID,
            type: type,
            body: message.body,
            messageClass: messageClass,
            speechText: message.speech?.text,
            eventID: message.id,
            tags: message.speech?.text == nil ? [] : ["speak"],
            recipients: recipients,
            channel: channel,
            isDirectConversation: conversation?.kind == "direct" || conversation?.kind == "group_direct",
            replyToMessageID: message.replyToMessageID,
            metadata: message.metadata,
            routingSummary: relayRoutingSummary(
                for: message,
                conversation: conversation,
                snapshot: snapshot
            ),
            provenanceSummary: relayProvenanceSummary(
                for: message,
                endpoint: endpoint
            ),
            provenanceDetail: relayProvenanceDetail(
                for: message,
                endpoint: endpoint
            )
        )
    }

    private func relayRecipients(
        for message: ScoutControlPlaneMessageRecord,
        conversation: ScoutControlPlaneConversation?
    ) -> [String] {
        var recipients = Set((message.mentions ?? []).map(\.actorID))

        if let conversation,
           (conversation.kind == "direct" || conversation.kind == "group_direct") {
            for participantID in conversation.participantIDs where participantID != message.actorID {
                recipients.insert(participantID)
            }
        }

        for actorID in message.audience?.notify ?? [] {
            recipients.insert(actorID)
        }

        for actorID in message.audience?.visibleTo ?? [] {
            recipients.insert(actorID)
        }

        return recipients.sorted()
    }

    private func activeEndpoint(
        for actorID: String,
        in snapshot: ScoutControlPlaneSnapshot
    ) -> ScoutControlPlaneEndpoint? {
        snapshot.endpoints.values
            .filter { endpoint in
                endpoint.agentID == actorID && endpoint.state != "offline"
            }
            .sorted { lhs, rhs in
                endpointRank(lhs) < endpointRank(rhs)
            }
            .first
    }

    private func endpointRank(_ endpoint: ScoutControlPlaneEndpoint) -> Int {
        switch endpoint.transport {
        case "tmux":
            return 0
        case "local_socket":
            return 1
        case "http":
            return 2
        case "websocket":
            return 3
        default:
            return 4
        }
    }

    private func relayRoutingSummary(
        for message: ScoutControlPlaneMessageRecord,
        conversation: ScoutControlPlaneConversation?,
        snapshot: ScoutControlPlaneSnapshot
    ) -> String? {
        let targeted = Set((message.audience?.notify ?? []) + (message.audience?.invoke ?? []))
            .subtracting([message.actorID])

        if message.replyToMessageID != nil {
            if targeted.contains(relayIdentity) {
                return "Replying to you"
            }

            if !targeted.isEmpty {
                return "Replying to \(displayActorList(Array(targeted), snapshot: snapshot))"
            }
        }

        if conversation?.kind == "direct" || conversation?.kind == "group_direct" {
            let participants = conversation?.participantIDs.filter { $0 != message.actorID } ?? []
            if !participants.isEmpty {
                return "To \(displayActorList(participants, snapshot: snapshot))"
            }
        }

        if !targeted.isEmpty {
            return "Targets \(displayActorList(Array(targeted), snapshot: snapshot))"
        }

        return nil
    }

    private func relayProvenanceSummary(
        for message: ScoutControlPlaneMessageRecord,
        endpoint: ScoutControlPlaneEndpoint?
    ) -> String? {
        let metadata = message.metadata ?? [:]

        let session = firstNonEmpty(
            metadata["responderSessionId"],
            endpoint?.sessionID,
            metadata["responderTwinName"],
            endpoint?.metadata?["tmuxSession"],
            endpoint?.metadata?["twinName"]
        )
        let harness = firstNonEmpty(metadata["responderHarness"], endpoint?.harness)
        let transport = firstNonEmpty(metadata["responderTransport"], endpoint?.transport)
        let cwd = firstNonEmpty(metadata["responderCwd"], endpoint?.cwd, metadata["responderProjectRoot"], endpoint?.projectRoot)
        let uptime = uptimeSummary(from: firstNonEmpty(metadata["responderStartedAt"], endpoint?.metadata?["startedAt"]))

        var parts: [String] = []
        if let session {
            parts.append("via \(session)")
        }

        if let harness, let transport {
            parts.append("\(harness)/\(transport)")
        } else if let transport {
            parts.append(transport)
        }

        if let cwd {
            parts.append(shortHomePath(cwd))
        }

        if let uptime {
            parts.append(uptime)
        }

        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func relayProvenanceDetail(
        for message: ScoutControlPlaneMessageRecord,
        endpoint: ScoutControlPlaneEndpoint?
    ) -> String? {
        let metadata = message.metadata ?? [:]
        var parts: [String] = []

        if let responderTwin = firstNonEmpty(metadata["responderTwinName"], endpoint?.metadata?["twinName"]) {
            parts.append("actor \(responderTwin)")
        }

        if let session = firstNonEmpty(metadata["responderSessionId"], endpoint?.sessionID, endpoint?.metadata?["tmuxSession"]) {
            parts.append("session \(session)")
        }

        if let harness = firstNonEmpty(metadata["responderHarness"], endpoint?.harness) {
            parts.append("harness \(harness)")
        }

        if let transport = firstNonEmpty(metadata["responderTransport"], endpoint?.transport) {
            parts.append("transport \(transport)")
        }

        if let cwd = firstNonEmpty(metadata["responderCwd"], endpoint?.cwd) {
            parts.append("cwd \(cwd)")
        }

        if let projectRoot = firstNonEmpty(metadata["responderProjectRoot"], endpoint?.projectRoot) {
            parts.append("project \(projectRoot)")
        }

        if let nodeID = firstNonEmpty(metadata["responderNodeId"], endpoint?.nodeID) {
            parts.append("node \(nodeID)")
        }

        if let invocationID = metadata["invocationId"] {
            parts.append("invocation \(invocationID)")
        }

        if let flightID = metadata["flightId"] {
            parts.append("flight \(flightID)")
        }

        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }

    private func displayActorList(
        _ actorIDs: [String],
        snapshot: ScoutControlPlaneSnapshot
    ) -> String {
        actorIDs
            .sorted()
            .map { actorID in
                if actorID == relayIdentity {
                    return "you"
                }

                return snapshot.actors[actorID]?.displayName
                    ?? snapshot.agents[actorID]?.displayName
                    ?? inferredRelayDisplayName(for: actorID)
            }
            .joined(separator: ", ")
    }

    private func firstNonEmpty(_ values: String?...) -> String? {
        values.first { value in
            guard let value else {
                return false
            }

            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? nil
    }

    private func shortHomePath(_ path: String) -> String {
        let home = NSHomeDirectory()
        guard path.hasPrefix(home) else {
            return path
        }

        return "~" + path.dropFirst(home.count)
    }

    private func uptimeSummary(from startedAt: String?) -> String? {
        guard let startedAt,
              let startedAtValue = Int(startedAt),
              startedAtValue > 0 else {
            return nil
        }

        let age = max(0, Int(Date().timeIntervalSince1970) - startedAtValue)
        if age < 60 {
            return "up \(age)s"
        }

        if age < 3600 {
            return "up \(age / 60)m"
        }

        if age < 86_400 {
            return "up \(age / 3600)h"
        }

        return "up \(age / 86_400)d"
    }

    private func relayChannel(for conversation: ScoutControlPlaneConversation?) -> String? {
        guard let conversation else {
            return nil
        }

        if conversation.kind == "system" {
            return "system"
        }

        guard conversation.kind == "channel" else {
            return nil
        }

        if conversation.id.hasPrefix("channel.") {
            let channelID = String(conversation.id.dropFirst("channel.".count))
            return normalizedRelayChannel(channelID)
        }

        return normalizedRelayChannel(conversation.title)
    }

    private func controlPlaneRelayMessageClass(for value: String) -> ScoutRelayMessageClass? {
        switch value {
        case "agent":
            return .agent
        case "log", "artifact":
            return .log
        case "system":
            return .system
        case "status":
            return .status
        default:
            return nil
        }
    }

    private func normalizedMessageTimestamp(_ value: Int) -> Int {
        value > 10_000_000_000 ? value / 1000 : value
    }

    private func syncRelayStates(with snapshot: ScoutControlPlaneSnapshot) {
        var nextStates: [String: String] = [:]

        for actorID in snapshot.agents.keys.sorted() {
            nextStates[actorID] = relayStates[actorID] ?? "idle"
        }

        nextStates[relayIdentity] = relayStates[relayIdentity] ?? "idle"
        relayStates = nextStates
    }

    private func controlPlaneCoreAgentIDs(from snapshot: ScoutControlPlaneSnapshot?) -> [String] {
        if let snapshot {
            let registryBacked = snapshot.endpoints.values.compactMap { endpoint -> String? in
                guard endpoint.transport == "tmux",
                      endpoint.state != "offline",
                      endpoint.metadata?["source"] == "relay-twin-registry" else {
                    return nil
                }

                return endpoint.agentID
            }

            if !registryBacked.isEmpty {
                return Array(Set(registryBacked)).sorted()
            }

            let tmuxBacked = snapshot.endpoints.values.compactMap { endpoint -> String? in
                guard endpoint.transport == "tmux", endpoint.state != "offline" else {
                    return nil
                }

                return endpoint.agentID
            }

            if !tmuxBacked.isEmpty {
                return Array(Set(tmuxBacked)).sorted()
            }
        }

        return Array(relayCoreAgentIDs.isEmpty ? relayReachableAgentIDs : relayCoreAgentIDs).sorted()
    }

    private struct RelayMentionDirective {
        let explicitTargets: [String]
        let includesAll: Bool
    }

    private func parseInlineMentionDirective(in body: String) -> RelayMentionDirective {
        let pattern = #"@([\w.-]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return RelayMentionDirective(explicitTargets: [], includesAll: false)
        }

        let nsRange = NSRange(body.startIndex..<body.endIndex, in: body)
        let broadcastMentions: Set<String> = ["all", "channel", "everyone", "here"]
        let matches = regex.matches(in: body, options: [], range: nsRange)
        var includesAll = false

        let ids = matches.compactMap { match -> String? in
            guard match.numberOfRanges > 1,
                  let range = Range(match.range(at: 1), in: body) else {
                return nil
            }

            let candidate = String(body[range]).lowercased()
            guard !candidate.isEmpty else {
                return nil
            }

            if broadcastMentions.contains(candidate) {
                includesAll = true
                return nil
            }

            return candidate
        }

        return RelayMentionDirective(
            explicitTargets: Array(Set(ids)).sorted(),
            includesAll: includesAll
        )
    }

    private func extractSpeechAnnotatedContent(
        from rawBody: String,
        fallbackSpeaksAloud: Bool
    ) -> (displayBody: String, speechText: String?) {
        let pattern = #"<speak>([\s\S]*?)</speak>"#
        let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        let nsRange = NSRange(rawBody.startIndex..<rawBody.endIndex, in: rawBody)
        let matches = regex?.matches(in: rawBody, options: [], range: nsRange) ?? []

        var spokenFragments: [String] = []
        for match in matches.reversed() {
            guard match.numberOfRanges > 1,
                  let range = Range(match.range(at: 1), in: rawBody) else {
                continue
            }

            let fragment = rawBody[range].trimmingCharacters(in: .whitespacesAndNewlines)
            if !fragment.isEmpty {
                spokenFragments.insert(fragment, at: 0)
            }
        }

        var displayBody = regex?.stringByReplacingMatches(
            in: rawBody,
            options: [],
            range: nsRange,
            withTemplate: "$1"
        ) ?? rawBody
        displayBody = displayBody
            .replacingOccurrences(of: "<speak>", with: "", options: [.caseInsensitive])
            .replacingOccurrences(of: "</speak>", with: "", options: [.caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var speechText = spokenFragments.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        if speechText.isEmpty && fallbackSpeaksAloud {
            speechText = displayBody
        }

        return (
            displayBody: displayBody,
            speechText: speechText.isEmpty ? nil : speechText
        )
    }

    private func ensureControlPlaneReachableTargets(_ targets: [String], nodeID: String) async throws {
        for target in targets {
            let normalized = target
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()

            guard !normalized.isEmpty, normalized != relayIdentity else {
                continue
            }

            if let profile = agentProfiles.first(where: { $0.id == normalized }) {
                try await upsertControlPlaneAgent(profile, nodeID: nodeID)
                _ = try await upsertProjectTwinEndpointIfAvailable(
                    agentID: normalized,
                    displayName: profile.name,
                    role: profile.role,
                    summary: profile.summary,
                    nodeID: nodeID
                )
                continue
            }

            try await controlPlaneClient.upsertAgent(
                id: normalized,
                displayName: inferredRelayDisplayName(for: normalized),
                handle: normalized,
                labels: ["relay", "discovered"],
                metadata: [
                    "source": "relay",
                    "discoveredBy": "scout-app",
                ],
                agentClass: "relay",
                capabilities: ["chat", "invoke", "deliver"],
                homeNodeID: nodeID,
                authorityNodeID: nodeID,
                ownerID: nil
            )

            _ = try await upsertProjectTwinEndpointIfAvailable(
                agentID: normalized,
                displayName: inferredRelayDisplayName(for: normalized),
                role: "Project twin",
                summary: "Project-backed agent inferred from the local developer workspace.",
                nodeID: nodeID
            )
        }
    }

    private func controlPlaneInvokableTargets(
        _ targets: [String],
        snapshot: ScoutControlPlaneSnapshot?
    ) -> [String] {
        let uniqueTargets = Array(Set(targets)).sorted()
        guard let snapshot else {
            return uniqueTargets
        }

        let endpointAgentIDs = Set(
            snapshot.endpoints.values.compactMap { endpoint in
                endpoint.state == "offline" ? nil : endpoint.agentID
            }
        )
        let registeredAgentIDs = Set(snapshot.agents.keys)

        return uniqueTargets.filter { target in
            endpointAgentIDs.contains(target) || registeredAgentIDs.contains(target)
        }
    }

    private func ensureControlPlaneConversation(
        channel: String?,
        targets: [String],
        nodeID: String
    ) async throws {
        let defaultParticipants = Set([relayIdentity] + agentProfiles.map(\.id))
        let targetParticipants = Set(targets.filter { !$0.isEmpty && $0 != relayIdentity })

        if let channel {
            let conversationID = "channel.\(channel)"
            let isSystem = channel == "system"
            let title = channel
            let participants = isSystem
                ? [relayIdentity]
                : Array(defaultParticipants.union(targetParticipants)).sorted()

            try await controlPlaneClient.upsertConversation(
                id: conversationID,
                kind: isSystem ? "system" : "channel",
                title: title,
                visibility: isSystem ? "system" : "workspace",
                authorityNodeID: nodeID,
                participantIDs: participants,
                metadata: ["surface": "relay"]
            )
            return
        }

        if targets.count == 1, let target = targets.first {
            try await controlPlaneClient.upsertConversation(
                id: controlPlaneConversationID(channel: nil, targets: [target]),
                kind: "direct",
                title: inferredRelayDisplayName(for: target),
                visibility: "private",
                authorityNodeID: nodeID,
                participantIDs: [relayIdentity, target],
                metadata: ["surface": "relay"]
            )
        }
    }

    private func syncAgentProfiles(with snapshot: ScoutControlPlaneSnapshot) {
        var mergedByID = Dictionary(uniqueKeysWithValues: agentProfiles.map { ($0.id, $0) })
        let seededOrder = agentProfiles.map(\.id)

        for agent in snapshot.agents.values.sorted(by: { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }) {
            guard agent.id != relayIdentity else {
                continue
            }

            let existing = mergedByID[agent.id]
            let metadata = agent.metadata ?? [:]
            mergedByID[agent.id] = ScoutAgentProfile(
                id: agent.id,
                name: agent.displayName,
                role: metadata["role"] ?? existing?.role ?? "Project twin",
                summary: metadata["summary"] ?? existing?.summary ?? "Project-backed agent reachable through the local broker.",
                systemImage: metadata["systemImage"] ?? existing?.systemImage ?? "shippingbox"
            )
        }

        let orderedIDs = seededOrder + mergedByID.keys.filter { !seededOrder.contains($0) }.sorted()
        agentProfiles = orderedIDs.compactMap { mergedByID[$0] }
    }

    private func runtimeAgentInventory(from snapshot: ScoutControlPlaneSnapshot) -> [ScoutRuntimeAgentInventoryItem] {
        snapshot.agents.values
            .sorted { lhs, rhs in
                lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
            .map { agent in
                let candidateEndpoints = snapshot.endpoints.values
                    .filter { $0.agentID == agent.id }
                    .sorted { lhs, rhs in
                        endpointRank(lhs.state) < endpointRank(rhs.state)
                    }

                let endpoint = candidateEndpoints.first
                return ScoutRuntimeAgentInventoryItem(
                    id: agent.id,
                    displayName: agent.displayName,
                    state: endpoint?.state ?? "registered",
                    transport: endpoint?.transport,
                    harness: endpoint?.harness,
                    nodeID: endpoint?.nodeID ?? "local",
                    source: endpoint?.metadata?["source"],
                    cwd: endpoint?.cwd.map(shortHomePath),
                    projectRoot: endpoint?.projectRoot.map(shortHomePath)
                )
            }
    }

    private func fallbackRuntimeAgentInventory() -> [ScoutRuntimeAgentInventoryItem] {
        var inventoryByID: [String: ScoutRuntimeAgentInventoryItem] = [:]

        for session in tmuxSessions {
            let normalizedID = inferredAgentID(fromTmuxSessionName: session.sessionName)
            guard !normalizedID.isEmpty else {
                continue
            }

            inventoryByID[normalizedID] = ScoutRuntimeAgentInventoryItem(
                id: normalizedID,
                displayName: inferredRelayDisplayName(for: normalizedID),
                state: session.attached ? "active" : "idle",
                transport: "tmux",
                harness: "session",
                nodeID: session.hostLabel,
                source: "tmux-inventory",
                cwd: nil,
                projectRoot: nil
            )
        }

        return inventoryByID.values.sorted {
            $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
        }
    }

    private func inferredAgentID(fromTmuxSessionName value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ""
        }

        if trimmed.hasPrefix("relay-") {
            return String(trimmed.dropFirst("relay-".count)).lowercased()
        }

        return trimmed.lowercased()
    }

    private func endpointRank(_ state: String) -> Int {
        switch state {
        case "running":
            return 0
        case "waiting", "idle":
            return 1
        case "starting":
            return 2
        case "offline":
            return 4
        default:
            return 3
        }
    }

    private func inferredRelayDisplayName(for id: String) -> String {
        let cleaned = id
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ".", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")

        guard !cleaned.isEmpty else {
            return id
        }

        return cleaned
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    private func submitVoiceTranscript(_ transcript: String) async {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        do {
            _ = try await quickSendMessage(
                trimmed,
                to: voiceRouteTargets,
                invokeTargets: voiceRouteTargets,
                speaksAloud: false,
                channel: voiceRouteChannel ?? "voice",
                type: voiceRouteChannel == "system" ? .sys : .msg
            )
        } catch {
            ScoutDiagnosticsLogger.log("Voice transcript send failed: \(error.localizedDescription)")
        }
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
