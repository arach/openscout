import Combine
import Foundation

@MainActor
public final class ScoutAgentsStore: ObservableObject, ScoutChangeSetting {
    @Published public private(set) var agents: [ScoutAgent]? = nil
    @Published public private(set) var lastError: String?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isLoadingMore = false

    private let client: ScoutCommsClient
    private let nativeReadClient: ScoutNativeReadClient
    private let pollInterval: TimeInterval
    private let pageSize: Int?
    private let requestsSummary: Bool
    private var requestedLimit: Int?
    private var nativeHasMore = false
    private var isStarted = false
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?
    private var nativeStreamTask: Task<Void, Never>?
    private var nativeSubscription: ScoutNativeAgentsSubscription?

    public init(
        client: ScoutCommsClient = ScoutCommsClient(),
        nativeReadClient: ScoutNativeReadClient = ScoutNativeReadClient(),
        pollInterval: TimeInterval = 2.0,
        pageSize: Int? = nil,
        requestsSummary: Bool = false
    ) {
        self.client = client
        self.nativeReadClient = nativeReadClient
        self.pollInterval = pollInterval
        let normalizedPageSize = pageSize.flatMap { $0 > 0 ? $0 : nil }
        self.pageSize = normalizedPageSize
        self.requestedLimit = normalizedPageSize
        self.requestsSummary = requestsSummary
    }

    public var canLoadMore: Bool {
        if requestsSummary { return nativeHasMore }
        guard let requestedLimit, let agents else { return false }
        return agents.count >= requestedLimit
    }

    public var loadMoreCount: Int? {
        pageSize
    }

    public func start() {
        guard !isStarted else { return }
        isStarted = true
        if requestsSummary {
            startNativeStream()
            return
        }
        refresh(force: true)
        let interval = pollInterval
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard let self else { return }
                refresh()
            }
        }
    }

    public func stop() {
        isStarted = false
        pollTask?.cancel()
        pollTask = nil
        inFlight?.cancel()
        inFlight = nil
        nativeStreamTask?.cancel()
        nativeStreamTask = nil
        nativeSubscription?.cancel()
        nativeSubscription = nil
        scoutSetIfChanged(false, to: \.isLoading)
        scoutSetIfChanged(false, to: \.isLoadingMore)
    }

    public func refresh(force: Bool = false) {
        if requestsSummary {
            guard force || isStarted else { return }
            startNativeStream()
            return
        }
        if inFlight != nil { return }
        if !force, !isStarted { return }
        scoutSetIfChanged(agents == nil, to: \.isLoading)
        inFlight = Task { [weak self] in
            await self?.fetchAgents()
        }
    }

    public func loadMore() {
        guard let pageSize, inFlight == nil else { return }
        requestedLimit = (requestedLimit ?? 0) + pageSize
        scoutSetIfChanged(true, to: \.isLoadingMore)
        refresh(force: true)
    }

    private func startNativeStream() {
        nativeStreamTask?.cancel()
        nativeStreamTask = nil
        nativeSubscription?.cancel()
        nativeSubscription = nil
        let limit = requestedLimit ?? pageSize ?? 10
        scoutSetIfChanged(agents == nil, to: \.isLoading)
        nativeStreamTask = Task { [weak self] in
            guard let self else { return }
            var afterSequence: UInt64?
            while !Task.isCancelled, isStarted {
                do {
                    let subscription = try nativeReadClient.subscribeAgents(
                        limit: limit,
                        afterSequence: afterSequence
                    )
                    nativeSubscription = subscription
                    for try await snapshot in subscription.snapshots {
                        guard !Task.isCancelled else { return }
                        afterSequence = snapshot.sequence
                        nativeHasMore = snapshot.hasMore
                        scoutSetIfChanged(snapshot.agents, to: \.agents)
                        scoutSetIfChanged(nil, to: \.lastError)
                        scoutSetIfChanged(false, to: \.isLoading)
                        scoutSetIfChanged(false, to: \.isLoadingMore)
                    }
                    if Task.isCancelled { return }
                    throw ScoutNativeReadClientError.service("scoutd native-read stream ended")
                } catch {
                    guard !Task.isCancelled, !ScoutAppError.isCancellation(error) else { return }
                    await fetchWebFallback()
                    do {
                        try await Task.sleep(
                            nanoseconds: UInt64(max(0.25, pollInterval) * 1_000_000_000)
                        )
                    } catch {
                        return
                    }
                }
            }
        }
    }

    private func fetchWebFallback() async {
        do {
            let next = try await client.fetchAgents(limit: requestedLimit, summary: true)
            nativeHasMore = requestedLimit.map { next.count >= $0 } ?? false
            scoutSetIfChanged(next, to: \.agents)
            scoutSetIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            scoutSetIfChanged(
                ScoutAppError.userFacing(
                    error,
                    connectionMessage: "Could not load the Scout agent roster."
                ),
                to: \.lastError
            )
        }
        scoutSetIfChanged(false, to: \.isLoading)
        scoutSetIfChanged(false, to: \.isLoadingMore)
    }

    private func fetchAgents() async {
        defer {
            scoutSetIfChanged(false, to: \.isLoading)
            scoutSetIfChanged(false, to: \.isLoadingMore)
            inFlight = nil
        }
        do {
            let next = try await client.fetchAgents(limit: requestedLimit, summary: requestsSummary)
            scoutSetIfChanged(next, to: \.agents)
            scoutSetIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            scoutSetIfChanged(ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app."), to: \.lastError)
        }
    }
}
