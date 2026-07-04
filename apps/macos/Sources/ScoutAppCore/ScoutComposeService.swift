import Combine
import Foundation
import os.log
import ScoutNativeCore

/// Shared compose pipeline for macOS Scout surfaces. Owns routing,
/// local assistant-thread echo, thread discovery, and scoutbot reply SSE.
@MainActor
public final class ScoutComposeService: ObservableObject {
    public static let shared = ScoutComposeService()

    @Published public private(set) var assistantThread: [ScoutAssistantMessage] = []
    @Published public private(set) var isSending = false
    @Published public private(set) var lastError: String?
    @Published public private(set) var activeThread: ScoutbotThread?

    public static let assistantHandle = ScoutComposeRouting.assistantHandle

    private let log = Logger(subsystem: "dev.openscout.menu", category: "compose")
    private var replyStreamTask: Task<Void, Never>?
    private var threadLoadTask: Task<Void, Never>?

    private init() {
        replyStreamTask = Task { [weak self] in
            await self?.runReplyStream()
        }
        threadLoadTask = Task { [weak self] in
            await self?.loadThreads()
        }
    }

    public func send(body raw: String, targetHandle: String?) async {
        guard let envelope = ScoutComposeRouting.envelope(body: raw, targetHandle: targetHandle) else {
            return
        }

        let echo = ScoutAssistantMessage(
            id: UUID().uuidString,
            source: .operatorYou,
            at: Self.clockNow(),
            body: Self.composeEchoSpans(
                target: envelope.resolvedTarget,
                body: envelope.body,
                isAssistantDefault: envelope.isDefaultTarget
            )
        )
        assistantThread.append(echo)

        isSending = true
        defer { isSending = false }
        do {
            try await postToBroker(envelope.wireBody)
            lastError = nil
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func postToBroker(_ body: String) async throws {
        let url = ScoutWeb.baseURL().appendingPathComponent("api/send")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["body": body]
        if let threadId = activeThread?.threadId {
            payload["threadId"] = threadId
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        try await ScoutHTTP.send(request)
    }

    private static func composeEchoSpans(
        target: String,
        body: String,
        isAssistantDefault: Bool
    ) -> [ScoutAssistantSpan] {
        if isAssistantDefault {
            return [.text(body)]
        }
        let label = ScoutComposeRouting.isRouteDirectiveTarget(target) ? target : "@\(target)"
        return [.mention(label), .text(" \(body)")]
    }

    private static func clockNow() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: Date())
    }

    private func runReplyStream() async {
        var attempt = 0
        while !Task.isCancelled {
            do {
                try await consumeReplyStreamOnce()
                attempt = 0
            } catch is CancellationError {
                return
            } catch {
                guard !ScoutAppError.isCancellation(error) else { return }
                attempt += 1
                let delayMs = min(15_000, 500 * (1 << min(attempt, 5)))
                log.warning("reply stream dropped (attempt \(attempt, privacy: .public)): \(error.localizedDescription, privacy: .public); retrying in \(delayMs, privacy: .public)ms")
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
        }
    }

    private func consumeReplyStreamOnce() async throws {
        let url = ScoutWeb.baseURL().appendingPathComponent("api/events")
        var req = URLRequest(url: url)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60

        Self.diag("[compose] SSE: connecting → \(url.absoluteString)")

        let cancellation = ScoutSSECancellation()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let delegate = ScoutSSEDelegate(
                    onConnected: { status in
                        Task { @MainActor in
                            ScoutComposeService.diag("[compose] SSE: connected (HTTP \(status))")
                        }
                    },
                    onEvent: { [weak self] event, data in
                        Task { @MainActor in
                            if event == "message.posted" {
                                ScoutComposeService.diag("[compose] SSE: message.posted (\(data.count) chars)")
                                self?.handleMessagePostedBlock(data)
                            }
                        }
                    },
                    onComplete: { error in
                        if let error {
                            Task { @MainActor in
                                ScoutComposeService.diag("[compose] SSE: stream error \(error.localizedDescription)")
                            }
                            continuation.resume(throwing: error)
                        } else {
                            Task { @MainActor in
                                ScoutComposeService.diag("[compose] SSE: stream ended")
                            }
                            continuation.resume()
                        }
                    }
                )
                let config = URLSessionConfiguration.default
                config.timeoutIntervalForRequest = 60
                config.timeoutIntervalForResource = 0
                config.httpMaximumConnectionsPerHost = 4
                let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
                let task = session.dataTask(with: req)
                cancellation.set {
                    task.cancel()
                    session.invalidateAndCancel()
                }
                delegate.cancellation = {
                    cancellation.cancel()
                }
                task.resume()
            }
        } onCancel: {
            cancellation.cancel()
        }
    }

    private final class ScoutSSECancellation: @unchecked Sendable {
        private let lock = NSLock()
        private var handler: (() -> Void)?
        private var isCancelled = false

        func set(_ handler: @escaping () -> Void) {
            var shouldRunNow = false
            lock.lock()
            if isCancelled {
                shouldRunNow = true
            } else {
                self.handler = handler
            }
            lock.unlock()

            if shouldRunNow {
                handler()
            }
        }

        func cancel() {
            let handler: (() -> Void)?
            lock.lock()
            isCancelled = true
            handler = self.handler
            self.handler = nil
            lock.unlock()

            handler?()
        }
    }

