import AVFoundation
import Combine
import Foundation
import os.log
import ScoutAppCore

// HUDReplySpeaker — optional spoken agent replies for the HUD.
//
// Observes ScoutComposeService.$assistantThread (the same native scoutbot
// reply stream the dock renders) and, when the gate is ON, speaks each new
// assistant message aloud. It speaks exactly what the HUD shows — no wider
// actor filter, no reformatting of the source thread.
//
// Gated by UserDefaults "scout.voiceRepliesEnabled" (default OFF). On enable
// (and at init) it primes on the current thread so history is never spoken —
// only messages arriving after the gate is on. Message ids are deduped so the
// same reply is never spoken twice, even across gate toggles.
//
// Synthesis path: POST /api/voice/speak → base64 WAV → AVAudioPlayer. When Vox
// is down or the request fails, it falls back to an in-process
// AVSpeechSynthesizer so the toggle is never a lie.
//
// Half-duplex: `stopSpeaking()` is called by HUDDockState.beginHoldToTalk()
// so pressing to talk cuts any in-progress reply playback.
@MainActor
final class HUDReplySpeaker: ObservableObject {
    static let shared = HUDReplySpeaker()

    /// UserDefaults gate. Default OFF. Referenced by the dock's speaker chip
    /// via `HUDReplySpeaker.shared` and read/written here.
    static let voiceRepliesDefaultsKey = "scout.voiceRepliesEnabled"

    /// True while the gate is on. The dock chip reflects this (accent).
    @Published private(set) var enabled: Bool
    /// True while audio (Vox or fallback) is actively playing. The chip
    /// pulses on this.
    @Published private(set) var isSpeaking = false

    private let defaults: UserDefaults
    private let compose: ScoutComposeService
    private let log = Logger(subsystem: "dev.openscout.menu", category: "reply-speaker")

    private var subscription: AnyCancellable?
    /// Every message id we've already spoken (or primed past). Persists across
    /// gate toggles so a reply is never spoken twice.
    private var spokenIds: Set<String> = []

    private var player: AVAudioPlayer?
    private var playerDelegate: PlaybackDelegate?
    private let synth = AVSpeechSynthesizer()
    private var synthDelegate: SynthDelegate?
    private var speakTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard, compose: ScoutComposeService = .shared) {
        self.defaults = defaults
        self.compose = compose
        self.enabled = defaults.bool(forKey: Self.voiceRepliesDefaultsKey)

        // Prime on the current thread so nothing already on screen is spoken.
        primeToLatest(thread: compose.assistantThread)

        subscription = compose.$assistantThread
            .receive(on: RunLoop.main)
            .sink { [weak self] thread in
                self?.handleThread(thread)
            }
    }

    // MARK: - Gate

    func setEnabled(_ on: Bool) {
        guard on != enabled else { return }
        enabled = on
        defaults.set(on, forKey: Self.voiceRepliesDefaultsKey)
        if on {
            // Re-prime so only replies arriving after this moment are spoken.
            primeToLatest(thread: compose.assistantThread)
        } else {
            stopSpeaking()
        }
    }

    func toggle() { setEnabled(!enabled) }

    /// Seed the dedupe set with everything currently in the thread so it's
    /// treated as history — never spoken.
    private func primeToLatest(thread: [ScoutAssistantMessage]) {
        for message in thread {
            spokenIds.insert(message.id)
        }
    }

    // MARK: - Half-duplex

    /// Stop any in-progress playback immediately. Called by
    /// HUDDockState.beginHoldToTalk() so talking cuts the reply.
    func stopSpeaking() {
        speakTask?.cancel()
        speakTask = nil
        player?.stop()
        player = nil
        playerDelegate = nil
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
        }
        isSpeaking = false
    }

    // MARK: - Thread handling

    private func handleThread(_ thread: [ScoutAssistantMessage]) {
        guard enabled else { return }
        let fresh = Self.newMessagesToSpeak(thread: thread, spoken: spokenIds)
        guard !fresh.isEmpty else { return }
        // Mark all fresh ids spoken up front (dedupe), but only voice the
        // latest so a burst doesn't overlap or clip.
        for message in fresh {
            spokenIds.insert(message.id)
        }
        guard let latest = fresh.last else { return }
        speak(message: latest)
    }

    /// Pure: which assistant messages have not yet been spoken. Kept static +
    /// dependency-free so it's trivially testable.
    static func newMessagesToSpeak(
        thread: [ScoutAssistantMessage],
        spoken: Set<String>
    ) -> [ScoutAssistantMessage] {
        thread.filter { $0.source == .scout && !spoken.contains($0.id) }
    }

    private func speak(message: ScoutAssistantMessage) {
        let raw = Self.plainText(from: message.body)
        let spoken = Self.cap(Self.toSpokenText(raw), maxChars: 600)
        guard !spoken.isEmpty else { return }
        speakTask?.cancel()
        speakTask = Task { @MainActor [weak self] in
            await self?.synthesize(spoken)
        }
    }

    private func synthesize(_ text: String) async {
        if let audio = await Self.requestSpeechAudio(text: text), !Task.isCancelled {
            if playAudio(audio) { return }
        }
        guard !Task.isCancelled else { return }
        // Vox unavailable / decode failed — fall back to on-device speech so
        // the toggle is never a lie.
        speakWithSynth(text)
    }

    // MARK: - Playback

    private func playAudio(_ data: Data) -> Bool {
        do {
            let audioPlayer = try AVAudioPlayer(data: data)
            let delegate = PlaybackDelegate { [weak self] in
                Task { @MainActor in self?.isSpeaking = false }
            }
            audioPlayer.delegate = delegate
            playerDelegate = delegate
            player = audioPlayer
            isSpeaking = true
            audioPlayer.play()
            return true
        } catch {
            log.warning("AVAudioPlayer decode failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    private func speakWithSynth(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        let delegate = SynthDelegate { [weak self] in
            Task { @MainActor in self?.isSpeaking = false }
        }
        synthDelegate = delegate
        synth.delegate = delegate
        isSpeaking = true
        synth.speak(utterance)
    }

    private static func requestSpeechAudio(text: String) async -> Data? {
        let url = ScoutWeb.baseURL().appendingPathComponent("api/voice/speak")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode) else {
                return nil
            }
            let decoded = try JSONDecoder().decode(SpeakResponse.self, from: data)
            return Data(base64Encoded: decoded.audioBase64)
        } catch {
            return nil
        }
    }

    private struct SpeakResponse: Decodable {
        let audioBase64: String
        let contentType: String?
    }
}

