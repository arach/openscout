import Combine
import Foundation
import os.log
import ScoutNativeCore

/// HUD-side client for the Vox companion (local transcription daemon at
/// 127.0.0.1:43115). Mirrors the surface the web `DictationMic` uses via
/// `@voxd/client`: probe → /health, start session → POST /live (NDJSON
/// stream), commit → POST /live/stop, abort → POST /live/cancel.
///
/// The companion does the actual mic capture in its own process — we
/// just trigger sessions over HTTP and consume the streamed events. So
/// the Mac app does NOT need an NSMicrophoneUsageDescription; the prompt
/// lives in Vox.
///
/// Connection lifecycle is one-session-at-a-time: tap mic to start, tap
/// again to commit and surface the final transcript on `lastFinalText`.
/// ESC cascade in the dock calls `cancel()` to abandon.
@MainActor
public final class ScoutVoxService: ObservableObject {
    public static let shared = ScoutVoxService()

    @Published public private(set) var state: ScoutDictationState = .probing
    /// Most recent partial transcript while recording. Cleared on stop.
    @Published public private(set) var partial: String = ""
    /// Most recent final transcript. The dock observes this via Combine
    /// and appends it to the text buffer once it transitions to non-empty.
    @Published public private(set) var lastFinalText: String = ""

    private let baseURL = URL(string: "http://127.0.0.1:43115")!
    private let clientId = "openscout-hud"
    private let modelId = "parakeet:v3"
    private let log = Logger(subsystem: "dev.openscout.menu", category: "vox")

    private var sessionId: String?
    private var streamTask: Task<Void, Never>?
    // Guard against the trailing `{result: ...}` envelope re-firing
    // the same final on top of the session.final event the daemon already
    // emitted. Cleared on each new session.start().
    private var finalDelivered: Bool = false

    private init() {}

    // MARK: - Probe

    /// Check whether the companion is reachable. Updates `state` to
    /// `.idle` if healthy, `.unavailable(reason:)` otherwise.
    public func probe() async {
        state = .probing
        var req = URLRequest(url: baseURL.appendingPathComponent("health"))
        req.timeoutInterval = 1.2
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                state = .unavailable(reason: "Vox companion not responding on 43115.")
                return
            }
            // Sanity-check the body is JSON we recognize so a different
            // service on the port doesn't look healthy.
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if payload?["service"] as? String == "vox-companion" {
                state = .idle
            } else {
                state = .unavailable(reason: "Port 43115 isn't the Vox companion.")
            }
        } catch {
            state = .unavailable(reason: "Vox companion unreachable. Launch the Vox app.")
        }
    }

    // MARK: - Live session

    /// Open a live transcription session. The companion starts capturing
    /// from its own microphone; we read NDJSON events from the response
    /// body until the session emits `session.final` (or errors out).
    public func start() {
        switch state {
        case .recording, .starting, .processing:
            log.info("start() ignored — already \(String(describing: self.state))")
            return
        default:
            break
        }
        partial = ""
        finalDelivered = false
        state = .starting
        log.info("start() — opening /live")
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.runLiveSession()
        }
    }

    /// Commit the in-flight session — companion finalizes and emits
    /// `session.final`. We move to `.processing` until the final event
    /// lands (or the stream closes).
    public func stop() {
        guard state == .recording || state == .starting else { return }
        state = .processing
        let target = sessionId
        Task {
            await postSessionControl(path: "/live/stop", sessionId: target)
        }
    }

    /// Abort the in-flight session without surfacing a transcript.
    /// Safe to call from any state.
    public func cancel() {
        streamTask?.cancel()
        streamTask = nil
        let target = sessionId
        sessionId = nil
        partial = ""
        if case .unavailable = state {
            // Don't clobber an unavailable reason on cancel.
        } else {
            state = .idle
        }
        Task {
            await postSessionControl(path: "/live/cancel", sessionId: target)
        }
    }

    /// Reset `lastFinalText` after the consumer (the dock) has appended
    /// it to its buffer, so we don't re-fire on the next subscription
    /// or duplicate the transcript across sessions.
    public func consumeFinalText() {
        lastFinalText = ""
    }

    // MARK: - Internals

    private func runLiveSession() async {
        var req = URLRequest(url: baseURL.appendingPathComponent("live"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "clientId": clientId,
            "modelId": modelId,
        ])
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                log.error("/live returned HTTP \(code)")
                state = .unavailable(reason: "Vox /live returned HTTP \(code).")
                return
            }
            log.info("/live stream open — reading NDJSON")
            var lineCount = 0
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                lineCount += 1
                log.debug("stream[\(lineCount)] \(line, privacy: .public)")
                handleStreamLine(line)
            }
            log.info("/live stream closed after \(lineCount) lines, finalDelivered=\(self.finalDelivered)")
            // Stream closed naturally. If we never saw a final and we're
            // not in unavailable state, fall back to idle.
            if !Task.isCancelled, state != .idle, !isUnavailable() {
                state = .idle
                sessionId = nil
            }
        } catch is CancellationError {
            log.info("/live stream cancelled")
        } catch {
            log.error("/live stream failed: \(error.localizedDescription, privacy: .public)")
            state = .unavailable(reason: "Vox stream failed: \(error.localizedDescription)")
        }
    }

    private func isUnavailable() -> Bool {
        if case .unavailable = state { return true }
        return false
    }

    private func handleStreamLine(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let data = trimmed.data(using: .utf8),
              let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            log.error("could not parse line as JSON: \(line, privacy: .public)")
            return
        }
        if let errStr = msg["error"] as? String, !errStr.isEmpty {
            log.error("stream error from daemon: \(errStr, privacy: .public)")
            state = .unavailable(reason: errStr)
            return
        }
        if let event = msg["event"] as? String {
            let data = (msg["data"] as? [String: Any]) ?? [:]
            handleEvent(event, data: data)
            return
        }
        // Trailing `{result: {...}}` envelope arrives AFTER session.final
        // with the same payload. Only treat it as a final when we haven't
        // already delivered one this session.
        if !finalDelivered, let result = msg["result"] as? [String: Any] {
            handleEvent("session.final", data: result)
        }
    }

    private func handleEvent(_ event: String, data: [String: Any]) {
        switch event {
        case "session.state":
            if let sid = data["sessionId"] as? String, !sid.isEmpty {
                sessionId = sid
            }
            let s = (data["state"] as? String) ?? ""
            switch s {
            case "recording", "live":
                state = .recording
            case "finalizing", "processing":
                state = .processing
            case "error":
                let reason = (data["reason"] as? String) ?? "Vox reported a session error."
                state = .unavailable(reason: reason)
            default:
                break
            }
        case "session.partial":
            if let text = data["text"] as? String {
                partial = text
            }
        case "session.final":
            let text = (data["text"] as? String) ?? ""
            partial = ""
            sessionId = nil
            finalDelivered = true
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            log.info("session.final text=\"\(trimmed, privacy: .public)\" (len=\(trimmed.count))")
            if !trimmed.isEmpty {
                lastFinalText = text
            } else {
                log.info("session.final empty — nothing to splice into the dock")
            }
            state = .idle
        default:
            break
        }
    }

    private func postSessionControl(path: String, sessionId: String?) async {
        var req = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = sessionId.map { ["sessionId": $0] } ?? [:]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
    }
}

public typealias HudVoxService = ScoutVoxService
