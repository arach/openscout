import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutEndpointsTests: XCTestCase {
    func testHostInfoSuppliesLocalWebAndBrokerURLs() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://0.0.0.0:65535",
            webURL: "http://0.0.0.0:3200"
        )

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutWeb.baseURL().port, 3200)
            XCTAssertEqual(ScoutBroker.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutBroker.baseURL().port, 65535)
        }
    }

    func testExplicitEnvironmentWinsOverHostInfo() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://127.0.0.1:65535",
            webURL: "http://127.0.0.1:3200"
        )

        withEndpointEnvironment(
            supportDirectory: supportDirectory,
            values: [
                "OPENSCOUT_WEB_URL": "http://localhost:6000",
                "OPENSCOUT_BROKER_URL": "http://localhost:6001",
            ]
        ) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "localhost")
            XCTAssertEqual(ScoutWeb.baseURL().port, 6000)
            XCTAssertEqual(ScoutBroker.baseURL().host(percentEncoded: false), "localhost")
            XCTAssertEqual(ScoutBroker.baseURL().port, 6001)
        }
    }

    func testHostInfoPrefersLocalServiceEndpointOverAdvertisedMeshURL() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://mini.tailnet.test:65535",
            webURL: "http://web.tailnet.test:3200",
            brokerServiceHost: "0.0.0.0",
            brokerServicePort: 65535,
            webServiceHost: "127.0.0.1",
            webServicePort: 3200
        )

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutWeb.baseURL().port, 3200)
            XCTAssertEqual(ScoutBroker.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutBroker.baseURL().port, 65535)
        }
    }

    func testStaleHostInfoIsIgnored() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: (Date().timeIntervalSince1970 - (48 * 60 * 60)) * 1000,
            brokerURL: "http://127.0.0.1:54321",
            webURL: "http://127.0.0.1:54322"
        )

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            XCTAssertNotEqual(ScoutWeb.baseURL().port, 54322)
            XCTAssertNotEqual(ScoutBroker.baseURL().port, 54321)
        }
    }
}

private let endpointEnvironmentKeys = [
    "OPENSCOUT_SUPPORT_DIRECTORY",
    "OPENSCOUT_WEB_URL",
    "OPENSCOUT_WEB_BUN_URL",
    "OPENSCOUT_WEB_PUBLIC_ORIGIN",
    "OPENSCOUT_WEB_PORT",
    "OPENSCOUT_WEB_HOST",
    "SCOUT_WEB_PORT",
    "OPENSCOUT_BROKER_URL",
    "OPENSCOUT_BROKER_PORT",
    "OPENSCOUT_BROKER_HOST",
]

private func makeSupportDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("openscout-host-info-tests")
        .appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: nil
    )
    return directory
}

private func removeDirectory(_ directory: URL) {
    try? FileManager.default.removeItem(at: directory)
}

private func writeHostInfo(
    supportDirectory: URL,
    updatedAtMs: Double,
    brokerURL: String,
    webURL: String,
    brokerServiceHost: String? = nil,
    brokerServicePort: Int? = nil,
    webServiceHost: String? = nil,
    webServicePort: Int? = nil
) throws {
    let services: String
    if let brokerServiceHost,
       let brokerServicePort,
       let webServiceHost,
       let webServicePort {
        services = """
          ,
          "services": {
            "broker": {
              "url": "\(brokerURL)",
              "host": "\(brokerServiceHost)",
              "port": \(brokerServicePort)
            },
            "web": {
              "url": "\(webURL)",
              "host": "\(webServiceHost)",
              "port": \(webServicePort)
            }
          }
        """
    } else {
        services = ""
    }
    let body = """
    {
      "schemaVersion": 1,
      "source": "test",
      "updatedAtMs": \(updatedAtMs),
      "brokerUrl": "\(brokerURL)",
      "webUrl": "\(webURL)"
    \(services)
    }
    """
    try body.write(
        to: supportDirectory.appendingPathComponent(".host-info"),
        atomically: true,
        encoding: .utf8
    )
}

private func withEndpointEnvironment(
    supportDirectory: URL,
    values: [String: String] = [:],
    body: () -> Void
) {
    let previous = Dictionary(uniqueKeysWithValues: endpointEnvironmentKeys.map { key in
        (key, ProcessInfo.processInfo.environment[key])
    })

    for key in endpointEnvironmentKeys {
        unsetenv(key)
    }
    setenv("OPENSCOUT_SUPPORT_DIRECTORY", supportDirectory.path, 1)
    for (key, value) in values {
        setenv(key, value, 1)
    }

    defer {
        for key in endpointEnvironmentKeys {
            if case .some(.some(let value)) = previous[key] {
                setenv(key, value, 1)
            } else {
                unsetenv(key)
            }
        }
    }

    body()
}
