import AppKit
import Carbon
import Foundation

// Minimal Carbon hotkey wrapper, modeled on lattices'
// apps/mac/Sources/Core/Actions/HotkeyManager.swift but pared down
// to the single registerSingle path we actually need.

@MainActor private var hotkeyCallbacks: [UInt32: () -> Void] = [:]
@MainActor private var eventHandlerInstalled = false

@MainActor
public final class HotkeyManager {
    public static let shared = HotkeyManager()
    private var hotKeyRefs: [UInt32: EventHotKeyRef] = [:]
    private var fallbackMonitors: [UInt32: [Any]] = [:]

    private init() {}

    private func ensureEventHandler() {
        guard !eventHandlerInstalled else { return }
        eventHandlerInstalled = true

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_: EventHandlerCallRef?, event: EventRef?, _: UnsafeMutableRawPointer?) -> OSStatus in
                guard let event else { return OSStatus(eventNotHandledErr) }
                var hotkeyID = EventHotKeyID()
                GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotkeyID
                )
                // Carbon hotkey events are delivered on the main thread;
                // hop to MainActor to satisfy strict concurrency checking.
                let id = hotkeyID.id
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        hotkeyCallbacks[id]?()
                    }
                }
                return noErr
            },
            1,
            &eventType,
            nil,
            nil
        )
    }

    @discardableResult
    public func register(
        id: UInt32,
        keyCode: UInt32,
        modifiers: UInt32,
        callback: @escaping () -> Void
    ) -> Bool {
        ensureEventHandler()

        if let existing = hotKeyRefs[id] {
            UnregisterEventHotKey(existing)
            hotKeyRefs.removeValue(forKey: id)
        }
        removeFallbackMonitors(id: id)

        hotkeyCallbacks[id] = callback

        let hotKeyID = EventHotKeyID(
            signature: OSType(0x4F534354),  // "OSCT" — OpenScouT
            id: id
        )

        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &ref
        )
        if let ref, status == noErr {
            hotKeyRefs[id] = ref
            return true
        }

        // Carbon refuses a chord that another app has already claimed. A
        // listen-only AppKit monitor still observes the physical key event, so
        // keep Scout's user-configured chord useful without stealing input or
        // suppressing the other app's shortcut.
        let expectedKeyCode = UInt16(keyCode)
        let expectedModifiers = NSEvent.ModifierFlags(carbonModifiers: modifiers)
        let handler: (NSEvent) -> Void = { event in
            guard !event.isARepeat,
                  event.keyCode == expectedKeyCode,
                  event.modifierFlags.contains(expectedModifiers)
            else { return }
            callback()
        }
        var monitors: [Any] = []
        if let global = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: handler) {
            monitors.append(global)
        }
        if let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { event in
            handler(event)
            return event
        }) {
            monitors.append(local)
        }
        guard !monitors.isEmpty else { return false }
        fallbackMonitors[id] = monitors
        return true
    }

    public func unregister(id: UInt32) {
        if let ref = hotKeyRefs[id] {
            UnregisterEventHotKey(ref)
            hotKeyRefs.removeValue(forKey: id)
        }
        removeFallbackMonitors(id: id)
        hotkeyCallbacks.removeValue(forKey: id)
    }

    public func unregisterAll() {
        for (id, ref) in hotKeyRefs {
            UnregisterEventHotKey(ref)
            hotkeyCallbacks.removeValue(forKey: id)
            _ = id
        }
        hotKeyRefs.removeAll()
        for id in Array(fallbackMonitors.keys) {
            removeFallbackMonitors(id: id)
        }
    }

    private func removeFallbackMonitors(id: UInt32) {
        for monitor in fallbackMonitors.removeValue(forKey: id) ?? [] {
            NSEvent.removeMonitor(monitor)
        }
    }
}

private extension NSEvent.ModifierFlags {
    init(carbonModifiers: UInt32) {
        var flags: NSEvent.ModifierFlags = []
        if carbonModifiers & UInt32(controlKey) != 0 { flags.insert(.control) }
        if carbonModifiers & UInt32(optionKey) != 0 { flags.insert(.option) }
        if carbonModifiers & UInt32(shiftKey) != 0 { flags.insert(.shift) }
        if carbonModifiers & UInt32(cmdKey) != 0 { flags.insert(.command) }
        self = flags
    }
}

// Convenience: Hyper = ⌃⌥⇧⌘
public enum CarbonModifier {
    public static let hyper: UInt32 = UInt32(controlKey | optionKey | shiftKey | cmdKey)
}

// Common keyCodes we use here. Source: HIToolbox/Events.h.
public enum CarbonKeyCode {
    public static let a: UInt32 = 0
    public static let c: UInt32 = 8
    public static let h: UInt32 = 4
    public static let t: UInt32 = 17
}
