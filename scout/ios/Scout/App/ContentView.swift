// ContentView — Top-level routing for the Dispatch iOS client.
//
// Routes to PairingView, reconnecting UI, or SessionListView
// based on connection state and trusted bridge availability.

import SwiftUI

struct ContentView: View {

    @Environment(SessionStore.self) private var sessionStore
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var reconnectTriggered = false

    private var hasLocalSessionHistory: Bool {
        !sessionStore.summaries.isEmpty
    }

    var body: some View {
        Group {
            switch connectionManager.state {
            case .disconnected:
                if connectionManager.hasTrustedBridge {
                    if hasLocalSessionHistory {
                        SessionListView()
                    } else {
                        reconnectingView(attempt: 0)
                    }
                } else {
                    PairingView()
                }

            case .connecting, .handshaking:
                if hasLocalSessionHistory {
                    SessionListView()
                } else {
                    connectingView
                }

            case .connected:
                SessionListView()

            case .reconnecting(let attempt):
                if hasLocalSessionHistory {
                    SessionListView()
                } else {
                    reconnectingView(attempt: attempt)
                }

            case .failed(let error):
                if hasLocalSessionHistory {
                    SessionListView()
                } else {
                    failedView(error: error)
                }
            }
        }
        .animation(.default, value: connectionManager.state)
        .task {
            // Auto-reconnect on launch if we have a trusted bridge.
            // This task lives on ContentView (the root) so it won't be
            // cancelled by state-driven child view swaps.
            guard !reconnectTriggered,
                  connectionManager.state == .disconnected,
                  connectionManager.hasTrustedBridge else { return }
            reconnectTriggered = true
            await connectionManager.reconnect()
        }
    }

    // MARK: - Intermediate state views

    private var connectingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Connecting to bridge...")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func reconnectingView(attempt: Int) -> some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Reconnecting...")
                .font(.headline)
            if attempt > 0 {
                Text("Attempt \(attempt)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failedView(error: Error) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)

            Text("Connection Failed")
                .font(.title2.bold())

            Text(error.scoutUserFacingMessage)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            VStack(spacing: 12) {
                if connectionManager.hasTrustedBridge {
                    Button("Retry Connection") {
                        Task {
                            await connectionManager.reconnect()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }

                Button("Scan New QR Code") {
                    connectionManager.clearTrustedBridge()
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
