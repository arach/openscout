import AppKit
import Foundation
import ScoutAppCore
import UniformTypeIdentifiers

public enum HUDCaptureCorner: String, CaseIterable, Sendable {
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"

    public init?(argument raw: String?) {
        guard let raw else { return nil }
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
            .replacingOccurrences(of: " ", with: "-")
        switch normalized {
        case "top-left", "topleft", "tl": self = .topLeft
        case "top-right", "topright", "tr": self = .topRight
        case "bottom-left", "bottomleft", "bl": self = .bottomLeft
        case "bottom-right", "bottomright", "br": self = .bottomRight
        default: return nil
        }
    }

    public var label: String {
        switch self {
        case .topLeft: return "Top Left"
        case .topRight: return "Top Right"
        case .bottomLeft: return "Bottom Left"
        case .bottomRight: return "Bottom Right"
        }
    }

    public func hotZone(in visibleFrame: NSRect, edgeLength: CGFloat = 28) -> NSRect {
        let length = min(max(edgeLength, 8), min(visibleFrame.width, visibleFrame.height))
        switch self {
        case .topLeft:
            return NSRect(x: visibleFrame.minX, y: visibleFrame.maxY - length, width: length, height: length)
        case .topRight:
            return NSRect(x: visibleFrame.maxX - length, y: visibleFrame.maxY - length, width: length, height: length)
        case .bottomLeft:
            return NSRect(x: visibleFrame.minX, y: visibleFrame.minY, width: length, height: length)
        case .bottomRight:
            return NSRect(x: visibleFrame.maxX - length, y: visibleFrame.minY, width: length, height: length)
        }
    }

    public func panelOrigin(size: NSSize, in visibleFrame: NSRect, margin: CGFloat = 0) -> NSPoint {
        let width = min(size.width, visibleFrame.width)
        let height = min(size.height, visibleFrame.height)
        switch self {
        case .topLeft:
            return NSPoint(x: visibleFrame.minX + margin, y: visibleFrame.maxY - height - margin)
        case .topRight:
            return NSPoint(x: visibleFrame.maxX - width - margin, y: visibleFrame.maxY - height - margin)
        case .bottomLeft:
            return NSPoint(x: visibleFrame.minX + margin, y: visibleFrame.minY + margin)
        case .bottomRight:
            return NSPoint(x: visibleFrame.maxX - width - margin, y: visibleFrame.minY + margin)
        }
    }
}

public struct HUDCaptureAnchor: Equatable, Sendable {
    public let corner: HUDCaptureCorner
    public let displayID: UInt32?

    public init(corner: HUDCaptureCorner, displayID: UInt32? = nil) {
        self.corner = corner
        self.displayID = displayID
    }

    public init?(argument raw: String?) {
        guard let raw else { return nil }
        let parts = raw.split(separator: "@", maxSplits: 1).map(String.init)
        guard let corner = HUDCaptureCorner(argument: parts.first) else { return nil }
        self.corner = corner
        self.displayID = parts.count == 2 ? UInt32(parts[1]) : nil
    }

    public var argument: String {
        guard let displayID else { return corner.rawValue }
        return "\(corner.rawValue)@\(displayID)"
    }

    public func screen(in screens: [NSScreen] = NSScreen.screens) -> NSScreen? {
        guard let displayID else { return nil }
        return screens.first { Self.displayID(for: $0) == displayID }
    }

    public static func displayID(for screen: NSScreen) -> UInt32? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }
}

public struct HUDCaptureDrop {
    public let fileURLs: [URL]
    public let attachments: [ScoutComposerImage]
    public let text: String?

    public init(fileURLs: [URL], attachments: [ScoutComposerImage], text: String?) {
        self.fileURLs = fileURLs
        self.attachments = attachments
        self.text = text
    }

    public var isEmpty: Bool {
        fileURLs.isEmpty
            && attachments.isEmpty
            && (text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }
}

struct HUDFilePromiseOutcome: Sendable {
    let fileURLs: [URL]
    let errors: [String]

    var errorMessage: String? {
        guard !errors.isEmpty else { return nil }
        let prefix = fileURLs.isEmpty
            ? "The promised files could not be imported."
            : "Some promised files could not be imported."
        return "\(prefix) \(errors[0])"
    }
}

/// Shared promised-file intake for both the cold helper hot zone and the live
/// Scout HUD. AppKit writes the promised originals asynchronously, so the
/// transfer retains every receiver and reports one aggregate result.
@MainActor
enum HUDFilePromiseIntake {
    private static var activeTransfers: [UUID: HUDFilePromiseTransfer] = [:]

