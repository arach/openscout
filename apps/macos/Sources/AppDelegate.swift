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

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = menuBarImage(symbolName: controller.menuBarSymbolName)
            button.toolTip = controller.menuBarTooltip
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        contextMenu = buildContextMenu()

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
    }

    func popoverDidClose(_ notification: Notification) {
        popover?.contentViewController = nil
        popover = nil
    }

    private func makePopover() -> NSPopover {
        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.contentSize = NSSize(width: 408, height: 574)
        popover.appearance = NSAppearance(named: .aqua)
        popover.contentViewController = NSHostingController(
            rootView: MainView(controller: controller)
        )
        self.popover = popover
        return popover
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu()

        let openItem = NSMenuItem(title: "Open OpenScout", action: #selector(openWebApp), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshState), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

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
    private func refreshState() {
        controller.refresh()
    }

    @objc
    private func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
