import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutRunnerServiceTests: XCTestCase {
    func testDecodesRunnerModelVersionAndEffortMetadata() throws {
        let options = try decodeOptions(#"""
        {
          "defaults": {
            "runner": "scout",
            "directory": "/repo",
            "harness": "codex",
            "model": "gpt-5.6-sol",
            "reasoningEffort": "high",
            "persistence": "sticky"
          },
          "runners": [{"id":"scout","label":"Scout","supports":["codex"]}],
          "harnesses": [{"id":"codex","name":"codex","label":"Codex"}],
          "models": [{
            "id":"gpt-5.6-sol",
            "label":"GPT-5.6 Sol",
            "harnesses":["codex"],
            "source":"default",
            "family":"GPT",
            "version":"5.6 Sol"
          }],
          "efforts": [{
            "id":"high",
            "label":"High",
            "description":"Deeper pass",
            "harnesses":["codex"]
          }],
          "projects": [],
          "agents": []
        }
        """#)

        XCTAssertEqual(options.defaults?.reasoningEffort, "high")
        XCTAssertEqual(options.models.first?.family, "GPT")
        XCTAssertEqual(options.models.first?.version, "5.6 Sol")
        XCTAssertEqual(options.efforts?.first?.id, "high")
    }

    func testDecodesLegacyRunnerOptionsWithoutNewRuntimeMetadata() throws {
        let options = try decodeOptions(#"""
        {
          "defaults": {"harness":"claude","model":"opus"},
          "runners": [],
          "harnesses": [],
          "models": [{"id":"opus","label":"Opus","harnesses":["claude"]}],
          "projects": [],
          "agents": []
        }
        """#)

        XCTAssertNil(options.defaults?.reasoningEffort)
        XCTAssertNil(options.models.first?.family)
        XCTAssertNil(options.models.first?.version)
        XCTAssertNil(options.efforts)
    }

    private func decodeOptions(_ json: String) throws -> HudRunnerOptions {
        try JSONDecoder().decode(HudRunnerOptions.self, from: Data(json.utf8))
    }
}
