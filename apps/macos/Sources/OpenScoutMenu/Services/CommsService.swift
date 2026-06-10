import Combine
import Foundation
import ScoutAppCore

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

typealias CommsItem = ScoutChannel
typealias CommsMessage = ScoutMessage

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
            case .private: return item.scope == .direct
            case .shared: return item.scope == .shared
            }
        }
    }

    func start(preferredCId: String? = nil) {
        if let preferredCId {
            setIfChanged(preferredCId, to: \.selectedCId)
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
        setIfChanged(false, to: \.isLoading)
    }

    func refresh(force: Bool = false) {
        if itemsTask != nil { return }
        if !force, pollTask == nil { return }
        setIfChanged(items.isEmpty, to: \.isLoading)
        itemsTask = Task { [weak self] in
            await self?.loadItems()
        }
    }

    func select(_ cId: String) {
        guard selectedCId != cId else { return }
        setIfChanged(cId, to: \.selectedCId)
        setIfChanged([], to: \.messages)
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
        setIfChanged(true, to: \.isSending)
        defer { setIfChanged(false, to: \.isSending) }
        do {
            try await ScoutCommsClient().send(body: trimmed, cId: selectedCId)
            setIfChanged(nil, to: \.lastError)
            refresh(force: true)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func loadItems() async {
        defer {
            setIfChanged(false, to: \.isLoading)
            itemsTask = nil
        }
        do {
            let next = try await ScoutCommsClient().fetchChannels(limit: 120)
            setIfChanged(next, to: \.items)
            if selectedCId == nil || !next.contains(where: { $0.cId == selectedCId }) {
                setIfChanged(next.first?.cId, to: \.selectedCId)
            }
            setIfChanged(nil, to: \.lastError)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func loadMessages(cId: String) async {
        defer {
            messagesTask = nil
        }
        do {
            let next = try await ScoutCommsClient().fetchMessages(cId: cId, limit: 220)
            guard selectedCId == cId else { return }
            setIfChanged(next, to: \.messages)
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard selectedCId == cId else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private static func userFacingError(_ error: Error) -> String {
        return ScoutAppError.userFacing(error)
    }

    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<CommsService, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

}
