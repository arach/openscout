import Foundation

struct ScoutBrokerServiceHealth: Decodable, Equatable {
    let reachable: Bool
    let ok: Bool
    let error: String?
}

struct ScoutBrokerServiceStatus: Decodable, Equatable {
    let label: String
    let mode: String
    let launchAgentPath: String
    let brokerURL: String
    let supportDirectory: String
    let controlHome: String
    let stdoutLogPath: String
    let stderrLogPath: String
    let installed: Bool
    let loaded: Bool
    let pid: Int32?
    let launchdState: String?
    let lastExitStatus: Int?
    let usesLaunchAgent: Bool
    let reachable: Bool
    let health: ScoutBrokerServiceHealth
    let lastLogLine: String?

    private enum CodingKeys: String, CodingKey {
        case label
        case mode
        case launchAgentPath
        case brokerURL = "brokerUrl"
        case supportDirectory
        case controlHome
        case stdoutLogPath
        case stderrLogPath
        case installed
        case loaded
        case pid
        case launchdState
        case lastExitStatus
        case usesLaunchAgent
        case reachable
        case health
        case lastLogLine
    }
}

enum ScoutBrokerServiceController {
    static func status() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "status")
    }

    static func install() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "install")
    }

    static func start() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "start")
    }

    static func stop() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "stop")
    }

    static func restart() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "restart")
    }

    static func uninstall() async throws -> ScoutBrokerServiceStatus {
        try await run(command: "uninstall")
    }

    private static func run(command: String) async throws -> ScoutBrokerServiceStatus {
        guard let packageURL = ScoutRuntimeLocator.packageURL(relativePath: "packages/runtime") else {
            throw NSError(
                domain: "OpenScout",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Unable to locate the repo-local runtime package."]
            )
        }

        guard let bunURL = ScoutRuntimeLocator.bunExecutableURL() else {
            throw NSError(
                domain: "OpenScout",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Unable to locate Bun for broker service control."]
            )
        }

        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = bunURL
            process.arguments = [
                "run",
                "--cwd",
                packageURL.path(percentEncoded: false),
                "service",
                command,
                "--json",
            ]
            process.environment = ProcessInfo.processInfo.environment

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = outputPipe

            process.terminationHandler = { terminatedProcess in
                let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                let text = String(decoding: data, as: UTF8.self)

                if terminatedProcess.terminationStatus != 0 {
                    let detail = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    continuation.resume(
                        throwing: NSError(
                            domain: "OpenScout",
                            code: Int(terminatedProcess.terminationStatus),
                            userInfo: [NSLocalizedDescriptionKey: detail.isEmpty ? "Broker service control failed." : detail]
                        )
                    )
                    return
                }

                do {
                    let status = try JSONDecoder().decode(ScoutBrokerServiceStatus.self, from: data)
                    continuation.resume(returning: status)
                } catch {
                    continuation.resume(throwing: error)
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
