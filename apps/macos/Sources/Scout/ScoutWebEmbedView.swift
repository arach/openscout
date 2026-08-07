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

struct ScoutEmbeddedUIAction: Decodable, Equatable {
    struct Route: Decodable, Equatable {
        let view: String
        let conversationId: String?
        let channelId: String?
        let agentId: String?
        let selectedAgentId: String?
        let sessionId: String?
        let projectSlug: String?
        let section: String?
        let root: String?
        let file: String?
        let project: String?
        let path: String?
        let wt: String?
        let line: Int?
        let endLine: Int?
        let mode: String?
        let preferredView: String?
        let returnConversationId: String?
    }

    let type: String
    let route: Route?
    let path: String?
    let mode: String?
}

private struct ScoutEmbeddedUIActionEnvelope: Decodable {
    let kind: String
    let action: ScoutEmbeddedUIAction
}

private struct ScoutRealtimeVoiceNativeStateEnvelope: Decodable {
    let kind: String
    let state: String
    let leaseId: String?
}

/// Generic chrome-free web surface host for screens that self-declare embeddability on web.
struct ScoutWebEmbedContent<AdditionalTrailing: View>: View {
    let surface: ScoutEmbedSurfaceId
    var subtitle: String?
    var extraQueryItems: [URLQueryItem] = []
    var loadingLaneSize: ScoutAgentLaneSize?
    var showsHeader: Bool
    var onRealtimeVoiceStateChange: (String, String?) -> Void
    var onNativeUIAction: (ScoutEmbeddedUIAction) -> Void
    var realtimeVoiceStopRequest: UUID?
    @ViewBuilder var additionalTrailing: () -> AdditionalTrailing

    @Environment(\.colorScheme) private var colorScheme
    /// Identity for forced reloads. Not used as a cache-buster on first mount.
    @State private var reloadToken = UUID()
    /// `_cb` query value — nil on first mount so the HTTP cache can serve the page.
    @State private var cacheBuster: String?
    /// When true, the next load uses `.reloadIgnoringCacheData` (explicit Reload / param change).
    @State private var ignoresHTTPCache = false

    init(
        surface: ScoutEmbedSurfaceId,
        subtitle: String? = nil,
        extraQueryItems: [URLQueryItem] = [],
        loadingLaneSize: ScoutAgentLaneSize? = nil,
        showsHeader: Bool = true,
        @ViewBuilder additionalTrailing: @escaping () -> AdditionalTrailing = { EmptyView() },
        onRealtimeVoiceStateChange: @escaping (String, String?) -> Void = { _, _ in },
        onNativeUIAction: @escaping (ScoutEmbeddedUIAction) -> Void = { _ in },
        realtimeVoiceStopRequest: UUID? = nil
    ) {
        self.surface = surface
        self.subtitle = subtitle
        self.extraQueryItems = extraQueryItems
        self.loadingLaneSize = loadingLaneSize
        self.showsHeader = showsHeader
        self.onRealtimeVoiceStateChange = onRealtimeVoiceStateChange
        self.onNativeUIAction = onNativeUIAction
        self.realtimeVoiceStopRequest = realtimeVoiceStopRequest
        self.additionalTrailing = additionalTrailing
    }

    private var url: URL {
        scoutEmbedURL(
            surface: surface,
            colorScheme: colorScheme,
            extraQueryItems: extraQueryItems,
            cacheBuster: cacheBuster
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsHeader {
                header
            }
            ScoutWebEmbedHost(
                surface: surface,
                url: url,
                reloadToken: reloadToken,
                ignoresHTTPCache: ignoresHTTPCache,
                loadingLaneSize: loadingLaneSize,
                onRealtimeVoiceStateChange: onRealtimeVoiceStateChange,
                onNativeUIAction: onNativeUIAction,
                realtimeVoiceStopRequest: realtimeVoiceStopRequest,
                onReload: { scheduleCacheBustingReload(invalidateBaseURL: true) }
            )
        }
        .background {
            ScoutDesign.bg
            if surface == .code {
                // The code surface reads on a recessed well (see code-screen.css).
                // Matching the native backdrop keeps transient unpainted webview
                // strips (panel resizes) invisible instead of window-colored.
                Color.black.opacity(colorScheme == .dark ? 0.26 : 0.035)
            }
        }
        .onChange(of: colorScheme) { _, _ in
            scheduleCacheBustingReload()
        }
        .onChange(of: loadingLaneSize) { _, _ in
            scheduleCacheBustingReload()
        }
        .onChange(of: embedQueryFingerprint) { _, _ in
            scheduleCacheBustingReload()
        }
    }

