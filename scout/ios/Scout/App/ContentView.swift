// ContentView — Top-level routing for the Dispatch iOS client.
//
// Routes to PairingView, reconnecting UI, or SessionListView
// based on connection state and trusted bridge availability.

import SwiftUI

struct ContentView: View {

    @Environment(SessionStore.self) private var sessionStore
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var reconnectTriggered = false
    @State private var router = ScoutRouter()

    var body: some View {
        Group {
            if connectionManager.hasTrustedBridge {
                ScoutNavigationShell()
                    .environment(router)
            } else {
                PairingView()
            }
        }
        .animation(.default, value: connectionManager.hasTrustedBridge)
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

}
