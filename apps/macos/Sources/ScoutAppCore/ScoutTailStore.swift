import Combine
import Foundation

@MainActor
public final class ScoutTailStore: ObservableObject, ScoutChangeSetting {
    @Published public private(set) var events: [ScoutTailEvent] = []
    @Published public private(set) var discovery: ScoutTailDiscoverySnapshot?
    @Published public private(set) var isLoading = false
    @Published public private(set) var lastError: String?
    @Published public private(set) var lastBatchCount = 0
    @Published public private(set) var linesPerSecond = 0.0
    @Published public private(set) var lastReceivedAt: Date?
    @Published public var query = ""
    @Published public var selectedSource: String?
    @Published public var selectedKind: ScoutTailEventKind?
    @Published public var isFollowing = true
    @Published public var showMetadata = false

    private let client: ScoutTailClient
    private let pollInterval: TimeInterval = 1.4
    private let maxEvents = 700
    private var pollTask: Task<Void, Never>?
    private var fetchTask: Task<Void, Never>?
    private var lastMergeAt: Date?
    private var lastDiscoveryFetchAt: Date?

    public init(client: ScoutTailClient = ScoutTailClient()) {
        self.client = client
    }

    public var filteredEvents: [ScoutTailEvent] {
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

    public var sources: [String] {
        Array(Set(events.map(\.source).filter { !$0.isEmpty })).sorted()
    }

    public var sourceCounts: [ScoutTailCount] {
        counts(events.map(\.sourceLabel))
    }

    public var originCounts: [ScoutTailCount] {
        counts(events.map(\.originLabel))
    }

    public var projectCounts: [ScoutTailCount] {
        counts(events.map(\.projectLabel))
    }

    public var kindCounts: [ScoutTailCount] {
        counts(events.map { $0.kind.title })
    }

    public var sessionCount: Int {
        Set(events.map(\.sessionId).filter { !$0.isEmpty }).count
    }

    public var liveRateLabel: String {
        String(format: "%.1f lines/s", linesPerSecond)
    }

    public func start() {
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

    public func stop() {
        pollTask?.cancel()
        pollTask = nil
        fetchTask?.cancel()
        fetchTask = nil
        scoutSetIfChanged(false, to: \.isLoading)
    }

    public func refresh(includeTranscripts: Bool = false) {
        if fetchTask != nil { return }
        scoutSetIfChanged(events.isEmpty, to: \.isLoading)
        fetchTask = Task { [weak self] in
            await self?.fetchRecent(includeTranscripts: includeTranscripts)
        }
    }

    private func fetchRecent(includeTranscripts: Bool) async {
        defer {
            scoutSetIfChanged(false, to: \.isLoading)
            fetchTask = nil
        }

        do {
            let payload = try await client.fetchRecent(limit: 500, includeTranscripts: includeTranscripts)
            merge(payload.events)
            try await refreshDiscoveryIfNeeded()
            scoutSetIfChanged(nil, to: \.lastError)
        } catch {
            scoutSetIfChanged(
                ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout broker."),
                to: \.lastError
            )
        }
    }

    private func merge(_ next: [ScoutTailEvent]) {
        guard !next.isEmpty else {
            scoutSetIfChanged(0, to: \.lastBatchCount)
            scoutSetIfChanged(0, to: \.linesPerSecond)
            return
        }
        let previousIds = Set(events.map(\.id))
        let newCount = next.filter { !previousIds.contains($0.id) }.count
        let now = Date()
        let elapsed = max(0.1, now.timeIntervalSince(lastMergeAt ?? now.addingTimeInterval(-pollInterval)))
        scoutSetIfChanged(newCount, to: \.lastBatchCount)
        scoutSetIfChanged(Double(newCount) / elapsed, to: \.linesPerSecond)
        lastMergeAt = now
        if newCount > 0 {
            scoutSetIfChanged(now, to: \.lastReceivedAt)
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
        scoutSetIfChanged(merged, to: \.events)
    }

    private func refreshDiscoveryIfNeeded() async throws {
        let now = Date()
        if let lastDiscoveryFetchAt,
           now.timeIntervalSince(lastDiscoveryFetchAt) < 30,
           discovery != nil {
            return
        }
        let next = try await client.fetchDiscovery()
        scoutSetIfChanged(next, to: \.discovery)
        lastDiscoveryFetchAt = now
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
