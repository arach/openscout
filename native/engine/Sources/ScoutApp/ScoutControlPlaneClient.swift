import Foundation

struct ScoutControlPlaneCounts: Codable, Equatable {
    var nodes: Int
    var actors: Int
    var agents: Int
    var conversations: Int
    var messages: Int
    var flights: Int

    static let zero = ScoutControlPlaneCounts(
        nodes: 0,
        actors: 0,
        agents: 0,
        conversations: 0,
        messages: 0,
        flights: 0
    )

    var summary: String {
        "\(agents) agents · \(conversations) conversations · \(messages) messages · \(flights) flights"
    }
}

struct ScoutControlPlaneHealth: Decodable, Equatable {
    let ok: Bool
    let nodeID: String
    let meshID: String
    let counts: ScoutControlPlaneCounts

    private enum CodingKeys: String, CodingKey {
        case ok
        case nodeID = "nodeId"
        case meshID = "meshId"
        case counts
    }
}

struct ScoutControlPlaneNode: Decodable, Equatable {
    let id: String
    let meshID: String
    let name: String
    let hostName: String?
    let advertiseScope: String
    let brokerURL: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case meshID = "meshId"
        case name
        case hostName
        case advertiseScope
        case brokerURL = "brokerUrl"
    }
}

struct ScoutControlPlaneActor: Decodable, Equatable {
    let id: String
    let kind: String
    let displayName: String
    let handle: String?
    let labels: [String]?
    let metadata: [String: String]?
}

struct ScoutControlPlaneConversation: Decodable, Equatable {
    let id: String
    let kind: String
    let title: String
    let visibility: String
    let shareMode: String
    let authorityNodeID: String
    let participantIDs: [String]
    let topic: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case title
        case visibility
        case shareMode
        case authorityNodeID = "authorityNodeId"
        case participantIDs = "participantIds"
        case topic
    }
}

struct ScoutControlPlaneMessageMention: Codable, Equatable {
    let actorID: String
    let label: String?

    private enum CodingKeys: String, CodingKey {
        case actorID = "actorId"
        case label
    }
}

struct ScoutControlPlaneMessageAudience: Codable, Equatable {
    let visibleTo: [String]?
    let notify: [String]?
    let invoke: [String]?
}

struct ScoutControlPlaneSpeechDirective: Codable, Equatable {
    let text: String
    let voice: String?
    let interruptible: Bool?
}

struct ScoutControlPlaneMessageRecord: Decodable, Equatable {
    let id: String
    let conversationID: String
    let actorID: String
    let originNodeID: String
    let messageClass: String
    let body: String
    let replyToMessageID: String?
    let mentions: [ScoutControlPlaneMessageMention]?
    let speech: ScoutControlPlaneSpeechDirective?
    let audience: ScoutControlPlaneMessageAudience?
    let visibility: String
    let policy: String
    let createdAt: Int
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case conversationID = "conversationId"
        case actorID = "actorId"
        case originNodeID = "originNodeId"
        case messageClass = "class"
        case body
        case replyToMessageID = "replyToMessageId"
        case mentions
        case speech
        case audience
        case visibility
        case policy
        case createdAt
        case metadata
    }
}

struct ScoutControlPlaneFlightRecord: Decodable, Equatable {
    let id: String
    let invocationID: String
    let requesterID: String
    let targetAgentID: String
    let state: String
    let startedAt: Int?
    let completedAt: Int?
    let summary: String?
    let output: String?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case invocationID = "invocationId"
        case requesterID = "requesterId"
        case targetAgentID = "targetAgentId"
        case state
        case startedAt
        case completedAt
        case summary
        case output
        case error
    }
}

struct ScoutControlPlaneEndpoint: Decodable, Equatable {
    let id: String
    let agentID: String
    let nodeID: String
    let harness: String
    let transport: String
    let state: String
    let sessionID: String?
    let projectRoot: String?
    let cwd: String?
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case agentID = "agentId"
        case nodeID = "nodeId"
        case harness
        case transport
        case state
        case sessionID = "sessionId"
        case projectRoot
        case cwd
        case metadata
    }
}

