import os.log

public enum ScoutLog {
    public static let subsystem = "dev.openscout.menu"

    public static func logger(category: String) -> Logger {
        Logger(subsystem: subsystem, category: category)
    }

    public static func hud(_ category: String) -> Logger {
        logger(category: "hud.\(category)")
    }
}
