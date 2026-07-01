import AVFoundation
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
        dictation.preference = ScoutVoiceSettingsStore.loadPreference()
        dictation.onFinal = { [weak self] text in
            Task { @MainActor [weak self] in
                self?.deliverFinal(text)
            }
        }
        dictation.prepare()
        syncFromDictation()
    }

    public var preference: HudDictation.Preference {
        get { dictation.preference }
        set {
            dictation.preference = newValue
            ScoutVoiceSettingsStore.savePreference(newValue)
            if newValue == .apple {
                dictation.prepare()
            }
        }
    }

    public var modelReady: Bool { dictation.modelReady }
    public var modelInstalled: Bool { dictation.modelInstalled }
    public var lastEngine: HudDictation.Engine { dictation.lastEngine }

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
        dictation.prepare()
    }

    // MARK: - Readiness

    /// Warm HudsonKit's preferred model when possible. Capture can still start
    /// while the model warms; HudsonKit falls back to Apple Speech when needed.
    public func probe() async {
        refreshPermissionState()
        dictation.prepare()
        await dictation.refreshStatus()
        syncFromDictation()
    }

    /// Requests macOS microphone access when needed. HudsonKit skips this on macOS,
    /// so Scout must prompt before capture begins.
    public func ensureCaptureAccess() async -> Bool {
        refreshPermissionState()

        let micGranted = await ScoutVoicePermissions.ensureMicrophoneAccess()
        if !micGranted {
            let message = ScoutVoicePermissions.microphoneStatusMessage(
                for: AVCaptureDevice.authorizationStatus(for: .audio)
            )
            setIfChanged(.unavailable(reason: message), to: \.state)
            return false
        }

        _ = await ScoutVoicePermissions.ensureSpeechRecognitionAccess()
        refreshPermissionState()
        return true
    }

    // MARK: - Session

    public func start(inputDeviceId: String? = nil) {
        let deviceId = inputDeviceId ?? ScoutVoiceSettingsStore.loadInputDeviceId()
        ScoutVoiceInputDeviceRouting.applyPreferredInput(deviceId: deviceId)
        setIfChanged("", to: \.partial)
        setIfChanged(.starting, to: \.state)
        log.info("start() — HudsonKit dictation")
        dictation.start()
        startActiveSync()
    }

    public func stop() {
        guard state == .recording || state == .starting else { return }
        setIfChanged(.processing, to: \.state)
        dictation.stop()
        syncFromDictation()
        startActiveSync()
    }

    public func cancel() {
        dictation.cancel()
        syncFromDictation()
    }

    /// Reset `lastFinalText` after the consumer (the dock) has appended
    /// it to its buffer, so we don't re-fire on the next subscription
    /// or duplicate the transcript across sessions.
    public func consumeFinalText() {
        setIfChanged("", to: \.lastFinalText)
    }

    private func syncFromDictation() {
        setIfChanged(dictation.partialText, to: \.partial)
        setIfChanged(scoutState(for: dictation.state), to: \.state)
        if dictation.finalCount != deliveredFinalCount {
            deliverFinal(dictation.finalText)
        }
    }

    private func deliverFinal(_ text: String) {
        deliveredFinalCount = dictation.finalCount
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        log.info("dictation final len=\(trimmed.count)")
        setIfChanged("", to: \.partial)
        setIfChanged(scoutState(for: dictation.state), to: \.state)
        if !trimmed.isEmpty {
            setIfChanged(text, to: \.lastFinalText)
        }
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

    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutVoiceService, T>) {
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
