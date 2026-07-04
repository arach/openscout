import Darwin
import Foundation

public struct ScoutdProbeCapability: Codable, Equatable, Sendable {
    public let probeId: String
    public let schemaVersion: Int
    public let ttlMs: UInt64
}

public struct ScoutdProbeCapabilities: Equatable, Sendable {
    public let schema: String
    public let daemonVersion: String
    public let families: [ScoutdProbeCapability]
}

public struct ScoutdProbeError: Equatable, Sendable {
    public let code: String
    public let message: String
    public let timedOut: Bool
}

public struct ScoutdProbeSnapshot: Equatable, Sendable {
    public let schema: String
    public let probeId: String
    public let key: String?
    public let generatedAt: UInt64
    public let ttlMs: UInt64
    public let valueData: Data?
    public let error: ScoutdProbeError?
    public let daemonVersion: String

    init(
        schema: String = ScoutdProbeClient.snapshotSchema,
        probeId: String,
        key: String? = nil,
        generatedAt: UInt64,
        ttlMs: UInt64,
        valueData: Data?,
        error: ScoutdProbeError? = nil,
        daemonVersion: String
    ) {
        self.schema = schema
        self.probeId = probeId
        self.key = key
        self.generatedAt = generatedAt
        self.ttlMs = ttlMs
        self.valueData = valueData
        self.error = error
        self.daemonVersion = daemonVersion
    }
}

public enum ScoutdProbeClientError: LocalizedError, Sendable {
    case socketPathTooLong(String)
    case timeout(String)
    case transport(String)
    case responseTooLarge(Int)
    case invalidResponse(String)
    case unsupportedSchema(String)

    public var errorDescription: String? {
        switch self {
        case .socketPathTooLong(let path):
            return "scoutd probe socket path is too long: \(path)"
        case .timeout(let message),
             .transport(let message),
             .invalidResponse(let message),
             .unsupportedSchema(let message):
            return message
        case .responseTooLarge(let bytes):
            return "scoutd probe response exceeded \(bytes) bytes"
        }
    }
}

protocol ScoutdProbeTransport: Sendable {
    func roundTrip(socketPath: String, request: Data, timeout: TimeInterval) async throws -> Data
}

public final class ScoutdProbeClient: @unchecked Sendable {
    static let capabilitiesSchema = "openscout.probe.capabilities/v1"
    static let requestSchema = "openscout.probe.request/v1"
    static let snapshotSchema = "openscout.probe.snapshot/v1"

    private struct CachedCapabilities: Sendable {
        let capabilities: ScoutdProbeCapabilities
        let fetchedAt: Date
    }

    private struct CapabilitiesEnvelope: Decodable {
        let schema: String
        let daemonVersion: String
        let families: [ScoutdProbeCapability]
    }

    public let socketURL: URL
    public let timeout: TimeInterval
    public let capabilityCacheTTL: TimeInterval

    private let transport: any ScoutdProbeTransport
    private let fileManager: FileManager
    private let lock = NSLock()
    private var cachedCapabilities: CachedCapabilities?

