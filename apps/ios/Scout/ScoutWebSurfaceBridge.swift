import AVFoundation
import CryptoKit
import Foundation
import HudsonUIWeb
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class ScoutWebSurfaceBridge {
    enum Surface: String {
        case lanes
        case dispatch
    }

    private static let protocolVersion = 1
    private static let handlerName = "scoutSurface"
    private static let maximumHostCount = 32
    private static let maximumRequestBytes = 1_048_576
    private static let allowedEnvelopeKeys: Set<String> = [
        "v", "id", "surface", "method", "hostIds", "params", "deadlineMs",
    ]
    private static let hostScopedMethods: Set<String> = [
        "agents.list", "agents.observe", "tail.recent", "tail.subscribe",
        "dispatch.diagnostics", "dispatch.subscribe",
    ]
    private static let parameterKeys: [String: Set<String>] = [
        "bootstrap": [],
        "native.openExternalURL": ["url"],
        "native.getPreferences": ["keys"],
        "native.setPreferences": ["entries"],
        "native.cancel": ["requestId"],
        "native.voice.snapshot": [],
        "native.voice.toggleInput": [],
        "native.voice.speak": ["text"],
        "native.voice.stopOutput": [],
        "agents.list": [],
        "agents.observe": ["agentIds"],
        "tail.recent": ["cursor", "limit"],
        "tail.subscribe": ["cursor"],
        "native.setLaneSelection": ["selection"],
        "codex.thread.snapshot": ["route"],
        "codex.thread.connect": ["route"],
        "codex.turn.start": ["route", "text"],
        "codex.turn.steer": ["route", "text"],
        "codex.turn.interrupt": ["route"],
        "dispatch.diagnostics": ["cursor", "limit"],
        "dispatch.subscribe": ["cursor"],
        "dispatch.ask": ["route", "body", "replyMode"],
        "dispatch.review": ["hostId", "dispatchId", "note"],
    ]

    private weak var model: AppModel?
    private let surface: Surface
    private let epoch = UUID().uuidString.lowercased()
    private var activity: ScoutWebViewActivity = .hiddenWarm
    private var tasks: [String: Task<Void, Never>] = [:]
    private var laneSelection: LaneSelectionRequest?
    private let speechSynthesizer = AVSpeechSynthesizer()

    init(model: AppModel, surface: Surface) {
        self.model = model
        self.surface = surface
    }

    lazy var integration: ScoutWebViewIntegration = {
        let integration = ScoutWebViewIntegration(
            userScripts: [ScoutWebViewUserScript(source: bootstrapScript())],
            messageHandlers: [ScoutWebViewMessageHandler(name: Self.handlerName) { [weak self] body, reply in
                self?.handle(body: body, reply: reply)
            }],
            onActivityChange: { [weak self] activity in
                self?.activity = activity
                if activity == .background {
                    self?.cancelAll()
                    self?.stopVoiceSession()
                }
            },
            onReset: { [weak self] _ in
                self?.cancelAll()
                self?.stopVoiceSession()
            },
            onOpenExternalURL: { [weak self] url in self?.openExternalURL(url) }
        )
        return integration
    }()

    private func bootstrapScript() -> String {
        guard let bootstrap = jsonObject(bootstrapPayload()),
              let data = try? JSONSerialization.data(withJSONObject: bootstrap, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return "globalThis.__scoutSurfaceBootstrap = null;" }
        return """
        globalThis.__scoutSurfaceBootstrap = \(json);
        globalThis.__scoutSurfacePendingPushes = globalThis.__scoutSurfacePendingPushes || [];
        globalThis.dispatchEvent(new CustomEvent('scout:surface-bootstrap'));
        """
    }

    private func handle(body: Any, reply: ScoutWebViewReply) {
        guard let object = body as? [String: Any],
              Set(object.keys).isSubset(of: Self.allowedEnvelopeKeys),
              JSONSerialization.isValidJSONObject(object),
              let encoded = try? JSONSerialization.data(withJSONObject: body),
              encoded.count <= Self.maximumRequestBytes,
              let request = try? JSONDecoder().decode(RequestEnvelope.self, from: encoded),
              !request.id.isEmpty,
              request.id.utf8.count <= 128,
              request.surface.utf8.count <= 16,
              request.method.utf8.count <= 64
        else {
            reply.fail("invalid_params")
            return
        }
        guard request.v == Self.protocolVersion, request.surface == surface.rawValue else {
            reply.succeed(errorReply(request, code: "protocol_mismatch", message: "Surface protocol mismatch."))
            return
        }
        guard let allowedParameterKeys = Self.parameterKeys[request.method] else {
            reply.succeed(errorReply(request, code: "unsupported_method", message: "Method is not allowlisted."))
            return
        }
        guard let parameters = object["params"] as? [String: Any],
              Set(parameters.keys).isSubset(of: allowedParameterKeys),
              Self.hostScopedMethods.contains(request.method) == (request.hostIds != nil)
        else {
            reply.succeed(errorReply(request, code: "invalid_params", message: "Request shape is invalid."))
            return
        }

        let deadline = appliedDeadline(for: request.method, requested: request.deadlineMs)
        switch request.method {
        case "bootstrap":
            reply.succeed(successReply(request, result: bootstrapPayload(), deadline: deadline))
        case "agents.list":
            perform(request: request, reply: reply, deadline: deadline) { [weak self] in
                guard let self else { throw SurfaceBridgeError.cancelled }
                return try await self.listAgents(hostIds: try self.authorizedHostIds(request.hostIds))
            }
        case "tail.recent":
            perform(request: request, reply: reply, deadline: deadline) { [weak self] in
                guard let self else { throw SurfaceBridgeError.cancelled }
                let limit = min(max(request.params?.limit ?? 200, 1), 1_000)
                return try await self.recentTail(hostIds: try self.authorizedHostIds(request.hostIds), limit: limit)
            }
        case "native.cancel":
            guard let target = request.params?.requestId, !target.isEmpty else {
                reply.succeed(errorReply(request, code: "invalid_params", message: "requestId is required.", deadline: deadline))
                return
            }
            tasks.removeValue(forKey: target)?.cancel()
            reply.succeed(successReply(request, result: ["accepted": true], deadline: deadline))
        case "native.openExternalURL":
            guard let rawURL = request.params?.url,
                  let url = URL(string: rawURL),
                  url.scheme?.lowercased() == "https"
            else {
                reply.succeed(errorReply(request, code: "invalid_params", message: "Only https URLs are allowed.", deadline: deadline))
                return
            }
            openExternalURL(url)
            reply.succeed(successReply(request, result: ["accepted": true], deadline: deadline))
        case "native.voice.snapshot":
            reply.succeed(successReply(request, result: voiceSnapshot(), deadline: deadline))
        case "native.voice.toggleInput":
            toggleVoiceInput()
            reply.succeed(successReply(request, result: voiceSnapshot(), deadline: deadline))
        case "native.voice.speak":
            guard let text = request.params?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                reply.succeed(errorReply(request, code: "invalid_params", message: "text is required.", deadline: deadline))
                return
            }
            speakVoiceOutput(text)
            reply.succeed(successReply(request, result: voiceSnapshot(), deadline: deadline))
        case "native.voice.stopOutput":
            speechSynthesizer.stopSpeaking(at: .immediate)
            reply.succeed(successReply(request, result: voiceSnapshot(), deadline: deadline))
        case "native.setLaneSelection":
            if let selection = request.params?.selection {
                guard !selection.hostId.isEmpty,
                      !selection.agentId.isEmpty,
                      machineMap()[selection.hostId] != nil
                else {
                    reply.succeed(errorReply(request, code: "invalid_route", message: "Lane selection is not authorized.", deadline: deadline))
                    return
                }
                laneSelection = selection
            } else {
                laneSelection = nil
            }
            reply.succeed(successReply(request, result: ["accepted": true], deadline: deadline))
        case "codex.thread.snapshot":
            performCodex(request: request, reply: reply, deadline: deadline) { client, route in
                try await client.codexDeckSnapshot(agentId: route.agentId)
            }
        case "codex.thread.connect":
            performCodex(request: request, reply: reply, deadline: deadline) { client, route in
                try await client.codexDeckConnect(agentId: route.agentId)
            }
        case "codex.turn.start":
            guard let text = request.params?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                reply.succeed(errorReply(request, code: "invalid_params", message: "text is required.", deadline: deadline))
                return
            }
            performCodex(request: request, reply: reply, deadline: deadline) { client, route in
                try await client.codexDeckStart(agentId: route.agentId, text: text)
            }
        case "codex.turn.steer":
            guard let text = request.params?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                reply.succeed(errorReply(request, code: "invalid_params", message: "text is required.", deadline: deadline))
                return
            }
            performCodex(request: request, reply: reply, deadline: deadline) { client, route in
                try await client.codexDeckSteer(agentId: route.agentId, text: text)
            }
        case "codex.turn.interrupt":
            performCodex(request: request, reply: reply, deadline: deadline) { client, route in
                try await client.codexDeckInterrupt(agentId: route.agentId)
            }
        default:
            reply.succeed(errorReply(
                request,
                code: "unsupported_capability",
                message: "\(request.method) is not enabled in the first local-surface slice.",
                deadline: deadline
            ))
        }
    }

    private func performCodex<T: Encodable>(
        request: RequestEnvelope,
        reply: ScoutWebViewReply,
        deadline: Int,
        operation: @escaping @MainActor (BridgeBrokerClient, CodexRouteRequest) async throws -> T
    ) {
        guard let route = request.params?.route else {
            reply.succeed(errorReply(request, code: "invalid_params", message: "route is required.", deadline: deadline))
            return
        }
        perform(request: request, reply: reply, deadline: deadline) { [weak self] in
            guard let self else { throw SurfaceBridgeError.cancelled }
            let client = try self.authorizedCodexClient(for: route)
            let value = try await operation(client, route)
            return try self.encodableJSONObject(value)
        }
    }

    private func perform(
        request: RequestEnvelope,
        reply: ScoutWebViewReply,
        deadline: Int,
        operation: @escaping @MainActor () async throws -> Any
    ) {
        var timeoutTask: Task<Void, Never>?
        let task = Task { [weak self] in
            do {
                let result = try await operation()
                guard !Task.isCancelled else { throw SurfaceBridgeError.cancelled }
                reply.succeed(self?.successReply(request, result: result, deadline: deadline))
            } catch is CancellationError {
                reply.succeed(self?.errorReply(request, code: "cancelled", message: "Request cancelled.", deadline: deadline))
            } catch SurfaceBridgeError.cancelled {
                reply.succeed(self?.errorReply(request, code: "cancelled", message: "Request cancelled.", deadline: deadline))
            } catch SurfaceBridgeError.invalidRoute {
                reply.succeed(self?.errorReply(request, code: "invalid_route", message: "Host scope is invalid.", deadline: deadline))
            } catch SurfaceBridgeError.unsupportedCapability {
                reply.succeed(self?.errorReply(request, code: "unsupported_capability", message: "The selected route does not expose the Codex app-server Deck adapter.", deadline: deadline))
            } catch {
                reply.succeed(self?.errorReply(request, code: "not_connected", message: error.localizedDescription, deadline: deadline))
            }
            timeoutTask?.cancel()
            self?.tasks.removeValue(forKey: request.id)
        }
        tasks[request.id]?.cancel()
        tasks[request.id] = task
        timeoutTask = Task { [weak self, task] in
            do {
                try await Task.sleep(for: .milliseconds(deadline))
            } catch {
                return
            }
            guard self?.tasks[request.id] != nil else { return }
            task.cancel()
            self?.tasks.removeValue(forKey: request.id)
            reply.succeed(self?.errorReply(
                request,
                code: "deadline_exceeded",
                message: "Request exceeded its deadline.",
                deadline: deadline,
                retryable: true
            ))
        }
    }

    private func bootstrapPayload() -> [String: Any] {
        let machines = model?.webSurfaceMachines() ?? []
        let hosts = machines.map { machine in
            [
                "id": hostId(for: machine.machineId),
                "name": machine.name,
                "state": machine.isOnline ? "connected" : "disconnected",
            ]
        }
        let selected = machines.filter(\.isOnline).map { hostId(for: $0.machineId) }
        let focusedHostId = machines.first(where: \.isFocused).map { hostId(for: $0.machineId) }
        let revision = model?.fleetRevision ?? 0
        return [
            "surface": surface.rawValue,
            "assetRevision": assetRevision(),
            "protocolVersion": Self.protocolVersion,
            "minimumSurfaceProtocolVersion": Self.protocolVersion,
            "minimumNativeProtocolVersion": Self.protocolVersion,
            "capabilities": enabledCapabilities,
            "device": ["platform": "ios", "formFactor": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "phone"],
            "hosts": hosts,
            "selectedHostIds": selected,
            "focusedHostId": focusedHostId ?? NSNull(),
            "connectionRevision": revision,
            "activity": activity.rawValue,
        ]
    }

    private var enabledCapabilities: [String] {
        switch surface {
        case .lanes:
            return [
                "bootstrap", "native.openExternalURL", "native.cancel", "agents.list", "tail.recent", "native.setLaneSelection",
                "native.voice.snapshot", "native.voice.toggleInput", "native.voice.speak", "native.voice.stopOutput",
                "codex.thread.snapshot", "codex.thread.connect", "codex.turn.start", "codex.turn.steer", "codex.turn.interrupt",
            ]
        case .dispatch:
            return ["bootstrap", "native.openExternalURL", "native.cancel"]
        }
    }

    private func authorizedHostIds(_ requested: [String]?) throws -> [String] {
        guard let requested, !requested.isEmpty, requested.count <= Self.maximumHostCount else {
            throw SurfaceBridgeError.invalidRoute
        }
        let allowed = Set((model?.webSurfaceMachines() ?? []).map { hostId(for: $0.machineId) })
        guard requested.allSatisfy(allowed.contains) else { throw SurfaceBridgeError.invalidRoute }
        return Array(Set(requested)).sorted()
    }

    private func listAgents(hostIds: [String]) async throws -> [String: Any] {
        let machines = machineMap()
        var outcomes: [[String: Any]] = []
        for hostId in hostIds {
            guard let machine = machines[hostId], let client = machine.client else {
                outcomes.append(hostFailure(hostId, message: "Host is not connected."))
                continue
            }
            do {
                let agents = try await client.listAgents(query: nil, limit: 256)
                outcomes.append([
                    "hostId": hostId,
                    "ready": true,
                    "value": [
                        "cursor": cursor(hostId: hostId, sequence: Int64(agents.count)),
                        "agents": agents.map(agentPayload),
                    ],
                ])
            } catch {
                outcomes.append(hostFailure(hostId, message: error.localizedDescription))
            }
        }
        return ["hosts": outcomes]
    }

    private func recentTail(hostIds: [String], limit: Int) async throws -> [String: Any] {
        let machines = machineMap()
        var outcomes: [[String: Any]] = []
        for hostId in hostIds {
            guard let machine = machines[hostId], let client = machine.client else {
                outcomes.append(hostFailure(hostId, message: "Host is not connected."))
                continue
            }
            do {
                let events = try await client.recentTail(limit: limit)
                let sequence = events.map(\.tsMs).max() ?? 0
                outcomes.append([
                    "hostId": hostId,
                    "ready": true,
                    "value": [
                        "cursor": cursor(hostId: hostId, sequence: sequence),
                        "nextCursor": NSNull(),
                        "events": events.map(tailPayload),
                    ],
                ])
            } catch {
                outcomes.append(hostFailure(hostId, message: error.localizedDescription))
            }
        }
        return ["hosts": outcomes]
    }

    private func machineMap() -> [String: AppModel.WebSurfaceMachine] {
        Dictionary(uniqueKeysWithValues: (model?.webSurfaceMachines() ?? []).map { (hostId(for: $0.machineId), $0) })
    }

    private func authorizedCodexClient(for route: CodexRouteRequest) throws -> BridgeBrokerClient {
        guard laneSelection?.hostId == route.hostId,
              laneSelection?.agentId == route.agentId,
              let machine = machineMap()[route.hostId]
        else { throw SurfaceBridgeError.invalidRoute }
        guard let client = machine.client else { throw SurfaceBridgeError.cancelled }
        guard let codexClient = client as? BridgeBrokerClient else {
            throw SurfaceBridgeError.unsupportedCapability
        }
        return codexClient
    }

    private func agentPayload(_ agent: AgentSummary) -> [String: Any] {
        [
            "id": agent.id,
            "name": agent.title,
            "handle": NSNull(),
            "harness": agent.harness as Any? ?? NSNull(),
            "transport": agent.transport as Any? ?? NSNull(),
            "model": agent.model as Any? ?? NSNull(),
            "state": agent.state.rawValue,
            "projectRoot": agent.projectName as Any? ?? NSNull(),
            "conversationId": agent.conversationId as Any? ?? NSNull(),
            "sessionId": agent.sessionId as Any? ?? NSNull(),
            "updatedAt": agent.lastActiveAt.map { Int64($0.timeIntervalSince1970 * 1_000) } as Any? ?? NSNull(),
        ]
    }

    private func tailPayload(_ event: TailEvent) -> [String: Any] {
        [
            "id": event.id,
            "at": event.tsMs,
            "agentId": NSNull(),
            "sessionId": event.conversationId as Any? ?? NSNull(),
            "kind": event.kind.rawValue,
            "text": event.summary,
        ]
    }

    private func cursor(hostId: String, sequence: Int64) -> [String: Any] {
        [
            "epoch": "\(epoch):\(hostId):\(model?.fleetRevision ?? 0)",
            "sequence": sequence,
            "connectionRevision": model?.fleetRevision ?? 0,
        ]
    }

    private func hostFailure(_ hostId: String, message: String) -> [String: Any] {
        [
            "hostId": hostId,
            "ready": false,
            "error": ["code": "not_connected", "message": message, "retryable": true],
        ]
    }

    private func successReply(_ request: RequestEnvelope, result: Any, deadline: Int? = nil) -> [String: Any] {
        [
            "v": Self.protocolVersion,
            "id": request.id,
            "method": request.method,
            "metadata": ["appliedDeadlineMs": deadline ?? appliedDeadline(for: request.method, requested: request.deadlineMs)],
            "result": result,
        ]
    }

    private func errorReply(
        _ request: RequestEnvelope,
        code: String,
        message: String,
        deadline: Int? = nil,
        retryable: Bool = false
    ) -> [String: Any] {
        [
            "v": Self.protocolVersion,
            "id": request.id,
            "method": request.method,
            "metadata": ["appliedDeadlineMs": deadline ?? appliedDeadline(for: request.method, requested: request.deadlineMs)],
            "error": ["code": code, "message": message, "retryable": retryable],
        ]
    }

    private func appliedDeadline(for method: String, requested: Int?) -> Int {
        if method == "native.voice.snapshot" || method == "native.voice.stopOutput" {
            return min(max(requested ?? 1_000, 1), 2_000)
        }
        if method == "native.voice.toggleInput" || method == "native.voice.speak" {
            return min(max(requested ?? 2_000, 1), 5_000)
        }
        let longRead = method == "agents.list"
            || method == "tail.recent"
            || method == "codex.thread.snapshot"
            || method == "codex.thread.connect"
        let maximum = longRead ? 30_000 : 5_000
        let fallback = longRead ? 15_000 : 5_000
        return min(max(requested ?? fallback, 1), maximum)
    }

    private func assetRevision() -> String {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "WebSurfaces"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let revision = object["assetRevision"] as? String
        else { return "unknown" }
        return revision
    }

    private func hostId(for machineId: String) -> String {
        let digest = SHA256.hash(data: Data(machineId.lowercased().utf8))
        return "host_" + digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private func openExternalURL(_ url: URL) {
        guard url.scheme?.lowercased() == "https" else { return }
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #endif
    }

    private func voiceSnapshot() -> [String: Any] {
        guard let dictation = model?.dictation else {
            return [
                "input": [
                    "state": "unavailable",
                    "partialText": "",
                    "finalText": "",
                    "finalCount": 0,
                    "engine": "apple",
                    "modelReady": false,
                    "unavailableReason": "Native dictation is unavailable.",
                ],
                "output": ["speaking": speechSynthesizer.isSpeaking],
            ]
        }

        let state: String
        let unavailableReason: Any
        switch dictation.state {
        case .idle:
            state = "idle"
            unavailableReason = NSNull()
        case .preparing:
            state = "preparing"
            unavailableReason = NSNull()
        case .listening:
            state = "listening"
            unavailableReason = NSNull()
        case .transcribing:
            state = "transcribing"
            unavailableReason = NSNull()
        case .unavailable(let reason):
            state = "unavailable"
            unavailableReason = reason
        }

        return [
            "input": [
                "state": state,
                "partialText": dictation.partialText,
                "finalText": dictation.finalText,
                "finalCount": dictation.finalCount,
                "engine": dictation.lastEngine.rawValue,
                "modelReady": dictation.modelReady,
                "unavailableReason": unavailableReason,
            ],
            "output": ["speaking": speechSynthesizer.isSpeaking],
        ]
    }

    private func toggleVoiceInput() {
        guard let dictation = model?.dictation else { return }
        speechSynthesizer.stopSpeaking(at: .immediate)
        switch dictation.state {
        case .listening:
            dictation.stop()
        case .transcribing:
            dictation.cancel()
        case .idle, .preparing, .unavailable:
            dictation.prepare()
            dictation.start()
        }
    }

    private func speakVoiceOutput(_ text: String) {
        speechSynthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        utterance.prefersAssistiveTechnologySettings = true
        utterance.preUtteranceDelay = 0.04
        speechSynthesizer.speak(utterance)
    }

    private func stopVoiceSession() {
        speechSynthesizer.stopSpeaking(at: .immediate)
        guard let dictation = model?.dictation else { return }
        switch dictation.state {
        case .listening, .transcribing, .preparing:
            dictation.cancel()
        case .idle, .unavailable:
            break
        }
    }

    private func cancelAll() {
        let current = tasks.values
        tasks.removeAll()
        for task in current { task.cancel() }
    }

    private func jsonObject(_ value: Any) -> Any? {
        JSONSerialization.isValidJSONObject(value) ? value : nil
    }

    private func encodableJSONObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }
}

private struct RequestEnvelope: Decodable {
    let v: Int
    let id: String
    let surface: String
    let method: String
    let hostIds: [String]?
    let params: RequestParams?
    let deadlineMs: Int?
}

private struct RequestParams: Decodable {
    let cursor: String?
    let limit: Int?
    let requestId: String?
    let url: String?
    let selection: LaneSelectionRequest?
    let route: CodexRouteRequest?
    let text: String?
}

private struct LaneSelectionRequest: Decodable {
    let hostId: String
    let agentId: String
    let conversationId: String?
    let sessionId: String?
}

private struct CodexRouteRequest: Decodable {
    let hostId: String
    let agentId: String
}

private enum SurfaceBridgeError: Error {
    case cancelled
    case invalidRoute
    case unsupportedCapability
}
