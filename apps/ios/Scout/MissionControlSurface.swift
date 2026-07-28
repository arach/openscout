import SwiftUI
import HudsonUI
import HudsonUIWeb
import WebKit

/// A native iPad host for Scout's purpose-built mission-control surfaces.
/// The bundled web apps remain the single implementation of Deck and Dispatch;
/// iOS supplies the native bridge, lifecycle, and containing chrome.
struct MissionControlSurface: View {
    enum Kind: String, Equatable {
        case lanes = "Lanes"
        case dispatch = "Dispatch"

        var displayName: String {
            switch self {
            case .lanes: return "Deck"
            case .dispatch: return "Dispatch"
            }
        }

        var embedPath: String {
            switch self {
            case .lanes: return "/embed/agent-lanes"
            case .dispatch: return "/embed/dispatch"
            }
        }

        var localSurface: ScoutWebSurfaceBridge.Surface {
            switch self {
            case .lanes: return .lanes
            case .dispatch: return .dispatch
            }
        }

        var assetDirectory: String {
            "WebSurfaces/\(localSurface.rawValue)"
        }
    }

    let model: AppModel
    let kind: Kind
    let isActive: Bool

    @State private var webState = HudWebViewState()
    @State private var reloadGeneration = 0
    @State private var localBridge: ScoutWebSurfaceBridge
    @StateObject private var entrance = CockpitEntrancePhase()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    init(model: AppModel, kind: Kind, isActive: Bool) {
        self.model = model
        self.kind = kind
        self.isActive = isActive
        _localBridge = State(initialValue: ScoutWebSurfaceBridge(model: model, surface: kind.localSurface))
    }

    private var usesLocalBundledPage: Bool {
        // Deck is a first-party iPad surface now, not the transitional remote
        // Agent Lanes embed. Keep its signed renderer and native bridge available
        // in every configuration so pairing never changes which product appears.
        if kind == .lanes { return true }

        #if DEBUG
        // Dispatch has not completed the same renderer cutover yet. Its bundled
        // page remains the normal development path with an explicit remote escape
        // hatch for transition debugging.
        return ProcessInfo.processInfo.environment["SCOUT_REMOTE_WEB_SURFACES"] != "1"
        #else
        false
        #endif
    }

    private var webActivity: ScoutWebViewActivity {
        guard scenePhase == .active else { return .background }
        return isActive ? .visible : .hiddenWarm
    }

