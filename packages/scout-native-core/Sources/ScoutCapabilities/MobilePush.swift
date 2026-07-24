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

/// Full notification context fetched from the paired Mac after an opaque APNs
/// alert is opened. Human-readable prompt, command, failure, and path content
/// deliberately lives here rather than in the push payload.
public struct MobileNotificationItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var createdAt: Int64
    public var sessionId: String
    public var sessionName: String
    public var adapterType: String
    public var turnId: String?
    public var blockId: String?
    public var version: Int?
    public var risk: String
    public var title: String
    public var description: String
    public var detail: String?
    public var actionKind: String?
    public var actionStatus: String?

    public init(
        id: String,
        kind: String,
        createdAt: Int64,
        sessionId: String,
        sessionName: String,
        adapterType: String,
        turnId: String? = nil,
        blockId: String? = nil,
        version: Int? = nil,
        risk: String,
        title: String,
        description: String,
        detail: String? = nil,
        actionKind: String? = nil,
        actionStatus: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.createdAt = createdAt
        self.sessionId = sessionId
        self.sessionName = sessionName
        self.adapterType = adapterType
        self.turnId = turnId
        self.blockId = blockId
        self.version = version
        self.risk = risk
        self.title = title
        self.description = description
        self.detail = detail
        self.actionKind = actionKind
        self.actionStatus = actionStatus
    }
}

public protocol MobileNotificationCapability: Sendable {
    func mobileNotifications() async throws -> [MobileNotificationItem]
}