    /// Explicit Reload and reload-intended param changes attach `_cb` and bypass
    /// the HTTP cache. First mount leaves both unset so protocol caching works.
    private func scheduleCacheBustingReload(invalidateBaseURL: Bool = false) {
        if invalidateBaseURL {
            ScoutWeb.invalidateBaseURLCache()
        }
        let token = UUID()
        reloadToken = token
        cacheBuster = token.uuidString
        ignoresHTTPCache = true
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
            if let subtitle {
                Text(subtitle)
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                additionalTrailing()
                ScoutWebEmbedHeaderDivider()
                ScoutWebEmbedTextButton(title: "Reload", icon: "arrow.clockwise") {
                    scheduleCacheBustingReload(invalidateBaseURL: true)
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
    var ignoresHTTPCache: Bool = false
    var loadingLaneSize: ScoutAgentLaneSize?
    var onRealtimeVoiceStateChange: (String, String?) -> Void = { _, _ in }
    var onNativeUIAction: (ScoutEmbeddedUIAction) -> Void = { _ in }
    var realtimeVoiceStopRequest: UUID?
    var onReload: () -> Void = {}

    @State private var phase: ScoutWebEmbedLoadPhase = .loading

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutWebEmbedWebView(
                surface: surface,
                url: url,
                reloadToken: reloadToken,
                ignoresHTTPCache: ignoresHTTPCache,
                phase: $phase,
                onRealtimeVoiceStateChange: onRealtimeVoiceStateChange,
                onNativeUIAction: onNativeUIAction,
                realtimeVoiceStopRequest: realtimeVoiceStopRequest
            )
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    loadingPlaceholder
                case .failed(let message):
                    ScoutWebEmbedErrorView(surface: surface, message: message, onReload: onReload)
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
        case .thread:
            ScoutThreadMaterializingView()
        default:
            ScoutSurfaceMaterializingView(title: surface.title)
        }
    }
}

/// Fallback loading state for embeds without a content-shaped skeleton. Still
/// a Scout-native indicator rather than the stock `ProgressView` ring, so no
/// surface drops out of the cockpit's visual language mid-load.
private struct ScoutSurfaceMaterializingView: View {
    let title: String

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutBrailleSpinner(size: 12, speed: 0.1)
                .accessibilityHidden(true)
            Text("Opening \(title.lowercased())")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
        .accessibilityElement(children: .combine)
    }
}

