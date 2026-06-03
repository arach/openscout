import HudsonUI
import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif

private enum ScoutObserveSidecarPhase: Equatable {
    case materializing
    case snapping
    case expanding
    case revealed
}

enum ScoutObserveSidecarMetrics {
    static let peekWidth: CGFloat = 86
    static let expandedWidth: CGFloat = 430
    static let defaultWidth: CGFloat = expandedWidth
    static let widthRange: ClosedRange<CGFloat> = 340...780
    static let resizeHandleWidth: CGFloat = 28
    static let snapDuration: TimeInterval = 0.08
    static let expandDuration: TimeInterval = 0.18
    static let revealDuration: TimeInterval = 0.12
}

struct ScoutObserveSidecarPanel: View {
    let agent: ScoutAgent
    let stagingWidth: CGFloat
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let onClose: () -> Void
    let onOpenWeb: () -> Void

    @State private var phase: ScoutObserveSidecarPhase = .materializing
    @State private var reloadToken = UUID()
    @State private var revealToken = UUID()

    private var isRevealed: Bool {
        phase == .revealed
    }

    private var normalizedStagingWidth: CGFloat {
        min(
            ScoutObserveSidecarMetrics.expandedWidth,
            max(ScoutObserveSidecarMetrics.peekWidth, stagingWidth)
        )
    }

    private var panelWidth: CGFloat {
        switch phase {
        case .materializing, .snapping:
            return normalizedStagingWidth
        case .expanding, .revealed:
            return resolvedWidth
        }
    }

    private var resolvedWidth: CGFloat {
        let range = ScoutObserveSidecarMetrics.widthRange
        return min(max(previewWidth ?? width, range.lowerBound), range.upperBound)
    }

    private var observeURL: URL {
        ScoutWeb.baseURL()
            .appending(path: "embed")
            .appending(path: "observe")
            .appending(path: agent.id)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)

