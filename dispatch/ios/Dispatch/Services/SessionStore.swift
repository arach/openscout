// SessionStore — Observable state container for Dispatch sessions.
//
// Accumulates session state from streaming events, mirroring the logic
// in src/bridge/state.ts. Provides the single source of truth for all
// session data displayed in the UI.
//
// Uses @Observable (iOS 17+) for fine-grained SwiftUI invalidation.

import Foundation
import os

@Observable
final class SessionStore: @unchecked Sendable {

    // MARK: - Observable state

    /// Full accumulated state per session, keyed by session ID.
    private(set) var sessions: [String: SessionState] = [:]

    /// Lightweight summaries for the home screen session list.
    private(set) var summaries: [SessionSummary] = []

    /// Mirrors ConnectionManager's state for UI binding convenience.
    var connectionState: ConnectionState = .disconnected

    /// Highest applied sequence number. Persisted per bridge identity.
    private(set) var lastAppliedSeq: Int = 0

    // MARK: - Private

    private let lock = NSLock()
    private var bridgeIdentityKey: String?

    private static let logger = Logger(
        subsystem: "com.openscout.dispatch",
        category: "SessionStore"
    )

    // MARK: - Init

    init() {
        // Don't load cached sessions into the active list — the bridge is
        // the authority on what's active. Cache is used by TimelineView to
        // show past turns when navigating into a session.
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
        lock.lock()
        sessions[snapshot.session.id] = snapshot
        lock.unlock()

        rebuildSummaries()
        SessionCache.shared.save(snapshot)
        Self.logger.notice("Applied snapshot for session \(snapshot.session.id)")
    }

    /// Reconcile local state against the bridge's authoritative active session set.
    /// Sessions not present in `keeping` are removed; provided snapshots replace local copies.
    func reconcileSnapshots(_ snapshots: [SessionState], keeping sessionIds: Set<String>) {
        lock.lock()
        sessions = sessions.filter { sessionIds.contains($0.key) }
        for snapshot in snapshots {
            sessions[snapshot.session.id] = snapshot
        }
        lock.unlock()

        rebuildSummaries()
        Self.logger.notice(
            "Reconciled \(snapshots.count) snapshots across \(sessionIds.count) active sessions"
        )
    }

    /// Reset all state. Used when bridge identity changes.
    func clearAll() {
        lock.lock()
        sessions.removeAll()
        summaries.removeAll()
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
        state.turns.append(turn)
        sessions[sessionId] = state
        lock.unlock()
    }

    // MARK: - Computed properties

    /// All non-closed sessions, sorted by last activity.
    var activeSessions: [SessionState] {
        sessions.values
            .filter { $0.session.status != .closed }
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

    /// Route a single DispatchEvent to the appropriate handler.
    private func routeEvent(_ event: DispatchEvent) {
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
        lock.lock()
        if var state = sessions[session.id] {
            state.session = session
            sessions[session.id] = state
        } else {
            // First time seeing this session — create fresh state.
            sessions[session.id] = SessionState(
                session: session,
                turns: [],
                currentTurnId: nil
            )
        }
        lock.unlock()
    }

    private func handleSessionClosed(_ sessionId: String) {
        lock.lock()
        if var state = sessions[sessionId] {
            var session = state.session
            session.status = .closed
            state.session = session
            sessions[sessionId] = state
        }
        lock.unlock()
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
        state.turns.append(turnState)
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

        if state.currentTurnId == turnId {
            state.currentTurnId = nil
        }

        sessions[sessionId] = state
        lock.unlock()

        // Persist to local cache after each completed turn
        SessionCache.shared.save(state)

    }

    private func handleTurnError(sessionId: String, turnId: String, message: String) {
        lock.lock()
        guard var state = sessions[sessionId],
              let turnIndex = state.turns.firstIndex(where: { $0.id == turnId }) else {
            lock.unlock()
            Self.logger.warning("turn:error for unknown session/turn: \(sessionId)/\(turnId)")
            return
        }

        state.turns[turnIndex].status = .error
        state.turns[turnIndex].endedAt = Int(Date().timeIntervalSince1970 * 1000)

        if state.currentTurnId == turnId {
            state.currentTurnId = nil
        }

        sessions[sessionId] = state
        lock.unlock()

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
        sessions[sessionId] = state
        lock.unlock()
    }

    // MARK: - Private: Summary rebuilding

    /// Rebuild lightweight summaries from the full session state.
    private func rebuildSummaries() {
        lock.lock()
        let allStates = Array(sessions.values)
        lock.unlock()

        let now = Int(Date().timeIntervalSince1970 * 1000)

        summaries = allStates.map { state in
            let currentTurn = state.currentTurnId.flatMap { turnId in
                state.turns.first { $0.id == turnId }
            }
            let lastTurn = state.turns.last
            let startedAt = state.turns.first?.startedAt ?? now
            let lastActivity = lastTurn?.endedAt ?? lastTurn?.startedAt ?? startedAt

            return SessionSummary(
                sessionId: state.session.id,
                name: state.session.name,
                adapterType: state.session.adapterType,
                status: state.session.status.rawValue,
                turnCount: state.turns.count,
                currentTurnStatus: currentTurn?.status.rawValue,
                startedAt: startedAt,
                lastActivityAt: lastActivity
            )
        }.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    // MARK: - Private: Seq persistence

    private static func seqDefaultsKey(for bridgeKey: String) -> String {
        "dispatch.lastAppliedSeq.\(bridgeKey)"
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
        store.connectionState = .connected
        store.summaries = [
            SessionSummary(
                sessionId: "s1", name: "Refactor auth",
                adapterType: "claude-code", status: "active",
                turnCount: 8, currentTurnStatus: "streaming",
                startedAt: Int(Date().addingTimeInterval(-3600).timeIntervalSince1970 * 1000),
                lastActivityAt: Int(Date().addingTimeInterval(-15).timeIntervalSince1970 * 1000)
            ),
            SessionSummary(
                sessionId: "s2", name: "Write API docs",
                adapterType: "openai", status: "idle",
                turnCount: 3, currentTurnStatus: nil,
                startedAt: Int(Date().addingTimeInterval(-7200).timeIntervalSince1970 * 1000),
                lastActivityAt: Int(Date().addingTimeInterval(-300).timeIntervalSince1970 * 1000)
            ),
        ]
        store.sessions["s1"] = SessionState(
            session: Session(
                id: "s1", name: "Refactor auth",
                adapterType: "claude-code", status: .active
            ),
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
