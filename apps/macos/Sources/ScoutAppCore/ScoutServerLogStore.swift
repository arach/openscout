import Combine
import Foundation

public enum ScoutServerLogStream: String, CaseIterable, Identifiable, Sendable {
    case output
    case errors

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .output: return "Output"
        case .errors: return "Errors"
        }
    }

    public var shortLabel: String {
        switch self {
        case .output: return "OUT"
        case .errors: return "ERR"
        }
    }

    public var fileName: String {
        switch self {
        case .output: return "stdout.log"
        case .errors: return "stderr.log"
        }
    }
}

public enum ScoutServerLogLevel: String, Sendable {
    case normal
    case warning
    case error
}

public struct ScoutServerLogLine: Identifiable, Equatable, Sendable {
    public let id: String
    public let offset: UInt64
    public let text: String
    public let level: ScoutServerLogLevel

    public init(stream: ScoutServerLogStream, offset: UInt64, text: String) {
        self.id = "\(stream.rawValue):\(offset)"
        self.offset = offset
        self.text = text
        self.level = Self.inferLevel(text, stream: stream)
    }

    private static func inferLevel(
        _ text: String,
        stream: ScoutServerLogStream
    ) -> ScoutServerLogLevel {
        let normalized = text.lowercased()
        if normalized.contains("error")
            || normalized.contains("failed")
            || normalized.contains("unreachable")
            || normalized.contains("timed out")
            || normalized.contains("timeout") {
            return .error
        }
        if normalized.contains("warning") || normalized.contains("warn") {
            return .warning
        }
        return stream == .errors ? .warning : .normal
    }
}

public struct ScoutServerLogSnapshot: Equatable, Sendable {
    public let stream: ScoutServerLogStream
    public let fileURL: URL
    public let fileSize: UInt64
    public let modifiedAt: Date?
    public let lines: [ScoutServerLogLine]

    public init(
        stream: ScoutServerLogStream,
        fileURL: URL,
        fileSize: UInt64,
        modifiedAt: Date?,
        lines: [ScoutServerLogLine]
    ) {
        self.stream = stream
        self.fileURL = fileURL
        self.fileSize = fileSize
        self.modifiedAt = modifiedAt
        self.lines = lines
    }
}

public enum ScoutSupportDirectory {
    public static func url(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        if let configured = environment["OPENSCOUT_SUPPORT_DIRECTORY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }

        return homeDirectory
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("OpenScout", isDirectory: true)
    }

    public static func brokerLogURL(
        for stream: ScoutServerLogStream,
        supportDirectory: URL = url()
    ) -> URL {
        supportDirectory
            .appendingPathComponent("logs", isDirectory: true)
            .appendingPathComponent("broker", isDirectory: true)
            .appendingPathComponent(stream.fileName, isDirectory: false)
    }
}

public enum ScoutServerLogReader {
    public static func read(
        stream: ScoutServerLogStream,
        supportDirectory: URL = ScoutSupportDirectory.url(),
        maxBytes: Int = 256 * 1_024,
        maxLines: Int = 500
    ) throws -> ScoutServerLogSnapshot {
        let fileURL = ScoutSupportDirectory.brokerLogURL(
            for: stream,
            supportDirectory: supportDirectory
        )
        let values = try fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let fileSize = UInt64(max(0, values.fileSize ?? 0))
        let byteLimit = UInt64(max(1, maxBytes))
        let startOffset = fileSize > byteLimit ? fileSize - byteLimit : 0

        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        try handle.seek(toOffset: startOffset)
        let data = try handle.readToEnd() ?? Data()
        let lines = decodeLines(
            data,
            stream: stream,
            startOffset: startOffset,
            startsMidFile: startOffset > 0,
            maxLines: max(1, maxLines)
        )

        return ScoutServerLogSnapshot(
            stream: stream,
            fileURL: fileURL,
            fileSize: fileSize,
            modifiedAt: values.contentModificationDate,
            lines: lines
        )
    }

