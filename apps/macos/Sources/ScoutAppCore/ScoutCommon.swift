import Foundation
import ScoutCapabilities

public enum ScoutRelativeTime {
    public static func format(_ raw: TimeInterval?, now: Date = Date()) -> String {
        ScoutTimestamp.relativeAge(fromEpoch: raw, now: now) ?? "—"
    }

    public static func date(_ raw: TimeInterval?) -> Date? {
        ScoutTimestamp.date(fromEpoch: raw)
    }
}
