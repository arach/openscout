import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

private enum ScoutLanesMetrics {
    static let pageGutter: CGFloat = 20
    static let controlHeight: CGFloat = 26
}

/// Lane column width tier — sm / md / lg maps to the web embed's
/// `--agent-lane-width` (408 / 512 / 616 px).
enum ScoutAgentLaneSize: String, CaseIterable, Identifiable {
    static let storageKey = "scout.lanes.size.v1"

    case sm
    case md
    case lg

    var id: String { rawValue }

    var label: String { rawValue.uppercased() }

    var laneWidth: CGFloat {
        switch self {
        case .sm: return 408
        case .md: return 512
        case .lg: return 616
        }
    }

    var widthLabel: String { "\(Int(laneWidth))px" }

    /// Matches `ScoutShellLayout` breakpoints — compact/balanced/wide → sm/md/lg.
    static func from(windowWidth: CGFloat) -> ScoutAgentLaneSize {
        if windowWidth < 1120 { return .sm }
        if windowWidth < 1320 { return .md }
        return .lg
    }
}

/// Agent Lanes tab — hosts the shared web lanes wall in a native `WKWebView`.
struct ScoutLanesContent: View {
    let windowWidth: CGFloat

    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(ScoutAgentLaneSize.storageKey) private var laneSizeOverrideRaw = ""
    @State private var reloadToken = UUID()

    private var autoLaneSize: ScoutAgentLaneSize {
        ScoutAgentLaneSize.from(windowWidth: windowWidth)
    }

    private var laneSize: ScoutAgentLaneSize {
        if let manual = ScoutAgentLaneSize(rawValue: laneSizeOverrideRaw), !laneSizeOverrideRaw.isEmpty {
            return manual
        }
        return autoLaneSize
    }

    private var laneSizeBinding: Binding<ScoutAgentLaneSize> {
        Binding(
            get: { laneSize },
            set: { laneSizeOverrideRaw = $0.rawValue }
        )
    }

