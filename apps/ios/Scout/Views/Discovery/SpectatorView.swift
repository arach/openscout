// SpectatorView — Opens spectator from the bridge's file server in a WebView.
//
// Just a URL. Spectator's static assets are cached aggressively by the browser.
// Session data is fetched by spectator itself from /api/session-by-path.
// "Resume" button creates a live session that continues the conversation.

import SwiftUI
import WebKit

struct SpectatorView: View {
    let sessionPath: String
    let sessionName: String
    var agentType: String = "claude-code"
    var onResumed: ((String) -> Void)?

    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var isResuming = false

    private var canResume: Bool {
        connection.state == .connected && !isResuming
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ScoutColors.backgroundAdaptive.ignoresSafeArea()

                if let request = viewerRequest {
                    BridgeWebView(
                        request: request,
                        isLoading: $isLoading,
                        errorMessage: $loadError
                    )
                        .ignoresSafeArea(edges: .bottom)

                    BridgeViewerStateView(
                        isLoading: isLoading,
                        errorMessage: loadError,
                        loadingLabel: "Loading viewer..."
                    )
                } else {
                    BridgeWebUnavailableView(
                        icon: "wifi.slash",
                        title: "Not connected to bridge",
                        subtitle: "Reconnect to open this viewer."
                    )
                }

                // Resuming overlay
                if isResuming {
                    ZStack {
                        Color.black.opacity(0.4).ignoresSafeArea()
                        VStack(spacing: ScoutSpacing.lg) {
                            ProgressView().controlSize(.large).tint(.white)
                            Text("Resuming session...")
                                .font(ScoutTypography.body(16, weight: .medium))
                                .foregroundStyle(.white)
                        }
                        .padding(ScoutSpacing.xxl)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
                    }
                }
            }
            .navigationTitle(sessionName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(ScoutColors.textMuted)
                            .symbolRenderingMode(.hierarchical)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { resumeSession() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.uturn.forward")
                                .font(.system(size: 13, weight: .semibold))
                            Text("Resume")
                                .font(ScoutTypography.body(14, weight: .semibold))
                        }
                        .foregroundStyle(canResume ? ScoutColors.accent : ScoutColors.textMuted)
                    }
                    .disabled(!canResume)
                }
            }
        }
    }

    private var viewerRequest: URLRequest? {
        guard let host = connection.bridgeHost,
              let port = connection.bridgePort else { return nil }
        let encoded = sessionPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sessionPath
        guard let url = URL(string: "http://\(host):\(port)/#/session?path=\(encoded)") else {
            return nil
        }
        return URLRequest(url: url)
    }

    private func resumeSession() {
        guard canResume else { return }
        isResuming = true

        Task {
            do {
                let session = try await connection.resumeSession(
                    sessionPath: sessionPath,
                    adapterType: agentType,
                    name: sessionName
                )
                dismiss()
                try? await Task.sleep(for: .milliseconds(300))
                onResumed?(session.id)
            } catch {
                isResuming = false
                ScoutLog.session.error("Resume failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Reusable bridge WebView

struct BridgeWebView: UIViewRepresentable {
    let request: URLRequest
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.underPageBackgroundColor = UIColor(ScoutColors.backgroundAdaptive)
        webView.scrollView.bounces = false
        context.coordinator.lastRequestFingerprint = requestFingerprint(for: request)
        webView.load(request)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let fingerprint = requestFingerprint(for: request)
        guard context.coordinator.lastRequestFingerprint != fingerprint else { return }
        context.coordinator.lastRequestFingerprint = fingerprint
        webView.load(request)
    }

    private func requestFingerprint(for request: URLRequest) -> String {
        let url = request.url?.absoluteString ?? ""
        let token = request.value(forHTTPHeaderField: "X-Scout-Handoff-Token") ?? ""
        return "\(url)|\(token)"
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let parent: BridgeWebView
        var lastRequestFingerprint: String?

        init(parent: BridgeWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in
                parent.isLoading = true
                parent.errorMessage = nil
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                parent.isLoading = false
                parent.errorMessage = nil
            }
        }

        @MainActor
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
        ) {
            if let response = navigationResponse.response as? HTTPURLResponse,
               !(200..<400).contains(response.statusCode) {
                Task { @MainActor in
                    parent.isLoading = false
                    parent.errorMessage = response.statusCode == 401
                        ? "This viewer link expired. Stay in the app and try again if needed."
                        : "Scout couldn't load this viewer right now."
                }
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !shouldIgnoreNavigationError(error) else { return }
            Task { @MainActor in
                parent.isLoading = false
                parent.errorMessage = "Scout couldn't load this viewer right now."
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard !shouldIgnoreNavigationError(error) else { return }
            Task { @MainActor in
                parent.isLoading = false
                parent.errorMessage = "Scout couldn't load this viewer right now."
            }
        }

        private func shouldIgnoreNavigationError(_ error: Error) -> Bool {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
        }
    }
}

private struct BridgeViewerStateView: View {
    let isLoading: Bool
    let errorMessage: String?
    let loadingLabel: String

    var body: some View {
        if isLoading || errorMessage != nil {
            VStack(spacing: ScoutSpacing.lg) {
                if isLoading {
                    ProgressView()
                        .controlSize(.regular)
                } else {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Text(errorMessage ?? loadingLabel)
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, ScoutSpacing.xxl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(ScoutColors.backgroundAdaptive.opacity(0.9))
        }
    }
}

private struct BridgeWebUnavailableView: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 36))
                .foregroundStyle(ScoutColors.textMuted)
            Text(title)
                .font(ScoutTypography.body(16, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
            Text(subtitle)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, ScoutSpacing.xxl)
        }
    }
}
