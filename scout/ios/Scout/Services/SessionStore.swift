// SessionStore — Observable state container for Dispatch sessions.
//
// Accumulates session state from streaming events, mirroring the logic
// in src/bridge/state.ts. Provides the single source of truth for all
// session data displayed in the UI.
//
// Uses @Observable (iOS 17+) for fine-grained SwiftUI invalidation.

import Foundation
import os

@MainActor
@Observable
final class SessionStore: @unchecked Sendable {

    // MARK: - Observable state

    /// Full accumulated state per session, keyed by session ID.
    private(set) var sessions: [String: SessionState] = [:]

    /// Lightweight summaries for the home screen session list.
    private(set) var summaries: [SessionSummary] = []

    /// Session IDs restored from local cache but not known to be live on the bridge.
    private(set) var cachedOnlySessionIds: Set<String> = []

    /// Last live relay summaries fetched for active sessions.
    private var relaySummariesById: [String: SessionSummary] = [:]

    /// Mirrors ConnectionManager's state for UI binding convenience.
    var connectionState: ConnectionState = .disconnected

    /// Highest applied sequence number. Persisted per bridge identity.
    private(set) var lastAppliedSeq: Int = 0

    // MARK: - Private

    private let lock = NSLock()
    private var bridgeIdentityKey: String?

    private static let logger = Logger(
        subsystem: "com.openscout.scout",
        category: "SessionStore"
    )

    // MARK: - Init

    init() {
        hydrateFromCache()
    }

    // MARK: - Bridge identity binding

    /// Bind to a specific bridge identity for seq persistence.
    /// Call this when the bridge connection is established.
    func bindToBridge(publicKeyHex: String) {
        bridgeIdentityKey = publicKeyHex
        lastAppliedSeq = Self.loadLastAppliedSeq(for: publicKeyHex)
        Self.logger.notice("Bound to bridge \(publicKeyHex.prefix(8))..., lastAppliedSeq=\(self.lastAppliedSeq)")
    }

    // MARK: - Event application

    /// Apply a single sequenced event from the bridge.
    /// Called by ConnectionManager for live events.
    func applyEvent(_ sequenced: SequencedEvent) {
        // seq: 0 events are initial pushes, not part of replay buffer.
        // Still process them but don't update lastAppliedSeq.
        routeEvent(sequenced.event)

        if sequenced.seq > 0 {
            updateLastAppliedSeq(sequenced.seq)
        }

        rebuildSummaries()
    }

    /// Apply a batch of replay events (from sync/replay).
    func applyReplayEvents(_ events: [SequencedEvent]) {
        for event in events {
            routeEvent(event.event)
            if event.seq > 0 && event.seq > lastAppliedSeq {
                updateLastAppliedSeq(event.seq)
            }
        }
        rebuildSummaries()
        Self.logger.notice("Applied \(events.count) replay events, lastAppliedSeq=\(self.lastAppliedSeq)")
    }

    /// Replace entire session state from a snapshot (recovery path).
    func applySnapshot(_ snapshot: SessionState) {
        mergeSnapshot(snapshot, source: .live)
    }

    /// Merge a fresh recent-window snapshot without discarding already loaded older turns.
    func applyLatestSnapshotPreservingHistory(_ snapshot: SessionState) {
        let normalizedSnapshot = TurnHash.normalize(snapshot)

        lock.lock()
        let existing = sessions[normalizedSnapshot.session.id]
        let olderTurns: [TurnState]
        if let existing,
           let oldestIncomingId = normalizedSnapshot.turns.first?.id,
           let pivotIndex = existing.turns.firstIndex(where: { $0.id == oldestIncomingId }) {
            let existingIds = Set(normalizedSnapshot.turns.map(\.id))
            olderTurns = existing.turns[..<pivotIndex].filter { !existingIds.contains($0.id) }
        } else {
            olderTurns = []
        }

        var merged = normalizedSnapshot
        if !olderTurns.isEmpty {
            merged.turns = olderTurns + normalizedSnapshot.turns
        }
        sessions[merged.session.id] = merged
        cachedOnlySessionIds.remove(merged.session.id)
        lock.unlock()

        rebuildSummaries()
        SessionCache.shared.save(merged)
        Self.logger.notice("Applied live snapshot preserving older history for session \(merged.session.id)")
    }

