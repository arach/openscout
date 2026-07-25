import Foundation

/// Scout's own voice preference: which model and voice spoken replies use.
///
/// Only the operator's choice lives here. The list of what's available comes
/// from the speech engine at runtime, so the pickers can never offer something
/// the engine can't synthesize.
public enum ScoutSpeechSettings {
    public static let modelKey = "scout.voice.ttsModel"
    public static let voiceKey = "scout.voice.ttsVoice"

    public static let defaultModel = "gpt-4o-mini-tts"
    public static let defaultVoice = "alloy"

    public static func model(_ defaults: UserDefaults = .standard) -> String {
        let stored = defaults.string(forKey: modelKey)?.trimmingCharacters(in: .whitespaces)
        guard let stored, !stored.isEmpty else { return defaultModel }
        return stored
    }

    public static func voice(_ defaults: UserDefaults = .standard) -> String {
        let stored = defaults.string(forKey: voiceKey)?.trimmingCharacters(in: .whitespaces)
        guard let stored, !stored.isEmpty else { return defaultVoice }
        return stored
    }
}

/// The operator's one-time opt-in for billable realtime conversation.
///
/// Settings owns this capability gate. The main window status bar owns the
/// per-call start/stop control, so enabling the capability never starts audio.
public enum ScoutRealtimeVoiceSettings {
    public static let enabledKey = "scout.voice.liveVoiceEnabled"
}

/// Cross-process status signal shared by the main app and its menu-bar helper.
/// The WebRTC call remains owned by Scout; ScoutMenu only mirrors enough state
/// to make an active/minimized conversation visible in the menu-bar glyph.
public enum ScoutRealtimeVoiceStatusBridge {
    public enum State: String, Sendable {
        case idle
        case connecting
        case live
        case stopping
        case error
    }

    public static let notificationName = Notification.Name(
        "app.openscout.realtimeVoiceStateDidChange"
    )
    public static let stateUserInfoKey = "state"

    public static func post(_ state: State) {
        DistributedNotificationCenter.default().postNotificationName(
            notificationName,
            object: nil,
            userInfo: [stateUserInfoKey: state.rawValue],
            deliverImmediately: true
        )
    }

    public static func state(from notification: Notification) -> State? {
        guard let raw = notification.userInfo?[stateUserInfoKey] as? String else {
            return nil
        }
        return State(rawValue: raw)
    }
}
