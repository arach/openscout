import AVFoundation
import Testing
@testable import ScoutSharedUI

@available(macOS 26.0, *)
@MainActor
@Test func speechAnalyzerAudioTapRunsOutsideTheMainActor() async throws {
    let callback = ScoutSpeechAnalyzerDictation.makeAudioTap { _ in }

    // AVFAudio invokes its tap on RealtimeMessenger.mServiceQueue rather than
    // the actor that installed it. A callback that accidentally inherits the
    // main actor traps here before its body runs, matching the production crash.
    try await Task.detached {
        let format = try #require(
            AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)
        )
        let buffer = try #require(
            AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 64)
        )
        callback(buffer, AVAudioTime(sampleTime: 0, atRate: 16_000))
    }.value
}