// MARK: - Pure text helpers (Swift analog of web toSpokenScoutText)

extension HUDReplySpeaker {
    /// Flatten the dock's message spans back to a single string.
    static func plainText(from spans: [ScoutAssistantSpan]) -> String {
        spans.map { span in
            switch span {
            case .text(let value),
                 .mention(let value),
                 .cmd(let value),
                 .path(let value),
                 .code(let value):
                return value
            }
        }.joined()
    }

    /// Flatten markdown for speech: strip code blocks, drop emphasis and
    /// heading markers, reduce links to their visible text, collapse
    /// whitespace. Mirrors packages/web/client/lib/spoken-text.ts intent
    /// (a pragmatic subset — the audible essentials, not the id-spelling).
    static func toSpokenText(_ input: String) -> String {
        var text = input
        func replace(_ pattern: String, _ template: String) {
            text = text.replacingOccurrences(
                of: pattern,
                with: template,
                options: .regularExpression
            )
        }
        // Fenced code blocks → spoken placeholder (mirrors the web helper).
        replace("```[\\s\\S]*?```", " code omitted ")
        // Markdown links [text](url) → text.
        replace("\\[([^\\]]+)\\]\\([^)]*\\)", "$1")
        // Bold, then italic (asterisk + underscore).
        replace("\\*\\*([^*]+)\\*\\*", "$1")
        replace("\\*([^*\\n]+)\\*", "$1")
        replace("(^|\\s)_([^_\\n]+)_(?=\\s|$|[.,!?;:])", "$1$2")
        // Inline code — drop the backticks, keep the words.
        replace("`([^`]+)`", "$1")
        // Heading markers, blockquotes, and list bullets at line starts.
        replace("(?m)^\\s{0,3}#{1,6}\\s+", "")
        replace("(?m)^\\s{0,3}>\\s?", "")
        replace("(?m)^\\s*[-*+]\\s+", "")
        // Bare URLs → a short spoken token.
        replace("https?://[^\\s)]+", "link")
        // Collapse whitespace.
        replace("\\s+", " ")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Cap at ~maxChars, preferring a sentence boundary, then a word
    /// boundary, then a hard cut.
    static func cap(_ text: String, maxChars: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxChars else { return trimmed }
        let slice = String(trimmed.prefix(maxChars))
        if let sentence = slice.range(
            of: "[.!?](?=\\s|$)",
            options: [.regularExpression, .backwards]
        ) {
            return String(slice[..<sentence.upperBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let space = slice.range(of: " ", options: .backwards) {
            return String(slice[..<space.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return slice
    }
}

// MARK: - Delegates

private final class PlaybackDelegate: NSObject, AVAudioPlayerDelegate, @unchecked Sendable {
    private let onFinish: () -> Void
    init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinish()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        onFinish()
    }
}

private final class SynthDelegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let onFinish: () -> Void
    init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onFinish()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        onFinish()
    }
}