    static var draggedTypes: [NSPasteboard.PasteboardType] {
        NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) }
    }

    static func isOffered(by pasteboard: NSPasteboard) -> Bool {
        let offered = Set(pasteboard.types ?? [])
        return draggedTypes.contains { offered.contains($0) }
    }

    @discardableResult
    static func receive(
        from pasteboard: NSPasteboard,
        completion: @escaping @MainActor @Sendable (HUDFilePromiseOutcome) -> Void
    ) -> Bool {
        let receivers = (pasteboard.readObjects(
            forClasses: [NSFilePromiseReceiver.self],
            options: nil
        ) as? [NSFilePromiseReceiver]) ?? []
        guard !receivers.isEmpty else { return false }

        let destination: URL
        do {
            destination = try ScoutCapturePayloadStore.makePromiseStagingDirectory()
        } catch {
            completion(HUDFilePromiseOutcome(fileURLs: [], errors: [error.localizedDescription]))
            return true
        }

        let id = UUID()
        let transfer = HUDFilePromiseTransfer(
            receivers: receivers,
            destination: destination
        ) { outcome in
            Task { @MainActor in
                activeTransfers[id] = nil
                completion(outcome)
            }
        }
        activeTransfers[id] = transfer
        transfer.start()
        return true
    }
}

private final class HUDFilePromiseTransfer: @unchecked Sendable {
    private let receivers: [NSFilePromiseReceiver]
    private let destination: URL
    private let queue: OperationQueue
    private let completion: @Sendable (HUDFilePromiseOutcome) -> Void
    private let lock = NSLock()
    private var remaining = 0
    private var fileURLs: [URL] = []
    private var errors: [String] = []
    private var didFinish = false

    init(
        receivers: [NSFilePromiseReceiver],
        destination: URL,
        completion: @escaping @Sendable (HUDFilePromiseOutcome) -> Void
    ) {
        self.receivers = receivers
        self.destination = destination
        self.completion = completion
        let queue = OperationQueue()
        queue.name = "app.openscout.file-promises.\(UUID().uuidString.lowercased())"
        queue.qualityOfService = .userInitiated
        queue.maxConcurrentOperationCount = 1
        self.queue = queue
    }

    func start() {
        // Suspending closes the accounting race: fileNames becomes available
        // after receivePromisedFiles is called, before any reader can run.
        queue.isSuspended = true
        for receiver in receivers {
            receiver.receivePromisedFiles(
                atDestination: destination,
                options: [:],
                operationQueue: queue
            ) { [weak self] fileURL, error in
                self?.consume(fileURL: fileURL, error: error)
            }
            remaining += max(receiver.fileNames.count, 1)
        }
        queue.isSuspended = false
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 120) { [weak self] in
            self?.timeOutIfNeeded()
        }
    }

    private func consume(fileURL: URL, error: Error?) {
        let outcome: HUDFilePromiseOutcome?
        lock.lock()
        guard !didFinish else {
            lock.unlock()
            return
        }
        try? FileManager.default.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: destination.path
        )
        if let error {
            errors.append(error.localizedDescription)
        } else if isInsideDestination(fileURL) {
            fileURLs.append(fileURL.standardizedFileURL)
        } else {
            errors.append("A provider returned a file outside Scout's private staging directory.")
        }

        remaining -= 1
        if remaining <= 0 {
            didFinish = true
            outcome = makeOutcome(removeEmptyDestination: true)
        } else {
            outcome = nil
        }
        lock.unlock()
        if let outcome {
            completion(outcome)
        }
    }

    private func timeOutIfNeeded() {
        let outcome: HUDFilePromiseOutcome?
        lock.lock()
        if didFinish {
            outcome = nil
        } else {
            didFinish = true
            errors.append("The drag source did not finish within two minutes.")
            // The provider may still be writing. Leave the private directory
            // for TTL cleanup instead of racing it with a deletion.
            outcome = makeOutcome(removeEmptyDestination: false)
        }
        lock.unlock()
        if let outcome {
            completion(outcome)
        }
    }

    private func makeOutcome(removeEmptyDestination: Bool) -> HUDFilePromiseOutcome {
        var seen = Set<String>()
        let unique = fileURLs.filter { seen.insert($0.path).inserted }
        let accepted = Array(unique.prefix(ScoutCapturePayloadStore.maximumFilePathCount))
        if unique.count > accepted.count {
            errors.append("Only the first \(ScoutCapturePayloadStore.maximumFilePathCount) items were kept.")
        }
        if accepted.isEmpty, removeEmptyDestination {
            try? FileManager.default.removeItem(at: destination)
        }
        return HUDFilePromiseOutcome(fileURLs: accepted, errors: errors)
    }

    private func isInsideDestination(_ fileURL: URL) -> Bool {
        let lexicalRoot = destination.standardizedFileURL.path
        let lexicalFile = fileURL.standardizedFileURL.path
        guard lexicalFile.hasPrefix(lexicalRoot + "/") else { return false }
        let resolvedRoot = destination.resolvingSymlinksInPath().standardizedFileURL.path
        let resolvedFile = fileURL.resolvingSymlinksInPath().standardizedFileURL.path
        return resolvedFile.hasPrefix(resolvedRoot + "/")
    }
}

