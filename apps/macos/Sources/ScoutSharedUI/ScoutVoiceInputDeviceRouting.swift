import AVFoundation
import CoreAudio
import Foundation

/// Applies the Scout-selected input device before HudDictation capture on macOS.
public enum ScoutVoiceInputDeviceRouting {
    public static func applyPreferredInput(deviceId: String?) {
        #if os(macOS)
        guard let deviceId, !deviceId.isEmpty else { return }
        guard let audioDeviceId = findAudioDeviceId(matching: deviceId) else { return }
        setDefaultInputDevice(audioDeviceId)
        #endif
    }

    #if os(macOS)
    private static func setDefaultInputDevice(_ deviceId: AudioDeviceID) {
        var id = deviceId
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            UInt32(MemoryLayout<AudioDeviceID>.size),
            &id
        )
    }

    private static func findAudioDeviceId(matching scoutDeviceId: String) -> AudioDeviceID? {
        if let byUID = audioDeviceId(forUID: scoutDeviceId) {
            return byUID
        }

        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        guard let captureDevice = discovery.devices.first(where: { $0.uniqueID == scoutDeviceId }) else {
            return nil
        }
        return audioDeviceId(matchingName: captureDevice.localizedName)
    }

    private static func audioDeviceId(forUID uid: String) -> AudioDeviceID? {
        let devices = allInputDeviceIds()
        for deviceId in devices {
            guard let deviceUID = deviceUID(for: deviceId), deviceUID == uid else { continue }
            return deviceId
        }
        return nil
    }

    private static func audioDeviceId(matchingName name: String) -> AudioDeviceID? {
        let devices = allInputDeviceIds()
        for deviceId in devices {
            guard let deviceName = deviceName(for: deviceId), deviceName == name else { continue }
            return deviceId
        }
        return nil
    }

    private static func allInputDeviceIds() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize
        ) == noErr else {
            return []
        }

        let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIds = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            &deviceIds
        ) == noErr else {
            return []
        }

        return deviceIds.filter(hasInputStreams)
    }

    private static func hasInputStreams(_ deviceId: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(deviceId, &address, 0, nil, &dataSize) == noErr else {
            return false
        }
        let bufferListPointer = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: Int(dataSize))
        defer { bufferListPointer.deallocate() }
        guard AudioObjectGetPropertyData(deviceId, &address, 0, nil, &dataSize, bufferListPointer) == noErr else {
            return false
        }
        let buffers = UnsafeMutableAudioBufferListPointer(bufferListPointer)
        return buffers.contains { $0.mNumberChannels > 0 }
    }

    private static func deviceUID(for deviceId: AudioDeviceID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString = "" as CFString
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        guard AudioObjectGetPropertyData(deviceId, &address, 0, nil, &dataSize, &uid) == noErr else {
            return nil
        }
        return uid as String
    }

    private static func deviceName(for deviceId: AudioDeviceID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString = "" as CFString
        var dataSize = UInt32(MemoryLayout<CFString>.size)
        guard AudioObjectGetPropertyData(deviceId, &address, 0, nil, &dataSize, &name) == noErr else {
            return nil
        }
        return name as String
    }
    #endif
}