    /// Prepend an older history page ahead of the currently loaded timeline.
    func prependHistoryPage(_ snapshot: SessionState) {
        let normalizedSnapshot = TurnHash.normalize(snapshot)

        lock.lock()
        if var existing = sessions[normalizedSnapshot.session.id] {
            let existingIds = Set(existing.turns.map(\.id))
            let olderTurns = normalizedSnapshot.turns.filter { !existingIds.contains($0.id) }
            existing.turns = olderTurns + existing.turns
            existing.history = normalizedSnapshot.history
            existing.session = normalizedSnapshot.session
            sessions[existing.session.id] = existing
            cachedOnlySessionIds.remove(existing.session.id)
            lock.unlock()

            rebuildSummaries()
            SessionCache.shared.save(existing)
            Self.logger.notice("Prepended \(olderTurns.count) older turns for session \(existing.session.id)")
            return
        }

        sessions[normalizedSnapshot.session.id] = normalizedSnapshot
        cachedOnlySessionIds.remove(normalizedSnapshot.session.id)
        lock.unlock()

        rebuildSummaries()
        SessionCache.shared.save(normalizedSnapshot)
    }

    /// Restore cached turns without claiming the session is live on the bridge.
    func restoreCachedSnapshot(_ snapshot: SessionState) {
        mergeSnapshot(snapshot, source: .cache)
    }

    private enum SnapshotSource {
        case live
        case cache
    }

    private func mergeSnapshot(_ snapshot: SessionState, source: SnapshotSource) {
        let normalizedSnapshot = TurnHash.normalize(snapshot)

        lock.lock()
        sessions[normalizedSnapshot.session.id] = normalizedSnapshot
        switch source {
        case .live:
            cachedOnlySessionIds.remove(normalizedSnapshot.session.id)
        case .cache:
            cachedOnlySessionIds.insert(normalizedSnapshot.session.id)
        }
        lock.unlock()

        rebuildSummaries()
        SessionCache.shared.save(normalizedSnapshot)
        Self.logger.notice(
            "Applied \(source == .live ? "live" : "cached") snapshot for session \(normalizedSnapshot.session.id)"
        )
    }

    /// Reconcile local state against the bridge's authoritative active session set.
    /// Sessions not present in `keeping` are removed; provided snapshots replace local copies.
    func reconcileSnapshots(_ snapshots: [SessionState], keeping sessionIds: Set<String>) {
        lock.lock()
        sessions = sessions.filter { sessionIds.contains($0.key) || cachedOnlySessionIds.contains($0.key) }
        cachedOnlySessionIds.subtract(sessionIds)
        relaySummariesById = relaySummariesById.filter { sessionIds.contains($0.key) }
        for snapshot in snapshots {
            let normalizedSnapshot = TurnHash.normalize(snapshot)
            sessions[normalizedSnapshot.session.id] = normalizedSnapshot
            cachedOnlySessionIds.remove(normalizedSnapshot.session.id)
        }
        for sessionId in sessions.keys where !sessionIds.contains(sessionId) {
            cachedOnlySessionIds.insert(sessionId)
        }
        lock.unlock()

        rebuildSummaries()
        Self.logger.notice(
            "Reconciled \(snapshots.count) snapshots across \(sessionIds.count) active sessions"
        )
    }

