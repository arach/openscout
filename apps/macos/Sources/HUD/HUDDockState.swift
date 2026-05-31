import Combine
import Foundation
import os.log
import ScoutNativeCore
import SwiftUI

enum HUDDockSuggestionKind: String {
    case command
    case agent
    case session

    var eyebrow: String {
        switch self {
        case .command: return "COMMANDS"
        case .agent: return "AGENTS"
        case .session: return "SESSIONS"
        }
    }
}

enum HUDDockSuggestionAction: String {
    case openRunner
}

struct HUDDockSuggestion: Identifiable, Equatable {
    let id: String
    let kind: HUDDockSuggestionKind
    let label: String
    let detail: String
    let replacement: String
    let targetHandle: String?
    let targetLabel: String?
    let action: HUDDockSuggestionAction?
}

private struct HUDDockSuggestionTrigger: Equatable {
    let kind: HUDDockSuggestionKind
    let token: String
    let query: String
    let startOffset: Int
    let endOffset: Int

    var signature: String {
        "\(kind.rawValue):\(startOffset):\(token)"
    }
}

private struct HUDDockCommandCandidate {
    let command: String
    let detail: String
    let replacement: String
    let action: HUDDockSuggestionAction?
}

/// Owns the universal message dock's editable state — the text buffer,
/// the routing target (an agent handle or nil = default channel), and
/// the focus signal. The dock itself binds to this; views fire actions
/// (engage SEND, row Enter, etc.) into it.
///
/// Sending happens through `HudComposeService`, which posts to the web
/// surface's `/api/send` endpoint. The broker parses `@-mentions` in
/// the body, so when a target is set we prepend `@<handle> ` to the
/// outgoing body and clear the chip after submit.
@MainActor
final class HUDDockState: ObservableObject {
    static let shared = HUDDockState()

    @Published var text: String = ""
    @Published var targetHandle: String? = nil   // "@hudson" (display + routing)
    @Published var targetLabel: String? = nil    // "Hudson"  (visible chip text)
    @Published var focusRequested: Int = 0       // bump → dock takes firstResponder
    @Published var lastError: String? = nil
    @Published var isSending: Bool = false
    @Published private(set) var suggestions: [HUDDockSuggestion] = []
    @Published private(set) var selectedSuggestionIndex: Int = 0

    private var voxSubscription: AnyCancellable?
    private var currentSuggestionTrigger: HUDDockSuggestionTrigger?
    private var dismissedSuggestionSignature: String?
    private let log = Logger(subsystem: "dev.openscout.menu", category: "dock")

    var suggestionsVisible: Bool {
        !suggestions.isEmpty
    }

    private init() {
        // Watch the Vox client for finalized transcripts and splice them
        // into the text buffer. The service exposes `lastFinalText` as a
        // one-shot signal; we drain it via consumeFinalText() so the
        // same transcript isn't re-appended on subsequent state pushes.
        voxSubscription = HudVoxService.shared.$lastFinalText
            .receive(on: RunLoop.main)
            .sink { [weak self] text in
                guard let self else { return }
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                self.log.info("vox final received — len=\(trimmed.count)")
                guard !trimmed.isEmpty else { return }
                if CommsWindowController.shared.isPresented {
                    // Comms panel is foreground and owns dictation; its own
                    // subscription splices the transcript and drains it.
                    return
                }
                if HUDRunnerState.shared.isPresented {
                    HUDRunnerState.shared.appendDictatedText(trimmed)
                    HudVoxService.shared.consumeFinalText()
                    return
                }
                self.appendDictatedText(trimmed)
                HudVoxService.shared.consumeFinalText()
            }
    }

    /// Splice a dictated phrase into the input. Empty buffer → set;
    /// non-empty → append with a single space separator. Always focuses
    /// the field so the operator can edit before sending.
    private func appendDictatedText(_ phrase: String) {
        text = ScoutDictationBuffer.appending(phrase, to: text)
        focus()
    }

    // MARK: - Dictation

