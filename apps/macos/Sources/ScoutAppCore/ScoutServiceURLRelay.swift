import Foundation

public enum ScoutServiceURLRelay {
    public static let notificationName = Notification.Name("com.openscout.services.url")
    public static let openScoutNetworkAuthSavedNotificationName = Notification.Name("com.openscout.osn.auth-saved")

    public static func userInfo(url: URL) -> [AnyHashable: Any] {
        ["url": url.absoluteString]
    }
}
