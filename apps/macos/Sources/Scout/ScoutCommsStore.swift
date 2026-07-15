import Combine
import Foundation
import ScoutAppCore
import ScoutCapabilities
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

@MainActor
final class ScoutCommsStore: ObservableObject {
    private static let log = ScoutLog.logger(category: "comms.store")
    @Published private(set) var channels: [ScoutChannel] = []
    @Published private(set) var messages: [ScoutMessage] = []
    @Published private(set) var agents: [ScoutAgent] = []
    @Published private(set) var selectedCId: String?
    /// True from selecting a conversation until its transcript fetch settles.
    /// The steady-state poll never sets it, so it only gates the first paint.
    @Published private(set) var isLoadingMessages = false
    @Published var replyTarget: ScoutMessage?
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
    /// Read cursors for the selected conversation, keyed by actor on the broker.
    /// The UI uses these as read receipts on the latest operator-authored turn
    /// each participant has reached.
    @Published private(set) var readCursors: [ScoutReadCursor] = []
    /// cIds that appeared in the latest channels fetch but weren't in the prior
    /// one — drives the list's one-shot "new conversation" reveal.
    @Published private(set) var newChannelIds: Set<String> = []
    /// Local-service health, classified only from existing fetch outcomes (no
    /// standalone polling loop). An offline broker returns an empty channel list
    /// that otherwise masquerades as "No chats"; this lets the view say so
    /// honestly and offer a real recovery action.
    @Published private(set) var serviceHealth: ScoutServiceHealth = .ok
    /// True while a broker (re)start is in flight, so the offline state can show
    /// a spinner instead of the "Start broker" button.
    @Published private(set) var isStartingBroker = false

    private let decoder = JSONDecoder()
    private var knownChannelIds: Set<String> = []
    private var pollTask: Task<Void, Never>?
    private var channelsTask: Task<Void, Never>?
    private var channelsRequestId: UUID?
    private var messagesTask: Task<Void, Never>?
    // Last-known transcript per conversation, so switching threads paints the
    // cached turns instantly while the fetch refreshes them — no zero-state
    // flash between threads. Bounded (insertion order) so a long session
    // doesn't hoard every conversation ever opened.
    private var messageCache: [String: [ScoutMessage]] = [:]
    private var messageCacheOrder: [String] = []
    private let messageCacheLimit = 24
    private var agentsTask: Task<Void, Never>?
    private var observeTask: Task<Void, Never>?
    private var observeRequestId: UUID?
    private var selectedFlightIdHint: String?
    private var selectedAgentNameHint: String?
    private var attemptedInitialChannelsLoad = false
    private var readCursorTask: Task<Void, Never>?
    private var readCursorsTask: Task<Void, Never>?
    private var activeTurnTask: Task<Void, Never>?
    private var activeTurnRequestId: UUID?
    private var activeTurnRequestCId: String?
    private var activeTurnPollTask: Task<Void, Never>?
    private var activeTurnPollCId: String?
    private var healthProbeTask: Task<Void, Never>?
    private var brokerActionTask: Task<Void, Never>?
    /// Latches once an empty channel list has been probed as genuinely-empty
    /// (broker reachable) so the steady-state poll doesn't re-probe shell-state
    /// on every heartbeat. A degraded classification leaves it `false` so the
    /// poll keeps probing and recovery flips health back to `ok`.
    private var settledEmptyAsHealthy = false
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
        let knownChannelIds = Set(channels.map(\.cId))
        let topLevelChannels = channels.filter { channel in
            guard let parentConversationId = channel.parentConversationId?.nilIfEmpty else { return true }
            // Child conversations stay out of the top-level list while their
            // parent is present. If the parent was deleted or is otherwise not
            // in the payload, surface the child rather than orphaning it.
            return !knownChannelIds.contains(parentConversationId)
        }
        guard !trimmed.isEmpty else { return topLevelChannels }
        return topLevelChannels.filter { channel in
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
        readCursorsTask?.cancel()
        activeTurnTask?.cancel()
        activeTurnPollTask?.cancel()
        healthProbeTask?.cancel()
        brokerActionTask?.cancel()
        channelsTask = nil
        channelsRequestId = nil
        messagesTask = nil
        agentsTask = nil
        observeTask = nil
        readCursorTask = nil
        readCursorsTask = nil
        activeTurnTask = nil
        activeTurnRequestId = nil
        activeTurnRequestCId = nil
        activeTurnPollTask = nil
        activeTurnPollCId = nil
        healthProbeTask = nil
        brokerActionTask = nil
        selectedFlightIdHint = nil
        selectedAgentNameHint = nil
        observeRequestId = nil
        setIfChanged(false, to: \.isLoading)
        setIfChanged(false, to: \.isObserveLoading)
        setIfChanged(false, to: \.isStartingBroker)
    }

