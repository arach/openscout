import Combine
import Foundation
import ScoutAppCore

/// Reads the broker's Repo Watch snapshot for the Repos section. Scan cadence
/// and cache warming live in the broker/runtime; this view-store only manages
/// start/stop/refresh and a single in-flight fetch. Reuses the shared
/// `ScoutBroker` URL resolver.
@MainActor
final class ScoutRepoStore: ObservableObject {
    @Published private(set) var snapshot: RepoWatchSnapshot = .empty
    @Published private(set) var hasLoaded = false
    @Published private(set) var isLoading = false
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastFetchedAt: Date?
    @Published private(set) var lastRefreshWasForced = false

    /// Show every worktree; the header no longer folds clean-&-idle rows away.
    @Published var showCleanIdle = true

    /// Which lens the worktree rows read through. Native leads with Table; Drift
    /// is a toggle over the same model (ahead/behind/upstream instead of churn).
    @Published var lens: ReposLens = .table

    private let decoder = JSONDecoder()
    /// Repo scanning cadence is owned by the broker/runtime. The native store
    /// only asks for the current broker snapshot when the view starts or the
    /// operator requests a refresh.
    private var fetchTask: Task<Void, Never>?

    // MARK: Derived

    /// Projects worst-first, then alphabetically — the spine of every view.
    var projects: [RepoProject] {
        snapshot.projects.sorted { lhs, rhs in
            if lhs.attention.rank != rhs.attention.rank {
                return lhs.attention.rank < rhs.attention.rank
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    var totals: RepoTotals { snapshot.totals }

    var generatedAt: Double { snapshot.generatedAt }

    /// Resolve a worktree by id across all projects (the inspector follows the
    /// cursor's selected id).
    func worktree(id: String?) -> RepoWorktree? {
        guard let id else { return nil }
        for project in snapshot.projects {
            if let match = project.worktrees.first(where: { $0.id == id }) { return match }
        }
        return nil
    }

    func project(forWorktree id: String?) -> RepoProject? {
        guard let id else { return nil }
        return snapshot.projects.first { $0.worktrees.contains { $0.id == id } }
    }

    func project(id: String?) -> RepoProject? {
        guard let id else { return nil }
        return snapshot.projects.first { $0.id == id }
    }

    /// Clean-&-idle worktrees currently hidden by the fold — surfaced as the
    /// count on the header's "show quiet" affordance.
    var quietWorktreeCount: Int {
        snapshot.projects.reduce(0) { acc, project in
            acc + project.worktrees.filter { !$0.hasActivity }.count
        }
    }

    // MARK: Lifecycle

    func start() {
        refresh()
    }

    func stop() {
        fetchTask?.cancel()
        fetchTask = nil
        setIfChanged(false, to: \.isLoading)
        setIfChanged(false, to: \.isRefreshing)
    }

    func refresh(force: Bool = false) {
        if fetchTask != nil { return }
        setIfChanged(!hasLoaded, to: \.isLoading)
        setIfChanged(true, to: \.isRefreshing)
        fetchTask = Task { [weak self] in
            await self?.fetchSnapshot(force: force)
        }
    }

    private func fetchSnapshot(force: Bool) async {
        defer {
            setIfChanged(false, to: \.isLoading)
            setIfChanged(false, to: \.isRefreshing)
            fetchTask = nil
        }
        // Preview path: with OPENSCOUT_REPOS_SAMPLE set, serve the fixture so the
        // section renders without a broker that implements the snapshot endpoint.
        if ScoutRepoSample.isEnabled, let sample = ScoutRepoSample.snapshot() {
            setIfChanged(sample, to: \.snapshot)
            setIfChanged(true, to: \.hasLoaded)
            setIfChanged(Date(), to: \.lastFetchedAt)
            setIfChanged(force, to: \.lastRefreshWasForced)
            setIfChanged(nil, to: \.lastError)
            return
        }
        do {
            var queryItems = [
                URLQueryItem(name: "includeDiff", value: "1"),
                URLQueryItem(name: "includeLastCommit", value: "1"),
            ]
            if force {
                queryItems.append(URLQueryItem(name: "force", value: "1"))
            }
            let url = ScoutBroker.baseURL()
                .appending(path: "v1/repo-watch/snapshot")
                .appending(queryItems: queryItems)
            let next = try await fetch(RepoWatchSnapshot.self, from: url)
            setIfChanged(next, to: \.snapshot)
            setIfChanged(true, to: \.hasLoaded)
            setIfChanged(Date(), to: \.lastFetchedAt)
            setIfChanged(force, to: \.lastRefreshWasForced)
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutRepoStore, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutRepoError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutRepoError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    private static func userFacingError(_ error: Error) -> String {
        if let repoError = error as? ScoutRepoError {
            return repoError.localizedDescription
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
}

/// The lens the Repos worktree rows read through — one model, two readings.
enum ReposLens: String, CaseIterable, Sendable {
    case table
    case drift

    var label: String {
        switch self {
        case .table: return "Table"
        case .drift: return "Drift"
        }
    }
}

enum ScoutRepoError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid repo-watch response."
        case .httpStatus(let status):
            return "Repo Watch returned HTTP \(status)."
        }
    }
}
