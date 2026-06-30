import Foundation

public enum ScoutVoiceHistoryLevel: String, Codable, Sendable {
    case info
    case success
    case warn
    case error
}

public struct ScoutVoiceHistoryEntry: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let sessionId: String?
    public let event: String
    public let summary: String
    public let detail: String?
    public let level: ScoutVoiceHistoryLevel
    public let ts: Date

    public init(
        id: String = UUID().uuidString,
        sessionId: String? = nil,
        event: String,
        summary: String,
        detail: String? = nil,
        level: ScoutVoiceHistoryLevel = .info,
        ts: Date = Date()
    ) {
        self.id = id
        self.sessionId = sessionId
        self.event = event
        self.summary = summary
        self.detail = detail
        self.level = level
        self.ts = ts
    }
}

/// Ring buffer of recent Scout voice host activity for native settings and diagnostics.
@MainActor
public final class ScoutVoiceHistoryStore: ObservableObject {
    public static let shared = ScoutVoiceHistoryStore()

    @Published public private(set) var entries: [ScoutVoiceHistoryEntry] = []

    private let maxEntries = 60
    private let persistenceKey = "scout.voiceHistory"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        decoder.dateDecodingStrategy = .iso8601
        encoder.dateEncodingStrategy = .iso8601
        loadPersisted()
    }

    public func record(
        sessionId: String? = nil,
        event: String,
        summary: String,
        detail: String? = nil,
        level: ScoutVoiceHistoryLevel = .info
    ) {
        let entry = ScoutVoiceHistoryEntry(
            sessionId: sessionId,
            event: event,
            summary: summary,
            detail: detail,
            level: level
        )
        entries.insert(entry, at: 0)
        if entries.count > maxEntries {
            entries.removeLast(entries.count - maxEntries)
        }
        persist()
    }

    public func recordHostEvent(
        sessionId: String,
        event: String,
        data: [String: Any]
    ) {
        let summary = hostEventSummary(event: event, data: data)
        let detail = hostEventDetail(event: event, data: data)
        let level = hostEventLevel(event: event, data: data)
        record(sessionId: sessionId, event: event, summary: summary, detail: detail, level: level)
    }

    public func clear() {
        entries.removeAll()
        UserDefaults.standard.removeObject(forKey: persistenceKey)
    }

    public func recent(limit: Int = 20) -> [ScoutVoiceHistoryEntry] {
        Array(entries.prefix(max(0, limit)))
    }

    public func exportText(limit: Int = 30) -> String {
        recent(limit: limit)
            .reversed()
            .map { entry in
                let stamp = entry.ts.formatted(date: .omitted, time: .standard)
                let session = entry.sessionId.map { " \($0.suffix(8))" } ?? ""
                let detail = entry.detail.map { " — \($0)" } ?? ""
                return "[\(stamp)]\(session) \(entry.event): \(entry.summary)\(detail)"
            }
            .joined(separator: "\n")
    }

    private func hostEventSummary(event: String, data: [String: Any]) -> String {
        switch event {
        case "session.state":
            if let state = data["state"] as? String {
                return "State → \(state)"
            }
            return "Session state changed"
        case "session.partial":
            if let text = data["text"] as? String {
                let preview = text.count > 48 ? String(text.prefix(48)) + "…" : text
                return "Partial: \(preview)"
            }
            return "Partial transcript"
        case "session.final":
            if let text = data["text"] as? String {
                let preview = text.count > 56 ? String(text.prefix(56)) + "…" : text
                return "Final: \(preview)"
            }
            return "Final transcript delivered"
        case "session.error":
            if let message = data["message"] as? String {
                return message
            }
            return "Session error"
        case "session.cancelled":
            if let reason = data["reason"] as? String {
                return "Cancelled (\(reason))"
            }
            return "Session cancelled"
        default:
            return event
        }
    }

    private func hostEventDetail(event: String, data: [String: Any]) -> String? {
        switch event {
        case "session.final":
            if let durationMs = data["durationMs"] as? Int {
                return "\(durationMs) ms"
            }
            return nil
        case "session.error":
            if let code = data["code"] as? String {
                return code
            }
            return nil
        case "session.cancelled":
            return data["reason"] as? String
        default:
            return nil
        }
    }

    private func hostEventLevel(event: String, data: [String: Any]) -> ScoutVoiceHistoryLevel {
        switch event {
        case "session.final":
            return .success
        case "session.error":
            return .error
        case "session.cancelled":
            return .warn
        case "session.partial":
            return .info
        case "session.state":
            if let state = data["state"] as? String, state == "error" {
                return .error
            }
            return .info
        default:
            return .info
        }
    }

    private func persist() {
        guard let data = try? encoder.encode(entries) else { return }
        UserDefaults.standard.set(data, forKey: persistenceKey)
    }

    private func loadPersisted() {
        guard let data = UserDefaults.standard.data(forKey: persistenceKey),
              let decoded = try? decoder.decode([ScoutVoiceHistoryEntry].self, from: data) else {
            return
        }
        entries = Array(decoded.prefix(maxEntries))
    }
}