// EdgeSwipeGesture — UIKit edge pan recognizer bridged to SwiftUI.
//
// UIScreenEdgePanGestureRecognizer gets priority over scroll views,
// which a plain SwiftUI DragGesture does not.

import SwiftUI
import UIKit

struct EdgeSwipeGesture: UIViewRepresentable {
    let edge: UIRectEdge
    let onChanged: (CGFloat) -> Void  // translation.x
    let onEnded: (CGFloat, CGFloat) -> Void  // translation.x, velocity.x

    func makeUIView(context: Context) -> UIView {
        let view = EdgeSwipeView()
        let pan = UIScreenEdgePanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePan(_:))
        )
        pan.edges = edge
        view.addGestureRecognizer(pan)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onChanged = onChanged
        context.coordinator.onEnded = onEnded
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onChanged: onChanged, onEnded: onEnded)
    }

    class Coordinator: NSObject {
        var onChanged: (CGFloat) -> Void
        var onEnded: (CGFloat, CGFloat) -> Void

        init(onChanged: @escaping (CGFloat) -> Void,
             onEnded: @escaping (CGFloat, CGFloat) -> Void) {
            self.onChanged = onChanged
            self.onEnded = onEnded
        }

        @objc func handlePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
            guard let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view).x
            let velocity = recognizer.velocity(in: view).x

            switch recognizer.state {
            case .changed:
                onChanged(max(0, translation))
            case .ended, .cancelled:
                onEnded(max(0, translation), velocity)
            default:
                break
            }
        }
    }
}

/// Transparent view that passes touches through except for the edge gesture.
private class EdgeSwipeView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // Only capture touches in the left 24pt edge strip
        if point.x < 24 {
            return super.hitTest(point, with: event)
        }
        return nil
    }
}
