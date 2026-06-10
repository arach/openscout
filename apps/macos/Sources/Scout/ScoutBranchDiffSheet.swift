import HudsonUI
import ScoutAppCore
import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#endif

/// SCO-065 — Repo Diff Viewer, macOS surface.
///
/// macOS does **not** reimplement the diff renderer natively. It hosts the
/// *shared* web diff viewer (Pierre Diffs + Shiki) inside a native `WKWebView`,
/// presented as a slide-out sheet from a Repos worktree row. The web team serves
/// a chrome-free embeddable route — `GET /embed/repo-diff?path=<worktree>` — off
/// the local OpenScout web server; this sheet just loads that URL. See the spec's
/// §19 ("How should native macOS reuse this viewer") — the answer is *embedded
/// web view, not a native renderer*.
///
/// The diff **data** never leaves the machine: the embed route fetches its patch
/// text from the local broker (§13 Privacy And Safety). The only remote fetch is
/// the version-pinned, immutably-cached Pierre/Shiki *library* — which, behind a
/// persistent `WKWebsiteDataStore`, is fetched once and reused across launches,
/// so the viewer is quasi-local after first paint.
///
/// Ports the `design/studio/app/studies/branch-diff-sheet` study to native:
///   - `ScoutReposView.swift`  — worktree row activate → present this sheet
///   - `ScoutBranchDiffSheet.swift` (this file) — the bottom-sheet container
///   - hudson · `HudEdgeSheet(edge:)` (in flight) — the edge-agnostic primitive
///     that will eventually own the presentation; until it lands we ship a
///     fully-working local presentation (see the seam in `ScoutBranchDiffSheet`).

// MARK: - Web server base URL

// The embedded viewer is served by the local OpenScout web server. Reuse the
// resolver every other macOS → web call uses (`ScoutWeb.baseURL()`: env
// OPENSCOUT_WEB_URL / OPENSCOUT_WEB_PORT, the local config file, else the
// 127.0.0.1:3200 fallback) so the diff sheet tracks the app's real web origin.

/// Builds the chrome-free embed URL for a worktree's diff:
/// `<base>/embed/repo-diff?path=<percent-encoded absolute path>&theme=<dark|light>`.
///
/// The path is percent-encoded with a conservative allowed set (alphanumerics
/// only) so every reserved/sub-delim character in an absolute filesystem path —
/// spaces, `&`, `?`, `#`, `=`, `+`, `/` — survives the round-trip as query data.
func repoDiffEmbedURL(worktreePath: String, theme: ScoutBranchDiffTheme) -> URL {
    var components = URLComponents(url: ScoutWeb.baseURL(), resolvingAgainstBaseURL: false)
    components?.path = "/embed/repo-diff"
    components?.queryItems = [
        URLQueryItem(name: "path", value: worktreePath),
        URLQueryItem(name: "theme", value: theme.queryValue),
    ]
    // `URLComponents` percent-encodes query *values* but leaves `/`, `+`, `&`,
    // `=` etc. as-is inside a value — fine for `&`/`=` separators but `+` would
    // be read as a space and bare `/` muddies logs. Re-encode the path value
    // ourselves against alphanumerics so the worktree path is unambiguous.
    if let encodedPath = worktreePath.addingPercentEncoding(withAllowedCharacters: .alphanumerics) {
        components?.percentEncodedQueryItems = [
            URLQueryItem(name: "path", value: encodedPath),
            URLQueryItem(name: "theme", value: theme.queryValue),
        ]
    }
    // Fall back to the base URL only if component assembly somehow fails; the
    // host never renders this because the inputs above are always well-formed.
    return components?.url ?? ScoutWeb.baseURL()
}

/// The `theme` query param the web viewer reads to match the app's appearance.
enum ScoutBranchDiffTheme: String, Equatable, Sendable {
    case dark
    case light

    var queryValue: String { rawValue }

    /// Resolve from SwiftUI's environment `ColorScheme` (which already honors the
    /// window's forced appearance from the Scout theme picker).
    init(colorScheme: ColorScheme) {
        self = colorScheme == .dark ? .dark : .light
    }
}

// MARK: - Sheet metrics

enum ScoutBranchDiffMetrics {
    /// Fraction of the host the bottom drawer covers (matches the study's 76%).
    static let bottomHeightFraction: CGFloat = 0.76
    /// Fraction of the host the right reading column covers (study's 65%).
    static let rightWidthFraction: CGFloat = 0.65
    static let headerHeight: CGFloat = 48
    static let grabHandleWidth: CGFloat = 36
    static let cornerRadius: CGFloat = HudRadius.card
    static let scrimOpacity: CGFloat = 0.42
}

