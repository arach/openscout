import Combine
import Foundation
import os.log
import ScoutAppCore
import ScoutNativeCore
import AVFoundation
import HudsonVoice
import ScoutSharedUI

/// Bridges web chat dictation sessions to HudsonKit's native `HudDictation`
/// through the Scout-owned `/api/voice/session` contract.
@MainActor
final class ScoutVoiceHostRunner {
    static let shared = ScoutVoiceHostRunner()

    private let hostId = "scout-menu"
    private let bundleId = "app.openscout.scout.menu"
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice-host")
    private let voice = ScoutVoiceService.shared

    private var loopTask: Task<Void, Never>?
    private var warmupTask: Task<Void, Never>?
    private var sessionCancellables = Set<AnyCancellable>()
    private var activeSessionId: String?
    private var sessionStartedAt: Date?
    private var deliveredFinalForSession: String?
    private var processingDeadlineTask: Task<Void, Never>?

    private init() {}

    func start() {
        guard loopTask == nil else { return }
        loopTask = Task { [weak self] in
            await self?.runLoop()
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        warmupTask?.cancel()
        warmupTask = nil
        processingDeadlineTask?.cancel()
        processingDeadlineTask = nil
        sessionCancellables.removeAll()
        activeSessionId = nil
        sessionStartedAt = nil
        deliveredFinalForSession = nil
    }

    private func runLoop() async {
        while !Task.isCancelled {
            do {
                try await registerHost()
                scheduleWarmup()
                if let command = try await awaitCommand() {
                    await handle(command)
                }
            } catch {
                log.debug("voice host loop error: \(error.localizedDescription, privacy: .public)")
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func scheduleWarmup() {
        guard warmupTask == nil else { return }
        warmupTask = Task { [weak self] in
            await self?.voice.probe()
            self?.warmupTask = nil
        }
    }

    private func registerHost() async throws {
        let settings = ScoutVoiceSettingsStore.snapshot(
            preference: voice.preference,
            modelReady: voice.modelReady,
            modelInstalled: voice.modelInstalled
        )
        let devices = ScoutVoiceSettingsStore.listInputDevices()
        let url = ScoutWeb.baseURL().appending(path: "api/voice/host/register")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RegisterBody(
            hostId: hostId,
            platform: "macos",
            bundle: bundleId,
            settings: settings,
            devices: devices
        ))
        try await ScoutHTTP.send(request)
    }

    private func awaitCommand() async throws -> HostCommand? {
        var components = URLComponents(
            url: ScoutWeb.baseURL().appending(path: "api/voice/host/commands"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "hostId", value: hostId),
            URLQueryItem(name: "timeoutMs", value: "25000"),
        ]
        guard let url = components?.url else { return nil }
        let response = try await ScoutHTTP.fetch(CommandResponse.self, from: url)
        return response.command
    }

    private func handle(_ command: HostCommand) async {
        switch command.type {
        case "session.start":
            await startSession(command)
        case "session.stop":
            guard let sessionId = command.sessionId else { return }
            await stopSession(sessionId)
        case "session.cancel":
            guard let sessionId = command.sessionId else { return }
            await cancelSession(sessionId)
        case "settings.apply":
            await applySettings(command)
        case "permissions.open":
            await openPrivacySettings(command)
        case "permissions.request":
            await requestPrivacyAccess(command)
        default:
            break
        }
    }

    private func requestPrivacyAccess(_ command: HostCommand) async {
        switch command.permissionKind ?? "microphone" {
        case "speechRecognition":
            _ = await ScoutVoicePermissions.ensureSpeechRecognitionAccess()
        default:
            _ = await ScoutVoicePermissions.ensureMicrophoneAccess()
        }
        await voice.probe()
        try? await registerHost()
    }

    private func openPrivacySettings(_ command: HostCommand) async {
        switch command.permissionKind ?? "microphone" {
        case "speechRecognition":
            ScoutVoicePermissions.openSpeechRecognitionPrivacySettings()
        default:
            ScoutVoicePermissions.openMicrophonePrivacySettings()
        }
    }

    private func applySettings(_ command: HostCommand) async {
        let preference = command.preference.flatMap(HudDictation.Preference.init(rawValue:))
        voice.applySettings(preference: preference, inputDeviceId: command.inputDeviceId)
        await voice.probe()
        try? await registerHost()
    }

    private func startSession(_ command: HostCommand) async {
        guard command.type == "session.start", let sessionId = command.sessionId else { return }
        if let activeSessionId, activeSessionId != sessionId {
            if voice.state.isCaptureActive || voice.state.isProcessing {
                voice.cancel()
            }
            await postEvent(
                sessionId: activeSessionId,
                event: "session.cancelled",
                data: ["reason": "superseded"]
            )
            clearSession(activeSessionId)
        }

        activeSessionId = sessionId
        sessionStartedAt = Date()
        deliveredFinalForSession = nil

        await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "starting"])

        if case .unavailable = voice.state {
            await voice.probe()
        }

        guard await voice.ensureCaptureAccess() else {
            let reason: String
            if case .unavailable(let message) = voice.state {
                reason = message
            } else {
                reason = ScoutVoicePermissions.microphoneStatusMessage(
                    for: AVCaptureDevice.authorizationStatus(for: .audio)
                )
            }
            await postEvent(
                sessionId: sessionId,
                event: "session.error",
                data: ["message": reason, "code": "microphone_permission"]
            )
            clearSession(sessionId)
            return
        }

        if case .unavailable(let reason) = voice.state {
            await postEvent(
                sessionId: sessionId,
                event: "session.error",
                data: ["message": reason]
            )
            clearSession(sessionId)
            return
        }

        if let inputDeviceId = command.inputDeviceId, !inputDeviceId.isEmpty {
            ScoutVoiceSettingsStore.saveInputDeviceId(inputDeviceId)
        }
        bindSessionObservers(sessionId: sessionId)
        voice.start(inputDeviceId: command.inputDeviceId)
        await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "recording"])
    }

    private func stopSession(_ sessionId: String) async {
        guard activeSessionId == sessionId else { return }
        await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "processing"])
        armProcessingDeadline(sessionId: sessionId)
        voice.stop()
    }

    private func cancelSession(_ sessionId: String) async {
        guard activeSessionId == sessionId else { return }
        processingDeadlineTask?.cancel()
        processingDeadlineTask = nil
        voice.cancel()
        await postEvent(sessionId: sessionId, event: "session.cancelled", data: ["reason": "host"])
        clearSession(sessionId)
    }

    private func bindSessionObservers(sessionId: String) {
        sessionCancellables.removeAll()

        voice.$partial
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] partial in
                guard let self, self.activeSessionId == sessionId else { return }
                let trimmed = partial.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                Task { await self.postEvent(sessionId: sessionId, event: "session.partial", data: ["text": trimmed]) }
            }
            .store(in: &sessionCancellables)

        voice.$state
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] state in
                guard let self, self.activeSessionId == sessionId else { return }
                Task { await self.handleVoiceStateChange(sessionId: sessionId, state: state) }
            }
            .store(in: &sessionCancellables)

        voice.$lastFinalText
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] finalText in
                guard let self, self.activeSessionId == sessionId else { return }
                let trimmed = finalText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                guard self.deliveredFinalForSession != sessionId else { return }
                let durationMs = Int((self.sessionStartedAt.map { Date().timeIntervalSince($0) } ?? 0) * 1000)
                Task {
                    await self.deliverFinal(sessionId: sessionId, text: trimmed, durationMs: durationMs)
                }
            }
            .store(in: &sessionCancellables)
    }

    private func handleVoiceStateChange(sessionId: String, state: ScoutDictationState) async {
        switch state {
        case .idle:
            if activeSessionId == sessionId, deliveredFinalForSession != sessionId {
                let durationMs = Int((sessionStartedAt.map { Date().timeIntervalSince($0) } ?? 0) * 1000)
                await deliverFinal(sessionId: sessionId, text: "", durationMs: durationMs)
            } else if deliveredFinalForSession == sessionId {
                clearSession(sessionId)
            }
        case .unavailable(let reason):
            await postEvent(sessionId: sessionId, event: "session.error", data: ["message": reason])
            clearSession(sessionId)
        case .processing:
            await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "processing"])
            armProcessingDeadline(sessionId: sessionId)
        case .recording:
            await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "recording"])
        case .starting:
            await postEvent(sessionId: sessionId, event: "session.state", data: ["state": "starting"])
        case .probing:
            break
        }
    }

    private func deliverFinal(sessionId: String, text: String, durationMs: Int) async {
        guard activeSessionId == sessionId else { return }
        guard deliveredFinalForSession != sessionId else { return }
        deliveredFinalForSession = sessionId
        processingDeadlineTask?.cancel()
        processingDeadlineTask = nil
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
            let message = micStatus == .authorized
                ? "No speech was detected. Check your microphone input in Settings → Voice."
                : ScoutVoicePermissions.microphoneStatusMessage(for: micStatus)
            await postEvent(
                sessionId: sessionId,
                event: "session.error",
                data: ["message": message, "code": "empty_transcript"]
            )
        } else {
            await postEvent(
                sessionId: sessionId,
                event: "session.final",
                data: ["text": trimmed, "durationMs": durationMs]
            )
        }
        voice.consumeFinalText()
        clearSession(sessionId)
    }

    private func armProcessingDeadline(sessionId: String) {
        processingDeadlineTask?.cancel()
        processingDeadlineTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            guard let self, !Task.isCancelled else { return }
            guard self.activeSessionId == sessionId, self.deliveredFinalForSession != sessionId else { return }
            await self.postEvent(
                sessionId: sessionId,
                event: "session.error",
                data: ["message": "Scout voice transcription timed out."]
            )
            self.voice.cancel()
            self.clearSession(sessionId)
        }
    }

    private func clearSession(_ sessionId: String) {
        guard activeSessionId == sessionId else { return }
        processingDeadlineTask?.cancel()
        processingDeadlineTask = nil
        sessionCancellables.removeAll()
        activeSessionId = nil
        sessionStartedAt = nil
        deliveredFinalForSession = nil
    }

    private func postEvent(sessionId: String, event: String, data: [String: Any]) async {
        ScoutVoiceHistoryStore.shared.recordHostEvent(sessionId: sessionId, event: event, data: data)
        let url = ScoutWeb.baseURL().appending(path: "api/voice/host/events")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "hostId": hostId,
            "sessionId": sessionId,
            "event": event,
            "data": data,
        ])
        do {
            try await ScoutHTTP.send(request)
        } catch {
            log.error("voice host event failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

private struct RegisterBody: Encodable {
    let hostId: String
    let platform: String
    let bundle: String
    let settings: ScoutVoiceSettingsSnapshot
    let devices: [ScoutVoiceInputDevice]
}

private struct CommandResponse: Decodable {
    let command: HostCommand?
}

private struct HostCommand: Decodable {
    let type: String
    let sessionId: String?
    let clientId: String?
    let surface: String?
    let language: String?
    let preference: String?
    let inputDeviceId: String?
    let inputDeviceName: String?
    let kind: String?

    var permissionKind: String? { kind }
}
