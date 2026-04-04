import Foundation
import ScoutCore

enum ScoutVoiceCaptureState: String {
    case unavailable
    case idle
    case connecting
    case recording
    case processing
    case error

    var title: String {
        switch self {
        case .unavailable:
            return "Unavailable"
        case .idle:
            return "Idle"
        case .connecting:
            return "Connecting"
        case .recording:
            return "Listening"
        case .processing:
            return "Processing"
        case .error:
            return "Error"
        }
    }
}

struct ScoutVoiceBridgeStatus: Equatable {
    var captureState: ScoutVoiceCaptureState
    var speaking: Bool
    var voxAvailable: Bool
    var oraAvailable: Bool
    var detail: String

    static let unavailable = ScoutVoiceBridgeStatus(
        captureState: .unavailable,
        speaking: false,
        voxAvailable: false,
        oraAvailable: false,
        detail: "Voice bridge unavailable."
    )
}

@MainActor
final class ScoutVoiceBridgeService {
    var onStatusChange: ((ScoutVoiceBridgeStatus) -> Void)?
    var onPartialText: ((String) -> Void)?
    var onFinalText: ((String) -> Void)?
    var onErrorMessage: ((String) -> Void)?

    private var process: Process?
    private var inputHandle: FileHandle?
    private var outputTask: Task<Void, Never>?

    func startIfNeeded() {
        guard process?.isRunning != true else {
            ScoutDiagnosticsLogger.log("Voice bridge start ignored because process is already running.")
            return
        }

        guard let packageURL = ScoutRuntimeLocator.packageURL(relativePath: "packages/voice") else {
            ScoutDiagnosticsLogger.log("Voice bridge launch failed: voice package path could not be resolved.")
            publishError("Unable to locate the repo-local voice bridge package.")
            publishStatus(.unavailable)
            return
        }

        guard let bunURL = ScoutRuntimeLocator.bunExecutableURL() else {
            ScoutDiagnosticsLogger.log("Voice bridge launch failed: Bun executable could not be resolved.")
            publishError("Unable to locate Bun for the voice bridge.")
            publishStatus(.unavailable)
            return
        }

        let process = Process()
        process.executableURL = bunURL
        process.arguments = [
            "run",
            "--cwd",
            packageURL.path(percentEncoded: false),
            "bridge",
        ]

        let inputPipe = Pipe()
        let outputPipe = Pipe()
        process.standardInput = inputPipe
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor in
                self?.inputHandle = nil
                self?.process = nil
                self?.outputTask?.cancel()
                self?.outputTask = nil

                if terminatedProcess.terminationStatus != 0 {
                    self?.publishError("Voice bridge exited with status \(terminatedProcess.terminationStatus).")
                    self?.publishStatus(.unavailable)
                }
            }
        }

        do {
            ScoutDiagnosticsLogger.log("Launching voice bridge with \(bunURL.path(percentEncoded: false)) in \(packageURL.path(percentEncoded: false)).")
            try process.run()
            self.process = process
            self.inputHandle = inputPipe.fileHandleForWriting
            ScoutDiagnosticsLogger.log("Voice bridge started with pid \(process.processIdentifier).")
            self.outputTask = Task { [weak self] in
                await self?.readOutput(from: outputPipe.fileHandleForReading)
            }
            send(method: "health")
        } catch {
            ScoutDiagnosticsLogger.log("Voice bridge launch failed: \(error.localizedDescription)")
            publishError("Failed to launch voice bridge: \(error.localizedDescription)")
            publishStatus(.unavailable)
        }
    }

    func refreshHealth() {
        startIfNeeded()
        send(method: "health")
    }

    func startCapture() {
        startIfNeeded()
        send(
            method: "voice.start",
            params: ["clientId": "openscout-app"]
        )
    }

    func stopCapture() {
        send(method: "voice.stop")
    }

    func speak(text: String, voice: String?) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        startIfNeeded()
        var params: [String: String] = ["text": trimmed]
        if let voice, !voice.isEmpty {
            params["voice"] = voice
        }

        send(method: "speech.speak", params: params)
    }

    func stopSpeaking() {
        send(method: "speech.stop")
    }

    func stop() {
        ScoutDiagnosticsLogger.log("Voice bridge stop requested.")
        outputTask?.cancel()
        outputTask = nil
        inputHandle = nil
        process?.terminate()
        process = nil
        publishStatus(.unavailable)
        ScoutDiagnosticsLogger.log("Voice bridge stop complete.")
    }

    private func send(method: String, params: [String: Any]? = nil) {
        guard let inputHandle else {
            return
        }

        var command: [String: Any] = [
            "id": UUID().uuidString,
            "method": method,
        ]
        if let params {
            command["params"] = params
        }

        guard let data = try? JSONSerialization.data(withJSONObject: command),
              let newline = "\n".data(using: .utf8) else {
            return
        }

        do {
            try inputHandle.write(contentsOf: data)
            try inputHandle.write(contentsOf: newline)
        } catch {
            ScoutDiagnosticsLogger.log("Voice bridge write failed: \(error.localizedDescription)")
            publishError("Failed to write to voice bridge: \(error.localizedDescription)")
        }
    }

    private func readOutput(from handle: FileHandle) async {
        do {
            for try await line in handle.bytes.lines {
                await handleLine(line)
            }
        } catch {
            await MainActor.run {
                ScoutDiagnosticsLogger.log("Voice bridge output failed: \(error.localizedDescription)")
                publishError("Voice bridge output failed: \(error.localizedDescription)")
            }
        }
    }

    private func handleLine(_ line: String) async {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        await MainActor.run {
            if let event = object["event"] as? String {
                let payload = object["data"] as? [String: Any] ?? [:]
                handleEvent(event, payload: payload)
                return
            }

            if let ok = object["ok"] as? Bool, !ok {
                let message = object["error"] as? String ?? "Voice bridge request failed."
                publishError(message)
            }
        }
    }

    private func handleEvent(_ event: String, payload: [String: Any]) {
        switch event {
        case "status":
            publishStatus(status(from: payload))
        case "voice.partial":
            onPartialText?(payload["text"] as? String ?? "")
        case "voice.final":
            onFinalText?(payload["text"] as? String ?? "")
        case "voice.error":
            publishError(payload["message"] as? String ?? "Unknown voice bridge error.")
        default:
            break
        }
    }

    private func publishStatus(_ status: ScoutVoiceBridgeStatus) {
        onStatusChange?(status)
    }

    private func publishError(_ message: String) {
        onErrorMessage?(message)
    }

    private func status(from payload: [String: Any]) -> ScoutVoiceBridgeStatus {
        let captureState = ScoutVoiceCaptureState(
            rawValue: (payload["captureState"] as? String) ?? ""
        ) ?? .unavailable

        return ScoutVoiceBridgeStatus(
            captureState: captureState,
            speaking: payload["speaking"] as? Bool ?? false,
            voxAvailable: payload["voxAvailable"] as? Bool ?? false,
            oraAvailable: payload["oraAvailable"] as? Bool ?? false,
            detail: payload["detail"] as? String ?? captureState.title
        )
    }

}
