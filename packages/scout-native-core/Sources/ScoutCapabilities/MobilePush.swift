import Foundation

public enum MobilePushAuthorizationStatus: String, Codable, Sendable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral

    public var allowsRemoteNotifications: Bool {
        switch self {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined, .denied:
            return false
        }
    }
}

public enum MobilePushEnvironment: String, Codable, Sendable {
    case development
    case production
}

public struct MobilePushRegistration: Codable, Sendable, Equatable {
    public var pushToken: String?
    public var authorizationStatus: MobilePushAuthorizationStatus
    public var appBundleId: String
    public var apnsEnvironment: MobilePushEnvironment
    public var appVersion: String?
    public var buildNumber: String?
    public var deviceModel: String?
    public var systemVersion: String?

    public init(
        pushToken: String?,
        authorizationStatus: MobilePushAuthorizationStatus,
        appBundleId: String,
        apnsEnvironment: MobilePushEnvironment,
        appVersion: String? = nil,
        buildNumber: String? = nil,
        deviceModel: String? = nil,
        systemVersion: String? = nil
    ) {
        self.pushToken = pushToken
        self.authorizationStatus = authorizationStatus
        self.appBundleId = appBundleId
        self.apnsEnvironment = apnsEnvironment
        self.appVersion = appVersion
        self.buildNumber = buildNumber
        self.deviceModel = deviceModel
        self.systemVersion = systemVersion
    }
}

public struct MobilePushRegistrationResult: Codable, Sendable, Equatable {
    public var ok: Bool
    public var registered: Bool
    public var removed: Bool
    public var token: String?
    public var relayConfigured: Bool?

    public init(
        ok: Bool,
        registered: Bool,
        removed: Bool,
        token: String?,
        relayConfigured: Bool? = nil
    ) {
        self.ok = ok
        self.registered = registered
        self.removed = removed
        self.token = token
        self.relayConfigured = relayConfigured
    }
}

public protocol MobilePushRegistrationCapability: Sendable {
    func syncMobilePushRegistration(
        _ registration: MobilePushRegistration
    ) async throws -> MobilePushRegistrationResult
}
