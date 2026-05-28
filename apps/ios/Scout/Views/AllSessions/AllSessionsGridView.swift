// AllSessionsGridView — Forwarder to SessionsLedgerView.
//
// The original 2-col card grid was replaced by a HUD-style cockpit
// ledger (see SessionsLedgerView). This struct stays as a stable
// entry point for the router (.home / .allSessions surfaces) and
// the screenshot mode so call sites don't need to move.

import SwiftUI

struct AllSessionsGridView: View {
    var body: some View {
        SessionsLedgerView()
    }
}
