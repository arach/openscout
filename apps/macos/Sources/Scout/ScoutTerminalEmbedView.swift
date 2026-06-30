import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

private enum ScoutTerminalMetrics {
    static let pageGutter: CGFloat = 20
}

/// Terminal — hosts the shared web terminal cockpit inside the native Scout app.
///
/// macOS already routes per-agent takeover to the web terminal because the relay
/// and xterm stack live there. This surface makes the same terminal inventory a
/// first-class native app section without reimplementing terminal transport.
struct ScoutTerminalContent: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var reloadToken = UUID()

    private var url: URL {
        scoutTerminalEmbedURL(colorScheme: colorScheme, cacheBuster: reloadToken.uuidString)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutTerminalEmbedHost(url: url, reloadToken: reloadToken) {
                reloadToken = UUID()
            }
        }
        .background(ScoutDesign.bg)
        .onChange(of: colorScheme) { _, _ in reloadToken = UUID() }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTerminalMetrics.pageGutter) {
            Text("Terminals")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text("live sessions · agent terminals")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutTerminalHeaderButton(title: "Reload", icon: "arrow.clockwise") {
                    reloadToken = UUID()
                }
                ScoutTerminalHeaderButton(title: "Open in browser", icon: "safari") {
                    ScoutWeb.open(path: "/terminal")
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

func scoutTerminalEmbedURL(
    colorScheme: ColorScheme,
    routePath: String = "/terminal",
    cacheBuster: String? = nil
) -> URL {
    let base = ScoutWeb.url(path: "/embed/terminal")
        ?? ScoutWeb.baseURL().appending(path: "embed/terminal")
    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
        return base
    }

    var items = components.queryItems ?? []
    items.removeAll { ["route", "profile", "_cb"].contains($0.name) }
    items.append(URLQueryItem(name: "route", value: routePath))
    items.append(URLQueryItem(name: "profile", value: "macos.terminal"))
    for item in ScoutEmbedTheme.queryItems(for: colorScheme) where !items.contains(where: { $0.name == item.name }) {
        items.append(item)
    }
    if let cacheBuster, !cacheBuster.isEmpty {
        items.append(URLQueryItem(name: "_cb", value: cacheBuster))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum ScoutTerminalEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

private struct ScoutTerminalEmbedHost: View {
    let url: URL
    let reloadToken: UUID
    let onRetry: () -> Void

    @State private var phase: ScoutTerminalEmbedLoadPhase = .loading

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutTerminalEmbedWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    ScoutTerminalMaterializingView()
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
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
            Text("Terminal cockpit unavailable")
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
            ScoutTerminalHeaderButton(title: "Retry", icon: "arrow.clockwise", action: onRetry)
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if os(macOS)
private struct ScoutTerminalEmbedWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTerminalEmbedLoadPhase

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
        @Binding var phase: ScoutTerminalEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        private let minimumLoaderDwell: TimeInterval = 0.32
        private let maximumRenderWait: TimeInterval = 5.0
        private let renderPollInterval: TimeInterval = 0.06

        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()
        var readyURL: URL?

        init(phase: Binding<ScoutTerminalEmbedLoadPhase>) {
            _phase = phase
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForTerminalRender(in: webView, url: currentURL, token: navigationToken)
        }

        private func waitForTerminalRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            let script = """
            (() => {
              const term = Boolean(document.querySelector('.s-term'));
              const home = Boolean(document.querySelector('.s-term-home'));
              const bar = Boolean(document.querySelector('.s-term-bar'));
              const xterm = Boolean(document.querySelector('.xterm'));
              const bodyText = document.body?.innerText || '';
              return {
                ready: term && (home || bar || xterm || bodyText.includes('Terminal Control')),
                hasText: bodyText.trim().length > 8 || xterm
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
                        self.waitForTerminalRender(in: webView, url: url, token: token)
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

        private func setPhase(_ next: ScoutTerminalEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func message(for error: Error) -> String {
            ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app.")
        }
    }
}
#else
private struct ScoutTerminalEmbedWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTerminalEmbedLoadPhase

    var body: some View {
        EmptyView()
    }
}
#endif

private struct ScoutTerminalMaterializingView: View {
    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.accent)
            VStack(spacing: HudSpacing.xs) {
                Text("Opening terminal control")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Syncing live sessions and agent terminal targets")
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
    }
}

private struct ScoutTerminalHeaderButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                Text(title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.45)
                    .lineLimit(1)
            }
            .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(hovering ? ScoutSurface.hover : ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(title)
    }
}
