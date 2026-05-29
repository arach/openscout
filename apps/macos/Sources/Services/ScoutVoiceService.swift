import AVFoundation
import Combine
import Foundation
import os.log
import ScoutNativeCore
import VoxCore
import VoxEngine

enum ScoutVoiceConfig {
    static let clientId = "openscout-menu"
    static let modelId = "parakeet:v3"
    static let sharedModelCachePath = "~/.vox/cache/models"
}

/// Resident Scout voice service backed by embedded Vox transcription.
///
/// The menu app owns microphone capture and service lifetime. HUD, menu, and
/// future native windows observe this singleton as views over the same resident
/// voice pipeline. Vox supplies the ASR engine, shared model cache, and telemetry
/// format without becoming a separate user-facing app.
@MainActor
final class ScoutVoiceService: NSObject, ObservableObject {
    static let shared = ScoutVoiceService()

    @Published private(set) var state: ScoutDictationState = .probing
    /// Most recent partial transcript while recording. File-based embed mode
    /// does not stream partials yet, so this remains a caret-only live preview.
    @Published private(set) var partial: String = ""
    /// Most recent final transcript. The dock observes this via Combine
    /// and appends it to the text buffer once it transitions to non-empty.
    @Published private(set) var lastFinalText: String = ""

    private let transcriber = EmbeddedVoxTranscriber()
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice")

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var recordingTask: Task<Void, Never>?
    private var residentStarted = false

    private override init() {
        super.init()
    }

    // MARK: - Resident lifecycle

    /// Boot the menu-owned voice service without prompting for microphone access.
    /// The first actual dictation action remains responsible for the permission
    /// prompt so app launch does not surprise the operator.
    func startResident() {
        guard !residentStarted else {
            return
        }
        residentStarted = true
        Task { [weak self] in
            await self?.probe()
        }
    }

    func stopResident() {
        residentStarted = false
        cancel()
    }

    // MARK: - Probe

    /// Check whether embedded transcription is usable. Does not trigger the
    /// microphone permission prompt; that stays tied to the user's record action.
    func probe() async {
        state = .probing

        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            state = .unavailable(reason: "Microphone access is disabled for OpenScout. Enable it in System Settings.")
            return
        case .authorized, .notDetermined:
            break
        @unknown default:
            state = .unavailable(reason: "Microphone access is unavailable on this Mac.")
            return
        }

        if let reason = await transcriber.unavailableReason() {
            state = .unavailable(reason: reason)
            return
        }

