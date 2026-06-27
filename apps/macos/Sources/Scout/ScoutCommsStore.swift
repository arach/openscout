import Combine
import Foundation
import ScoutAppCore
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

@MainActor
final class ScoutCommsStore: ObservableObject {
    @Published private(set) var channels: [ScoutChannel] = []
    @Published private(set) var messages: [ScoutMessage] = []
    @Published private(set) var agents: [ScoutAgent] = []
    @Published private(set) var selectedCId: String?
    @Published var selectedAgentId: String?
    @Published var channelQuery = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var lastError: String?
    @Published private(set) var observePayload: ScoutObservePayload?
    @Published private(set) var observeAgentId: String?
    @Published private(set) var isObserveLoading = false
    @Published private(set) var observeError: String?
    /// The selected conversation's current in-flight turn, if one is running.
    /// Drives the in-thread "agent is working" preview so a new or slow session
    /// shows progress without opening Observe. Nil when the conversation is idle
    /// (no non-terminal flight).
    @Published private(set) var activeTurn: ScoutActiveTurn?
    /// cIds that appeared in the latest channels fetch but weren't in the prior
    /// one — drives the list's one-shot "new conversation" reveal.
    @Published private(set) var newChannelIds: Set<String> = []

    private let decoder = JSONDecoder()
    private var knownChannelIds: Set<String> = []
    private var pollTask: Task<Void, Never>?
    private var channelsTask: Task<Void, Never>?
    private var channelsRequestId: UUID?
    private var messagesTask: Task<Void, Never>?
    private var agentsTask: Task<Void, Never>?
    private var observeTask: Task<Void, Never>?
    private var observeRequestId: UUID?
    private var attemptedInitialChannelsLoad = false
    private var readCursorTask: Task<Void, Never>?
    private var activeTurnTask: Task<Void, Never>?
    /// The "cId:lastMessageId" we last advanced the read cursor to. Guards the
    /// reactive advance against the steady-state poll re-firing the same POST on
    /// every heartbeat — we only re-mark when the selection or its newest
    /// message actually changes.
    private var lastAdvancedReadCursor: String?

    var selectedChannel: ScoutChannel? {
        guard let selectedCId else { return nil }
        return channels.first { $0.cId == selectedCId }
    }

    var selectedAgent: ScoutAgent? {
        if let selectedAgentId,
           let direct = agents.first(where: { $0.id == selectedAgentId }) {
            return direct
        }
        guard let channel = selectedChannel else { return nil }
        if let agentId = channel.agentId,
           let agent = agents.first(where: { $0.id == agentId }) {
            return agent
        }
        if let agentName = channel.agentName?.nilIfEmpty {
            return agents.first {
                $0.name.caseInsensitiveCompare(agentName) == .orderedSame
                    || $0.id.localizedCaseInsensitiveContains(agentName)
            }
        }
        return nil
    }

