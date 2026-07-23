import Foundation

public enum ScoutDictationState: Equatable, Sendable {
    case probing
    case idle
    case starting
    case recording
    case processing
    case unavailable(reason: String)

    public var isCaptureActive: Bool {
        self == .starting || self == .recording
    }

    public var isProcessing: Bool {
        self == .processing
    }

    public var isUnavailable: Bool {
        if case .unavailable = self { return true }
        return false
    }
}

public enum ScoutDictationToggleDecision: Equatable, Sendable {
    case probeThenStartIfIdle
    case start
    case stop
    /// Abort an in-flight session that can't be cleanly stopped — the escape
    /// hatch out of a hung `.processing` state so the mic is never stranded.
    case cancel
    case ignore
}

public enum ScoutDictationController {
    public static func toggleDecision(for state: ScoutDictationState) -> ScoutDictationToggleDecision {
        switch state {
        case .probing, .unavailable:
            return .probeThenStartIfIdle
        case .idle:
            return .start
        case .starting, .recording:
            return .stop
        case .processing:
            // Transcription can hang or retry indefinitely; a second tap must
            // cancel it rather than being ignored (which left the mic stuck on).
            return .cancel
        }
    }
}

public enum ScoutDictationBuffer {
    public static func appending(_ phrase: String, to current: String) -> String {
        let trimmedPhrase = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPhrase.isEmpty else { return current }
        guard !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return trimmedPhrase
        }

        let trailing = current.last?.isWhitespace ?? false
        return current + (trailing ? "" : " ") + trimmedPhrase
    }
}
