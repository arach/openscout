import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#endif

/// Tail "load session" — macOS surface.
///
/// Like the repo-diff sheet (`ScoutBranchDiffSheet`), macOS does **not**
/// reimplement the session/transcript viewer natively. It hosts the *shared* web
/// session viewer inside a native `WKWebView`, presented as a slide-out sheet from
/// a Tail row. The web team serves a chrome-free embeddable route —
/// `GET /embed/session?ref=<sessionId>` — that resolves the id through the same
/// `/api/session-ref/:id` endpoint the web Sessions view uses and renders the
/// full `SessionObserve` trace (or conversation). This sheet just loads that URL.
///
/// The session **data** is read locally (the embed resolves it from the local
/// web server / on-disk transcript); the only remote fetch is the version-pinned,
/// immutably-cached web bundle, served behind a persistent `WKWebsiteDataStore`.
///
/// Shares the bottom-sheet geometry (`ScoutBranchDiffMetrics`) and the dark/light
/// `ScoutBranchDiffTheme` with the diff sheet; keeps its own web host so the two
/// surfaces stay independent. (When hudson lands `HudEdgeSheet(edge:)`, both
/// sheets collapse onto that primitive — see the seam in `ScoutBranchDiffSheet`.)

// MARK: - Embed URL

/// Builds the chrome-free embed URL for a tail session:
/// `<base>/embed/session?ref=<percent-encoded sessionId>&theme=<dark|light>`.
///
/// The ref is percent-encoded against alphanumerics so any path-like or reserved
/// character in a harness session id survives the round-trip as query data.
func tailSessionEmbedURL(sessionRef: String, theme: ScoutBranchDiffTheme) -> URL {
    var components = URLComponents(url: ScoutWeb.baseURL(), resolvingAgainstBaseURL: false)
    components?.path = "/embed/session"
    let themeVars = ScoutEmbedTheme.themeVarsQueryItem(for: theme)
    components?.queryItems = [
        URLQueryItem(name: "ref", value: sessionRef),
        URLQueryItem(name: "theme", value: theme.queryValue),
    ] + (themeVars.map { [$0] } ?? [])
    if let encodedRef = sessionRef.addingPercentEncoding(withAllowedCharacters: .alphanumerics) {
        components?.percentEncodedQueryItems = [
            URLQueryItem(name: "ref", value: encodedRef),
            URLQueryItem(name: "theme", value: theme.queryValue),
        ] + (themeVars.map { [$0] } ?? [])
    }
    return components?.url ?? ScoutWeb.baseURL()
}

// MARK: - Sheet container

/// The bottom slide-out sheet that hosts the embedded session viewer for a single
/// tail row. Mirrors `ScoutBranchDiffSheet`; `edge` defaults to `.bottom`.
struct ScoutTailSessionSheet: View {
    /// The tail event's session id, resolved by the embed via `/api/session-ref`.
    let sessionRef: String
    /// Bright header title — the row's project (or source) label.
    let title: String
    /// Dimmed header subtitle — e.g. `claude · dbec9314`.
    let subtitle: String
    /// Which edge the sheet enters from. Defaults to the bottom drawer.
    var edge: Edge = .bottom
    /// Dismiss request — scrim tap, close button, or Escape.
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// rAF-style gate so the panel animates *in* on appear rather than snapping.
    @State private var shown = false
    /// Bumped to force a fresh load (retry button after a failed load).
    @State private var reloadToken = UUID()

    private var theme: ScoutBranchDiffTheme { ScoutBranchDiffTheme(colorScheme: colorScheme) }
    private var url: URL { tailSessionEmbedURL(sessionRef: sessionRef, theme: theme) }

    private var drawerAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)
    }

    var body: some View {
        presentation
            .onAppear {
                DispatchQueue.main.async {
                    withAnimation(drawerAnimation) { shown = true }
                }
            }
            .onChange(of: colorScheme) { _, _ in reloadToken = UUID() }
            .background(
                ScoutTailSessionEscapeMonitor { dismiss() }
                    .frame(width: 0, height: 0)
                    .accessibilityHidden(true)
            )
    }

    private var presentation: some View {
        ZStack(alignment: alignment) {
            scrim
            panel
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
    }

    private var scrim: some View {
        Color.black
            .opacity(shown ? ScoutBranchDiffMetrics.scrimOpacity : 0)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { dismiss() }
            .allowsHitTesting(shown)
    }

    private var panel: some View {
        GeometryReader { geo in
            let size = panelSize(in: geo.size)
            sheetSurface
                .frame(width: size.width, height: size.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
                .offset(panelOffset(for: size))
        }
        .ignoresSafeArea()
    }

    private var sheetSurface: some View {
        VStack(spacing: 0) {
            if edge == .bottom { grabHandle }
            header
            HudDivider(color: ScoutDesign.hairline)
            ScoutTailSessionWebHost(url: url, reloadToken: reloadToken, onRetry: { reloadToken = UUID() })
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.bg)
        .clipShape(panelShape)
        .overlay(panelShape.stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin))
        .shadow(color: Color.black.opacity(0.45), radius: 40, x: 0, y: edge == .bottom ? -8 : 0)
    }

    private var grabHandle: some View {
        Capsule()
            .fill(ScoutDesign.hairlineStrong)
            .frame(width: ScoutBranchDiffMetrics.grabHandleWidth, height: 4)
            .padding(.top, HudSpacing.sm)
            .frame(maxWidth: .infinity)
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "waveform.path.ecg")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.accentSoft))

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(subtitle)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.sm)

            Button(action: dismiss) {
                Image(systemName: edge == .bottom ? "chevron.down" : "chevron.right")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(ScoutPalette.muted)
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
            .help("Close session")
        }
        .padding(.horizontal, HudSpacing.lg)
        .frame(height: ScoutBranchDiffMetrics.headerHeight)
        .background(ScoutDesign.chrome)
    }

    // MARK: Geometry

    private var alignment: Alignment { edge == .bottom ? .bottom : .trailing }

    private var panelShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: ScoutBranchDiffMetrics.cornerRadius, style: .continuous)
    }

    private func panelSize(in host: CGSize) -> CGSize {
        switch edge {
        case .bottom:
            return CGSize(width: host.width, height: host.height * ScoutBranchDiffMetrics.bottomHeightFraction)
        case .trailing, .leading, .top:
            return CGSize(width: host.width * ScoutBranchDiffMetrics.rightWidthFraction, height: host.height)
        }
    }

    private func panelOffset(for size: CGSize) -> CGSize {
        guard !shown else { return .zero }
        switch edge {
        case .bottom: return CGSize(width: 0, height: size.height + 24)
        case .top: return CGSize(width: 0, height: -(size.height + 24))
        case .trailing: return CGSize(width: size.width + 24, height: 0)
        case .leading: return CGSize(width: -(size.width + 24), height: 0)
        }
    }

    private func dismiss() {
        withAnimation(drawerAnimation) { shown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) { onClose() }
    }
}

