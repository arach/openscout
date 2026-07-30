import AVFoundation
import Combine
import Foundation
import os.log
import Speech
import HudsonVoice
import ScoutNativeCore

public enum ScoutVoiceEnginePolicy {
    /// Apple's current stack owns both Apple and Auto on systems that provide
    /// SpeechAnalyzer. Parakeet remains an explicit operator choice.
    public static func usesSpeechAnalyzer(
        preference: HudDictation.Preference,
        speechAnalyzerAvailable: Bool
    ) -> Bool {
        speechAnalyzerAvailable && preference != .parakeet
    }
}

/// Shared macOS dictation service.
///
/// macOS 26+ defaults to Apple's current SpeechAnalyzer/SpeechTranscriber
/// stack. Operators can still explicitly select Parakeet, and macOS 14–15 keep
/// HudsonKit's legacy Apple Speech/Parakeet implementation as a compatibility
/// path. Every composer consumes this one state surface.
@MainActor
public final class ScoutVoiceService: ObservableObject {
    public enum Engine: String, Sendable {
        case speechAnalyzer
        case parakeet
        case appleLegacy
    }

    public static let shared = ScoutVoiceService()

    @Published public private(set) var state: ScoutDictationState = .idle {
        didSet {
            guard state != oldValue else { return }
            armWatchdog(for: state)
        }
    }
    @Published public private(set) var partial: String = ""
    @Published public private(set) var lastFinalText: String = ""
    @Published public private(set) var lastEngine: Engine = .appleLegacy
    @Published private var speechAnalyzerReady = false

    private let dictation = HudDictation()
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice")

    private var selectedPreference: HudDictation.Preference
    private var speechAnalyzerBox: AnyObject?
    private var speechAnalyzerSessionID: UUID?
    private var syncTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var deliveredFinalCount = 0

    private static func watchdogTimeoutNanos(for state: ScoutDictationState) -> UInt64? {
        switch state {
        case .starting: return 12_000_000_000
        case .processing: return 25_000_000_000
        default: return nil
        }
    }

