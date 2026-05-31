import Combine
import Foundation

enum CommsFilter: String, CaseIterable, Identifiable {
    case all
    case `private`
    case shared

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .private: return "Private"
        case .shared: return "Shared"
        }
    }
}

enum CommsScope {
    case `private`
    case shared
}

struct CommsItem: Identifiable, Decodable, Sendable {
    let cId: String
    let kind: String
    let title: String
    let alias: String?
    let participantIds: [String]
    let agentId: String?
    let agentName: String?
    let harness: String?
    let preview: String?
    let messageCount: Int
    let lastMessageAt: TimeInterval?
    let workspaceRoot: String?
    let currentBranch: String?

    var id: String { cId }

    var displayTitle: String {
        if let alias, !alias.isEmpty { return alias }
        if let agentName, !agentName.isEmpty { return agentName }
        return title
    }

    var scope: CommsScope {
        if kind == "direct", participantIds.count <= 2 {
            return .private
        }
        return .shared
    }

    var scopeLabel: String {
        switch scope {
        case .private: return "Private"
        case .shared: return "Shared"
        }
    }

    var cIdShort: String {
        if cId.hasPrefix("c.") {
            let rest = String(cId.dropFirst("c.".count))
            return "cId \(String(rest.prefix(8)))"
        }
        if cId.hasPrefix("dm.") {
            return "cId legacy-dm"
        }
        if cId.hasPrefix("channel.") {
            return "cId #\(String(cId.dropFirst("channel.".count)))"
        }
        return cId.count > 16 ? "cId \(String(cId.prefix(12)))" : "cId \(cId)"
    }

    enum CodingKeys: String, CodingKey {
        case cId
        case fallbackId = "id"
        case kind
        case title
        case alias
        case participantIds
        case agentId
        case agentName
        case harness
        case preview
        case messageCount
        case lastMessageAt
        case workspaceRoot
        case currentBranch
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cId = try c.decodeIfPresent(String.self, forKey: .cId)
            ?? c.decode(String.self, forKey: .fallbackId)
        kind = try c.decode(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        alias = try c.decodeIfPresent(String.self, forKey: .alias)
        participantIds = try c.decodeIfPresent([String].self, forKey: .participantIds) ?? []
        agentId = try c.decodeIfPresent(String.self, forKey: .agentId)
        agentName = try c.decodeIfPresent(String.self, forKey: .agentName)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        preview = try c.decodeIfPresent(String.self, forKey: .preview)
        messageCount = try c.decodeIfPresent(Int.self, forKey: .messageCount) ?? 0
        lastMessageAt = try c.decodeIfPresent(TimeInterval.self, forKey: .lastMessageAt)
        workspaceRoot = try c.decodeIfPresent(String.self, forKey: .workspaceRoot)
        currentBranch = try c.decodeIfPresent(String.self, forKey: .currentBranch)
    }
}

struct CommsMessage: Identifiable, Decodable, Sendable {
    let id: String
    let cId: String
    let actorId: String?
    let actorName: String
    let body: String
    let createdAt: TimeInterval
    let messageClass: String

    var isOperator: Bool {
        actorId == "operator" || messageClass == "operator" || actorName.lowercased() == "operator"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case cId
        case fallbackCId = "conversationId"
        case actorId
        case actorName
        case body
        case createdAt
        case messageClass = "class"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        cId = try c.decodeIfPresent(String.self, forKey: .cId)
            ?? c.decode(String.self, forKey: .fallbackCId)
        actorId = try c.decodeIfPresent(String.self, forKey: .actorId)
        actorName = try c.decodeIfPresent(String.self, forKey: .actorName)
            ?? actorId
            ?? "unknown"
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(TimeInterval.self, forKey: .createdAt)
        messageClass = try c.decodeIfPresent(String.self, forKey: .messageClass) ?? "message"
    }
}

@MainActor
final class CommsService: ObservableObject {
    static let shared = CommsService()

