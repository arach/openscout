// ConversationProjection (SCO-061 Phase 2).
//
// The pure event→state reducer, promoted out of the iOS donor's
// `SessionStore`. Everything that made `SessionStore` platform-bound —
// `@MainActor`, the `NSLock`, `SessionCache`, `os.Logger`, observation — is
// left behind in the platform store. What remains is a value type: given a
// `SessionState` and a `ScoutEvent`, produce the next `SessionState`.
//
// Both platform stores wrap this. The iOS bridge feeds it live events; the
// macOS web client feeds it SSE events; tests feed it recorded fixtures. The
// reduction is identical everywhere, which is the whole point of the contract.

import Foundation

/// A self-contained, deterministic projection of one conversation. Apply events
/// (live or replayed) and read `state`. Seq tracking mirrors the donor: events
/// with `seq == 0` are initial pushes and do not advance `lastAppliedSeq`.
public struct ConversationProjection: Sendable, Equatable {
    public private(set) var state: SessionState?
    public private(set) var lastAppliedSeq: Int

    public init(state: SessionState? = nil, lastAppliedSeq: Int = 0) {
        self.state = state
        self.lastAppliedSeq = lastAppliedSeq
    }

    /// Replace the projection wholesale from an authoritative snapshot.
    public mutating func applySnapshot(_ snapshot: SessionState) {
        state = snapshot
    }

    /// Apply a sequenced event. Routes the inner event, then advances the seq
    /// cursor when the event is part of the replay buffer (`seq > 0`).
    public mutating func apply(_ sequenced: SequencedEvent) {
        apply(sequenced.event)
        if sequenced.seq > 0, sequenced.seq > lastAppliedSeq {
            lastAppliedSeq = sequenced.seq
        }
    }

    /// Apply a batch of replay events in order.
    public mutating func apply(replay events: [SequencedEvent]) {
        for event in events { apply(event) }
    }

    /// Route a single event into the state. Unknown discriminators are ignored
    /// (forward-compatible), exactly as the donor did.
    public mutating func apply(_ event: ScoutEvent) {
        switch event {
        case .sessionUpdate(let session):
            handleSessionUpdate(session)
        case .sessionClosed(let sessionId):
            handleSessionClosed(sessionId)
        case .turnStart(let sessionId, let turn):
            handleTurnStart(sessionId: sessionId, turn: turn)
        case .turnEnd(let sessionId, let turnId, let status):
            handleTurnEnd(sessionId: sessionId, turnId: turnId, status: status)
        case .turnError(let sessionId, let turnId, _):
            handleTurnError(sessionId: sessionId, turnId: turnId)
        case .blockStart(let sessionId, let turnId, let block):
            handleBlockStart(sessionId: sessionId, turnId: turnId, block: block)
        case .blockDelta(let sessionId, let turnId, let blockId, let text):
            handleBlockDelta(sessionId: sessionId, turnId: turnId, blockId: blockId, text: text)
        case .blockActionOutput(let sessionId, let turnId, let blockId, let output):
            handleBlockActionOutput(sessionId: sessionId, turnId: turnId, blockId: blockId, output: output)
        case .blockActionStatus(let sessionId, let turnId, let blockId, let status, _):
            handleBlockActionStatus(sessionId: sessionId, turnId: turnId, blockId: blockId, status: status)
        case .blockActionApproval(let sessionId, let turnId, let blockId, let approval):
            handleBlockActionApproval(sessionId: sessionId, turnId: turnId, blockId: blockId, approval: approval)
        case .blockQuestionAnswer(let sessionId, let turnId, let blockId, let questionStatus, let answer):
            handleBlockQuestionAnswer(sessionId: sessionId, turnId: turnId, blockId: blockId, questionStatus: questionStatus, answer: answer)
        case .blockEnd(let sessionId, let turnId, let blockId, let status):
            handleBlockEnd(sessionId: sessionId, turnId: turnId, blockId: blockId, status: status)
        case .unknown:
            break
        }
    }

    // MARK: - Session lifecycle

    private mutating func handleSessionUpdate(_ session: Session) {
        if var s = state, s.session.id == session.id {
            s.session = session
            state = s
        } else if state == nil {
            state = SessionState(session: session)
        } else {
            // Event for a different session id — projection is single-session.
        }
    }

    private mutating func handleSessionClosed(_ sessionId: String) {
        guard var s = state, s.session.id == sessionId else { return }
        s.session.status = .closed
        state = s
    }

    // MARK: - Turn lifecycle

    private mutating func handleTurnStart(sessionId: String, turn: Turn) {
        guard var s = state, s.session.id == sessionId else { return }
        let turnState = TurnState(
            id: turn.id,
            status: .streaming,
            blocks: [],
            startedAt: parseMillis(turn.startedAt),
            endedAt: nil,
            isUserTurn: turn.isUserTurn
        )
        s.turns.append(turnState)
        s.currentTurnId = turn.id
        state = s
    }

