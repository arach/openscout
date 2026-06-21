import XCTest
@testable import ScoutCapabilities

final class ScoutTimestampTests: XCTestCase {
    func testNormalizesEpochSecondsAndMilliseconds() {
        XCTAssertEqual(ScoutTimestamp.epochMilliseconds(1_700_000_000), 1_700_000_000_000)
        XCTAssertEqual(ScoutTimestamp.epochMilliseconds(1_700_000_000_000), 1_700_000_000_000)
        XCTAssertNil(ScoutTimestamp.epochMilliseconds(nil))
        XCTAssertNil(ScoutTimestamp.epochMilliseconds(.nan))
        XCTAssertNil(ScoutTimestamp.epochMilliseconds(0))
    }

    func testRelativeAgeSurfacesFutureSkew() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)

        XCTAssertEqual(
            ScoutTimestamp.relativeAge(since: now.addingTimeInterval(-300), now: now),
            "5m"
        )
        XCTAssertEqual(
            ScoutTimestamp.relativeAge(since: now.addingTimeInterval(300), now: now),
            "in 5m"
        )
    }
}