    private var sourceURL: URL? {
        // Re-resolve on connection changes: `webAccessHost` is nil while the
        // bridge handshake settles, and keep-alive mounting evaluates this long
        // before that. Reading `connectionState` subscribes the surface so the
        // embed appears once the route lands (previously the surface only
        // mounted on tap, when everything was already warm).
        _ = model.connectionState
        guard let base = model.missionControlURL(path: kind.embedPath),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "nativeReload", value: String(reloadGeneration))]
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
                .cockpitEntrance(index: 0, phase: entrance)
            Group {
                // Create each WKWebView lazily on first activation, then leave it
                // mounted and warm across every subsequent tab switch.
                if !entrance.hasEntered {
                    Color.clear
                } else if usesLocalBundledPage {
                    ScoutIntegratedWebSurface(
                        source: .bundled(
                            directory: kind.assetDirectory,
                            readAccessDirectory: "WebSurfaces"
                        ),
                        state: $webState,
                        configuration: HudWebViewConfiguration(
                            allowsBackForwardNavigationGestures: false,
                            allowsJavaScript: true,
                            customUserAgent: "Scout-iPad/1 LocalSurface",
                            usesNonPersistentDataStore: true,
                            isInspectable: false
                        ),
                        integration: localBridge.integration,
                        activity: webActivity
                    )
                    .id(reloadGeneration)
                    .overlay {
                        if let message = webState.errorMessage {
                            unavailable(title: "Couldn’t load local \(kind.displayName)", detail: message)
                        }
                    }
                } else if let sourceURL {
                    HudWebSurface(
                        HudWebSurfaceDescriptor(
                            id: "scout.ios.\(kind.rawValue.lowercased())",
                            title: kind.displayName,
                            location: .paired(sourceURL),
                            lifecycle: .keepWarm
                        ),
                        state: $webState,
                        configuration: HudWebViewConfiguration(
                            allowsBackForwardNavigationGestures: true,
                            allowsJavaScript: true,
                            customUserAgent: "Scout-iPad/1 MissionControl",
                            usesNonPersistentDataStore: false,
                            isInspectable: true
                        )
                    )
                    .id(reloadGeneration)
                    .overlay {
                        if let message = webState.errorMessage {
                            unavailable(title: "Couldn’t load \(kind.displayName)", detail: message)
                        }
                    }
                } else {
                    unavailable(
                        title: "\(kind.displayName) unavailable",
                        detail: "Connect this iPad to a paired Mac over LAN or Tailnet."
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HudPalette.bg)
            .cockpitEntrance(index: 1, phase: entrance)
        }
        .task(id: isActive) {
            await entrance.reveal(when: isActive, animated: !reduceMotion)
        }
    }

    private var toolbar: some View {
        HStack(spacing: HudSpacing.md) {
            HudSectionLabel(kind.displayName, tint: ScoutInk.muted)
            if usesLocalBundledPage {
                Text("LOCAL · SIGNED")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(HudPalette.accent)
            } else if let host = sourceURL?.host {
                Text(host.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.md)
            if webState.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(HudPalette.accent)
            }
            Button("Reload") {
                webState = HudWebViewState()
                reloadGeneration += 1
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .foregroundStyle(HudPalette.accent)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    private func unavailable(title: String, detail: String) -> some View {
        HudEmptyState(title: title, subtitle: detail, icon: "rectangle.connected.to.line.below")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.xxl)
            .background(HudPalette.bg)
    }
}

// MARK: - App-owned WebKit integration

/// The signed Deck needs WebKit reply handlers and lifecycle callbacks that are
/// intentionally app-specific today. Keeping this adapter beside the iPad host
/// avoids coupling OpenScout's privileged bridge contract to HudsonUIWeb's
/// simpler general-purpose web view.
enum ScoutWebViewActivity: String {
    case visible
    case hiddenWarm
    case background
}

struct ScoutWebViewUserScript {
    let source: String
}

@MainActor
final class ScoutWebViewReply {
    private var completion: (@MainActor (Any?, String?) -> Void)?

    init(completion: @escaping @MainActor (Any?, String?) -> Void) {
        self.completion = completion
    }

    func succeed(_ value: Any?) {
        guard let completion else { return }
        self.completion = nil
        completion(value, nil)
    }

    func fail(_ message: String) {
        guard let completion else { return }
        self.completion = nil
        completion(nil, message)
    }
}

struct ScoutWebViewMessageHandler {
    let name: String
    let receive: @MainActor (Any, ScoutWebViewReply) -> Void

    init(name: String, receive: @escaping @MainActor (Any, ScoutWebViewReply) -> Void) {
        self.name = name
        self.receive = receive
    }
}

@MainActor
final class ScoutWebViewIntegration {
    let userScripts: [ScoutWebViewUserScript]
    let messageHandlers: [ScoutWebViewMessageHandler]
    let onActivityChange: (ScoutWebViewActivity) -> Void
    let onReset: (String) -> Void
    let onOpenExternalURL: (URL) -> Void

    init(
        userScripts: [ScoutWebViewUserScript],
        messageHandlers: [ScoutWebViewMessageHandler],
        onActivityChange: @escaping (ScoutWebViewActivity) -> Void,
        onReset: @escaping (String) -> Void,
        onOpenExternalURL: @escaping (URL) -> Void
    ) {
        self.userScripts = userScripts
        self.messageHandlers = messageHandlers
        self.onActivityChange = onActivityChange
        self.onReset = onReset
        self.onOpenExternalURL = onOpenExternalURL
    }
}

enum ScoutIntegratedWebSource: Equatable {
    case bundled(directory: String, readAccessDirectory: String)
}

struct ScoutIntegratedWebSurface: UIViewRepresentable {
    let source: ScoutIntegratedWebSource
    @Binding var state: HudWebViewState
    let configuration: HudWebViewConfiguration
    let integration: ScoutWebViewIntegration
    let activity: ScoutWebViewActivity

    func makeCoordinator() -> Coordinator {
        Coordinator(state: $state, integration: integration, activity: activity)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = configuration.allowsJavaScript
        if configuration.usesNonPersistentDataStore {
            webConfiguration.websiteDataStore = .nonPersistent()
        }
        for script in integration.userScripts {
            webConfiguration.userContentController.addUserScript(
                WKUserScript(source: script.source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        for handler in integration.messageHandlers {
            webConfiguration.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: handler.name)
        }

        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = context.coordinator
        apply(configuration, to: webView)
        context.coordinator.load(source, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.state = $state
        context.coordinator.update(activity: activity)
        apply(configuration, to: webView)
        context.coordinator.load(source, in: webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.tearDown(webView)
    }

    private func apply(_ configuration: HudWebViewConfiguration, to webView: WKWebView) {
        webView.allowsBackForwardNavigationGestures = configuration.allowsBackForwardNavigationGestures
        webView.customUserAgent = configuration.customUserAgent
        webView.scrollView.backgroundColor = .clear
        webView.isOpaque = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = configuration.isInspectable
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
        var state: Binding<HudWebViewState>
        private let integration: ScoutWebViewIntegration
        private var activity: ScoutWebViewActivity
        private var loadedSource: ScoutIntegratedWebSource?
        private let handlers: [String: ScoutWebViewMessageHandler]

        init(
            state: Binding<HudWebViewState>,
            integration: ScoutWebViewIntegration,
            activity: ScoutWebViewActivity
        ) {
            self.state = state
            self.integration = integration
            self.activity = activity
            self.handlers = Dictionary(uniqueKeysWithValues: integration.messageHandlers.map { ($0.name, $0) })
            super.init()
            integration.onActivityChange(activity)
        }

        func load(_ source: ScoutIntegratedWebSource, in webView: WKWebView) {
            guard loadedSource != source else { return }
            loadedSource = source
            state.wrappedValue.errorMessage = nil

            switch source {
            case .bundled(let directory, let readAccessDirectory):
                guard let indexURL = Bundle.main.url(
                    forResource: "index",
                    withExtension: "html",
                    subdirectory: directory
                ), let resourceURL = Bundle.main.resourceURL else {
                    publish(webView, loading: false, errorMessage: "Signed Deck assets are missing from this build.")
                    return
                }
                let readAccessURL = resourceURL.appendingPathComponent(readAccessDirectory, isDirectory: true)
                webView.loadFileURL(indexURL, allowingReadAccessTo: readAccessURL)
            }
        }

        func update(activity next: ScoutWebViewActivity) {
            guard activity != next else { return }
            activity = next
            integration.onActivityChange(next)
        }

        func tearDown(_ webView: WKWebView) {
            for name in handlers.keys {
                webView.configuration.userContentController.removeScriptMessageHandler(forName: name, contentWorld: .page)
            }
            webView.stopLoading()
            webView.navigationDelegate = nil
            integration.onReset("dismantled")
            loadedSource = nil
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping @MainActor (Any?, String?) -> Void
        ) {
            guard let handler = handlers[message.name] else {
                replyHandler(nil, "unsupported_handler")
                return
            }
            handler.receive(message.body, ScoutWebViewReply(completion: replyHandler))
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            publish(webView, loading: true, errorMessage: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            publish(webView, loading: false, errorMessage: nil)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            publish(webView, loading: false, errorMessage: error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            publish(webView, loading: false, errorMessage: error.localizedDescription)
        }

        private func publish(_ webView: WKWebView, loading: Bool, errorMessage: String?) {
            state.wrappedValue = HudWebViewState(
                title: webView.title,
                url: webView.url,
                isLoading: loading,
                estimatedProgress: webView.estimatedProgress,
                canGoBack: webView.canGoBack,
                canGoForward: webView.canGoForward,
                errorMessage: errorMessage
            )
        }
    }
}
