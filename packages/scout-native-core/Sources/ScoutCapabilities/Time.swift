import Foundation

public enum ScoutTimestamp {
    public static let epochMillisecondsCutoff: TimeInterval = 1_000_000_000_000

    public static func epochMilliseconds(_ value: TimeInterval?) -> TimeInterval? {
        guard let value, value.isFinite, value > 0 else { return nil }
        return floor(value > epochMillisecondsCutoff ? value : value * 1000)
    }

    public static func date(fromEpoch value: TimeInterval?) -> Date? {
        guard let milliseconds = epochMilliseconds(value) else { return nil }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }

    public static func relativeAge(fromEpoch value: TimeInterval?, now: Date = Date()) -> String? {
        relativeAge(since: date(fromEpoch: value), now: now)
    }

    public static func relativeAge(since date: Date?, now: Date = Date()) -> String? {
        guard let date else { return nil }
        let rawSeconds = Int(now.timeIntervalSince(date))
        let future = rawSeconds < -4
        let seconds = abs(rawSeconds)
        let label: String
        if seconds < 5 {
            return "now"
        } else if seconds < 60 {
            label = "\(seconds)s"
        } else if seconds < 3_600 {
            label = "\(seconds / 60)m"
        } else if seconds < 86_400 {
            let hours = seconds / 3_600
            let minutes = (seconds % 3_600) / 60
            label = minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
        } else {
            label = "\(seconds / 86_400)d"
        }
        return future ? "in \(label)" : label
    }

    public static func clockTime(fromEpoch value: TimeInterval?) -> String? {
        guard let date = date(fromEpoch: value) else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}