    static func decodeLines(
        _ data: Data,
        stream: ScoutServerLogStream,
        startOffset: UInt64,
        startsMidFile: Bool,
        maxLines: Int
    ) -> [ScoutServerLogLine] {
        let bytes = Array(data)
        guard !bytes.isEmpty else { return [] }

        var cursor = 0
        if startsMidFile {
            guard let newline = bytes.firstIndex(of: 0x0A) else { return [] }
            cursor = newline + 1
        }

        var decoded: [ScoutServerLogLine] = []
        while cursor < bytes.count {
            let lineStart = cursor
            let newline = bytes[cursor...].firstIndex(of: 0x0A) ?? bytes.endIndex
            var lineEnd = newline
            if lineEnd > lineStart, bytes[lineEnd - 1] == 0x0D {
                lineEnd -= 1
            }
            if lineEnd > lineStart {
                let text = String(decoding: bytes[lineStart..<lineEnd], as: UTF8.self)
                decoded.append(
                    ScoutServerLogLine(
                        stream: stream,
                        offset: startOffset + UInt64(lineStart),
                        text: text
                    )
                )
            }
            guard newline < bytes.endIndex else { break }
            cursor = newline + 1
        }

        return Array(decoded.suffix(max(1, maxLines)))
    }
}

@MainActor
public final class ScoutServerLogStore: ObservableObject, ScoutChangeSetting {
    @Published public private(set) var snapshot: ScoutServerLogSnapshot?
    @Published public private(set) var selectedStream: ScoutServerLogStream
    @Published public private(set) var isLoading = false
    @Published public private(set) var lastError: String?

    private let supportDirectory: URL
    private let pollInterval: TimeInterval
    private let maxBytes: Int
    private let maxLines: Int
    private var pollTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?

    public init(
        selectedStream: ScoutServerLogStream = .output,
        supportDirectory: URL = ScoutSupportDirectory.url(),
        pollInterval: TimeInterval = 1.2,
        maxBytes: Int = 256 * 1_024,
        maxLines: Int = 500
    ) {
        self.selectedStream = selectedStream
        self.supportDirectory = supportDirectory
        self.pollInterval = max(0.25, pollInterval)
        self.maxBytes = max(1, maxBytes)
        self.maxLines = max(1, maxLines)
    }

    public var lines: [ScoutServerLogLine] {
        snapshot?.lines ?? []
    }

    public var fileURL: URL {
        snapshot?.fileURL
            ?? ScoutSupportDirectory.brokerLogURL(
                for: selectedStream,
                supportDirectory: supportDirectory
            )
    }

    public func start() {
        guard pollTask == nil else { return }
        refresh()
        let interval = pollInterval
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.refresh()
            }
        }
    }

    public func stop() {
        pollTask?.cancel()
        pollTask = nil
        refreshTask?.cancel()
        refreshTask = nil
        scoutSetIfChanged(false, to: \.isLoading)
    }

    public func select(_ stream: ScoutServerLogStream) {
        guard stream != selectedStream else { return }
        scoutSetIfChanged(stream, to: \.selectedStream)
        refreshTask?.cancel()
        refreshTask = nil
        scoutSetIfChanged(nil, to: \.snapshot)
        scoutSetIfChanged(nil, to: \.lastError)
        refresh()
    }

    public func refresh() {
        guard refreshTask == nil else { return }
        scoutSetIfChanged(snapshot == nil, to: \.isLoading)
        let stream = selectedStream
        let directory = supportDirectory
        let byteLimit = maxBytes
        let lineLimit = maxLines
        refreshTask = Task { [weak self] in
            guard let self else { return }
            defer {
                self.scoutSetIfChanged(false, to: \.isLoading)
                self.refreshTask = nil
            }
            do {
                let next = try await Task.detached(priority: .utility) {
                    try ScoutServerLogReader.read(
                        stream: stream,
                        supportDirectory: directory,
                        maxBytes: byteLimit,
                        maxLines: lineLimit
                    )
                }.value
                guard !Task.isCancelled, self.selectedStream == stream else { return }
                self.scoutSetIfChanged(next, to: \.snapshot)
                self.scoutSetIfChanged(nil, to: \.lastError)
            } catch {
                guard !Task.isCancelled else { return }
                self.scoutSetIfChanged(error.localizedDescription, to: \.lastError)
            }
        }
    }
}