    private func armWatchdog(for state: ScoutDictationState) {
        watchdogTask?.cancel()
        guard let timeout = Self.watchdogTimeoutNanos(for: state) else {
            watchdogTask = nil
            return
        }
        watchdogTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, self.state == state else { return }
                self.log.error("voice \(String(describing: state)) exceeded watchdog — cancelling")
                self.cancel()
            }
        }
    }

    private init() {
        let preference = ScoutVoiceSettingsStore.loadPreference()
        selectedPreference = preference
        dictation.preference = preference
        dictation.onFinal = { [weak self] text in
            Task { @MainActor [weak self] in
                self?.deliverHudsonFinal(text)
            }
        }

        if usesSpeechAnalyzer {
            state = .probing
            Task { [weak self] in await self?.probe() }
        } else {
            dictation.prepare()
            syncFromDictation()
        }
    }

    public var preference: HudDictation.Preference {
        get { selectedPreference }
        set {
            guard newValue != selectedPreference else { return }
            if state.isCaptureActive || state.isProcessing {
                cancel()
            }
            selectedPreference = newValue
            dictation.preference = newValue
            ScoutVoiceSettingsStore.savePreference(newValue)

            if usesSpeechAnalyzer {
                setIfChanged(.probing, to: \.state)
                Task { [weak self] in await self?.probe() }
            } else {
                dictation.prepare()
                syncFromDictation()
            }
        }
    }

    public var modelReady: Bool {
        usesSpeechAnalyzer ? speechAnalyzerReady : dictation.modelReady
    }

    public var modelInstalled: Bool {
        usesSpeechAnalyzer ? speechAnalyzerReady : dictation.modelInstalled
    }

    /// Auto follows the newest Apple stack on macOS 26+. Parakeet is now an
    /// explicit opt-in rather than silently replacing Apple's live transcript.
    public var usesSpeechAnalyzer: Bool {
        let available: Bool
        if #available(macOS 26.0, *) {
            available = true
        } else {
            available = false
        }
        return ScoutVoiceEnginePolicy.usesSpeechAnalyzer(
            preference: selectedPreference,
            speechAnalyzerAvailable: available
        )
    }

    public var usesParakeetBackend: Bool {
        !usesSpeechAnalyzer && selectedPreference != .apple
    }

    public func applySettings(
        preference: HudDictation.Preference?,
        inputDeviceId: String?
    ) {
        if let preference {
            self.preference = preference
        }
        if let inputDeviceId {
            ScoutVoiceSettingsStore.saveInputDeviceId(inputDeviceId.isEmpty ? nil : inputDeviceId)
        }
        if !usesSpeechAnalyzer {
            dictation.prepare()
        }
    }

    // MARK: - Readiness

    public func probe() async {
        refreshPermissionState()
        if usesSpeechAnalyzer {
            setIfChanged(.probing, to: \.state)
            if #available(macOS 26.0, *) {
                do {
                    let engine = speechAnalyzerEngine()
                    try await engine.prepare()
                    setIfChanged(true, to: \.speechAnalyzerReady)
                    setIfChanged(.idle, to: \.state)
                } catch {
                    setIfChanged(false, to: \.speechAnalyzerReady)
                    setIfChanged(.unavailable(reason: error.localizedDescription), to: \.state)
                }
            }
            return
        }

        dictation.prepare()
        await dictation.refreshStatus()
        syncFromDictation()
    }

    public func ensureCaptureAccess() async -> Bool {
        refreshPermissionState()

        let micGranted = await ScoutVoicePermissions.recoverMicrophoneAccess()
        if !micGranted {
            let message = ScoutVoicePermissions.microphoneStatusMessage(
                for: AVCaptureDevice.authorizationStatus(for: .audio)
            )
            setIfChanged(.unavailable(reason: message), to: \.state)
            return false
        }

        // SpeechAnalyzer/SpeechTranscriber runs on-device with system-managed
        // assets. Apple's current sample requests microphone access only; the
        // separate Speech Recognition grant belongs to SFSpeechRecognizer and
        // remains necessary solely for the macOS 14–15 compatibility path.
        if usesSpeechAnalyzer {
            refreshPermissionState()
            return true
        }

        let speechGranted = await ScoutVoicePermissions.ensureSpeechRecognitionAccess()
        if !speechGranted {
            let message = ScoutVoicePermissions.speechRecognitionStatusMessage(
                for: SFSpeechRecognizer.authorizationStatus()
            )
            setIfChanged(.unavailable(reason: message), to: \.state)
            return false
        }
        refreshPermissionState()
        return true
    }

    // MARK: - Session

    public func start(inputDeviceId: String? = nil) {
        let deviceId = inputDeviceId ?? ScoutVoiceSettingsStore.loadInputDeviceId()
        ScoutVoiceInputDeviceRouting.applyPreferredInput(deviceId: deviceId)
        setIfChanged("", to: \.partial)
        setIfChanged(.starting, to: \.state)

        if usesSpeechAnalyzer {
            startSpeechAnalyzerSession()
            return
        }

        log.info("start() — HudsonKit dictation")
        dictation.start()
        startActiveSync()
    }

    public func stop() {
        guard state == .recording || state == .starting else { return }
        setIfChanged(.processing, to: \.state)

        if usesSpeechAnalyzer {
            stopSpeechAnalyzerSession()
            return
        }

        dictation.stop()
        syncFromDictation()
        startActiveSync()
    }

    public func cancel() {
        if usesSpeechAnalyzer {
            speechAnalyzerSessionID = nil
            setIfChanged("", to: \.partial)
            setIfChanged(.idle, to: \.state)
            if #available(macOS 26.0, *),
               let engine = speechAnalyzerBox as? ScoutSpeechAnalyzerDictation {
                // Detach first so a fast restart cannot reuse an engine whose
                // asynchronous cancellation is still draining.
                speechAnalyzerBox = nil
                Task { await engine.cancel() }
            }
            return
        }

        dictation.cancel()
        syncFromDictation()
    }

    public func consumeFinalText() {
        setIfChanged("", to: \.lastFinalText)
    }

    private func startSpeechAnalyzerSession() {
        guard #available(macOS 26.0, *) else { return }
        let sessionID = UUID()
        speechAnalyzerSessionID = sessionID
        let engine = speechAnalyzerEngine()
        log.info("start() — Apple SpeechAnalyzer")

        Task { [weak self] in
            guard let self else { return }
            do {
                try await engine.start { [weak self] text in
                    guard let self, self.speechAnalyzerSessionID == sessionID else { return }
                    self.setIfChanged(text, to: \.partial)
                }
                guard self.speechAnalyzerSessionID == sessionID else {
                    await engine.cancel()
                    return
                }
                self.setIfChanged(.recording, to: \.state)
            } catch {
                guard self.speechAnalyzerSessionID == sessionID else { return }
                self.speechAnalyzerSessionID = nil
                self.speechAnalyzerBox = nil
                await engine.cancel()
                self.setIfChanged(.unavailable(reason: error.localizedDescription), to: \.state)
            }
        }
    }

    private func stopSpeechAnalyzerSession() {
        guard #available(macOS 26.0, *),
              let sessionID = speechAnalyzerSessionID else {
            setIfChanged(.idle, to: \.state)
            return
        }
        let engine = speechAnalyzerEngine()
        Task { [weak self] in
            guard let self else { return }
            do {
                let text = try await engine.stop()
                guard self.speechAnalyzerSessionID == sessionID else { return }
                self.speechAnalyzerSessionID = nil
                self.setIfChanged("", to: \.partial)
                self.setIfChanged(.idle, to: \.state)
                self.publishFinal(text, engine: .speechAnalyzer)
            } catch {
                guard self.speechAnalyzerSessionID == sessionID else { return }
                self.speechAnalyzerSessionID = nil
                self.speechAnalyzerBox = nil
                await engine.cancel()
                self.setIfChanged(.unavailable(reason: error.localizedDescription), to: \.state)
            }
        }
    }

    private func syncFromDictation() {
        setIfChanged(dictation.partialText, to: \.partial)
        setIfChanged(scoutState(for: dictation.state), to: \.state)
        if dictation.finalCount != deliveredFinalCount {
            deliverHudsonFinal(dictation.finalText)
        }
    }

    private func deliverHudsonFinal(_ text: String) {
        deliveredFinalCount = dictation.finalCount
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        log.info("dictation final len=\(trimmed.count)")
        setIfChanged("", to: \.partial)
        setIfChanged(scoutState(for: dictation.state), to: \.state)
        let engine: Engine = dictation.lastEngine == .parakeet ? .parakeet : .appleLegacy
        publishFinal(text, engine: engine)
    }

    private func publishFinal(_ text: String, engine: Engine) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        setIfChanged(engine, to: \.lastEngine)
        setIfChanged(text, to: \.lastFinalText)
    }

    @available(macOS 26.0, *)
    private func speechAnalyzerEngine() -> ScoutSpeechAnalyzerDictation {
        if let engine = speechAnalyzerBox as? ScoutSpeechAnalyzerDictation {
            return engine
        }
        let engine = ScoutSpeechAnalyzerDictation()
        speechAnalyzerBox = engine
        return engine
    }

    private func startActiveSync() {
        if syncTask != nil { return }
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 120_000_000)
                guard !Task.isCancelled else { break }
                let shouldContinue = await MainActor.run { [weak self] in
                    guard let self else { return false }
                    self.syncFromDictation()
                    return self.shouldContinueSyncing
                }
                if !shouldContinue { break }
            }
            await MainActor.run { [weak self] in
                self?.syncTask = nil
            }
        }
    }

    private var shouldContinueSyncing: Bool {
        if state.isCaptureActive || state.isProcessing { return true }
        switch dictation.state {
        case .listening, .transcribing:
            return true
        case .idle, .preparing, .unavailable:
            return false
        }
    }

    private func setIfChanged<T: Equatable>(
        _ value: T,
        to keyPath: ReferenceWritableKeyPath<ScoutVoiceService, T>
    ) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    private func refreshPermissionState() {
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        switch micStatus {
        case .authorized:
            if case .unavailable = state {
                setIfChanged(.idle, to: \.state)
            }
        case .denied, .restricted:
            setIfChanged(
                .unavailable(reason: ScoutVoicePermissions.microphoneStatusMessage(for: micStatus)),
                to: \.state
            )
        case .notDetermined:
            break
        @unknown default:
            break
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
