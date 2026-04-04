// DispatchVoice — Voice capture and transcription for the Dispatch composer.
//
// Two modes:
//   FluidAudio present  -> real Parakeet TDT inference (on-device, no network)
//   FluidAudio absent   -> AVAudioRecorder capture + mock transcription text
//
// Uses AVAudioRecorder (not AVAudioEngine) for reliable on-device recording.
// Records to a temp WAV file, then loads samples for transcription.
// Pattern taken from Talkie's battle-tested AudioRecorderManager.

import AVFoundation
import Speech
import os.log

private let log = DispatchLog.voice

// MARK: - FluidAudio Engine (real transcription)

#if canImport(FluidAudio)
import FluidAudio

/// Manages Parakeet model download, load, warmup, and transcription.
@MainActor
final class ParakeetModelManager: ObservableObject {
    static let shared = ParakeetModelManager()

    @Published var state: DispatchVoice.ModelState = .notDownloaded
    @Published var isWarmedUp = false

    private var asrManager: AsrManager?

    var isReady: Bool { state == .ready && isWarmedUp }

    private init() {
        let cached = AsrModels.modelsExist(at: AsrModels.defaultCacheDirectory(for: .v3))
        state = cached ? .downloaded : .notDownloaded
    }

    func downloadAndLoad() async throws {
        state = .downloading(progress: 0)
        log.info("Downloading Parakeet v3 model")

        let models: AsrModels
        let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)

        if AsrModels.modelsExist(at: cacheDir) {
            state = .loading
            models = try await AsrModels.loadFromCache(version: .v3)
        } else {
            state = .downloading(progress: 0.5)
            models = try await AsrModels.downloadAndLoad(version: .v3)
        }

        state = .loading

        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        self.asrManager = manager
        state = .ready
        isWarmedUp = false

        log.info("Parakeet v3 loaded, starting warmup")

        // Warmup on background thread
        let warmupManager = manager
        Task.detached(priority: .userInitiated) {
            let samples = (0..<32000).map { _ in Float.random(in: -0.0001...0.0001) }
            do {
                _ = try await warmupManager.transcribe(samples)
                log.info("Parakeet warmup complete")
            } catch {
                log.warning("Parakeet warmup skipped: \(error.localizedDescription)")
            }
            await MainActor.run { self.isWarmedUp = true }
        }
    }

    /// Transcribe from a file URL (Parakeet can do this directly, no sample loading needed).
    func transcribe(url: URL) async throws -> String {
        guard let manager = asrManager, state == .ready else {
            throw DispatchVoice.VoiceError.notReady
        }
        let result = try await manager.transcribe(url, source: .microphone)
        return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func unload() {
        asrManager = nil
        isWarmedUp = false
        state = .downloaded
        log.info("Parakeet model unloaded")
    }
}
#endif

// MARK: - DispatchVoice

/// Voice capture and transcription engine for the composer.
///
/// Uses AVAudioRecorder to capture audio to a temp PCM file. On stop,
/// the file is loaded and samples are extracted for transcription.
/// When FluidAudio is available, samples go through Parakeet for on-device
/// transcription. Otherwise a mock transcript is returned.
@MainActor
final class DispatchVoice: ObservableObject {

    // MARK: - Types

    enum ModelState: Equatable {
        case notDownloaded
        case downloading(progress: Double)
        case downloaded
        case loading
        case ready
        case error(String)
    }

    enum State: Sendable, Equatable {
        case idle
        case preparing
        case ready
        case recording
        case transcribing
        case error(String)
    }

    enum VoiceError: Error, LocalizedError {
        case notReady
        case notRecording
        case alreadyRecording
        case microphonePermissionDenied
        case audioSessionFailed(String)
        case recordingTooShort
        case recordingFailed(String)

        var errorDescription: String? {
            switch self {
            case .notReady: "Voice engine not ready. Call prepare() first."
            case .notRecording: "No recording in progress."
            case .alreadyRecording: "A recording is already in progress."
            case .microphonePermissionDenied: "Microphone permission denied."
            case .audioSessionFailed(let d): "Audio session failed: \(d)"
            case .recordingTooShort: "Recording too short (minimum 0.3s)."
            case .recordingFailed(let d): "Recording failed: \(d)"
            }
        }
    }

