import Combine
import Foundation
import os.log
import ScoutAppCore
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI

typealias HUDDockSuggestionKind = MessageSuggestionKind
typealias HUDDockSuggestionAction = MessageSuggestionAction
typealias HUDDockSuggestion = MessageSuggestion
private typealias HUDDockSuggestionTrigger = MessageSuggestionTrigger
private typealias HUDDockCommandCandidate = MessageCommandCandidate

/// Owns the universal message dock's editable state — the text buffer,
/// the routing target (an agent handle or nil = default channel), and
/// the focus signal. The dock itself binds to this; views fire actions
/// (engage SEND, row Enter, etc.) into it.
///
/// Sending happens through `ScoutComposeService`, which posts to the web
/// surface's `/api/send` endpoint. The broker parses `@-mentions` in
/// the body, so when a target is set we prepend `@<handle> ` to the
/// outgoing body and clear the chip after submit.
@MainActor
public final class HUDDockState: ObservableObject {
    public static let shared = HUDDockState()

    @Published var text: String = ""
    @Published var targetHandle: String? = nil   // "@hudson" (display + routing)
    @Published var targetLabel: String? = nil    // "Hudson"  (visible chip text)
    @Published var focusRequested: Int = 0       // bump → dock takes firstResponder
    @Published var lastError: String? = nil
    @Published var isSending: Bool = false
    @Published private(set) var suggestions: [HUDDockSuggestion] = []
    @Published private(set) var selectedSuggestionIndex: Int = 0

    /// True between `beginHoldToTalk()` and the moment the hold either sends,
    /// is cancelled, or times out. While armed, an incoming final transcript
    /// is auto-sent to the target instead of splicing into the buffer.
    @Published private(set) var voiceSendArmed: Bool = false
    private var holdToTalkTimeout: Task<Void, Never>?
    /// Owner of the current hold. Begin hands it out; only the matching end/
    /// cancel acts on it (nil cancel = force). Guards concurrent hold sources.
    private var holdToken: UUID?

    private var voiceSubscription: AnyCancellable?
    private var suggestionAgents: [HudAgent] = []
    private var currentSuggestionTrigger: HUDDockSuggestionTrigger?
    private var dismissedSuggestionSignature: String?
    private let log = Logger(subsystem: "dev.openscout.menu", category: "dock")
    public var shouldDeferDictationAppend: () -> Bool = { false }

    var suggestionsVisible: Bool {
        !suggestions.isEmpty
    }

    private init() {
        // Watch the shared voice service for finalized transcripts and splice them
        // into the text buffer. The service exposes `lastFinalText` as a
        // one-shot signal; we drain it via consumeFinalText() so the
        // same transcript isn't re-appended on subsequent state pushes.
        voiceSubscription = HudVoiceService.shared.$lastFinalText
            .receive(on: RunLoop.main)
            .sink { [weak self] text in
                guard let self else { return }
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                self.log.info("voice final received — len=\(trimmed.count)")
                guard !trimmed.isEmpty else { return }
                // Hold-to-talk owns the transcript when armed: auto-send it to
                // the target (or splice if no target) rather than editing.
                if self.voiceSendArmed {
                    self.completeHoldToTalk(with: trimmed)
                    return
                }
                if self.shouldDeferDictationAppend() {
                    // Another foreground surface owns dictation; its own
                    // subscription splices the transcript and drains it.
                    return
                }
                if HUDRunnerState.shared.isPresented {
                    HUDRunnerState.shared.appendDictatedText(trimmed)
                    HudVoiceService.shared.consumeFinalText()
                    return
                }
                self.appendDictatedText(trimmed)
                HudVoiceService.shared.consumeFinalText()
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

    /// Mic-tap action. Warms HudsonKit voice if needed,
    /// otherwise toggles recording on/off. Errors surface as state on
    /// HudVoiceService.shared; the dock view reads them for tooltip copy.
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
            // already finalizing — ignore the second tap
            return
        }
    }

    // MARK: - Hold to talk (push-to-talk)

