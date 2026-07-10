import Combine
import Foundation
import ScoutAppCore
import ScoutNativeCore

@MainActor
final class ScoutRemoteVoiceService: ObservableObject {
    static let shared = ScoutRemoteVoiceService()

    @Published private(set) var state: ScoutDictationState = .idle
    @Published private(set) var partial: String = ""
    @Published private(set) var lastFinalText: String = ""

    private var activeSessionId: String?
    private var eventTask: Task<Void, Never>?
    private var startTask: Task<Void, Never>?

    private init() {}

    func probe() async {
        do {
            let health = try await Self.fetchJSON(
                VoiceHealthSnapshot.self,
                path: "/api/voice/health?quiet=1"
            )
            let microphoneNeedsSettings = health.microphoneGranted == false
                && health.microphoneCanRequest == false
            state = health.ok || (health.host != nil && !microphoneNeedsSettings)
                ? .idle
                : .unavailable(reason: health.reason ?? health.detail ?? "Scout voice host is not available.")
        } catch {
            state = .unavailable(reason: ScoutAppError.userFacing(
                error,
                connectionMessage: "Could not connect to the Scout voice host."
            ))
        }
    }

    func start(inputDeviceId: String? = nil) {
        guard activeSessionId == nil else { return }
        startTask?.cancel()
        partial = ""
        state = .starting
        startTask = Task { [weak self] in
            await self?.startSession(inputDeviceId: inputDeviceId)
        }
    }

    func stop() {
        guard let sessionId = activeSessionId else { return }
        state = .processing
        Task { [weak self] in
            do {
                try await Self.send(path: "/api/voice/session/\(sessionId)/stop", method: "POST")
            } catch {
                self?.fail(error)
            }
        }
    }

    func cancel() {
        guard let sessionId = activeSessionId else {
            resetSession()
            return
        }
        Task { [weak self] in
            do {
                try await Self.send(path: "/api/voice/session/\(sessionId)/cancel", method: "POST")
                self?.resetSession()
            } catch {
                self?.fail(error)
            }
        }
    }

    func consumeFinalText() {
        lastFinalText = ""
    }

    func openMicrophoneSettings() async {
        do {
            _ = try await Self.postJSON(
                VoicePermissionResponse.self,
                path: "/api/voice/permissions/open",
                body: VoicePermissionRequest(kind: "microphone")
            )
        } catch {
            fail(error)
        }
    }

    private func startSession(inputDeviceId: String?) async {
        do {
            let created = try await Self.postJSON(
                CreateVoiceSessionResponse.self,
                path: "/api/voice/session",
                body: CreateVoiceSessionRequest(
                    clientId: "scout-macos-app",
                    surface: "macos.native-composer",
                    language: "en",
                    sessionId: nil
                )
            )
            activeSessionId = created.sessionId
            listen(to: created.sessionId)
        } catch {
            fail(error)
        }
    }

    private func listen(to sessionId: String) {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            await self?.runEventStream(sessionId: sessionId)
        }
    }

    private func runEventStream(sessionId: String) async {
        guard let url = ScoutWeb.url(path: "/api/voice/session/\(sessionId)/events") else {
            fail(RemoteVoiceError("Scout voice event URL is invalid."))
            return
        }

        var eventName: String?
        var dataLines: [String] = []

        do {
            let (bytes, response) = try await URLSession.shared.bytes(from: url)
            try ScoutHTTP.validate(response)
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                if line.isEmpty {
                    handleEvent(name: eventName, data: dataLines.joined(separator: "\n"), sessionId: sessionId)
                    eventName = nil
                    dataLines.removeAll(keepingCapacity: true)
                    continue
                }
                if line.hasPrefix(":") {
                    continue
                }
                if let value = line.sseValue(prefix: "event:") {
                    eventName = value
                } else if let value = line.sseValue(prefix: "data:") {
                    dataLines.append(value)
                }
            }
        } catch {
            if activeSessionId == sessionId && !ScoutAppError.isCancellation(error) {
                fail(error)
            }
        }
    }

    private func handleEvent(name: String?, data: String, sessionId: String) {
        guard activeSessionId == sessionId, let name else { return }
        let payload = Self.decodePayload(data)

        switch name {
        case "session.started":
            state = .starting
        case "session.state":
            if let next = payload["state"] as? String {
                applySessionState(next)
            }
        case "session.partial":
            partial = payload["text"] as? String ?? ""
        case "session.final":
            let text = (payload["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            partial = ""
            if !text.isEmpty {
                lastFinalText = text
            }
            finishSession(sessionId)
        case "session.cancelled":
            finishSession(sessionId)
        case "session.error":
            let message = payload["message"] as? String ?? "Scout voice session failed."
            partial = ""
            state = .unavailable(reason: message)
            activeSessionId = nil
            eventTask = nil
        default:
            break
        }
    }

    private func applySessionState(_ value: String) {
        switch value {
        case "starting":
            state = .starting
        case "recording":
            state = .recording
        case "processing":
            state = .processing
        case "done", "cancelled":
            state = .idle
        case "error":
            state = .unavailable(reason: "Scout voice session failed.")
        default:
            break
        }
    }

    private func finishSession(_ sessionId: String) {
        guard activeSessionId == sessionId else { return }
        activeSessionId = nil
        eventTask = nil
        state = .idle
    }

    private func resetSession() {
        startTask?.cancel()
        startTask = nil
        eventTask?.cancel()
        eventTask = nil
        activeSessionId = nil
        partial = ""
        state = .idle
    }

    private func fail(_ error: Error) {
        activeSessionId = nil
        eventTask?.cancel()
        eventTask = nil
        partial = ""
        state = .unavailable(reason: ScoutAppError.userFacing(
            error,
            connectionMessage: "Could not connect to the Scout voice host."
        ))
    }

    private static func fetchJSON<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        guard let url = ScoutWeb.url(path: path) else { throw RemoteVoiceError("Scout voice URL is invalid.") }
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(type, from: data)
    }

    private static func postJSON<T: Decodable, Body: Encodable>(
        _ type: T.Type,
        path: String,
        body: Body
    ) async throws -> T {
        guard let url = ScoutWeb.url(path: path) else { throw RemoteVoiceError("Scout voice URL is invalid.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(type, from: data)
    }

    private static func send(path: String, method: String) async throws {
        guard let url = ScoutWeb.url(path: path) else { throw RemoteVoiceError("Scout voice URL is invalid.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ScoutHTTPError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let message = decodePayload(data)["error"] as? String, !message.isEmpty {
                throw RemoteVoiceError(message)
            }
            throw ScoutHTTPError.httpStatus(http.statusCode)
        }
    }

    private static func decodePayload(_ text: String) -> [String: Any] {
        guard let data = text.data(using: .utf8) else { return [:] }
        return decodePayload(data)
    }

    private static func decodePayload(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}

private struct CreateVoiceSessionRequest: Encodable {
    var clientId: String
    var surface: String
    var language: String
    var sessionId: String?
}

private struct CreateVoiceSessionResponse: Decodable {
    var sessionId: String
}

private struct VoiceHealthSnapshot: Decodable {
    var ok: Bool
    var reason: String?
    var detail: String?
    var microphoneGranted: Bool?
    var microphoneCanRequest: Bool?
    var host: VoiceHealthHost?
}

private struct VoiceHealthHost: Decodable {
    var hostId: String
}

private struct VoicePermissionRequest: Encodable {
    var kind: String
}

private struct VoicePermissionResponse: Decodable {
    var ok: Bool
}

private struct RemoteVoiceError: LocalizedError {
    var message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

private extension String {
    func sseValue(prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
}