    func refresh(force: Bool = false) {
        loadChannels(force: force)
        loadAgents(force: force)
        if let observeAgentId {
            loadObserve(agentId: observeAgentId, force: true)
        }
        if let selectedCId {
            loadActiveTurn(cId: selectedCId)
            loadReadCursors(cId: selectedCId)
        }
    }

    func selectChannel(_ cId: String) {
        let resolvedCId = Self.channel(in: channels, matching: cId)?.cId ?? cId
        guard selectedCId != resolvedCId else { return }
        selectedFlightIdHint = nil
        selectedAgentNameHint = nil
        replyTarget = nil
        selectedCId = resolvedCId
        selectedAgentId = channels.first(where: { $0.cId == resolvedCId })?.agentId
        // Paint the last-known transcript immediately (empty only on a cold
        // first visit); the fetch below refreshes it in place.
        messages = messageCache[resolvedCId] ?? []
        isLoadingMessages = true
        readCursors = []
        // Drop the prior conversation's in-flight row immediately so it can't
        // flash on the new thread; the fire-now fetch repopulates if this one
        // is mid-turn rather than waiting for the next poll tick.
        activeTurn = nil
        stopActiveTurnPolling()
        loadActiveTurn(cId: resolvedCId)
        loadMessages()
        loadReadCursors(cId: resolvedCId)
        // Opening a conversation reads it. Fire immediately (timestamp-based) so
        // unread clears even before the message list lands; loadMessages() will
        // re-advance to the exact latest id once messages arrive.
        markConversationRead(cId: resolvedCId)
    }

    func selectPendingConversation(cId: String, flightId: String?, agentId: String?, agentName: String?) {
        let resolvedCId = Self.channel(in: channels, matching: cId)?.cId ?? cId
        selectedFlightIdHint = flightId?.nilIfEmpty
        selectedAgentNameHint = agentName?.nilIfEmpty
        selectedAgentId = agentId?.nilIfEmpty
        if selectedCId != resolvedCId {
            replyTarget = nil
            selectedCId = resolvedCId
            messages = messageCache[resolvedCId] ?? []
            isLoadingMessages = true
            readCursors = []
            activeTurn = nil
            stopActiveTurnPolling()
            loadMessages()
            loadReadCursors(cId: resolvedCId)
            markConversationRead(cId: resolvedCId)
        }
        loadActiveTurn(cId: resolvedCId)
    }

