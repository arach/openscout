import Foundation
import SwiftUI
import WebKit

struct ScoutRelayWorkspaceView: View {
    @Bindable var viewModel: ScoutShellViewModel

    var body: some View {
        if let resourceURL = Bundle.module.url(
            forResource: "relay",
            withExtension: "html"
        ) {
            ScoutRelayWebView(
                resourceURL: resourceURL,
                state: viewModel.relayWebStateSnapshot(),
                handleAction: { action in
                    await handle(action)
                }
            )
        } else {
            ContentUnavailableView(
                "Relay UI Not Bundled",
                systemImage: "network.slash",
                description: Text("Build the Relay web bundle before launching ScoutApp.")
            )
        }
    }

    private func handle(_ action: ScoutRelayWebAction) async -> ScoutRelayWebActionResult {
        switch action {
        case .ready:
            return .success()
        case .refresh:
            await viewModel.refreshWorkersNow()
            return .success()
        case let .toggleVoiceReplies(enabled):
            viewModel.setVoiceRepliesEnabled(enabled)
            return .success()
        case .toggleVoiceCapture:
            viewModel.toggleVoiceCapture()
            return .success()
        case let .sendMessage(destinationKind, destinationID, body):
            do {
                try await viewModel.relayWebSendMessage(
                    body: body,
                    destinationKind: destinationKind,
                    destinationID: destinationID
                )
                return .success()
            } catch {
                return .failure(error.localizedDescription)
            }
        }
    }
}

private enum ScoutRelayWebAction {
    case ready
    case refresh
    case toggleVoiceCapture
    case toggleVoiceReplies(enabled: Bool)
    case sendMessage(destinationKind: String, destinationID: String, body: String)
}

private struct ScoutRelayWebActionResult {
    let ok: Bool
    let error: String?

    static func success() -> ScoutRelayWebActionResult {
        ScoutRelayWebActionResult(ok: true, error: nil)
    }

    static func failure(_ error: String) -> ScoutRelayWebActionResult {
        ScoutRelayWebActionResult(ok: false, error: error)
    }
}

private struct ScoutRelayWebView: NSViewRepresentable {
    let resourceURL: URL
    let state: ScoutRelayWebState
    let handleAction: @Sendable (ScoutRelayWebAction) async -> ScoutRelayWebActionResult

    func makeCoordinator() -> Coordinator {
        Coordinator(handleAction: handleAction)
    }

    func makeNSView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.bridgeName)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        context.coordinator.attach(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.handleAction = handleAction
        context.coordinator.updateState(state)

        guard context.coordinator.loadedURL != resourceURL else {
            return
        }

        context.coordinator.loadedURL = resourceURL
        webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL.deletingLastPathComponent())
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.bridgeName)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let bridgeName = "scoutRelayBridge"

        var handleAction: @Sendable (ScoutRelayWebAction) async -> ScoutRelayWebActionResult
        var loadedURL: URL?
        private weak var webView: WKWebView?
        private var pageReady = false
        private var pendingStateJSON: String?
        private var lastStateJSON: String?

        init(handleAction: @escaping @Sendable (ScoutRelayWebAction) async -> ScoutRelayWebActionResult) {
            self.handleAction = handleAction
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageReady = false
            flushStateIfPossible()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.bridgeName,
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String else {
                return
            }

            let requestID = body["requestId"] as? String
            let action = parseAction(type: type, body: body)

            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let result = await self.handleAction(action)
                if type == "ready" {
                    self.pageReady = true
                    self.flushStateIfPossible()
                }

                guard let requestID else {
                    return
                }

                self.dispatchActionResult(
                    requestID: requestID,
                    result: result
                )
            }
        }

        func updateState(_ state: ScoutRelayWebState) {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]

            guard let data = try? encoder.encode(state),
                  let json = String(data: data, encoding: .utf8) else {
                return
            }

            guard json != lastStateJSON else {
                return
            }

            lastStateJSON = json
            pendingStateJSON = json
            flushStateIfPossible()
        }

        private func flushStateIfPossible() {
            guard pageReady,
                  let pendingStateJSON,
                  let webView else {
                return
            }

            self.pendingStateJSON = nil
            webView.evaluateJavaScript("window.__scoutRelayReceive && window.__scoutRelayReceive({ type: 'state', state: \(pendingStateJSON) });")
        }

        private func dispatchActionResult(requestID: String, result: ScoutRelayWebActionResult) {
            guard let webView else {
                return
            }

            let response: String
            if let error = result.error {
                response = "{ type: 'actionResult', requestId: '\(escapeForJavaScript(requestID))', ok: false, error: '\(escapeForJavaScript(error))' }"
            } else {
                response = "{ type: 'actionResult', requestId: '\(escapeForJavaScript(requestID))', ok: true }"
            }

            webView.evaluateJavaScript("window.__scoutRelayReceive && window.__scoutRelayReceive(\(response));")
        }

        private func parseAction(type: String, body: [String: Any]) -> ScoutRelayWebAction {
            switch type {
            case "refresh":
                return .refresh
            case "toggleVoiceCapture":
                return .toggleVoiceCapture
            case "setVoiceRepliesEnabled":
                return .toggleVoiceReplies(enabled: body["enabled"] as? Bool ?? false)
            case "sendMessage":
                return .sendMessage(
                    destinationKind: body["destinationKind"] as? String ?? "channel",
                    destinationID: body["destinationId"] as? String ?? "shared",
                    body: body["body"] as? String ?? ""
                )
            case "ready":
                return .ready
            default:
                return .ready
            }
        }

        private func escapeForJavaScript(_ value: String) -> String {
            value
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
        }
    }
}
