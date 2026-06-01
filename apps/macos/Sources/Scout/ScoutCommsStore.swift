import Combine
import Foundation
#if os(macOS)
import AppKit
#endif

@MainActor
final class ScoutCommsStore: ObservableObject {
    @Published private(set) var channels: [ScoutChannel] = []
    @Published private(set) var messages: [ScoutMessage] = []
    @Published private(set) var agents: [ScoutAgent] = []
    @Published private(set) var selectedCId: String?
    @Published var selectedAgentId: String?
    @Published var channelQuery = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var lastError: String?
    @Published private(set) var observePayload: ScoutObservePayload?
    @Published private(set) var observeAgentId: String?
    @Published private(set) var isObserveLoading = false
    @Published private(set) var observeError: String?

    private let decoder = JSONDecoder()
    private var pollTask: Task<Void, Never>?
    private var channelsTask: Task<Void, Never>?
    private var messagesTask: Task<Void, Never>?
    private var agentsTask: Task<Void, Never>?
    private var observeTask: Task<Void, Never>?

    var selectedChannel: ScoutChannel? {
        guard let selectedCId else { return nil }
        return channels.first { $0.cId == selectedCId }
    }

    var selectedAgent: ScoutAgent? {
        if let selectedAgentId,
           let direct = agents.first(where: { $0.id == selectedAgentId }) {
            return direct
        }
        guard let channel = selectedChannel else { return nil }
        if let agentId = channel.agentId,
           let agent = agents.first(where: { $0.id == agentId }) {
            return agent
        }
        if let agentName = channel.agentName?.nilIfEmpty {
            return agents.first {
                $0.name.caseInsensitiveCompare(agentName) == .orderedSame
                    || $0.id.localizedCaseInsensitiveContains(agentName)
            }
        }
        return nil
    }

    var visibleChannels: [ScoutChannel] {
        let trimmed = channelQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return channels }
        return channels.filter { channel in
            channel.displayTitle.localizedCaseInsensitiveContains(trimmed)
                || channel.cId.localizedCaseInsensitiveContains(trimmed)
                || channel.participantDisplayNames.joined(separator: " ").localizedCaseInsensitiveContains(trimmed)
        }
    }

    var activeAgentCount: Int {
        agents.filter { $0.state == .working || $0.state == .needsAttention || $0.state == .available }.count
    }

    func start() {
        guard pollTask == nil else {
            refresh(force: true)
            return
        }
        refresh(force: true)
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                self?.refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        channelsTask?.cancel()
        messagesTask?.cancel()
        agentsTask?.cancel()
        observeTask?.cancel()
        channelsTask = nil
        messagesTask = nil
        agentsTask = nil
        observeTask = nil
    }

    func refresh(force: Bool = false) {
        loadChannels(force: force)
        loadAgents(force: force)
        if let observeAgentId {
            loadObserve(agentId: observeAgentId, force: true)
        }
    }

    func selectChannel(_ cId: String) {
        guard selectedCId != cId else { return }
        selectedCId = cId
        selectedAgentId = channels.first(where: { $0.cId == cId })?.agentId
        messages = []
        loadMessages()
    }

    func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
    }

    func openAgentChannel(_ agent: ScoutAgent) {
        selectedAgentId = agent.id
        if let cId = agent.conversationId ?? channels.first(where: { $0.agentId == agent.id })?.cId {
            selectedCId = cId
            loadMessages()
        }
    }

    func loadMessages() {
        guard let selectedCId else { return }
        messagesTask?.cancel()
        messagesTask = Task { [weak self] in
            await self?.loadMessages(cId: selectedCId)
        }
    }

    func loadObserve(agentId: String, force: Bool = false) {
        if observeTask != nil { return }
        if !force, observeAgentId == agentId, observePayload != nil { return }
        if observeAgentId != agentId {
            observePayload = nil
            observeError = nil
        }
        observeAgentId = agentId
        isObserveLoading = observePayload == nil
        observeTask = Task { [weak self] in
            await self?.fetchObserve(agentId: agentId)
        }
    }

    func send(_ body: String) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let selectedCId, !isSending else { return }
        isSending = true
        defer { isSending = false }

        do {
            let url = ScoutWeb.baseURL().appending(path: "api/send")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "body": trimmed,
                "cId": selectedCId,
                "conversationId": selectedCId,
            ])
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ScoutCommsError.sendFailed
            }
            lastError = nil
            refresh(force: true)
            loadMessages()
        } catch {
            lastError = Self.userFacingError(error)
        }
    }

    private func loadChannels(force: Bool) {
        if channelsTask != nil { return }
        if !force, pollTask == nil { return }
        isLoading = channels.isEmpty
        channelsTask = Task { [weak self] in
            await self?.fetchChannels()
        }
    }

    private func loadAgents(force: Bool) {
        if agentsTask != nil { return }
        if !force, pollTask == nil { return }
        agentsTask = Task { [weak self] in
            await self?.fetchAgents()
        }
    }

    private func fetchChannels() async {
        defer {
            isLoading = false
            channelsTask = nil
        }

        do {
            let base = ScoutWeb.baseURL()
            let commsURL = base
                .appending(path: "api/comms")
                .appending(queryItems: [URLQueryItem(name: "limit", value: "160")])
            let fallbackURL = base
                .appending(path: "api/conversations")
                .appending(queryItems: [URLQueryItem(name: "limit", value: "160")])
            let next = try await fetchWithFallback([ScoutChannel].self, primary: commsURL, fallback: fallbackURL)
            channels = next
            if selectedCId == nil || !next.contains(where: { $0.cId == selectedCId }) {
                selectedCId = next.first?.cId
                selectedAgentId = next.first?.agentId
            }
            lastError = nil
            loadMessages()
        } catch {
            lastError = Self.userFacingError(error)
        }
    }

    private func fetchAgents() async {
        defer { agentsTask = nil }
        do {
            agents = try await fetch([ScoutAgent].self, from: ScoutWeb.baseURL().appending(path: "api/agents"))
            lastError = nil
        } catch {
            if channels.isEmpty {
                lastError = Self.userFacingError(error)
            }
        }
    }

    private func loadMessages(cId: String) async {
        defer { messagesTask = nil }
        do {
            let url = ScoutWeb.baseURL()
                .appending(path: "api/messages")
                .appending(queryItems: [
                    URLQueryItem(name: "cId", value: cId),
                    URLQueryItem(name: "conversationId", value: cId),
                    URLQueryItem(name: "limit", value: "260"),
                ])
            let next = try await fetch([ScoutMessage].self, from: url)
            guard selectedCId == cId else { return }
            messages = next.sorted { $0.createdAt < $1.createdAt }
            lastError = nil
        } catch {
            guard selectedCId == cId else { return }
            lastError = Self.userFacingError(error)
        }
    }

    private func fetchObserve(agentId: String) async {
        defer {
            isObserveLoading = false
            observeTask = nil
        }

        do {
            let url = ScoutWeb.baseURL().appending(path: "api/agents/\(agentId)/observe")
            let next = try await fetch(ScoutObservePayload.self, from: url)
            guard observeAgentId == agentId else { return }
            observePayload = next
            observeError = nil
            lastError = nil
        } catch {
            guard observeAgentId == agentId else { return }
            observeError = Self.userFacingError(error)
        }
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutCommsError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutCommsError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    private func fetchWithFallback<T: Decodable>(_ type: T.Type, primary: URL, fallback: URL) async throws -> T {
        do {
            return try await fetch(type, from: primary)
        } catch {
            return try await fetch(type, from: fallback)
        }
    }

    private static func userFacingError(_ error: Error) -> String {
        if let scoutError = error as? ScoutCommsError {
            return scoutError.localizedDescription
        }
        return error.localizedDescription
    }
}