    /// The three ways an armed hold's final transcript can resolve.
    enum HoldToTalkOutcome: Equatable {
        case sendToTarget(String)      // trimmed body → send to the target chip
        case spliceIntoBuffer(String)  // no target → edit-first fallback
        case ignore                    // empty / not armed
    }

    /// Pure decision: given a final transcript, whether the dock is armed, and
    /// whether a target chip is set, what should happen. Kept static + pure so
    /// it's trivially testable.
    static func holdToTalkOutcome(
        finalText: String,
        armed: Bool,
        hasTarget: Bool
    ) -> HoldToTalkOutcome {
        let trimmed = finalText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard armed, !trimmed.isEmpty else { return .ignore }
        return hasTarget ? .sendToTarget(trimmed) : .spliceIntoBuffer(trimmed)
    }

    /// Enter push-to-talk. Cuts any in-progress reply playback (half-duplex),
    /// arms the dock so the next final transcript is auto-sent, and warms the
    /// mic through the existing capture-access path.
    ///
    /// Returns an ownership token, or nil when another source already holds —
    /// only the owner's `endHoldToTalk`/`cancelHoldToTalk` acts, so a mouse
    /// hold and an m-key hold can't stop each other's capture mid-press.
    @discardableResult
    func beginHoldToTalk() -> UUID? {
        guard !voiceSendArmed else { return nil }
        HUDReplySpeaker.shared.stopSpeaking()
        let token = UUID()
        holdToken = token
        voiceSendArmed = true
        Task { @MainActor in
            let voice = HudVoiceService.shared
            let began = Date()
            let granted = await voice.ensureCaptureAccess()
            guard voiceSendArmed, holdToken == token else { return }   // cancelled while prompting
            guard granted else {
                disarmHold()
                return
            }
            // A slow grant means a permission prompt (or similar) interposed —
            // the physical hold has almost certainly been released without us
            // ever seeing the up event. Don't start a mic nobody is holding.
            if Date().timeIntervalSince(began) > 1.0 {
                cancelHoldToTalk()
                return
            }
            switch voice.state {
            case .idle:
                voice.start()
            case .probing, .unavailable:
                await voice.probe()
                if voiceSendArmed, holdToken == token, case .idle = voice.state {
                    voice.start()
                }
            case .starting, .recording, .processing:
                break   // already hot
            }
        }
        return token
    }

