import Testing
@testable import ScoutHUD
import ScoutSharedUI

@MainActor
@Test func logicalComposerFocusBridgesAppKitResponderLag() {
    #expect(HUDKeyboardInput.isTextEditing(nil, logicalFocus: true))
    #expect(!HUDKeyboardInput.isTextEditing(nil, logicalFocus: false))
}

@MainActor
@Test func focusedComposerKeepsBareShortcutLettersAsText() {
    // h, j, k, l, i, m, f, g, and t are shortcuts in the HUD and/or main
    // window. Every one must remain ordinary text once the composer focuses.
    for keyCode: UInt16 in [4, 38, 40, 37, 34, 46, 3, 5, 17] {
        #expect(
            HUDKeyboardInput.shouldDeliverToTextEditor(
                keyCode: keyCode,
                textEditing: true,
                suggestionsVisible: false
            )
        )
    }
}

@MainActor
@Test func focusedComposerKeepsCaretNavigationAsEditing() {
    for keyCode: UInt16 in [123, 124, 125, 126] {
        #expect(
            HUDKeyboardInput.shouldDeliverToTextEditor(
                keyCode: keyCode,
                textEditing: true,
                suggestionsVisible: false
            )
        )
    }
}

@MainActor
@Test func focusedComposerOwnsItsCompleteKeyboardStream() {
    // Escape, Return, Tab, and suggestion arrows reach the shared composer
    // field first. Its local policy may handle them, but HUD/global navigation
    // must never pre-empt the editor.
    for keyCode: UInt16 in [53, 36, 48, 123, 124, 125, 126] {
        #expect(
            HUDKeyboardInput.shouldDeliverToTextEditor(
                keyCode: keyCode,
                textEditing: true,
                suggestionsVisible: true
            )
        )
    }
}

@Test func sharedComposerReturnPolicyPreservesNativeMultilineEditing() {
    #expect(
        MessageComposerKeyPolicy.returnAction(
            behavior: .commandReturn,
            commandPressed: false,
            controlPressed: false,
            shiftPressed: false,
            suggestionsVisible: false
        ) == .nativeEditing
    )
    #expect(
        MessageComposerKeyPolicy.returnAction(
            behavior: .commandReturn,
            commandPressed: true,
            controlPressed: false,
            shiftPressed: false,
            suggestionsVisible: false
        ) == .submit
    )
}

@Test func sharedComposerReturnPolicyKeepsHUDCompactAndSuggestionsPredictable() {
    #expect(
        MessageComposerKeyPolicy.returnAction(
            behavior: .returnKey,
            commandPressed: false,
            controlPressed: false,
            shiftPressed: false,
            suggestionsVisible: false
        ) == .submit
    )
    #expect(
        MessageComposerKeyPolicy.returnAction(
            behavior: .returnKey,
            commandPressed: false,
            controlPressed: false,
            shiftPressed: false,
            suggestionsVisible: true
        ) == .acceptSuggestion
    )
}

@Test func latestAppleSpeechIsTheDefaultModernEnginePolicy() {
    #expect(
        ScoutVoiceEnginePolicy.usesSpeechAnalyzer(
            preference: .apple,
            speechAnalyzerAvailable: true
        )
    )
    #expect(
        ScoutVoiceEnginePolicy.usesSpeechAnalyzer(
            preference: .auto,
            speechAnalyzerAvailable: true
        )
    )
    #expect(
        !ScoutVoiceEnginePolicy.usesSpeechAnalyzer(
            preference: .parakeet,
            speechAnalyzerAvailable: true
        )
    )
    #expect(
        !ScoutVoiceEnginePolicy.usesSpeechAnalyzer(
            preference: .apple,
            speechAnalyzerAvailable: false
        )
    )
}