/// Resize bounds, persistence keys, and divider hit width for the **diff sheet
/// only**. Kept separate from `ScoutBranchDiffMetrics` (which `ScoutTailSessionSheet`
/// also reads for its fixed geometry) so the diff sheet's new resizing can never
/// regress the Tail sheet.
enum ScoutBranchDiffResize {
    /// Min/max fraction of the host the drawer/column may cover, per edge.
    static let bottomRange: ClosedRange<CGFloat> = 0.40...0.95
    static let rightRange: ClosedRange<CGFloat> = 0.40...0.92
    /// Comfortable drag target for the trailing-column divider.
    static let dividerHitWidth: CGFloat = 8
    /// @AppStorage keys (`.v1` matches the repo's width-persistence convention,
    /// e.g. `scout.conversationList.width.v2`).
    static let bottomKey = "scout.repoDiff.bottomHeightFraction.v1"
    static let rightKey = "scout.repoDiff.rightWidthFraction.v1"
}

// MARK: - Sheet container

/// The bottom slide-out sheet that hosts the embedded repo-diff web viewer for a
/// single worktree. `edge` defaults to `.bottom` (the spec's chosen presentation)
/// but is a parameter so the same container can enter from the trailing edge —
/// the study's "one component, `edge` is a parameter" finding.
///
/// PRESENTATION SEAM:
/// `HudEdgeSheet(edge:)` — the edge-agnostic scrim + `.transition(.move(edge:))`
/// modal — is being built in the hudson repo *in parallel* and is not available
/// yet. Until it lands, this view ships its own fully-working local presentation:
/// a tappable scrim plus a panel that slides in from `edge` on a drawer spring.
/// When hudson lands the primitive, replace the `presentation` body below with a
/// single `HudEdgeSheet(edge: edge, isPresented: ...) { content }`.
struct ScoutBranchDiffSheet: View {
    /// Absolute worktree path whose diff the embedded viewer should render.
    let worktreePath: String
    /// Branch label for the sheet header (dimmed prefix + bright leaf).
    let branchParts: RepoBranchParts
    /// Which edge the sheet enters from. Defaults to the spec's bottom drawer.
    var edge: Edge = .bottom
    /// Dismiss request — scrim tap, close button, or Escape.
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// rAF-style gate so the panel animates *in* on appear rather than snapping.
    @State private var shown = false
    /// Bumped to force a fresh load (retry button after a failed/unreachable load).
    @State private var reloadToken = UUID()

    /// Persisted resize fractions (per edge). Defaults track the fixed values the
    /// sheet shipped with, so behavior is unchanged until the user drags.
    @AppStorage(ScoutBranchDiffResize.bottomKey)
    private var storedBottomFraction = Double(ScoutBranchDiffMetrics.bottomHeightFraction)
    @AppStorage(ScoutBranchDiffResize.rightKey)
    private var storedRightFraction = Double(ScoutBranchDiffMetrics.rightWidthFraction)
    /// Non-nil only while dragging the bottom grab handle; the panel prefers it
    /// over the stored fraction so a drag doesn't write UserDefaults per frame.
    @State private var dragPreviewFraction: CGFloat?

    private var theme: ScoutBranchDiffTheme { ScoutBranchDiffTheme(colorScheme: colorScheme) }
    private var url: URL { repoDiffEmbedURL(worktreePath: worktreePath, theme: theme) }

    private var drawerAnimation: Animation? {
        // HudMotion's drawer spring (nil under Reduce Motion → no slide).
        HudMotion.ifAllowed(HudMotion.drawerSpring, reduceMotion: reduceMotion)
    }

    var body: some View {
        presentation
            .onAppear {
                // Defer one runloop turn so the transition is observed.
                DispatchQueue.main.async {
                    withAnimation(drawerAnimation) { shown = true }
                }
            }
            // Re-load when the app's appearance flips so the web viewer's theme
            // query matches light/dark live.
            .onChange(of: colorScheme) { _, _ in reloadToken = UUID() }
            .background(
                ScoutBranchDiffEscapeMonitor { dismiss() }
                    .frame(width: 0, height: 0)
                    .accessibilityHidden(true)
            )
    }

