import Foundation
import Observation
import UIKit
import UserNotifications

@MainActor
@Observable
final class InboxStore {
    private(set) var items: [MobileInboxItem] = []
    private(set) var unreadItemIds: Set<String> = []

    var unreadCount: Int {
        unreadItemIds.count
    }

    var pendingCount: Int {
        items.count
    }

    func refresh(using connection: ConnectionManager) async {
        guard connection.state == .connected else { return }

        do {
            let response = try await connection.getInbox()
            apply(
                items: response.items,
                replaceExisting: true,
                markNewAsUnread: true,
                presentNotifications: false
            )
        } catch {
            // The inbox is secondary UI. Keep the last known state if refresh fails.
        }
    }

    func receiveOperatorNotification(_ event: OperatorNotificationEvent) {
        apply(
            items: [event.item],
            replaceExisting: false,
            markNewAsUnread: true,
            presentNotifications: true
        )
    }

    func markInboxOpened() {
        guard !unreadItemIds.isEmpty else { return }
        unreadItemIds.removeAll()
        syncAppBadge()
    }

    func removeItem(id: String) {
        items.removeAll { $0.id == id }
        unreadItemIds.remove(id)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
        syncAppBadge()
    }

    func clear() {
        let ids = items.map(\.id)
        items = []
        unreadItemIds.removeAll()
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
        syncAppBadge()
    }

    private func apply(
        items incoming: [MobileInboxItem],
        replaceExisting: Bool,
        markNewAsUnread: Bool,
        presentNotifications: Bool
    ) {
        var mergedById = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        let existingIds = Set(mergedById.keys)

        for item in incoming {
            mergedById[item.id] = item
            if markNewAsUnread && !existingIds.contains(item.id) {
                unreadItemIds.insert(item.id)
                if presentNotifications {
                    scheduleNotification(for: item)
                }
            }
        }

        if replaceExisting {
            let incomingIds = Set(incoming.map(\.id))
            let idsToRemove = existingIds.subtracting(incomingIds)
            for id in idsToRemove {
                mergedById.removeValue(forKey: id)
                unreadItemIds.remove(id)
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
            }
        }

        items = mergedById.values.sorted {
            $0.createdAt > $1.createdAt || ($0.createdAt == $1.createdAt && $0.id < $1.id)
        }
        unreadItemIds = Set(unreadItemIds.filter { mergedById[$0] != nil })
        syncAppBadge()
    }

    private func scheduleNotification(for item: MobileInboxItem) {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.subtitle = item.sessionName
        content.body = item.description
        content.sound = .default
        content.badge = NSNumber(value: unreadCount)
        content.threadIdentifier = "scout.inbox"
        content.userInfo = [
            "destination": "inbox",
            "itemId": item.id,
        ]

        let request = UNNotificationRequest(identifier: item.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func syncAppBadge() {
        if #available(iOS 17.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(unreadCount)
        } else {
            UIApplication.shared.applicationIconBadgeNumber = unreadCount
        }
    }
}

extension InboxStore {
    static func screenshotPreview() -> InboxStore {
        let store = InboxStore()
        let now = Int(Date().timeIntervalSince1970)
        store.items = [
            MobileInboxItem(
                id: "approval-1",
                kind: .approval,
                createdAt: now - 120,
                sessionId: "s1",
                sessionName: "Refactor auth",
                adapterType: "claude-code",
                turnId: "t1",
                blockId: "b3",
                version: 1,
                risk: .medium,
                title: "Approval needed",
                description: "Confirm the proposed auth refactor before the agent writes files.",
                detail: "Update src/auth/jwt.ts and src/auth/session.ts",
                actionKind: .fileChange,
                actionStatus: .awaitingApproval
            )
        ]
        store.unreadItemIds = Set(store.items.map(\.id))
        return store
    }
}
