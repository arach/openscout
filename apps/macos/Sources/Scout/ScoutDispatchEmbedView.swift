import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

private enum ScoutDispatchMetrics {
    static let pageGutter: CGFloat = 20
    static let controlHeight: CGFloat = 26
}

/// Dispatch tab — hosts the shared web broker (dispatch) ledger in a native
/// `WKWebView`. Mirrors `ScoutLanesContent`: a native header over a chrome-free
/// `/embed/broker` embed themed to match the app surfaces/accent.
struct ScoutDispatchContent: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var reloadToken = UUID()

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutDispatchEmbedHost(reloadToken: reloadToken, cacheBuster: reloadToken.uuidString)
        }
        .background(ScoutDesign.bg)
        .onChange(of: colorScheme) { _, _ in
            reloadToken = UUID()
        }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutDispatchMetrics.pageGutter) {
            Text("Dispatch")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text("broker routing · delivery attempts · failed queries")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutDispatchTextButton(title: "Reload", icon: "arrow.clockwise") {
                    reloadToken = UUID()
                }
                ScoutDispatchIconButton(title: "Open dispatch in browser", icon: "safari") {
                    ScoutWeb.open(path: "/broker")
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

/// Chrome-free dispatch (broker) embed URL for the main Scout app shell.
/// Uses `ScoutEmbedTheme` so the web ledger matches native surfaces/accent.
func scoutDispatchEmbedURL(
    colorScheme: ColorScheme,
    embed: String = "app",
    cacheBuster: String? = nil
) -> URL {
    let override = ProcessInfo.processInfo.environment["OPENSCOUT_DISPATCH_EMBED_URL"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = override.flatMap(URL.init(string:))
        ?? ScoutWeb.url(path: "/embed/broker")
        ?? ScoutWeb.baseURL().appending(path: "embed/broker")

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
        items.append(URLQueryItem(name: "profile", value: "macos.dispatch"))
    }
    if let cacheBuster, !cacheBuster.isEmpty {
        items.removeAll { $0.name == "_cb" }
        items.append(URLQueryItem(name: "_cb", value: cacheBuster))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum ScoutDispatchEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

/// Loading + error chrome around the dispatch `WKWebView`.
struct ScoutDispatchEmbedHost: View {
    let reloadToken: UUID
    let cacheBuster: String

    @Environment(\.colorScheme) private var colorScheme
    @State private var phase: ScoutDispatchEmbedLoadPhase = .loading

    private var url: URL {
        scoutDispatchEmbedURL(colorScheme: colorScheme, cacheBuster: cacheBuster)
    }

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutDispatchEmbedWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    ScoutDispatchLoadingView()
                        .transition(.opacity)
                case .failed(let message):
                    errorState(message)
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

    private func errorState(_ message: String) -> some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "wifi.exclamationmark")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
            Text("Dispatch ledger unavailable")
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

/// Lightweight loader while the broker embed hydrates the dispatch ledger.
private struct ScoutDispatchLoadingView: View {
    var body: some View {
        ZStack {
            ScoutDesign.bg

            HStack(spacing: HudSpacing.md) {
                ScoutBrailleSpinner(size: HudTextSize.sm, tint: ScoutPalette.accent)
                VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                    Text("READING DISPATCH LEDGER")
                        .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(ScoutPalette.ink)
                    Text("routing · delivery attempts · failed queries")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
            .padding(.horizontal, HudSpacing.lg)
            .padding(.vertical, HudSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            )
        }
    }
}

#if os(macOS)
private struct ScoutDispatchEmbedWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutDispatchEmbedLoadPhase

    func makeCoordinator() -> Coordinator {
        Coordinator(phase: $phase)
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
        @Binding var phase: ScoutDispatchEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(phase: Binding<ScoutDispatchEmbedLoadPhase>) {
            _phase = phase
        }

        private let minimumLoaderDwell: TimeInterval = 0.38
        private let maximumRenderWait: TimeInterval = 6.0
        private let renderPollInterval: TimeInterval = 0.06

        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()
        var readyURL: URL?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForDispatchRender(in: webView, url: currentURL, token: navigationToken)
        }

        private func waitForDispatchRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            // Ready once the ledger toolbar is up and either the tab row (data
            // loaded) or a settled empty state (not the "Loading dispatch" card)
            // is present.
            let script = """
            (() => {
              const toolbar = Boolean(document.querySelector('.sys-ledger-toolbar'));
              const tabs = Boolean(document.querySelector('.sys-tab-row--toolbar'));
              const stateTitle = (document.querySelector('.sys-state-title')?.textContent || '').trim().toLowerCase();
              const settledEmpty = stateTitle.length > 0 && !stateTitle.includes('loading');
              const bodyText = document.body?.innerText || '';
              return {
                ready: toolbar && (tabs || settledEmpty),
                hasText: bodyText.trim().length > 8
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
                        self.waitForDispatchRender(in: webView, url: url, token: token)
                    }
                }
            }
        }

        private func markReady(_ url: URL) {
            guard readyURL != url else { return }
            readyURL = url
            setPhase(.ready)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        private func setPhase(_ next: ScoutDispatchEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func message(for error: Error) -> String {
            ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app.")
        }
    }
}
#else
private struct ScoutDispatchEmbedWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutDispatchEmbedLoadPhase

    var body: some View {
        EmptyView()
    }
}
#endif

private struct ScoutDispatchTextButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                Text(title)
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
            }
            .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.dim)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: ScoutDispatchMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? ScoutSurface.hover : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .help("Reload the dispatch ledger from the web app (bypasses cache)")
        .onHover { isHovering = $0 }
    }
}

private struct ScoutDispatchIconButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.dim)
                .frame(width: ScoutDispatchMetrics.controlHeight, height: ScoutDispatchMetrics.controlHeight)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(isHovering ? ScoutSurface.hover : Color.clear)
                )
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .help(title)
        .onHover { isHovering = $0 }
    }
}
