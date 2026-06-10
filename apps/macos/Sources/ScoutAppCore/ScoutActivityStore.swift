import Combine
import Foundation

@MainActor
public final class ScoutActivityStore: ObservableObject, ScoutChangeSetting {
    @Published public private(set) var items: [ScoutActivityItem]? = nil
    @Published public private(set) var lastError: String?
    @Published public private(set) var isLoading = false

    private let client: ScoutActivityClient
    private let pollInterval: TimeInterval
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?

    public init(client: ScoutActivityClient = ScoutActivityClient(), pollInterval: TimeInterval = 2.0) {
        self.client = client
        self.pollInterval = pollInterval
    }

    public func start() {
        guard pollTask == nil else { return }
        refresh(force: true)
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
        inFlight?.cancel()
        inFlight = nil
        scoutSetIfChanged(false, to: \.isLoading)
    }

    public func refresh(force: Bool = false) {
        if inFlight != nil { return }
        if !force, pollTask == nil { return }
        scoutSetIfChanged(items == nil, to: \.isLoading)
        inFlight = Task { [weak self] in
            await self?.fetchActivity()
        }
    }

    private func fetchActivity() async {
        defer {
            scoutSetIfChanged(false, to: \.isLoading)
            inFlight = nil
        }
        do {
            let next = try await client.fetchActivity()
            scoutSetIfChanged(next, to: \.items)
            scoutSetIfChanged(nil, to: \.lastError)
        } catch {
            scoutSetIfChanged(ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app."), to: \.lastError)
        }
    }
}
