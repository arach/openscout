import Combine
import Foundation
@preconcurrency import Network
import os.log
import ScoutNativeCore

@MainActor
final class ScoutVoiceBridgeServer {
    static let shared = ScoutVoiceBridgeServer()

    private let port: NWEndpoint.Port = 43116
    private let queue = DispatchQueue(label: "dev.openscout.menu.voice-bridge")
    private let log = Logger(subsystem: "dev.openscout.menu", category: "voice-bridge")
    private var listener: NWListener?
    private var activeSession: ScoutVoiceBridgeLiveSession?

    private init() {}

    func start() {
        guard listener == nil else { return }

        do {
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            if let loopback = IPv4Address("127.0.0.1") {
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(loopback), port: port)
            }

            let listener = try NWListener(using: parameters)
            listener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in
                    self?.accept(connection)
                }
            }
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    self?.handleListenerState(state)
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            log.error("voice bridge failed to start: \(error.localizedDescription, privacy: .public)")
        }
    }

    func stop() {
        activeSession?.cancelFromBridge()
        activeSession = nil
        listener?.cancel()
        listener = nil
    }

    private func handleListenerState(_ state: NWListener.State) {
        switch state {
        case .ready:
            log.info("voice bridge listening on 127.0.0.1:\(self.port.rawValue)")
        case .failed(let error):
            log.error("voice bridge failed: \(error.localizedDescription, privacy: .public)")
            listener?.cancel()
            listener = nil
        case .cancelled:
            listener = nil
        default:
            break
        }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(on: connection, buffer: Data())
    }

    private func receiveRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, error in
            guard error == nil else {
                connection.cancel()
                return
            }

            var next = buffer
            if let data {
                next.append(data)
            }

            if let request = HTTPRequest.parse(next) {
                Task { @MainActor in
                    self?.handle(request, on: connection)
                }
                return
            }

            Task { @MainActor in
                self?.receiveRequest(on: connection, buffer: next)
            }
        }
    }

    private func handle(_ request: HTTPRequest, on connection: NWConnection) {
        if request.method == "OPTIONS" {
            sendEmptyResponse(on: connection)
            return
        }

        switch (request.method, request.path) {
        case ("GET", "/health"):
            sendJSON([
                "ok": true,
                "service": "openscout-menu-voice",
                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                "port": Int(port.rawValue)
            ], on: connection)
        case ("GET", "/capabilities"):
            sendJSON([
                "running": true,
                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                "features": [
                    "alignment": false,
                    "local_asr": true,
                    "streaming_progress": false,
                    "realtime": true
                ],
                "backends": [
                    "parakeet": true,
                    "mlx": false,
                    "ane": false
                ],
                "daemon": [
                    "service": "openscout-menu"
                ],
                "models": [
                    [
                        "id": ScoutVoiceConfig.modelId,
                        "kind": "asr",
                        "label": "Parakeet v3"
                    ]
                ]
            ], on: connection)
        case ("GET", "/live"):
            sendJSON(["session": activeSession?.statusPayload() as Any], on: connection)
        case ("POST", "/live"):
            beginLiveSession(on: connection)
        case ("POST", "/live/stop"):
            let sessionId = activeSession?.id ?? ""
            ScoutVoiceService.shared.stop()
            sendJSON(["ok": true, "sessionId": sessionId], on: connection)
        case ("POST", "/live/cancel"):
            let sessionId = activeSession?.id ?? ""
            activeSession?.cancelFromBridge()
            activeSession = nil
            sendJSON(["ok": true, "sessionId": sessionId], on: connection)
        default:
            sendJSON(["error": "Not found"], status: "404 Not Found", on: connection)
        }
    }

    private func beginLiveSession(on connection: NWConnection) {
        activeSession?.cancelFromBridge()

        let session = ScoutVoiceBridgeLiveSession(connection: connection) { [weak self] session in
            Task { @MainActor in
                guard self?.activeSession === session else { return }
                self?.activeSession = nil
            }
        }
        activeSession = session
        session.start()
    }

    private func sendEmptyResponse(on connection: NWConnection) {
        let headers = [
            "HTTP/1.1 204 No Content",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Connection: close",
            "\r\n"
        ].joined(separator: "\r\n")
        send(Data(headers.utf8), on: connection, close: true)
    }

    private func sendJSON(_ payload: Any, status: String = "200 OK", on connection: NWConnection) {
        let body = (try? JSONSerialization.data(withJSONObject: payload, options: [])) ?? Data("{}".utf8)
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: application/json",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Content-Length: \(body.count)",
            "Connection: close",
            "\r\n"
        ].joined(separator: "\r\n")
        var response = Data(headers.utf8)
        response.append(body)
        send(response, on: connection, close: true)
    }

    private func send(_ data: Data, on connection: NWConnection, close: Bool) {
        connection.send(content: data, completion: .contentProcessed { _ in
            if close {
                connection.cancel()
            }
        })
    }
}

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) -> HTTPRequest? {
        guard let boundary = data.firstRange(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }

        let headerData = data[..<boundary.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return nil
        }

        let requestParts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard requestParts.count >= 2 else {
            return nil
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else {
                continue
            }
            let key = line[..<separator].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines)
            headers[key] = value
        }

        let bodyStart = boundary.upperBound
        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        guard data.count >= bodyStart + contentLength else {
            return nil
        }

        let body = contentLength > 0
            ? Data(data[bodyStart..<(bodyStart + contentLength)])
            : Data()
        let rawPath = requestParts[1]
        let path = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath

        return HTTPRequest(method: requestParts[0].uppercased(), path: path, headers: headers, body: body)
    }
}

