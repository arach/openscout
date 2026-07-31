import Foundation
import Testing
@testable import ScoutHUD

@MainActor
@Test func productAskURLRoutesToAskComposer() throws {
    let url = try #require(URL(string: "scout://asks/new?anchor=bottom-left"))
    let userInfo = try #require(ScoutHUDRouter.distributedUserInfo(url: url))

    #expect(userInfo["command"] as? String == "ask")
    #expect(userInfo["value"] as? String == "bottom-left")
}

@MainActor
@Test func askCollectionURLAlsoOpensFreshAsk() throws {
    let url = try #require(URL(string: "scout://asks"))
    let userInfo = try #require(ScoutHUDRouter.distributedUserInfo(url: url))

    #expect(userInfo["command"] as? String == "ask")
    #expect(userInfo["value"] == nil)
}

@MainActor
@Test func legacyHudTaskURLRemainsCompatible() throws {
    let url = try #require(URL(string: "scout://hud/task/bottom-right"))
    let userInfo = try #require(ScoutHUDRouter.distributedUserInfo(url: url))

    #expect(userInfo["command"] as? String == "task")
    #expect(userInfo["value"] as? String == "bottom-right")
}

@MainActor
@Test func unknownAskActionFailsClosed() throws {
    let url = try #require(URL(string: "scout://asks/delete"))
    #expect(ScoutHUDRouter.distributedUserInfo(url: url) == nil)
}
