import AppKit
import Combine
import Foundation
import os
import ScoutAppCore
import UserNotifications

/// Owns the "an agent needs you" attention layer: a private agents poll feeds a
/// clock-injected `ScoutAttentionTracker`, whose decisions drive the Dock badge
/// and system notifications. Notifications are lazily authorized (never at
/// launch) and gracefully degrade to badge-only when the process has no bundle
/// identifier (bare `swift run`).
@MainActor
final class ScoutAttentionCenter: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = ScoutAttentionCenter()

    @Published var notificationsEnabled: Bool {
        didSet {
            defaults.set(notificationsEnabled, forKey: Keys.notificationsEnabled)
            if notificationsEnabled, !oldValue {
                Task { @MainActor in _ = await self.ensureAuthorized() }
            }
        }
    }

    @Published var soundEnabled: Bool {
        didSet {
            defaults.set(soundEnabled, forKey: Keys.soundEnabled)
            let sound = soundEnabled
            presentation.withLock { $0.soundEnabled = sound }
        }
    }

    @Published var dockBadgeEnabled: Bool {
        didSet {
            defaults.set(dockBadgeEnabled, forKey: Keys.dockBadgeEnabled)
            applyBadge(count: lastAttentionCount)
        }
    }

    @Published private(set) var authorizationDenied: Bool = false

    private let defaults = UserDefaults.standard
    private let log = ScoutLog.logger(category: "attention")

    private enum Keys {
        static let notificationsEnabled = "scout.attention.notificationsEnabled"
        static let soundEnabled = "scout.attention.soundEnabled"
        static let dockBadgeEnabled = "scout.attention.dockBadgeEnabled"
    }

    private let notificationsAvailable = Bundle.main.bundleIdentifier != nil
    private var tracker = ScoutAttentionTracker()
    private var store: ScoutAgentsStore?
    private var cancellables: Set<AnyCancellable> = []
    private var started = false
    private var openConversation: ((String?) -> Void)?

    private var lastAttentionCount = 0
    private var appliedBadgeLabel: String?

    private var currentSelectionCId: String?
    private var isCommsVisible = false

    /// A `Sendable` mirror of the state the notification-center delegate needs so
    /// it can answer completion handlers on its own thread without hopping to the
    /// main actor (which strict concurrency forbids for a captured handler).
    private struct PresentationState: Sendable {
        var selectionCId: String?
        var isCommsVisible: Bool
        var soundEnabled: Bool
    }

    private let presentation = OSAllocatedUnfairLock(
        initialState: PresentationState(selectionCId: nil, isCommsVisible: false, soundEnabled: false)
    )

    private override init() {
        notificationsEnabled = defaults.object(forKey: Keys.notificationsEnabled) as? Bool ?? true
        soundEnabled = defaults.object(forKey: Keys.soundEnabled) as? Bool ?? false
        dockBadgeEnabled = defaults.object(forKey: Keys.dockBadgeEnabled) as? Bool ?? true
        super.init()
        let sound = soundEnabled
        presentation.withLock { $0.soundEnabled = sound }
    }

    func start(openConversation: @escaping (String?) -> Void) {
        guard !started else { return }
        started = true
        self.openConversation = openConversation

        if notificationsAvailable {
            UNUserNotificationCenter.current().delegate = self
        } else {
            log.info("attention: notifications unavailable (no bundle identifier) — running badge + tracker only")
        }

        let store = ScoutAgentsStore(pollInterval: 2.5)
        self.store = store
        store.$agents
            .compactMap { $0 }
            .sink { [weak self] agents in
                guard let self else { return }
                self.receive(agents)
            }
            .store(in: &cancellables)
        store.start()
    }

    func noteSelection(cId: String?, isCommsVisible: Bool) {
        currentSelectionCId = cId
        self.isCommsVisible = isCommsVisible
        presentation.withLock {
            $0.selectionCId = cId
            $0.isCommsVisible = isCommsVisible
        }
        if let cId, !cId.isEmpty {
            removeDelivered(matchingCId: cId)
        }
    }

    private func receive(_ agents: [ScoutAgent]) {
        let update = tracker.ingest(agents: agents, at: Date())
        lastAttentionCount = update.attentionCount
        applyBadge(count: update.attentionCount)
        retract(update.resolvedAgentIds)
        // A coalesced summary can't be partially retracted; clear it once the
        // last announced agent resolves so Notification Center doesn't hold a
        // stale name list.
        if update.attentionCount == 0, !update.resolvedAgentIds.isEmpty {
            retract(["summary"])
        }

        guard notificationsEnabled else { return }
        let candidates = update.notify.filter { !isSuppressed($0) }
        guard !candidates.isEmpty else { return }
        announce(candidates)
    }

    private func applyBadge(count: Int) {
        let label = (dockBadgeEnabled && count > 0) ? String(count) : nil
        guard label != appliedBadgeLabel else { return }
        appliedBadgeLabel = label
        NSApp.dockTile.badgeLabel = label
    }

    private func isSuppressed(_ agent: ScoutAgent) -> Bool {
        guard NSApp.isActive, isCommsVisible else { return false }
        guard let cId = agent.conversationId, !cId.isEmpty else { return false }
        return cId == currentSelectionCId
    }

    private func announce(_ agents: [ScoutAgent]) {
        guard notificationsAvailable else {
            log.info("attention: \(agents.count) agent(s) need you — notifications unavailable, badge only")
            return
        }
        Task { @MainActor in
            guard await self.ensureAuthorized() else { return }
            self.deliver(agents)
        }
    }

    private func deliver(_ agents: [ScoutAgent]) {
        guard notificationsAvailable else { return }
        let center = UNUserNotificationCenter.current()

        if agents.count == 1, let agent = agents.first {
            let content = UNMutableNotificationContent()
            content.title = "\(agent.displayName) needs you"
            var body = agent.pendingAsk?.nilIfEmpty ?? "Waiting for your input"
            if let project = agent.project?.nilIfEmpty {
                body += " · \(project)"
            }
            content.body = body
            content.threadIdentifier = "scout.attention"
            content.userInfo = ["cId": agent.conversationId ?? "", "agentId": agent.id]
            content.sound = soundEnabled ? .default : nil
            center.add(UNNotificationRequest(identifier: "attention.\(agent.id)", content: content, trigger: nil))
        } else {
            let content = UNMutableNotificationContent()
            content.title = "\(agents.count) agents need you"
            content.body = agents.map(\.displayName).joined(separator: ", ")
            content.threadIdentifier = "scout.attention"
            content.userInfo = ["cId": ""]
            content.sound = soundEnabled ? .default : nil
            center.add(UNNotificationRequest(identifier: "attention.summary", content: content, trigger: nil))
        }
    }

    private func retract(_ agentIds: [String]) {
        guard notificationsAvailable, !agentIds.isEmpty else { return }
        let ids = agentIds.map { "attention.\($0)" }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
    }

    private func removeDelivered(matchingCId cId: String) {
        guard notificationsAvailable else { return }
        UNUserNotificationCenter.current().getDeliveredNotifications { notes in
            let ids = notes
                .filter { ($0.request.content.userInfo["cId"] as? String) == cId }
                .map(\.request.identifier)
            guard !ids.isEmpty else { return }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    @discardableResult
    private func ensureAuthorized() async -> Bool {
        guard notificationsAvailable else { return false }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            authorizationDenied = !granted
            return granted
        case .denied:
            authorizationDenied = true
            return false
        default:
            authorizationDenied = false
            return true
        }
    }

    private nonisolated func presentationOptions(forCId cId: String?, state: PresentationState) -> UNNotificationPresentationOptions {
        if let cId, !cId.isEmpty, cId == state.selectionCId, state.isCommsVisible {
            return []
        }
        var options: UNNotificationPresentationOptions = [.banner, .list]
        if state.soundEnabled { options.insert(.sound) }
        return options
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let cId = notification.request.content.userInfo["cId"] as? String
        let state = presentation.withLock { $0 }
        completionHandler(presentationOptions(forCId: cId, state: state))
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let cId = response.notification.request.content.userInfo["cId"] as? String
        completionHandler()
        Task { @MainActor in self.openConversation?(cId) }
    }
}
