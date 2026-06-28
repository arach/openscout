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
    @Published public var selectedOrigin: String?
    @Published public var selectedProject: String?
    @Published public var selectedKind: ScoutTailEventKind?
    @Published public var isFollowing = true
    @Published public var showMetadata = false {
        didSet {
            guard oldValue != showMetadata else { return }
            publishDisplayEvents()
        }
    }

    private let client: ScoutTailClient
    private let pollInterval: TimeInterval = 1.4
    private let maxRawEvents = 700
    private let maxWorkEvents = 700
    private var rawEvents: [ScoutTailEvent] = []
    private var workEvents: [ScoutTailEvent] = []
    private var pollTask: Task<Void, Never>?
    private var fetchTask: Task<Void, Never>?
    private var lastMergeAt: Date?
    private var lastDiscoveryFetchAt: Date?

    public init(client: ScoutTailClient = ScoutTailClient()) {
        self.client = client
    }

    public var hasBufferedEvents: Bool {
        !rawEvents.isEmpty
    }

    public var bufferedEventCount: Int {
        rawEvents.count
    }

    public var filteredEvents: [ScoutTailEvent] {
        displayEvents()
    }

    public func displayEvents(limit: Int? = nil) -> [ScoutTailEvent] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let limit, limit > 0 else {
            return events.filter { matchesDisplayFilters($0, query: trimmedQuery) }
        }

        var display: [ScoutTailEvent] = []
        display.reserveCapacity(min(limit, events.count))
        for event in events.reversed() {
            guard matchesDisplayFilters(event, query: trimmedQuery) else { continue }
            display.append(event)
            if display.count >= limit { break }
        }
        return Array(display.reversed())
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

    public var hasActiveFilters: Bool {
        selectedSource != nil
            || selectedOrigin != nil
            || selectedProject != nil
            || selectedKind != nil
            || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public func clearFilters() {
        query = ""
        selectedSource = nil
        selectedOrigin = nil
        selectedProject = nil
        selectedKind = nil
    }

    private func matchesDisplayFilters(_ event: ScoutTailEvent, query trimmedQuery: String) -> Bool {
        if !showMetadata, event.isLowSignalMetadata {
            return false
        }
        if let selectedSource, event.sourceLabel != selectedSource {
            return false
        }
        if let selectedOrigin, event.originLabel != selectedOrigin {
            return false
        }
        if let selectedProject, event.projectLabel != selectedProject {
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

    public var activeFilterSummary: String? {
        var parts: [String] = []
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedQuery.isEmpty {
            parts.append("query: \(trimmedQuery)")
        }
        if let selectedSource {
            parts.append("harness: \(selectedSource)")
        }
        if let selectedOrigin {
            parts.append("origin: \(selectedOrigin)")
        }
        if let selectedProject {
            parts.append("project: \(selectedProject)")
        }
        if let selectedKind {
            parts.append("kind: \(selectedKind.title)")
        }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: " · ")
    }

    public func start() {
        guard pollTask == nil else { return }
        let needsTranscriptPrime = events.isEmpty
        // Fast first paint: live process inventory only — no transcript disk
        // reads — so the stream shows real rows almost immediately.
        refresh(includeTranscripts: false)
        let interval = pollInterval
        pollTask = Task { [weak self] in
            guard let self else { return }
            // Backfill transcript history once the fast prime settles. Without
            // this replay the HUD can look silent when the broker was not
            // already tailing — but it must not hold up the first rows, so it
            // runs after the fast fetch rather than instead of it.
            if needsTranscriptPrime {
                await self.waitForIdleFetch()
                guard !Task.isCancelled else { return }
                self.refresh(includeTranscripts: true)
            }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self.refresh()
            }
        }
    }

    /// Cheap main-actor poll until the in-flight fetch clears, so a follow-up
    /// refresh can be issued without tripping the `fetchTask != nil` guard.
    private func waitForIdleFetch() async {
        while fetchTask != nil {
            try? await Task.sleep(nanoseconds: 30_000_000)
            if Task.isCancelled { return }
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
            guard !ScoutAppError.isCancellation(error) else { return }
            scoutSetIfChanged(
                ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app."),
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
        let previousIds = Set(rawEvents.map(\.id))
        let newEvents = next.filter { !previousIds.contains($0.id) }
        let visibleNewEvents = showMetadata
            ? newEvents
            : newEvents.filter { !$0.isLowSignalMetadata }
        let newCount = visibleNewEvents.count
        let now = Date()
        let elapsed = max(0.1, now.timeIntervalSince(lastMergeAt ?? now.addingTimeInterval(-pollInterval)))
        scoutSetIfChanged(newCount, to: \.lastBatchCount)
        scoutSetIfChanged(Double(newCount) / elapsed, to: \.linesPerSecond)
        lastMergeAt = now
        if newCount > 0 {
            scoutSetIfChanged(now, to: \.lastReceivedAt)
        }
        guard !newEvents.isEmpty else { return }

        rawEvents = mergedEvents(rawEvents, with: newEvents, limit: maxRawEvents)

        let newWorkEvents = newEvents.filter { !$0.isLowSignalMetadata }
        if !newWorkEvents.isEmpty {
            workEvents = mergedEvents(workEvents, with: newWorkEvents, limit: maxWorkEvents)
        }

        if showMetadata || !newWorkEvents.isEmpty {
            publishDisplayEvents()
        }
    }

    private func publishDisplayEvents() {
        scoutSetIfChanged(showMetadata ? rawEvents : workEvents, to: \.events)
    }

    private func mergedEvents(
        _ existing: [ScoutTailEvent],
        with incoming: [ScoutTailEvent],
        limit: Int
    ) -> [ScoutTailEvent] {
        var byId: [String: ScoutTailEvent] = [:]
        byId.reserveCapacity(existing.count + incoming.count)
        for event in existing {
            byId[event.id] = event
        }
        for event in incoming {
            byId[event.id] = event
        }
        return byId.values
            .sorted { lhs, rhs in
                if lhs.ts == rhs.ts { return lhs.id < rhs.id }
                return lhs.ts < rhs.ts
            }
            .suffix(limit)
            .map { $0 }
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
