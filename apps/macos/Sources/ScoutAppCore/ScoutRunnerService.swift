import Foundation

public struct HudRunnerOptions: Decodable {
    public struct Defaults: Decodable {
        public let runner: String?
        public let directory: String?
        public let harness: String?
        public let model: String?
        public let persistence: String?
    }

    public let defaults: Defaults?
    public let runners: [HudRunnerOption]
    public let harnesses: [HudRunnerHarnessOption]
    public let models: [HudRunnerModelOption]
    public let projects: [HudRunnerProjectOption]
    public let agents: [HudRunnerAgentOption]
}

public struct HudRunnerOption: Decodable, Identifiable {
    public let id: String
    public let label: String
    public let description: String?
    public let supports: [String]

    public init(id: String, label: String, description: String?, supports: [String]) {
        self.id = id
        self.label = label
        self.description = description
        self.supports = supports
    }
}

public struct HudRunnerHarnessOption: Decodable, Identifiable {
    public let id: String
    public let name: String?
    public let label: String
    public let description: String?
    public let state: String?
    public let ready: Bool?
    public let detail: String?

    public init(
        id: String,
        name: String?,
        label: String,
        description: String?,
        state: String?,
        ready: Bool?,
        detail: String?
    ) {
        self.id = id
        self.name = name
        self.label = label
        self.description = description
        self.state = state
        self.ready = ready
        self.detail = detail
    }
}

public struct HudRunnerModelOption: Decodable, Identifiable {
    public let id: String
    public let label: String
    public let harnesses: [String]
    public let source: String?

    public init(id: String, label: String, harnesses: [String], source: String?) {
        self.id = id
        self.label = label
        self.harnesses = harnesses
        self.source = source
    }
}

public struct HudRunnerProjectOption: Decodable, Identifiable {
    public let id: String
    public let title: String
    public let root: String
    public let source: String?
    public let registrationKind: String?
    public let defaultHarness: String?

    public init(
        id: String,
        title: String,
        root: String,
        source: String?,
        registrationKind: String?,
        defaultHarness: String?
    ) {
        self.id = id
        self.title = title
        self.root = root
        self.source = source
        self.registrationKind = registrationKind
        self.defaultHarness = defaultHarness
    }
}

public struct HudRunnerAgentOption: Decodable, Identifiable {
    public let id: String
    public let name: String
    public let handle: String?
    public let status: String?
    public let harness: String?
    public let model: String?
    public let projectRoot: String?
    public let cwd: String?
    public let harnessSessionId: String?
}

public struct HudRunnerAskResponse: Decodable {
    public struct Flight: Decodable {
        public let id: String
        public let invocationId: String?
        public let targetAgentId: String?
        public let state: String?
    }

    public let ok: Bool?
    public let runner: String?
    public let directory: String?
    public let persistence: String?
    public let flight: Flight?
    public let conversationId: String?
    public let messageId: String?
    public let targetAgentId: String?
}

public enum HudRunnerServiceError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int, String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Runner API returned an invalid response"
        case .httpStatus(let status, let message):
            return message.isEmpty ? "Runner API returned HTTP \(status)" : message
        }
    }
}

public enum HudRunnerService {
    private struct RunnerAskRequest: Encodable {
        struct Target: Encodable {
            let kind: String
            let path: String
        }

        struct Execution: Encodable {
            let harness: String?
            let model: String?
            let session: String?
        }

        struct Agent: Encodable {
            let persistence: String
            let name: String?
            let displayName: String?
        }

        let runner: String
        let target: Target
        let execution: Execution
        let agent: Agent
        let instructions: String
    }

    public static func fetchOptions() async throws -> HudRunnerOptions {
        let url = ScoutWeb.baseURL().appending(path: "api/runner/options")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw HudRunnerServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HudRunnerServiceError.httpStatus(http.statusCode, decodeErrorMessage(data))
        }
        return try JSONDecoder().decode(HudRunnerOptions.self, from: data)
    }

    public static func ask(
        directory: String,
        harness: String,
        model: String,
        persistence: String,
        agentName: String,
        displayName: String,
        instructions: String
    ) async throws -> HudRunnerAskResponse {
        let url = ScoutWeb.baseURL().appending(path: "api/runner/ask")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload = RunnerAskRequest(
            runner: "scout",
            target: .init(kind: "project_path", path: directory),
            execution: .init(
                harness: harness.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                model: model.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                session: "new"
            ),
            agent: .init(
                persistence: persistence,
                name: agentName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ),
            instructions: instructions
        )
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HudRunnerServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HudRunnerServiceError.httpStatus(http.statusCode, decodeErrorMessage(data))
        }
        return try JSONDecoder().decode(HudRunnerAskResponse.self, from: data)
    }

    private static func decodeErrorMessage(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String else {
            return ""
        }
        return message
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
