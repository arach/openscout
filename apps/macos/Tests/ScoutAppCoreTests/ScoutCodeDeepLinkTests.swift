import Foundation
import Testing
@testable import ScoutAppCore

@Suite("Scout code deep links")
struct ScoutCodeDeepLinkTests {
    @Test("parses scout://{project}/{path}")
    func parsesProjectPath() throws {
        let url = try #require(URL(string: "scout://openscout/packages/web/foo.ts?line=12"))
        let target = try #require(ScoutCodeDeepLink.parse(url))
        #expect(target.project == "openscout")
        #expect(target.path == "packages/web/foo.ts")
        #expect(target.line == 12)
        #expect(target.root == nil)
    }

    @Test("parses absolute scout:///path")
    func parsesAbsolute() throws {
        let url = try #require(URL(string: "scout:///Users/art/dev/openscout/foo.ts"))
        let target = try #require(ScoutCodeDeepLink.parse(url))
        #expect(target.root == "/Users/art/dev/openscout/foo.ts")
        #expect(target.file == "/Users/art/dev/openscout/foo.ts")
        #expect(target.project == nil)
    }

    @Test("parses scout://file/ absolute form")
    func parsesFileHost() throws {
        let url = try #require(URL(string: "scout://file/Users/art/dev/openscout/foo.ts?line=3"))
        let target = try #require(ScoutCodeDeepLink.parse(url))
        #expect(target.file == "/Users/art/dev/openscout/foo.ts")
        #expect(target.line == 3)
    }

    @Test("parses legacy scout://code/...")
    func parsesLegacyCodeHost() throws {
        let url = try #require(URL(string: "scout://code/openscout/README.md?wt=comms"))
        let target = try #require(ScoutCodeDeepLink.parse(url))
        #expect(target.project == "openscout")
        #expect(target.path == "README.md")
        #expect(target.wt == "comms")
    }

    @Test("rejects other scout hosts")
    func rejectsOtherHosts() throws {
        let terminal = try #require(URL(string: "scout://terminal?session=x&surface=tmux:s"))
        let hud = try #require(URL(string: "scout://hud/toggle"))
        let asks = try #require(URL(string: "scout://asks/new"))
        #expect(ScoutCodeDeepLink.parse(terminal) == nil)
        #expect(ScoutCodeDeepLink.parse(hud) == nil)
        #expect(ScoutCodeDeepLink.parse(asks) == nil)
    }

    @Test("formats project links and builds embed query items")
    func formatsAndQueryItems() {
        let target = ScoutCodeDeepLink.Target(
            project: "openscout",
            path: "a/b.ts",
            wt: "comms",
            line: 4,
            endLine: 9
        )
        #expect(ScoutCodeDeepLink.format(target) ==
            "scout://openscout/a/b.ts?wt=comms&line=4&endLine=9")
        let items = ScoutCodeDeepLink.queryItems(for: target)
        #expect(items.contains(where: { $0.name == "project" && $0.value == "openscout" }))
        #expect(items.contains(where: { $0.name == "path" && $0.value == "a/b.ts" }))
        #expect(items.contains(where: { $0.name == "wt" && $0.value == "comms" }))
        #expect(items.contains(where: { $0.name == "line" && $0.value == "4" }))
    }

    @Test("formats absolute file links")
    func formatsAbsolute() {
        let target = ScoutCodeDeepLink.Target(file: "/Users/art/dev/openscout/foo.ts", line: 2)
        #expect(ScoutCodeDeepLink.format(target) ==
            "scout:///Users/art/dev/openscout/foo.ts?line=2")
    }
}