private struct ScoutWebEmbedErrorView: View {
    let surface: ScoutEmbedSurfaceId
    let message: String
    var onReload: () -> Void = {}

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
            HudButton("Retry", icon: "arrow.clockwise", style: .secondary, action: onReload)
                .padding(.top, HudSpacing.xs)
            Text("Start Scout services from the menu bar if this keeps happening.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.dim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if os(macOS)
private struct ScoutWebEmbedWebView: NSViewRepresentable {
    private static let nativeUIMessageHandler = "scoutNativeUI"
    private static let realtimeVoiceMessageHandler = "scoutRealtimeVoice"

    let surface: ScoutEmbedSurfaceId
    let url: URL
    let reloadToken: UUID
    let ignoresHTTPCache: Bool
    @Binding var phase: ScoutWebEmbedLoadPhase
    let onRealtimeVoiceStateChange: (String, String?) -> Void
    let onNativeUIAction: (ScoutEmbeddedUIAction) -> Void
    let realtimeVoiceStopRequest: UUID?

    func makeCoordinator() -> Coordinator {
        Coordinator(
            surface: surface,
            phase: $phase,
            onRealtimeVoiceStateChange: onRealtimeVoiceStateChange,
            onNativeUIAction: onNativeUIAction
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        // Dispatch joins these because its inspector links out of the surface —
        // to a conversation, a live trace, a work item. Those destinations are
        // native sections, so the action has to leave the WebView.
        if surface == .thread || surface == .code || surface == .voice || surface == .dispatch {
            configuration.userContentController.add(
                context.coordinator,
                name: Self.nativeUIMessageHandler
            )
        }
        if surface == .voice {
            configuration.userContentController.add(
                context.coordinator,
                name: Self.realtimeVoiceMessageHandler
            )
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onRealtimeVoiceStateChange = onRealtimeVoiceStateChange
        context.coordinator.onNativeUIAction = onNativeUIAction
        context.coordinator.realtimeVoiceStopRequest = realtimeVoiceStopRequest
        context.coordinator.deliverRealtimeVoiceStopRequest(in: webView)
        guard context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        context.coordinator.readyURL = nil
        context.coordinator.navigationStartedAt = Date()
        context.coordinator.navigationToken = UUID()
        phase = .loading
        // First mount uses protocol cache policy; explicit Reload / param-driven
        // reloads pass ignoresHTTPCache so we bypass stale document entries.
        let cachePolicy: URLRequest.CachePolicy = ignoresHTTPCache
            ? .reloadIgnoringCacheData
            : .useProtocolCachePolicy
        webView.load(URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: 30))
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: nativeUIMessageHandler
        )
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: realtimeVoiceMessageHandler
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let surface: ScoutEmbedSurfaceId
        @Binding var phase: ScoutWebEmbedLoadPhase
        var onRealtimeVoiceStateChange: (String, String?) -> Void
        var onNativeUIAction: (ScoutEmbeddedUIAction) -> Void
        var realtimeVoiceStopRequest: UUID?
        var deliveredRealtimeVoiceStopRequest: UUID?
        var currentURL: URL?
        var reloadToken: UUID?

        init(
            surface: ScoutEmbedSurfaceId,
            phase: Binding<ScoutWebEmbedLoadPhase>,
            onRealtimeVoiceStateChange: @escaping (String, String?) -> Void,
            onNativeUIAction: @escaping (ScoutEmbeddedUIAction) -> Void
        ) {
            self.surface = surface
            _phase = phase
            self.onRealtimeVoiceStateChange = onRealtimeVoiceStateChange
            self.onNativeUIAction = onNativeUIAction
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == ScoutWebEmbedWebView.nativeUIMessageHandler
                    || message.name == ScoutWebEmbedWebView.realtimeVoiceMessageHandler
            else { return }
            if let state = message.body as? String,
               ["idle", "connecting", "live", "ended", "error", "minimize", "expand", "restore"].contains(state) {
                onRealtimeVoiceStateChange(state, nil)
                return
            }
            guard JSONSerialization.isValidJSONObject(message.body),
                  let data = try? JSONSerialization.data(withJSONObject: message.body)
            else { return }
            if let stateEnvelope = try? JSONDecoder().decode(
                ScoutRealtimeVoiceNativeStateEnvelope.self,
                from: data
            ), stateEnvelope.kind == "session-state" {
                onRealtimeVoiceStateChange(stateEnvelope.state, stateEnvelope.leaseId)
                return
            }
            if let actionEnvelope = try? JSONDecoder().decode(
                ScoutEmbeddedUIActionEnvelope.self,
                from: data
            ), actionEnvelope.kind == "ui-action" {
                onNativeUIAction(actionEnvelope.action)
            }
        }

        func deliverRealtimeVoiceStopRequest(in webView: WKWebView) {
            guard surface == .voice,
                  readyURL == currentURL,
                  let request = realtimeVoiceStopRequest,
                  deliveredRealtimeVoiceStopRequest != request
            else { return }
            deliveredRealtimeVoiceStopRequest = request
            Task { @MainActor [weak self, weak webView] in
                guard let webView else { return }
                do {
                    let value = try await webView.callAsyncJavaScript(
                        """
                        if (typeof window.__scoutRealtimeVoiceStop === 'function') {
                            const stopped = await window.__scoutRealtimeVoiceStop();
                            return stopped ? 'stopped' : 'failed';
                        }
                        window.__scoutRealtimeVoiceStopRequested = true;
                        window.dispatchEvent(new CustomEvent('scout:realtime-voice-stop'));
                        return 'queued';
                        """,
                        arguments: [:],
                        in: nil,
                        contentWorld: .page
                    )
                    if value as? String == "stopped" {
                        self?.onRealtimeVoiceStateChange("ended", nil)
                    }
                } catch {
                    _ = try? await webView.evaluateJavaScript(
                        "window.__scoutRealtimeVoiceStopRequested = true; "
                        + "window.dispatchEvent(new CustomEvent('scout:realtime-voice-stop'));"
                    )
                }
            }
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

        /// Without a UI delegate answering this, WebKit denies getUserMedia
        /// outright and the live-voice surface could never open a call.
        /// Granted narrowly: microphone only, and only for the local Scout web
        /// origin this view navigated to. Whether the mic is available at all
        /// is still the app's own TCC grant (Settings › Voice › Microphone).
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            guard type == .microphone, let currentURL, Self.origin(origin, matches: currentURL) else {
                decisionHandler(.deny)
                return
            }
            decisionHandler(.grant)
        }

        private static func origin(_ origin: WKSecurityOrigin, matches url: URL) -> Bool {
            guard origin.protocol == url.scheme, origin.host == url.host else { return false }
            let urlPort = url.port ?? (url.scheme == "https" ? 443 : 80)
            return origin.port == 0 || origin.port == urlPort
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        /// A load that never landed (e.g. the local web service at :43120 is
        /// down) would otherwise spin forever behind the loading placeholder.
        /// Surface the existing `.failed` state with humanized copy instead.
        /// Cancellations (a newer load superseding this one) are not failures.
        private func handleNavigationFailure(_ error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(ScoutAppError.userFacing(
                error,
                connectionMessage: ScoutServicesHelper.servicesOfflineMessage
            )))
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
                        self.deliverRealtimeVoiceStopRequest(in: webView)
                        return
                    }

                    if elapsed >= self.maximumRenderWait {
                        self.readyURL = url
                        self.setPhase(.ready)
                        self.deliverRealtimeVoiceStopRequest(in: webView)
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
            case .projects:
                return """
                (() => {
                  const root = document.querySelector('[data-scout-surface="projects"]');
                  const shell = document.querySelector('.pi-projectsEmbedShell');
                  const bodyText = document.body?.innerText || '';
                  const viteUnavailable = bodyText.includes('Vite dev server unavailable');
                  return {
                    ready: Boolean(root) && Boolean(shell) && bodyText.trim().length > 8,
                    viteUnavailable
                  };
                })()
                """
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
            case .code:
                return """
                (() => {
                  const root = document.querySelector('[data-scout-surface="code"]')
                    || document.querySelector('.s-code-screen');
                  const bodyText = document.body?.innerText || '';
                  const viteUnavailable = bodyText.includes('Vite dev server unavailable');
                  return {
                    ready: Boolean(root),
                    viteUnavailable
                  };
                })()
                """
            case .thread:
                // The feed mounts before the transcript fetch resolves, so
                // waiting on the container alone would call an empty thread
                // ready and flash a blank panel. Hold until a turn has actually
                // rendered — or until the surface says, in its own words, that
                // there is nothing to show.
                return """
                (() => {
                  const feed = document.querySelector('.s-thread-feed');
                  const turns = document.querySelectorAll('.s-thread-msg').length;
                  const empty = document.querySelector('.s-thread-empty');
                  const bodyText = document.body?.innerText || '';
                  const viteUnavailable = bodyText.includes('Vite dev server unavailable');
                  return {
                    ready: Boolean(feed) && (turns > 0 || Boolean(empty)),
                    viteUnavailable
                  };
                })()
                """
            case .voice:
                // Either the call panel or the flag-off explanation counts as
                // rendered — both are the surface having something to say.
                return """
                (() => {
                  const root = document.querySelector('[data-scout-surface="voice"]');
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
