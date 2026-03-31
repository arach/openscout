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
    @State private var isResuming = false

    private var canResume: Bool {
        connection.state == .connected && !isResuming
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PlexusColors.backgroundAdaptive.ignoresSafeArea()

                if let url = viewerURL {
                    BridgeWebView(url: url, isLoading: $isLoading)
                        .ignoresSafeArea(edges: .bottom)

                    if isLoading {
                        VStack(spacing: PlexusSpacing.lg) {
                            ProgressView()
                                .controlSize(.regular)
                            Text("Loading viewer...")
                                .font(PlexusTypography.body(14))
                                .foregroundStyle(PlexusColors.textMuted)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(PlexusColors.backgroundAdaptive.opacity(0.9))
                    }
                } else {
                    VStack(spacing: PlexusSpacing.lg) {
                        Image(systemName: "wifi.slash")
                            .font(.system(size: 36))
                            .foregroundStyle(PlexusColors.textMuted)
                        Text("Not connected to bridge")
                            .font(PlexusTypography.body(16, weight: .medium))
                            .foregroundStyle(PlexusColors.textSecondary)
                    }
                }

                // Resuming overlay
                if isResuming {
                    ZStack {
                        Color.black.opacity(0.4).ignoresSafeArea()
                        VStack(spacing: PlexusSpacing.lg) {
                            ProgressView().controlSize(.large).tint(.white)
                            Text("Resuming session...")
                                .font(PlexusTypography.body(16, weight: .medium))
                                .foregroundStyle(.white)
                        }
                        .padding(PlexusSpacing.xxl)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.lg, style: .continuous))
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
                            .foregroundStyle(PlexusColors.textMuted)
                            .symbolRenderingMode(.hierarchical)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { resumeSession() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.uturn.forward")
                                .font(.system(size: 13, weight: .semibold))
                            Text("Resume")
                                .font(PlexusTypography.body(14, weight: .semibold))
                        }
                        .foregroundStyle(canResume ? PlexusColors.accent : PlexusColors.textMuted)
                    }
                    .disabled(!canResume)
                }
            }
        }
    }

    private var viewerURL: URL? {
        guard let host = connection.bridgeHost,
              let port = connection.bridgePort else { return nil }
        let encoded = sessionPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sessionPath
        return URL(string: "http://\(host):\(port)/#/session?path=\(encoded)")
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
                PlexusLog.session.error("Resume failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Reusable bridge WebView

struct BridgeWebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.underPageBackgroundColor = UIColor(PlexusColors.backgroundAdaptive)
        webView.scrollView.bounces = false
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        let parent: BridgeWebView
        init(parent: BridgeWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in parent.isLoading = false }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in parent.isLoading = false }
        }
    }
}