    /// Mic-tap action. Probes Vox if state is unknown / unavailable,
    /// otherwise toggles recording on/off. Errors surface as state on
    /// HudVoxService.shared; the dock view reads them for tooltip copy.
    func toggleDictation() async {
        let vox = HudVoxService.shared
        switch ScoutDictationController.toggleDecision(for: vox.state) {
        case .probeThenStartIfIdle:
            await vox.probe()
            if case .idle = vox.state {
                vox.start()
            }
        case .start:
            vox.start()
        case .stop:
            vox.stop()
        case .ignore:
            // already finalizing — ignore the second tap
            return
        }
    }

    /// Bring keyboard focus to the dock's TextField. Use after engaging
    /// a row or hitting the SEND chip — the operator's next keystroke
    /// should land in the input.
    func focus() {
        focusRequested &+= 1
    }

    /// Stage a target without focusing — e.g. row hover. The chip
    /// appears in the dock to telegraph routing.
    func setTarget(handle: String?, label: String?) {
        if let handle, !handle.isEmpty {
            targetHandle = handle.hasPrefix("@") ? handle : "@" + handle
            targetLabel = label ?? handle
        } else {
            targetHandle = nil
            targetLabel = nil
        }
    }

    // MARK: - Suggestions

    func refreshSuggestions(agents: [HudAgent]) {
        guard let trigger = Self.detectSuggestionTrigger(in: text) else {
            clearSuggestions(resetDismissedSignature: true)
            return
        }

        currentSuggestionTrigger = trigger
        if dismissedSuggestionSignature == trigger.signature {
            suggestions = []
            selectedSuggestionIndex = 0
            return
        }

        let next = Self.suggestions(for: trigger, agents: agents)
        suggestions = next
        if next.isEmpty {
            selectedSuggestionIndex = 0
        } else {
            selectedSuggestionIndex = min(selectedSuggestionIndex, next.count - 1)
        }
    }

    func dismissSuggestions() {
        dismissedSuggestionSignature = currentSuggestionTrigger?.signature
        suggestions = []
        selectedSuggestionIndex = 0
    }

    func selectSuggestion(index: Int) {
        guard !suggestions.isEmpty else { return }
        selectedSuggestionIndex = max(0, min(index, suggestions.count - 1))
    }

    func stepSuggestion(_ delta: Int) {
        guard !suggestions.isEmpty else { return }
        let count = suggestions.count
        selectedSuggestionIndex = (selectedSuggestionIndex + delta + count) % count
    }

    @discardableResult
    func handleSuggestionKey(keyCode: UInt16) -> Bool {
        guard suggestionsVisible else { return false }
        switch keyCode {
        case 125: // Down arrow
            stepSuggestion(+1)
            return true
        case 126: // Up arrow
            stepSuggestion(-1)
            return true
        case 36, 48: // Return, Tab
            return applySelectedSuggestion()
        default:
            return false
        }
    }

    @discardableResult
    func applySelectedSuggestion() -> Bool {
        guard !suggestions.isEmpty else { return false }
        let idx = min(selectedSuggestionIndex, suggestions.count - 1)
        return applySuggestion(suggestions[idx])
    }

    @discardableResult
    func applySuggestion(_ suggestion: HUDDockSuggestion) -> Bool {
        guard let trigger = currentSuggestionTrigger else { return false }
        guard let start = Self.index(in: text, offset: trigger.startOffset),
              let end = Self.index(in: text, offset: trigger.endOffset) else {
            return false
        }

        let before = String(text[..<start])
        let after = String(text[end...])
        text = "\(before)\(suggestion.replacement)\(after)"

        if suggestion.action == .openRunner {
            HUDRunnerState.shared.open(prefillInstructions: text.trimmingCharacters(in: .whitespacesAndNewlines))
            text = ""
        }

        if suggestion.kind == .agent {
            setTarget(handle: suggestion.targetHandle, label: suggestion.targetLabel)
        }

        clearSuggestions(resetDismissedSignature: true)
        focus()
        return true
    }

    private func clearSuggestions(resetDismissedSignature: Bool = false) {
        suggestions = []
        selectedSuggestionIndex = 0
        currentSuggestionTrigger = nil
        if resetDismissedSignature {
            dismissedSuggestionSignature = nil
        }
    }