enum ScoutCommsError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case sendFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status):
            return "Scout returned HTTP \(status)."
        case .sendFailed:
            return "Scout send failed."
        }
    }
}

enum ScoutWeb {
    private static let fallbackURL = URL(string: "http://127.0.0.1:3200")!

    static func baseURL() -> URL {
        if let url = readWebURLFromEnvironment() {
            return url
        }
        if let url = readWebURLFromConfig() {
            return url
        }
        return fallbackURL
    }

    static func open(path: String) {
        var normalized = path
        if !normalized.hasPrefix("/") {
            normalized = "/" + normalized
        }
        guard let url = URL(string: normalized, relativeTo: baseURL())?.absoluteURL else { return }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #endif
    }

    private static func readWebURLFromEnvironment() -> URL? {
        let env = ProcessInfo.processInfo.environment
        for key in ["OPENSCOUT_WEB_URL", "OPENSCOUT_WEB_BUN_URL", "OPENSCOUT_WEB_PUBLIC_ORIGIN"] {
            guard let value = env[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  let url = URL(string: value) else {
                continue
            }
            return url
        }

        let portValue = env["OPENSCOUT_WEB_PORT"] ?? env["SCOUT_WEB_PORT"]
        guard let portText = portValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              let port = Int(portText),
              (1...65_535).contains(port) else {
            return nil
        }
        let rawHost = env["OPENSCOUT_WEB_HOST"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let host = (rawHost?.isEmpty == false && rawHost != "0.0.0.0" && rawHost != "::")
            ? rawHost!
            : "127.0.0.1"
        return URL(string: "http://\(host):\(port)")
    }

    private static func readWebURLFromConfig() -> URL? {
        struct OpenScoutConfig: Decodable {
            struct Ports: Decodable { let web: Int? }
            let host: String?
            let ports: Ports?
        }
        let path = ("~/.openscout/config.json" as NSString).expandingTildeInPath
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        guard let cfg = try? JSONDecoder().decode(OpenScoutConfig.self, from: data) else { return nil }
        let host = cfg.host ?? "127.0.0.1"
        guard let port = cfg.ports?.web else { return nil }
        return URL(string: "http://\(host):\(port)")
    }
}