// MARK: - Web host (loading + error states wrap the WKWebView)

private struct ScoutTailSessionWebHost: View {
    let url: URL
    let reloadToken: UUID
    let onRetry: () -> Void

    @State private var phase: ScoutTailSessionLoadPhase = .loading

    var body: some View {
        ZStack {
            ScoutDesign.bg
            ScoutTailSessionWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(phase == .ready ? 1 : 0)

            switch phase {
            case .loading:
                loadingState
            case .failed(let message):
                errorState(message)
            case .ready:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: url) { _, _ in phase = .loading }
        .onChange(of: reloadToken) { _, _ in phase = .loading }
    }

    private var loadingState: some View {
        VStack(spacing: HudSpacing.md) {
            ProgressView().controlSize(.small)
            Text("Loading session…")
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "wifi.exclamationmark")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
            Text("Couldn't load the session viewer")
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            Text(message)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Button(action: onRetry) {
                Text("Retry")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .padding(.horizontal, HudSpacing.lg)
                    .padding(.vertical, HudSpacing.sm)
                    .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.accentSoft))
                    .foregroundStyle(ScoutPalette.accent)
            }
            .buttonStyle(.plain).scoutPointerCursor()
        }
        .padding(HudSpacing.huge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Load lifecycle for the embedded session viewer.
private enum ScoutTailSessionLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

// MARK: - WKWebView representable

#if os(macOS)
/// The native `WKWebView` host for the shared web session viewer. Uses the
/// **default, persistent** `WKWebsiteDataStore` so the version-pinned web bundle
/// is fetched once and reused across launches (same quasi-local optimization as
/// the diff sheet).
private struct ScoutTailSessionWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTailSessionLoadPhase

    func makeCoordinator() -> Coordinator { Coordinator(phase: $phase) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
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
        let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var phase: ScoutTailSessionLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(phase: Binding<ScoutTailSessionLoadPhase>) {
            _phase = phase
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            setPhase(.ready)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            setPhase(.failed(Self.message(for: error)))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            setPhase(.failed(Self.message(for: error)))
        }

        private func setPhase(_ next: ScoutTailSessionLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        static func message(for error: Error) -> String {
            let ns = error as NSError
            guard ns.domain == NSURLErrorDomain else { return ns.localizedDescription }
            switch ns.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost:
                return "The local OpenScout web server isn't reachable. Make sure it's running, then retry."
            case NSURLErrorTimedOut:
                return "The session viewer took too long to respond. Retry once the local server is ready."
            case NSURLErrorNotConnectedToInternet:
                return "The web bundle couldn't be fetched on first load — connect once to cache it, then it works offline."
            case NSURLErrorCancelled:
                return "The load was cancelled."
            default:
                return ns.localizedDescription
            }
        }
    }
}
#else
private struct ScoutTailSessionWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutTailSessionLoadPhase
    var body: some View { Color.clear.onAppear { phase = .ready } }
}
#endif

// MARK: - Escape-to-dismiss monitor

#if os(macOS)
private struct ScoutTailSessionEscapeMonitor: NSViewRepresentable {
    let onEscape: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEscape: onEscape) }

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onEscape = onEscape
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.remove()
    }

    final class Coordinator {
        var onEscape: () -> Void
        private var monitor: Any?

        init(onEscape: @escaping () -> Void) {
            self.onEscape = onEscape
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                if event.keyCode == 53 { // Escape
                    self?.onEscape()
                    return nil
                }
                return event
            }
        }

        func remove() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        deinit { remove() }
    }
}
#else
private struct ScoutTailSessionEscapeMonitor: View {
    let onEscape: () -> Void
    var body: some View { Color.clear }
}
#endif

// MARK: - Preview

#if DEBUG && canImport(PreviewsMacros)
#Preview("Tail session sheet · bottom") {
    ScoutTailSessionSheet(
        sessionRef: "dbec9314-15de-4c1a-b8ac-085f297eaafd",
        title: "openscout",
        subtitle: "claude · dbec9314",
        edge: .bottom,
        onClose: {}
    )
    .frame(width: 980, height: 640)
    .background(ScoutDesign.bg)
}
#endif
