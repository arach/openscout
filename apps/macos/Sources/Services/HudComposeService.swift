import Combine
import Foundation
import os.log
import ScoutNativeCore

/// Compose pipeline for the universal HUD dock. Owns the act of turning
/// what the operator typed into a routed broker post, AND the local
/// echo into the Assistant thread so the operator sees their message
/// land immediately.
///
/// Routing model (today):
///   - default: `@scoutbot` (the assistant). When no explicit dispatch
///     target chip is set, the body is sent with `@scoutbot` prepended.
///   - dispatch: when the dock has a target chip (`@hudson`, `@studio`,
///     …), the body is sent with that handle prepended instead.
///
/// Routing model (future, not built here):
///   - reply: when the dock is inside a specific thread, the send
///     becomes a thread reply rather than a fresh broker post. Needs a
///     thread-focus signal from whichever view owns the conversation.
///
/// The thread surface (HUDAssistantView) subscribes to `assistantThread`.
/// On reply landing (broker → conversation SSE), append `.scout` entries
/// from there — that's a separate plumbing pass.
@MainActor
final class HudComposeService: ObservableObject {
    static let shared = HudComposeService()

    /// Local echo of everything the operator has composed since launch.
    /// HUDAssistantView reads this; renders empty-state when it's `[]`.
    /// NOT persisted across app restarts; the broker is the source of
    /// truth, and a server-backed thread feed will replace this when the
    /// reply path is wired.
    @Published private(set) var assistantThread: [HUDAssistantMessage] = []
    @Published private(set) var isSending: Bool = false
    @Published private(set) var lastError: String? = nil

    /// Active scoutbot thread. Stage 1 has one (the default); loaded on
    /// boot from `GET /api/scoutbot/threads`. Until it loads, sends omit
    /// `threadId` (backend defaults to the default thread) and the SSE
    /// filter falls back to actor-only.
    @Published private(set) var activeThread: ScoutbotThread?

    /// Default routing target when no dispatch chip is set. Per the
    /// unified-assistant decision (memory: scoutbot supersedes ranger /
    /// slot-5 mock), every assistant-mode send addresses `@scoutbot`.
    static let assistantHandle = ScoutComposeRouting.assistantHandle

    private let log = Logger(subsystem: "dev.openscout.menu", category: "compose")
    private var replyStreamTask: Task<Void, Never>?
    private var threadLoadTask: Task<Void, Never>?

    private init() {
        // Start a long-lived subscription to the web server's event
        // firehose. Filters for messages authored by `@scoutbot` and
        // appends them to the assistant thread. See `runReplyStream` for
        // reconnect behavior — drops are normal (web restarts during dev),
        // so the loop retries with backoff.
        replyStreamTask = Task { [weak self] in
            await self?.runReplyStream()
        }
        // Fetch the scoutbot thread map. Retries with backoff because the
        // web server may not be up when the HUD launches.
        threadLoadTask = Task { [weak self] in
            await self?.loadThreads()
        }
    }

    deinit {
        replyStreamTask?.cancel()
        threadLoadTask?.cancel()
    }

    /// Compose + dispatch. `targetHandle` is the dispatch chip (nil →
    /// assistant default). The body the operator typed is what they
    /// typed; we strip any embedded @-tokens so the broker doesn't
    /// double-route, then prepend the canonical target.
    func send(body raw: String, targetHandle: String?) async {
        guard let envelope = ScoutComposeRouting.envelope(body: raw, targetHandle: targetHandle) else {
            return
        }

        // Local echo first — the operator should SEE their message land
        // before the network round-trip. If the send fails we surface the
        // error via `lastError`; the echoed message stays (it was real
        // intent, not a network state).
        let echo = HUDAssistantMessage(
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

    // MARK: - Wire

    private func postToBroker(_ body: String) async throws {
        let url = HudFleetService.webBaseURL().appendingPathComponent("api/send")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Include threadId when we have one; backend defaults to its own
        // defaultThreadId when omitted, so this is forward-compatible with
        // boots that race the thread-fetch.
        var payload: [String: Any] = ["body": body]
        if let threadId = activeThread?.threadId {
            payload["threadId"] = threadId
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HudComposeError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HudComposeError.httpStatus(http.statusCode)
        }
    }

    // MARK: - Helpers

    private static func composeEchoSpans(
        target: String,
        body: String,
        isAssistantDefault: Bool
    ) -> [HUDAssistantSpan] {
        // For an assistant-default send (the operator just talking to
        // scout), don't clutter the echo with the routing chip — it's
        // implicit. For an explicit dispatch, surface the @target as a
        // mention span so the routing reads at a glance.
        if isAssistantDefault {
            return [.text(body)]
        }
        return [.mention("@\(target)"), .text(" \(body)")]
    }

    private static func clockNow() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: Date())
    }

