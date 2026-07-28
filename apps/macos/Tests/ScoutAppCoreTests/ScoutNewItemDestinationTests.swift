import ScoutAppCore
import Testing

struct ScoutNewItemDestinationTests {
    @Test
    func terminalsCreateAShellInPlace() {
        #expect(
            ScoutNewItemDestination.resolve(sectionRawValue: "terminals") == .terminalShell
        )
    }

    @Test(arguments: ["comms", "agents", "repos", "tail", "settings"])
    func otherSectionsRetainNewConversation(_ section: String) {
        #expect(
            ScoutNewItemDestination.resolve(sectionRawValue: section) == .conversation
        )
    }
}