    /// Reconcile the live session list using lightweight relay summaries.
    /// The landing list should not require per-session snapshots.
    func reconcileLiveSummaries(_ summaries: [SessionSummary]) {
        let summaryIds = Set(summaries.map(\.sessionId))

        lock.lock()
        relaySummariesById = Dictionary(uniqueKeysWithValues: summaries.map { ($0.sessionId, $0) })
        sessions = sessions.filter { summaryIds.contains($0.key) || cachedOnlySessionIds.contains($0.key) }
        cachedOnlySessionIds.subtract(summaryIds)

        for summary in summaries {
            let status = SessionStatus(rawValue: summary.status) ?? .idle
            let providerMeta = summary.project.map { ["project": AnyCodable($0)] }

            if var existing = sessions[summary.sessionId] {
                existing.session.name = summary.name
                existing.session.status = status
                existing.session.model = summary.model
                if let providerMeta {
                    existing.session.providerMeta = (existing.session.providerMeta ?? [:]).merging(providerMeta) { _, new in new }
                }
                sessions[summary.sessionId] = existing
            } else {
                sessions[summary.sessionId] = SessionState(
                    session: Session(
                        id: summary.sessionId,
                        name: summary.name,
                        adapterType: summary.adapterType,
                        status: status,
                        cwd: nil,
                        model: summary.model,
                        providerMeta: providerMeta
                    ),
                    history: nil,
                    turns: [],
                    currentTurnId: nil
                )
            }
        }
        lock.unlock()

        rebuildSummaries()
        Self.logger.notice("Reconciled \(summaries.count) live relay summaries")
    }

    /// Reset all state. Used when bridge identity changes.
    func clearAll() {
        lock.lock()
        sessions.removeAll()
        summaries.removeAll()
        cachedOnlySessionIds.removeAll()
        relaySummariesById.removeAll()
        lastAppliedSeq = 0
        bridgeIdentityKey = nil
        lock.unlock()

        Self.logger.notice("Cleared all session state")
    }

    /// Update lastAppliedSeq and persist it.
    func updateLastAppliedSeq(_ seq: Int) {
        guard seq > lastAppliedSeq else { return }
        lastAppliedSeq = seq
        if let key = bridgeIdentityKey {
            Self.persistLastAppliedSeq(seq, for: key)
        }
    }

    /// Append a local-only turn (e.g. user message) to a session.
    func appendLocalTurn(_ turn: TurnState, sessionId: String) {
        lock.lock()
        guard var state = sessions[sessionId] else {
            lock.unlock()
            return
        }
        state.turns.append(TurnHash.normalize(turn))
        sessions[sessionId] = state
        lock.unlock()

        SessionCache.shared.save(state)
    }

    // MARK: - Computed properties

    /// All non-closed sessions, sorted by last activity.
    var activeSessions: [SessionState] {
        sessions.values
            .filter { $0.session.status != .closed && !cachedOnlySessionIds.contains($0.session.id) }
            .sorted { a, b in
                let aTime = a.turns.last?.endedAt ?? a.turns.last?.startedAt ?? 0
                let bTime = b.turns.last?.endedAt ?? b.turns.last?.startedAt ?? 0
                return aTime > bTime
            }
    }

    /// The most recently active session.
    var currentSession: SessionState? {
        activeSessions.first
    }

    /// Whether any session currently has a streaming turn.
    var isAnySessionStreaming: Bool {
        sessions.values.contains { state in
            state.currentTurnId != nil &&
            state.turns.contains { $0.status == .streaming }
        }
    }

    // MARK: - Private: Event routing

    /// Route a single ScoutEvent to the appropriate handler.
    private func routeEvent(_ event: ScoutEvent) {
        switch event {
        case .sessionUpdate(let session):
            handleSessionUpdate(session)

        case .sessionClosed(let sessionId):
            handleSessionClosed(sessionId)

        case .turnStart(let sessionId, let turn):
            handleTurnStart(sessionId: sessionId, turn: turn)

        case .turnEnd(let sessionId, let turnId, let status):
            handleTurnEnd(sessionId: sessionId, turnId: turnId, status: status)

        case .turnError(let sessionId, let turnId, let message):
            handleTurnError(sessionId: sessionId, turnId: turnId, message: message)

        case .blockStart(let sessionId, let turnId, let block):
            handleBlockStart(sessionId: sessionId, turnId: turnId, block: block)

        case .blockDelta(let sessionId, let turnId, let blockId, let text):
            handleBlockDelta(sessionId: sessionId, turnId: turnId, blockId: blockId, text: text)

        case .blockActionOutput(let sessionId, let turnId, let blockId, let output):
            handleBlockActionOutput(sessionId: sessionId, turnId: turnId, blockId: blockId, output: output)

        case .blockActionStatus(let sessionId, let turnId, let blockId, let status, let meta):
            handleBlockActionStatus(sessionId: sessionId, turnId: turnId, blockId: blockId, status: status, meta: meta)

        case .blockEnd(let sessionId, let turnId, let blockId, let status):
            handleBlockEnd(sessionId: sessionId, turnId: turnId, blockId: blockId, status: status)

        case .unknown(let discriminator):
            Self.logger.warning("Unknown event discriminator: \(discriminator), skipping")
        }
    }

