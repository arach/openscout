// Contract-fixture harness for the shared capability layer (SCO-061).
//
// As capabilities land, each gets golden JSON fixtures here (request bodies,
// responses, event frames). A transport adapter — macOS HTTP/SSE or iOS
// WS+tRPC — is "done" only when it round-trips these fixtures, which is what
// keeps the two adapters from drifting.

import XCTest
@testable import ScoutCapabilities

final class ScoutCapabilitiesTests: XCTestCase {
    func testContractVersionIsPinned() {
        // Guards against an accidental contract-version bump. Update
        // deliberately alongside the matching fixtures.
        XCTAssertEqual(ScoutCapabilities.contractVersion, 1)
    }
}
