import AVFoundation
import Foundation
import HudsonVoice

public struct ScoutVoiceInputDevice: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isDefault: Bool

    public init(id: String, name: String, isDefault: Bool) {
        self.id = id
        self.name = name
        self.isDefault = isDefault
    }
}

public struct ScoutVoiceSettingsSnapshot: Codable, Equatable, Sendable {
    public var preference: String
    public var inputDeviceId: String?
    public var inputDeviceName: String?
    public var modelReady: Bool
    public var modelInstalled: Bool
    public var permissions: [ScoutVoicePermissionStatus]

    public init(
        preference: String,
        inputDeviceId: String?,
        inputDeviceName: String?,
        modelReady: Bool,
        modelInstalled: Bool,
        permissions: [ScoutVoicePermissionStatus] = ScoutVoicePermissions.snapshot()
    ) {
        self.preference = preference
        self.inputDeviceId = inputDeviceId
        self.inputDeviceName = inputDeviceName
        self.modelReady = modelReady
        self.modelInstalled = modelInstalled
        self.permissions = permissions
    }
}

public enum ScoutVoiceSettingsStore {
    private static let preferenceKey = "scout.voicePreference"
    private static let inputDeviceKey = "scout.voiceInputDeviceId"

    public static func loadPreference() -> HudDictation.Preference {
        guard let raw = UserDefaults.standard.string(forKey: preferenceKey),
              let pref = HudDictation.Preference(rawValue: raw) else {
            return .auto
        }
        return pref
    }

    public static func savePreference(_ preference: HudDictation.Preference) {
        UserDefaults.standard.set(preference.rawValue, forKey: preferenceKey)
    }

    public static func loadInputDeviceId() -> String? {
        UserDefaults.standard.string(forKey: inputDeviceKey)
    }

    public static func saveInputDeviceId(_ deviceId: String?) {
        if let deviceId, !deviceId.isEmpty {
            UserDefaults.standard.set(deviceId, forKey: inputDeviceKey)
        } else {
            UserDefaults.standard.removeObject(forKey: inputDeviceKey)
        }
    }

    public static func listInputDevices() -> [ScoutVoiceInputDevice] {
        #if os(macOS)
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        let devices = discovery.devices
        let defaultId = AVCaptureDevice.default(for: .audio)?.uniqueID
        return devices.map { device in
            ScoutVoiceInputDevice(
                id: device.uniqueID,
                name: device.localizedName,
                isDefault: device.uniqueID == defaultId
            )
        }
        #else
        return []
        #endif
    }

    public static func snapshot(
        preference: HudDictation.Preference,
        modelReady: Bool,
        modelInstalled: Bool
    ) -> ScoutVoiceSettingsSnapshot {
        let devices = listInputDevices()
        let selectedId = loadInputDeviceId()
        let selectedName = devices.first(where: { $0.id == selectedId })?.name
        return ScoutVoiceSettingsSnapshot(
            preference: preference.rawValue,
            inputDeviceId: selectedId,
            inputDeviceName: selectedName,
            modelReady: modelReady,
            modelInstalled: modelInstalled,
            permissions: ScoutVoicePermissions.snapshot()
        )
    }
}