    // MARK: - Private: Session lifecycle handlers

    private func handleSessionUpdate(_ session: Session) {
        var stateToPersist: SessionState?

        lock.lock()
        if var state = sessions[session.id] {
            state.session = session
            sessions[session.id] = state
            stateToPersist = state
        } else {
            // First time seeing this session — create fresh state.
            let freshState = SessionState(
                session: session,
                history: nil,
                turns: [],
                currentTurnId: nil
            )
            sessions[session.id] = freshState
            stateToPersist = freshState
        }
        cachedOnlySessionIds.remove(session.id)
        lock.unlock()

        if let stateToPersist {
            SessionCache.shared.save(stateToPersist)
        }
    }

    private func handleSessionClosed(_ sessionId: String) {
        var stateToPersist: SessionState?

        lock.lock()
        if var state = sessions[sessionId] {
            var session = state.session
            session.status = .closed
            state.session = session
            sessions[sessionId] = state
            cachedOnlySessionIds.insert(sessionId)
            stateToPersist = state
        }
        lock.unlock()

        if let stateToPersist {
            SessionCache.shared.save(stateToPersist)
        }
    }

    // MARK: - Private: Turn lifecycle handlers

    private func handleTurnStart(sessionId: String, turn: Turn) {
        lock.lock()
        guard var state = sessions[sessionId] else {
            lock.unlock()
            Self.logger.warning("turn:start for unknown session \(sessionId)")
            return
        }

        let turnState = TurnState(
            id: turn.id,
            status: .streaming,
            blocks: [],
            startedAt: Int(Date().timeIntervalSince1970 * 1000),
            endedAt: nil
        )
        state.turns.append(TurnHash.normalize(turnState))
        state.currentTurnId = turn.id
        sessions[sessionId] = state
        lock.unlock()
    }