    // MARK: - Scoutbot reply subscription

    /// Streams `message.posted` events from the web server's `/api/events`
    /// SSE proxy and routes any message authored by `@scoutbot` into
    /// `assistantThread`. The web server proxies the broker's
    /// `/v1/events/stream`; same firehose, just exposed on the port the
    /// HUD already knows about.
    ///
    /// Backoff is intentional but bounded — during dev the web server
    /// restarts frequently. Capping at ~15s means we recover quickly
    /// without hammering the port if the server is genuinely down.
    private func runReplyStream() async {
        var attempt = 0
        while !Task.isCancelled {
            do {
                try await consumeReplyStreamOnce()
                attempt = 0
            } catch is CancellationError {
                return
            } catch {
                attempt += 1
                let delayMs = min(15_000, 500 * (1 << min(attempt, 5)))
                log.warning("reply stream dropped (attempt \(attempt, privacy: .public)): \(error.localizedDescription, privacy: .public); retrying in \(delayMs, privacy: .public)ms")
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
        }
    }

    private func consumeReplyStreamOnce() async throws {
        let url = HudFleetService.webBaseURL().appendingPathComponent("api/events")
        var req = URLRequest(url: url)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60 * 60

        HudComposeService.diag("[compose] SSE: connecting → \(url.absoluteString)")

        // URLSession.bytes(for:).lines buffers chunks aggressively on
        // macOS — it can hold an entire SSE stream until the buffer fills
        // or the server closes. URLSessionDataDelegate gets per-chunk
        // didReceive callbacks instead, which is what SSE needs.
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let delegate = SSEDelegate(
                onConnected: { status in
                    HudComposeService.diag("[compose] SSE: connected (HTTP \(status))")
                },
                onEvent: { [weak self] event, data in
                    if event == "message.posted" {
                        HudComposeService.diag("[compose] SSE: message.posted (\(data.count) chars)")
                        self?.handleMessagePostedBlock(data)
                    }
                },
                onComplete: { error in
                    if let error {
                        HudComposeService.diag("[compose] SSE: stream error \(error.localizedDescription)")
                        continuation.resume(throwing: error)
                    } else {
                        HudComposeService.diag("[compose] SSE: stream ended")
                        continuation.resume()
                    }
                }
            )
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 60 * 60
            config.timeoutIntervalForResource = 0
            config.httpMaximumConnectionsPerHost = 4
            let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
            let task = session.dataTask(with: req)
            delegate.cancellation = {
                task.cancel()
                session.invalidateAndCancel()
            }
            task.resume()
        }
    }

