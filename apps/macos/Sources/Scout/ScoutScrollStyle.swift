import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)

/// A thin, HUD-coherent overlay scroller. Subtly tinted, slot-less knob that
/// hugs the trailing edge so Scout's scroll areas read as intentional chrome
/// rather than the raw system scroller.
final class ScoutHudScroller: NSScroller {
    override class var isCompatibleWithOverlayScrollers: Bool { true }

    override func drawKnobSlot(in slotRect: NSRect, highlight flag: Bool) {
        // Slot-less: keep the bar minimal so it floats over HUD chrome.
    }

    override func drawKnob() {
        let knobRect = rect(for: .knob)
        guard knobRect.width > 0, knobRect.height > 0 else { return }

        // Pull the knob a hair off the very edge and slim it down.
        let thickness: CGFloat = 4
        let inset: CGFloat = 2
        let drawRect: NSRect
        if knobRect.width >= knobRect.height {
            // Horizontal scroller.
            drawRect = NSRect(
                x: knobRect.minX + inset,
                y: knobRect.maxY - thickness - inset,
                width: max(knobRect.width - inset * 2, thickness),
                height: thickness
            )
        } else {
            // Vertical scroller.
            drawRect = NSRect(
                x: knobRect.maxX - thickness - inset,
                y: knobRect.minY + inset,
                width: thickness,
                height: max(knobRect.height - inset * 2, thickness)
            )
        }

        let radius = thickness / 2
        let path = NSBezierPath(roundedRect: drawRect, xRadius: radius, yRadius: radius)
        NSColor.white.withAlphaComponent(0.22).setFill()
        path.fill()
    }
}

/// Invisible AppKit probe that restyles the enclosing `NSScrollView`'s
/// scrollers. SwiftUI otherwise honours the user's "Show scroll bars" setting,
/// which can render wide legacy scrollers that sit far from the panel edge in a
/// gray gutter. Forcing the overlay style + a slim tinted knob keeps every Scout
/// scroll area tight to its divider/border and visually consistent.
private struct ScoutScrollerStyler: NSViewRepresentable {
    func makeNSView(context: Context) -> ProbeView { ProbeView() }

    func updateNSView(_ nsView: ProbeView, context: Context) {
        nsView.applyStyle()
    }

    final class ProbeView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            applyStyle()
        }

        func applyStyle() {
            DispatchQueue.main.async { [weak self] in
                guard let scrollView = self?.enclosingScrollView else { return }
                scrollView.scrollerStyle = .overlay
                scrollView.scrollerInsets = NSEdgeInsetsZero
                scrollView.drawsBackground = false

                if !(scrollView.verticalScroller is ScoutHudScroller) {
                    let scroller = ScoutHudScroller()
                    scroller.scrollerStyle = .overlay
                    scrollView.verticalScroller = scroller
                }
                scrollView.verticalScroller?.scrollerStyle = .overlay
                scrollView.horizontalScroller?.scrollerStyle = .overlay
            }
        }
    }
}

extension View {
    /// Apply Scout's HUD overlay scrollbar treatment. Attach to the content
    /// *inside* a `ScrollView` so the probe can resolve the enclosing scroll
    /// view. Pairs with `.scrollIndicators(.visible)` on the `ScrollView`.
    func scoutOverlayScrollers() -> some View {
        background(
            ScoutScrollerStyler()
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
        )
    }
}

#else

extension View {
    func scoutOverlayScrollers() -> some View { self }
}

#endif
