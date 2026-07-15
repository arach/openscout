import Foundation

struct ScoutdStreamingSubscription: Sendable {
    let frames: AsyncThrowingStream<Data, Error>
    let cancel: @Sendable () -> Void
}

protocol ScoutdStreamingTransport: Sendable {
    func lineSubscription(
        socketPath: String,
        request: Data,
        timeout: TimeInterval
    ) -> ScoutdStreamingSubscription
}

public struct ScoutNativeAgentsSubscription: Sendable {
    public let snapshots: AsyncThrowingStream<ScoutNativeAgentsSnapshot, Error>
    private let cancelHandler: @Sendable () -> Void

    init(
        snapshots: AsyncThrowingStream<ScoutNativeAgentsSnapshot, Error>,
        cancel: @escaping @Sendable () -> Void
    ) {
        self.snapshots = snapshots
        self.cancelHandler = cancel
    }

    public func cancel() {
        cancelHandler()
    }
}

public struct ScoutNativeAgentsSnapshot: Sendable, Equatable {
    public let sequence: UInt64
    public let agents: [ScoutAgent]
    public let hasMore: Bool
    public let sourceUpdatedAt: UInt64
}

public enum ScoutNativeReadClientError: LocalizedError, Sendable {
    case unsupportedSchema(String)
    case invalidFrame(String)
    case service(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedSchema(let schema):
            return "unexpected scoutd native-read schema: \(schema)"
        case .invalidFrame(let message), .service(let message):
            return message
        }
    }
}

public final class ScoutNativeReadClient: @unchecked Sendable {
    static let requestSchema = "openscout.native.read.request/v1"
    static let snapshotSchema = "openscout.native.read.snapshot/v1"
    static let eventSchema = "openscout.native.read.event/v1"
    static let errorSchema = "openscout.probe.error/v1"

    private struct Request: Encodable {
        let schema: String
        let requestId: String
        let resource: String
        let mode: String
        let limit: Int
        let afterSequence: UInt64?
    }

    private struct Frame: Decodable {
        let schema: String
        let type: String?
        let sequence: UInt64?
        let sourceUpdatedAt: UInt64?
        let agents: [ScoutAgent]?
        let hasMore: Bool?
        let error: ServiceError?
    }

    private struct ServiceError: Decodable {
        let code: String?
        let message: String?
    }

    public let socketURL: URL
    public let timeout: TimeInterval
    private let transport: any ScoutdStreamingTransport

    public convenience init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        timeout: TimeInterval = 20
    ) {
        self.init(
            socketURL: ScoutdProbeClient.defaultSocketURL(
                environment: environment,
                fileManager: fileManager
            ),
            timeout: timeout
        )
    }

    public convenience init(socketURL: URL, timeout: TimeInterval = 20) {
        self.init(
            socketURL: socketURL,
            timeout: timeout,
            transport: UnixDomainSocketProbeTransport()
        )
    }

    init(
        socketURL: URL,
        timeout: TimeInterval,
        transport: any ScoutdStreamingTransport
    ) {
        self.socketURL = socketURL
        self.timeout = timeout
        self.transport = transport
    }

    public func subscribeAgents(
        limit: Int,
        afterSequence: UInt64? = nil
    ) throws -> ScoutNativeAgentsSubscription {
        let request = Request(
            schema: Self.requestSchema,
            requestId: UUID().uuidString.lowercased(),
            resource: "agents",
            mode: "subscribe",
            limit: min(max(limit, 1), 100),
            afterSequence: afterSequence
        )
        var payload = try JSONEncoder().encode(request)
        payload.append(0x0a)
        let upstream = transport.lineSubscription(
            socketPath: socketURL.path,
            request: payload,
            timeout: timeout
        )

        let snapshots = AsyncThrowingStream<ScoutNativeAgentsSnapshot, Error>(
            bufferingPolicy: .bufferingNewest(2)
        ) { continuation in
            let task = Task {
                do {
                    for try await data in upstream.frames {
                        guard let snapshot = try Self.decodeFrame(data) else { continue }
                        continuation.yield(snapshot)
                    }
                    continuation.finish()
                } catch {
                    if Task.isCancelled || ScoutAppError.isCancellation(error) {
                        continuation.finish()
                    } else {
                        continuation.finish(throwing: error)
                    }
                }
            }
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                upstream.cancel()
            }
        }
        return ScoutNativeAgentsSubscription(snapshots: snapshots) {
            upstream.cancel()
        }
    }

    static func decodeFrame(_ data: Data) throws -> ScoutNativeAgentsSnapshot? {
        let frame = try JSONDecoder().decode(Frame.self, from: data)
        switch frame.schema {
        case eventSchema:
            guard frame.type == "heartbeat" else {
                throw ScoutNativeReadClientError.invalidFrame(
                    "unknown scoutd native-read event: \(frame.type ?? "missing")"
                )
            }
            return nil
        case errorSchema:
            throw ScoutNativeReadClientError.service(
                frame.error?.message ?? frame.error?.code ?? "scoutd native-read service failed"
            )
        case snapshotSchema:
            guard frame.type == "agents.snapshot",
                  let sequence = frame.sequence,
                  let agents = frame.agents,
                  let hasMore = frame.hasMore else {
                throw ScoutNativeReadClientError.invalidFrame(
                    "scoutd native-read snapshot was missing required fields"
                )
            }
            return ScoutNativeAgentsSnapshot(
                sequence: sequence,
                agents: agents,
                hasMore: hasMore,
                sourceUpdatedAt: frame.sourceUpdatedAt ?? 0
            )
        default:
            throw ScoutNativeReadClientError.unsupportedSchema(frame.schema)
        }
    }
}