    public convenience init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        timeout: TimeInterval = 0.75,
        capabilityCacheTTL: TimeInterval = 30
    ) {
        self.init(
            socketURL: Self.defaultSocketURL(environment: environment, fileManager: fileManager),
            fileManager: fileManager,
            timeout: timeout,
            capabilityCacheTTL: capabilityCacheTTL
        )
    }

    public convenience init(
        socketURL: URL,
        fileManager: FileManager = .default,
        timeout: TimeInterval = 0.75,
        capabilityCacheTTL: TimeInterval = 30
    ) {
        self.init(
            socketURL: socketURL,
            transport: UnixDomainSocketProbeTransport(),
            fileManager: fileManager,
            timeout: timeout,
            capabilityCacheTTL: capabilityCacheTTL
        )
    }

    init(
        socketURL: URL,
        transport: any ScoutdProbeTransport,
        fileManager: FileManager = .default,
        timeout: TimeInterval = 0.75,
        capabilityCacheTTL: TimeInterval = 30
    ) {
        self.socketURL = socketURL
        self.transport = transport
        self.fileManager = fileManager
        self.timeout = timeout
        self.capabilityCacheTTL = capabilityCacheTTL
    }

    public var socketPath: String {
        socketURL.path
    }

    public static func defaultSocketURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL {
        if let explicit = trimmedEnvironmentValue("OPENSCOUT_PROBES_SOCKET", in: environment) {
            return expandPath(explicit, fileManager: fileManager)
        }

        let openScoutHome = trimmedEnvironmentValue("OPENSCOUT_HOME", in: environment)
            .map { expandPath($0, fileManager: fileManager) }
            ?? fileManager.homeDirectoryForCurrentUser.appending(path: ".openscout")
        return openScoutHome
            .appending(path: "run")
            .appending(path: "scoutd-probes.sock")
    }

    public func socketExists() -> Bool {
        fileManager.fileExists(atPath: socketPath)
    }

    public func supportsProbe(_ probeId: String, forceRefresh: Bool = false) async throws -> Bool {
        let capabilities = try await capabilities(forceRefresh: forceRefresh)
        return capabilities.families.contains { $0.probeId == probeId }
    }

    public func capabilities(forceRefresh: Bool = false) async throws -> ScoutdProbeCapabilities {
        if !forceRefresh, let cached = cachedCapabilitiesIfFresh() {
            return cached
        }

        let request = try Self.jsonData(["schema": Self.capabilitiesSchema])
        let response = try await transport.roundTrip(socketPath: socketPath, request: request, timeout: timeout)
        let envelope = try JSONDecoder().decode(CapabilitiesEnvelope.self, from: response)
        guard envelope.schema == Self.capabilitiesSchema else {
            throw ScoutdProbeClientError.unsupportedSchema(
                "unexpected scoutd probe capabilities schema: \(envelope.schema)"
            )
        }

        let capabilities = ScoutdProbeCapabilities(
            schema: envelope.schema,
            daemonVersion: envelope.daemonVersion,
            families: envelope.families
        )
        cache(capabilities)
        return capabilities
    }

    public func snapshot(probeId: String, key: String? = nil, maxAgeMs: UInt64) async throws -> ScoutdProbeSnapshot {
        let request = try Self.jsonData([
            "schema": Self.requestSchema,
            "probeId": probeId,
            "key": key ?? NSNull(),
            "maxAgeMs": maxAgeMs,
        ])
        let response = try await transport.roundTrip(socketPath: socketPath, request: request, timeout: timeout)
        return try Self.decodeSnapshot(response, expectedProbeId: probeId)
    }

    static func decodeSnapshot(_ data: Data, expectedProbeId: String? = nil) throws -> ScoutdProbeSnapshot {
        let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        guard let root = object as? [String: Any] else {
            throw ScoutdProbeClientError.invalidResponse("scoutd probe response was not a JSON object")
        }

        let schema = root["schema"] as? String ?? ""
        guard schema == snapshotSchema else {
            throw ScoutdProbeClientError.unsupportedSchema("unexpected scoutd probe snapshot schema: \(schema)")
        }

        guard let probeId = root["probeId"] as? String, !probeId.isEmpty else {
            throw ScoutdProbeClientError.invalidResponse("scoutd probe snapshot missing probeId")
        }
        if let expectedProbeId, probeId != expectedProbeId {
            throw ScoutdProbeClientError.invalidResponse(
                "scoutd probe snapshot probeId mismatch: expected \(expectedProbeId), got \(probeId)"
            )
        }

        let generatedAt = try uint64Field(root["generatedAt"], name: "generatedAt")
        let ttlMs = try uint64Field(root["ttlMs"], name: "ttlMs")
        let daemonVersion = root["daemonVersion"] as? String ?? "unknown"
        let key: String? = {
            guard let raw = root["key"], !(raw is NSNull) else { return nil }
            return raw as? String
        }()
        let valueData: Data? = try {
            guard let value = root["value"], !(value is NSNull) else { return nil }
            guard JSONSerialization.isValidJSONObject(value) || value is String || value is NSNumber else {
                throw ScoutdProbeClientError.invalidResponse("scoutd probe snapshot value is not valid JSON")
            }
            return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        }()
        let error = decodeError(root["error"])

        return ScoutdProbeSnapshot(
            schema: schema,
            probeId: probeId,
            key: key,
            generatedAt: generatedAt,
            ttlMs: ttlMs,
            valueData: valueData,
            error: error,
            daemonVersion: daemonVersion
        )
    }

    private func cachedCapabilitiesIfFresh() -> ScoutdProbeCapabilities? {
        lock.lock()
        defer { lock.unlock() }
        guard let cachedCapabilities else { return nil }
        if Date().timeIntervalSince(cachedCapabilities.fetchedAt) <= capabilityCacheTTL {
            return cachedCapabilities.capabilities
        }
        return nil
    }

    private func cache(_ capabilities: ScoutdProbeCapabilities) {
        lock.lock()
        cachedCapabilities = CachedCapabilities(capabilities: capabilities, fetchedAt: Date())
        lock.unlock()
    }

    private static func jsonData(_ object: [String: Any]) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        return data + Data([0x0a])
    }

    private static func decodeError(_ value: Any?) -> ScoutdProbeError? {
        guard let value, !(value is NSNull) else { return nil }
        guard let object = value as? [String: Any] else {
            return ScoutdProbeError(
                code: "invalid_error",
                message: "scoutd probe snapshot error was malformed",
                timedOut: false
            )
        }
        return ScoutdProbeError(
            code: object["code"] as? String ?? "unknown",
            message: object["message"] as? String ?? "Unknown scoutd probe error.",
            timedOut: (object["timed_out"] as? Bool) ?? (object["timedOut"] as? Bool) ?? false
        )
    }

    private static func uint64Field(_ value: Any?, name: String) throws -> UInt64 {
        if let number = value as? NSNumber {
            return number.uint64Value
        }
        if let string = value as? String, let parsed = UInt64(string) {
            return parsed
        }
        throw ScoutdProbeClientError.invalidResponse("scoutd probe snapshot missing numeric \(name)")
    }

    private static func trimmedEnvironmentValue(_ key: String, in environment: [String: String]) -> String? {
        guard let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func expandPath(_ value: String, fileManager: FileManager) -> URL {
        if value == "~" {
            return fileManager.homeDirectoryForCurrentUser
        }
        if value.hasPrefix("~/") {
            return fileManager.homeDirectoryForCurrentUser.appendingPathComponent(String(value.dropFirst(2)))
        }
        return URL(fileURLWithPath: value)
    }
}

