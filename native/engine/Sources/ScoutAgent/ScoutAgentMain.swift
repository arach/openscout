import Foundation
import ScoutCore

@main
struct ScoutAgentMain {
    static func main() async throws {
        let statusFileURL = resolvedStatusFileURL()
        try FileManager.default.createDirectory(
            at: statusFileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        while !Task.isCancelled {
            let status = ScoutAgentStatus(
                state: .running,
                heartbeat: .now,
                pid: ProcessInfo.processInfo.processIdentifier,
                detail: "ScoutAgent heartbeat is healthy."
            )

            try write(status: status, to: statusFileURL)
            try await Task.sleep(for: .seconds(1))
        }
    }

    private static func resolvedStatusFileURL() -> URL {
        let arguments = CommandLine.arguments

        if let index = arguments.firstIndex(of: "--status-file"),
           arguments.indices.contains(index + 1) {
            return URL(filePath: arguments[index + 1])
        }

        return ScoutSupportPaths.default().agentStatusFileURL
    }

    private static func write(status: ScoutAgentStatus, to fileURL: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let data = try encoder.encode(status)
        try data.write(to: fileURL, options: .atomic)
    }
}
