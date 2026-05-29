import AVFoundation
import AppKit
import Combine
import Foundation
import os.log
import ScoutNativeCore
import VoxCore
import VoxEngine

enum ScoutVoiceConfig {
    static let clientId = "openscout-menu"
    static let modelId = "parakeet:v3"

    static var sharedModelCacheURL: URL {
        RuntimePaths.voxHomeURL()
            .appendingPathComponent("cache", isDirectory: true)
            .appendingPathComponent("models", isDirectory: true)
    }

    static var sharedModelCachePath: String {
        sharedModelCacheURL.path
    }

    static var recordingsDirectoryURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".scout", isDirectory: true)
            .appendingPathComponent("voice", isDirectory: true)
            .appendingPathComponent("recordings", isDirectory: true)
    }

    static var recordingsDirectoryPath: String {
        recordingsDirectoryURL.path
    }
}

struct ScoutVoiceInputDevice: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let isSystemDefault: Bool

    var displayName: String {
        isSystemDefault ? "\(name) (System Default)" : name
    }
}

struct ScoutVoiceExternalRuntime: Equatable, Sendable {
    let voxAppPIDs: [String]
    let voxdPIDs: [String]
    let loadedLaunchdLabels: [String]

    static let checking = ScoutVoiceExternalRuntime(
        voxAppPIDs: [],
        voxdPIDs: [],
        loadedLaunchdLabels: []
    )

    var isClean: Bool {
        voxAppPIDs.isEmpty && voxdPIDs.isEmpty && loadedLaunchdLabels.isEmpty
    }

    var summary: String {
        if isClean {
            return "None detected"
        }
        var parts: [String] = []
        if !voxAppPIDs.isEmpty {
            parts.append("Vox.app pid \(voxAppPIDs.joined(separator: ","))")
        }
        if !voxdPIDs.isEmpty {
            parts.append("voxd pid \(voxdPIDs.joined(separator: ","))")
        }
        if !loadedLaunchdLabels.isEmpty {
            parts.append("launchd \(loadedLaunchdLabels.joined(separator: ", "))")
        }
        return parts.joined(separator: " · ")
    }

    var detail: String {
        if isClean {
            return "No external Vox app, voxd process, or Vox launchd job is loaded. Scout voice is flying solo."
        }
        return "External Vox runtime is still present: \(summary). Stop it to keep Scout Menu as the sole voice owner."
    }
}

struct ScoutVoiceDiagnostics: Equatable, Sendable {
    var microphonePermissionStatus: String = "unknown"
    var inputDevices: [ScoutVoiceInputDevice] = []
    var selectedInputDeviceId: String = ""
    var effectiveInputDeviceName: String = "System Default"
    var modelCachePath: String = ScoutVoiceConfig.sharedModelCachePath
    var modelCacheExists: Bool = false
    var recordingsPath: String = ScoutVoiceConfig.recordingsDirectoryPath
    var recordingsCount: Int = 0
    var lastRecordingPath: String? = nil
    var externalRuntime: ScoutVoiceExternalRuntime = .checking

    var permissionLabel: String {
        switch microphonePermissionStatus {
        case "authorized":     return "Authorized"
        case "not_determined": return "Not requested"
        case "denied":         return "Denied"
        case "restricted":     return "Restricted"
        default:               return "Unknown"
        }
    }

    var modelCacheLabel: String {
        modelCacheExists ? "Present" : "Missing"
    }
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
    @Published private(set) var selectedInputDeviceId: String = UserDefaults.standard.string(
        forKey: "OpenScoutVoiceInputDeviceID"
    ) ?? ""
    @Published private(set) var lastRecordingURL: URL?
    @Published private(set) var diagnostics = ScoutVoiceDiagnostics()

    private let transcriber = EmbeddedVoxTranscriber()
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice")

    private var captureSession: AVCaptureSession?
    private var captureOutput: AVCaptureAudioFileOutput?
    private var recordingDelegate: ScoutVoiceRecordingDelegate?
    private var recordingURL: URL?
    private var recordingStartedAt: Date?
    private var recordingTask: Task<Void, Never>?
    private var residentStarted = false
    private var externalRuntime = ScoutVoiceExternalRuntime.checking

    private override init() {
        super.init()
        refreshDiagnostics()
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
        refreshDiagnostics()
        Task { [weak self] in
            await self?.probe()
        }
    }

