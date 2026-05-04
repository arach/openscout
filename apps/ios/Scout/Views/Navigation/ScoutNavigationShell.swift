// ScoutNavigationShell — Root container for Safari-style single-surface navigation.
//
// ZStack with surface content switching on router state,
// ScoutBottomBar always mounted at the bottom, and
// interactive edge-swipe-back via UIScreenEdgePanGestureRecognizer.
//
// Push animation: new surfaces slide in from the right, previous surface
// shows a 30% parallax retreat. Driven by entranceOffset (animated @State).
//
// Swipe-back: UIScreenEdgePanGestureRecognizer drives dragOffset directly.
// Both systems share the same previousSurface parallax/dim math.
//
// Performance:
// - .compositingGroup() prevents per-frame recomposition of deep view trees
// - Previous surface is kept alive (but hidden) so it's pre-rendered
// - Shadow only applied when a previous surface is visible
// - GeometryReader width cached in @State to avoid relayout during drag

import SwiftUI

struct ScoutNavigationShell: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var dragOffset: CGFloat = 0
    @State private var isDragging = false
    @State private var entranceOffset: CGFloat = 0
    @State private var isEntering = false
    @State private var screenWidth: CGFloat = UIScreen.main.bounds.width

    private var canSwipeBack: Bool { router.canGoBack }

    private var previousSurface: Surface? {
        let stack = router.surfaceStack
        guard stack.count >= 2 else { return nil }
        return stack[stack.count - 2]
    }

    /// Normalized drag progress 0...1 (swipe-back)
    private var dragProgress: Double {
        guard screenWidth > 0 else { return 0 }
        return min(1, max(0, Double(dragOffset / screenWidth)))
    }

    /// Normalized entrance progress 0...1 (push slide-in)
    private var entranceProgress: Double {
        guard screenWidth > 0 else { return 1 }
        return min(1, max(0, Double(1 - entranceOffset / screenWidth)))
    }

    private var isShowingPrevious: Bool { isDragging || isEntering }

    /// Previous surface parallax offset — retreats left as new surface arrives or current is dragged back.
    private var previousOffset: CGFloat {
        if isDragging {
            return -screenWidth * 0.3 * (1 - dragProgress)
        }
        if isEntering {
            return -screenWidth * 0.3 * entranceProgress
        }
        return 0
    }

    /// Dim overlay on previous surface.
    private var previousDim: Double {
        if isDragging {
            return 0.1 * (1 - dragProgress)
        }
        if isEntering {
            return 0.1 * entranceProgress
        }
        return 0
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Previous surface — pre-rendered; revealed during drag or entrance animation.
            // Opacity/offset/dim all animate with the parent push/drag transaction so
            // the entrance reads as a single coherent motion instead of a fast opacity
            // fade layered under a slower slide-in.
            if let previousSurface {
                surfaceView(for: previousSurface)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .offset(x: previousOffset)
                    .overlay {
                        Color.black.opacity(previousDim)
                            .allowsHitTesting(false)
                    }
                    .opacity(isShowingPrevious ? 1 : 0)
                    .allowsHitTesting(false)
                    .compositingGroup()
            }

            // Current surface — offset by drag (swipe-back) + entrance (push slide-in)
            surfaceView(for: router.currentSurface)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(x: dragOffset + entranceOffset)
                .compositingGroup()
                .shadow(color: isShowingPrevious ? .black.opacity(0.06) : .clear,
                        radius: 4, x: -2)

            ScoutBottomBar()
                .offset(x: dragOffset)
        }
        .background(ScoutColors.backgroundAdaptive)
        .overlay {
            // Capture screen width once without triggering relayout during drag
            GeometryReader { geo in
                Color.clear.onAppear { screenWidth = geo.size.width }
                    .onChange(of: geo.size.width) { _, w in screenWidth = w }
            }
            .allowsHitTesting(false)
        }
        .overlay {
            // Disable swipe-back gesture while a push entrance is in flight
            if canSwipeBack && !isEntering {
                EdgeSwipeGesture(
                    edge: .left,
                    onChanged: { translation in
                        if !isDragging { isDragging = true }
                        dragOffset = translation
                    },
                    onEnded: { translation, velocity in
                        let commit = translation > screenWidth * 0.35 || velocity > 500

                        if commit {
                            withAnimation(.linear(duration: 0.15)) {
                                dragOffset = screenWidth
                            }
                            // Only call pop — onChange resets dragOffset/isDragging in the
                            // same render pass, avoiding the one-frame flash from resetting
                            // dragOffset before the stack change lands.
                            Task { @MainActor in
                                try? await Task.sleep(for: .milliseconds(150))
                                router.pop()
                            }
                        } else {
                            withAnimation(.interpolatingSpring(stiffness: 400, damping: 32)) {
                                dragOffset = 0
                            }
                            Task { @MainActor in
                                try? await Task.sleep(for: .milliseconds(250))
                                isDragging = false
                            }
                        }
                    }
                )
                .allowsHitTesting(true)
            }
        }
        .onChange(of: router.surfaceStack) { old, new in
            let isPush = new.count > old.count
            dragOffset = 0
            isDragging = false

            if isPush {
                // Commit the starting state in a non-animated transaction so SwiftUI
                // can't coalesce it with the spring block below. Without this, the
                // "set offset = screenWidth, then animate to 0" pair can collapse
                // into a net-zero diff and the spring animates from the wrong origin
                // — visible as the surface settling into place in two distinct beats.
                var start = Transaction()
                start.disablesAnimations = true
                withTransaction(start) {
                    isEntering = true
                    entranceOffset = screenWidth
                }

                // One critically-damped spring drives the whole entrance: current
                // surface slide-in, previous surface parallax retreat + opacity fade,
                // dim overlay, and shadow — a single smooth motion with no overshoot.
                withAnimation(.spring(response: 0.38, dampingFraction: 1.0)) {
                    entranceOffset = 0
                } completion: {
                    isEntering = false
                }
            } else {
                entranceOffset = 0
                isEntering = false
            }
        }
    }

    @ViewBuilder
    private func surfaceView(for surface: Surface) -> some View {
        switch surface {
        case .home:
            HomeView()
        case .inbox:
            InboxView()
        case .agents:
            AgentsView()
        case .activity:
            ActivityFeedView()
        case .tail:
            TailFeedView()
        case .sessionDetail(let sessionId):
            TimelineView(sessionId: sessionId)
        case .allSessions:
            AllSessionsGridView()
        case .newSession:
            WorkspaceBrowserView { sessionId in
                router.replaceTop(.sessionDetail(sessionId: sessionId))
            }
        case .agentDashboard(let agentId):
            AgentDashboardView(agentId: agentId)
        case .agentDetail(let agentId):
            AgentDetailView(agentId: agentId)
        case .settings:
            SettingsView()
        case .fleet:
            FleetView()
        case .nodeDetail(let id):
            NodeDetailView(nodeId: id)
        case .comms:
            ChannelsView()
        case .channel(let id):
            ChannelView(channelId: id)
        case .dm(let id):
            DMView(peerId: id)
        }
    }
}
