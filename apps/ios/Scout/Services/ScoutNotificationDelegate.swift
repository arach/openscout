import Foundation
import UserNotifications

final class ScoutNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        NotificationCenter.default.post(
            name: .scoutOpenInbox,
            object: nil,
            userInfo: response.notification.request.content.userInfo
        )
    }
}

extension Notification.Name {
    static let scoutOpenInbox = Notification.Name("scoutOpenInbox")
}
