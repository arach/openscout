import Testing
@testable import ScoutNativeCore

@Test func composeEnvelopeDefaultsToScoutbot() {
    let envelope = ScoutComposeRouting.envelope(body: "status please", targetHandle: nil)

    #expect(envelope?.resolvedTarget == "scoutbot")
    #expect(envelope?.body == "status please")
    #expect(envelope?.wireBody == "@scoutbot status please")
    #expect(envelope?.isDefaultTarget == true)
}

@Test func composeEnvelopeNormalizesExplicitTargetAndStripsBodyMentions() {
    let envelope = ScoutComposeRouting.envelope(
        body: "ask @Hudson and @studio.main",
        targetHandle: " @Ranger "
    )

    #expect(envelope?.resolvedTarget == "ranger")
    #expect(envelope?.body == "ask Hudson and studio.main")
    #expect(envelope?.wireBody == "@ranger ask Hudson and studio.main")
    #expect(envelope?.isDefaultTarget == false)
}

@Test func composeEnvelopeRoutesSessionTargetsAsDirectives() {
    let envelope = ScoutComposeRouting.envelope(
        body: "please continue here",
        targetHandle: " session:Codex-Native-123 "
    )

    #expect(envelope?.resolvedTarget == "session:Codex-Native-123")
    #expect(envelope?.body == "please continue here")
    #expect(envelope?.wireBody == "session:Codex-Native-123 please continue here")
    #expect(envelope?.isDefaultTarget == false)
}

@Test func composeEnvelopeRejectsBlankBody() {
    #expect(ScoutComposeRouting.envelope(body: "   \n", targetHandle: nil) == nil)
}
