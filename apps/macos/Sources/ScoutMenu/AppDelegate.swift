import AppKit
import Combine
import HudsonObservability
import ScoutAppCore
import ScoutHUD
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private let controller = OpenScoutAppController.shared
    private let captureHotZone = HUDCaptureHotZoneMonitor.shared
    private var statusItem: NSStatusItem!
    private var popover: NSPopover?
    private var contextMenu: NSMenu!
    private var taskHotkeyRegistered = false
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        HudLoggerSinks.install(HudLogStore.shared)
        HudLogger(category: "menu").info("Scout menu helper booted", metadata: ["state": "ready"])
        NSApp.setActivationPolicy(.accessory)

        // scout:// URL scheme ingress. Service restart links stay here;
        // HUD links are forwarded to Scout, which owns the panel.
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleScoutURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleServiceURLNotification(_:)),
            name: ScoutServiceURLRelay.notificationName,
            object: nil
        )
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleOpenScoutNetworkAuthSaved(_:)),
            name: ScoutServiceURLRelay.openScoutNetworkAuthSavedNotificationName,
            object: nil
        )

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            configureStatusButton(button, symbolName: controller.menuBarSymbolName, tooltip: controller.menuBarTooltip)
            button.toolTip = controller.menuBarTooltip
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        // Surface incoming pairing requests as a floating Allow/Deny popup the
        // moment they arrive — reliable and proactive, no popover or
        // notification-permission dance.
        PairingApprovalWindowController.shared.start()

        HotkeyManager.shared.register(
            id: 2,
            keyCode: CarbonKeyCode.c,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                ScoutAppBridge.openScout()
            }
        }

        HotkeyManager.shared.register(
            id: 3,
            keyCode: CarbonKeyCode.t,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                ScoutAppBridge.openHUD(command: "tail-toggle")
            }
        }

        taskHotkeyRegistered = HotkeyManager.shared.register(
            id: 4,
            keyCode: CarbonKeyCode.a,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                ScoutAppBridge.openHUD(command: "task")
            }
        }
        if !taskHotkeyRegistered {
            NSLog("[capture] Hyper+A is already registered by another application")
        }
        contextMenu = buildContextMenu()

        captureHotZone.start { anchor in
            ScoutAppBridge.openHUD(command: "task", value: anchor.argument)
        } onDrop: { [weak self] anchor, drop in
            self?.forwardCaptureDrop(anchor: anchor, drop: drop) ?? false
        } onPromiseError: { [weak self] _, message in
            self?.surfaceCaptureError(message)
        }

        controller.$menuBarSymbolName
            .combineLatest(controller.$menuBarTooltip)
            .sink { [weak self] symbolName, tooltip in
                guard let button = self?.statusItem.button else {
                    return
                }

                self?.configureStatusButton(button, symbolName: symbolName, tooltip: tooltip)
            }
            .store(in: &cancellables)

        controller.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        captureHotZone.stop()
        HotkeyManager.shared.unregister(id: 2)
        HotkeyManager.shared.unregister(id: 3)
        HotkeyManager.shared.unregister(id: 4)
        DistributedNotificationCenter.default().removeObserver(
            self,
            name: ScoutServiceURLRelay.notificationName,
            object: nil
        )
        DistributedNotificationCenter.default().removeObserver(
            self,
            name: ScoutServiceURLRelay.openScoutNetworkAuthSavedNotificationName,
            object: nil
        )
        controller.stop()
    }

    @objc
    private func statusItemClicked(_ sender: Any?) {
        guard let event = NSApp.currentEvent, let button = statusItem.button else {
            return
        }

        if event.type == .rightMouseUp {
            contextMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
            return
        }

        if let popover, popover.isShown {
            popover.performClose(sender)
            return
        }

        let popover = makePopover()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        controller.setStatusSurfaceVisible(true, source: "popover")
    }

    func popoverDidClose(_ notification: Notification) {
        popover?.contentViewController = nil
        popover = nil
        controller.clearActionLog()
        controller.setStatusSurfaceVisible(false, source: "popover")
    }

    private func makePopover() -> NSPopover {
        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingController(rootView: MainView(controller: controller))
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
        self.popover = popover
        return popover
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu()

        let taskTitle = taskHotkeyRegistered
            ? "New Agent Task"
            : "New Agent Task (Hyper+A unavailable)"
        let taskItem = NSMenuItem(
            title: taskTitle,
            action: #selector(newAgentTask),
            keyEquivalent: taskHotkeyRegistered ? "a" : ""
        )
        taskItem.target = self
        taskItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(taskItem)

        menu.addItem(.separator())

        let commsItem = NSMenuItem(title: "Open Scout App", action: #selector(openComms), keyEquivalent: "c")
        commsItem.target = self
        commsItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(commsItem)

        let openItem = NSMenuItem(title: "Open Web App", action: #selector(openWebApp), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let openTailscaleItem = NSMenuItem(title: "Open Tailscale", action: #selector(openTailscale), keyEquivalent: "")
        openTailscaleItem.target = self
        menu.addItem(openTailscaleItem)

        let openScoutNetworkItem = NSMenuItem(title: "Set Up OpenScout Network", action: #selector(setUpOpenScoutNetwork), keyEquivalent: "")
        openScoutNetworkItem.target = self
        menu.addItem(openScoutNetworkItem)

        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshState), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        menu.addItem(.separator())

        let hudItem = NSMenuItem(title: "Toggle HUD Overlay", action: #selector(toggleHUD), keyEquivalent: "h")
        hudItem.target = self
        hudItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(hudItem)

        let tailItem = NSMenuItem(title: "Toggle Tail Mode", action: #selector(showTailMode), keyEquivalent: "t")
        tailItem.target = self
        tailItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(tailItem)

        let hotCornerItem = NSMenuItem(title: "Task Hot Corner", action: nil, keyEquivalent: "")
        let hotCornerMenu = NSMenu(title: "Task Hot Corner")
        let disabled = NSMenuItem(title: "Off", action: #selector(selectCaptureHotCorner(_:)), keyEquivalent: "")
        disabled.target = self
        disabled.representedObject = "off"
        disabled.state = captureHotZone.corner == nil ? .on : .off
        hotCornerMenu.addItem(disabled)
        hotCornerMenu.addItem(.separator())
        for corner in HUDCaptureCorner.allCases {
            let item = NSMenuItem(
                title: corner.label,
                action: #selector(selectCaptureHotCorner(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = corner.rawValue
            item.state = captureHotZone.corner == corner ? .on : .off
            hotCornerMenu.addItem(item)
        }
        hotCornerItem.submenu = hotCornerMenu
        menu.addItem(hotCornerItem)

        menu.addItem(.separator())

        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Scout Menu", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
    }

    private func configureStatusButton(_ button: NSStatusBarButton, symbolName: String, tooltip: String) {
        statusItem.length = 24
        button.title = ""
        button.image = menuBarImage(fallbackSymbolName: symbolName)
        button.imagePosition = .imageOnly
        button.imageScaling = .scaleNone
        button.toolTip = tooltip
        button.setAccessibilityLabel("OpenScout menu")
        button.setAccessibilityHelp("Click to choose Scout, HUD, or Tail. Right-click for quick actions.")
    }

    private func menuBarImage(fallbackSymbolName _: String) -> NSImage? {
        let image = scoutStatusGlyphImage()
        image.isTemplate = true
        image.accessibilityDescription = "Scout"
        return image
    }

    private func scoutStatusGlyphImage() -> NSImage {
        let size = NSSize(width: 20, height: 20)
        return NSImage(size: size, flipped: false) { rect in
            func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                NSPoint(
                    x: rect.minX + (x / size.width) * rect.width,
                    y: rect.minY + (y / size.height) * rect.height
                )
            }

            func stroke(_ points: [NSPoint], closed: Bool, lineWidth: CGFloat, color: NSColor) {
                guard let first = points.first else {
                    return
                }

                let path = NSBezierPath()
                path.lineCapStyle = .round
                path.lineJoinStyle = .round
                path.lineWidth = lineWidth
                path.move(to: first)
                points.dropFirst().forEach { path.line(to: $0) }
                if closed {
                    path.close()
                }
                color.setStroke()
                path.stroke()
            }

            let outer = [
                point(10.0, 15.7),
                point(14.8, 12.9),
                point(14.8, 7.1),
                point(10.0, 4.3),
                point(5.2, 7.1),
                point(5.2, 12.9),
            ]
            let ink = NSColor.black
            stroke(outer, closed: true, lineWidth: 2.15, color: ink)

            return true
        }
    }

    @objc
    private func openWebApp() {
        controller.openWebApp()
    }

    @objc
    private func openComms() {
        ScoutAppBridge.openScout()
    }

    @objc
    private func newAgentTask() {
        ScoutAppBridge.openHUD(command: "task")
    }

    @objc
    private func selectCaptureHotCorner(_ sender: NSMenuItem) {
        let raw = sender.representedObject as? String
        captureHotZone.corner = raw == "off" ? nil : HUDCaptureCorner(argument: raw)
        for item in sender.menu?.items ?? [] {
            guard let value = item.representedObject as? String else { continue }
            item.state = (value == "off" && captureHotZone.corner == nil)
                || value == captureHotZone.corner?.rawValue
                ? .on
                : .off
        }
    }

    @objc
    private func openTailscale() {
        controller.openTailscale()
    }

    @objc
    private func setUpOpenScoutNetwork() {
        controller.setUpOpenScoutNetwork()
    }

    @objc
    private func openLogsView() {
        controller.openLogsView()
    }

    @objc
    private func openSettings() {
        SettingsWindowController.shared.show(controller: controller)
    }

    @objc
    private func refreshState() {
        controller.refresh()
    }

    @objc
    private func toggleHUD() {
        ScoutAppBridge.openHUD(command: "toggle")
    }

    @objc
    private func showTailMode() {
        ScoutAppBridge.openHUD(command: "tail-toggle")
    }

    private func forwardCaptureDrop(anchor: HUDCaptureAnchor, drop: HUDCaptureDrop) -> Bool {
        var seenPaths = Set<String>()
        var uniquePaths: [String] = []
        for url in drop.fileURLs {
            let path = url.standardizedFileURL.path
            if seenPaths.insert(path).inserted {
                uniquePaths.append(path)
            }
        }
        let payload = ScoutCapturePayload(
            corner: anchor.corner.rawValue,
            displayID: anchor.displayID,
            filePaths: uniquePaths,
            attachments: drop.attachments.map {
                ScoutCapturePayload.Attachment(
                    data: $0.data,
                    mediaType: $0.mediaType,
                    fileName: $0.fileName
                )
            },
            text: drop.text
        )
        do {
            let token = try ScoutCapturePayloadStore.save(payload)
            guard ScoutAppBridge.openHUD(command: "task-capture", value: token) else {
                try? ScoutCapturePayloadStore.discard(token: token)
                throw CocoaError(.fileNoSuchFile)
            }
            return true
        } catch {
            surfaceCaptureError(
                "The drop could not be staged. Nothing was consumed; try dropping it again."
            )
            return false
        }
    }

    private func surfaceCaptureError(_ message: String) {
        NSLog("[capture] %@", message)
        NSSound.beep()
        ScoutAppBridge.openHUD(command: "task-error", value: message)
    }

    @objc
    private func quitApp() {
        NSApplication.shared.terminate(nil)
    }

    @objc
    private func handleScoutURL(_ event: NSAppleEventDescriptor, withReplyEvent _: NSAppleEventDescriptor) {
        guard
            let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
            let url = URL(string: urlString)
        else { return }
        Task { @MainActor in
            HUDURLRouter.handle(url: url)
        }
    }

    @objc
    private func handleServiceURLNotification(_ notification: Notification) {
        guard
            let urlString = notification.userInfo?["url"] as? String,
            let url = URL(string: urlString)
        else { return }
        HUDURLRouter.handle(url: url)
    }

    @objc
    private func handleOpenScoutNetworkAuthSaved(_ notification: Notification) {
        controller.finishOpenScoutNetworkSetupAfterAuth()
    }
}
