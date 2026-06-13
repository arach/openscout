import Foundation

public struct ScoutActivityClient: Sendable {
    public init() {}

    public func fetchActivity() async throws -> [ScoutActivityItem] {
        try await ScoutHTTP.fetch([ScoutActivityItem].self, from: ScoutWeb.baseURL().appending(path: "api/activity"))
    }
}