            ZStack {
                ScoutObserveEmbedWebView(
                    url: observeURL,
                    reloadToken: reloadToken,
                    onReady: handleReady
                )
                .opacity(isRevealed ? 1 : 0.001)
                .allowsHitTesting(isRevealed)
                .background(ScoutDesign.bg)

                if !isRevealed {
                    ScoutObserveSidecarMaterializingView(phase: phase)
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: panelWidth)
        .frame(maxHeight: .infinity)
        .clipped()
        .background(ScoutDesign.chrome)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(ScoutDesign.hairlineStrong)
                .frame(width: HudStrokeWidth.thin)
        }
        .overlay(alignment: .leading) {
            if isRevealed {
                ScoutObserveSidecarResizeHandle(
                    width: $width,
                    previewWidth: $previewWidth,
                    range: ScoutObserveSidecarMetrics.widthRange
                )
                .frame(width: ScoutObserveSidecarMetrics.resizeHandleWidth)
                .offset(x: -8)
                .transition(.opacity)
            }
        }
        .animation(previewWidth == nil ? .interpolatingSpring(stiffness: 320, damping: 30) : nil, value: panelWidth)
        .animation(.easeOut(duration: 0.10), value: phase)
        .onChange(of: agent.id) { _, _ in
            restart()
        }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: panelWidth > 120 ? HudSpacing.lg : HudSpacing.sm) {
            if panelWidth <= 120 {
                Image(systemName: phase == .snapping ? "eye.circle.fill" : "eye.fill")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(HudPalette.accent)
                    .frame(maxWidth: .infinity)
                    .help("Observe")
            } else {
                HStack(spacing: HudSpacing.md) {
                    Image(systemName: "eye")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(HudPalette.accent)
                        .frame(width: 22, height: 22)
                        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudPalette.accentSoft))
                    HudSectionLabel("Observe")
                }
            }
        } secondary: {
            if panelWidth > 120 {
                Text(agent.displayName)
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        } trailing: {
            if panelWidth > 120 {
                HStack(spacing: HudSpacing.md) {
                HudButton("Open Web", icon: "safari", style: .ghost, action: onOpenWeb)
                Button(action: reload) {
                    Image(systemName: "arrow.clockwise")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .foregroundStyle(HudPalette.muted)
                .help("Reload observe")

                Button(action: onClose) {
                    Image(systemName: "sidebar.right")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .foregroundStyle(HudPalette.muted)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
                .help("Close observe")
                }
            }
        }
        .background(ScoutDesign.chrome)
    }

    private func handleReady() {
        guard phase == .materializing else { return }
        let token = UUID()
        revealToken = token
        withAnimation(.easeInOut(duration: ScoutObserveSidecarMetrics.snapDuration)) {
            phase = .snapping
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + ScoutObserveSidecarMetrics.snapDuration) {
            guard revealToken == token else { return }
            withAnimation(.interpolatingSpring(stiffness: 320, damping: 30)) {
                phase = .expanding
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + ScoutObserveSidecarMetrics.expandDuration) {
                guard revealToken == token else { return }
                withAnimation(.easeOut(duration: ScoutObserveSidecarMetrics.revealDuration)) {
                    phase = .revealed
                }
            }
        }
    }

    private func reload() {
        restart()
        reloadToken = UUID()
    }

    private func restart() {
        revealToken = UUID()
        withAnimation(.easeOut(duration: 0.06)) {
            phase = .materializing
        }
    }
}

private struct ScoutObserveSidecarMaterializingView: View {
    let phase: ScoutObserveSidecarPhase

    private var isSnapping: Bool {
        phase == .snapping || phase == .expanding
    }

    var body: some View {
        TimelineView(.animation) { context in
            let tick = context.date.timeIntervalSinceReferenceDate

            ZStack {
                ScoutDesign.bg.opacity(0.96)

                GeometryReader { proxy in
                    let width = max(proxy.size.width, 1)
                    let sweep = CGFloat((tick * 0.66).truncatingRemainder(dividingBy: 1.0)) * (width + 96) - 72
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    HudPalette.accent.opacity(isSnapping ? 0.18 : 0.10),
                                    Color.clear
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: isSnapping ? 52 : 38)
                        .rotationEffect(.degrees(12))
                        .offset(x: sweep)
                        .blendMode(.screen)
                }
                .allowsHitTesting(false)

                VStack(spacing: HudSpacing.xl) {
                    ZStack {
                        ForEach(0..<3, id: \.self) { index in
                            let wave = ringWave(tick, index: index)
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(HudPalette.accent.opacity((isSnapping ? 0.34 : 0.22) * (1.0 - wave)), lineWidth: HudStrokeWidth.standard)
                                .frame(width: 40 + 18 * wave, height: 40 + 18 * wave)
                        }

                        RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                            .fill(isSnapping ? HudPalette.accentSoft : HudPalette.accent.opacity(0.08))
                            .frame(width: 38, height: 38)
                            .overlay(
                                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                                    .stroke(isSnapping ? HudPalette.accent : HudPalette.accent.opacity(0.25), lineWidth: HudStrokeWidth.standard)
                            )
                            .shadow(color: HudPalette.accent.opacity(isSnapping ? 0.24 : 0.12), radius: isSnapping ? 18 : 10)

                        Image(systemName: isSnapping ? "eye.circle.fill" : "eye.fill")
                            .font(HudFont.ui(isSnapping ? 17 : 15, weight: .semibold))
                            .foregroundStyle(HudPalette.accent)
                            .opacity(0.78 + 0.18 * sin(tick * 8.0))
                            .scaleEffect(isSnapping ? 1.04 : 1)
                    }
                    .frame(width: 70, height: 62)

                    PixelDither(phase: tick, isSnapping: isSnapping)
                        .frame(width: 34, height: 22)

                    VStack(spacing: HudSpacing.xs) {
                        Text("OBSERVE")
                            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                            .tracking(1.2)
                            .foregroundStyle(isSnapping ? HudPalette.accent : HudPalette.dim)
                        Text(isSnapping ? "READY" : "MATERIALIZING")
                            .font(HudFont.mono(7, weight: .semibold))
                            .tracking(0.9)
                            .foregroundStyle(HudPalette.dim.opacity(0.78))
                    }
                }
                .scaleEffect(isSnapping ? 1.035 : 1)
                .animation(.interpolatingSpring(stiffness: 260, damping: 22), value: isSnapping)
            }
        }
    }

    private func ringWave(_ tick: TimeInterval, index: Int) -> Double {
        let raw = (tick * 0.82 + Double(index) * 0.33).truncatingRemainder(dividingBy: 1.0)
        return raw < 0 ? raw + 1 : raw
    }
}

private struct PixelDither: View {
    let phase: TimeInterval
    let isSnapping: Bool

