import Foundation

enum BrokerControlAction: String {
    case install
    case start
    case stop
    case restart
}

struct BrokerServiceStatus: Decodable, Sendable {
    struct HealthSnapshot: Decodable, Sendable {
        let reachable: Bool
        let ok: Bool
        let error: String?
    }

    let label: String
    let launchAgentPath: String
    let brokerURL: String
    let installed: Bool
    let loaded: Bool
    let pid: Int?
    let lastExitStatus: Int?
    let reachable: Bool
    let health: HealthSnapshot
    let lastLogLine: String?

    enum CodingKeys: String, CodingKey {
        case label
        case launchAgentPath
        case brokerURL = "brokerUrl"
        case installed
        case loaded
        case pid
        case lastExitStatus
        case reachable
        case health
        case lastLogLine
    }
}

@MainActor
struct BrokerService {
    private let toolchain = OpenScoutToolchain()
    private let decoder = JSONDecoder()

    func fetchStatus() async throws -> BrokerServiceStatus {
        try await run(subcommand: "status")
    }

    func control(_ action: BrokerControlAction) async throws -> BrokerServiceStatus {
        try await run(subcommand: action.rawValue)
    }

    private func run(subcommand: String) async throws -> BrokerServiceStatus {
        let descriptor = try toolchain.runtimeServiceCommand(subcommand: subcommand)
        let result = try await CommandRunner.run(descriptor)

        guard result.exitCode == 0 else {
            throw CommandRunnerError.nonZeroExit(
                result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr
            )
        }

        let data = Data(result.trimmedStdout.utf8)
        do {
            return try decoder.decode(BrokerServiceStatus.self, from: data)
        } catch {
            throw CommandRunnerError.nonZeroExit(
                "Failed to decode broker service output: \(error.localizedDescription)"
            )
        }
    }
}
