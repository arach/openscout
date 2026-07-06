import Foundation

// Per-agent pulse client.
//
// Fetches the event-density histogram from /api/observe/agents?ids=<agentId>.
// The response is an array of AgentObservePayload; we return the first
// payload's pulse field (absent when no timestamped events exist).
//
// JSON shape (from packages/web/server/core/observe/service.ts):
//   AgentObservePayload { agentId, data: ObserveData { pulse? } }
//   ObservePulse { bucketMs: number, endMs: number, counts: number[] }

public struct ScoutObservePulse: Decodable, Sendable {
    public let bucketMs: Double
    public let endMs: Double
    public let counts: [Int]
}

private struct ObserveData: Decodable {
    let pulse: ScoutObservePulse?
}

private struct AgentObservePayload: Decodable {
    let agentId: String
    let data: ObserveData
}

public struct ScoutObservePulseClient: Sendable {
    public init() {}

    public func fetchPulse(agentId: String) async throws -> ScoutObservePulse? {
        var components = URLComponents(url: ScoutWeb.baseURL().appending(path: "api/observe/agents"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "ids", value: agentId)]
        guard let url = components?.url else { return nil }
        let payloads = try await ScoutHTTP.fetch([AgentObservePayload].self, from: url)
        return payloads.first?.data.pulse
    }
}