    // TODO(SCO-065): replace with HudEdgeSheet(edge: .bottom) once hudson lands
    // it. Everything below is the temporary-but-complete local presentation.
    private var presentation: some View {
        ZStack(alignment: alignment) {
            scrim
            panel
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
    }

    private var scrim: some View {
        // Sticky sheet: the scrim is a soft dim only — it neither dismisses on
        // tap (close chevron / Escape are the only dismissals) nor blocks the
        // canvas, so the nav rail stays clickable and the diff persists while you
        // move between sections.
        Color.black
            .opacity(shown ? ScoutBranchDiffMetrics.scrimOpacity : 0)
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }

    private var panel: some View {
        GeometryReader { geo in
            let size = panelSize(in: geo.size)
            sheetSurface(host: geo.size)
                .frame(width: size.width, height: size.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
                .offset(panelOffset(for: size))
        }
        .ignoresSafeArea()
    }

    private func sheetSurface(host: CGSize) -> some View {
        VStack(spacing: 0) {
            if edge == .bottom { grabHandle(hostHeight: host.height) }
            header
            HudDivider(color: ScoutDesign.hairline)
            ScoutBranchDiffWebHost(url: url, reloadToken: reloadToken, onRetry: { reloadToken = UUID() })
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.bg)
        .clipShape(panelShape)
        .overlay(panelShape.stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin))
        // The trailing (right-column) variant resizes width via the shared
        // HudsonKit divider on its inner edge; it brings `NSCursor.resizeLeftRight`.
        // The bottom drawer resizes height via the grab handle below
        // (HudResizableDivider is horizontal-only).
        .overlay(alignment: .leading) {
            if edge != .bottom {
                HudResizableDivider(
                    width: rightWidthBinding(host: host),
                    placement: .leading,
                    range: rightWidthRange(host: host),
                    hitWidth: ScoutBranchDiffResize.dividerHitWidth
                )
            }
        }
        .shadow(color: Color.black.opacity(0.45), radius: 40, x: 0, y: edge == .bottom ? -8 : 0)
    }

    /// The bottom drawer's resize affordance. The actual drag is an AppKit
    /// `NSView` (`ScoutDrawerResizeHandle`) — same smooth, precise mouse-tracking
    /// the conversation-list / sidebar resizers use — driving a live preview
    /// fraction and committing on mouse-up. The capsule is just the visual.
    private func grabHandle(hostHeight: CGFloat) -> some View {
        ZStack {
            ScoutDrawerResizeHandle(
                fraction: $storedBottomFraction,
                previewFraction: $dragPreviewFraction,
                range: ScoutBranchDiffResize.bottomRange,
                hostHeight: hostHeight
            )
            Capsule()
                .fill(dragPreviewFraction != nil ? ScoutPalette.accent : ScoutDesign.hairlineStrong)
                .frame(width: ScoutBranchDiffMetrics.grabHandleWidth, height: 4)
                .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 16)
        .padding(.top, HudSpacing.xs)
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "arrow.triangle.branch")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.accentSoft))

            VStack(alignment: .leading, spacing: 1) {
                branchLabel
                Text(repoShortPath(worktreePath, segments: 4))
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
            .help("Close diff")
        }
        .padding(.horizontal, HudSpacing.lg)
        .frame(height: ScoutBranchDiffMetrics.headerHeight)
        .background(ScoutDesign.chrome)
    }

    private var branchLabel: some View {
        let parts = branchParts
        return Text(parts.prefix)
            .foregroundStyle(ScoutPalette.dim)
            + Text(parts.detached ? parts.sha : parts.leaf)
            .foregroundStyle(ScoutPalette.ink)
    }

    // MARK: Geometry

    private var alignment: Alignment { edge == .bottom ? .bottom : .trailing }

    private var panelShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: ScoutBranchDiffMetrics.cornerRadius, style: .continuous)
    }

    private func clampFraction(_ value: CGFloat) -> CGFloat {
        let range = edge == .bottom
            ? ScoutBranchDiffResize.bottomRange
            : ScoutBranchDiffResize.rightRange
        return min(range.upperBound, max(range.lowerBound, value))
    }

    /// The live size fraction for the active edge — the drag preview while
    /// dragging, else the persisted value — always clamped to the edge's range.
    private var activeFraction: CGFloat {
        let stored: CGFloat = edge == .bottom
            ? CGFloat(storedBottomFraction)
            : CGFloat(storedRightFraction)
        return clampFraction(dragPreviewFraction ?? stored)
    }

    /// The trailing-column divider's clamp range, expressed in points for the
    /// current host width (kept on one line — a split `...` operator reads as a
    /// separate call argument).
    private func rightWidthRange(host: CGSize) -> ClosedRange<CGFloat> {
        let w = max(host.width, 1)
        return (ScoutBranchDiffResize.rightRange.lowerBound * w)...(ScoutBranchDiffResize.rightRange.upperBound * w)
    }

    /// Bridges `HudResizableDivider`'s absolute-width binding to our persisted
    /// fraction (trailing/right-column variant only). Writes go straight to
    /// `@AppStorage`; the divider drag is an occasional, non-production path.
    private func rightWidthBinding(host: CGSize) -> Binding<CGFloat> {
        Binding(
            get: { clampFraction(CGFloat(storedRightFraction)) * host.width },
            set: { newWidth in
                storedRightFraction = Double(clampFraction(newWidth / max(host.width, 1)))
            }
        )
    }

    private func panelSize(in host: CGSize) -> CGSize {
        let fraction = activeFraction
        switch edge {
        case .bottom:
            return CGSize(width: host.width, height: host.height * fraction)
        case .trailing, .leading, .top:
            // The spec ships bottom; trailing is the study's alternate. Other
            // edges fall back to the trailing geometry so `edge` stays total.
            return CGSize(width: host.width * fraction, height: host.height)
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
        // Let the retract animation play before tearing the view down.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) { onClose() }
    }
}