    var visibleChannels: [ScoutChannel] {
        let trimmed = channelQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return channels }
        return channels.filter { channel in
            channel.displayTitle.localizedCaseInsensitiveContains(trimmed)
                || channel.cId.localizedCaseInsensitiveContains(trimmed)
                || channel.participantDisplayNames.joined(separator: " ").localizedCaseInsensitiveContains(trimmed)
        }
    }

    var activeAgentCount: Int {
        agents.filter { $0.state == .working || $0.state == .needsAttention || $0.state == .available }.count
    }

    /// Agents actually doing work right now — drives the Chats list's
    /// quiet "something's happening" pulse.
    var workingAgentCount: Int {
        agents.filter { $0.state == .working }.count
    }

    func start() {
        guard pollTask == nil else {
            refresh(force: true)
            return
        }
        refresh(force: true)
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = self?.pollIntervalNanoseconds ?? 10_000_000_000
                try? await Task.sleep(nanoseconds: interval)
                guard let self else { return }
                refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        channelsTask?.cancel()
        messagesTask?.cancel()
        agentsTask?.cancel()
        observeTask?.cancel()
        readCursorTask?.cancel()
        activeTurnTask?.cancel()
        channelsTask = nil
        channelsRequestId = nil
        messagesTask = nil
        agentsTask = nil
        observeTask = nil
        readCursorTask = nil
        activeTurnTask = nil
        observeRequestId = nil
        setIfChanged(false, to: \.isLoading)
        setIfChanged(false, to: \.isObserveLoading)
    }

    func refresh(force: Bool = false) {
        loadChannels(force: force)
        loadAgents(force: force)
        if let observeAgentId {
            loadObserve(agentId: observeAgentId, force: true)
        }
        if let selectedCId {
            loadActiveTurn(cId: selectedCId)
        }
    }

    func selectChannel(_ cId: String) {
        let resolvedCId = Self.channel(in: channels, matching: cId)?.cId ?? cId
        guard selectedCId != resolvedCId else { return }
        selectedCId = resolvedCId
        selectedAgentId = channels.first(where: { $0.cId == resolvedCId })?.agentId
        messages = []
        // Drop the prior conversation's in-flight row immediately so it can't
        // flash on the new thread; the fire-now fetch repopulates if this one
        // is mid-turn rather than waiting for the next poll tick.
        activeTurn = nil
        loadActiveTurn(cId: resolvedCId)
        loadMessages()
        // Opening a conversation reads it. Fire immediately (timestamp-based) so
        // unread clears even before the message list lands; loadMessages() will
        // re-advance to the exact latest id once messages arrive.
        markConversationRead(cId: resolvedCId)
    }

    func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
    }

    func openAgentChannel(_ agent: ScoutAgent) {
        selectedAgentId = agent.id
        if let cId = agent.conversationId ?? channels.first(where: { $0.agentId == agent.id })?.cId {
            let isNewSelection = selectedCId != cId
            selectedCId = cId
            loadMessages()
            if isNewSelection {
                markConversationRead(cId: cId)
            }
        }
    }

    func loadMessages() {
        guard let selectedCId else { return }
        messagesTask?.cancel()
        messagesTask = Task { [weak self] in
            await self?.loadMessages(cId: selectedCId)
        }
    }

    /// Advance the operator's read cursor for `cId` to its newest known message.
    /// Best-effort and fire-and-forget — the client swallows errors so this never
    /// surfaces in the UI. Only the currently-selected conversation is marked,
    /// and a dedup key prevents the steady-state poll (which also calls
    /// loadMessages) from re-POSTing the same cursor on every heartbeat. The
    /// next server refresh of `channels` clears the unread badge — we don't
    /// locally mutate the channel here (its `unreadCount` is an immutable model
    /// field), so there's nothing to fight the refresh.
    private func markConversationRead(cId: String, latest: ScoutMessage? = nil) {
        guard selectedCId == cId else { return }

        let latestId = latest?.id
        // Key = conversation + its newest message. Same key ⇒ nothing new to
        // read ⇒ skip the POST. A different conversation, or a newer message
        // landing while this one is open, advances the key again. The "now"
        // placeholder lets the on-select (pre-messages) call advance once, then
        // be superseded by the exact-id call when messages arrive.
        let dedupKey = "\(cId):\(latestId ?? "now")"
        guard dedupKey != lastAdvancedReadCursor else { return }
        lastAdvancedReadCursor = dedupKey

        readCursorTask?.cancel()
        readCursorTask = Task { [latestId] in
            await ScoutCommsClient().advanceReadCursor(
                cId: cId,
                lastReadMessageId: latestId,
                lastReadSeq: nil
            )
        }
    }

    func loadObserve(agentId: String, force: Bool = false) {
        let isSwitchingAgent = observeAgentId != agentId
        if let observeTask {
            if isSwitchingAgent {
                observeTask.cancel()
            } else {
                return
            }
        }
        if !force, !isSwitchingAgent, observePayload != nil { return }
        if isSwitchingAgent {
            observePayload = nil
            observeError = nil
        }
        observeAgentId = agentId
        isObserveLoading = observePayload == nil
        let requestId = UUID()
        observeRequestId = requestId
        observeTask = Task { [weak self] in
            await self?.fetchObserve(agentId: agentId, requestId: requestId)
        }
    }

    func send(_ body: String, images: [ScoutComposerImage] = []) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let selectedCId, !isSending, !trimmed.isEmpty || !images.isEmpty else { return }
        isSending = true
        defer { isSending = false }

        do {
            // Upload images first and turn each into a link-backed attachment.
            // We want the blob present before the message lands, so the agent's
            // first fetch succeeds — so this completes before /api/send.
            var attachments: [[String: String]] = []
            for image in images {
                let uploaded = try await uploadImage(image)
                attachments.append([
                    "mediaType": uploaded.mediaType,
                    "url": uploaded.url,
                    "fileName": uploaded.fileName ?? image.fileName,
                ])
            }

            let url = ScoutWeb.baseURL().appending(path: "api/send")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = [
                "body": trimmed,
                "cId": selectedCId,
                "conversationId": selectedCId,
            ]
            if !attachments.isEmpty {
                payload["attachments"] = attachments
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ScoutCommsError.sendFailed
            }
            setIfChanged(nil, to: \.lastError)
            refresh(force: true)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    /// Push an image to the ephemeral blob route and get back a fetchable URL.
    private func uploadImage(_ image: ScoutComposerImage) async throws -> ScoutBlobUploadResponse {
        let url = ScoutWeb.baseURL().appending(path: "api/blobs")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "data": image.data.base64EncodedString(),
            "mediaType": image.mediaType,
            "fileName": image.fileName,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ScoutCommsError.sendFailed
        }
        return try decoder.decode(ScoutBlobUploadResponse.self, from: data)
    }

    /// Publish only what changed. Steady-state polls fetch byte-identical data;
    /// an unguarded reassignment of a @Published property still fires
    /// objectWillChange, recomputing every observer's body. Rows capture closures
    /// (so SwiftUI can't diff them away), so that recompute relayouts the whole
    /// list on a 2.5s heartbeat even when nothing moved. This keeps the store —
    /// and the UI — quiet until something actually changes.
    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutCommsStore, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    private var pollIntervalNanoseconds: UInt64 {
        if channels.isEmpty, lastError != nil {
            return 30_000_000_000
        }
        if workingAgentCount > 0 {
            return 2_500_000_000
        }
        return 10_000_000_000
    }

    private func loadChannels(force: Bool) {
        if let channelsTask {
            guard force else { return }
            channelsTask.cancel()
            self.channelsTask = nil
            channelsRequestId = nil
        }
        if !force, pollTask == nil { return }
        setIfChanged(channels.isEmpty && !attemptedInitialChannelsLoad, to: \.isLoading)
        let requestId = UUID()
        channelsRequestId = requestId
        channelsTask = Task { [weak self] in
            await self?.fetchChannels(requestId: requestId)
        }
    }

    private func loadAgents(force: Bool) {
        if agentsTask != nil { return }
        if !force, pollTask == nil { return }
        agentsTask = Task { [weak self] in
            await self?.fetchAgents()
        }
    }

    private func fetchChannels(requestId: UUID) async {
        defer {
            if channelsRequestId == requestId {
                attemptedInitialChannelsLoad = true
                setIfChanged(false, to: \.isLoading)
                channelsTask = nil
                channelsRequestId = nil
            }
        }

        do {
            let next = try await ScoutCommsClient().fetchChannels(limit: 160)
            guard channelsRequestId == requestId else { return }
            let incomingIds = Set(next.map(\.cId))
            // The first successful population shouldn't flash every row as "new".
            setIfChanged(knownChannelIds.isEmpty ? [] : incomingIds.subtracting(knownChannelIds), to: \.newChannelIds)
            knownChannelIds = incomingIds
            // Animate only when the visible order actually changes (inserts,
            // removals, bumps). Steady-state polls that merely refresh previews
            // and ages must not churn the list — and an identical poll must not
            // publish at all, else the whole UI relayouts on a 2.5s heartbeat.
            if next.map(\.cId) != channels.map(\.cId) {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    channels = next
                }
            } else if next != channels {
                channels = next
            }
            if let selectedCId,
               !incomingIds.contains(selectedCId),
               let canonical = Self.channel(in: next, matching: selectedCId) {
                setIfChanged(canonical.cId, to: \.selectedCId)
                setIfChanged(canonical.agentId, to: \.selectedAgentId)
            }
            let shouldSelectFallback = selectedCId.map { !incomingIds.contains($0) } ?? true
            if shouldSelectFallback {
                setIfChanged(next.first?.cId, to: \.selectedCId)
                setIfChanged(next.first?.agentId, to: \.selectedAgentId)
            }
            setIfChanged(nil, to: \.lastError)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private static func channel(in channels: [ScoutChannel], matching reference: String) -> ScoutChannel? {
        let trimmed = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return channels.first { channel in
            channel.cId == trimmed
                || channel.sessionId?.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed
                || channel.participants.contains { participant in
                    participant.sessionId?.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed
                }
        }
    }

    private func fetchAgents() async {
        defer { agentsTask = nil }
        do {
            let next = try await ScoutCommsClient().fetchAgents()
            setIfChanged(next, to: \.agents)
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            if channels.isEmpty {
                setIfChanged(Self.userFacingError(error), to: \.lastError)
            }
        }
    }

    private func loadMessages(cId: String) async {
        defer { messagesTask = nil }
        do {
            let next = try await ScoutCommsClient().fetchMessages(cId: cId, limit: 260)
            guard selectedCId == cId else { return }
            setIfChanged(next, to: \.messages)
            setIfChanged(nil, to: \.lastError)
            // Having the conversation's messages on screen reads it. Advance to
            // the exact latest message id; the dedup key keeps the steady-state
            // poll (which also calls loadMessages) from re-POSTing every beat.
            markConversationRead(cId: cId, latest: next.last)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard selectedCId == cId else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func fetchObserve(agentId: String, requestId: UUID) async {
        defer {
            if observeRequestId == requestId {
                isObserveLoading = false
                observeTask = nil
            }
        }

        do {
            let url = ScoutWeb.baseURL().appending(path: "api/agents/\(agentId)/observe")
            let next = try await fetch(ScoutObservePayload.self, from: url)
            guard observeRequestId == requestId, observeAgentId == agentId else { return }
            observePayload = next
            observeError = nil
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard observeRequestId == requestId, observeAgentId == agentId else { return }
            observeError = Self.userFacingError(error)
        }
    }

    private func loadActiveTurn(cId: String) {
        activeTurnTask?.cancel()
        let agentId = selectedAgentId
        let agentName = selectedAgent?.displayName
            ?? selectedChannel?.agentName?.nilIfEmpty
            ?? "agent"
        activeTurnTask = Task { [weak self] in
            await self?.fetchActiveTurn(cId: cId, agentId: agentId, agentName: agentName)
        }
    }

    /// Read the conversation's current flight (reusing `/api/flights` — the same
    /// endpoint the pending-list rows already use) and, while a turn is live,
    /// enrich it with the agent's latest observe event for the rolling detail
    /// line. Self-contained: it never touches the Observe sidecar's single-slot
    /// state, so the in-thread preview works without opening Observe. The observe
    /// call only fires while a non-terminal flight exists, so an idle
    /// conversation costs just the lightweight flights read. Failures are
    /// swallowed — an absent in-flight turn is the common, non-error case.
    private func fetchActiveTurn(cId: String, agentId: String?, agentName: String) async {
        defer { activeTurnTask = nil }
        let base = ScoutWeb.baseURL()
        let flightsURL = base
            .appending(path: "api/flights")
            .appending(queryItems: [
                URLQueryItem(name: "conversationId", value: cId),
                URLQueryItem(name: "active", value: "false"),
            ])
        let flights = (try? await fetch([ScoutPendingFlightStatus].self, from: flightsURL)) ?? []
        guard selectedCId == cId else { return }
        guard let live = flights.first(where: { !$0.isTerminal }) else {
            setIfChanged(nil, to: \.activeTurn)
            return
        }

        var detail: String?
        if let agentId = agentId?.nilIfEmpty {
            let observeURL = base.appending(path: "api/agents/\(agentId)/observe")
            if let payload = try? await fetch(ScoutObservePayload.self, from: observeURL),
               payload.data.live {
                detail = payload.data.events.last.flatMap(Self.activeTurnDetailLine)
            }
            guard selectedCId == cId else { return }
        }

        setIfChanged(
            ScoutActiveTurn(
                agentName: agentName,
                state: live.state,
                summary: live.summary?.nilIfEmpty,
                detail: detail
            ),
            to: \.activeTurn
        )
    }

    /// Condense an observe event into a one-line "what it's doing right now"
    /// string for the in-flight row's detail line.
    private static func activeTurnDetailLine(_ event: ScoutObserveEvent) -> String? {
        let text = event.text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch event.kind {
        case .tool:
            if let tool = event.tool?.nilIfEmpty {
                return text.isEmpty ? "Running \(tool)" : text
            }
            return text.isEmpty ? nil : text
        case .think:
            return text.isEmpty ? "Thinking…" : text
        default:
            return text.isEmpty ? nil : text
        }
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutCommsError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutCommsError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    private static func userFacingError(_ error: Error) -> String {
        if let scoutError = error as? ScoutCommsError {
            return scoutError.localizedDescription
        }
        return ScoutAppError.userFacing(error)
    }
}

enum ScoutCommsError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case sendFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status):
            return "Scout returned HTTP \(status)."
        case .sendFailed:
            return "Scout send failed."
        }
    }
}

/// An image staged in the composer, ready to upload as an attachment. Holds
/// raw bytes (not an NSImage) so it stays Sendable across the upload task.
struct ScoutComposerImage: Identifiable, Sendable {
    let id = UUID()
    let data: Data
    let mediaType: String
    let fileName: String
}

/// Response from POST /api/blobs — the link-backed attachment to send.
struct ScoutBlobUploadResponse: Decodable {
    let url: String
    let mediaType: String
    let fileName: String?
}

