import AppKit
import Combine
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

        // scout:// URL scheme ingress + live state mirror at
        // /tmp/openscout-hud-state.json. Pair makes up the HUD's
        // external IPC: URLs for actions, JSON file for queries.
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleScoutURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
        HUDStateFile.shared.start()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = menuBarImage(symbolName: controller.menuBarSymbolName)
            button.toolTip = controller.menuBarTooltip
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        contextMenu = buildContextMenu()

        // Global HUD hotkey: Hyper (⌃⌥⇧⌘) + H.
        HotkeyManager.shared.register(
            id: 1,
            keyCode: CarbonKeyCode.h,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                HUDController.shared.toggle()
            }
        }
        HotkeyManager.shared.register(
            id: 2,
            keyCode: CarbonKeyCode.c,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                OpenScoutAppController.shared.openComms()
            }
        }

        controller.$menuBarSymbolName
            .combineLatest(controller.$menuBarTooltip)
            .sink { [weak self] symbolName, tooltip in
                guard let button = self?.statusItem.button else {
                    return
                }

                button.image = self?.menuBarImage(symbolName: symbolName)
                button.toolTip = tooltip
            }
            .store(in: &cancellables)

        ThemeManager.shared.$mode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.popover?.appearance = ThemeManager.shared.nsAppearance
            }
            .store(in: &cancellables)

        controller.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
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
        popover.appearance = ThemeManager.shared.nsAppearance
        let host = NSHostingController(rootView: MainView(controller: controller))
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
        self.popover = popover
        return popover
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu()

        let commsItem = NSMenuItem(title: "Open Comms", action: #selector(openComms), keyEquivalent: "c")
        commsItem.target = self
        commsItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(commsItem)

        let openItem = NSMenuItem(title: "Open OpenScout", action: #selector(openWebApp), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let openTailscaleItem = NSMenuItem(title: "Open Tailscale", action: #selector(openTailscale), keyEquivalent: "")
        openTailscaleItem.target = self
        menu.addItem(openTailscaleItem)

        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshState), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        menu.addItem(.separator())

        let hudItem = NSMenuItem(title: "Show HUD", action: #selector(toggleHUD), keyEquivalent: "h")
        hudItem.target = self
        hudItem.keyEquivalentModifierMask = [.command, .control, .option, .shift]
        menu.addItem(hudItem)

        menu.addItem(.separator())

        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit OpenScout Menu", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
    }

    private func menuBarImage(symbolName: String) -> NSImage? {
        let image = NSImage(
            systemSymbolName: symbolName,
            accessibilityDescription: "OpenScout"
        )
        image?.isTemplate = true
        return image
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
        HUDController.shared.toggle()
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
}