    /// Walk back through the dock's commit stack. Returns true when
    /// Esc was absorbed here; false means there was nothing for the
    /// dock to undo and the caller should keep cascading (e.g. row
    /// unengage, HUD dismiss).
    ///
    /// Stages, in order:
    ///   1. Non-empty text → clear text (keep target chip)
    ///   2. Target chip set → clear target
    ///   3. (caller handles focus + engaged-row + dismiss)
    @discardableResult
    func escapePressed() -> Bool {
        if suggestionsVisible {
            dismissSuggestions()
            return true
        }
        // Dictation in progress trumps everything — operator pressing ESC
        // while the mic is hot expects the recording to stop, not their
        // composed text to vanish.
        let vox = HudVoxService.shared
        if vox.state == .recording || vox.state == .starting {
            vox.cancel()
            return true
        }
        if !text.isEmpty {
            text = ""
            return true
        }
        if targetHandle != nil {
            targetHandle = nil
            targetLabel = nil
            return true
        }
        return false
    }

    /// Drop keyboard focus from the dock. The TextField listens for a
    /// bump on this counter and lowers `@FocusState`. Used by the Esc
    /// cascade between "clear target" and "unengage row."
    @Published var blurRequested: Int = 0
    func blur() { blurRequested &+= 1 }

    /// Submit the current buffer through the compose pipeline. No-op on
    /// empty text. Routing default is the assistant (`@scoutbot`); when
    /// a dispatch chip is set, the compose service routes to that target
    /// instead. Local echo into the Assistant thread is owned by
    /// HudComposeService.
    /// Submit a body through the compose pipeline. The caller is expected
    /// to clear the field synchronously before invoking this (see
    /// HudMessageDock.submit) — that keeps the dock empty on the same
    /// runloop tick as the keypress. As a safety net, falls back to
    /// `self.text` if the caller passes nil, and clears it after the
    /// guard so single-call sites still work.
    func send(body: String? = nil) async {
        let source = body ?? text
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if body == nil { text = "" }
        isSending = true
        defer { isSending = false }
        await HudComposeService.shared.send(body: trimmed, targetHandle: targetHandle)
        lastError = HudComposeService.shared.lastError
        if let err = lastError, !err.isEmpty {
            HUDFlashState.shared.flash(err)
        }
    }
}

private extension HUDDockState {
    static let commandCandidates: [HUDDockCommandCandidate] = [
        HUDDockCommandCandidate(
            command: "/help",
            detail: "Show Scoutbot commands",
            replacement: "/help ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/agents",
            detail: "List known agents and endpoints",
            replacement: "/agents ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/status",
            detail: "Summarize active work and online agents",
            replacement: "/status ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/recent",
            detail: "Show recent messages from an agent",
            replacement: "/recent ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/doing",
            detail: "Show active work for an agent",
            replacement: "/doing ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/flight",
            detail: "Inspect a flight by id",
            replacement: "/flight ",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/steer",
            detail: "Target this thread at a session",
            replacement: "/steer sid:",
            action: nil
        ),
        HUDDockCommandCandidate(
            command: "/spin",
            detail: "Open the agent runner",
            replacement: "",
            action: .openRunner
        ),
    ]

    static func detectSuggestionTrigger(in value: String) -> HUDDockSuggestionTrigger? {
        guard !value.isEmpty else { return nil }
        let end = value.endIndex
        var start = end
        while start > value.startIndex {
            let previous = value.index(before: start)
            if value[previous].isWhitespace {
                break
            }
            start = previous
        }

        let token = String(value[start..<end])
        guard !token.isEmpty else { return nil }
        let startOffset = value.distance(from: value.startIndex, to: start)
        let endOffset = value.distance(from: value.startIndex, to: end)

        if token.hasPrefix("/") {
            let query = String(token.dropFirst())
            guard isSimpleQuery(query) else { return nil }
            return HUDDockSuggestionTrigger(
                kind: .command,
                token: token,
                query: query,
                startOffset: startOffset,
                endOffset: endOffset
            )
        }

        if token.hasPrefix("@") {
            let query = String(token.dropFirst())
            guard isHandleQuery(query) else { return nil }
            return HUDDockSuggestionTrigger(
                kind: .agent,
                token: token,
                query: query,
                startOffset: startOffset,
                endOffset: endOffset
            )
        }

        if token.lowercased().hasPrefix("sid:") {
            let query = String(token.dropFirst(4))
            guard isSessionQuery(query) else { return nil }
            return HUDDockSuggestionTrigger(
                kind: .session,
                token: token,
                query: query,
                startOffset: startOffset,
                endOffset: endOffset
            )
        }

        return nil
    }

