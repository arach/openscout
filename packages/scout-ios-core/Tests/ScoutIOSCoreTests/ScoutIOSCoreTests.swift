import Foundation
import XCTest
@testable import ScoutIOSCore

final class ScoutIOSCoreTests: XCTestCase {
    func testTransportClassification() {
        XCTAssertEqual(classifyTransport(host: "192.168.1.10"), .lan)
        XCTAssertEqual(classifyTransport(host: "100.64.0.1"), .tailnet)
        XCTAssertEqual(classifyTransport(host: "bridge.tailnet.ts.net"), .tailnet)
        XCTAssertEqual(classifyTransport(host: "oscout.net"), .oscout)
        XCTAssertEqual(classifyTransport(host: "localhost"), .loopback)
        XCTAssertEqual(transportKind(forRelayURL: "ws://10.0.0.5:8080").label, "LAN")
    }
}