struct ScoutControlPlaneEvent: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let actorID: String
    let nodeID: String?
    let timestamp: Int

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case actorID = "actorId"
        case nodeID = "nodeId"
        case timestamp = "ts"
    }
}

enum ScoutControlPlaneStreamMessage: Equatable {
    case hello(nodeID: String, meshID: String)
    case event(ScoutControlPlaneEvent)
}

struct ScoutControlPlaneSnapshot: Decodable, Equatable {
    let nodes: [String: ScoutControlPlaneNode]
    let actors: [String: ScoutControlPlaneActor]
    let agents: [String: ScoutControlPlaneActor]
    let endpoints: [String: ScoutControlPlaneEndpoint]
    let conversations: [String: ScoutControlPlaneConversation]
    let messages: [String: ScoutControlPlaneMessageRecord]
    let flights: [String: ScoutControlPlaneFlightRecord]
}

private struct ScoutControlPlaneActorUpsert: Encodable {
    let id: String
    let kind: String
    let displayName: String
    let handle: String?
    let labels: [String]
    let metadata: [String: String]?
}

private struct ScoutControlPlaneAgentUpsert: Encodable {
    let id: String
    let kind = "agent"
    let displayName: String
    let handle: String?
    let labels: [String]
    let metadata: [String: String]?
    let agentClass: String
    let capabilities: [String]
    let wakePolicy: String
    let homeNodeID: String
    let authorityNodeID: String
    let advertiseScope: String
    let ownerID: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case displayName
        case handle
        case labels
        case metadata
        case agentClass
        case capabilities
        case wakePolicy
        case homeNodeID = "homeNodeId"
        case authorityNodeID = "authorityNodeId"
        case advertiseScope
        case ownerID = "ownerId"
    }
}

private struct ScoutControlPlaneConversationUpsert: Encodable {
    let id: String
    let kind: String
    let title: String
    let visibility: String
    let shareMode: String
    let authorityNodeID: String
    let participantIDs: [String]
    let topic: String?
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case title
        case visibility
        case shareMode
        case authorityNodeID = "authorityNodeId"
        case participantIDs = "participantIds"
        case topic
        case metadata
    }
}

private struct ScoutControlPlaneEndpointUpsert: Encodable {
    let id: String
    let agentID: String
    let nodeID: String
    let harness: String
    let transport: String
    let state: String
    let address: String?
    let sessionID: String?
    let pane: String?
    let cwd: String?
    let projectRoot: String?
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case agentID = "agentId"
        case nodeID = "nodeId"
        case harness
        case transport
        case state
        case address
        case sessionID = "sessionId"
        case pane
        case cwd
        case projectRoot
        case metadata
    }
}

private struct ScoutControlPlaneMessagePost: Encodable {
    let id: String
    let conversationID: String
    let actorID: String
    let originNodeID: String
    let messageClass: String
    let body: String
    let mentions: [ScoutControlPlaneMessageMention]?
    let speech: ScoutControlPlaneSpeechDirective?
    let audience: ScoutControlPlaneMessageAudience?
    let visibility: String
    let policy: String
    let createdAt: Int
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case conversationID = "conversationId"
        case actorID = "actorId"
        case originNodeID = "originNodeId"
        case messageClass = "class"
        case body
        case mentions
        case speech
        case audience
        case visibility
        case policy
        case createdAt
        case metadata
    }
}

private struct ScoutControlPlaneInvocationPost: Encodable {
    let id: String
    let requesterID: String
    let requesterNodeID: String
    let targetAgentID: String
    let targetNodeID: String?
    let action: String
    let task: String
    let conversationID: String?
    let messageID: String?
    let context: [String: String]?
    let ensureAwake: Bool
    let stream: Bool
    let timeoutMS: Int?
    let createdAt: Int
    let metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id
        case requesterID = "requesterId"
        case requesterNodeID = "requesterNodeId"
        case targetAgentID = "targetAgentId"
        case targetNodeID = "targetNodeId"
        case action
        case task
        case conversationID = "conversationId"
        case messageID = "messageId"
        case context
        case ensureAwake
        case stream
        case timeoutMS = "timeoutMs"
        case createdAt
        case metadata
    }
}