    private func handleTurnEnd(sessionId: String, turnId: String, status: TurnStatus) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }) else {
            lock.unlock()
            Self.logger.warning("turn:end for unknown session/turn: \(sessionId)/\(turnId)")
            return
        }

        // Map protocol TurnStatus → snapshot SnapshotTurnStatus (mirrors state.ts logic).
        let snapshotStatus: SnapshotTurnStatus
        switch status {
        case .completed:
            snapshotStatus = .completed
        case .stopped:
            snapshotStatus = .interrupted
        case .failed:
            snapshotStatus = .error
        default:
            // "started" and "streaming" are not terminal, but handle gracefully.
            snapshotStatus = .completed
        }

        state.turns[turnIndex].status = snapshotStatus
        state.turns[turnIndex].endedAt = Int(Date().timeIntervalSince1970 * 1000)
        state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])

        if state.currentTurnId == turnId {
            state.currentTurnId = nil
        }

        sessions[sessionId] = state
        lock.unlock()

        // Persist to local cache after each completed turn
        SessionCache.shared.save(state)

    }

    private func handleTurnError(sessionId: String, turnId: String, message: String) {
        var stateToPersist: SessionState?

        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }) else {
            lock.unlock()
            Self.logger.warning("turn:error for unknown session/turn: \(sessionId)/\(turnId)")
            return
        }

        state.turns[turnIndex].status = .error
        state.turns[turnIndex].endedAt = Int(Date().timeIntervalSince1970 * 1000)
        state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])

        if state.currentTurnId == turnId {
            state.currentTurnId = nil
        }

        sessions[sessionId] = state
        stateToPersist = state
        lock.unlock()

        if let stateToPersist {
            SessionCache.shared.save(stateToPersist)
        }
        Self.logger.error("Turn error in \(sessionId)/\(turnId): \(message)")
    }

    // MARK: - Private: Block lifecycle handlers

    private func handleBlockStart(sessionId: String, turnId: String, block: Block) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }) else {
            lock.unlock()
            Self.logger.warning("block:start for unknown session/turn: \(sessionId)/\(turnId)")
            return
        }

        let blockStatus: SnapshotBlockStatus = block.status == .completed ? .completed : .streaming
        let blockState = BlockState(block: block, status: blockStatus)
        state.turns[turnIndex].blocks.append(blockState)
        state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])
        sessions[sessionId] = state
        lock.unlock()
    }

    private func handleBlockDelta(sessionId: String, turnId: String, blockId: String, text: String) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }),
              let blockIndex = state.turns[turnIndex].blocks.firstIndex(where: { $0.block.id == blockId }) else {
            lock.unlock()
            return
        }

        let blockType = state.turns[turnIndex].blocks[blockIndex].block.type
        if blockType == .text || blockType == .reasoning {
            let existing = state.turns[turnIndex].blocks[blockIndex].block.text ?? ""
            state.turns[turnIndex].blocks[blockIndex].block.text = existing + text
        }

        state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])
        sessions[sessionId] = state
        lock.unlock()
    }

    private func handleBlockActionOutput(sessionId: String, turnId: String, blockId: String, output: String) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }),
              let blockIndex = state.turns[turnIndex].blocks.firstIndex(where: { $0.block.id == blockId }) else {
            lock.unlock()
            return
        }

        if state.turns[turnIndex].blocks[blockIndex].block.type == .action,
           var action = state.turns[turnIndex].blocks[blockIndex].block.action {
            action.output += output
            state.turns[turnIndex].blocks[blockIndex].block.action = action
            state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])
            sessions[sessionId] = state
        }

        lock.unlock()
    }

    private func handleBlockActionStatus(
        sessionId: String,
        turnId: String,
        blockId: String,
        status: ActionStatus,
        meta: [String: AnyCodable]?
    ) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }),
              let blockIndex = state.turns[turnIndex].blocks.firstIndex(where: { $0.block.id == blockId }) else {
            lock.unlock()
            return
        }

        if state.turns[turnIndex].blocks[blockIndex].block.type == .action,
           var action = state.turns[turnIndex].blocks[blockIndex].block.action {
            action.status = status
            state.turns[turnIndex].blocks[blockIndex].block.action = action
            state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])
            sessions[sessionId] = state
        }

        lock.unlock()
    }

    private func handleBlockEnd(sessionId: String, turnId: String, blockId: String, status: BlockStatus) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }),
              let blockIndex = state.turns[turnIndex].blocks.firstIndex(where: { $0.block.id == blockId }) else {
            lock.unlock()
            return
        }

        state.turns[turnIndex].blocks[blockIndex].status = .completed
        state.turns[turnIndex].blocks[blockIndex].block.status = status
        state.turns[turnIndex] = TurnHash.normalize(state.turns[turnIndex])
        sessions[sessionId] = state
        lock.unlock()
    }

    // MARK: - Private: Summary rebuilding

    /// Rebuild lightweight summaries from the full session state.
    private func rebuildSummaries() {
        lock.lock()
        let allStates = Array(sessions.values)
        let relaySummariesById = relaySummariesById
        let cachedOnlySessionIds = cachedOnlySessionIds
        lock.unlock()

        let now = Int(Date().timeIntervalSince1970 * 1000)

        summaries = allStates.map { state in
            let relaySummary = relaySummariesById[state.session.id]
            let currentTurn = state.currentTurnId.flatMap { turnId in
                state.turns.first { $0.id == turnId }
            }
            let lastTurn = state.turns.last
            let startedAt = state.turns.first?.startedAt ?? relaySummary?.startedAt ?? now
            let lastActivity = lastTurn?.endedAt ?? lastTurn?.startedAt ?? relaySummary?.lastActivityAt ?? startedAt
            let turnCount = state.turns.isEmpty ? (relaySummary?.turnCount ?? 0) : state.turns.count
            let currentTurnStatus = currentTurn?.status.rawValue ?? relaySummary?.currentTurnStatus
            let status = relaySummary?.status ?? state.session.status.rawValue
            let name = relaySummary?.name ?? state.session.name
            let adapterType = relaySummary?.adapterType ?? state.session.adapterType
            let project = state.session.inferredProjectName ?? relaySummary?.project
            let model = state.session.model ?? relaySummary?.model

            return SessionSummary(
                sessionId: state.session.id,
                name: name,
                adapterType: adapterType,
                status: status,
                turnCount: turnCount,
                currentTurnStatus: currentTurnStatus,
                startedAt: startedAt,
                lastActivityAt: lastActivity,
                project: project,
                model: model,
                isCachedOnly: cachedOnlySessionIds.contains(state.session.id)
            )
        }.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private func hydrateFromCache() {
        let cachedStates = SessionCache.shared.loadAll().map(TurnHash.normalize)
        guard !cachedStates.isEmpty else { return }

        lock.lock()
        for cachedState in cachedStates {
            sessions[cachedState.session.id] = cachedState
            cachedOnlySessionIds.insert(cachedState.session.id)
        }
        lock.unlock()

        rebuildSummaries()
        Self.logger.notice("Hydrated \(cachedStates.count) cached sessions at launch")
    }

    // MARK: - Private: Seq persistence

    private static func seqDefaultsKey(for bridgeKey: String) -> String {
        "scout.lastAppliedSeq.\(bridgeKey)"
    }

    private static func loadLastAppliedSeq(for bridgeKey: String) -> Int {
        UserDefaults.standard.integer(forKey: seqDefaultsKey(for: bridgeKey))
    }

    private static func persistLastAppliedSeq(_ seq: Int, for bridgeKey: String) {
        UserDefaults.standard.set(seq, forKey: seqDefaultsKey(for: bridgeKey))
    }
}

