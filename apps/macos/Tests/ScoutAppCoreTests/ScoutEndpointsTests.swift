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

    func testPublicOriginDoesNotOverrideHostInfoForNativeClientLoads() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://127.0.0.1:43110",
            webURL: "http://127.0.0.1:43120",
            extraFields: """
              "ports": {
                "broker": 43110,
                "web": 43120
              },
              "services": {
                "web": {
                  "host": "127.0.0.1",
                  "port": 43120,
                  "url": "http://127.0.0.1:43120"
                }
              }
            """
        )

        withEndpointEnvironment(
            supportDirectory: supportDirectory,
            values: ["OPENSCOUT_WEB_PUBLIC_ORIGIN": "http://scout.local"]
        ) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutWeb.baseURL().port, 43120)
        }
    }

    func testPublicOriginDoesNotOverrideExplicitWebPortForNativeClientLoads() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }

        withEndpointEnvironment(
            supportDirectory: supportDirectory,
            values: [
                "OPENSCOUT_WEB_PUBLIC_ORIGIN": "http://scout.local",
                "OPENSCOUT_WEB_PORT": "44555",
            ]
        ) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutWeb.baseURL().port, 44555)
        }
    }

    func testAttachmentURLsUseLocalWebWhenPublicOriginIsConfigured() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://127.0.0.1:43110",
            webURL: "http://127.0.0.1:43120",
            extraFields: """
              "services": {
                "web": {
                  "host": "127.0.0.1",
                  "port": 43120,
                  "url": "http://127.0.0.1:43120"
                }
              }
            """
        )

        withEndpointEnvironment(
            supportDirectory: supportDirectory,
            values: ["OPENSCOUT_WEB_PUBLIC_ORIGIN": "http://scout.local"]
        ) {
            let url = ScoutWeb.attachmentURL("http://scout.local/api/blobs/blob-1?download=1")
            XCTAssertEqual(url?.scheme, "http")
            XCTAssertEqual(url?.host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(url?.port, 43120)
            XCTAssertEqual(url?.path, "/api/blobs/blob-1")
            XCTAssertEqual(url?.query, "download=1")
        }
    }

    func testAttachmentURLKeepsExternalAbsoluteURLs() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            XCTAssertEqual(
                ScoutWeb.attachmentURL("https://example.com/files/image.png")?.absoluteString,
                "https://example.com/files/image.png"
            )
        }
    }

    func testRelativeAttachmentURLResolvesAgainstLocalWeb() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://127.0.0.1:43110",
            webURL: "http://127.0.0.1:43120"
        )

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            let url = ScoutWeb.attachmentURL("/api/blobs/blob-2")
            XCTAssertEqual(url?.host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(url?.port, 43120)
            XCTAssertEqual(url?.path, "/api/blobs/blob-2")
        }
    }

    func testHostInfoPrefersLocalBrokerServiceOverAdvertisedMeshURL() throws {
        let supportDirectory = try makeSupportDirectory()
        defer { removeDirectory(supportDirectory) }
        try writeHostInfo(
            supportDirectory: supportDirectory,
            updatedAtMs: Date().timeIntervalSince1970 * 1000,
            brokerURL: "http://mac.tailnet.ts.net:43110",
            webURL: "http://127.0.0.1:43120",
            extraFields: """
              "advertiseScope": "mesh",
              "ports": {
                "broker": 43110,
                "web": 43120
              },
              "services": {
                "broker": {
                  "host": "0.0.0.0",
                  "port": 43110,
                  "url": "http://mac.tailnet.ts.net:43110"
                },
                "web": {
                  "host": "127.0.0.1",
                  "port": 43120,
                  "url": "http://127.0.0.1:43120"
                }
              }
            """
        )

        withEndpointEnvironment(supportDirectory: supportDirectory) {
            XCTAssertEqual(ScoutWeb.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutWeb.baseURL().port, 43120)
            XCTAssertEqual(ScoutBroker.baseURL().host(percentEncoded: false), "127.0.0.1")
            XCTAssertEqual(ScoutBroker.baseURL().port, 43110)
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
    extraFields: String = ""
) throws {
    let normalizedExtraFields = extraFields.trimmingCharacters(in: .whitespacesAndNewlines)
    let extraFieldsBody = normalizedExtraFields.isEmpty ? "" : ",\n\(normalizedExtraFields)"
    let body = """
    {
      "schemaVersion": 1,
      "source": "test",
      "updatedAtMs": \(updatedAtMs),
      "brokerUrl": "\(brokerURL)",
      "webUrl": "\(webURL)"\(extraFieldsBody)
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
