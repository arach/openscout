import AppKit
import Combine
import ScoutAppCore
import ScoutHUD
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private let controller = OpenScoutAppController.shared
    private var statusItem: NSStatusItem!
    private var popover: NSPopover?
    private var contextMenu: NSMenu!
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
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

        contextMenu = buildContextMenu()

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
                OpenScoutAppController.shared.openComms()
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

        let commsItem = NSMenuItem(title: "Open Scout", action: #selector(openComms), keyEquivalent: "c")
        commsItem.target = self
        commsItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(commsItem)

        let openItem = NSMenuItem(title: "Open OpenScout", action: #selector(openWebApp), keyEquivalent: "")
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

        let hudItem = NSMenuItem(title: "Show HUD", action: #selector(toggleHUD), keyEquivalent: "h")
        hudItem.target = self
        hudItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(hudItem)

        let tailItem = NSMenuItem(title: "Toggle Tail Mode", action: #selector(showTailMode), keyEquivalent: "t")
        tailItem.target = self
        tailItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(tailItem)

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
        controller.openComms()
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