    func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
    }

    func openAgentChannel(_ agent: ScoutAgent) {
        selectedAgentId = agent.id
        if let cId = agent.conversationId ?? channels.first(where: { $0.agentId == agent.id })?.cId {
            let isNewSelection = selectedCId != cId
            selectedCId = cId
            if isNewSelection {
                replyTarget = nil
                readCursors = []
                // Swap to the new thread's cached transcript right away —
                // leaving the prior thread's rows up would flash the wrong
                // conversation under the new header.
                messages = messageCache[cId] ?? []
                isLoadingMessages = true
            }
            loadMessages()
            loadReadCursors(cId: cId)
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

    func loadReadCursors(cId: String) {
        readCursorsTask?.cancel()
        readCursorsTask = Task { [weak self] in
            await self?.fetchReadCursors(cId: cId)
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
        readCursorTask = Task { [weak self, latestId] in
            let client = ScoutCommsClient()
            await client.advanceReadCursor(
                cId: cId,
                lastReadMessageId: latestId,
                lastReadSeq: nil
            )
            await MainActor.run {
                guard let self, self.selectedCId == cId else { return }
                self.loadReadCursors(cId: cId)
            }
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
            let attachments = try await ScoutAttachmentUploadService.uploadAll(images)

            let url = ScoutWeb.baseURL().appending(path: "api/send")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = [
                "body": trimmed,
                "cId": selectedCId,
                "conversationId": selectedCId,
            ]
            if let replyToMessageId = replyTarget?.id.nilIfEmpty {
                payload["replyToMessageId"] = replyToMessageId
            }
            if !attachments.isEmpty {
                payload["attachments"] = attachments.map(Self.attachmentPayload)
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ScoutCommsError.sendFailed
            }
            setIfChanged(nil, to: \.lastError)
            replyTarget = nil
            refresh(force: true)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
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

    func clearReplyTarget() {
        replyTarget = nil
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
            // Only auto-pick a conversation when nothing is selected yet (first
            // load). A deliberate selection that simply isn't in this poll's
            // list — a just-started or externally-created chat that
            // /api/channels hasn't surfaced yet — must be kept, not yanked to
            // the first row. The detail loads its messages by cId directly, and
            // the next poll fills in the channel once it lands.
            if selectedCId == nil {
                setIfChanged(next.first?.cId, to: \.selectedCId)
                setIfChanged(next.first?.agentId, to: \.selectedAgentId)
            }
            setIfChanged(nil, to: \.lastError)
            classifyHealth(fromChannels: next)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
            // A failed channels fetch is the web-service-down path — probe
            // shell-state once to confirm (and to recover when it comes back).
            probeServiceHealth()
        }
    }

    /// Distinguish a genuinely-empty conversation list from an offline broker
    /// (both return `[]`). A non-empty list proves the broker is reachable, so
    /// mark healthy directly. An empty list is ambiguous — probe shell-state
    /// once to classify, gated by `settledEmptyAsHealthy` so a healthy-but-empty
    /// list isn't re-probed on every heartbeat while a degraded one keeps
    /// probing until it recovers.
    private func classifyHealth(fromChannels channels: [ScoutChannel]) {
        if !channels.isEmpty {
            setIfChanged(.ok, to: \.serviceHealth)
            settledEmptyAsHealthy = false
            return
        }
        if !settledEmptyAsHealthy {
            probeServiceHealth()
        }
    }

    /// One-shot shell-state probe. Reuses the existing fetch outcomes as its
    /// trigger (no new polling loop) and is guarded so overlapping triggers
    /// collapse to a single in-flight request.
    private func probeServiceHealth() {
        guard healthProbeTask == nil else { return }
        healthProbeTask = Task { [weak self] in
            let health = await ScoutShellStateClient().classify()
            guard let self else { return }
            self.healthProbeTask = nil
            guard let health else { return }
            self.setIfChanged(health, to: \.serviceHealth)
            self.settledEmptyAsHealthy = (health == .ok)
        }
    }

    /// Honestly (re)start the local broker via scoutd, then re-probe health so
    /// the offline state clears itself when the broker comes back. Only the
    /// broker-down state offers this — web-down isn't recoverable from the app.
    func startBroker() {
        guard !isStartingBroker, brokerActionTask == nil else { return }
        isStartingBroker = true
        brokerActionTask = Task { [weak self] in
            do {
                _ = try await BrokerService().control(.restart)
            } catch {
                if !ScoutAppError.isCancellation(error) {
                    self?.setIfChanged(Self.userFacingError(error), to: \.lastError)
                }
            }
            let health = await ScoutShellStateClient().classify()
            guard let self else { return }
            self.isStartingBroker = false
            self.brokerActionTask = nil
            if let health {
                self.setIfChanged(health, to: \.serviceHealth)
                self.settledEmptyAsHealthy = (health == .ok)
            }
            if self.serviceHealth == .ok {
                self.refresh(force: true)
            }
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
            // Cache before the selection guard — the fetch is fresh even if the
            // user has already moved on, and it makes their way back instant.
            cacheMessages(next, for: cId)
            guard selectedCId == cId else { return }
            setIfChanged(next, to: \.messages)
            setIfChanged(false, to: \.isLoadingMessages)
            setIfChanged(nil, to: \.lastError)
            // Having the conversation's messages on screen reads it. Advance to
            // the exact latest message id; the dedup key keeps the steady-state
            // poll (which also calls loadMessages) from re-POSTing every beat.
            markConversationRead(cId: cId, latest: next.last)
            loadReadCursors(cId: cId)
            if activeTurn != nil || selectedFlightIdHint != nil {
                loadActiveTurn(cId: cId)
            }
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard selectedCId == cId else { return }
            setIfChanged(false, to: \.isLoadingMessages)
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    /// Insert-or-refresh the per-conversation transcript cache, evicting the
    /// oldest-inserted entry past the cap.
    private func cacheMessages(_ next: [ScoutMessage], for cId: String) {
        if messageCache[cId] == nil {
            messageCacheOrder.append(cId)
            if messageCacheOrder.count > messageCacheLimit {
                let evicted = messageCacheOrder.removeFirst()
                messageCache[evicted] = nil
            }
        }
        messageCache[cId] = next
    }

    private func fetchReadCursors(cId: String) async {
        defer { readCursorsTask = nil }
        do {
            let next = try await ScoutCommsClient().fetchReadCursors(cId: cId)
            guard selectedCId == cId else { return }
            setIfChanged(next, to: \.readCursors)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard selectedCId == cId else { return }
            setIfChanged([], to: \.readCursors)
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
        if let activeTurnTask {
            guard activeTurnRequestCId != cId else {
                Self.log.debug("active turn fetch coalesced cId=\(cId, privacy: .public)")
                return
            }
            Self.log.debug("active turn fetch cancelled for conversation change from=\(self.activeTurnRequestCId ?? "unknown", privacy: .public) to=\(cId, privacy: .public)")
            activeTurnTask.cancel()
        }
        let requestId = UUID()
        activeTurnRequestId = requestId
        activeTurnRequestCId = cId
        let agentId = selectedAgentId
        let flightId = selectedFlightIdHint
        let agentName = selectedAgent?.displayName
            ?? selectedChannel?.agentName?.nilIfEmpty
            ?? selectedAgentNameHint
            ?? "agent"
        Self.log.debug("active turn fetch started cId=\(cId, privacy: .public) requestId=\(requestId.uuidString, privacy: .public)")
        activeTurnTask = Task { [weak self] in
            await self?.fetchActiveTurn(cId: cId, requestId: requestId, flightId: flightId, agentId: agentId, agentName: agentName)
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
    private func fetchActiveTurn(cId: String, requestId: UUID, flightId: String?, agentId: String?, agentName: String) async {
        defer {
            if activeTurnRequestId == requestId {
                activeTurnTask = nil
                activeTurnRequestCId = nil
                Self.log.debug("active turn fetch finished cId=\(cId, privacy: .public) requestId=\(requestId.uuidString, privacy: .public)")
            }
        }
        let base = ScoutWeb.baseURL()
        var queryItems = [
            URLQueryItem(name: "active", value: "false"),
        ]
        if let flightId = flightId?.nilIfEmpty {
            queryItems.append(URLQueryItem(name: "flightId", value: flightId))
        } else {
            queryItems.append(URLQueryItem(name: "conversationId", value: cId))
        }
        let flightsURL = base
            .appending(path: "api/flights")
            .appending(queryItems: queryItems)
        let flights = (try? await fetch([ScoutPendingFlightStatus].self, from: flightsURL)) ?? []
        guard selectedCId == cId, activeTurnRequestId == requestId else { return }
        guard let live = flights.first(where: { !$0.isTerminal }) else {
            setIfChanged(nil, to: \.activeTurn)
            stopActiveTurnPolling()
            return
        }
        if shouldHideActiveTurn(live, cId: cId) {
            setIfChanged(nil, to: \.activeTurn)
            stopActiveTurnPolling()
            return
        }

        var detail: String?
        var activity: [ScoutTurnActivityItem] = []
        let liveAgentId = live.agentId?.nilIfEmpty ?? agentId?.nilIfEmpty
        if let liveAgentId {
            let observeURL = base.appending(path: "api/agents/\(liveAgentId)/observe")
            if let payload = try? await fetch(ScoutObservePayload.self, from: observeURL),
               payload.data.live {
                detail = payload.data.events.last.flatMap(Self.activeTurnDetailLine)
                activity = Array(payload.data.events
                    .compactMap(Self.activeTurnActivityItem)
                    .suffix(4))
            }
            guard selectedCId == cId, activeTurnRequestId == requestId else { return }
        }

        setIfChanged(
            ScoutActiveTurn(
                agentName: live.agentName?.nilIfEmpty ?? agentName,
                state: live.state,
                summary: live.summary?.nilIfEmpty,
                detail: detail,
                activity: activity
            ),
            to: \.activeTurn
        )
        ensureActiveTurnPolling(cId: cId)
    }

    private func shouldHideActiveTurn(_ flight: ScoutPendingFlightStatus, cId: String) -> Bool {
        guard let startedAt = flight.startedAt else { return false }
        return messages.contains { message in
            message.cId == cId
                && !message.isOperator
                && message.messageClass != "status"
                && message.messageClass != "system"
                && message.createdAt >= startedAt
        }
    }

    private func ensureActiveTurnPolling(cId: String) {
        if activeTurnPollTask != nil, activeTurnPollCId == cId {
            return
        }
        stopActiveTurnPolling()
        activeTurnPollCId = cId
        activeTurnPollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if Task.isCancelled { return }
                await MainActor.run {
                    guard let self, self.selectedCId == cId else { return }
                    self.loadActiveTurn(cId: cId)
                }
            }
        }
    }

    private func stopActiveTurnPolling() {
        activeTurnPollTask?.cancel()
        activeTurnPollTask = nil
        activeTurnPollCId = nil
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

    private static func activeTurnActivityItem(_ event: ScoutObserveEvent) -> ScoutTurnActivityItem? {
        let text = event.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let tool = event.tool?.nilIfEmpty
        switch event.kind {
        case .tool:
            let title = tool.map { "Running \($0)" } ?? "Using tool"
            return ScoutTurnActivityItem(
                id: event.id,
                kind: "tool",
                title: title,
                detail: text.nilIfEmpty,
                timestamp: event.t
            )
        case .think:
            return ScoutTurnActivityItem(
                id: event.id,
                kind: "think",
                title: "Thinking",
                detail: text.nilIfEmpty,
                timestamp: event.t
            )
        case .ask:
            return ScoutTurnActivityItem(
                id: event.id,
                kind: "ask",
                title: "Waiting for input",
                detail: text.nilIfEmpty,
                timestamp: event.t
            )
        case .message:
            return ScoutTurnActivityItem(
                id: event.id,
                kind: "message",
                title: "Composing reply",
                detail: text.nilIfEmpty,
                timestamp: event.t
            )
        default:
            guard let detail = text.nilIfEmpty else { return nil }
            return ScoutTurnActivityItem(
                id: event.id,
                kind: "activity",
                title: "Activity",
                detail: detail,
                timestamp: event.t
            )
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

    private static func attachmentPayload(_ attachment: MessageAttachment) -> [String: String] {
        var payload: [String: String] = [
            "id": attachment.id,
            "mediaType": attachment.mediaType,
        ]
        if let fileName = attachment.fileName?.nilIfEmpty {
            payload["fileName"] = fileName
        }
        if let blobKey = attachment.blobKey?.nilIfEmpty {
            payload["blobKey"] = blobKey
        }
        if let url = attachment.url?.nilIfEmpty {
            payload["url"] = url
        }
        return payload
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
