import HudsonUI
import SwiftUI
import WebKit

private enum ScoutObserveSidecarPhase: Equatable {
    case materializing
    case snapping
    case expanding
    case revealed
}

enum ScoutObserveSidecarMetrics {
    static let peekWidth: CGFloat = 86
    static let expandedWidth: CGFloat = 430
    static let snapDuration: TimeInterval = 0.08
    static let expandDuration: TimeInterval = 0.18
    static let revealDuration: TimeInterval = 0.12
}

struct ScoutObserveSidecarPanel: View {
    let agent: ScoutAgent
    let stagingWidth: CGFloat
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
            return ScoutObserveSidecarMetrics.expandedWidth
        }
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
        .animation(.interpolatingSpring(stiffness: 320, damping: 30), value: panelWidth)
        .animation(.easeOut(duration: 0.10), value: phase)
        .onChange(of: agent.id) { _, _ in
            restart()
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            if panelWidth <= 120 {
                Image(systemName: phase == .snapping ? "eye.circle.fill" : "eye.fill")
                    .font(HudFont.ui(13, weight: .semibold))
                    .foregroundStyle(HudPalette.accent)
                    .frame(maxWidth: .infinity)
                    .help("Observe")
            } else {
                Image(systemName: "eye")
                    .font(HudFont.ui(12, weight: .semibold))
                    .foregroundStyle(HudPalette.accent)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(HudPalette.accentSoft))

                VStack(alignment: .leading, spacing: 2) {
                    HudSectionLabel("Observe")
                    Text(agent.displayName)
                        .font(HudFont.ui(13, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 0)

                HudButton("Open Web", icon: "safari", style: .ghost, action: onOpenWeb)
                Button(action: reload) {
                    Image(systemName: "arrow.clockwise")
                        .font(HudFont.ui(11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(HudPalette.muted)
                .help("Reload observe")

                Button(action: onClose) {
                    Image(systemName: "sidebar.right")
                        .font(HudFont.ui(12, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(HudPalette.muted)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
                .help("Close observe")
            }
        }
        .padding(.horizontal, panelWidth > 120 ? HudSpacing.lg : HudSpacing.sm)
        .frame(height: HudLayout.navHeight)
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

                VStack(spacing: 12) {
                    ZStack {
                        ForEach(0..<3, id: \.self) { index in
                            let wave = ringWave(tick, index: index)
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(HudPalette.accent.opacity((isSnapping ? 0.34 : 0.22) * (1.0 - wave)), lineWidth: 1)
                                .frame(width: 40 + 18 * wave, height: 40 + 18 * wave)
                        }

                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(isSnapping ? HudPalette.accentSoft : HudPalette.accent.opacity(0.08))
                            .frame(width: 38, height: 38)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(isSnapping ? HudPalette.accent : HudPalette.accent.opacity(0.25), lineWidth: 1)
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

                    VStack(spacing: 4) {
                        Text("OBSERVE")
                            .font(HudFont.mono(8, weight: .bold))
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
        Grid(horizontalSpacing: 3, verticalSpacing: 3) {
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
        webView.load(URLRequest(url: url))
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
