import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

private enum ScoutWebEmbedMetrics {
    static let pageGutter: CGFloat = 20
}

func scoutEmbedURL(
    surface: ScoutEmbedSurfaceId,
    colorScheme: ColorScheme,
    embed: String = "app",
    extraQueryItems: [URLQueryItem] = [],
    cacheBuster: String? = nil
) -> URL {
    let descriptor = surface.descriptor
    let override = [descriptor.envOverrideKey, descriptor.legacyEnvOverrideKey]
        .compactMap { $0 }
        .compactMap { ProcessInfo.processInfo.environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .first
        .flatMap(URL.init(string:))

    let base = override
        ?? ScoutWeb.url(path: descriptor.embedPath)
        ?? ScoutWeb.baseURL().appending(path: descriptor.embedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))

    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
        return base
    }

    var items = components.queryItems ?? []
    for item in ScoutEmbedTheme.queryItems(for: colorScheme) where !items.contains(where: { $0.name == item.name }) {
        items.append(item)
    }
    if !items.contains(where: { $0.name == "embed" }) {
        items.append(URLQueryItem(name: "embed", value: embed))
    }
    if !items.contains(where: { $0.name == "profile" }) {
        items.append(URLQueryItem(name: "profile", value: descriptor.profile))
    }
    for item in extraQueryItems where !items.contains(where: { $0.name == item.name }) {
        items.append(item)
    }
    if let cacheBuster, !cacheBuster.isEmpty {
        items.removeAll { $0.name == "_cb" }
        items.append(URLQueryItem(name: "_cb", value: cacheBuster))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum ScoutWebEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

/// Generic chrome-free web surface host for screens that self-declare embeddability on web.
struct ScoutWebEmbedContent<AdditionalTrailing: View>: View {
    let surface: ScoutEmbedSurfaceId
    var subtitle: String?
    var extraQueryItems: [URLQueryItem] = []
    var loadingLaneSize: ScoutAgentLaneSize?
    @ViewBuilder var additionalTrailing: () -> AdditionalTrailing

    @Environment(\.colorScheme) private var colorScheme
    @State private var reloadToken = UUID()

    init(
        surface: ScoutEmbedSurfaceId,
        subtitle: String? = nil,
        extraQueryItems: [URLQueryItem] = [],
        loadingLaneSize: ScoutAgentLaneSize? = nil,
        @ViewBuilder additionalTrailing: @escaping () -> AdditionalTrailing = { EmptyView() }
    ) {
        self.surface = surface
        self.subtitle = subtitle
        self.extraQueryItems = extraQueryItems
        self.loadingLaneSize = loadingLaneSize
        self.additionalTrailing = additionalTrailing
    }

    private var url: URL {
        scoutEmbedURL(
            surface: surface,
            colorScheme: colorScheme,
            extraQueryItems: extraQueryItems,
            cacheBuster: reloadToken.uuidString
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutWebEmbedHost(
                surface: surface,
                url: url,
                reloadToken: reloadToken,
                loadingLaneSize: loadingLaneSize
            )
        }
        .background(ScoutDesign.bg)
        .onChange(of: colorScheme) { _, _ in
            reloadToken = UUID()
        }
        .onChange(of: loadingLaneSize) { _, _ in
            reloadToken = UUID()
        }
        .onChange(of: embedQueryFingerprint) { _, _ in
            reloadToken = UUID()
        }
    }

    private var embedQueryFingerprint: String {
        extraQueryItems
            .map { "\($0.name)=\($0.value ?? "")" }
            .joined(separator: "&")
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutWebEmbedMetrics.pageGutter) {
            Text(surface.title)
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text(subtitle ?? "web embed · \(surface.embedPath)")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                additionalTrailing()
                ScoutWebEmbedHeaderDivider()
                ScoutWebEmbedTextButton(title: "Reload", icon: "arrow.clockwise") {
                    reloadToken = UUID()
                }
                ScoutWebEmbedTextButton(title: "Open in browser", icon: "safari") {
                    ScoutWeb.open(path: surface.shellPath)
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

struct ScoutWebEmbedHost: View {
    let surface: ScoutEmbedSurfaceId
    let url: URL
    let reloadToken: UUID
    var loadingLaneSize: ScoutAgentLaneSize?

    @State private var phase: ScoutWebEmbedLoadPhase = .loading

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutWebEmbedWebView(surface: surface, url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    loadingPlaceholder
                case .failed(let message):
                    ScoutWebEmbedErrorView(surface: surface, url: url, message: message)
                case .ready:
                    EmptyView()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
        .animation(.easeOut(duration: 0.24), value: isReady)
        .onChange(of: url) { _, _ in phase = .loading }
        .onChange(of: reloadToken) { _, _ in phase = .loading }
    }

    @ViewBuilder
    private var loadingPlaceholder: some View {
        switch surface {
        case .lanes:
            ScoutLanesMaterializingView(laneSize: loadingLaneSize ?? .md)
        default:
            ProgressView("Loading \(surface.title)…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct ScoutWebEmbedErrorView: View {
    let surface: ScoutEmbedSurfaceId
    let url: URL
    let message: String

    var body: some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "wifi.exclamationmark")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
            Text("\(surface.title) unavailable")
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            Text(message)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Text(url.absoluteString)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 420)
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if os(macOS)
private struct ScoutWebEmbedWebView: NSViewRepresentable {
    let surface: ScoutEmbedSurfaceId
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutWebEmbedLoadPhase

    func makeCoordinator() -> Coordinator {
        Coordinator(surface: surface, phase: $phase)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        context.coordinator.readyURL = nil
        context.coordinator.navigationStartedAt = Date()
        context.coordinator.navigationToken = UUID()
        phase = .loading
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringCacheData, timeoutInterval: 30))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let surface: ScoutEmbedSurfaceId
        @Binding var phase: ScoutWebEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(surface: ScoutEmbedSurfaceId, phase: Binding<ScoutWebEmbedLoadPhase>) {
            self.surface = surface
            _phase = phase
        }

        private let minimumLoaderDwell: TimeInterval = 0.28
        private let maximumRenderWait: TimeInterval = 5.0
        private let renderPollInterval: TimeInterval = 0.06

        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()
        var readyURL: URL?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForSurfaceRender(in: webView, url: currentURL, token: navigationToken)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
        ) {
            if navigationResponse.isForMainFrame,
               let response = navigationResponse.response as? HTTPURLResponse,
               !(200..<400).contains(response.statusCode) {
                setPhase(.failed(Self.httpMessage(statusCode: response.statusCode)))
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        private func waitForSurfaceRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            let script = Self.renderProbeScript(for: surface)

            webView.evaluateJavaScript(script) { result, _ in
                DispatchQueue.main.async {
                    guard token == self.navigationToken, self.readyURL != url else { return }
                    let elapsed = Date().timeIntervalSince(self.navigationStartedAt)
                    let payload = result as? [String: Any]
                    let ready = payload?["ready"] as? Bool ?? false
                    let viteUnavailable = payload?["viteUnavailable"] as? Bool ?? false

                    if viteUnavailable {
                        self.setPhase(.failed("Web dev server unavailable."))
                        return
                    }

                    if ready && elapsed >= self.minimumLoaderDwell {
                        self.readyURL = url
                        self.setPhase(.ready)
                        return
                    }

                    if elapsed >= self.maximumRenderWait {
                        self.readyURL = url
                        self.setPhase(.ready)
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + self.renderPollInterval) {
                        self.waitForSurfaceRender(in: webView, url: url, token: token)
                    }
                }
            }
        }

        private func setPhase(_ next: ScoutWebEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func httpMessage(statusCode: Int) -> String {
            "HTTP \(statusCode)"
        }

        private static func renderProbeScript(for surface: ScoutEmbedSurfaceId) -> String {
            switch surface {
            case .lanes:
                return """
                (() => {
                  const bar = Boolean(document.querySelector('.s-agent-lanes-bar'));
                  const scroll = Boolean(document.querySelector('.s-agent-lanes-scroll'));
                  const empty = document.querySelector('.s-agent-lanes-empty');
                  const emptyText = empty?.textContent?.trim() || '';
                  const tailLoading = emptyText.includes('Loading tail stream');
                  const lanes = document.querySelectorAll('.s-agent-lane').length;
                  const bodyText = document.body?.innerText || '';
                  const viteUnavailable = bodyText.includes('Vite dev server unavailable');
                  const shellReady = bar && (scroll || empty);
                  const contentReady = shellReady && !tailLoading && (lanes > 0 || Boolean(empty));
                  return {
                    ready: contentReady,
                    viteUnavailable
                  };
                })()
                """
            case .dispatch:
                return """
                (() => {
                  const root = document.querySelector('[data-scout-surface="dispatch"]')
                    || document.querySelector('.sys-broker-page');
                  const bodyText = document.body?.innerText || '';
                  const viteUnavailable = bodyText.includes('Vite dev server unavailable');
                  return {
                    ready: Boolean(root) && bodyText.trim().length > 8,
                    viteUnavailable
                  };
                })()
                """
            }
        }
    }
}
#endif

private struct ScoutWebEmbedHeaderDivider: View {
    var body: some View {
        Rectangle()
            .fill(ScoutDesign.hairline)
            .frame(width: 1, height: 18)
    }
}

private struct ScoutWebEmbedTextButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
    }
}