    private func handleMessagePostedBlock(_ json: String) {
        guard let data = json.data(using: .utf8) else {
            HudComposeService.diag("[compose] handle: utf8 decode failed")
            return
        }
        guard let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            HudComposeService.diag("[compose] handle: envelope parse failed")
            return
        }
        guard (envelope["kind"] as? String) == "message.posted" else {
            HudComposeService.diag("[compose] handle: kind != message.posted, got \(envelope["kind"] ?? "nil")")
            return
        }
        guard let payload = envelope["payload"] as? [String: Any] else {
            HudComposeService.diag("[compose] handle: no payload")
            return
        }
        guard let message = payload["message"] as? [String: Any] else {
            HudComposeService.diag("[compose] handle: no payload.message")
            return
        }
        guard let actorId = message["actorId"] as? String else {
            HudComposeService.diag("[compose] handle: no actorId on message")
            return
        }
        guard actorId == HudComposeService.assistantHandle else {
            HudComposeService.diag("[compose] handle: skip actor=\(actorId) (want \(HudComposeService.assistantHandle))")
            return
        }
        // Scope to the active thread once we have one. Until threads load
        // we accept any scoutbot message (stage 1 only has one thread
        // anyway; this filter is forward-looking for stage 2).
        if let activeConvId = activeThread?.conversationId {
            let convId = message["conversationId"] as? String
            guard convId == activeConvId else {
                HudComposeService.diag("[compose] handle: skip conv=\(convId ?? "<nil>") (want \(activeConvId))")
                return
            }
        }
        guard let body = message["body"] as? String,
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            HudComposeService.diag("[compose] handle: empty body for scoutbot message")
            return
        }
        let id = (message["id"] as? String) ?? UUID().uuidString
        let createdAt = message["createdAt"] as? Double
        let echo = HUDAssistantMessage(
            id: id,
            source: .scout,
            at: Self.formatClock(epochMs: createdAt),
            body: [.text(body)]
        )
        HudComposeService.diag("[compose] handle: appending scout reply id=\(id) chars=\(body.count)")
        assistantThread.append(echo)
    }

    /// Diagnostic append-only log. The .app's stdout/stderr both go to
    /// /dev/null when launched normally, so `print` is invisible. This
    /// path is greppable via `tail -f /tmp/openscout-hud.log`.
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

    // MARK: - Thread map

    /// Polls `GET /api/scoutbot/threads` until it gets a default thread,
    /// then publishes it. Exponential backoff like the SSE loop — the web
    /// server may not be up when the HUD launches; once it is, this lands
    /// the active thread on the next attempt.
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
                HudComposeService.diag("[compose] threads: load failed (attempt \(attempt)): \(error.localizedDescription); retrying in \(delayMs)ms")
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
        }
    }

    private func fetchThreadsOnce() async throws {
        let url = HudFleetService.webBaseURL().appendingPathComponent("api/scoutbot/threads")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw HudComposeError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HudComposeError.httpStatus(http.statusCode)
        }
        let decoded = try JSONDecoder().decode(ScoutbotThreadsResponse.self, from: data)
        let pick = decoded.threads.first(where: { $0.threadId == decoded.defaultThreadId })
            ?? decoded.threads.first
        guard let pick else {
            throw HudComposeError.invalidResponse
        }
        activeThread = pick
        HudComposeService.diag("[compose] threads: active=\(pick.threadId) name=\(pick.name) conv=\(pick.conversationId)")
    }

    private static func formatClock(epochMs: Double?) -> String {
        let date: Date
        if let ms = epochMs, ms > 0 {
            date = Date(timeIntervalSince1970: ms / 1000.0)
        } else {
            date = Date()
        }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}

// MARK: - Thread model (stage 1: single default thread)

/// One scoutbot conversation thread. Stage 1 always has one — the
/// auto-created "default". Per SCO-051, a thread is a label over the
/// transport-native session ID; we never build a parallel abstraction.
struct ScoutbotThread: Decodable, Sendable, Equatable {
    let threadId: String
    let name: String
    let conversationId: String
    let transportSessionId: String?
    let transport: String?
}

private struct ScoutbotThreadsResponse: Decodable {
    let threads: [ScoutbotThread]
    let defaultThreadId: String
}

enum HudComposeError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Broker returned an invalid response."
        case .httpStatus(let code): return "Broker HTTP \(code)."
        }
    }
}

// ─── SSE delegate ────────────────────────────────────────────────────
//
// URLSessionDataDelegate-based SSE consumer. The delegate receives raw
// chunks via `didReceive data:` (no buffering) and splits them into SSE
// blocks on a private serial queue, calling `onEvent` for each complete
// `event:` / `data:` pair separated by a blank line.

private final class SSEDelegate: NSObject, URLSessionDataDelegate {
    typealias OnConnected = (Int) -> Void
    typealias OnEvent = (String, String) -> Void
    typealias OnComplete = (Error?) -> Void

    private let onConnected: OnConnected
    private let onEvent: OnEvent
    private let onComplete: OnComplete

    /// Set by the caller after constructing — invoked from onComplete to
    /// tear down the URLSession before the continuation resumes.
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
                fire(error: HudComposeError.httpStatus(http.statusCode))
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
            var lineStart = buffer.startIndex
            var slice = buffer.subdata(in: lineStart..<lineEnd)
            // strip a trailing CR if present
            if slice.last == 0x0D {
                slice.removeLast()
            }
            // advance buffer past this line + the LF
            buffer.removeSubrange(lineStart...lfIndex)
            lineStart = buffer.startIndex

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
            // anything else (comments like `:`, retry, id) we ignore
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
