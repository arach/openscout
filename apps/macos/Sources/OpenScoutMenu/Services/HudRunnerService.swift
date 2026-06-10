import Foundation
import ScoutAppCore

struct HudRunnerOptions: Decodable {
    struct Defaults: Decodable {
        let runner: String?
        let directory: String?
        let harness: String?
        let model: String?
        let persistence: String?
    }

    let defaults: Defaults?
    let runners: [HudRunnerOption]
    let harnesses: [HudRunnerHarnessOption]
    let models: [HudRunnerModelOption]
    let projects: [HudRunnerProjectOption]
    let agents: [HudRunnerAgentOption]
}

struct HudRunnerOption: Decodable, Identifiable {
    let id: String
    let label: String
    let description: String?
    let supports: [String]
}

struct HudRunnerHarnessOption: Decodable, Identifiable {
    let id: String
    let name: String?
    let label: String
    let description: String?
    let state: String?
    let ready: Bool?
    let detail: String?
}

struct HudRunnerModelOption: Decodable, Identifiable {
    let id: String
    let label: String
    let harnesses: [String]
    let source: String?
}

struct HudRunnerProjectOption: Decodable, Identifiable {
    let id: String
    let title: String
    let root: String
    let source: String?
    let registrationKind: String?
    let defaultHarness: String?
}

struct HudRunnerAgentOption: Decodable, Identifiable {
    let id: String
    let name: String
    let handle: String?
    let status: String?
    let harness: String?
    let model: String?
    let projectRoot: String?
    let cwd: String?
    let harnessSessionId: String?
}

struct HudRunnerAskResponse: Decodable {
    struct Flight: Decodable {
        let id: String
        let invocationId: String?
        let targetAgentId: String?
        let state: String?
    }

    let ok: Bool?
    let runner: String?
    let directory: String?
    let persistence: String?
    let flight: Flight?
    let conversationId: String?
    let messageId: String?
    let targetAgentId: String?
}

enum HudRunnerServiceError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Runner API returned an invalid response"
        case .httpStatus(let status, let message):
            return message.isEmpty ? "Runner API returned HTTP \(status)" : message
        }
    }
}

enum HudRunnerService {
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

    static func fetchOptions() async throws -> HudRunnerOptions {
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

    static func ask(
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
