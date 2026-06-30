import AVFoundation
import AppKit
import Foundation
import Speech

public enum ScoutVoicePermissionKind: String, Codable, Sendable {
    case microphone
    case speechRecognition
}

public struct ScoutVoicePermissionStatus: Codable, Equatable, Sendable {
    public let kind: ScoutVoicePermissionKind
    public let status: String
    public let granted: Bool
    public let canRequest: Bool

    public init(kind: ScoutVoicePermissionKind, status: String, granted: Bool, canRequest: Bool) {
        self.kind = kind
        self.status = status
        self.granted = granted
        self.canRequest = canRequest
    }

    public var isTerminal: Bool {
        status == "denied" || status == "restricted"
    }

    public var isUnavailable: Bool {
        status == "unavailable" || status == "unknown"
    }

    public var displayStatus: String {
        if granted { return "Granted" }
        switch status {
        case "notDetermined": return "Not requested"
        case "authorized": return "Granted"
        case "denied": return "Denied"
        case "restricted": return "Restricted"
        default: return status
        }
    }
}

public enum ScoutVoicePermissions {
    public static func microphoneStatus() -> ScoutVoicePermissionStatus {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        return ScoutVoicePermissionStatus(
            kind: .microphone,
            status: authorizationStatusLabel(status),
            granted: status == .authorized,
            canRequest: status == .notDetermined
        )
    }

    public static func speechRecognitionStatus() -> ScoutVoicePermissionStatus {
        let status = SFSpeechRecognizer.authorizationStatus()
        return ScoutVoicePermissionStatus(
            kind: .speechRecognition,
            status: speechAuthorizationStatusLabel(status),
            granted: status == .authorized,
            canRequest: status == .notDetermined
        )
    }

    private static func authorizationStatusLabel(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }

    private static func speechAuthorizationStatusLabel(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }

    public static func snapshot() -> [ScoutVoicePermissionStatus] {
        [microphoneStatus(), speechRecognitionStatus()]
    }

    public static func microphoneStatusMessage(for status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "Microphone access is granted."
        case .notDetermined:
            return "Microphone has not been requested yet. Click Request access or tap the mic in chat to show the macOS prompt."
        case .denied:
            return "Microphone access is off for Scout Menu. Open Privacy & Security → Microphone to change it."
        case .restricted:
            return "Microphone access is restricted on this Mac."
        @unknown default:
            return "Microphone access is unavailable."
        }
    }

    public static func speechRecognitionStatusMessage(for status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "Speech recognition access is granted."
        case .notDetermined:
            return "Speech recognition has not been requested yet. Click Request access to show the macOS prompt."
        case .denied:
            return "Speech recognition is off for Scout Menu. Open Privacy & Security → Speech Recognition to change it."
        case .restricted:
            return "Speech recognition is restricted on this Mac."
        @unknown default:
            return "Speech recognition is unavailable."
        }
    }

    public static func ensureMicrophoneAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    public static func ensureSpeechRecognitionAccess() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    public static func openMicrophonePrivacySettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    public static func openSpeechRecognitionPrivacySettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition") else {
            return
        }
        NSWorkspace.shared.open(url)
    }
}