@MainActor
private final class ScoutVoiceBridgeLiveSession {
    let id = UUID().uuidString

    private let connection: NWConnection
    private let startedAt = Date()
    private let onFinish: (ScoutVoiceBridgeLiveSession) -> Void
    private var cancellables: Set<AnyCancellable> = []
    private var finished = false
    private var sawProcessing = false
    private var lastState: String = "starting"

    init(connection: NWConnection, onFinish: @escaping (ScoutVoiceBridgeLiveSession) -> Void) {
        self.connection = connection
        self.onFinish = onFinish
    }

    func start() {
        sendStreamHeaders()
        observeVoice()
        sendState("starting")

        Task { @MainActor in
            let voice = ScoutVoiceService.shared
            switch voice.state {
            case .probing, .unavailable:
                await voice.probe()
            default:
                break
            }

            switch voice.state {
            case .idle:
                voice.start()
            case .starting, .recording, .processing:
                sendError("Voice is already in use.")
                finish()
            case .unavailable(let reason):
                sendError(reason)
                finish()
            case .probing:
                sendError("Voice is still checking.")
                finish()
            }
        }
    }

    func cancelFromBridge() {
        guard !finished else { return }
        ScoutVoiceService.shared.cancel()
        sendNDJSON(["result": ["sessionId": id, "cancelled": true]])
        finish()
    }

    func statusPayload() -> [String: Any] {
        [
            "sessionId": id,
            "connectionId": id,
            "clientId": ScoutVoiceConfig.clientId,
            "modelId": ScoutVoiceConfig.modelId,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "state": lastState
        ]
    }

    private func observeVoice() {
        let voice = ScoutVoiceService.shared

        voice.$state
            .sink { [weak self] state in
                self?.handle(state)
            }
            .store(in: &cancellables)

        voice.$lastFinalText
            .sink { [weak self] text in
                self?.handleFinalText(text)
            }
            .store(in: &cancellables)
    }

    private func handle(_ state: ScoutDictationState) {
        guard !finished else { return }

        switch state {
        case .probing, .starting:
            sendState("starting")
        case .recording:
            sendState("recording")
        case .processing:
            sawProcessing = true
            sendState("processing")
        case .idle:
            if sawProcessing {
                sendFinal(text: "")
            }
        case .unavailable(let reason):
            sendState("error", reason: reason)
            sendError(reason)
            finish()
        }
    }

    private func handleFinalText(_ text: String) {
        guard !finished else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sendFinal(text: trimmed)
        ScoutVoiceService.shared.consumeFinalText()
    }

    private func sendState(_ state: String, reason: String? = nil) {
        lastState = state
        var data: [String: Any] = [
            "sessionId": id,
            "state": state
        ]
        if let reason {
            data["reason"] = reason
        }
        sendNDJSON(["event": "session.state", "data": data])
    }

    private func sendFinal(text: String) {
        guard !finished else { return }

        let result: [String: Any] = [
            "sessionId": id,
            "text": text,
            "durationMs": Int(Date().timeIntervalSince(startedAt) * 1000)
        ]
        sendNDJSON(["event": "session.final", "data": result])
        sendNDJSON(["result": result])
        finish()
    }

    private func sendError(_ message: String) {
        sendNDJSON(["error": message])
    }

    private func sendStreamHeaders() {
        let headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: application/x-ndjson",
            "Cache-Control: no-cache",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Transfer-Encoding: chunked",
            "Connection: keep-alive",
            "\r\n"
        ].joined(separator: "\r\n")
        connection.send(content: Data(headers.utf8), completion: .contentProcessed { _ in })
    }

    private func sendNDJSON(_ payload: [String: Any]) {
        guard !finished else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            return
        }
        var line = data
        line.append(0x0A)
        sendChunk(line)
    }

    private func sendChunk(_ payload: Data) {
        let prefix = Data("\(String(payload.count, radix: 16))\r\n".utf8)
        let suffix = Data("\r\n".utf8)
        var chunk = Data()
        chunk.append(prefix)
        chunk.append(payload)
        chunk.append(suffix)
        connection.send(content: chunk, completion: .contentProcessed { _ in })
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        cancellables.removeAll()

        let end = Data("0\r\n\r\n".utf8)
        connection.send(content: end, completion: .contentProcessed { [connection] _ in
            connection.cancel()
        })
        onFinish(self)
    }
}