    // MARK: - Published State

    @Published private(set) var state: State = .idle
    @Published private(set) var audioLevels: [Float] = []
    @Published private(set) var recordingDuration: TimeInterval = 0

    // MARK: - Private

    private var audioRecorder: AVAudioRecorder?
    private var recordingStartTime: Date?
    private var durationTimer: Timer?
    private var meteringTimer: Timer?
    private var recordingURL: URL?

    /// Recording is always available — transcription engine loads separately.
    var isReady: Bool { state == .ready }

    /// Temp directory for recording files.
    private var tempRecordingURL: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("dispatch_recording_\(UUID().uuidString).wav")
    }

    // MARK: - Lifecycle

    /// Prepare the voice engine. Recording is available immediately.
    /// Parakeet loads in the background — Apple Speech is used until it's warm.
    func prepare() async {
        // Recording is ready immediately — we only need AVAudioRecorder + Apple Speech.
        // Parakeet model loading is kicked off at app launch (DispatchApp.swift).
        state = .ready
        log.info("DispatchVoice ready (recording + Apple Speech available)")
    }

    // MARK: - Permissions

    func requestMicrophonePermission() async -> Bool {
        await PermissionAuthorizations.requestMicrophone()
    }

    // MARK: - Recording

    func startRecording() async throws {
        // Clean up any stale recording from a previous attempt
        if audioRecorder != nil {
            log.warning("Cleaning up stale recorder before starting new recording")
            cancelRecording()
        }

        let granted = await requestMicrophonePermission()
        guard granted else { throw VoiceError.microphonePermissionDenied }

        // Configure audio session (Talkie pattern: check for external output)
        let session = AVAudioSession.sharedInstance()
        do {
            let hasExternalOutput = session.currentRoute.outputs.contains {
                $0.portType == .bluetoothA2DP || $0.portType == .bluetoothHFP
                    || $0.portType == .headphones || $0.portType == .bluetoothLE
            }
            let options: AVAudioSession.CategoryOptions = hasExternalOutput
                ? [.allowBluetoothA2DP, .allowBluetooth]
                : [.defaultToSpeaker, .allowBluetoothA2DP, .allowBluetooth]

            try session.setCategory(.playAndRecord, mode: .default, options: options)
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)
            log.info("Audio session active (external output: \(hasExternalOutput))")
        } catch {
            throw VoiceError.audioSessionFailed(error.localizedDescription)
        }

        // Record as 16kHz mono PCM — ready for Parakeet without conversion
        let url = tempRecordingURL
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            recorder.prepareToRecord()

            guard recorder.record() else {
                throw VoiceError.recordingFailed("AVAudioRecorder.record() returned false")
            }

            self.audioRecorder = recorder
            self.recordingURL = url
            self.recordingStartTime = Date()
            self.recordingDuration = 0
            self.audioLevels = []
            state = .recording

            log.info("Recording started → \(url.lastPathComponent)")
        } catch let err as VoiceError {
            throw err
        } catch {
            throw VoiceError.recordingFailed(error.localizedDescription)
        }

        // Duration timer (0.1s tick)
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let start = self.recordingStartTime else { return }
                self.recordingDuration = Date().timeIntervalSince(start)
            }
        }

        // Metering timer (~15 Hz for waveform levels)
        meteringTimer = Timer.scheduledTimer(withTimeInterval: 0.066, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let recorder = self.audioRecorder, recorder.isRecording else { return }
                recorder.updateMeters()

                // averagePower is in dB (-160..0). Normalize to 0..1.
                let db = recorder.averagePower(forChannel: 0)
                let minDb: Float = -50
                let normalized = max(0, (db - minDb) / -minDb)
                self.audioLevels.append(normalized)
                if self.audioLevels.count > 100 {
                    self.audioLevels.removeFirst(self.audioLevels.count - 100)
                }
            }
        }
    }

    /// Stop recording and transcribe the captured audio.
    /// Returns the transcribed text.
    func stopAndTranscribe() async throws -> String {
        guard let recorder = audioRecorder, let url = recordingURL else {
            throw VoiceError.notRecording
        }

        let duration = recordingDuration

        // Stop recorder
        recorder.stop()
        self.audioRecorder = nil

        stopTimers()

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        // Minimum recording length check
        if duration < 0.3 {
            state = .ready
            cleanupFile(url)
            throw VoiceError.recordingTooShort
        }

        state = .transcribing
        log.info("Transcribing \(url.lastPathComponent) (\(String(format: "%.1f", duration))s)")

        do {
            let text = try await transcribe(fileURL: url)
            state = .ready
            cleanupFile(url)
            return text
        } catch {
            state = .error(error.localizedDescription)
            cleanupFile(url)
            throw error
        }
    }

    /// Cancel an in-progress recording without transcribing.
    func cancelRecording() {
        audioRecorder?.stop()
        audioRecorder = nil

        stopTimers()

        if let url = recordingURL {
            cleanupFile(url)
        }
        recordingURL = nil
        audioLevels = []
        recordingDuration = 0
        recordingStartTime = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        state = .ready
        log.info("Recording cancelled")
    }

    // MARK: - Sample Loading

    /// Load PCM samples from the recorded WAV file as [Float] at 16kHz mono.
    private func loadSamples(from url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat

        // If file is already 16kHz mono Float32, read directly
        if let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(file.length)
        ) {
            try file.read(into: buffer)

            // Convert Int16 PCM buffer to Float samples
            if let floatData = buffer.floatChannelData {
                return Array(UnsafeBufferPointer(start: floatData[0], count: Int(buffer.frameLength)))
            }

            // If the buffer has int16 data, convert manually
            if let int16Data = buffer.int16ChannelData {
                let count = Int(buffer.frameLength)
                return (0..<count).map { Float(int16Data[0][$0]) / 32768.0 }
            }
        }

        throw VoiceError.recordingFailed("Could not read audio samples from file")
    }

    // MARK: - Helpers

    private func stopTimers() {
        durationTimer?.invalidate()
        durationTimer = nil
        meteringTimer?.invalidate()
        meteringTimer = nil
    }

    private func cleanupFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Transcription

    /// Which engine was used for the last transcription (for debug display).
    @Published private(set) var lastEngine: String = "none"

    private func transcribe(fileURL url: URL) async throws -> String {
        #if canImport(FluidAudio)
        // Prefer Parakeet if model is loaded and warm
        if ParakeetModelManager.shared.isReady {
            log.info("Transcribing with Parakeet (on-device AI)")
            lastEngine = "Parakeet"
            return try await ParakeetModelManager.shared.transcribe(url: url)
        }
        #endif

        // Fallback: Apple Speech (on-device, no download, available immediately)
        log.info("Transcribing with Apple Speech (on-device)")
        lastEngine = "Apple Speech"
        return try await transcribeWithAppleSpeech(url: url)
    }

    /// On-device transcription using SFSpeechRecognizer. No network needed.
    private func transcribeWithAppleSpeech(url: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            throw VoiceError.recordingFailed("Speech recognizer not available")
        }

        // Request speech recognition permission if needed
        let authStatus = SFSpeechRecognizer.authorizationStatus()
        if authStatus == .notDetermined {
            let granted = await PermissionAuthorizations.requestSpeechRecognition()
            guard granted else {
                throw VoiceError.recordingFailed("Speech recognition permission denied")
            }
        } else if authStatus != .authorized {
            throw VoiceError.recordingFailed("Speech recognition not authorized")
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false

        // recognitionTask calls its callback multiple times (partial results,
        // final result, then sometimes a cancellation error). Resuming a checked
        // continuation twice crashes. Guard with hasResumed.
        return try await withCheckedThrowingContinuation { continuation in
            var hasResumed = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !hasResumed else { return }

                if let error {
                    hasResumed = true
                    continuation.resume(throwing: VoiceError.recordingFailed(
                        "Speech recognition failed: \(error.localizedDescription)"
                    ))
                    return
                }
                guard let result, result.isFinal else { return }
                hasResumed = true
                let text = result.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    continuation.resume(throwing: VoiceError.recordingFailed("No speech detected"))
                } else {
                    continuation.resume(returning: text)
                }
            }
        }
    }
}