private struct UnixDomainSocketProbeTransport: ScoutdProbeTransport {
    private let maxResponseBytes = 8 * 1024 * 1024

    func roundTrip(socketPath: String, request: Data, timeout: TimeInterval) async throws -> Data {
        try await Task.detached(priority: .utility) {
            try roundTripSync(socketPath: socketPath, request: request, timeout: timeout)
        }.value
    }

    private func roundTripSync(socketPath: String, request: Data, timeout: TimeInterval) throws -> Data {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw posixError("create scoutd probe socket")
        }
        defer { Darwin.close(fd) }

        try connect(fd: fd, socketPath: socketPath, timeout: timeout)
        try writeAll(fd: fd, data: request, timeout: timeout)
        Darwin.shutdown(fd, SHUT_WR)
        return try readToEOF(fd: fd, timeout: timeout)
    }

    private func connect(fd: Int32, socketPath: String, timeout: TimeInterval) throws {
        var address = sockaddr_un()
        let pathBytes = Array(socketPath.utf8CString)
        let maxPathBytes = MemoryLayout.size(ofValue: address.sun_path)
        guard pathBytes.count <= maxPathBytes else {
            throw ScoutdProbeClientError.socketPathTooLong(socketPath)
        }

        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { rawBuffer in
            for index in 0..<pathBytes.count {
                rawBuffer[index] = UInt8(bitPattern: pathBytes[index])
            }
        }

        let originalFlags = Darwin.fcntl(fd, F_GETFL, 0)
        if originalFlags >= 0 {
            _ = Darwin.fcntl(fd, F_SETFL, originalFlags | O_NONBLOCK)
        }

        let length = socklen_t((MemoryLayout<sockaddr_un>.offset(of: \.sun_path) ?? 0) + pathBytes.count)
        let status = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                Darwin.connect(fd, sockaddrPointer, length)
            }
        }

        if status != 0 {
            let connectErrno = errno
            if connectErrno == EINPROGRESS {
                let deadline = Date().addingTimeInterval(timeout)
                try waitFor(fd: fd, events: Int16(POLLOUT), deadline: deadline, operation: "connect to scoutd probe socket")
                var socketError: Int32 = 0
                var socketErrorLength = socklen_t(MemoryLayout<Int32>.size)
                let optionStatus = Darwin.getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketError, &socketErrorLength)
                if optionStatus != 0 {
                    throw posixError("inspect scoutd probe socket connect")
                }
                if socketError != 0 {
                    throw posixError("connect to scoutd probe socket", code: socketError)
                }
            } else {
                throw posixError("connect to scoutd probe socket", code: connectErrno)
            }
        }

        if originalFlags >= 0 {
            _ = Darwin.fcntl(fd, F_SETFL, originalFlags | O_NONBLOCK)
        }
    }

    private func writeAll(fd: Int32, data: Data, timeout: TimeInterval) throws {
        let deadline = Date().addingTimeInterval(timeout)
        try data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                try waitFor(fd: fd, events: Int16(POLLOUT), deadline: deadline, operation: "write scoutd probe request")
                let written = Darwin.write(fd, baseAddress.advanced(by: offset), rawBuffer.count - offset)
                if written > 0 {
                    offset += written
                    continue
                }
                if written == 0 {
                    throw ScoutdProbeClientError.transport("scoutd probe socket closed while writing request")
                }
                if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK {
                    continue
                }
                throw posixError("write scoutd probe request")
            }
        }
    }

    private func readToEOF(fd: Int32, timeout: TimeInterval) throws -> Data {
        let deadline = Date().addingTimeInterval(timeout)
        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 8192)

        while true {
            try waitFor(fd: fd, events: Int16(POLLIN), deadline: deadline, operation: "read scoutd probe response")
            let readCount = Darwin.read(fd, &buffer, buffer.count)
            if readCount > 0 {
                response.append(buffer, count: readCount)
                if response.count > maxResponseBytes {
                    throw ScoutdProbeClientError.responseTooLarge(maxResponseBytes)
                }
                continue
            }
            if readCount == 0 {
                return response
            }
            if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK {
                continue
            }
            throw posixError("read scoutd probe response")
        }
    }

    private func waitFor(fd: Int32, events: Int16, deadline: Date, operation: String) throws {
        while true {
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else {
                throw ScoutdProbeClientError.timeout("timed out while attempting to \(operation)")
            }
            var descriptor = pollfd(fd: fd, events: events, revents: 0)
            let timeoutMs = Int32(min(max(1, remaining * 1000), Double(Int32.max)))
            let status = Darwin.poll(&descriptor, 1, timeoutMs)
            if status > 0 {
                if descriptor.revents & events != 0 || descriptor.revents & Int16(POLLHUP) != 0 {
                    return
                }
                if descriptor.revents & Int16(POLLERR | POLLNVAL) != 0 {
                    throw ScoutdProbeClientError.transport("scoutd probe socket reported an error during \(operation)")
                }
                continue
            }
            if status == 0 {
                throw ScoutdProbeClientError.timeout("timed out while attempting to \(operation)")
            }
            if errno == EINTR {
                continue
            }
            throw posixError(operation)
        }
    }

    private func posixError(_ operation: String, code: Int32 = errno) -> ScoutdProbeClientError {
        let message = String(cString: strerror(code))
        return .transport("failed to \(operation): \(message)")
    }
}
