// PlexusLog — Dual-output logging: os.Logger (Console.app) + in-memory LogStore (in-app viewing).
//
// Pattern from Talkie's AppLogger. Every log call goes to both:
//   1. os.Logger — visible in Console.app with subsystem filtering
//   2. LogStore.shared — in-memory ring buffer for the debug log view

import os.log
import SwiftUI

// MARK: - Log Entry

struct LogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let level: PlexusLog.Level
    let category: String
    let message: String
    let detail: String?

    var timestampString: String {
        Self.formatter.string(from: timestamp)
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
}

// MARK: - LogStore (in-memory buffer for UI)

@MainActor
final class LogStore: ObservableObject {
    static let shared = LogStore()

    @Published private(set) var entries: [LogEntry] = []

    private let maxEntries = 200

    func append(_ entry: LogEntry) {
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
    }

    func clear() {
        entries.removeAll()
    }

    var errorCount: Int {
        entries.filter { $0.level == .error || $0.level == .fault }.count
    }
}

// MARK: - PlexusLog

enum PlexusLog {
    enum Level: String, CaseIterable {
        case debug = "DEBUG"
        case info = "INFO"
        case warning = "WARN"
        case error = "ERROR"
        case fault = "FAULT"

        var color: Color {
            switch self {
            case .debug: PlexusColors.textMuted
            case .info: PlexusColors.textSecondary
            case .warning: PlexusColors.statusStreaming
            case .error: PlexusColors.statusError
            case .fault: PlexusColors.statusError
            }
        }

        var osLogType: OSLogType {
            switch self {
            case .debug: .debug
            case .info: .info
            case .warning: .default
            case .error: .error
            case .fault: .fault
            }
        }
    }

    // Category loggers
    static let voice = PlexusLogger(category: "voice")
    static let session = PlexusLogger(category: "session")
    static let network = PlexusLogger(category: "network")
    static let ui = PlexusLogger(category: "ui")
    static let security = PlexusLogger(category: "security")
}

// MARK: - PlexusLogger (per-category)

struct PlexusLogger {
    let category: String
    private let osLogger: Logger

    init(category: String) {
        self.category = category
        self.osLogger = Logger(subsystem: "dev.plexus", category: category)
    }

    func debug(_ message: String, detail: String? = nil) {
        log(.debug, message, detail: detail)
    }

    func info(_ message: String, detail: String? = nil) {
        log(.info, message, detail: detail)
    }

    func warning(_ message: String, detail: String? = nil) {
        log(.warning, message, detail: detail)
    }

    func error(_ message: String, detail: String? = nil) {
        log(.error, message, detail: detail)
    }

    func fault(_ message: String, detail: String? = nil) {
        log(.fault, message, detail: detail)
    }

    private func log(_ level: PlexusLog.Level, _ message: String, detail: String?) {
        // 1. os.Logger (Console.app)
        osLogger.log(level: level.osLogType, "[\(level.rawValue)] \(message)")

        // 2. In-memory store (UI)
        let entry = LogEntry(
            timestamp: Date(),
            level: level,
            category: category,
            message: message,
            detail: detail
        )
        Task { @MainActor in
            LogStore.shared.append(entry)
        }
    }
}
