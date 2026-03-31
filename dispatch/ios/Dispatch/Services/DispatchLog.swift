// DispatchLog — Dual-output logging: os.Logger (Console.app) + in-memory LogStore (in-app viewing).
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
    let level: DispatchLog.Level
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

// MARK: - DispatchLog

enum DispatchLog {
    enum Level: String, CaseIterable {
        case debug = "DEBUG"
        case info = "INFO"
        case warning = "WARN"
        case error = "ERROR"
        case fault = "FAULT"

        var color: Color {
            switch self {
            case .debug: DispatchColors.textMuted
            case .info: DispatchColors.textSecondary
            case .warning: DispatchColors.statusStreaming
            case .error: DispatchColors.statusError
            case .fault: DispatchColors.statusError
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
    static let voice = DispatchLogger(category: "voice")
    static let session = DispatchLogger(category: "session")
    static let network = DispatchLogger(category: "network")
    static let ui = DispatchLogger(category: "ui")
    static let security = DispatchLogger(category: "security")
}

// MARK: - DispatchLogger (per-category)

struct DispatchLogger {
    let category: String
    private let osLogger: Logger

    init(category: String) {
        self.category = category
        self.osLogger = Logger(subsystem: "com.openscout.dispatch", category: category)
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

    private func log(_ level: DispatchLog.Level, _ message: String, detail: String?) {
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