// MARK: - Preview instance

extension SessionStore {
    static let preview: SessionStore = {
        let store = SessionStore()
        store.clearAll()
        store.connectionState = .connected
        store.summaries = [
            SessionSummary(
                sessionId: "s1", name: "Refactor auth",
                adapterType: "claude-code", status: "active",
                turnCount: 8, currentTurnStatus: "streaming",
                startedAt: Int(Date().addingTimeInterval(-3600).timeIntervalSince1970 * 1000),
                lastActivityAt: Int(Date().addingTimeInterval(-15).timeIntervalSince1970 * 1000),
                project: "scout",
                model: "claude-sonnet-4-20250514"
            ),
            SessionSummary(
                sessionId: "s2", name: "Write API docs",
                adapterType: "openai", status: "idle",
                turnCount: 3, currentTurnStatus: nil,
                startedAt: Int(Date().addingTimeInterval(-7200).timeIntervalSince1970 * 1000),
                lastActivityAt: Int(Date().addingTimeInterval(-300).timeIntervalSince1970 * 1000),
                project: "scout-mobile",
                model: "gpt-5.4-mini"
            ),
        ]
        store.sessions["s1"] = SessionState(
            session: Session(
                id: "s1", name: "Refactor auth",
                adapterType: "claude-code", status: .active,
                cwd: "/Users/arach/dev/openscout",
                model: "claude-sonnet-4-20250514"
            ),
            history: nil,
            turns: [
                TurnState(
                    id: "t1",
                    status: .completed,
                    blocks: [
                        BlockState(
                            block: Block(
                                id: "b1", turnId: "t1", type: .text, status: .completed, index: 0,
                                text: "I'll help you refactor the authentication module to use JWT tokens."
                            ),
                            status: .completed
                        ),
                        BlockState(
                            block: Block(
                                id: "b2", turnId: "t1", type: .action, status: .completed, index: 1,
                                action: Action(
                                    kind: .fileChange, status: .completed,
                                    output: "",
                                    path: "src/auth/jwt.ts",
                                    diff: "+import jwt from 'jsonwebtoken'\n+export function signToken(payload: object) {\n+  return jwt.sign(payload, process.env.SECRET!)\n+}"
                                )
                            ),
                            status: .completed
                        ),
                    ],
                    startedAt: Int(Date().addingTimeInterval(-300).timeIntervalSince1970 * 1000)
                ),
            ],
            currentTurnId: "t1"
        )
        return store
    }()
}