    /// Release push-to-talk. Stops the mic; the resulting final transcript is
    /// picked up by the `$lastFinalText` sink and sent (see completeHoldToTalk).
    /// A safety-net timeout disarms if no final ever arrives so a later
    /// tap-dictation isn't hijacked into an auto-send. (A final that lands
    /// after the timeout splices into the draft — visible and recoverable —
    /// rather than being dropped or sent unexpectedly.)
    func endHoldToTalk(token: UUID) {
        guard voiceSendArmed, token == holdToken else { return }
        let voice = HudVoiceService.shared
        if voice.state == .recording || voice.state == .starting {
            voice.stop()
        } else {
            // Never got hot (permission denied / still probing) — nothing to send.
            disarmHold()
            return
        }
        holdToTalkTimeout?.cancel()
        holdToTalkTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, self.voiceSendArmed else { return }
            self.disarmHold()
        }
    }

    /// Cancel an armed hold: stop the mic, discard the pending transcript,
    /// disarm, send nothing. Pass the owner token from a specific source;
    /// pass nil to force-cancel regardless of owner (Esc, HUD dismissal).
    func cancelHoldToTalk(token: UUID? = nil) {
        guard voiceSendArmed else { return }
        if let token, token != holdToken { return }
        holdToTalkTimeout?.cancel()
        holdToTalkTimeout = nil
        disarmHold()
        let voice = HudVoiceService.shared
        if voice.state == .recording || voice.state == .starting || voice.state == .processing {
            voice.cancel()
        }
        HudVoiceService.shared.consumeFinalText()
    }

    private func disarmHold() {
        voiceSendArmed = false
        holdToken = nil
    }

    /// Resolve an armed hold once its final transcript arrives.
    private func completeHoldToTalk(with trimmed: String) {
        holdToTalkTimeout?.cancel()
        holdToTalkTimeout = nil
        // Snapshot the target now so the flash and the actual wire send can't
        // diverge if the target chip changes before the async send runs.
        let resolvedTarget = targetHandle
        let outcome = Self.holdToTalkOutcome(
            finalText: trimmed,
            armed: true,
            hasTarget: resolvedTarget != nil
        )
        disarmHold()
        HudVoiceService.shared.consumeFinalText()
        switch outcome {
        case .sendToTarget(let body):
            let label = resolvedTarget ?? targetLabel ?? "target"
            HUDFlashState.shared.flash("sent → \(label)", kind: .success, duration: 1.6)
            Task { await self.send(body: body, resolvedTarget: resolvedTarget) }
        case .spliceIntoBuffer(let phrase):
            appendDictatedText(phrase)
        case .ignore:
            break
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
        if let target = Self.normalizedTargetHandle(handle) {
            targetHandle = target
            targetLabel = label ?? target
        } else {
            targetHandle = nil
            targetLabel = nil
        }
    }

    // MARK: - Suggestions

    func setSuggestionAgents(_ agents: [HudAgent]) {
        suggestionAgents = agents
        refreshSuggestions()
    }

    func refreshSuggestions() {
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

        let next = Self.suggestions(for: trigger, agents: suggestionAgents)
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
        // A hold-to-talk in progress cancels cleanly — stop the mic, discard
        // the pending transcript, disarm, send nothing.
        if voiceSendArmed {
            cancelHoldToTalk()
            return true
        }
        // Dictation in progress trumps everything — operator pressing ESC
        // while the mic is hot expects the recording to stop, not their
        // composed text to vanish.
        let voice = HudVoiceService.shared
        if voice.state == .recording || voice.state == .starting {
            voice.cancel()
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
    /// ScoutComposeService.
    /// Submit a body through the compose pipeline. The caller is expected
    /// to clear the field synchronously before invoking this (see
    /// HudMessageDock.submit) — that keeps the dock empty on the same
    /// runloop tick as the keypress. As a safety net, falls back to
    /// `self.text` if the caller passes nil, and clears it after the
    /// guard so single-call sites still work.
    func send(body: String? = nil) async {
        await send(body: body, resolvedTarget: targetHandle)
    }

    /// Variant that takes the target explicitly — the voice hold snapshots it
    /// at completion so a target change during the async hop can't reroute a
    /// message the flash already attributed.
    func send(body: String?, resolvedTarget: String?) async {
        let source = body ?? text
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if body == nil { text = "" }
        isSending = true
        defer { isSending = false }
        await ScoutComposeService.shared.send(body: trimmed, targetHandle: resolvedTarget)
        lastError = ScoutComposeService.shared.lastError
        if let err = lastError, !err.isEmpty {
            HUDFlashState.shared.flash(err)
        }
    }
}

private extension HUDDockState {
    static func normalizedTargetHandle(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let bare = trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
        if let route = ScoutComposeRouting.normalizeHandle(bare),
           ScoutComposeRouting.isRouteDirectiveTarget(route) {
            return route
        }
        return trimmed.hasPrefix("@") ? trimmed : "@\(trimmed)"
    }

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
            replacement: "/steer session:",
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
        MessageSuggestionEngine.detectTrigger(in: value)
    }

    static func suggestions(for trigger: HUDDockSuggestionTrigger, agents: [HudAgent]) -> [HUDDockSuggestion] {
        MessageSuggestionEngine.suggestions(
            for: trigger,
            agents: agents.map(MessageSuggestionAgent.init),
            commands: commandCandidates
        )
    }

    static func index(in value: String, offset: Int) -> String.Index? {
        MessageSuggestionEngine.index(in: value, offset: offset)
    }
}

private extension MessageSuggestionAgent {
    init(_ agent: HudAgent) {
        self.init(
            id: agent.id,
            name: agent.name,
            handle: agent.handle,
            state: agent.state.rawValue,
            role: agent.role,
            workspaceRoot: agent.projectRoot,
            harnessSessionId: agent.harnessSessionId
        )
    }
}
