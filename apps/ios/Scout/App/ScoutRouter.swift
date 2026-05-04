// ScoutRouter — Navigation state machine for Safari-style single-surface navigation.
//
// Owns a custom surface stack (not NavigationPath) so we can inspect it
// for address bar context, prevent duplicates, and morph the bottom bar.

import SwiftUI

enum Surface: Hashable {
    case home
    case inbox
    case agents
    case activity
    case tail
    case sessionDetail(sessionId: String)
    case allSessions
    case newSession
    case agentDashboard(agentId: String)
    case agentDetail(agentId: String)
    case settings
    case fleet
    case nodeDetail(nodeId: String)
    case comms
    case channel(id: String)
    case dm(peerId: String)
}

@MainActor
@Observable
final class ScoutRouter {

    // MARK: - Stack

    private(set) var surfaceStack: [Surface] = [.home]

    var currentSurface: Surface {
        surfaceStack.last ?? .home
    }

    var canGoBack: Bool {
        surfaceStack.count > 1
    }

    /// True when current surface is a session detail — bottom bar should show composer mode.
    var showsComposerToolbar: Bool {
        if case .sessionDetail = currentSurface { return true }
        return false
    }

    /// Session ID of the current session detail surface, if any.
    var activeSessionId: String? {
        if case .sessionDetail(let id) = currentSurface { return id }
        return nil
    }

    // MARK: - Navigation

    func push(_ surface: Surface) {
        // Prevent pushing a duplicate of what's already on top
        if surface == currentSurface { return }
        surfaceStack.append(surface)
    }

    func pop() {
        guard surfaceStack.count > 1 else { return }
        surfaceStack.removeLast()
    }

    func popToRoot() {
        surfaceStack = [.home]
    }

    func replaceTop(_ surface: Surface) {
        guard !surfaceStack.isEmpty else {
            surfaceStack = [surface]
            return
        }
        surfaceStack[surfaceStack.count - 1] = surface
    }
}