    static func suggestions(for trigger: HUDDockSuggestionTrigger, agents: [HudAgent]) -> [HUDDockSuggestion] {
        switch trigger.kind {
        case .command:
            return commandSuggestions(query: trigger.query)
        case .agent:
            return agentSuggestions(query: trigger.query, agents: agents)
        case .session:
            return sessionSuggestions(query: trigger.query, agents: agents)
        }
    }

    static func commandSuggestions(query: String) -> [HUDDockSuggestion] {
        let q = query.lowercased()
        return commandCandidates
            .filter { candidate in
                q.isEmpty
                    || candidate.command.dropFirst().lowercased().hasPrefix(q)
                    || candidate.command.lowercased().contains(q)
                    || candidate.detail.lowercased().contains(q)
            }
            .prefix(8)
            .map { candidate in
                HUDDockSuggestion(
                    id: "command:\(candidate.command)",
                    kind: .command,
                    label: candidate.command,
                    detail: candidate.detail,
                    replacement: candidate.replacement,
                    targetHandle: nil,
                    targetLabel: nil,
                    action: candidate.action
                )
            }
    }

    static func agentSuggestions(query: String, agents: [HudAgent]) -> [HUDDockSuggestion] {
        let q = query.lowercased()
        var seen = Set<String>()
        return agents
            .compactMap { agent -> HUDDockSuggestion? in
                guard let handle = suggestionHandle(for: agent) else { return nil }
                let key = handle.lowercased()
                guard !seen.contains(key) else { return nil }
                guard q.isEmpty
                    || handle.lowercased().contains(q)
                    || agent.name.lowercased().contains(q)
                    || agent.id.lowercased().contains(q) else {
                    return nil
                }
                seen.insert(key)
                return HUDDockSuggestion(
                    id: "agent:\(key)",
                    kind: .agent,
                    label: "@\(handle)",
                    detail: agentSuggestionDetail(agent),
                    replacement: "",
                    targetHandle: handle,
                    targetLabel: agent.name,
                    action: nil
                )
            }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            .prefix(7)
            .map { $0 }
    }

    static func sessionSuggestions(query: String, agents: [HudAgent]) -> [HUDDockSuggestion] {
        let q = query.lowercased()
        var seen = Set<String>()
        return agents
            .compactMap { agent -> HUDDockSuggestion? in
                guard let sessionId = agent.harnessSessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !sessionId.isEmpty else {
                    return nil
                }
                let key = sessionId.lowercased()
                guard !seen.contains(key) else { return nil }
                guard q.isEmpty
                    || key.contains(q)
                    || agent.name.lowercased().contains(q)
                    || (agent.handle ?? "").lowercased().contains(q) else {
                    return nil
                }
                seen.insert(key)
                return HUDDockSuggestion(
                    id: "session:\(key)",
                    kind: .session,
                    label: "sid:\(sessionId)",
                    detail: "\(agent.name) · \(agent.state.rawValue)",
                    replacement: "sid:\(sessionId) ",
                    targetHandle: nil,
                    targetLabel: nil,
                    action: nil
                )
            }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            .prefix(7)
            .map { $0 }
    }

    static func suggestionHandle(for agent: HudAgent) -> String? {
        let raw = agent.handle ?? agent.name
        let trimmed = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        return trimmed.isEmpty ? nil : trimmed
    }

    static func agentSuggestionDetail(_ agent: HudAgent) -> String {
        let scope = (agent.projectRoot as NSString?)?.lastPathComponent ?? agent.role
        return "\(agent.name) · \(agent.state.rawValue) · \(scope)"
    }

    static func isSimpleQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_"
        }
    }

    static func isHandleQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch == "."
        }
    }

    static func isSessionQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch == "."
        }
    }

    static func index(in value: String, offset: Int) -> String.Index? {
        guard offset >= 0, offset <= value.count else { return nil }
        return value.index(value.startIndex, offsetBy: offset, limitedBy: value.endIndex)
    }
}
