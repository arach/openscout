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
            return .ignore
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
