import Foundation
@testable import ScoutMenu
import XCTest

final class ManagedWebServiceTests: XCTestCase {
    func testBuildsCanonicalBrokerRestartRequest() throws {
        let request = try ManagedWebService.controlRequest(
            .restart,
            brokerURL: "http://0.0.0.0:43110/ignored?stale=1"
        )

        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:43110/v1/web/restart")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Forwarded-Host"), "scout.local")
    }

    func testResolvesSupervisedLogFromBrokerSupportDirectory() {
        let path = ManagedWebService.logPath(
            supportDirectory: "/tmp/reported-support",
            environment: ["OPENSCOUT_SUPPORT_DIRECTORY": "/tmp/env-support"],
            homeDirectory: URL(fileURLWithPath: "/tmp/home")
        )

        XCTAssertEqual(path, "/tmp/reported-support/logs/web/supervised-web.log")
    }

    func testFallsBackToCurrentSupportDirectoryInsteadOfLegacyScoutLog() {
        let overridden = ManagedWebService.logPath(
            supportDirectory: nil,
            environment: ["OPENSCOUT_SUPPORT_DIRECTORY": "/tmp/env-support"],
            homeDirectory: URL(fileURLWithPath: "/tmp/home")
        )
        let standard = ManagedWebService.logPath(
            supportDirectory: nil,
            environment: [:],
            homeDirectory: URL(fileURLWithPath: "/tmp/home")
        )

        XCTAssertEqual(overridden, "/tmp/env-support/logs/web/supervised-web.log")
        XCTAssertEqual(standard, "/tmp/home/Library/Application Support/OpenScout/logs/web/supervised-web.log")
        XCTAssertFalse(standard.contains(".scout/logs/web-server.log"))
    }

    func testBrokerStatusCarriesAuthoritativeSupportDirectory() throws {
        let data = Data("""
        {
          "label": "app.openscout",
          "launchAgentPath": "/tmp/app.openscout.plist",
          "brokerUrl": "http://0.0.0.0:43110",
          "effectiveBrokerUrl": "http://127.0.0.1:43110",
          "webUrl": "http://127.0.0.1:43120",
          "supportDirectory": "/tmp/OpenScout Support",
          "installed": true,
          "loaded": true,
          "pid": 123,
          "lastExitStatus": null,
          "reachable": true,
          "health": { "reachable": true, "ok": true, "error": null },
          "lastLogLine": null
        }
        """.utf8)

        let status = try JSONDecoder().decode(BrokerServiceStatus.self, from: data)

        XCTAssertEqual(status.supportDirectory, "/tmp/OpenScout Support")
        XCTAssertEqual(status.brokerURL, "http://127.0.0.1:43110")
    }
}
