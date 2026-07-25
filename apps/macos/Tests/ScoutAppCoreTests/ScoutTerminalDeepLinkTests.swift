import Foundation
import Testing
@testable import ScoutAppCore

@Suite("Scout terminal deep links")
struct ScoutTerminalDeepLinkTests {
    @Test("maps an exact tmux target into the embedded web terminal route")
    func mapsTmuxTarget() throws {
        let url = try #require(URL(string:
            "scout://terminal?session=discovered.tmux.pomo&surface=tmux%3Asession-ms0hf3f7-3ngln1&mode=takeover"
        ))

        #expect(ScoutTerminalDeepLink.routePath(from: url) ==
            "/terminal?session=discovered.tmux.pomo&surface=tmux:session-ms0hf3f7-3ngln1&mode=takeover")
    }

    @Test("defaults unknown modes to takeover and rejects incomplete targets")
    func validatesTarget() throws {
        let safeURL = try #require(URL(string:
            "scout://terminal?session=registered.1&surface=zellij%3Ascout-zj&mode=unknown"
        ))
        let incompleteURL = try #require(URL(string:
            "scout://terminal?session=registered.1"
        ))

        #expect(ScoutTerminalDeepLink.routePath(from: safeURL) ==
            "/terminal?session=registered.1&surface=zellij:scout-zj&mode=takeover")
        #expect(ScoutTerminalDeepLink.routePath(from: incompleteURL) == nil)
    }
}
