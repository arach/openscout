import SwiftUI
import HudsonVoice

/// Parakeet dictation driven through HudsonKit's `HudVoxLiveSession`, which speaks
/// the local Vox daemon's WebSocket JSON-RPC contract. The *daemon* owns the
/// microphone and runs Parakeet, so this app captures no audio itself and needs
/// no microphone entitlement — it sends start/stop and folds the partial/final
/// transcript events back into a small, observable state machine.
@MainActor
@Observable
final class VoiceDictation {
    enum State: Equatable {
        case idle
        case starting
        case recording
        case processing
        case unavailable(String)
    }

    private(set) var state: State = .idle
    /// Live (non-final) transcript for the current utterance, shown as a preview.
    private(set) var partialText: String = ""

    private var session: HudVoxLiveSession?
    private var listenTask: Task<Void, Never>?
    private var onFinal: ((String) -> Void)?

    var isCapturing: Bool {
        switch state {
        case .starting, .recording: return true
        case .idle, .processing, .unavailable: return false
        }
    }

    /// Tap-to-toggle: idle → begin dictating; capturing/processing → finish.
    func toggle(onFinal: @escaping (String) -> Void) {
        switch state {
        case .idle, .unavailable: start(onFinal: onFinal)
        case .starting, .recording, .processing: stop()
        }
    }

    /// Tear down any in-flight session (e.g. when leaving the conversation).
    func cancel() {
        if let session {
            Task { try? await session.cancel() }
        }
        teardown(resetTo: .idle)
    }

    private func start(onFinal: @escaping (String) -> Void) {
        guard session == nil else { return }
        self.onFinal = onFinal
        state = .starting
        partialText = ""
        let session = HudVoxLiveSession()
        self.session = session
        listenTask = Task { [weak self] in
            do {
                let stream = try await session.start()
                for try await event in stream {
                    self?.handle(event)
                }
                self?.teardown(resetTo: .idle)
            } catch {
                self?.teardown(resetTo: .unavailable("Voice unavailable"))
            }
        }
    }

    private func stop() {
        guard let session else { return }
        if state != .processing { state = .processing }
        Task { try? await session.stop() }
    }

    private func handle(_ event: HudVoiceEvent) {
        switch event {
        case .state(let s):
            switch s.state {
            case .starting:  state = .starting
            case .recording: state = .recording
            case .processing: state = .processing
            case .done, .cancelled: teardown(resetTo: .idle)
            case .error: teardown(resetTo: .unavailable("Vox error"))
            }
        case .partial(let p):
            partialText = p.text
            if !isCapturing { state = .recording }
        case .final(let f):
            let text = f.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { onFinal?(text) }
            partialText = ""
        case .raw:
            break
        }
    }

    private func teardown(resetTo newState: State) {
        listenTask?.cancel()
        listenTask = nil
        session?.close()
        session = nil
        partialText = ""
        onFinal = nil
        state = newState
    }
}

/// Compact cockpit mic glyph — a hand-drawn capsule body, pickup arc, and stand,
/// stroked so it can pick up the composer's recording/idle tint.
struct MicGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()
        let body = CGRect(x: rect.minX + 5 * sx, y: rect.minY + 2 * sy, width: 4 * sx, height: 6.5 * sy)
        let radius = 2 * min(sx, sy)
        path.addRoundedRect(in: body, cornerSize: CGSize(width: radius, height: radius))
        path.move(to: p(4, 8.5))
        path.addQuadCurve(to: p(10, 8.5), control: p(7, 13.5))
        path.move(to: p(7, 11))
        path.addLine(to: p(7, 12.7))
        path.move(to: p(5, 12.7))
        path.addLine(to: p(9, 12.7))
        return path
    }
}
