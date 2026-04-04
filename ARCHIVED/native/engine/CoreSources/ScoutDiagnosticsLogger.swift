import Foundation

public enum ScoutDiagnosticsLogger {
    private static let queue = DispatchQueue(label: "openscout.diagnostics.log")

    public static func log(
        _ message: @autoclosure () -> String,
        supportPaths: ScoutSupportPaths = .default()
    ) {
        let renderedMessage = message()
        queue.async {
            let timestamp = Date.now.ISO8601Format(.iso8601(timeZone: .current, includingFractionalSeconds: true))
            let line = "[\(timestamp)] \(renderedMessage)\n"
            let lineData = Data(line.utf8)
            let fileManager = FileManager.default

            do {
                try fileManager.createDirectory(
                    at: supportPaths.applicationSupportDirectory,
                    withIntermediateDirectories: true
                )

                let logPath = supportPaths.diagnosticsLogURL.path(percentEncoded: false)
                if !fileManager.fileExists(atPath: logPath) {
                    fileManager.createFile(atPath: logPath, contents: lineData)
                    return
                }

                let handle = try FileHandle(forWritingTo: supportPaths.diagnosticsLogURL)
                try handle.seekToEnd()
                try handle.write(contentsOf: lineData)
                try handle.close()
            } catch {
                fputs("Scout diagnostics log failed: \(error)\n", stderr)
            }
        }
    }

    public static func recentLines(
        limit: Int = 80,
        supportPaths: ScoutSupportPaths = .default()
    ) -> [String] {
        guard limit > 0 else {
            return []
        }

        do {
            let data = try Data(contentsOf: supportPaths.diagnosticsLogURL)
            guard let content = String(data: data, encoding: .utf8) else {
                return []
            }

            return content
                .split(separator: "\n", omittingEmptySubsequences: false)
                .suffix(limit)
                .map(String.init)
        } catch {
            return []
        }
    }
}