    private func handleMessagePostedBlock(_ json: String) {
        guard let data = json.data(using: .utf8) else {
            Self.diag("[compose] handle: utf8 decode failed")
            return
        }
        guard let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            Self.diag("[compose] handle: envelope parse failed")
            return
        }
        guard (envelope["kind"] as? String) == "message.posted" else {
            Self.diag("[compose] handle: kind != message.posted, got \(envelope["kind"] ?? "nil")")
            return
        }
        guard let payload = envelope["payload"] as? [String: Any] else {
            Self.diag("[compose] handle: no payload")
            return
        }
        guard let message = payload["message"] as? [String: Any] else {
            Self.diag("[compose] handle: no payload.message")
            return
        }
        guard let actorId = message["actorId"] as? String else {
            Self.diag("[compose] handle: no actorId on message")
            return
        }
        guard actorId == Self.assistantHandle else {
            Self.diag("[compose] handle: skip actor=\(actorId) (want \(Self.assistantHandle))")
            return
        }
        if let activeConvId = activeThread?.conversationId {
            let convId = message["conversationId"] as? String
            guard convId == activeConvId else {
                Self.diag("[compose] handle: skip conv=\(convId ?? "<nil>") (want \(activeConvId))")
                return
            }
        }
        guard let body = message["body"] as? String,
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            Self.diag("[compose] handle: empty body for scoutbot message")
            return
        }
        let id = (message["id"] as? String) ?? UUID().uuidString
        let createdAt = message["createdAt"] as? Double
        let echo = ScoutAssistantMessage(
            id: id,
            source: .scout,
            at: Self.formatClock(epochMs: createdAt),
            body: [.text(body)]
        )
        Self.diag("[compose] handle: appending scout reply id=\(id) chars=\(body.count)")
        assistantThread.append(echo)
    }

    static func diag(_ message: String) {
        let line = "\(Date().timeIntervalSince1970) \(message)\n"
        if let data = line.data(using: .utf8) {
            let url = URL(fileURLWithPath: "/tmp/openscout-hud.log")
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)
            } else {
                try? data.write(to: url)
            }
        }
    }

    private func loadThreads() async {
        var attempt = 0
        while !Task.isCancelled, activeThread == nil {
            do {
                try await fetchThreadsOnce()
                return
            } catch is CancellationError {
                return
            } catch {
                attempt += 1
                let delayMs = min(15_000, 500 * (1 << min(attempt, 5)))
                Self.diag("[compose] threads: load failed (attempt \(attempt)): \(error.localizedDescription); retrying in \(delayMs)ms")
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
        }
    }

    private func fetchThreadsOnce() async throws {
        let url = ScoutWeb.baseURL().appendingPathComponent("api/scoutbot/threads")
        let decoded = try await ScoutHTTP.fetch(ScoutbotThreadsResponse.self, from: url)
        let pick = decoded.threads.first(where: { $0.threadId == decoded.defaultThreadId })
            ?? decoded.threads.first
        guard let pick else {
            throw ScoutComposeError.invalidResponse
        }
        activeThread = pick
        Self.diag("[compose] threads: active=\(pick.threadId) name=\(pick.name) conv=\(pick.conversationId)")
    }

    private static func formatClock(epochMs: Double?) -> String {
        let date = ScoutRelativeTime.date(epochMs) ?? Date()
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}

public enum ScoutComposeError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Broker returned an invalid response."
        case .httpStatus(let code): return "Broker HTTP \(code)."
        }
    }
}

private final class ScoutSSEDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    typealias OnConnected = (Int) -> Void
    typealias OnEvent = (String, String) -> Void
    typealias OnComplete = (Error?) -> Void

    private let onConnected: OnConnected
    private let onEvent: OnEvent
    private let onComplete: OnComplete

    var cancellation: (() -> Void)?

    private var buffer = Data()
    private var currentEventName = ""
    private var currentDataLines: [String] = []
    private var didComplete = false

    init(onConnected: @escaping OnConnected, onEvent: @escaping OnEvent, onComplete: @escaping OnComplete) {
        self.onConnected = onConnected
        self.onEvent = onEvent
        self.onComplete = onComplete
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let http = response as? HTTPURLResponse {
            onConnected(http.statusCode)
            if !(200..<300).contains(http.statusCode) {
                completionHandler(.cancel)
                fire(error: ScoutComposeError.httpStatus(http.statusCode))
                return
            }
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        drainBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        fire(error: error)
    }

    private func drainBuffer() {
        let lf: UInt8 = 0x0A
        while let lfIndex = buffer.firstIndex(of: lf) {
            let lineEnd = lfIndex
            let sliceRange = buffer.startIndex..<lineEnd
            var slice = buffer.subdata(in: sliceRange)
            if slice.last == 0x0D {
                slice.removeLast()
            }
            buffer.removeSubrange(buffer.startIndex...lfIndex)

            let line = String(data: slice, encoding: .utf8) ?? ""
            if line.isEmpty {
                if !currentEventName.isEmpty, !currentDataLines.isEmpty {
                    onEvent(currentEventName, currentDataLines.joined(separator: "\n"))
                }
                currentEventName = ""
                currentDataLines.removeAll(keepingCapacity: true)
            } else if line.hasPrefix("event:") {
                currentEventName = String(line.dropFirst("event:".count))
                    .trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                currentDataLines.append(
                    String(line.dropFirst("data:".count))
                        .trimmingCharacters(in: .whitespaces)
                )
            }
        }
    }

    private func fire(error: Error?) {
        guard !didComplete else { return }
        didComplete = true
        onComplete(error)
        cancellation?()
        cancellation = nil
    }
}
