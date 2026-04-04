import AVFoundation
import Speech

enum PermissionAuthorizations {
    static func microphoneGranted() -> Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    static func speechGranted() -> Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    static func requestMicrophone() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    static func requestSpeechRecognition() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }
}
