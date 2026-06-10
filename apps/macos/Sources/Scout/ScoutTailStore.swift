import Combine
import Foundation
import ScoutAppCore

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
        guard pollTask == nil else { return }
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
        setIfChanged(false, to: \.isLoading)
    }

    func refresh(includeTranscripts: Bool = false) {
        if fetchTask != nil { return }
        setIfChanged(events.isEmpty, to: \.isLoading)
        fetchTask = Task { [weak self] in
            await self?.fetchRecent(includeTranscripts: includeTranscripts)
        }
    }

    private func fetchRecent(includeTranscripts: Bool) async {
        defer {
            setIfChanged(false, to: \.isLoading)
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
            setIfChanged(nil, to: \.lastError)
        } catch {
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func merge(_ next: [ScoutTailEvent]) {
        guard !next.isEmpty else {
            setIfChanged(0, to: \.lastBatchCount)
            setIfChanged(0, to: \.linesPerSecond)
            return
        }
        let previousIds = Set(events.map(\.id))
        let newCount = next.filter { !previousIds.contains($0.id) }.count
        let now = Date()
        let elapsed = max(0.1, now.timeIntervalSince(lastMergeAt ?? now.addingTimeInterval(-pollInterval)))
        setIfChanged(newCount, to: \.lastBatchCount)
        setIfChanged(Double(newCount) / elapsed, to: \.linesPerSecond)
        lastMergeAt = now
        if newCount > 0 {
            setIfChanged(now, to: \.lastReceivedAt)
        }

        var byId = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        for event in next {
            byId[event.id] = event
        }
        let merged = byId.values
            .sorted { lhs, rhs in
                if lhs.ts == rhs.ts { return lhs.id < rhs.id }
                return lhs.ts < rhs.ts
            }
            .suffix(maxEvents)
            .map { $0 }
        setIfChanged(merged, to: \.events)
    }

    private func refreshDiscoveryIfNeeded() async throws {
        let now = Date()
        if let lastDiscoveryFetchAt,
           now.timeIntervalSince(lastDiscoveryFetchAt) < 30,
           discovery != nil {
            return
        }
        let url = ScoutBroker.baseURL().appending(path: "v1/tail/discover")
        let next = try await fetch(ScoutTailDiscoverySnapshot.self, from: url)
        setIfChanged(next, to: \.discovery)
        lastDiscoveryFetchAt = now
    }

    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutTailStore, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
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
        return ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout broker.")
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
