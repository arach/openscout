// ScoutNavigationShell — Root container for Safari-style single-surface navigation.
//
// ZStack with surface content switching on router state,
// ScoutBottomBar always mounted at the bottom, and
// interactive edge-swipe-back via UIScreenEdgePanGestureRecognizer.
//
// Performance:
// - .drawingGroup() flattens each surface into a single Metal texture during drag
// - .compositingGroup() prevents per-frame recomposition of deep view trees
// - Previous surface is kept alive (but hidden) so it's pre-rendered for swipe
// - Shadow only applied when dragging, and uses a simple offset (no blur radius ramp)
// - GeometryReader width cached in @State to avoid relayout during drag

import SwiftUI

struct ScoutNavigationShell: View {
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var dragOffset: CGFloat = 0
    @State private var isDragging = false
    @State private var screenWidth: CGFloat = UIScreen.main.bounds.width

    private var canSwipeBack: Bool { router.canGoBack }

    private var previousSurface: Surface? {
        let stack = router.surfaceStack
        guard stack.count >= 2 else { return nil }
        return stack[stack.count - 2]
    }

    /// Normalized drag progress 0...1
    private var dragProgress: Double {
        guard screenWidth > 0 else { return 0 }
        return min(1, max(0, Double(dragOffset / screenWidth)))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Previous surface — always in the tree when stack > 1 so it's pre-rendered.
            // Hidden via opacity when not dragging (costs nothing, avoids layout thrash on drag start).
            if let previousSurface {
                surfaceView(for: previousSurface)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .offset(x: isDragging ? -screenWidth * 0.3 * (1 - dragProgress) : 0)
                    .overlay {
                        Color.black.opacity(isDragging ? 0.1 * (1 - dragProgress) : 0)
                            .allowsHitTesting(false)
                    }
                    .opacity(isDragging ? 1 : 0)
                    .allowsHitTesting(false)
                    .compositingGroup()
            }

            // Current surface
            surfaceView(for: router.currentSurface)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(x: dragOffset)
                .compositingGroup()
                .shadow(color: isDragging ? .black.opacity(0.06) : .clear,
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
            if canSwipeBack {
                EdgeSwipeGesture(
                    edge: .left,
                    onChanged: { translation in
                        if !isDragging { isDragging = true }
                        dragOffset = translation
                    },
                    onEnded: { translation, velocity in
                        let commit = translation > screenWidth * 0.35 || velocity > 500

                        if commit {
                            // Use a fast linear animation for the finish — feels snappier
                            withAnimation(.linear(duration: 0.15)) {
                                dragOffset = screenWidth
                            }
                            // Use Transaction completion via task
                            Task { @MainActor in
                                try? await Task.sleep(for: .milliseconds(150))
                                dragOffset = 0
                                isDragging = false
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
        .onChange(of: router.currentSurface) { _, _ in
            dragOffset = 0
            isDragging = false
        }
    }

    @ViewBuilder
    private func surfaceView(for surface: Surface) -> some View {
        switch surface {
        case .home:
            HomeView()
        case .agents:
            AgentsView()
        case .activity:
            ActivityFeedView()
        case .sessionDetail(let sessionId):
            TimelineView(sessionId: sessionId)
        case .allSessions:
            AllSessionsGridView()
        case .newSession:
            WorkspaceBrowserView { sessionId in
                router.replaceTop(.sessionDetail(sessionId: sessionId))
            }
        case .agentDetail(let agentId):
            AgentDetailView(agentId: agentId)
        case .settings:
            SettingsView()
        }
    }
}
