import Combine
import Foundation
import os.log
import HudsonVoice
import ScoutNativeCore

/// Shared macOS voice service backed by HudsonKit's native `HudDictation`.
///
/// HudsonKit owns capture, permission prompts, Apple Speech partials, and the
/// embeddable Parakeet transcription path. Scout keeps its existing
/// `ScoutDictationState` surface so the HUD and full macOS app can share one
/// small service without each view knowing HudsonKit internals.
@MainActor
public final class ScoutVoiceService: ObservableObject {
    public static let shared = ScoutVoiceService()

    @Published public private(set) var state: ScoutDictationState = .idle
    /// Most recent partial transcript while recording. Cleared on stop.
    @Published public private(set) var partial: String = ""
    /// Most recent final transcript. The dock observes this via Combine
    /// and appends it to the text buffer once it transitions to non-empty.
    @Published public private(set) var lastFinalText: String = ""

    private let dictation = HudDictation()
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice")

    private var syncTask: Task<Void, Never>?
    private var deliveredFinalCount = 0

    private init() {
        dictation.onFinal = { [weak self] text in
            Task { @MainActor [weak self] in
                self?.deliverFinal(text)
            }
        }
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 120_000_000)
                await MainActor.run {
                    self?.syncFromDictation()
                }
            }
        }
        dictation.prepare()
        syncFromDictation()
    }

    // MARK: - Readiness

    /// Warm HudsonKit's preferred model when possible. Capture can still start
    /// while the model warms; HudsonKit falls back to Apple Speech when needed.
    public func probe() async {
        dictation.prepare()
        await dictation.refreshStatus()
        syncFromDictation()
    }

    // MARK: - Session

    public func start() {
        partial = ""
        state = .starting
        log.info("start() — HudsonKit dictation")
        dictation.start()
        syncFromDictation()
    }

    public func stop() {
        guard state == .recording || state == .starting else { return }
        state = .processing
        dictation.stop()
        syncFromDictation()
    }

    public func cancel() {
        dictation.cancel()
        syncFromDictation()
    }

    /// Reset `lastFinalText` after the consumer (the dock) has appended
    /// it to its buffer, so we don't re-fire on the next subscription
    /// or duplicate the transcript across sessions.
    public func consumeFinalText() {
        lastFinalText = ""
    }

    private func syncFromDictation() {
        partial = dictation.partialText
        state = scoutState(for: dictation.state)
        if dictation.finalCount != deliveredFinalCount {
            deliverFinal(dictation.finalText)
        }
    }

    private func deliverFinal(_ text: String) {
        deliveredFinalCount = dictation.finalCount
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        log.info("dictation final len=\(trimmed.count)")
        partial = ""
        state = scoutState(for: dictation.state)
        if !trimmed.isEmpty {
            lastFinalText = text
        }
    }

    private func scoutState(for state: HudDictation.State) -> ScoutDictationState {
        switch state {
        case .idle:
            return .idle
        case .preparing:
            return .idle
        case .listening:
            return .recording
        case .transcribing:
            return .processing
        case .unavailable(let reason):
            return .unavailable(reason: reason)
        }
    }
}

public typealias HudVoiceService = ScoutVoiceService