    private var laneSizeSubtitle: String {
        let tier = "\(laneSize.label) · \(laneSize.widthLabel)"
        if laneSizeOverrideRaw.isEmpty {
            return "auto · \(tier) columns"
        }
        return "\(tier) columns"
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScoutLanesEmbedHost(laneSize: laneSize, reloadToken: reloadToken, cacheBuster: reloadToken.uuidString)
        }
        .background(ScoutDesign.bg)
        .onChange(of: colorScheme) { _, _ in
            reloadToken = UUID()
        }
        .onChange(of: laneSize) { _, _ in
            reloadToken = UUID()
        }
        .onChange(of: windowWidth) { _, _ in
            guard laneSizeOverrideRaw.isEmpty else { return }
            reloadToken = UUID()
        }
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutLanesMetrics.pageGutter) {
            Text("Lanes")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
        } secondary: {
            Text(laneSizeSubtitle)
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        } trailing: {
            HStack(spacing: HudSpacing.sm) {
                ScoutLaneSizeToggle(selection: laneSizeBinding, autoActive: laneSizeOverrideRaw.isEmpty)

                ScoutLanesHeaderDivider()

                ScoutLanesTextButton(title: "Reload", icon: "arrow.clockwise") {
                    reloadToken = UUID()
                }
                ScoutLanesIconButton(title: "Open lanes in browser", icon: "safari") {
                    ScoutWeb.open(path: "/ops/lanes")
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

/// Chrome-free agent-lanes embed URL for the main Scout app shell.
/// Uses `ScoutEmbedTheme` so the web columns match native surfaces/accent.
func scoutLanesEmbedURL(
    colorScheme: ColorScheme,
    laneSize: ScoutAgentLaneSize,
    embed: String = "app",
    cacheBuster: String? = nil
) -> URL {
    let override = ProcessInfo.processInfo.environment["OPENSCOUT_LANES_EMBED_URL"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = override.flatMap(URL.init(string:))
        ?? ScoutWeb.url(path: "/ops/lanes/embed")
        ?? ScoutWeb.baseURL().appending(path: "ops/lanes/embed")

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
        items.append(URLQueryItem(name: "profile", value: "macos.lanes"))
    }
    if !items.contains(where: { $0.name == "lanes" }) {
        items.append(URLQueryItem(name: "lanes", value: laneSize.rawValue))
    }
    if let cacheBuster, !cacheBuster.isEmpty {
        items.removeAll { $0.name == "_cb" }
        items.append(URLQueryItem(name: "_cb", value: cacheBuster))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum ScoutLanesEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

/// Loading + error chrome around the lanes `WKWebView`.
struct ScoutLanesEmbedHost: View {
    let laneSize: ScoutAgentLaneSize
    let reloadToken: UUID
    let cacheBuster: String

    @Environment(\.colorScheme) private var colorScheme
    @State private var phase: ScoutLanesEmbedLoadPhase = .loading

    private var url: URL {
        scoutLanesEmbedURL(colorScheme: colorScheme, laneSize: laneSize, cacheBuster: cacheBuster)
    }

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    var body: some View {
        ZStack {
            ScoutLanesEmbedWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isReady ? 1 : 0.001)
                .allowsHitTesting(isReady)

            if !isReady {
                switch phase {
                case .loading:
                    ScoutLanesMaterializingView(laneSize: laneSize)
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
            Text("Agent lanes unavailable")
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
private struct ScoutLanesEmbedWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutLanesEmbedLoadPhase

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
        @Binding var phase: ScoutLanesEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(phase: Binding<ScoutLanesEmbedLoadPhase>) {
            _phase = phase
        }

        private let minimumLoaderDwell: TimeInterval = 0.38
        private let maximumRenderWait: TimeInterval = 5.0
        private let renderPollInterval: TimeInterval = 0.06

        var navigationStartedAt = Date.distantPast
        var navigationToken = UUID()
        var readyURL: URL?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let currentURL, readyURL != currentURL else { return }
            waitForLanesRender(in: webView, url: currentURL, token: navigationToken)
        }

        private func waitForLanesRender(in webView: WKWebView, url: URL, token: UUID) {
            guard token == navigationToken, readyURL != url else { return }

            let script = """
            (() => {
              const bar = Boolean(document.querySelector('.s-agent-lanes-bar'));
              const scroll = Boolean(document.querySelector('.s-agent-lanes-scroll'));
              const empty = document.querySelector('.s-agent-lanes-empty');
              const emptyText = empty?.textContent?.trim() || '';
              const tailLoading = emptyText.includes('Loading tail stream');
              const lanes = document.querySelectorAll('.s-agent-lane').length;
              const bodyText = document.body?.innerText || '';
              const shellReady = bar && (scroll || empty);
              const contentReady = shellReady && !tailLoading && (lanes > 0 || Boolean(empty));
              return {
                ready: contentReady,
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
                        self.waitForLanesRender(in: webView, url: url, token: token)
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

        private func setPhase(_ next: ScoutLanesEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func message(for error: Error) -> String {
            ScoutAppError.userFacing(error, connectionMessage: "Could not connect to the Scout web app.")
        }
    }
}
#else
private struct ScoutLanesEmbedWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutLanesEmbedLoadPhase

    var body: some View {
        EmptyView()
    }
}
#endif

// Lane-column skeleton + shimmer while the embed hydrates tail data and paints columns.
private struct ScoutLanesMaterializingView: View {
    let laneSize: ScoutAgentLaneSize

    private var laneWidths: [CGFloat] {
        Array(repeating: laneSize.laneWidth, count: 4)
    }

    var body: some View {
        TimelineView(.animation) { context in
            let tick = context.date.timeIntervalSinceReferenceDate

            ZStack {
                ScoutDesign.bg

                GeometryReader { proxy in
                    let width = max(proxy.size.width, 1)
                    let sweep = CGFloat((tick * 0.58).truncatingRemainder(dividingBy: 1.0)) * (width + 120) - 80
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    ScoutPalette.accent.opacity(0.14),
                                    Color.clear,
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 72)
                        .rotationEffect(.degrees(10))
                        .offset(x: sweep)
                        .blendMode(.screen)
                }
                .allowsHitTesting(false)

                VStack(spacing: 0) {
                    statusBand(tick: tick)
                        .padding(.horizontal, ScoutLanesMetrics.pageGutter)
                        .padding(.top, HudSpacing.lg)
                        .padding(.bottom, HudSpacing.md)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: HudSpacing.lg) {
                            ForEach(Array(laneWidths.enumerated()), id: \.offset) { index, width in
                                laneSkeleton(width: width, tick: tick, index: index)
                            }
                        }
                        .padding(.horizontal, ScoutLanesMetrics.pageGutter)
                        .padding(.bottom, HudSpacing.xxl)
                    }

                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func statusBand(tick: TimeInterval) -> some View {
        HStack(spacing: HudSpacing.md) {
            ScoutBrailleSpinner(size: HudTextSize.sm, tint: ScoutPalette.accent)
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(statusHeadline(tick))
                    .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(ScoutPalette.ink)
                Text(statusDetail(tick))
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
            Spacer(minLength: 0)
            Image(systemName: "rectangle.split.3x1")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent.opacity(0.55 + 0.25 * sin(tick * 5.0)))
        }
    }

    private func statusHeadline(_ tick: TimeInterval) -> String {
        switch Int(tick * 1.4) % 3 {
        case 0: return "CONNECTING"
        case 1: return "SYNCING TAIL"
        default: return "RENDERING LANES"
        }
    }

    private func statusDetail(_ tick: TimeInterval) -> String {
        switch Int(tick * 1.4) % 3 {
        case 0: return "reaching scout web embed"
        case 1: return "hydrating harness transcripts"
        default: return "composing agent columns"
        }
    }

    private func laneSkeleton(width: CGFloat, tick: TimeInterval, index: Int) -> some View {
        let pulse = 0.55 + 0.45 * sin(tick * 4.2 + Double(index) * 0.9)

        return VStack(alignment: .leading, spacing: HudSpacing.md) {
            ScoutLanesShimmerBlock(width: width, height: 92, cornerRadius: HudRadius.card, phase: tick + Double(index) * 0.22)

            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(0..<5, id: \.self) { row in
                    ScoutLanesShimmerBlock(
                        width: width * (row == 4 ? 0.62 : 0.92),
                        height: 10,
                        cornerRadius: HudRadius.tight,
                        phase: tick + Double(index) * 0.15 + Double(row) * 0.08
                    )
                    .opacity(0.72 + 0.28 * pulse * (1.0 - Double(row) * 0.12))
                }
            }
            .padding(.horizontal, HudSpacing.sm)
        }
        .frame(width: width, alignment: .topLeading)
        .opacity(0.82 + 0.18 * pulse)
    }
}

private struct ScoutLanesShimmerBlock: View {
    let width: CGFloat
    let height: CGFloat
    let cornerRadius: CGFloat
    let phase: TimeInterval

    var body: some View {
        TimelineView(.animation) { context in
            let tick = context.date.timeIntervalSinceReferenceDate + phase
            let sweep = CGFloat((tick * 0.72).truncatingRemainder(dividingBy: 1.0)) * (width + 80) - 40

            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(ScoutSurface.control)
                .frame(width: width, height: height)
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    ScoutPalette.accent.opacity(0.10),
                                    ScoutPalette.accentSoft.opacity(0.34),
                                    ScoutPalette.accent.opacity(0.10),
                                    Color.clear,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: min(width * 0.55, 140))
                        .offset(x: sweep)
                        .blendMode(.screen)
                }
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                }
        }
        .frame(width: width, height: height)
    }
}

private struct ScoutLaneSizeToggle: View {
    @Binding var selection: ScoutAgentLaneSize
    let autoActive: Bool

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutAgentLaneSize.allCases) { size in
                Button {
                    selection = size
                } label: {
                    Text(size.label)
                        .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(selection == size ? ScoutPalette.ink : ScoutPalette.muted)
                        .frame(width: 22, height: ScoutLanesMetrics.controlHeight - 4)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                                .fill(selection == size ? ScoutDesign.bg : Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
                .help("\(size.label) lanes · \(size.widthLabel)")
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(autoActive ? ScoutPalette.accent.opacity(0.35) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
        )
        .help(autoActive ? "Lane width follows window size" : "Lane width pinned")
    }
}

private struct ScoutLanesHeaderDivider: View {
    var body: some View {
        Rectangle()
            .fill(ScoutDesign.hairline)
            .frame(width: 1, height: 18)
    }
}

private struct ScoutLanesTextButton: View {
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
            .frame(height: ScoutLanesMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? ScoutSurface.hover : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .help("Reload lanes from the web app (bypasses cache)")
        .onHover { isHovering = $0 }
    }
}

private struct ScoutLanesIconButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.dim)
                .frame(width: ScoutLanesMetrics.controlHeight, height: ScoutLanesMetrics.controlHeight)
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