    func stopResident() {
        residentStarted = false
        cancel()
        refreshDiagnostics()
    }

    func refreshDiagnostics() {
        diagnostics = makeDiagnostics(externalRuntime: externalRuntime)
        Task { [weak self] in
            let runtime = await Self.detectExternalRuntime()
            await MainActor.run {
                guard let self else { return }
                self.externalRuntime = runtime
                self.diagnostics = self.makeDiagnostics(externalRuntime: runtime)
            }
        }
    }

    func updateSelectedInputDevice(id: String) {
        let normalized = id.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedInputDeviceId = normalized
        UserDefaults.standard.set(normalized, forKey: "OpenScoutVoiceInputDeviceID")
        refreshDiagnostics()
    }

    func requestMicrophonePermission() async {
        _ = await AVCaptureDevice.requestAccess(for: .audio)
        refreshDiagnostics()
    }

    func openMicrophonePrivacySettings() {
        let settingsURLs = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "x-apple.systempreferences:com.apple.preference.security"
        ]
        for rawURL in settingsURLs {
            guard let url = URL(string: rawURL), NSWorkspace.shared.open(url) else {
                continue
            }
            return
        }
    }

    func openRecordingsDirectory() {
        let url = ScoutVoiceConfig.recordingsDirectoryURL
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
        refreshDiagnostics()
    }

    func revealLastRecording() {
        guard let lastRecordingURL else {
            openRecordingsDirectory()
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([lastRecordingURL])
    }

    // MARK: - Probe

    /// Check whether embedded transcription is usable. Does not trigger the
    /// microphone permission prompt; that stays tied to the user's record action.
    func probe() async {
        state = .probing

        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            state = .unavailable(reason: "Microphone access is disabled for OpenScout. Enable it in System Settings.")
            refreshDiagnostics()
            return
        case .authorized, .notDetermined:
            break
        @unknown default:
            state = .unavailable(reason: "Microphone access is unavailable on this Mac.")
            refreshDiagnostics()
            return
        }

        if let reason = await transcriber.unavailableReason() {
            state = .unavailable(reason: reason)
            refreshDiagnostics()
            return
        }

        state = .idle
        refreshDiagnostics()
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
        guard let session = captureSession,
              let output = captureOutput,
              let delegate = recordingDelegate
        else {
            cancel()
            return
        }

        let startedAt = recordingStartedAt ?? Date()
        output.stopRecording()
        self.captureSession = nil
        self.captureOutput = nil
        self.recordingDelegate = nil
        self.recordingURL = nil
        self.recordingStartedAt = nil
        partial = ""
        state = .processing
        refreshDiagnostics()

        recordingTask = Task { [weak self] in
            guard let self else { return }
            do {
                let finishedURL = try await delegate.waitForFinish()
                session.stopRunning()
                await self.finishRecording(url: finishedURL, duration: Date().timeIntervalSince(startedAt))
            } catch {
                session.stopRunning()
                if Task.isCancelled { return }
                self.log.error("recording stop failed: \(error.localizedDescription, privacy: .public)")
                self.state = .unavailable(reason: "OpenScout voice recording failed: \(error.localizedDescription)")
                self.refreshDiagnostics()
            }
        }
    }

    /// Abort the in-flight recording without surfacing a transcript.
    /// Safe to call from any state.
    func cancel() {
        recordingTask?.cancel()
        recordingTask = nil

        let url = recordingURL
        captureOutput?.stopRecording()
        captureSession?.stopRunning()
        captureSession = nil
        captureOutput = nil
        recordingDelegate = nil
        recordingURL = nil
        recordingStartedAt = nil
        partial = ""
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if case .unavailable = state {
            // Do not clobber a permission or model availability reason.
        } else {
            state = .idle
        }
        refreshDiagnostics()
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

            let device = try resolveInputDevice()
            let input = try AVCaptureDeviceInput(device: device)
            let output = AVCaptureAudioFileOutput()
            let session = AVCaptureSession()

            session.beginConfiguration()
            guard session.canAddInput(input) else {
                session.commitConfiguration()
                throw NSError(domain: "OpenScoutVox", code: 6, userInfo: [
                    NSLocalizedDescriptionKey: "Unable to use input device \(device.localizedName)."
                ])
            }
            session.addInput(input)

            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                throw NSError(domain: "OpenScoutVox", code: 7, userInfo: [
                    NSLocalizedDescriptionKey: "Unable to create microphone recording output."
                ])
            }
            session.addOutput(output)
            session.commitConfiguration()

            let recordingsDirectory = ScoutVoiceConfig.recordingsDirectoryURL
            try FileManager.default.createDirectory(at: recordingsDirectory, withIntermediateDirectories: true)
            let fileType = preferredOutputFileType(for: output)
            let url = recordingsDirectory
                .appendingPathComponent(recordingFileStem())
                .appendingPathExtension(fileExtension(for: fileType))
            let delegate = ScoutVoiceRecordingDelegate()

            session.startRunning()
            output.startRecording(to: url, outputFileType: fileType, recordingDelegate: delegate)

            self.captureSession = session
            self.captureOutput = output
            self.recordingDelegate = delegate
            self.recordingURL = url
            self.recordingStartedAt = Date()
            state = .recording
            refreshDiagnostics()
            log.info("recording started input=\(device.localizedName, privacy: .public) file=\(url.lastPathComponent, privacy: .public)")
        } catch {
            log.error("recording start failed: \(error.localizedDescription, privacy: .public)")
            state = .unavailable(reason: error.localizedDescription)
            captureSession?.stopRunning()
            captureSession = nil
            captureOutput = nil
            recordingDelegate = nil
            recordingURL = nil
            recordingStartedAt = nil
            refreshDiagnostics()
        }
    }

    private func finishRecording(url: URL, duration: TimeInterval) async {
        do {
            let output = try await transcriber.transcribe(fileURL: url)
            if Task.isCancelled { return }

            let trimmed = output.text.trimmingCharacters(in: .whitespacesAndNewlines)
            log.info("transcription complete duration=\(duration)s elapsed=\(output.elapsedMs)ms chars=\(trimmed.count)")
            lastRecordingURL = url
            if !trimmed.isEmpty {
                lastFinalText = output.text
            } else {
                log.info("transcription empty - nothing to splice into the dock")
            }
            state = .idle
            refreshDiagnostics()
        } catch {
            if Task.isCancelled { return }
            log.error("transcription failed: \(error.localizedDescription, privacy: .public)")
            state = .unavailable(reason: "OpenScout voice transcription failed: \(error.localizedDescription)")
            refreshDiagnostics()
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

    private func resolveInputDevice() throws -> AVCaptureDevice {
        let devices = audioInputDevices()
        let preferredID = selectedInputDeviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !preferredID.isEmpty, let device = devices.first(where: { $0.uniqueID == preferredID }) {
            return device
        }
        if let device = AVCaptureDevice.default(for: .audio) ?? devices.first {
            return device
        }
        throw NSError(domain: "OpenScoutVox", code: 8, userInfo: [
            NSLocalizedDescriptionKey: "No microphone input device is available."
        ])
    }

    private func audioInputDevices() -> [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone],
            mediaType: .audio,
            position: .unspecified
        ).devices
    }

    private func preferredOutputFileType(for output: AVCaptureAudioFileOutput) -> AVFileType {
        let fileTypes = AVCaptureAudioFileOutput.availableOutputFileTypes()
        if fileTypes.contains(.wav) {
            return .wav
        }
        if fileTypes.contains(.m4a) {
            return .m4a
        }
        if fileTypes.contains(.aiff) {
            return .aiff
        }
        return fileTypes.first ?? .wav
    }

    private func fileExtension(for fileType: AVFileType) -> String {
        switch fileType {
        case .wav:  return "wav"
        case .m4a:  return "m4a"
        case .aiff: return "aiff"
        default:    return "caf"
        }
    }

    private func recordingFileStem() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timestamp = formatter.string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: ".", with: "-")
        return "openscout-dictation-\(timestamp)"
    }

    private func makeDiagnostics(externalRuntime: ScoutVoiceExternalRuntime) -> ScoutVoiceDiagnostics {
        let defaultID = AVCaptureDevice.default(for: .audio)?.uniqueID
        let devices = audioInputDevices()
            .map { device in
                ScoutVoiceInputDevice(
                    id: device.uniqueID,
                    name: device.localizedName,
                    isSystemDefault: device.uniqueID == defaultID
                )
            }
            .sorted { lhs, rhs in
                if lhs.isSystemDefault != rhs.isSystemDefault {
                    return lhs.isSystemDefault && !rhs.isSystemDefault
                }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }

        if !selectedInputDeviceId.isEmpty,
           !devices.contains(where: { $0.id == selectedInputDeviceId }) {
            selectedInputDeviceId = ""
            UserDefaults.standard.set("", forKey: "OpenScoutVoiceInputDeviceID")
        }

        let effectiveName: String
        if let selected = devices.first(where: { $0.id == selectedInputDeviceId }) {
            effectiveName = selected.displayName
        } else if let systemDefault = devices.first(where: { $0.isSystemDefault }) ?? devices.first {
            effectiveName = systemDefault.displayName
        } else {
            effectiveName = "No input device"
        }

        let fileManager = FileManager.default
        let recordingsURL = ScoutVoiceConfig.recordingsDirectoryURL
        let recordingFiles = (try? fileManager.contentsOfDirectory(
            at: recordingsURL,
            includingPropertiesForKeys: nil
        )) ?? []
        let audioFileExtensions: Set<String> = ["wav", "m4a", "aiff", "caf"]
        let recordingsCount = recordingFiles.filter {
            audioFileExtensions.contains($0.pathExtension.lowercased())
        }.count

        return ScoutVoiceDiagnostics(
            microphonePermissionStatus: MicrophonePermission.statusString(),
            inputDevices: devices,
            selectedInputDeviceId: selectedInputDeviceId,
            effectiveInputDeviceName: effectiveName,
            modelCachePath: ScoutVoiceConfig.sharedModelCachePath,
            modelCacheExists: fileManager.fileExists(atPath: ScoutVoiceConfig.sharedModelCachePath),
            recordingsPath: ScoutVoiceConfig.recordingsDirectoryPath,
            recordingsCount: recordingsCount,
            lastRecordingPath: lastRecordingURL?.path,
            externalRuntime: externalRuntime
        )
    }

    private static func detectExternalRuntime() async -> ScoutVoiceExternalRuntime {
        async let voxAppPIDs = pids(forProcessNamed: "Vox")
        async let voxdPIDs = pids(forProcessNamed: "voxd")
        async let launchdLabels = loadedVoxLaunchdLabels()
        return await ScoutVoiceExternalRuntime(
            voxAppPIDs: voxAppPIDs,
            voxdPIDs: voxdPIDs,
            loadedLaunchdLabels: launchdLabels
        )
    }

    private static func pids(forProcessNamed name: String) async -> [String] {
        let result = try? await CommandRunner.run(CommandDescriptor(
            executableURL: URL(fileURLWithPath: "/usr/bin/pgrep"),
            arguments: ["-x", name]
        ))
        return result?.trimmedStdout
            .split(separator: "\n")
            .map(String.init) ?? []
    }

    private static func loadedVoxLaunchdLabels() async -> [String] {
        var loaded: [String] = []
        for label in ["com.vox.daemon", "cc.voxd.daemon"] {
            let result = try? await CommandRunner.run(CommandDescriptor(
                executableURL: URL(fileURLWithPath: "/bin/launchctl"),
                arguments: ["list", label]
            ))
            if result?.exitCode == 0 {
                loaded.append(label)
            }
        }
        return loaded
    }
}

private final class ScoutVoiceRecordingDelegate: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    private var result: Result<URL, Error>?

    func waitForFinish() async throws -> URL {
        if let result = existingResult() {
            return try result.get()
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.lock.lock()
            if let result = self.result {
                self.lock.unlock()
                continuation.resume(with: result)
                return
            }
            self.continuation = continuation
            self.lock.unlock()
        }
    }

    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: (any Error)?
    ) {
        let result: Result<URL, Error>
        if let error, !Self.isRecoverableStopError(error, outputFileURL: outputFileURL) {
            result = .failure(error)
        } else {
            result = .success(outputFileURL)
        }
        complete(result)
    }

    private func existingResult() -> Result<URL, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return result
    }

    private func complete(_ result: Result<URL, Error>) {
        lock.lock()
        guard self.result == nil else {
            lock.unlock()
            return
        }
        self.result = result
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    private static func isRecoverableStopError(_ error: Error, outputFileURL: URL) -> Bool {
        let nsError = error as NSError
        if nsError.domain == AVFoundationErrorDomain,
           FileManager.default.fileExists(atPath: outputFileURL.path) {
            return true
        }
        return error.localizedDescription == "Recording Stopped"
            && FileManager.default.fileExists(atPath: outputFileURL.path)
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
