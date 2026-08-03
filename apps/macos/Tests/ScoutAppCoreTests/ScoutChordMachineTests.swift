import Foundation
@testable import ScoutAppCore
import XCTest

/// The chord machine's contract, with the re-arm defect pinned first.
final class ScoutChordMachineTests: XCTestCase {
    private enum Destination: Equatable {
        case section(String)
        case listStart
    }

    private func resolve(_ key: String) -> Destination? {
        switch key {
        case "c": return .section("comms")
        case "p": return .section("agents")
        case "g": return .listStart
        default: return nil
        }
    }

    func testPrefixArmsWithoutResolving() {
        var machine = ScoutChordMachine<Destination>()
        XCTAssertEqual(machine.handle(key: "g", resolve: resolve), .armed)
        XCTAssertTrue(machine.isArmed)
    }

    func testSecondKeyResolvesAndDisarms() {
        var machine = ScoutChordMachine<Destination>()
        _ = machine.handle(key: "g", resolve: resolve)
        XCTAssertEqual(
            machine.handle(key: "c", resolve: resolve),
            .resolved(.section("comms"))
        )
        XCTAssertFalse(machine.isArmed)
    }

    /// The defect this machine exists to prevent: `g g` must resolve to
    /// list-start and leave the machine idle. If the armed branch fell through
    /// to the arming branch, the second `g` would re-arm and swallow whatever
    /// the user typed next.
    func testDoublePrefixResolvesAndDoesNotReArm() {
        var machine = ScoutChordMachine<Destination>()
        _ = machine.handle(key: "g", resolve: resolve)
        XCTAssertEqual(machine.handle(key: "g", resolve: resolve), .resolved(.listStart))
        XCTAssertFalse(machine.isArmed)

        // The very next key must reach the surface untouched.
        XCTAssertEqual(machine.handle(key: "c", resolve: resolve), .ignored)
    }

    /// Armed-then-unknown clears the arm and stops. It must not re-arm, and it
    /// must not leave the next keystroke to be eaten.
    func testArmedThenUnknownCancelsWithoutReArming() {
        var machine = ScoutChordMachine<Destination>()
        _ = machine.handle(key: "g", resolve: resolve)
        XCTAssertEqual(machine.handle(key: "q", resolve: resolve), .cancelled)
        XCTAssertFalse(machine.isArmed)
        XCTAssertEqual(machine.handle(key: "c", resolve: resolve), .ignored)
    }

    func testUnarmedNonPrefixKeysAreIgnored() {
        var machine = ScoutChordMachine<Destination>()
        XCTAssertEqual(machine.handle(key: "c", resolve: resolve), .ignored)
        XCTAssertEqual(machine.handle(key: "j", resolve: resolve), .ignored)
        XCTAssertFalse(machine.isArmed)
    }

    func testResolutionIsCaseInsensitive() {
        var machine = ScoutChordMachine<Destination>()
        _ = machine.handle(key: "G", resolve: resolve)
        XCTAssertTrue(machine.isArmed)
        XCTAssertEqual(
            machine.handle(key: "C", resolve: resolve),
            .resolved(.section("comms"))
        )
    }

    func testDisarmIsIdempotent() {
        var machine = ScoutChordMachine<Destination>()
        _ = machine.handle(key: "g", resolve: resolve)
        machine.disarm()
        machine.disarm()
        XCTAssertFalse(machine.isArmed)
        XCTAssertEqual(machine.handle(key: "c", resolve: resolve), .ignored)
    }
}
