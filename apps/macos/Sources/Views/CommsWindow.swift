import AppKit
import ScoutNativeCore
import SwiftUI
import WebKit

@MainActor
final class CommsWindowController: NSObject, NSWindowDelegate {
    static let shared = CommsWindowController()

    fileprivate static let baseContentSize = NSSize(width: 1020, height: 720)
    private static let observePeekWidth: CGFloat = 86
    private static let observeAttachOverlap: CGFloat = 10
    private static let observeMinWidth: CGFloat = 340
    private static let observeMaxWidth: CGFloat = 820
    fileprivate static let observeShelfWidth: CGFloat = 430

    private let service = CommsService.shared
    private var window: NSWindow?
    private var observeWindow: NSWindow?
    private var observeTarget: CommsObserveTarget?
    private var pendingObserveID: String?
    private var observeWindowWidth = observePeekWidth
    private var expandedObserveWindowWidth = observeShelfWidth
    private var observeResizeStartWidth: CGFloat?
    private var lastObserveResizeFrameAt: TimeInterval = 0
    private var familyDragStartFrame: NSRect?
    private var promotedActivationPolicy = false

    private override init() {
        super.init()
    }

    func show(cId: String? = nil) {
        service.start(preferredCId: cId)
        if window == nil {
            window = makeWindow()
        }
        guard let window else { return }
        promoteToAppWindowMode()
        if !window.isVisible {
            window.setContentSize(Self.baseContentSize)
            OverlayPanelShell.position(window, placement: .mouseScreenCentered(yOffsetRatio: 0.04))
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        positionObserveWindow()
    }

    func toggle() {
        if window?.isVisible == true {
            dismiss()
        } else {
            show()
        }
    }

    func dismiss() {
        HudVoxService.shared.cancel()
        closeObserve()
        window?.orderOut(nil)
        service.stop()
        restoreAccessoryMode()
    }

    fileprivate func showObserve(_ target: CommsObserveTarget) {
        guard window != nil else { return }
        observeTarget = target
        pendingObserveID = target.id
        observeWindowWidth = Self.observePeekWidth

        if observeWindow == nil {
            observeWindow = makeObserveWindow(target: target)
        } else {
            observeWindow?.contentViewController = NSHostingController(
                rootView: CommsObserveSidecarView(target: target) {
                    CommsWindowController.shared.closeObserve()
                } onReady: {
                    CommsWindowController.shared.presentObserveIfReady(targetID: target.id)
                }
            )
        }

        guard let observeWindow else { return }
        positionObserveWindow()
        observeWindow.alphaValue = 1
        if observeWindow.parent == nil, let window {
            window.addChildWindow(observeWindow, ordered: .below)
        }
        observeWindow.orderFront(nil)
    }

    func closeObserve() {
        let closedTarget = observeTarget
        observeTarget = nil
        pendingObserveID = nil
        observeWindowWidth = Self.observePeekWidth
        if let observeWindow {
            window?.removeChildWindow(observeWindow)
            observeWindow.orderOut(nil)
        }
        observeWindow = nil
        NotificationCenter.default.post(name: .commsObserveClosed, object: closedTarget)
    }

    func presentObserveIfReady(targetID: String) {
        guard pendingObserveID == targetID,
              let observeWindow
        else { return }
        pendingObserveID = nil
        observeWindowWidth = expandedObserveWindowWidth
        observeWindow.alphaValue = 1
        positionObserveWindow(animated: true)
        observeWindow.orderFront(nil)
    }

    func beginObserveResize() {
        guard pendingObserveID == nil else { return }
        observeResizeStartWidth = observeWindowWidth
    }

    func resizeObserveWindow(translationWidth: CGFloat) {
        guard pendingObserveID == nil else { return }
        if observeResizeStartWidth == nil {
            observeResizeStartWidth = observeWindowWidth
        }
        let startWidth = observeResizeStartWidth ?? observeWindowWidth
        let nextWidth = min(
            Self.observeMaxWidth,
            max(Self.observeMinWidth, startWidth + translationWidth)
        )
        expandedObserveWindowWidth = nextWidth
        observeWindowWidth = nextWidth
        let now = Date.timeIntervalSinceReferenceDate
        guard now - lastObserveResizeFrameAt >= (1.0 / 60.0) else { return }
        lastObserveResizeFrameAt = now
        positionObserveWindow(display: false)
    }

    func endObserveResize() {
        observeResizeStartWidth = nil
        lastObserveResizeFrameAt = 0
        positionObserveWindow(display: true)
    }

    func beginFamilyDrag() {
        familyDragStartFrame = window?.frame
        window?.makeKeyAndOrderFront(nil)
    }

    func dragFamily(screenTranslation: CGSize) {
        guard let window else { return }
        if familyDragStartFrame == nil {
            familyDragStartFrame = window.frame
            window.makeKeyAndOrderFront(nil)
        }
        guard let startFrame = familyDragStartFrame else { return }
        var nextFrame = startFrame
        nextFrame.origin.x += screenTranslation.width
        nextFrame.origin.y += screenTranslation.height
        window.setFrame(nextFrame, display: false)
    }

    func endFamilyDrag() {
        familyDragStartFrame = nil
        positionObserveWindow(display: true)
    }

    func windowWillClose(_ notification: Notification) {
        closeObserve()
        service.stop()
        window = nil
        restoreAccessoryMode()
    }

    func windowDidMove(_ notification: Notification) {
        guard notification.object as? NSWindow === window else { return }
    }

    func windowDidResize(_ notification: Notification) {
        guard notification.object as? NSWindow === window else { return }
        positionObserveWindow()
    }

    /// True while the Comms panel is on screen. The HUD dock checks this so
    /// the foreground Comms surface owns Vox dictation (splice + consume)
    /// rather than the dock stealing the final transcript.
    var isPresented: Bool { window?.isVisible == true }

    private func makeWindow() -> NSWindow {
        let hosting = NSHostingController(rootView: CommsRootView(service: service))
        let window = CommsAppWindow(
            contentRect: NSRect(origin: .zero, size: Self.baseContentSize),
            styleMask: [.borderless, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = hosting
        window.title = "OpenScout Comms"
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.contentMinSize = NSSize(width: 780, height: 540)
        window.minSize = NSSize(width: 780, height: 540)
        window.level = .normal
        window.collectionBehavior = []
        window.sharingType = .readOnly
        window.hasShadow = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.appearance = NSAppearance(named: .darkAqua)
        window.delegate = self
        window.setContentSize(Self.baseContentSize)
        return window
    }

    private func makeObserveWindow(target: CommsObserveTarget) -> NSWindow {
        let window = CommsSidecarWindow(
            contentRect: NSRect(
                origin: .zero,
                size: NSSize(width: Self.observeShelfWidth, height: Self.baseContentSize.height)
            ),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = NSHostingController(
            rootView: CommsObserveSidecarView(target: target) {
                CommsWindowController.shared.closeObserve()
            } onReady: {
                CommsWindowController.shared.presentObserveIfReady(targetID: target.id)
            }
        )
        window.title = "OpenScout Observe"
        window.level = self.window?.level ?? .normal
        window.collectionBehavior = [.fullScreenAuxiliary]
        window.sharingType = .readOnly
        window.hasShadow = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.appearance = NSAppearance(named: .darkAqua)
        return window
    }

    private func positionObserveWindow(animated: Bool = false, display: Bool = true) {
        guard let window, let observeWindow else { return }
        let frame = window.frame
        let contentFrame = window.convertToScreen(window.contentLayoutRect)
        let nextFrame = NSRect(
            x: frame.maxX - Self.observeAttachOverlap,
            y: contentFrame.minY,
            width: observeWindowWidth + Self.observeAttachOverlap,
            height: contentFrame.height
        )

        guard animated else {
            observeWindow.setFrame(nextFrame, display: display)
            return
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.allowsImplicitAnimation = true
            observeWindow.animator().setFrame(nextFrame, display: true)
        }
    }

    private func promoteToAppWindowMode() {
        guard NSApp.activationPolicy() != .regular else { return }
        promotedActivationPolicy = true
        NSApp.setActivationPolicy(.regular)
    }

    private func restoreAccessoryMode() {
        guard promotedActivationPolicy else { return }
        promotedActivationPolicy = false
        NSApp.setActivationPolicy(.accessory)
    }

}

private final class CommsAppWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private final class CommsSidecarWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private extension Notification.Name {
    static let commsObserveClosed = Notification.Name("OpenScoutCommsObserveClosed")
}

struct CommsRootView: View {
    @ObservedObject var service: CommsService

    enum Field: Hashable { case search, composer, command }

    // Drafts are kept per-channel so switching cId never loses in-progress
    // text — a core "don't surprise me" affordance for a comms tool.
    @State private var drafts: [String: String] = [:]
    @State private var channelQuery = ""
    @State private var showCommands = false
    @State private var commandQuery = ""
    @State private var commandIndex = 0
    @State private var observeTarget: CommsObserveTarget?
    @FocusState private var focus: Field?
    @ObservedObject private var vox = HudVoxService.shared

    private let observeClosedPublisher = NotificationCenter.default.publisher(for: .commsObserveClosed)

    var body: some View {
        ZStack(alignment: .leading) {
            VisualEffectBackground(material: .hudWindow, cornerRadius: 8)
            HUDChrome.canvas
            HUDPaperGrain(opacity: 0.03)

            VStack(spacing: 0) {
                header
                HUDHairline()
                main
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(keyboardCommands)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(HUDChrome.borderRim, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .preferredColorScheme(.dark)
        .onAppear {
            focusComposerSoon()
        }
        .onChange(of: service.selectedCId) { _, _ in
            closeObserve()
            focusComposerSoon()
        }
        .onReceive(observeClosedPublisher) { _ in
            observeTarget = nil
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("C")
                .font(HUDType.mono(15, weight: .bold))
                .foregroundStyle(HUDChrome.canvas)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(HUDChrome.accent)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("COMMS")
                    .font(HUDType.mono(11, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.ink)
                Text(service.selectedItem?.cIdShort ?? "cId")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
            }

            Spacer(minLength: 10)

            HStack(spacing: 4) {
                ForEach(CommsFilter.allCases) { filter in
                    CommsFilterButton(
                        label: filter.label,
                        isSelected: service.filter == filter
                    ) {
                        service.filter = filter
                    }
                }
            }

            Button {
                service.refresh(force: true)
                service.loadMessages()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Refresh")

            Button {
                CommsWindowController.shared.dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Close")
        }
        .padding(.horizontal, 18)
        .frame(height: 54)
        .background(HUDChrome.canvasAlt)
    }

    private var main: some View {
        HStack(spacing: 0) {
            rail
                .frame(width: 304)
            HUDHairline(axis: .vertical)
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var rail: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("\(visibleItems.count)")
                    .font(HUDType.mono(18, weight: .bold))
                    .foregroundStyle(HUDChrome.ink)
                Text("CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                Spacer()
                if service.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.7)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(HUDChrome.canvas)

            railSearch

            HUDHairline()

            if visibleItems.isEmpty {
                railPlaceholder
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(visibleItems) { item in
                            CommsRailRow(
                                item: item,
                                isSelected: service.selectedCId == item.cId
                            ) {
                                service.select(item.cId)
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(HUDChrome.canvas)
    }

    private var railSearch: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(HUDChrome.inkFaint)
            TextField("Jump to channel", text: $channelQuery)
                .textFieldStyle(.plain)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .focused($focus, equals: .search)
                .onSubmit {
                    if let first = visibleItems.first {
                        service.select(first.cId)
                        channelQuery = ""
                        focus = .composer
                    }
                }
            if channelQuery.isEmpty {
                Text("⌘K")
                    .font(HUDType.mono(9, weight: .bold))
                    .foregroundStyle(HUDChrome.inkDeep)
            } else {
                Button {
                    channelQuery = ""
                    focus = .search
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(HUDChrome.inkFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(HUDChrome.canvas)
    }

    @ViewBuilder
    private var railPlaceholder: some View {
        VStack(spacing: 10) {
            if service.isLoading && service.items.isEmpty {
                ProgressView()
                    .controlSize(.small)
                Text("LOADING CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            } else if let error = service.lastError, !error.isEmpty, service.items.isEmpty {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("COMMS UNREACHABLE")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                Text(error)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            } else if !channelQuery.isEmpty {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("NO MATCHES")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            } else {
                Image(systemName: "tray")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text(service.filter == .all ? "NO CHANNELS" : "NO \(service.filter.label.uppercased()) CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 20)
        .background(HUDChrome.canvas)
    }

    @ViewBuilder
    private var detail: some View {
        if let item = service.selectedItem {
            VStack(spacing: 0) {
                detailHeader(item)
                HUDHairline()
                messages
                HUDHairline()
                composer
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(HUDChrome.canvas)
        } else {
            VStack(spacing: 14) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("NO CHANNEL SELECTED")
                    .font(HUDType.mono(11, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                if let error = service.lastError, !error.isEmpty {
                    Text(error)
                        .font(HUDType.body(12))
                        .foregroundStyle(ShellPalette.error)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .frame(maxWidth: 360)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HUDChrome.canvas)
        }
    }

    private func detailHeader(_ item: CommsItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(item.displayTitle)
                    .font(HUDType.body(20, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                HStack(spacing: 8) {
                    CommsChip(text: item.scopeLabel.uppercased())
                    CommsChip(text: item.cIdShort)
                    CommsMemberStrip(item: item)
                }
            }
            Spacer(minLength: 12)
            if let branch = item.currentBranch, !branch.isEmpty {
                Text(branch)
                    .font(HUDType.mono(10, weight: .medium))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 180, alignment: .trailing)
            }
            if let target = observeTarget(for: item) {
                Button {
                    openObserve(target)
                } label: {
                    Label("Observe", systemImage: "eye")
                        .font(HUDType.mono(10, weight: .bold))
                        .tracking(0.8)
                        .frame(height: 30)
                        .padding(.horizontal, 10)
                }
                .buttonStyle(CommsPillButtonStyle(isActive: observeTarget == target))
                .help(observeTarget == target ? "Close observe" : "Peek into this agent's work")
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 72)
        .background(HUDChrome.canvasAlt)
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(service.messages.enumerated()), id: \.element.id) { index, message in
                        CommsMessageRow(
                            message: message,
                            showsHeader: Self.showsHeader(at: index, in: service.messages),
                            observeTarget: observeTarget(for: message),
                            onObserve: openObserve
                        )
                        .id(message.id)
                        .padding(.top, Self.showsHeader(at: index, in: service.messages) ? 8 : 0)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollIndicators(.visible)
            .background(HUDChrome.canvas)
            .overlay {
                if service.messages.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 26, weight: .regular))
                            .foregroundStyle(HUDChrome.inkDeep)
                        Text("NO MESSAGES YET")
                            .font(HUDType.mono(10, weight: .bold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(HUDChrome.inkMuted)
                    }
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .bottom) {
                if showCommands {
                    commandPalette
                }
            }
            .onChange(of: service.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let error = service.lastError, !error.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text(error)
                        .font(HUDType.body(12))
                        .lineLimit(2)
                    Spacer()
                }
                .foregroundStyle(ShellPalette.error)
            }

            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    toggleDictation()
                } label: {
                    Image(systemName: micSymbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(isDictating ? HUDChrome.accent : HUDChrome.inkMuted)
                        .frame(width: 38, height: 38)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(HUDChrome.canvasLift)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(isDictating ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help(isDictating ? "Stop dictation" : "Dictate with Vox")

                Button {
                    showCommands ? closeCommands() : openCommands()
                } label: {
                    Image(systemName: "command")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(showCommands ? HUDChrome.accent : HUDChrome.inkMuted)
                        .frame(width: 38, height: 38)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(HUDChrome.canvasLift)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(showCommands ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Commands — ⌘P or type /")

                TextField(composerPlaceholder, text: draftBinding, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(14))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1...5)
                    .focused($focus, equals: .composer)
                    .onKeyPress(phases: .down) { press in
                        // Return sends; Shift+Return inserts a newline
                        // (Messages-style). ⌘↩ still works via the send button.
                        guard press.key == .return else { return .ignored }
                        if press.modifiers.contains(.shift) { return .ignored }
                        sendDraft()
                        return .handled
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(HUDChrome.canvasLift)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(focus == .composer ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                    )

                Button {
                    sendDraft()
                } label: {
                    Image(systemName: service.isSending ? "hourglass" : "paperplane.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(CommsSendButtonStyle())
                .disabled(currentDraftEmpty || service.isSending)
                .keyboardShortcut(.return, modifiers: [.command])
                .help("Send")
            }

            if isDictating {
                HStack(spacing: 6) {
                    Circle()
                        .fill(HUDChrome.accent)
                        .frame(width: 6, height: 6)
                    Text(voxStatusLine)
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.head)
                    Spacer()
                }
            } else if let reason = voxUnavailableReason {
                HStack(spacing: 6) {
                    Image(systemName: "mic.slash")
                        .font(.system(size: 9, weight: .semibold))
                    Text(reason)
                        .font(HUDType.mono(9))
                        .lineLimit(1)
                    Spacer()
                }
                .foregroundStyle(HUDChrome.inkFaint)
            } else if !currentDraftEmpty {
                HStack(spacing: 0) {
                    Spacer()
                    Text("⏎ to send · ⇧⏎ newline")
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(HUDChrome.canvasAlt)
        .onReceive(vox.$lastFinalText) { text in
            spliceDictatedFinal(text)
        }
    }

    private func sendDraft() {
        guard let cId = service.selectedCId else { return }
        let body = drafts[cId] ?? ""
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        drafts[cId] = ""
        focus = .composer
        Task {
            await service.send(body)
        }
    }

    // Per-channel draft binding — text follows the selected cId so switching
    // channels parks the draft instead of discarding it.
    private var draftBinding: Binding<String> {
        let key = service.selectedCId ?? ""
        return Binding(
            get: { drafts[key] ?? "" },
            set: { newValue in
                // Typing "/" into an empty composer opens the command area
                // instead of entering the slash as message text — "/" stays
                // a control key, never a literal sent to an agent.
                if newValue == "/" && (drafts[key] ?? "").isEmpty {
                    openCommands()
                    return
                }
                drafts[key] = newValue
            }
        )
    }

    private var currentDraftEmpty: Bool {
        (drafts[service.selectedCId ?? ""] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    // Scope filter (All/Private/Shared) plus the live quick-filter query.
    private var visibleItems: [CommsItem] {
        let scoped = service.filteredItems
        let query = channelQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return scoped }
        return scoped.filter {
            $0.displayTitle.lowercased().contains(query) || $0.cId.lowercased().contains(query)
        }
    }

    private func moveSelection(_ delta: Int) {
        let items = visibleItems
        guard !items.isEmpty else { return }
        let current = items.firstIndex { $0.cId == service.selectedCId } ?? -1
        let next = max(0, min(items.count - 1, current + delta))
        guard items.indices.contains(next) else { return }
        service.select(items[next].cId)
    }

    private func focusComposerSoon() {
        DispatchQueue.main.async { focus = .composer }
    }

    // Routes to the focused field's editor via the standard responder action,
    // the same one Edit ▸ Start Dictation uses. No-op if nothing accepts it.
    // ── Dictation (Vox companion, same path as the HUD dock) ────────────
    // Routes to HudVoxService — the local Vox transcription daemon — via the
    // shared ScoutDictationController decision table, exactly like
    // HUDDockState.toggleDictation(). No macOS system dictation, no extra
    // mic-usage prompt (capture lives in the Vox process).
    private func toggleDictation() {
        focus = .composer
        Task {
            switch ScoutDictationController.toggleDecision(for: vox.state) {
            case .probeThenStartIfIdle:
                await vox.probe()
                if case .idle = vox.state { vox.start() }
            case .start:
                vox.start()
            case .stop:
                vox.stop()
            case .ignore:
                break
            }
        }
    }

    private var isDictating: Bool {
        switch vox.state {
        case .starting, .recording, .processing: return true
        default: return false
        }
    }

    private var micSymbol: String {
        switch vox.state {
        case .recording: return "stop.fill"
        case .starting, .processing: return "waveform"
        default: return "mic.fill"
        }
    }

    private var voxStatusLine: String {
        if !vox.partial.isEmpty { return vox.partial }
        switch vox.state {
        case .starting: return "Starting Vox…"
        case .processing: return "Transcribing…"
        default: return "Listening…"
        }
    }

    private var voxUnavailableReason: String? {
        if case .unavailable(let reason) = vox.state { return reason }
        return nil
    }

    // Splice a finalized transcript into the current channel's draft, then
    // drain lastFinalText so it isn't re-applied. Mirrors the dock's append.
    private func spliceDictatedFinal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let cId = service.selectedCId else { return }
        drafts[cId] = ScoutDictationBuffer.appending(trimmed, to: drafts[cId] ?? "")
        HudVoxService.shared.consumeFinalText()
        focus = .composer
    }

    private func copyCId() {
        guard let cId = service.selectedCId else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(cId, forType: .string)
    }

    private func openObserve(_ target: CommsObserveTarget) {
        if observeTarget == target {
            closeObserve()
            return
        }
        observeTarget = target
        CommsWindowController.shared.showObserve(target)
        focus = .composer
    }

    private func closeObserve() {
        observeTarget = nil
        CommsWindowController.shared.closeObserve()
        focus = .composer
    }

    private func observeTarget(for item: CommsItem) -> CommsObserveTarget? {
        let agentId = item.agentId ?? item.participantIds.first { participant in
            participant != "operator" && !participant.isEmpty
        }
        guard let agentId, !agentId.isEmpty else { return nil }
        return CommsObserveTarget(
            agentId: agentId,
            title: item.agentName?.nilIfEmpty ?? item.displayTitle
        )
    }

    private func observeTarget(for message: CommsMessage) -> CommsObserveTarget? {
        guard !message.isOperator,
              let actorId = message.actorId,
              !actorId.isEmpty
        else { return nil }
        return CommsObserveTarget(agentId: actorId, title: message.actorName)
    }

    private var selectedObserveTarget: CommsObserveTarget? {
        service.selectedItem.flatMap(observeTarget(for:))
    }

    // ── Command area ────────────────────────────────────────────────────
    // A local command surface anchored over the chat area. Every entry acts
    // on the Comms UI (navigate, scope, refresh, dictate, copy) — none of it
    // transmits text to agents, which is why "/" can safely open it.
    private func openCommands() {
        commandQuery = ""
        commandIndex = 0
        showCommands = true
        focus = .command
    }

    private func closeCommands() {
        showCommands = false
        focus = .composer
    }

    private func runCommand(_ command: CommsCommand) {
        closeCommands()
        command.run()
    }

    private var commands: [CommsCommand] {
        var next = [
            CommsCommand(id: "jump", title: "Jump to channel", hint: "⌘K", systemImage: "magnifyingglass", keywords: ["search", "find", "goto"]) { focus = .search },
            CommsCommand(id: "next", title: "Next channel", hint: "⌘↓", systemImage: "chevron.down", keywords: ["down"]) { moveSelection(1) },
            CommsCommand(id: "prev", title: "Previous channel", hint: "⌘↑", systemImage: "chevron.up", keywords: ["up"]) { moveSelection(-1) },
            CommsCommand(id: "all", title: "Show all channels", hint: "⌘1", systemImage: "tray.full", keywords: ["filter"]) { service.filter = .all },
            CommsCommand(id: "private", title: "Show private", hint: "⌘2", systemImage: "lock", keywords: ["filter", "dm", "direct"]) { service.filter = .private },
            CommsCommand(id: "shared", title: "Show shared", hint: "⌘3", systemImage: "person.2", keywords: ["filter", "group"]) { service.filter = .shared },
            CommsCommand(id: "refresh", title: "Refresh", hint: "⌘R", systemImage: "arrow.clockwise", keywords: ["reload", "sync"]) {
                service.refresh(force: true)
                service.loadMessages()
            },
            CommsCommand(id: "dictate", title: "Dictate message", hint: "", systemImage: "mic", keywords: ["voice", "speak", "vox"]) { toggleDictation() },
            CommsCommand(id: "copy", title: "Copy cId", hint: "", systemImage: "doc.on.doc", keywords: ["clipboard", "id"]) { copyCId() },
        ]
        if let target = selectedObserveTarget {
            next.insert(
                CommsCommand(id: "observe", title: "Observe agent", hint: "⌘O", systemImage: "eye", keywords: ["peek", "work", "agent", "trace"]) {
                    openObserve(target)
                },
                at: 3
            )
        }
        return next
    }

    private var filteredCommands: [CommsCommand] {
        let query = commandQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return commands }
        return commands.filter {
            $0.title.lowercased().contains(query) || $0.keywords.contains { $0.contains(query) }
        }
    }

    private var commandPalette: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("›")
                    .font(HUDType.mono(14, weight: .bold))
                    .foregroundStyle(HUDChrome.accent)
                TextField("Run a command", text: $commandQuery)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(13))
                    .foregroundStyle(HUDChrome.ink)
                    .focused($focus, equals: .command)
                    .onSubmit {
                        if let command = filteredCommands[safe: commandIndex] {
                            runCommand(command)
                        }
                    }
                Text("ESC")
                    .font(HUDType.mono(9, weight: .bold))
                    .foregroundStyle(HUDChrome.inkDeep)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)

            HUDHairline()

            if filteredCommands.isEmpty {
                Text("NO COMMANDS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(filteredCommands.enumerated()), id: \.element.id) { index, command in
                            Button {
                                runCommand(command)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: command.systemImage)
                                        .font(.system(size: 12, weight: .semibold))
                                        .frame(width: 16)
                                        .foregroundStyle(index == commandIndex ? HUDChrome.accent : HUDChrome.inkMuted)
                                    Text(command.title)
                                        .font(HUDType.body(13))
                                        .foregroundStyle(HUDChrome.ink)
                                    Spacer()
                                    if !command.hint.isEmpty {
                                        Text(command.hint)
                                            .font(HUDType.mono(9, weight: .bold))
                                            .foregroundStyle(HUDChrome.inkFaint)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .frame(height: 34)
                                .background(index == commandIndex ? HUDChrome.canvasLift : Color.clear)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .onHover { hovering in
                                if hovering { commandIndex = index }
                            }
                        }
                    }
                }
                .frame(maxHeight: 240)
                .scrollIndicators(.hidden)
            }
        }
        .frame(width: 360)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(HUDChrome.canvasAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(HUDChrome.borderRim, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .shadow(color: Color.black.opacity(0.45), radius: 24, y: 12)
        .padding(.bottom, 14)
        .onChange(of: commandQuery) { _, _ in commandIndex = 0 }
        .onKeyPress(.upArrow) {
            commandIndex = max(0, commandIndex - 1)
            return .handled
        }
        .onKeyPress(.downArrow) {
            commandIndex = min(filteredCommands.count - 1, commandIndex + 1)
            return .handled
        }
        .onKeyPress(.escape) {
            closeCommands()
            return .handled
        }
    }

    // Invisible buttons that register window-level shortcuts. Kept active
    // (opacity 0, not .hidden/.disabled) so the chords stay live.
    private var keyboardCommands: some View {
        Group {
            Button("") { service.filter = .all }.keyboardShortcut("1", modifiers: .command)
            Button("") { service.filter = .private }.keyboardShortcut("2", modifiers: .command)
            Button("") { service.filter = .shared }.keyboardShortcut("3", modifiers: .command)
            Button("") { moveSelection(1) }.keyboardShortcut(.downArrow, modifiers: .command)
            Button("") { moveSelection(-1) }.keyboardShortcut(.upArrow, modifiers: .command)
            Button("") {
                service.refresh(force: true)
                service.loadMessages()
            }.keyboardShortcut("r", modifiers: .command)
            Button("") { focus = .composer }.keyboardShortcut("l", modifiers: .command)
            Button("") { focus = .search }.keyboardShortcut("k", modifiers: .command)
            Button("") { showCommands ? closeCommands() : openCommands() }.keyboardShortcut("p", modifiers: .command)
            Button("") {
                if let target = selectedObserveTarget { openObserve(target) }
            }.keyboardShortcut("o", modifiers: .command)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }

    private var composerPlaceholder: String {
        if let title = service.selectedItem?.displayTitle, !title.isEmpty {
            return "Message \(title)"
        }
        return "Message"
    }

    private static func showsHeader(at index: Int, in messages: [CommsMessage]) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1]
        let current = messages[index]
        if prev.actorId != current.actorId || prev.isOperator != current.isOperator { return true }
        return normalizedSeconds(current.createdAt) - normalizedSeconds(prev.createdAt) > 300
    }

    private static func normalizedSeconds(_ timestamp: TimeInterval) -> TimeInterval {
        timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
    }
}

private struct CommsFilterButton: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label.uppercased())
                .font(HUDType.mono(10, weight: .bold))
                .tracking(1.0)
                .foregroundStyle(isSelected ? HUDChrome.canvas : HUDChrome.inkMuted)
                .frame(minWidth: 70, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isSelected ? HUDChrome.accent : HUDChrome.canvasLift)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(isSelected ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct CommsRailRow: View {
    let item: CommsItem
    let isSelected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.scopeLabel.uppercased())
                        .font(HUDType.mono(8, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(isSelected ? HUDChrome.accent : HUDChrome.inkFaint)
                    Spacer(minLength: 8)
                    Text(item.lastMessageAt.map(formatShortTime) ?? "NEW")
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                }

                Text(item.displayTitle)
                    .font(HUDType.body(14, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)

                HStack(spacing: 6) {
                    Text(item.preview?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? item.cIdShort)
                        .font(HUDType.body(11))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 8)
                    if item.messageCount > 0 {
                        Text("\(item.messageCount)")
                            .font(HUDType.mono(9, weight: .bold))
                            .foregroundStyle(HUDChrome.inkFaint)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
            .background(rowFill)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 2.5)
                    .opacity(isSelected ? 1 : 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { next in
            hovering = next
        }

        HUDHairline()
    }

    private var rowFill: Color {
        if isSelected { return HUDChrome.canvasLift }
        if hovering { return HUDChrome.canvasAlt }
        return HUDChrome.canvas
    }
}

private struct CommsMessageRow: View {
    let message: CommsMessage
    var showsHeader: Bool = true
    var observeTarget: CommsObserveTarget?
    var onObserve: (CommsObserveTarget) -> Void = { _ in }

    @State private var rowWidth: CGFloat = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            if message.isOperator {
                Spacer(minLength: 54)
            }

            VStack(alignment: message.isOperator ? .trailing : .leading, spacing: 5) {
                if showsHeader {
                    HStack(spacing: 8) {
                        Text(message.actorName.uppercased())
                            .font(HUDType.mono(9, weight: .bold))
                            .tracking(1.0)
                            .foregroundStyle(message.isOperator ? HUDChrome.accent : HUDChrome.inkMuted)
                        Text(formatShortTime(message.createdAt))
                            .font(HUDType.mono(9))
                            .foregroundStyle(HUDChrome.inkFaint)
                        if let observeTarget {
                            Button {
                                onObserve(observeTarget)
                            } label: {
                                Image(systemName: "eye")
                                    .font(.system(size: 9, weight: .semibold))
                                    .frame(width: 18, height: 18)
                            }
                            .buttonStyle(CommsTinyIconButtonStyle())
                            .help("Observe \(observeTarget.title)")
                        }
                    }
                }

                CommsMessageMarkup(text: message.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(message.isOperator ? HUDChrome.accentWhisper : HUDChrome.canvasAlt)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(message.isOperator ? HUDChrome.accentSoft : HUDChrome.borderSoft, lineWidth: 1)
                    )
            }
            .frame(maxWidth: bubbleMaxWidth, alignment: message.isOperator ? .trailing : .leading)

            if !message.isOperator {
                Spacer(minLength: 54)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.isOperator ? .trailing : .leading)
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: CommsMessageRowWidthKey.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(CommsMessageRowWidthKey.self) { width in
            rowWidth = width
        }
    }

    private var bubbleMaxWidth: CGFloat {
        guard rowWidth > 0 else { return 560 }
        let readableWidth = max(560, (rowWidth - 108) * 0.78)
        return min(920, readableWidth)
    }
}

private struct CommsMessageRowWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct CommsChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(HUDType.mono(9, weight: .bold))
            .tracking(0.8)
            .foregroundStyle(HUDChrome.inkMuted)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(HUDChrome.canvasLift)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 1)
            )
    }
}

private struct CommsMemberStrip: View {
    let item: CommsItem

    private var names: [String] { item.participantDisplayNames }

    var body: some View {
        HStack(spacing: 7) {
            HStack(spacing: -5) {
                ForEach(Array(names.prefix(4).enumerated()), id: \.offset) { index, name in
                    CommsMemberAvatar(name: name, index: index)
                }
                if names.count > 4 {
                    Text("+\(names.count - 4)")
                        .font(HUDType.mono(8, weight: .bold))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .frame(width: 20, height: 20)
                        .background(
                            Circle()
                                .fill(HUDChrome.canvasLift)
                        )
                        .overlay(
                            Circle()
                                .stroke(HUDChrome.border, lineWidth: 1)
                        )
                }
            }

            Text(names.joined(separator: " + "))
                .font(HUDType.body(11, weight: .medium))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 280, alignment: .leading)
        }
        .padding(.leading, 3)
        .padding(.trailing, 8)
        .frame(height: 22)
        .background(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(HUDChrome.canvasLift)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .stroke(HUDChrome.border, lineWidth: 1)
        )
        .help("\(names.count) member\(names.count == 1 ? "" : "s"): \(names.joined(separator: ", "))")
    }
}

private struct CommsMemberAvatar: View {
    let name: String
    let index: Int

    var body: some View {
        Text(initial)
            .font(HUDType.mono(8, weight: .bold))
            .foregroundStyle(HUDChrome.canvas)
            .frame(width: 20, height: 20)
            .background(
                Circle()
                    .fill(color)
            )
            .overlay(
                Circle()
                    .stroke(HUDChrome.canvasLift, lineWidth: 1.5)
            )
            .zIndex(Double(8 - index))
    }

    private var initial: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
    }

    private var color: Color {
        if name.lowercased() == "operator" {
            return HUDChrome.accent
        }
        return HUDChrome.agentHue(Double(stableHueSeed(for: name)), lightness: 0.78, saturation: 0.58)
    }

    private func stableHueSeed(for text: String) -> Int {
        var hash: UInt64 = 5381
        for byte in text.lowercased().utf8 {
            hash = (hash &* 33) &+ UInt64(byte)
        }
        return Int(hash % 360)
    }
}

private extension CommsItem {
    var participantDisplayNames: [String] {
        if scope == .private {
            let peer = agentName?.nilIfEmpty
                ?? participantIds.first(where: { displayName(for: $0) != "Operator" }).map(displayName(for:))
                ?? displayTitle
            return uniqueMemberNames(["Operator", peer])
        }

        var names: [String] = []
        for participant in participantIds {
            let name = displayName(for: participant)
            if !names.contains(name) {
                names.append(name)
            }
        }

        if names.isEmpty {
            names.append(displayTitle)
        }

        return uniqueMemberNames(names)
    }

    private func displayName(for participant: String) -> String {
        let trimmed = participant.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Unknown" }
        if trimmed == "operator" { return "Operator" }
        if trimmed == agentId, let agentName = agentName?.nilIfEmpty { return agentName }
        if let agentName = agentName?.nilIfEmpty,
           trimmed.lowercased().contains(agentName.lowercased()) {
            return agentName
        }

        let withoutHandle = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let compact = withoutHandle.split(separator: ".").first.map(String.init) ?? withoutHandle
        return compact
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { part in
                guard let first = part.first else { return "" }
                return first.uppercased() + part.dropFirst()
            }
            .joined(separator: " ")
    }

    private func uniqueMemberNames(_ names: [String]) -> [String] {
        var result: [String] = []
        for name in names {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if !result.contains(where: { $0.caseInsensitiveCompare(trimmed) == .orderedSame }) {
                result.append(trimmed)
            }
        }
        return result
    }
}

private struct CommsIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.inkMuted)
            .frame(width: 28, height: 28)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(configuration.isPressed ? HUDChrome.canvasLift : HUDChrome.canvas)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 1)
            )
    }
}

private struct CommsTinyIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(configuration.isPressed ? HUDChrome.accent : HUDChrome.inkFaint)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(configuration.isPressed ? HUDChrome.canvasLift : HUDChrome.canvasAlt)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .stroke(HUDChrome.borderSoft, lineWidth: 1)
            )
    }
}

private struct CommsSendButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.canvas)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(configuration.isPressed ? HUDChrome.accentDim : HUDChrome.accent)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

private struct CommsCommand: Identifiable {
    let id: String
    let title: String
    let hint: String
    let systemImage: String
    let keywords: [String]
    let run: () -> Void
}

private struct CommsObserveTarget: Identifiable, Equatable {
    let agentId: String
    let title: String

    var id: String { agentId }

    var url: URL {
        HudFleetService.webBaseURL()
            .appending(path: "embed")
            .appending(path: "observe")
            .appending(path: agentId)
    }
}

private struct CommsObserveSidecarView: View {
    let target: CommsObserveTarget
    let onClose: () -> Void
    let onReady: () -> Void

    @State private var reloadToken = UUID()
    @State private var isReady = false

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .hudWindow, cornerRadius: 8)
            HUDChrome.canvas
            HUDPaperGrain(opacity: 0.03)

            VStack(spacing: 0) {
                header
                HUDHairline()
                CommsObserveWebView(
                    url: target.url,
                    reloadToken: reloadToken,
                    onReady: handleReady
                )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(HUDChrome.canvas)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(isReady ? 1 : 0.001)

            if !isReady {
                CommsObserveMaterializingView()
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .trailing) {
            if isReady {
                CommsObserveResizeHandle()
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.easeOut(duration: 0.12), value: isReady)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(HUDChrome.borderRim, lineWidth: 1)
                .allowsHitTesting(false)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "eye")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(HUDChrome.accent)
                    .frame(width: 26, height: 26)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(HUDChrome.accentWhisper)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(HUDChrome.accentSoft, lineWidth: 1)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text("OBSERVE")
                        .font(HUDType.mono(10, weight: .bold))
                        .tracking(HUDType.eyebrowTracking)
                        .foregroundStyle(HUDChrome.inkMuted)
                    Text(target.title)
                        .font(HUDType.body(13, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .overlay {
                CommsObserveFamilyDragCapture()
            }

            Button {
                isReady = false
                reloadToken = UUID()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Reload observe")

            Button(action: onClose) {
                Image(systemName: "sidebar.right")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Close observe")
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
        .background(HUDChrome.canvasAlt)
    }

    private func handleReady() {
        guard !isReady else { return }
        isReady = true
        onReady()
    }

}

private struct CommsObserveFamilyDragCapture: NSViewRepresentable {
    func makeNSView(context: Context) -> CommsObserveFamilyDragCaptureView {
        CommsObserveFamilyDragCaptureView()
    }

    func updateNSView(_ nsView: CommsObserveFamilyDragCaptureView, context: Context) {}
}

@MainActor
private final class CommsObserveFamilyDragCaptureView: NSView {
    private var dragStartMouseLocation = NSPoint.zero

    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        dragStartMouseLocation = NSEvent.mouseLocation
        CommsWindowController.shared.beginFamilyDrag()
    }

    override func mouseDragged(with event: NSEvent) {
        let current = NSEvent.mouseLocation
        CommsWindowController.shared.dragFamily(
            screenTranslation: CGSize(
                width: current.x - dragStartMouseLocation.x,
                height: current.y - dragStartMouseLocation.y
            )
        )
    }

    override func mouseUp(with event: NSEvent) {
        CommsWindowController.shared.endFamilyDrag()
    }
}

private struct CommsObserveResizeHandle: View {
    @State private var isHovering = false

    var body: some View {
        ZStack(alignment: .trailing) {
            CommsObserveResizeCapture(isHovering: $isHovering)
                .frame(width: 34)

            Capsule(style: .continuous)
                .fill(isHovering ? HUDChrome.accentSoft : HUDChrome.borderSoft)
                .frame(width: isHovering ? 3 : 2, height: isHovering ? 64 : 42)
                .padding(.trailing, 5)
                .opacity(isHovering ? 0.95 : 0.42)
                .allowsHitTesting(false)
        }
        .frame(width: 34)
        .help("Resize observe")
    }
}

private struct CommsObserveResizeCapture: NSViewRepresentable {
    @Binding var isHovering: Bool

    func makeNSView(context: Context) -> CommsObserveResizeCaptureView {
        let view = CommsObserveResizeCaptureView()
        view.onHover = { hovering in
            isHovering = hovering
        }
        return view
    }

    func updateNSView(_ nsView: CommsObserveResizeCaptureView, context: Context) {
        nsView.onHover = { hovering in
            isHovering = hovering
        }
    }
}

@MainActor
private final class CommsObserveResizeCaptureView: NSView {
    var onHover: ((Bool) -> Void)?
    private var trackingAreaRef: NSTrackingArea?
    private var dragTranslation: CGFloat = 0

    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingAreaRef {
            removeTrackingArea(trackingAreaRef)
        }
        let trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        trackingAreaRef = trackingArea
        addTrackingArea(trackingArea)
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .resizeLeftRight)
    }

    override func mouseEntered(with event: NSEvent) {
        onHover?(true)
        NSCursor.resizeLeftRight.set()
    }

    override func mouseExited(with event: NSEvent) {
        onHover?(false)
        NSCursor.arrow.set()
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        dragTranslation = 0
        CommsWindowController.shared.beginObserveResize()
        onHover?(true)
        NSCursor.resizeLeftRight.set()
    }

    override func mouseDragged(with event: NSEvent) {
        dragTranslation += event.deltaX
        CommsWindowController.shared.resizeObserveWindow(translationWidth: dragTranslation)
    }

    override func mouseUp(with event: NSEvent) {
        CommsWindowController.shared.endObserveResize()
        dragTranslation = 0
        onHover?(bounds.contains(convert(event.locationInWindow, from: nil)))
        NSCursor.resizeLeftRight.set()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.invalidateCursorRects(for: self)
    }

    deinit {
        NSCursor.arrow.set()
    }
}

private struct CommsObserveMaterializingView: View {
    var body: some View {
        TimelineView(.animation) { context in
            let phase = context.date.timeIntervalSinceReferenceDate
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(HUDChrome.accentWhisper)
                        .frame(width: 38, height: 38)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(HUDChrome.accentSoft, lineWidth: 1)
                        )

                    Image(systemName: "eye.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(HUDChrome.accent)
                        .opacity(0.72 + 0.18 * sin(phase * 8.0))
                }

                PixelDither(phase: phase)
                    .frame(width: 34, height: 22)

                Text("OBSERVE")
                    .font(HUDType.mono(8, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HUDChrome.canvas.opacity(0.96))
        }
    }
}

private struct PixelDither: View {
    let phase: TimeInterval

    var body: some View {
        Grid(horizontalSpacing: 3, verticalSpacing: 3) {
            ForEach(0..<3, id: \.self) { row in
                GridRow {
                    ForEach(0..<5, id: \.self) { column in
                        let offset = Double(row * 5 + column)
                        Rectangle()
                            .fill(HUDChrome.accent)
                            .frame(width: 4, height: 4)
                            .opacity(0.18 + 0.72 * pulse(offset))
                    }
                }
            }
        }
    }

    private func pulse(_ offset: Double) -> Double {
        let wave = sin(phase * 7.0 - offset * 0.55)
        return max(0.0, min(1.0, (wave + 1.0) / 2.0))
    }
}

private struct CommsObserveWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    let onReady: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onReady: onReady)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentURL != url || context.coordinator.reloadToken != reloadToken else {
            return
        }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        context.coordinator.readyURL = nil
        context.coordinator.navigationStartedAt = Date()
        context.coordinator.navigationToken = UUID()
        webView.load(URLRequest(url: url))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let minimumLoaderDwell: TimeInterval = 0.42
        private let maximumRenderWait: TimeInterval = 2.0
        private let renderPollInterval: TimeInterval = 0.05

        let onReady: () -> Void
        var currentURL: URL?
        var reloadToken: UUID?
        var readyURL: URL?
        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()

        init(onReady: @escaping () -> Void) {
            self.onReady = onReady
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForObserveRender(in: webView, url: currentURL, token: navigationToken)
        }

        private func waitForObserveRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            let script = """
            (() => {
              const title = document.querySelector('.s-observe-embed-empty-title')?.textContent || '';
              const resolving = title.includes('Resolving');
              const timeline = Boolean(document.querySelector('.s-observe-stream'));
              const terminal = Boolean(document.querySelector('.s-observe-embed-empty')) && !resolving;
              const bodyText = document.body?.innerText || '';
              return {
                ready: (timeline || terminal) && !resolving,
                hasText: bodyText.trim().length > 0
              };
            })()
            """

            webView.evaluateJavaScript(script) { result, _ in
                DispatchQueue.main.async {
                    guard token == self.navigationToken, self.readyURL != url else { return }
                    let elapsed = Date().timeIntervalSince(self.navigationStartedAt)
                    let payload = result as? [String: Any]
                    let rendered = payload?["ready"] as? Bool ?? false
                    let hasText = payload?["hasText"] as? Bool ?? false
                    let canReveal = rendered && hasText && elapsed >= self.minimumLoaderDwell
                    if canReveal || elapsed >= self.maximumRenderWait {
                        self.markReady(url)
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + self.renderPollInterval) {
                        self.waitForObserveRender(in: webView, url: url, token: token)
                    }
                }
            }
        }

        private func markReady(_ url: URL) {
            guard readyURL != url else { return }
            readyURL = url
            // Give React/WebKit one final paint beat after the DOM says the
            // observe surface exists, so the sidecar expands with content in it.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.onReady()
            }
        }
    }
}

private struct CommsPillButtonStyle: ButtonStyle {
    let isActive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isActive ? HUDChrome.canvas : HUDChrome.inkMuted)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isActive ? HUDChrome.accent : HUDChrome.canvasLift)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(isActive ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private func formatShortTime(_ timestamp: TimeInterval) -> String {
    let seconds = timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
    let date = Date(timeIntervalSince1970: seconds)
    if Calendar.current.isDateInToday(date) {
        return SelfTimeFormatter.time.string(from: date)
    }
    return SelfTimeFormatter.date.string(from: date)
}

private enum SelfTimeFormatter {
    static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    static let date: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }()
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