/// Global capture ingress owned by the menu helper.
///
/// Hovering in the configured corner for a short dwell opens the task HUD.
/// During a cross-app drag, a small nonactivating receiver appears immediately
/// so the drop can complete even when Scout is cold; the helper then forwards a
/// transient payload token to Scout and never hosts the product composer.
@MainActor
public final class HUDCaptureHotZoneMonitor {
    public static let shared = HUDCaptureHotZoneMonitor()
    public static let cornerDefaultsKey = "scout.capture.hotCorner"
    public static let dwellDefaultsKey = "scout.capture.hotCornerDwellSeconds"

    public var corner: HUDCaptureCorner? {
        didSet {
            defaults.set(corner?.rawValue ?? "off", forKey: Self.cornerDefaultsKey)
            resetArmState()
        }
    }

    public var dwellSeconds: TimeInterval {
        didSet {
            dwellSeconds = min(max(dwellSeconds, 0.15), 2.0)
            defaults.set(dwellSeconds, forKey: Self.dwellDefaultsKey)
            cancelDwell()
        }
    }

    private let defaults: UserDefaults
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var screenObserver: NSObjectProtocol?
    private var dwellTask: Task<Void, Never>?
    private var armed = true
    private var receiverPanel: HUDCaptureReceiverPanel?
    private var receiverCorner: HUDCaptureCorner?
    private var receiverDisplayID: UInt32?
    private var onHover: ((HUDCaptureAnchor) -> Void)?
    private var onDrop: ((HUDCaptureAnchor, HUDCaptureDrop) -> Bool)?
    private var onPromiseError: ((HUDCaptureAnchor, String) -> Void)?

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let stored = defaults.string(forKey: Self.cornerDefaultsKey) {
            corner = stored == "off" ? nil : HUDCaptureCorner(argument: stored)
        } else {
            corner = .bottomLeft
        }
        let storedDwell = defaults.double(forKey: Self.dwellDefaultsKey)
        dwellSeconds = storedDwell > 0 ? min(max(storedDwell, 0.15), 2.0) : 0.42
    }

    public func start(
        onHover: @escaping (HUDCaptureAnchor) -> Void,
        onDrop: @escaping (HUDCaptureAnchor, HUDCaptureDrop) -> Bool,
        onPromiseError: @escaping (HUDCaptureAnchor, String) -> Void = { _, _ in }
    ) {
        stop()
        self.onHover = onHover
        self.onDrop = onDrop
        self.onPromiseError = onPromiseError

        let mask: NSEvent.EventTypeMask = [
            .mouseMoved,
            .leftMouseDragged,
            .rightMouseDragged,
            .otherMouseDragged,
            .leftMouseUp,
            .rightMouseUp,
            .otherMouseUp,
        ]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            let kind = HUDCapturePointerEvent(event)
            Task { @MainActor [weak self] in self?.handlePointerEvent(kind) }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            let kind = HUDCapturePointerEvent(event)
            Task { @MainActor [weak self] in self?.handlePointerEvent(kind) }
            return event
        }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.screenConfigurationChanged() }
        }
    }

    public func stop() {
        cancelDwell()
        hideReceiver()
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
            self.globalMonitor = nil
        }
        if let localMonitor {
            NSEvent.removeMonitor(localMonitor)
            self.localMonitor = nil
        }
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
            self.screenObserver = nil
        }
        onHover = nil
        onDrop = nil
        onPromiseError = nil
        armed = true
    }

    private func handlePointerEvent(_ event: HUDCapturePointerEvent) {
        guard let corner else {
            hideReceiver()
            cancelDwell()
            return
        }

        if event.isMouseUp {
            if receiverPanel?.isVisible == true {
                Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(180))
                    guard self?.receiverPanel?.isPerformingDrop != true else { return }
                    self?.hideReceiver()
                }
            }
            return
        }

        let location = NSEvent.mouseLocation
        guard let screen = screen(containing: location) else { return }
        let zone = corner.hotZone(in: screen.frame)
        let insideZone = zone.contains(location)
        let insideReceiver = receiverPanel?.isVisible == true
            && receiverPanel?.frame.contains(location) == true

        guard insideZone || insideReceiver else {
            cancelDwell()
            hideReceiver()
            armed = true
            return
        }
        guard armed else { return }

        if event.isDrag || CGEventSource.buttonState(.combinedSessionState, button: .left) {
            cancelDwell()
            showReceiver(for: corner, on: screen)
            return
        }

        guard dwellTask == nil else { return }
        dwellTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(self.dwellSeconds))
            guard !Task.isCancelled,
                  self.armed,
                  self.corner == corner,
                  let currentScreen = self.screen(containing: NSEvent.mouseLocation),
                  corner.hotZone(in: currentScreen.frame).contains(NSEvent.mouseLocation)
            else { return }
            self.armed = false
            self.dwellTask = nil
            self.onHover?(HUDCaptureAnchor(
                corner: corner,
                displayID: HUDCaptureAnchor.displayID(for: currentScreen)
            ))
        }
    }

    private func showReceiver(for corner: HUDCaptureCorner, on screen: NSScreen) {
        if receiverPanel == nil {
            receiverPanel = HUDCaptureReceiverPanel { [weak self] anchor, drop in
                guard let self else { return false }
                self.armed = false
                return self.onDrop?(anchor, drop) ?? false
            } onPromiseError: { [weak self] anchor, message in
                self?.armed = false
                self?.onPromiseError?(anchor, message)
            } onConclude: { [weak self] in
                self?.hideReceiver()
            }
        }
        guard let receiverPanel else { return }
        receiverCorner = corner
        receiverDisplayID = HUDCaptureAnchor.displayID(for: screen)
        receiverPanel.captureAnchor = HUDCaptureAnchor(
            corner: corner,
            displayID: receiverDisplayID
        )
        let size = NSSize(width: 112, height: 82)
        let origin = corner.panelOrigin(size: size, in: screen.frame)
        receiverPanel.setFrame(NSRect(origin: origin, size: size), display: true)
        receiverPanel.orderFrontRegardless()
    }

    private func hideReceiver() {
        receiverPanel?.orderOut(nil)
        receiverPanel?.captureAnchor = nil
        receiverCorner = nil
        receiverDisplayID = nil
    }

    private func cancelDwell() {
        dwellTask?.cancel()
        dwellTask = nil
    }

    private func resetArmState() {
        cancelDwell()
        hideReceiver()
        armed = true
    }

    private func screenConfigurationChanged() {
        resetArmState()
    }

    private func screen(containing point: NSPoint) -> NSScreen? {
        NSScreen.screens.first(where: { $0.frame.contains(point) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }
}

private struct HUDCapturePointerEvent: Sendable {
    let isDrag: Bool
    let isMouseUp: Bool

    init(_ event: NSEvent) {
        switch event.type {
        case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            isDrag = true
            isMouseUp = false
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            isDrag = false
            isMouseUp = true
        default:
            isDrag = false
            isMouseUp = false
        }
    }
}

private final class HUDCaptureReceiverPanel: NSPanel {
    fileprivate var isPerformingDrop = false
    fileprivate var isImportingPromise = false
    fileprivate var captureAnchor: HUDCaptureAnchor?

    init(
        onDrop: @escaping (HUDCaptureAnchor, HUDCaptureDrop) -> Bool,
        onPromiseError: @escaping (HUDCaptureAnchor, String) -> Void,
        onConclude: @escaping () -> Void
    ) {
        let receiver = HUDCaptureReceiverView(
            frame: .zero,
            onDrop: onDrop,
            onPromiseError: onPromiseError,
            onConclude: onConclude
        )
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 112, height: 82),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        receiver.ownerPanel = self
        contentView = receiver
        isOpaque = false
        backgroundColor = .clear
        level = .popUpMenu
        hasShadow = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        sharingType = .readOnly
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class HUDCaptureReceiverView: NSView {
    weak var ownerPanel: HUDCaptureReceiverPanel?
    private let onDrop: (HUDCaptureAnchor, HUDCaptureDrop) -> Bool
    private let onPromiseError: (HUDCaptureAnchor, String) -> Void
    private let onConclude: () -> Void
    private var targeted = false {
        didSet { needsDisplay = true }
    }
    private var isImportingPromise = false {
        didSet { needsDisplay = true }
    }

    private let dragTypes: [NSPasteboard.PasteboardType] = [
        .fileURL,
        .URL,
        .string,
        .png,
        .tiff,
    ] + HUDFilePromiseIntake.draggedTypes

    init(
        frame frameRect: NSRect,
        onDrop: @escaping (HUDCaptureAnchor, HUDCaptureDrop) -> Bool,
        onPromiseError: @escaping (HUDCaptureAnchor, String) -> Void,
        onConclude: @escaping () -> Void
    ) {
        self.onDrop = onDrop
        self.onPromiseError = onPromiseError
        self.onConclude = onConclude
        super.init(frame: frameRect)
        registerForDraggedTypes(dragTypes)
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard canAccept(sender.draggingPasteboard) else { return [] }
        targeted = true
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        canAccept(sender.draggingPasteboard) ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        targeted = false
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard canAccept(sender.draggingPasteboard) else { return false }
        ownerPanel?.isPerformingDrop = true
        return true
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        targeted = false
        let pasteboard = sender.draggingPasteboard
        if HUDFilePromiseIntake.isOffered(by: pasteboard) {
            guard let anchor = ownerPanel?.captureAnchor else {
                finishPromiseImport()
                return false
            }
            isImportingPromise = true
            ownerPanel?.isImportingPromise = true
            let started = HUDFilePromiseIntake.receive(from: pasteboard) { [weak self] outcome in
                guard let self else { return }
                var accepted = false
                if !outcome.fileURLs.isEmpty {
                    accepted = self.onDrop(
                        anchor,
                        HUDCaptureDrop(fileURLs: outcome.fileURLs, attachments: [], text: nil)
                    )
                }
                if let message = outcome.errorMessage {
                    self.onPromiseError(anchor, message)
                } else if !accepted {
                    self.onPromiseError(anchor, "The promised files could not be handed to Scout.")
                }
                self.finishPromiseImport()
            }
            if started { return true }
            // A few legacy sources advertise promise types without yielding
            // receivers. Fall through to their ordinary URL/image flavor.
            isImportingPromise = false
            ownerPanel?.isImportingPromise = false
        }
        guard let anchor = ownerPanel?.captureAnchor,
              let drop = capture(from: pasteboard),
              !drop.isEmpty else {
            ownerPanel?.isPerformingDrop = false
            onConclude()
            return false
        }
        let accepted = onDrop(anchor, drop)
        if !accepted {
            ownerPanel?.isPerformingDrop = false
            onConclude()
        }
        return accepted
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        guard ownerPanel?.isImportingPromise != true else { return }
        guard ownerPanel?.isPerformingDrop == true else { return }
        ownerPanel?.isPerformingDrop = false
        onConclude()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let rect = bounds.insetBy(dx: 2, dy: 2)
        let path = NSBezierPath(roundedRect: rect, xRadius: 12, yRadius: 12)
        NSColor(calibratedWhite: targeted ? 0.10 : 0.075, alpha: 0.96).setFill()
        path.fill()
        (targeted
            ? NSColor(calibratedRed: 0.96, green: 0.66, blue: 0.24, alpha: 0.95)
            : NSColor(calibratedWhite: 0.88, alpha: 0.42)
        ).setStroke()
        path.lineWidth = targeted ? 2 : 1
        path.stroke()

        let title = isImportingPromise ? "IMPORTING…" : (targeted ? "RELEASE" : "DROP TASK")
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: targeted
                ? NSColor(calibratedRed: 0.96, green: 0.66, blue: 0.24, alpha: 1)
                : NSColor(calibratedWhite: 0.88, alpha: 0.84),
            .kern: 0.8,
        ]
        let size = title.size(withAttributes: attributes)
        title.draw(
            at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2),
            withAttributes: attributes
        )
    }

    private func canAccept(_ pasteboard: NSPasteboard) -> Bool {
        let offered = Set(pasteboard.types ?? [])
        return dragTypes.contains { offered.contains($0) }
    }

    private func finishPromiseImport() {
        isImportingPromise = false
        ownerPanel?.isImportingPromise = false
        ownerPanel?.isPerformingDrop = false
        onConclude()
    }

    private func capture(from pasteboard: NSPasteboard) -> HUDCaptureDrop? {
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL]) ?? []
        let fileURLs = urls.filter(\.isFileURL)
        let remoteURLs = urls.filter { !$0.isFileURL }.map(\.absoluteString)
        let attachments = ScoutMediaIntake.inlineFromPasteboard(pasteboard)
        var textParts = remoteURLs
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty,
           !textParts.contains(text),
           !fileURLs.contains(where: { $0.absoluteString == text || $0.path == text }) {
            textParts.append(text)
        }
        let text = textParts.isEmpty ? nil : textParts.joined(separator: "\n")
        return HUDCaptureDrop(fileURLs: fileURLs, attachments: attachments, text: text)
    }
}