    private mutating func handleTurnEnd(sessionId: String, turnId: String, status: TurnStatus) {
        guard var s = state, s.session.id == sessionId,
              let i = s.turns.firstIndex(where: { $0.id == turnId }) else { return }
        // Map protocol TurnStatus → snapshot status (mirrors state.ts).
        let snapshotStatus: SnapshotTurnStatus
        switch status {
        case .completed: snapshotStatus = .completed
        case .stopped: snapshotStatus = .interrupted
        case .failed: snapshotStatus = .error
        default: snapshotStatus = .completed
        }
        s.turns[i].status = snapshotStatus
        s.turns[i].endedAt = s.turns[i].endedAt ?? nowMillisPlaceholder(s.turns[i].startedAt)
        if s.currentTurnId == turnId { s.currentTurnId = nil }
        state = s
    }

    private mutating func handleTurnError(sessionId: String, turnId: String) {
        guard var s = state, s.session.id == sessionId,
              let i = s.turns.firstIndex(where: { $0.id == turnId }) else { return }
        s.turns[i].status = .error
        s.turns[i].endedAt = s.turns[i].endedAt ?? nowMillisPlaceholder(s.turns[i].startedAt)
        if s.currentTurnId == turnId { s.currentTurnId = nil }
        state = s
    }

    // MARK: - Block lifecycle

    private mutating func handleBlockStart(sessionId: String, turnId: String, block: Block) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }) else { return }
        let status: SnapshotBlockStatus = block.status == .completed ? .completed : .streaming
        s.turns[ti].blocks.append(BlockState(block: block, status: status))
        state = s
    }

    private mutating func handleBlockDelta(sessionId: String, turnId: String, blockId: String, text: String) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }) else { return }
        let type = s.turns[ti].blocks[bi].block.type
        if type == .text || type == .reasoning {
            let existing = s.turns[ti].blocks[bi].block.text ?? ""
            s.turns[ti].blocks[bi].block.text = existing + text
        }
        state = s
    }

    private mutating func handleBlockActionOutput(sessionId: String, turnId: String, blockId: String, output: String) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }),
              s.turns[ti].blocks[bi].block.type == .action,
              var action = s.turns[ti].blocks[bi].block.action else { return }
        action.output += output
        s.turns[ti].blocks[bi].block.action = action
        state = s
    }

    private mutating func handleBlockActionStatus(sessionId: String, turnId: String, blockId: String, status: ActionStatus) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }),
              s.turns[ti].blocks[bi].block.type == .action,
              var action = s.turns[ti].blocks[bi].block.action else { return }
        action.status = status
        s.turns[ti].blocks[bi].block.action = action
        state = s
    }

    private mutating func handleBlockActionApproval(sessionId: String, turnId: String, blockId: String, approval: ActionApproval) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }),
              s.turns[ti].blocks[bi].block.type == .action,
              var action = s.turns[ti].blocks[bi].block.action else { return }
        action.status = .awaitingApproval
        action.approval = approval
        s.turns[ti].blocks[bi].block.action = action
        state = s
    }

    private mutating func handleBlockQuestionAnswer(sessionId: String, turnId: String, blockId: String, questionStatus: QuestionBlockStatus, answer: [String]?) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }) else { return }
        s.turns[ti].blocks[bi].block.questionStatus = questionStatus
        s.turns[ti].blocks[bi].block.answer = answer
        state = s
    }

    private mutating func handleBlockEnd(sessionId: String, turnId: String, blockId: String, status: BlockStatus) {
        guard var s = state, s.session.id == sessionId,
              let ti = s.turns.firstIndex(where: { $0.id == turnId }),
              let bi = s.turns[ti].blocks.firstIndex(where: { $0.block.id == blockId }) else { return }
        s.turns[ti].blocks[bi].status = .completed
        s.turns[ti].blocks[bi].block.status = status
        state = s
    }

    // MARK: - Helpers

    /// Best-effort parse of an ISO/epoch `startedAt` into epoch millis. The
    /// donor stamped `Date()` at apply time; the projection prefers the value
    /// carried on the turn so reduction stays deterministic for fixtures.
    private func parseMillis(_ raw: String) -> Int {
        if let ms = Int(raw) { return ms }
        if let secs = Double(raw) { return Int(secs * 1000) }
        return 0
    }

    /// Deterministic end stamp: keep the start stamp rather than reading the
    /// wall clock, so `apply` stays pure and fixtures are reproducible.
    private func nowMillisPlaceholder(_ startedAt: Int) -> Int { startedAt }
}
