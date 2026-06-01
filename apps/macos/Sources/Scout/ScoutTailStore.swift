import Combine
import Foundation

@MainActor
final class ScoutTailStore: ObservableObject {
    @Published private(set) var events: [ScoutTailEvent] = []
    @Published private(set) var discovery: ScoutTailDiscoverySnapshot?
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastBatchCount = 0
    @Published private(set) var linesPerSecond = 0.0
    @Published private(set) var lastReceivedAt: Date?
    @Published var query = ""
    @Published var selectedSource: String?
    @Published var selectedKind: ScoutTailEventKind?
    @Published var isFollowing = true
    @Published var showMetadata = false

    private let decoder = JSONDecoder()
    private let pollInterval: TimeInterval = 1.4
    private let maxEvents = 700
    private var pollTask: Task<Void, Never>?
    private var fetchTask: Task<Void, Never>?
    private var lastMergeAt: Date?
    private var lastDiscoveryFetchAt: Date?

    var filteredEvents: [ScoutTailEvent] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return events.filter { event in
            if !showMetadata, event.isLowSignalMetadata {
                return false
            }
            if let selectedSource, event.source != selectedSource {
                return false
            }
            if let selectedKind, event.kind != selectedKind {
                return false
            }
            guard !trimmedQuery.isEmpty else { return true }
            return [
                event.source,
                event.kind.rawValue,
                event.sessionId,
                event.project,
                event.cwd,
                event.harness,
                event.summary,
            ]
            .joined(separator: "\n")
            .lowercased()
            .contains(trimmedQuery)
        }
    }

    var sources: [String] {
        Array(Set(events.map(\.source).filter { !$0.isEmpty })).sorted()
    }

    var sourceCounts: [ScoutTailCount] {
        counts(events.map(\.sourceLabel))
    }

    var originCounts: [ScoutTailCount] {
        counts(events.map(\.originLabel))
    }

    var projectCounts: [ScoutTailCount] {
        counts(events.map(\.projectLabel))
    }

    var kindCounts: [ScoutTailCount] {
        counts(events.map { $0.kind.title })
    }

    var sessionCount: Int {
        Set(events.map(\.sessionId).filter { !$0.isEmpty }).count
    }

    var liveRateLabel: String {
        String(format: "%.1f lines/s", linesPerSecond)
    }

    func start() {
        guard pollTask == nil else {
            refresh()
            return
        }
        refresh()
        let interval = pollInterval
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                self?.refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        fetchTask?.cancel()
        fetchTask = nil
        isLoading = false
    }

    func refresh(includeTranscripts: Bool = false) {
        if fetchTask != nil { return }
        isLoading = events.isEmpty
        fetchTask = Task { [weak self] in
            await self?.fetchRecent(includeTranscripts: includeTranscripts)
        }
    }

    private func fetchRecent(includeTranscripts: Bool) async {
        defer {
            isLoading = false
            fetchTask = nil
        }

        do {
            var items = [
                URLQueryItem(name: "limit", value: "500"),
            ]
            if includeTranscripts {
                items.append(URLQueryItem(name: "transcripts", value: "true"))
            }
            let url = ScoutBroker.baseURL()
                .appending(path: "v1/tail/recent")
                .appending(queryItems: items)
            let payload = try await fetch(ScoutTailRecentPayload.self, from: url)
            merge(payload.events)
            try await refreshDiscoveryIfNeeded()
            lastError = nil
        } catch {
            lastError = Self.userFacingError(error)
        }
    }

    private func merge(_ next: [ScoutTailEvent]) {
        guard !next.isEmpty else {
            lastBatchCount = 0
            linesPerSecond = 0
            return
        }
        let previousIds = Set(events.map(\.id))
        let newCount = next.filter { !previousIds.contains($0.id) }.count
        let now = Date()
        let elapsed = max(0.1, now.timeIntervalSince(lastMergeAt ?? now.addingTimeInterval(-pollInterval)))
        lastBatchCount = newCount
        linesPerSecond = Double(newCount) / elapsed
        lastMergeAt = now
        if newCount > 0 {
            lastReceivedAt = now
        }

        var byId = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        for event in next {
            byId[event.id] = event
        }
        events = byId.values
            .sorted { lhs, rhs in
                if lhs.ts == rhs.ts { return lhs.id < rhs.id }
                return lhs.ts < rhs.ts
            }
            .suffix(maxEvents)
            .map { $0 }
    }

    private func refreshDiscoveryIfNeeded() async throws {
        let now = Date()
        if let lastDiscoveryFetchAt,
           now.timeIntervalSince(lastDiscoveryFetchAt) < 30,
           discovery != nil {
            return
        }
        let url = ScoutBroker.baseURL().appending(path: "v1/tail/discover")
        discovery = try await fetch(ScoutTailDiscoverySnapshot.self, from: url)
        lastDiscoveryFetchAt = now
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutTailError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutTailError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    private static func userFacingError(_ error: Error) -> String {
        if let tailError = error as? ScoutTailError {
            return tailError.localizedDescription
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNotConnectedToInternet, NSURLErrorTimedOut:
                return "Could not connect to the Scout broker."
            default:
                break
            }
        }
        return error.localizedDescription
    }

    private func counts(_ values: [String]) -> [ScoutTailCount] {
        let grouped = Dictionary(grouping: values.filter { !$0.isEmpty }) { $0 }
        return grouped
            .map { ScoutTailCount(label: $0.key, count: $0.value.count) }
            .sorted {
                if $0.count == $1.count { return $0.label < $1.label }
                return $0.count > $1.count
            }
    }
}

enum ScoutBroker {
    private static let fallbackURL = URL(string: "http://127.0.0.1:65535")!

    static func baseURL() -> URL {
        if let url = readBrokerURLFromEnvironment() {
            return url
        }
        if let url = readBrokerURLFromConfig() {
            return url
        }
        return fallbackURL
    }

    private static func readBrokerURLFromEnvironment() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if let value = env["OPENSCOUT_BROKER_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty,
           let url = URL(string: value) {
            return url
        }

        let portValue = env["OPENSCOUT_BROKER_PORT"]
        guard let portText = portValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(portText),
              (1...65_535).contains(port) else {
            return nil
        }
        let rawHost = env["OPENSCOUT_BROKER_HOST"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let host = (rawHost?.isEmpty == false && rawHost != "0.0.0.0" && rawHost != "::")
            ? rawHost!
            : "127.0.0.1"
        return URL(string: "http://\(host):\(port)")
    }

    private static func readBrokerURLFromConfig() -> URL? {
        struct OpenScoutConfig: Decodable {
            struct Ports: Decodable { let broker: Int? }
            let host: String?
            let ports: Ports?
        }
        let path = ("~/.openscout/config.json" as NSString).expandingTildeInPath
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        guard let cfg = try? JSONDecoder().decode(OpenScoutConfig.self, from: data) else { return nil }
        let rawHost = cfg.host ?? "127.0.0.1"
        let host = (rawHost == "0.0.0.0" || rawHost == "::") ? "127.0.0.1" : rawHost
        guard let port = cfg.ports?.broker else { return nil }
        return URL(string: "http://\(host):\(port)")
    }
}

struct ScoutTailCount: Identifiable, Sendable {
    let label: String
    let count: Int

    var id: String { label }
}

enum ScoutTailError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid tail response."
        case .httpStatus(let status):
            return "Scout tail returned HTTP \(status)."
        }
    }
}