    var body: some View {
        Grid(horizontalSpacing: HudSpacing.xs, verticalSpacing: HudSpacing.xs) {
            ForEach(0..<3, id: \.self) { row in
                GridRow {
                    ForEach(0..<5, id: \.self) { column in
                        let offset = Double(row * 5 + column)
                        Rectangle()
                            .fill(HudPalette.accent)
                            .frame(width: isSnapping ? 5 : 4, height: isSnapping ? 5 : 4)
                            .opacity((isSnapping ? 0.38 : 0.18) + (isSnapping ? 0.58 : 0.72) * pulse(offset))
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

#if os(macOS)
private struct ScoutObserveSidecarResizeHandle: NSViewRepresentable {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    func makeNSView(context: Context) -> ResizeHandleView {
        let view = ResizeHandleView()
        configure(view)
        return view
    }

    func updateNSView(_ view: ResizeHandleView, context: Context) {
        configure(view)
    }

    private func configure(_ view: ResizeHandleView) {
        view.range = range
        view.getWidth = { width }
        view.setPreviewWidth = { previewWidth = $0 }
        view.commitWidth = { width = $0 }
        view.clearPreview = { previewWidth = nil }
    }

    final class ResizeHandleView: NSView {
        var range: ClosedRange<CGFloat> = ScoutObserveSidecarMetrics.widthRange
        var getWidth: () -> CGFloat = { ScoutObserveSidecarMetrics.defaultWidth }
        var setPreviewWidth: (CGFloat) -> Void = { _ in }
        var commitWidth: (CGFloat) -> Void = { _ in }
        var clearPreview: () -> Void = {}

        private var trackingAreaRef: NSTrackingArea?
        private var startX: CGFloat = 0
        private var startWidth: CGFloat = ScoutObserveSidecarMetrics.defaultWidth
        private var isHovering = false
        private var isActive = false

        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        override var acceptsFirstResponder: Bool { true }
        override var mouseDownCanMoveWindow: Bool { false }
        override var intrinsicContentSize: NSSize {
            NSSize(width: ScoutObserveSidecarMetrics.resizeHandleWidth, height: NSView.noIntrinsicMetric)
        }

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
            addCursorRect(bounds, cursor: .resizeLeftRight)
        }

        override func mouseEntered(with event: NSEvent) {
            isHovering = true
            NSCursor.resizeLeftRight.set()
            needsDisplay = true
        }

        override func mouseExited(with event: NSEvent) {
            isHovering = false
            if !isActive {
                NSCursor.arrow.set()
            }
            needsDisplay = true
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(self)
            startX = event.locationInWindow.x
            startWidth = getWidth()
            isActive = true
            isHovering = true
            setPreviewWidth(startWidth)
            NSCursor.resizeLeftRight.set()
            needsDisplay = true
        }

        override func mouseDragged(with event: NSEvent) {
            let delta = startX - event.locationInWindow.x
            setPreviewWidth(clamp(startWidth + delta))
            NSCursor.resizeLeftRight.set()
        }

        override func mouseUp(with event: NSEvent) {
            let delta = startX - event.locationInWindow.x
            commitWidth(clamp(startWidth + delta))
            clearPreview()
            isActive = false
            isHovering = bounds.contains(convert(event.locationInWindow, from: nil))
            if isHovering {
                NSCursor.resizeLeftRight.set()
            } else {
                NSCursor.arrow.set()
            }
            needsDisplay = true
        }

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)

            if isActive || isHovering {
                NSColor.white.withAlphaComponent(isActive ? 0.035 : 0.018).setFill()
                bounds.fill()
            }

            let handleWidth: CGFloat = isActive || isHovering ? 3 : 2
            let handleHeight: CGFloat = isActive || isHovering ? 52 : 34
            let rect = NSRect(
                x: floor((bounds.width - handleWidth) / 2),
                y: floor((bounds.height - handleHeight) / 2),
                width: handleWidth,
                height: handleHeight
            )
            let path = NSBezierPath(roundedRect: rect, xRadius: handleWidth / 2, yRadius: handleWidth / 2)
            (isActive || isHovering
                ? NSColor.systemGreen.withAlphaComponent(0.30)
                : NSColor.white.withAlphaComponent(0.13)
            ).setFill()
            path.fill()
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window?.invalidateCursorRects(for: self)
        }

        deinit {
            NSCursor.arrow.set()
        }

        private func clamp(_ value: CGFloat) -> CGFloat {
            min(max(value, range.lowerBound), range.upperBound)
        }
    }
}
#else
private struct ScoutObserveSidecarResizeHandle: View {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    var body: some View {
        HudResizableDivider(width: $width, placement: .trailing, range: range, hitWidth: ScoutObserveSidecarMetrics.resizeHandleWidth)
            .onChange(of: width) { _, _ in previewWidth = nil }
    }
}
#endif

private struct ScoutObserveEmbedWebView: NSViewRepresentable {
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
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
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
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let minimumLoaderDwell: TimeInterval = 0.24
        private let maximumRenderWait: TimeInterval = 1.25
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
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
                self.onReady()
            }
        }
    }
}