private struct ScoutControlPlaneOKResponse: Decodable {
    let ok: Bool
}

private struct ScoutControlPlaneMessageResponse: Decodable {
    let ok: Bool
    let message: ScoutControlPlaneMessageRecord
}

private struct ScoutControlPlaneInvocationResponse: Decodable {
    let ok: Bool
    let flight: ScoutControlPlaneFlightRecord?
}

actor ScoutControlPlaneClient {
    nonisolated let baseURL: URL

    private let session: URLSession
    private let streamSession: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(baseURL: URL? = nil) {
        self.baseURL = baseURL ?? Self.resolvedBaseURL()

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 1.5
        configuration.timeoutIntervalForResource = 3.0
        self.session = URLSession(configuration: configuration)

        let streamConfiguration = URLSessionConfiguration.ephemeral
        streamConfiguration.timeoutIntervalForRequest = 60 * 60 * 12
        streamConfiguration.timeoutIntervalForResource = 60 * 60 * 12
        self.streamSession = URLSession(configuration: streamConfiguration)
    }

    func fetchHealth() async throws -> ScoutControlPlaneHealth {
        try await get("/health", as: ScoutControlPlaneHealth.self)
    }

    func fetchNode() async throws -> ScoutControlPlaneNode {
        try await get("/v1/node", as: ScoutControlPlaneNode.self)
    }

    func fetchSnapshot() async throws -> ScoutControlPlaneSnapshot {
        try await get("/v1/snapshot", as: ScoutControlPlaneSnapshot.self)
    }

    func fetchRecentEvents(limit: Int = 50) async throws -> [ScoutControlPlaneEvent] {
        try await get(
            "/v1/events",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(max(1, min(limit, 500)))"),
            ],
            as: [ScoutControlPlaneEvent].self
        )
    }

    func eventStream() -> AsyncThrowingStream<ScoutControlPlaneStreamMessage, Error> {
        let url = baseURL.appending(path: "/v1/events/stream")
        let session = streamSession
        let decoder = self.decoder

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "accept")
                    let (bytes, response) = try await session.bytes(for: request)

                    guard let httpResponse = response as? HTTPURLResponse else {
                        throw NSError(
                            domain: "OpenScout",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Control-plane broker returned an invalid stream response."]
                        )
                    }

                    guard (200 ..< 300).contains(httpResponse.statusCode) else {
                        throw NSError(
                            domain: "OpenScout",
                            code: httpResponse.statusCode,
                            userInfo: [NSLocalizedDescriptionKey: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)]
                        )
                    }

                    var currentEventName: String?
                    var dataLines: [String] = []

                    func flushCurrentEvent() {
                        if let message = Self.decodeStreamMessage(
                            eventName: currentEventName,
                            dataLines: dataLines,
                            decoder: decoder
                        ) {
                            continuation.yield(message)
                        }

                        currentEventName = nil
                        dataLines.removeAll(keepingCapacity: true)
                    }

                    for try await line in bytes.lines {
                        if Task.isCancelled {
                            break
                        }

                        if line.isEmpty {
                            flushCurrentEvent()
                            continue
                        }

                        if line.hasPrefix("event:") {
                            // Some AsyncBytes line readers can elide the blank separator between SSE events.
                            // Flush the previous event before starting a new one so the stream never hangs
                            // waiting for an empty line that may never be surfaced to us.
                            if currentEventName != nil || !dataLines.isEmpty {
                                flushCurrentEvent()
                            }
                            currentEventName = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
                            continue
                        }

                        if line.hasPrefix("data:") {
                            dataLines.append(line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces))
                            continue
                        }

                        if line.hasPrefix(":") {
                            continue
                        }
                    }

                    flushCurrentEvent()
                    continuation.finish()
                } catch {
                    if !Task.isCancelled {
                        continuation.finish(throwing: error)
                    }
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    func upsertDeviceActor(id: String, displayName: String, labels: [String]) async throws {
        try await upsertActor(
            id: id,
            kind: "device",
            displayName: displayName,
            handle: "scout-app",
            labels: labels,
            metadata: nil
        )
    }

    func upsertActor(
        id: String,
        kind: String,
        displayName: String,
        handle: String? = nil,
        labels: [String] = [],
        metadata: [String: String]? = nil
    ) async throws {
        let payload = ScoutControlPlaneActorUpsert(
            id: id,
            kind: kind,
            displayName: displayName,
            handle: handle,
            labels: labels,
            metadata: metadata
        )
        _ = try await post("/v1/actors", body: payload, as: ScoutControlPlaneOKResponse.self)
    }

    func upsertAgent(
        id: String,
        displayName: String,
        handle: String? = nil,
        labels: [String] = [],
        metadata: [String: String]? = nil,
        agentClass: String,
        capabilities: [String],
        wakePolicy: String = "on_demand",
        homeNodeID: String,
        authorityNodeID: String,
        advertiseScope: String = "local",
        ownerID: String? = nil
    ) async throws {
        let payload = ScoutControlPlaneAgentUpsert(
            id: id,
            displayName: displayName,
            handle: handle,
            labels: labels,
            metadata: metadata,
            agentClass: agentClass,
            capabilities: capabilities,
            wakePolicy: wakePolicy,
            homeNodeID: homeNodeID,
            authorityNodeID: authorityNodeID,
            advertiseScope: advertiseScope,
            ownerID: ownerID
        )
        _ = try await post("/v1/agents", body: payload, as: ScoutControlPlaneOKResponse.self)
    }

    func upsertConversation(
        id: String,
        kind: String,
        title: String,
        visibility: String,
        shareMode: String = "local",
        authorityNodeID: String,
        participantIDs: [String],
        topic: String? = nil,
        metadata: [String: String]? = nil
    ) async throws {
        let payload = ScoutControlPlaneConversationUpsert(
            id: id,
            kind: kind,
            title: title,
            visibility: visibility,
            shareMode: shareMode,
            authorityNodeID: authorityNodeID,
            participantIDs: participantIDs,
            topic: topic,
            metadata: metadata
        )
        _ = try await post("/v1/conversations", body: payload, as: ScoutControlPlaneOKResponse.self)
    }

    func upsertEndpoint(
        id: String,
        agentID: String,
        nodeID: String,
        harness: String,
        transport: String,
        state: String,
        address: String? = nil,
        sessionID: String? = nil,
        pane: String? = nil,
        cwd: String? = nil,
        projectRoot: String? = nil,
        metadata: [String: String]? = nil
    ) async throws {
        let payload = ScoutControlPlaneEndpointUpsert(
            id: id,
            agentID: agentID,
            nodeID: nodeID,
            harness: harness,
            transport: transport,
            state: state,
            address: address,
            sessionID: sessionID,
            pane: pane,
            cwd: cwd,
            projectRoot: projectRoot,
            metadata: metadata
        )
        _ = try await post("/v1/endpoints", body: payload, as: ScoutControlPlaneOKResponse.self)
    }

    func postMessage(
        id: String = ScoutControlPlaneClient.makeMessageID(),
        conversationID: String,
        actorID: String,
        originNodeID: String,
        messageClass: String,
        body: String,
        mentions: [ScoutControlPlaneMessageMention] = [],
        audience: ScoutControlPlaneMessageAudience? = nil,
        speech: ScoutControlPlaneSpeechDirective? = nil,
        visibility: String,
        policy: String = "durable",
        metadata: [String: String]? = nil
    ) async throws -> ScoutControlPlaneMessageRecord {
        let payload = ScoutControlPlaneMessagePost(
            id: id,
            conversationID: conversationID,
            actorID: actorID,
            originNodeID: originNodeID,
            messageClass: messageClass,
            body: body,
            mentions: mentions.isEmpty ? nil : mentions,
            speech: speech,
            audience: audience,
            visibility: visibility,
            policy: policy,
            createdAt: Int(Date.now.timeIntervalSince1970 * 1000),
            metadata: metadata
        )
        let response = try await post("/v1/messages", body: payload, as: ScoutControlPlaneMessageResponse.self)
        return response.message
    }

    func invokeAgent(
        id: String = ScoutControlPlaneClient.makeInvocationID(),
        requesterID: String,
        requesterNodeID: String,
        targetAgentID: String,
        targetNodeID: String? = nil,
        action: String,
        task: String,
        conversationID: String? = nil,
        messageID: String? = nil,
        context: [String: String]? = nil,
        ensureAwake: Bool = true,
        stream: Bool = true,
        timeoutMS: Int? = nil,
        metadata: [String: String]? = nil
    ) async throws -> ScoutControlPlaneFlightRecord? {
        let payload = ScoutControlPlaneInvocationPost(
            id: id,
            requesterID: requesterID,
            requesterNodeID: requesterNodeID,
            targetAgentID: targetAgentID,
            targetNodeID: targetNodeID,
            action: action,
            task: task,
            conversationID: conversationID,
            messageID: messageID,
            context: context,
            ensureAwake: ensureAwake,
            stream: stream,
            timeoutMS: timeoutMS,
            createdAt: Int(Date.now.timeIntervalSince1970 * 1000),
            metadata: metadata
        )

        let response = try await post("/v1/invocations", body: payload, as: ScoutControlPlaneInvocationResponse.self)
        return response.flight
    }

    private func get<Response: Decodable>(_ path: String, as _: Response.Type) async throws -> Response {
        let request = URLRequest(url: baseURL.appending(path: path))
        let data = try await send(request)
        return try decoder.decode(Response.self, from: data)
    }

    private func get<Response: Decodable>(
        _ path: String,
        queryItems: [URLQueryItem],
        as _: Response.Type
    ) async throws -> Response {
        guard var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false) else {
            throw NSError(
                domain: "OpenScout",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Unable to construct a control-plane request URL."]
            )
        }

        components.queryItems = queryItems
        guard let url = components.url else {
            throw NSError(
                domain: "OpenScout",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Unable to resolve a control-plane request URL."]
            )
        }

        let request = URLRequest(url: url)
        let data = try await send(request)
        return try decoder.decode(Response.self, from: data)
    }

    private func post<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body,
        as _: Response.Type
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(body)
        let data = try await send(request)
        return try decoder.decode(Response.self, from: data)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(
                domain: "OpenScout",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Control-plane broker returned an invalid response."]
            )
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let detail = String(data: data, encoding: .utf8) ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw NSError(
                domain: "OpenScout",
                code: httpResponse.statusCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }

        return data
    }

    private static func makeMessageID() -> String {
        "msg-\(UUID().uuidString.lowercased())"
    }

    private static func makeInvocationID() -> String {
        "inv-\(UUID().uuidString.lowercased())"
    }

    nonisolated private static func decodeStreamMessage(
        eventName: String?,
        dataLines: [String],
        decoder: JSONDecoder
    ) -> ScoutControlPlaneStreamMessage? {
        guard !dataLines.isEmpty else {
            return nil
        }

        let payload = dataLines.joined(separator: "\n")
        guard let data = payload.data(using: .utf8) else {
            return nil
        }

        if eventName == "hello" {
            struct Hello: Decodable {
                let nodeID: String
                let meshID: String

                private enum CodingKeys: String, CodingKey {
                    case nodeID = "nodeId"
                    case meshID = "meshId"
                }
            }

            guard let hello = try? decoder.decode(Hello.self, from: data) else {
                return nil
            }

            return .hello(nodeID: hello.nodeID, meshID: hello.meshID)
        }

        guard let event = try? decoder.decode(ScoutControlPlaneEvent.self, from: data) else {
            return nil
        }

        return .event(event)
    }

    static func resolvedBaseURL() -> URL {
        let environment = ProcessInfo.processInfo.environment
        if let override = environment["OPENSCOUT_BROKER_URL"],
           let url = URL(string: override) {
            return url
        }

        let port = resolvedBrokerPort()
        return URL(string: "http://127.0.0.1:\(port)")!
    }

    static func resolvedBrokerPort() -> Int {
        let raw = ProcessInfo.processInfo.environment["OPENSCOUT_BROKER_PORT"] ?? "65535"
        return Int(raw) ?? 65535
    }
}