// MARK: - Web host (loading + error states wrap the WKWebView)

/// Wraps the `WKWebView` representable with the loading indicator and the
/// unreachable / failed-load error state. Keeps the representable itself a thin
/// load/callback shim; all of the SwiftUI chrome lives here.
private struct ScoutBranchDiffWebHost: View {
    let url: URL
    let reloadToken: UUID
    let onRetry: () -> Void

    @State private var phase: ScoutBranchDiffLoadPhase = .loading

    var body: some View {
        ZStack {
            ScoutDesign.bg
            ScoutBranchDiffWebView(url: url, reloadToken: reloadToken, phase: $phase)
                // Hide the web view until it finishes so a half-painted frame
                // never flashes behind the loader.
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
        // A fresh URL or reload token restarts the cycle from loading.
        .onChange(of: url) { _, _ in phase = .loading }
        .onChange(of: reloadToken) { _, _ in phase = .loading }
    }

    private var loadingState: some View {
        VStack(spacing: HudSpacing.md) {
            ProgressView().controlSize(.small)
            Text("Loading diff…")
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
            Text("Couldn't load the diff viewer")
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

/// Load lifecycle for the embedded diff viewer.
private enum ScoutBranchDiffLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

// MARK: - WKWebView representable

#if os(macOS)
/// The native `WKWebView` host for the shared web diff viewer.
///
/// WebKit cache optimization (the "quasi-local" win): this uses the **default,
/// persistent** `WKWebsiteDataStore` — explicitly *not* `.nonPersistent()`. The
/// version-pinned Pierre/Shiki assets the embed page loads are immutable and
/// `Cache-Control`-friendly, so a persistent store means they're fetched once
/// and reused across launches; only the first ever open pays the network cost.
/// (Contrast `ScoutObserveEmbedWebView`, which deliberately bypasses caches for
/// a live stream — the diff viewer wants the opposite.)
private struct ScoutBranchDiffWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutBranchDiffLoadPhase

    func makeCoordinator() -> Coordinator { Coordinator(phase: $phase) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // PERSISTENT store (the default). Do NOT swap in `.nonPersistent()` —
        // that would re-download Pierre/Shiki on every launch and defeat the
        // fetch-once, reuse-forever optimization that makes this quasi-local.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        // Let the SwiftUI surface show through so the loader/bg color reads
        // through any transparent gutters in the embed page.
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // Only (re)load when the URL or the reload token actually changed, so
        // routine SwiftUI updates don't kick a redundant network request.
        guard context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        // Default cache policy (`.useProtocolCachePolicy`) so the persistent
        // store can serve the immutable Pierre/Shiki assets from disk — the
        // whole point of the quasi-local optimization.
        let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var phase: ScoutBranchDiffLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(phase: Binding<ScoutBranchDiffLoadPhase>) {
            _phase = phase
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            setPhase(.ready)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            setPhase(.failed(Self.message(for: error)))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            // Provisional failures are the "server unreachable" case — the
            // request never got a response (connection refused, DNS, timeout).
            setPhase(.failed(Self.message(for: error)))
        }

        private func setPhase(_ next: ScoutBranchDiffLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        /// Map common `NSURLErrorDomain` codes to operator-readable copy. The
        /// underlying URL is intentionally omitted — it carries an absolute
        /// worktree path (§13: no path leakage into surfaced strings beyond what
        /// the operator already sees in the row).
        static func message(for error: Error) -> String {
            let ns = error as NSError
            guard ns.domain == NSURLErrorDomain else { return ns.localizedDescription }
            switch ns.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost:
                return "The local OpenScout web server isn't reachable. Make sure it's running, then retry."
            case NSURLErrorTimedOut:
                return "The diff viewer took too long to respond. Retry once the local server is ready."
            case NSURLErrorNotConnectedToInternet:
                return "Pierre/Shiki assets couldn't be fetched on first load — connect once to cache them, then it works offline."
            case NSURLErrorCancelled:
                return "The load was cancelled."
            default:
                return ns.localizedDescription
            }
        }
    }
}
#else
/// Non-macOS fallback so the type resolves everywhere; Scout ships macOS-only.
private struct ScoutBranchDiffWebView: View {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: ScoutBranchDiffLoadPhase
    var body: some View { Color.clear.onAppear { phase = .ready } }
}
#endif

// MARK: - Escape-to-dismiss monitor

#if os(macOS)
/// A zero-size local key monitor that fires `onEscape` for the Escape key while
/// the sheet is on screen — matching how the rest of Scout dismisses overlays
/// (the cheatsheet does the same in the root view's keyboard handler).
private struct ScoutBranchDiffEscapeMonitor: NSViewRepresentable {
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
private struct ScoutBranchDiffEscapeMonitor: View {
    let onEscape: () -> Void
    var body: some View { Color.clear }
}
#endif

// MARK: - Vertical resize handle (bottom drawer)

#if os(macOS)
/// Smooth bottom-drawer resize, in the house style of `ScoutConversationResizeHandle`:
/// an AppKit `NSView` that tracks the mouse directly (no SwiftUI `DragGesture`),
/// updates a live preview fraction on every `mouseDragged`, and commits to the
/// persisted fraction on `mouseUp`. Vertical + fraction-based: a pixel drag is
/// scaled by the host height into a 0…1 fraction so the stored size is
/// resolution-independent.
private struct ScoutDrawerResizeHandle: NSViewRepresentable {
    @Binding var fraction: Double          // persisted height fraction
    @Binding var previewFraction: CGFloat? // live during a drag
    let range: ClosedRange<CGFloat>
    let hostHeight: CGFloat

    func makeNSView(context: Context) -> HandleView {
        let view = HandleView()
        configure(view)
        return view
    }

    func updateNSView(_ view: HandleView, context: Context) {
        configure(view)
    }

    private func configure(_ view: HandleView) {
        view.range = range
        view.hostHeight = hostHeight
        view.getFraction = { CGFloat(fraction) }
        view.setPreview = { previewFraction = $0 }
        view.commit = { fraction = Double($0) }
        view.clearPreview = { previewFraction = nil }
    }

    final class HandleView: NSView {
        var range: ClosedRange<CGFloat> = 0.4...0.95
        var hostHeight: CGFloat = 1
        var getFraction: () -> CGFloat = { 0.76 }
        var setPreview: (CGFloat) -> Void = { _ in }
        var commit: (CGFloat) -> Void = { _ in }
        var clearPreview: () -> Void = {}

        private var startY: CGFloat = 0
        private var startFraction: CGFloat = 0

        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)
            wantsLayer = true
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            wantsLayer = true
        }

        override var acceptsFirstResponder: Bool { true }
        override var mouseDownCanMoveWindow: Bool { false }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func resetCursorRects() {
            addCursorRect(bounds, cursor: .resizeUpDown)
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(self)
            startY = event.locationInWindow.y
            startFraction = getFraction()
            setPreview(startFraction)
        }

        override func mouseDragged(with event: NSEvent) {
            // Drawer is bottom-anchored, handle is on its top edge: dragging up
            // (window y increases) grows it.
            let dy = event.locationInWindow.y - startY
            setPreview(clamp(startFraction + dy / max(hostHeight, 1)))
        }

        override func mouseUp(with event: NSEvent) {
            let dy = event.locationInWindow.y - startY
            commit(clamp(startFraction + dy / max(hostHeight, 1)))
            clearPreview()
        }

        private func clamp(_ value: CGFloat) -> CGFloat {
            min(max(value, range.lowerBound), range.upperBound)
        }
    }
}
#else
private struct ScoutDrawerResizeHandle: View {
    @Binding var fraction: Double
    @Binding var previewFraction: CGFloat?
    let range: ClosedRange<CGFloat>
    let hostHeight: CGFloat
    var body: some View { Color.clear }
}
#endif

// MARK: - Preview

#if DEBUG
#Preview("Branch diff sheet · bottom") {
    ScoutBranchDiffSheet(
        worktreePath: "/Users/art/dev/openscout",
        branchParts: RepoBranchParts(
            detached: false,
            sha: "",
            prefix: "feat/",
            leaf: "native-repo-service"
        ),
        edge: .bottom,
        onClose: {}
    )
    .frame(width: 980, height: 640)
    .background(ScoutDesign.bg)
}
#endif