        state = .idle
    }

    // MARK: - Live session

    /// Start capturing microphone audio in Scout. The resulting file is handed
    /// to Vox on commit.
    func start() {
        switch state {
        case .recording, .starting, .processing:
            log.info("start() ignored - already \(String(describing: self.state))")
            return
        default:
            break
        }

        partial = ""
        state = .starting
        recordingTask?.cancel()
        recordingTask = Task { [weak self] in
            guard let self else { return }
            await self.beginRecording()
        }
    }

    /// Commit the in-flight recording, transcribe it through embedded Vox, and
    /// surface the final transcript on `lastFinalText`.
    func stop() {
        guard state == .recording || state == .starting else { return }
        guard let recorder, let recordingURL else {
            cancel()
            return
        }

        let duration = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        self.recordingURL = nil
        partial = ""
        state = .processing

        recordingTask?.cancel()
        recordingTask = Task { [weak self] in
            guard let self else { return }
            await self.finishRecording(url: recordingURL, duration: duration)
        }
    }

    /// Abort the in-flight recording without surfacing a transcript.
    /// Safe to call from any state.
    func cancel() {
        recordingTask?.cancel()
        recordingTask = nil

        let url = recordingURL
        recorder?.stop()
        recorder = nil
        recordingURL = nil
        partial = ""
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if case .unavailable = state {
            // Do not clobber a permission or model availability reason.
        } else {
            state = .idle
        }
    }

    /// Reset `lastFinalText` after the consumer (the dock) has appended
    /// it to its buffer, so we don't re-fire on the next subscription
    /// or duplicate the transcript across sessions.
    func consumeFinalText() {
        lastFinalText = ""
    }

    // MARK: - Internals

    private func beginRecording() async {
        do {
            try await ensureMicrophoneAccess()
            if Task.isCancelled { return }

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("openscout-dictation-\(UUID().uuidString)")
                .appendingPathExtension("wav")
            let recorder = try makeRecorder(url: url)
            recorder.delegate = self
            recorder.prepareToRecord()
            guard recorder.record() else {
                throw NSError(domain: "OpenScoutVox", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "Could not start microphone recording."
                ])
            }

            self.recorder = recorder
            self.recordingURL = url
            state = .recording
            log.info("recording started file=\(url.lastPathComponent, privacy: .public)")
        } catch {
            log.error("recording start failed: \(error.localizedDescription, privacy: .public)")
            state = .unavailable(reason: error.localizedDescription)
            recorder = nil
            recordingURL = nil
        }
    }

    private func finishRecording(url: URL, duration: TimeInterval) async {
        defer {
            try? FileManager.default.removeItem(at: url)
        }

        do {
            let output = try await transcriber.transcribe(fileURL: url)
            if Task.isCancelled { return }

            let trimmed = output.text.trimmingCharacters(in: .whitespacesAndNewlines)
            log.info("transcription complete duration=\(duration)s elapsed=\(output.elapsedMs)ms chars=\(trimmed.count)")
            if !trimmed.isEmpty {
                lastFinalText = output.text
            } else {
                log.info("transcription empty - nothing to splice into the dock")
            }
            state = .idle
        } catch {
            if Task.isCancelled { return }
            log.error("transcription failed: \(error.localizedDescription, privacy: .public)")
            state = .unavailable(reason: "OpenScout voice transcription failed: \(error.localizedDescription)")
        }
    }

    private func ensureMicrophoneAccess() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            guard granted else {
                throw NSError(domain: "OpenScoutVox", code: 3, userInfo: [
                    NSLocalizedDescriptionKey: "Microphone access was not granted for OpenScout."
                ])
            }
        case .denied, .restricted:
            throw NSError(domain: "OpenScoutVox", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "Microphone access is disabled for OpenScout. Enable it in System Settings."
            ])
        @unknown default:
            throw NSError(domain: "OpenScoutVox", code: 5, userInfo: [
                NSLocalizedDescriptionKey: "Microphone access is unavailable on this Mac."
            ])
        }
    }

    private func makeRecorder(url: URL) throws -> AVAudioRecorder {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16_000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]
        return try AVAudioRecorder(url: url, settings: settings)
    }
}

extension ScoutVoiceService: AVAudioRecorderDelegate {
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        guard let error else { return }
        Task { @MainActor in
            self.log.error("recorder encode error: \(error.localizedDescription, privacy: .public)")
            self.state = .unavailable(reason: "OpenScout voice recording failed: \(error.localizedDescription)")
            self.recorder = nil
            self.recordingURL = nil
        }
    }
}

actor EmbeddedVoxTranscriber {
    private let clientId = ScoutVoiceConfig.clientId
    private let modelId = ScoutVoiceConfig.modelId
    private let asr = EngineManager()
    private let performance = PerformanceRecorder()

    func unavailableReason() async -> String? {
        let models = await asr.models()
        guard let model = models.first(where: { $0.id == modelId }) else {
            return "OpenScout could not find Vox transcription model \(modelId)."
        }
        guard model.available else {
            return "Vox transcription backend \(model.backend) is unavailable on this Mac."
        }
        return nil
    }

    func transcribe(fileURL: URL) async throws -> TranscriptionOutput {
        do {
            let output = try await asr.transcribe(url: fileURL, modelId: modelId)
            await performance.record(PerformanceSample(
                clientId: clientId,
                route: "transcribe.file",
                modelId: output.modelId,
                outcome: "ok",
                textLength: output.text.count,
                metrics: output.metrics.performanceMetrics
            ))
            return output
        } catch {
            await performance.record(PerformanceSample(
                clientId: clientId,
                route: "transcribe.file",
                modelId: modelId,
                outcome: "error",
                textLength: 0,
                error: error.localizedDescription
            ))
            throw error
        }
    }
}
