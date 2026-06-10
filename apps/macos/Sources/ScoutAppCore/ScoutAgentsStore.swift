import Combine
import Foundation

@MainActor
public final class ScoutAgentsStore: ObservableObject {
    @Published public private(set) var agents: [ScoutAgent]? = nil
    @Published public private(set) var lastError: String?
    @Published public private(set) var isLoading = false

    private let client: ScoutCommsClient
    private let pollInterval: TimeInterval
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?

    public init(client: ScoutCommsClient = ScoutCommsClient(), pollInterval: TimeInterval = 2.0) {
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
        setIfChanged(false, to: \.isLoading)
    }

    public func refresh(force: Bool = false) {
        if inFlight != nil { return }
        if !force, pollTask == nil { return }
        setIfChanged(agents == nil, to: \.isLoading)
        inFlight = Task { [weak self] in
            await self?.fetchAgents()
        }
    }

    private func fetchAgents() async {
        defer {
            setIfChanged(false, to: \.isLoading)
            inFlight = nil
        }
        do {
            let next = try await client.fetchAgents()
            setIfChanged(next, to: \.agents)
            setIfChanged(nil, to: \.lastError)
        } catch {
            setIfChanged(ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app."), to: \.lastError)
        }
    }

    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutAgentsStore, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }
}
