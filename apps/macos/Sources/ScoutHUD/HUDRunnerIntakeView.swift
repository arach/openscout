import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct HUDRunnerDropCatcher: NSViewRepresentable {
    var onTargeted: (Bool) -> Void
    var onPromiseImporting: (Bool) -> Void
    var onFileURLs: ([URL]) -> Bool
    var onAttachments: ([ScoutComposerImage]) -> Bool
    var onText: (String) -> Bool
    var onError: (String) -> Void

    func makeNSView(context: Context) -> HUDRunnerDropView {
        let view = HUDRunnerDropView()
        update(view)
        return view
    }

    func updateNSView(_ nsView: HUDRunnerDropView, context: Context) {
        update(nsView)
    }

    private func update(_ view: HUDRunnerDropView) {
        view.onTargeted = onTargeted
        view.onPromiseImporting = onPromiseImporting
        view.onFileURLs = onFileURLs
        view.onAttachments = onAttachments
        view.onText = onText
        view.onError = onError
    }
}

final class HUDRunnerDropView: NSView {
    var onTargeted: (Bool) -> Void = { _ in }
    var onPromiseImporting: (Bool) -> Void = { _ in }
    var onFileURLs: ([URL]) -> Bool = { _ in false }
    var onAttachments: ([ScoutComposerImage]) -> Bool = { _ in false }
    var onText: (String) -> Bool = { _ in false }
    var onError: (String) -> Void = { _ in }

    private let dragTypes: [NSPasteboard.PasteboardType] = [
        .fileURL,
        .URL,
        .string,
        .png,
        .tiff,
    ] + HUDFilePromiseIntake.draggedTypes

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes(dragTypes)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard canAccept(sender.draggingPasteboard) else {
            onTargeted(false)
            return []
        }
        onTargeted(true)
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        canAccept(sender.draggingPasteboard) ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        onTargeted(false)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        onTargeted(false)
        let pasteboard = sender.draggingPasteboard
        if HUDFilePromiseIntake.isOffered(by: pasteboard) {
            onPromiseImporting(true)
            let started = HUDFilePromiseIntake.receive(from: pasteboard) { [weak self] outcome in
                guard let self else { return }
                let accepted = !outcome.fileURLs.isEmpty && self.onFileURLs(outcome.fileURLs)
                if let message = outcome.errorMessage {
                    self.onError(message)
                } else if !accepted {
                    self.onError("The promised files could not be added to this task.")
                }
                self.onPromiseImporting(false)
            }
            if started { return true }
            onPromiseImporting(false)
            // Legacy drags can advertise promise types but expose only a
            // regular file URL. Let the ordinary intake below handle those.
        }
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL]) ?? []
        let fileURLs = urls.filter(\.isFileURL)
        var accepted = !fileURLs.isEmpty && onFileURLs(fileURLs)

        let attachments = ScoutMediaIntake.inlineFromPasteboard(pasteboard)
        if !attachments.isEmpty {
            accepted = onAttachments(attachments) || accepted
        }

        var textParts = urls.filter { !$0.isFileURL }.map(\.absoluteString)
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty,
           !textParts.contains(text),
           !fileURLs.contains(where: { $0.absoluteString == text || $0.path == text }) {
            textParts.append(text)
        }
        if !textParts.isEmpty {
            accepted = onText(textParts.joined(separator: "\n")) || accepted
        }
        return accepted
    }

    private func canAccept(_ pasteboard: NSPasteboard) -> Bool {
        let offered = Set(pasteboard.types ?? [])
        return dragTypes.contains { offered.contains($0) }
    }
}

struct HUDRunnerPasteCatcher: NSViewRepresentable {
    var isActive: () -> Bool
    var onFileURLs: ([URL]) -> Bool
    var onAttachments: ([ScoutComposerImage]) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, onFileURLs: onFileURLs, onAttachments: onAttachments)
    }

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isActive = isActive
        context.coordinator.onFileURLs = onFileURLs
        context.coordinator.onAttachments = onAttachments
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator {
        var isActive: () -> Bool
        var onFileURLs: ([URL]) -> Bool
        var onAttachments: ([ScoutComposerImage]) -> Bool
        private var monitor: Any?

        init(
            isActive: @escaping () -> Bool,
            onFileURLs: @escaping ([URL]) -> Bool,
            onAttachments: @escaping ([ScoutComposerImage]) -> Bool
        ) {
            self.isActive = isActive
            self.onFileURLs = onFileURLs
            self.onAttachments = onAttachments
        }

        deinit { uninstall() }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.isActive() else { return event }
                guard event.modifierFlags.contains(.command),
                      event.charactersIgnoringModifiers?.lowercased() == "v" else { return event }
                let pasteboard = NSPasteboard.general
                let fileURLs = (pasteboard.readObjects(
                    forClasses: [NSURL.self],
                    options: [.urlReadingFileURLsOnly: true]
                ) as? [URL]) ?? []
                if !fileURLs.isEmpty {
                    return self.onFileURLs(fileURLs) ? nil : event
                }
                let attachments = ScoutMediaIntake.inlineFromPasteboard(pasteboard)
                guard !attachments.isEmpty else { return event }
                return self.onAttachments(attachments) ? nil : event
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }
    }
}
