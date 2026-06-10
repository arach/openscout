import Foundation

public enum ScoutRelativeTime {
    public static func format(_ raw: TimeInterval?, now: Date = Date()) -> String {
        guard let raw else { return "—" }
        let seconds = raw > 10_000_000_000 ? raw / 1000 : raw
        let delta = max(0, Int(now.timeIntervalSince(Date(timeIntervalSince1970: seconds))))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        if delta < 86_400 {
            let h = delta / 3600
            let m = (delta % 3600) / 60
            return m == 0 ? "\(h)h" : "\(h)h \(m)m"
        }
        return "\(delta / 86_400)d"
    }
}
