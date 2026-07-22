import Testing
@testable import ScoutNativeCore

@Test func dictationBufferAppendsWithSingleSpace() {
    #expect(ScoutDictationBuffer.appending("there", to: "hello") == "hello there")
    #expect(ScoutDictationBuffer.appending("there", to: "hello ") == "hello there")
    #expect(ScoutDictationBuffer.appending("  there  ", to: "") == "there")
    #expect(ScoutDictationBuffer.appending("   ", to: "hello") == "hello")
}

@Test func dictationToggleDecisionMatchesState() {
    #expect(ScoutDictationController.toggleDecision(for: .probing) == .probeThenStartIfIdle)
    #expect(ScoutDictationController.toggleDecision(for: .idle) == .start)
    #expect(ScoutDictationController.toggleDecision(for: .starting) == .stop)
    #expect(ScoutDictationController.toggleDecision(for: .recording) == .stop)
    #expect(ScoutDictationController.toggleDecision(for: .processing) == .cancel)
    #expect(ScoutDictationController.toggleDecision(for: .unavailable(reason: "missing")) == .probeThenStartIfIdle)
}