    @Published private(set) var items: [CommsItem] = []
    @Published private(set) var messages: [CommsMessage] = []
    @Published private(set) var selectedCId: String?
    @Published var filter: CommsFilter = .all
    @Published private(set) var isLoading = false
    @Published private(set) var isSending = false
    @Published private(set) var lastError: String?

    private let decoder = JSONDecoder()
    private var pollTask: Task<Void, Never>?
    private var itemsTask: Task<Void, Never>?
    private var messagesTask: Task<Void, Never>?

    private init() {}

    var selectedItem: CommsItem? {
        guard let selectedCId else { return nil }
        return items.first { $0.cId == selectedCId }
    }

    var filteredItems: [CommsItem] {
        items.filter { item in
            switch filter {
            case .all: return true
            case .private: return item.scope == .private
            case .shared: return item.scope == .shared
            }
        }
    }

    func start(preferredCId: String? = nil) {
        if let preferredCId {
            selectedCId = preferredCId
        }
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
        itemsTask?.cancel()
        messagesTask?.cancel()
        itemsTask = nil
        messagesTask = nil
    }

    func refresh(force: Bool = false) {
        if itemsTask != nil { return }
        if !force, pollTask == nil { return }
        isLoading = items.isEmpty
        itemsTask = Task { [weak self] in
            await self?.loadItems()
        }
    }

    func select(_ cId: String) {
        guard selectedCId != cId else { return }
        selectedCId = cId
        messages = []
        loadMessages()
    }

    func loadMessages() {
        guard let selectedCId else { return }
        messagesTask?.cancel()
        messagesTask = Task { [weak self] in
            await self?.loadMessages(cId: selectedCId)
        }
    }

    func send(_ body: String) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let selectedCId, !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            let url = HudFleetService.webBaseURL().appending(path: "api/send")
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
                throw CommsServiceError.sendFailed
            }
            lastError = nil
            refresh(force: true)
            loadMessages()
        } catch {
            lastError = Self.userFacingError(error)
        }
    }

    private func loadItems() async {
        defer {
            isLoading = false
            itemsTask = nil
        }
        do {
            let base = HudFleetService.webBaseURL()
            let commsURL = base
                .appending(path: "api/comms")
                .appending(queryItems: [URLQueryItem(name: "limit", value: "120")])
            let fallbackURL = base
                .appending(path: "api/conversations")
                .appending(queryItems: [URLQueryItem(name: "limit", value: "120")])
            let next = try await fetchWithFallback([CommsItem].self, primary: commsURL, fallback: fallbackURL)
            items = next
            if selectedCId == nil || !next.contains(where: { $0.cId == selectedCId }) {
                selectedCId = next.first?.cId
            }
            lastError = nil
            loadMessages()
        } catch {
            lastError = Self.userFacingError(error)
        }
    }

    private func loadMessages(cId: String) async {
        defer {
            messagesTask = nil
        }
        do {
            let url = HudFleetService.webBaseURL()
                .appending(path: "api/messages")
                .appending(queryItems: [
                    URLQueryItem(name: "cId", value: cId),
                    URLQueryItem(name: "conversationId", value: cId),
                    URLQueryItem(name: "limit", value: "220"),
                ])
            let next = try await fetch([CommsMessage].self, from: url)
            guard selectedCId == cId else { return }
            messages = next.sorted { $0.createdAt < $1.createdAt }
            lastError = nil
        } catch {
            guard selectedCId == cId else { return }
            lastError = Self.userFacingError(error)
        }
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw CommsServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw CommsServiceError.httpStatus(http.statusCode)
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
        if let commsError = error as? CommsServiceError {
            return commsError.localizedDescription
        }
        return error.localizedDescription
    }
}

enum CommsServiceError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case sendFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Comms returned an invalid response."
        case .httpStatus(let status):
            return "Comms returned HTTP \(status)."
        case .sendFailed:
            return "Comms send failed."
        }
    }
}
