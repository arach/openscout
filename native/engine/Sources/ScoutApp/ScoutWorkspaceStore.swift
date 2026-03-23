import Foundation
import ScoutCore

actor ScoutWorkspaceStore {
    private let supportPaths: ScoutSupportPaths
    private let seedSnapshot: ScoutWorkspaceSnapshot
    private let encoder: JSONEncoder
    private let lineEncoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        supportPaths: ScoutSupportPaths,
        seedSnapshot: ScoutWorkspaceSnapshot
    ) {
        self.supportPaths = supportPaths
        self.seedSnapshot = seedSnapshot

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder

        let lineEncoder = JSONEncoder()
        self.lineEncoder = lineEncoder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func loadWorkspace() throws -> ScoutWorkspaceSnapshot {
        try ensureWorkspaceDirectory()

        guard FileManager.default.fileExists(atPath: supportPaths.workspaceStateFileURL.path(percentEncoded: false)) else {
            try saveWorkspace(seedSnapshot)
            return seedSnapshot
        }

        let data = try Data(contentsOf: supportPaths.workspaceStateFileURL)
        return try decoder.decode(ScoutWorkspaceSnapshot.self, from: data)
    }

    func saveWorkspace(_ snapshot: ScoutWorkspaceSnapshot) throws {
        try ensureWorkspaceDirectory()
        let data = try encoder.encode(snapshot)
        try data.write(to: supportPaths.workspaceStateFileURL, options: .atomic)
    }

    func prepareRelayHub() -> ScoutRelayConfig {
        do {
            try ensureRelayHub()
            return try readRelayConfig()
        } catch {
            return ScoutRelayConfig()
        }
    }

    func loadRelayConfig() async -> ScoutRelayConfig {
        do {
            try ensureRelayHub()
            return try readRelayConfig()
        } catch {
            return ScoutRelayConfig()
        }
    }

    func loadRelayMessages(limit: Int = 80) async -> [ScoutRelayMessage] {
        do {
            try ensureRelayHub()
            return try readProjectedRelayMessages(limit: limit)
        } catch {
            return []
        }
    }

    func loadRelayStates() async -> [String: String] {
        do {
            try ensureRelayHub()
            return try readProjectedRelayStates()
        } catch {
            return [:]
        }
    }

    @discardableResult
    func sendRelayPacket(
        from sender: String,
        to targets: [String],
        packet: String
    ) throws -> ScoutRelayMessage {
        try sendRelayMessage(
            from: sender,
            to: targets,
            body: packet,
            speaksAloud: false
        )
    }

    @discardableResult
    func sendRelayMessage(
        from sender: String,
        to targets: [String],
        body: String,
        speaksAloud: Bool,
        type: ScoutRelayMessageType = .msg,
        channel: String? = nil,
        messageClass: ScoutRelayMessageClass? = nil
    ) throws -> ScoutRelayMessage {
        try ensureRelayHub()

        let sanitizedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let composed = extractSpeechAnnotatedContent(
            from: sanitizedBody,
            fallbackSpeaksAloud: speaksAloud
        )
        let mentionedTargets = targets.map { "@\($0)" }.joined(separator: " ")
        let lineBody = mentionedTargets.isEmpty ? composed.displayBody : "\(mentionedTargets)\n\n\(composed.displayBody)"
        let timestamp = Int(Date.now.timeIntervalSince1970)
        let normalizedChannel = channel?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .nilIfEmpty
        let tags = speaksAloud ? ["speak"] : []
        let eventID = createRelayEventID(prefix: "m")
        let resolvedMessageClass = messageClass ?? defaultRelayMessageClass(
            type: type,
            channel: normalizedChannel
        )
        let speechInstruction = composed.speechText.map { RelaySpeechInstructionRecord(text: $0) }

        let record = RelayStoredMessageRecord(
            id: eventID,
            ts: timestamp,
            from: sender,
            type: type,
            body: lineBody,
            messageClass: resolvedMessageClass,
            speech: speechInstruction,
            tags: tags.isEmpty ? nil : tags,
            to: targets.isEmpty ? nil : targets,
            channel: normalizedChannel
        )

        try appendLineEncoded(record, to: supportPaths.relayEventStreamURL)

        let logLine = formatRelayLogLine(
            timestamp: timestamp,
            sender: sender,
            type: type,
            body: lineBody,
            tags: tags
        )
        try appendTextLine(logLine, to: supportPaths.relayChannelLogURL)

        try appendInboxEntries(
            from: sender,
            to: targets,
            packet: lineBody
        )

        return ScoutRelayMessage(
            timestamp: timestamp,
            from: sender,
            type: type,
            body: lineBody,
            messageClass: resolvedMessageClass,
            speechText: composed.speechText,
            eventID: eventID,
            tags: tags,
            recipients: targets,
            channel: normalizedChannel
        )
    }

    func setRelayState(for agent: String, state: String?) throws -> [String: String] {
        try ensureRelayHub()

        var states = try readProjectedRelayStates()
        let normalized = state?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if normalized == nil || normalized == "" || normalized == "idle" || normalized == "clear" {
            states.removeValue(forKey: agent)
        } else if let normalized {
            states[agent] = normalized
        }

        let data = try encoder.encode(states)
        try data.write(to: supportPaths.relayStateFileURL, options: Data.WritingOptions.atomic)
        return states
    }

    private func appendInboxEntries(
        from sender: String,
        to targets: [String],
        packet: String
    ) throws {
        try FileManager.default.createDirectory(
            at: supportPaths.relayInboxDirectory,
            withIntermediateDirectories: true
        )

        let stamp = Date.now.formatted(date: .abbreviated, time: .shortened)
        let entry = """
        ## \(stamp) · \(sender)

        \(packet)

        ---

        """

        guard let entryData = entry.data(using: .utf8) else {
            return
        }

        for target in targets {
            let inboxURL = supportPaths.relayInboxDirectory.appending(path: "\(target).md")
            if FileManager.default.fileExists(atPath: inboxURL.path(percentEncoded: false)) {
                let handle = try FileHandle(forWritingTo: inboxURL)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: entryData)
            } else {
                try entryData.write(to: inboxURL, options: .atomic)
            }
        }
    }

    private func ensureWorkspaceDirectory() throws {
        try FileManager.default.createDirectory(
            at: supportPaths.applicationSupportDirectory,
            withIntermediateDirectories: true
        )
    }

    private func ensureRelayHub() throws {
        try FileManager.default.createDirectory(
            at: supportPaths.relayHubDirectory,
            withIntermediateDirectories: true
        )

        try FileManager.default.createDirectory(
            at: supportPaths.relayInboxDirectory,
            withIntermediateDirectories: true
        )

        if !FileManager.default.fileExists(atPath: supportPaths.relayConfigFileURL.path(percentEncoded: false)) {
            let configData = try encoder.encode(ScoutRelayConfig())
            try configData.write(to: supportPaths.relayConfigFileURL, options: .atomic)
        }

        if !FileManager.default.fileExists(atPath: supportPaths.relayEventStreamURL.path(percentEncoded: false)) {
            try "".write(to: supportPaths.relayEventStreamURL, atomically: true, encoding: .utf8)
        }

        if !FileManager.default.fileExists(atPath: supportPaths.relayChannelLogURL.path(percentEncoded: false)) {
            try "".write(to: supportPaths.relayChannelLogURL, atomically: true, encoding: .utf8)
        }

        if !FileManager.default.fileExists(atPath: supportPaths.relayStateFileURL.path(percentEncoded: false)) {
            let data = try encoder.encode([String: String]())
            try data.write(to: supportPaths.relayStateFileURL, options: .atomic)
        }
    }

    private func readRelayConfig() throws -> ScoutRelayConfig {
        guard FileManager.default.fileExists(atPath: supportPaths.relayConfigFileURL.path(percentEncoded: false)) else {
            return ScoutRelayConfig()
        }

        let data = try Data(contentsOf: supportPaths.relayConfigFileURL)
        return try decoder.decode(ScoutRelayConfig.self, from: data)
    }

    private func readProjectedRelayMessages(limit: Int) throws -> [ScoutRelayMessage] {
        let eventMessages = try readEventStreamMessages(limit: limit)
        if !eventMessages.isEmpty {
            return eventMessages
        }

        return try readLegacyRelayMessages(limit: limit)
    }

    private func readEventStreamMessages(limit: Int) throws -> [ScoutRelayMessage] {
        guard FileManager.default.fileExists(atPath: supportPaths.relayEventStreamURL.path(percentEncoded: false)) else {
            return []
        }

        let raw = try String(contentsOf: supportPaths.relayEventStreamURL, encoding: .utf8)
        let messages = raw
            .split(whereSeparator: \.isNewline)
            .compactMap { parseRelayEventLine(String($0)) }

        return messages.suffix(limit).map { $0 }
    }

    private func readLegacyRelayMessages(limit: Int) throws -> [ScoutRelayMessage] {
        guard FileManager.default.fileExists(atPath: supportPaths.relayChannelLogURL.path(percentEncoded: false)) else {
            return []
        }

        let raw = try String(contentsOf: supportPaths.relayChannelLogURL, encoding: .utf8)
        return raw
            .split(whereSeparator: \.isNewline)
            .enumerated()
            .compactMap { index, line in
                parseRelayLogLine(String(line), sequence: index + 1)
            }
            .suffix(limit)
            .map { $0 }
    }

    private func readProjectedRelayStates() throws -> [String: String] {
        let eventStates = try readEventStreamStates()
        if !eventStates.isEmpty {
            return eventStates
        }

        return try readRelayStatesFile()
    }

    private func readEventStreamStates() throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: supportPaths.relayEventStreamURL.path(percentEncoded: false)) else {
            return [:]
        }

        let raw = try String(contentsOf: supportPaths.relayEventStreamURL, encoding: .utf8)
        var states: [String: String] = [:]

        for line in raw.split(whereSeparator: \.isNewline) {
            guard let event = parseRelayStateEventLine(String(line)) else {
                continue
            }

            let trimmed = event.payload.state?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()

            if trimmed == nil || trimmed == "" || trimmed == "idle" || trimmed == "clear" {
                states.removeValue(forKey: event.actor)
            } else if let trimmed {
                states[event.actor] = trimmed
            }
        }

        return states
    }

    private func readRelayStatesFile() throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: supportPaths.relayStateFileURL.path(percentEncoded: false)) else {
            return [:]
        }

        let data = try Data(contentsOf: supportPaths.relayStateFileURL)
        return try decoder.decode([String: String].self, from: data)
    }

    private func parseRelayEventLine(_ line: String) -> ScoutRelayMessage? {
        guard let data = line.data(using: .utf8) else {
            return nil
        }

        if let event = try? decoder.decode(RelayMessageEventRecord.self, from: data),
           event.kind == "message.posted" {
            return ScoutRelayMessage(
                timestamp: event.ts,
                from: event.actor,
                type: event.payload.type,
                body: event.payload.body,
                messageClass: event.payload.messageClass,
                speechText: event.payload.speech?.text,
                eventID: event.id,
                tags: event.payload.tags ?? [],
                recipients: event.payload.to ?? [],
                channel: event.payload.channel
            )
        }

        if let legacyMessage = try? decoder.decode(RelayStoredMessageRecord.self, from: data) {
            return ScoutRelayMessage(
                timestamp: legacyMessage.ts,
                from: legacyMessage.from,
                type: legacyMessage.type,
                body: legacyMessage.body,
                messageClass: legacyMessage.messageClass,
                speechText: legacyMessage.speech?.text,
                eventID: legacyMessage.id,
                tags: legacyMessage.tags ?? [],
                recipients: legacyMessage.to ?? [],
                channel: legacyMessage.channel
            )
        }

        return nil
    }

    private func parseRelayStateEventLine(_ line: String) -> RelayStateEventRecord? {
        guard let data = line.data(using: .utf8),
              let event = try? decoder.decode(RelayStateEventRecord.self, from: data),
              event.kind == "agent.state_set" else {
            return nil
        }

        return event
    }

    private func parseRelayLogLine(_ line: String, sequence: Int) -> ScoutRelayMessage? {
        let components = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: false)
        guard components.count == 4, let timestamp = Int(components[0]) else {
            return nil
        }

        guard let type = ScoutRelayMessageType(rawValue: String(components[2])) else {
            return nil
        }

        var body = String(components[3])
        var tags: [String] = []

        while body.hasPrefix("[") {
            guard let endIndex = body.firstIndex(of: "]"), endIndex > body.startIndex else {
                break
            }

            let tag = String(body[body.index(after: body.startIndex)..<endIndex])
            tags.append(tag)
            body = String(body[body.index(after: endIndex)...]).trimmingCharacters(in: .whitespaces)
        }

        return ScoutRelayMessage(
            timestamp: timestamp,
            from: String(components[1]),
            type: type,
            body: body,
            eventID: "legacy-\(sequence)",
            tags: tags
        )
    }

    private func appendTextLine(_ line: String, to url: URL) throws {
        guard let lineData = line.data(using: .utf8) else {
            return
        }

        if FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: lineData)
        } else {
            try lineData.write(to: url, options: .atomic)
        }
    }

    private func appendLineEncoded<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try lineEncoder.encode(value)
        guard var line = String(data: data, encoding: .utf8) else {
            return
        }

        line.append("\n")
        try appendTextLine(line, to: url)
    }

    private func formatRelayLogLine(
        timestamp: Int,
        sender: String,
        type: ScoutRelayMessageType,
        body: String,
        tags: [String]
    ) -> String {
        let tagPrefix = tags.isEmpty ? "" : tags.map { "[\($0)]" }.joined(separator: " ") + " "
        return "\(timestamp) \(sender) \(type.rawValue) \(tagPrefix)\(body.replacing("\n", with: " "))\n"
    }

    private func createRelayEventID(prefix: String = "e") -> String {
        "\(prefix)-\(UUID().uuidString.lowercased())"
    }

    private func defaultRelayMessageClass(
        type: ScoutRelayMessageType,
        channel: String?
    ) -> ScoutRelayMessageClass {
        if type == .sys || channel == "system" {
            return .system
        }

        return .agent
    }

    private func extractSpeechAnnotatedContent(
        from rawBody: String,
        fallbackSpeaksAloud: Bool
    ) -> (displayBody: String, speechText: String?) {
        let pattern = #"<speak>([\s\S]*?)</speak>"#
        let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        let nsRange = NSRange(rawBody.startIndex..<rawBody.endIndex, in: rawBody)
        let matches = regex?.matches(in: rawBody, options: [], range: nsRange) ?? []

        var spokenFragments: [String] = []
        for match in matches.reversed() {
            guard match.numberOfRanges > 1,
                  let range = Range(match.range(at: 1), in: rawBody) else {
                continue
            }

            let fragment = rawBody[range].trimmingCharacters(in: .whitespacesAndNewlines)
            if !fragment.isEmpty {
                spokenFragments.insert(fragment, at: 0)
            }
        }

        var displayBody = regex?.stringByReplacingMatches(
            in: rawBody,
            options: [],
            range: nsRange,
            withTemplate: "$1"
        ) ?? rawBody
        displayBody = displayBody
            .replacingOccurrences(of: "<speak>", with: "", options: [.caseInsensitive])
            .replacingOccurrences(of: "</speak>", with: "", options: [.caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var speechText = spokenFragments.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        if speechText.isEmpty && fallbackSpeaksAloud {
            speechText = displayBody
        }

        return (
            displayBody: displayBody,
            speechText: speechText.isEmpty ? nil : speechText
        )
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private struct RelayMessageEventRecord: Codable {
    let id: String
    let kind: String
    let v: Int
    let ts: Int
    let actor: String
    let payload: RelayMessageEventPayload

    init(
        id: String,
        kind: String = "message.posted",
        v: Int = 1,
        ts: Int,
        actor: String,
        payload: RelayMessageEventPayload
    ) {
        self.id = id
        self.kind = kind
        self.v = v
        self.ts = ts
        self.actor = actor
        self.payload = payload
    }
}

private struct RelayMessageEventPayload: Codable {
    let type: ScoutRelayMessageType
    let body: String
    let messageClass: ScoutRelayMessageClass?
    let speech: RelaySpeechInstructionRecord?
    let tags: [String]?
    let to: [String]?
    let channel: String?

    enum CodingKeys: String, CodingKey {
        case type
        case body
        case messageClass = "class"
        case speech
        case tags
        case to
        case channel
    }
}

private struct RelayStateEventRecord: Codable {
    let id: String
    let kind: String
    let v: Int
    let ts: Int
    let actor: String
    let payload: RelayStateEventPayload

    init(
        id: String,
        kind: String = "agent.state_set",
        v: Int = 1,
        ts: Int,
        actor: String,
        payload: RelayStateEventPayload
    ) {
        self.id = id
        self.kind = kind
        self.v = v
        self.ts = ts
        self.actor = actor
        self.payload = payload
    }
}

private struct RelayStateEventPayload: Codable {
    let state: String?
}

private struct RelayStoredMessageRecord: Codable {
    let id: String
    let ts: Int
    let from: String
    let type: ScoutRelayMessageType
    let body: String
    let messageClass: ScoutRelayMessageClass?
    let speech: RelaySpeechInstructionRecord?
    let tags: [String]?
    let to: [String]?
    let channel: String?

    enum CodingKeys: String, CodingKey {
        case id
        case ts
        case from
        case type
        case body
        case messageClass = "class"
        case speech
        case tags
        case to
        case channel
    }
}

private struct RelaySpeechInstructionRecord: Codable {
    let text: String
}
