import ScoutAppCore
import SwiftUI

/// Reveal delays for the two progressive-disclosure hints.
///
/// Both are the same idea: the binding fires immediately, the *hint* waits.
/// Someone who knows the chord never sees a flash; someone who hesitates gets
/// taught. Tuned so a deliberate hold reads as intentional and a fast keystroke
/// stays silent.
enum ScoutKeyboardTiming {
    /// `g` armed → palette painted.
    static let chordHintNanoseconds: UInt64 = 180_000_000
    /// ⌘ down → conversation digits painted.
    static let jumpRevealNanoseconds: UInt64 = 260_000_000
}

/// Where a resolved `g` chord lands.
enum ScoutChordDestination: Equatable {
    case section(ScoutSection)
    /// First row of whatever list the active surface is showing.
    case listStart
    /// The section you came from — `⌘⇥` for the rail.
    case back
}

/// The keyboard's single source of truth.
///
/// The chord table, the rail palette, and the `?` cheatsheet all read this
/// file, so the help can't describe a binding that doesn't exist and a new
/// destination can't ship undocumented. Adding a section here is the whole
/// change; every consumer picks it up.
///
/// Letters are mnemonics, so they are matched against
/// `charactersIgnoringModifiers` — the letter the user thinks they pressed —
/// never `keyCode`, which would bind the physical position and break the
/// mnemonic on a non-QWERTY layout.
enum ScoutKeyMap {
    struct Destination: Identifiable {
        let section: ScoutSection
        let chord: String
        var id: ScoutSection { section }
    }

    struct Extra: Identifiable {
        let key: String
        let label: String
        var id: String { key }
    }

    /// Rail order. The palette renders this list top to bottom, the cheatsheet
    /// reads down its columns in the same order, so the sheet rehearses the
    /// muscle memory rather than teaching a second one.
    ///
    /// Two letters aren't initials, and both yield to a busier neighbour:
    /// Tail takes `f` (`tail -f`) so Terminals keeps `t`, and Code takes `e`
    /// (editor) so Comms keeps `c`.
    static let destinations: [Destination] = [
        Destination(section: .comms, chord: "c"),
        Destination(section: .agents, chord: "p"),
        Destination(section: .terminals, chord: "t"),
        Destination(section: .tail, chord: "f"),
        Destination(section: .dispatch, chord: "d"),
        Destination(section: .lanes, chord: "l"),
        Destination(section: .repos, chord: "r"),
        Destination(section: .code, chord: "e"),
        Destination(section: .settings, chord: "s"),
    ]

    /// Chord keys that aren't destinations.
    static let extras: [Extra] = [
        Extra(key: "g", label: "top"),
        Extra(key: "b", label: "back"),
    ]

    /// How many conversations carry a ⌘-digit jump target. Nine, because
    /// ⌘0 is not a tenth — it is a different key with different habits.
    static let jumpTargetCount = 9

    static func resolveChord(_ key: String) -> ScoutChordDestination? {
        if let match = destinations.first(where: { $0.chord == key }) {
            return .section(match.section)
        }
        switch key {
        case "g": return .listStart
        case "b": return .back
        default: return nil
        }
    }

    static func chord(for section: ScoutSection) -> String? {
        destinations.first { $0.section == section }?.chord
    }

    // MARK: Help content

    struct HelpEntry: Identifiable {
        let keys: String
        let detail: String
        var id: String { keys + detail }
    }

    /// Bindings that only exist on one surface. The cheatsheet shows the active
    /// section's list first and drops the other eight — the old sheet stacked
    /// all of them at equal weight, so six-sevenths of it was always noise.
    static func contextEntries(for section: ScoutSection) -> [HelpEntry] {
        switch section {
        case .comms:
            return [
                HelpEntry(keys: "⌘N", detail: "new chat"),
                HelpEntry(keys: "⌘K", detail: "focus search"),
                HelpEntry(keys: "⌘L", detail: "focus composer"),
                HelpEntry(keys: "⌥⌘1 2 3", detail: "all · direct · shared"),
                HelpEntry(keys: "⌘V", detail: "paste image"),
                HelpEntry(keys: "↵ · ⇧↵", detail: "send · newline"),
            ]
        case .agents:
            return [
                HelpEntry(keys: "l · h", detail: "expand · collapse"),
                HelpEntry(keys: "↵", detail: "open session"),
                HelpEntry(keys: "⌘O", detail: "observe agent"),
            ]
        case .terminals:
            return [HelpEntry(keys: "⌘N", detail: "new shell")]
        case .tail:
            return [HelpEntry(keys: "↵", detail: "load session")]
        case .repos:
            return [
                HelpEntry(keys: "l · h", detail: "expand · collapse"),
                HelpEntry(keys: "⌘↩", detail: "reveal in Finder"),
            ]
        case .lanes:
            return [HelpEntry(keys: "⌘R", detail: "refresh embed")]
        case .dispatch, .code, .settings:
            return []
        }
    }

    /// Bindings that mean the same thing on every list surface.
    static let moveEntries: [HelpEntry] = [
        HelpEntry(keys: "j · k", detail: "next · previous"),
        HelpEntry(keys: "⌘↓ ⌘↑", detail: "same, while typing"),
        HelpEntry(keys: "g g · ⇧G", detail: "first · last"),
        HelpEntry(keys: "↵", detail: "open selection"),
        HelpEntry(keys: "Esc", detail: "leave the composer"),
    ]
}
