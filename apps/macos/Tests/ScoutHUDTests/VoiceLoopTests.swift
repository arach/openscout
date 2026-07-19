import Testing
import ScoutAppCore
@testable import ScoutHUD

// Unit tests for the voice-loop decision cores.
//
// NOTE: these cover the *pure* decision functions that back the feature —
// they are deliberately dependency-free so no network / audio / mic mock is
// needed. They are NOT wired into the build yet: apps/macos does not have a
// ScoutHUD test target, and Package.swift is outside this change's scope. To
// run them, add:
//
//     .testTarget(
//         name: "ScoutHUDTests",
//         dependencies: ["ScoutHUD", "ScoutAppCore"],
//         path: "Tests/ScoutHUDTests"
//     )
//
// to apps/macos/Package.swift, then:
//
//     HUDSONKIT_WITH_VOICE=1 HUDSONKIT_WITH_TERMINAL=1 \
//         swift test --filter VoiceLoop
//
// The functions under test are MainActor-isolated (they live on
// @MainActor types), so the tests are annotated @MainActor.

// (a) Armed hold + final transcript → exactly one send to the target.
@MainActor
@Test func armedHoldWithTargetSendsOnce() {
    let outcome = HUDDockState.holdToTalkOutcome(
        finalText: "  ship the diff  ",
        armed: true,
        hasTarget: true
    )
    #expect(outcome == .sendToTarget("ship the diff"))
}

// Armed hold with no target falls back to edit-first splice (no send).
@MainActor
@Test func armedHoldWithoutTargetSplices() {
    let outcome = HUDDockState.holdToTalkOutcome(
        finalText: "note this",
        armed: true,
        hasTarget: false
    )
    #expect(outcome == .spliceIntoBuffer("note this"))
}

// (b) Esc cancel disarms → a later final resolves to .ignore (no send).
@MainActor
@Test func disarmedFinalDoesNotSend() {
    let outcome = HUDDockState.holdToTalkOutcome(
        finalText: "should not send",
        armed: false,
        hasTarget: true
    )
    #expect(outcome == .ignore)
}

// Empty / whitespace-only transcript is ignored even when armed.
@MainActor
@Test func emptyArmedFinalIsIgnored() {
    #expect(
        HUDDockState.holdToTalkOutcome(finalText: "   ", armed: true, hasTarget: true) == .ignore
    )
}

// (c) Speaker primes on the latest id → history is never spoken.
@MainActor
@Test func speakerPrimesOnHistory() {
    let thread = [
        ScoutAssistantMessage(id: "m1", source: .scout, at: "10:00", body: [.text("old one")]),
        ScoutAssistantMessage(id: "m2", source: .scout, at: "10:01", body: [.text("old two")]),
    ]
    // Priming seeds the dedupe set with everything currently on screen.
    let primed = Set(thread.map(\.id))
    let fresh = HUDReplySpeaker.newMessagesToSpeak(thread: thread, spoken: primed)
    #expect(fresh.isEmpty)
}

// A new assistant reply arriving after priming is spoken; operator echoes
// (source == .operatorYou) are never spoken.
@MainActor
@Test func onlyNewAssistantRepliesAreSpoken() {
    let primed: Set<String> = ["m1"]
    let thread = [
        ScoutAssistantMessage(id: "m1", source: .scout, at: "10:00", body: [.text("old")]),
        ScoutAssistantMessage(id: "you", source: .operatorYou, at: "10:01", body: [.text("mine")]),
        ScoutAssistantMessage(id: "m2", source: .scout, at: "10:02", body: [.text("new reply")]),
    ]
    let fresh = HUDReplySpeaker.newMessagesToSpeak(thread: thread, spoken: primed)
    #expect(fresh.map(\.id) == ["m2"])
}

// (d) The same message id is never spoken twice, even across gate toggles.
@MainActor
@Test func spokenIdIsNeverRepeated() {
    let thread = [
        ScoutAssistantMessage(id: "m2", source: .scout, at: "10:02", body: [.text("reply")]),
    ]
    // First pass: m2 is fresh.
    var spoken: Set<String> = ["m1"]
    let firstPass = HUDReplySpeaker.newMessagesToSpeak(thread: thread, spoken: spoken)
    #expect(firstPass.map(\.id) == ["m2"])
    // Mark spoken (what handleThread does), then a re-emission yields nothing.
    spoken.formUnion(firstPass.map(\.id))
    let secondPass = HUDReplySpeaker.newMessagesToSpeak(thread: thread, spoken: spoken)
    #expect(secondPass.isEmpty)
}

// Markdown flattening drops code blocks, emphasis, and reduces links.
@MainActor
@Test func spokenTextFlattensMarkdown() {
    let flat = HUDReplySpeaker.toSpokenText("**Bold** and `code` and [click](https://x.io)")
    #expect(flat == "Bold and code and click")
    #expect(HUDReplySpeaker.toSpokenText("```\nlet x = 1\n```").contains("code omitted"))
}

// The cap prefers a sentence boundary within the limit.
@MainActor
@Test func capPrefersSentenceBoundary() {
    let text = "First sentence. Second sentence that runs on and on and on."
    let capped = HUDReplySpeaker.cap(text, maxChars: 20)
    #expect(capped == "First sentence.")
}
