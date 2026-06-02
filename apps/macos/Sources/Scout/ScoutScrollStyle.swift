import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)

enum ScoutScrollbarMetrics {
    /// Width of the reserved scroller lane (content is inset by this).
    static let laneWidth: CGFloat = 12
    /// Thickness of the knob/track pill within the lane.
    static let pillThickness: CGFloat = 6
    /// Inset of the pill from the ends of the track.
    static let pillInset: CGFloat = 2
    static let knobAlpha: CGFloat = 0.34
    static let trackAlpha: CGFloat = 0.07
}

/// A slim, HUD-coherent scroller. Draws a persistent faint track plus a brighter
/// rounded knob so it's always clear a scroll area exists, while staying tight to
/// the panel edge via a narrow reserved lane.
final class ScoutHudScroller: NSScroller {
    override class var isCompatibleWithOverlayScrollers: Bool { true }

    /// Keep the reserved lane narrow so content sits tight to the divider/border.
    override class func scrollerWidth(
        for controlSize: NSControl.ControlSize,
        scrollerStyle: NSScroller.Style
    ) -> CGFloat {
        ScoutScrollbarMetrics.laneWidth
    }

    override func drawKnobSlot(in slotRect: NSRect, highlight flag: Bool) {
        let pill = pillRect(in: slotRect)
        let radius = min(pill.width, pill.height) / 2
        NSColor.white.withAlphaComponent(ScoutScrollbarMetrics.trackAlpha).setFill()
        NSBezierPath(roundedRect: pill, xRadius: radius, yRadius: radius).fill()
    }

    override func drawKnob() {
        let knobRect = rect(for: .knob)
        guard knobRect.width > 0, knobRect.height > 0 else { return }
        let pill = pillRect(in: knobRect)
        let radius = min(pill.width, pill.height) / 2
        NSColor.white.withAlphaComponent(ScoutScrollbarMetrics.knobAlpha).setFill()
        NSBezierPath(roundedRect: pill, xRadius: radius, yRadius: radius).fill()
    }

    /// Slim pill centered within the lane, inset from the track ends.
    private func pillRect(in rect: NSRect) -> NSRect {
        let thickness = ScoutScrollbarMetrics.pillThickness
        let inset = ScoutScrollbarMetrics.pillInset
        let vertical = bounds.height >= bounds.width
        if vertical {
            return NSRect(
                x: rect.midX - thickness / 2,
                y: rect.minY + inset,
                width: thickness,
                height: max(rect.height - inset * 2, thickness)
            )
        } else {
            return NSRect(
                x: rect.minX + inset,
                y: rect.midY - thickness / 2,
                width: max(rect.width - inset * 2, thickness),
                height: thickness
            )
        }
    }
}

/// Invisible AppKit probe that restyles the enclosing `NSScrollView`'s
/// scrollers. SwiftUI otherwise honours the user's "Show scroll bars" setting,
/// which can render wide gray legacy scrollers or auto-hiding overlay scrollers
/// that give no persistent hint the area scrolls. We pin a slim legacy-style
/// scroller (always visible while scrollable, with a faint track) so every Scout
/// scroll area reads as deliberate HUD chrome and stays tight to its edge.
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
                // Legacy style keeps the bar persistently visible while the area
                // is scrollable, instead of fading like overlay scrollers.
                scrollView.scrollerStyle = .legacy
                scrollView.autohidesScrollers = true
                scrollView.scrollerInsets = NSEdgeInsetsZero
                scrollView.drawsBackground = false

                if !(scrollView.verticalScroller is ScoutHudScroller) {
                    let scroller = ScoutHudScroller()
                    scroller.scrollerStyle = .legacy
                    scrollView.verticalScroller = scroller
                }
                scrollView.verticalScroller?.scrollerStyle = .legacy
                scrollView.horizontalScroller?.scrollerStyle = .legacy
            }
        }
    }
}

extension View {
    /// Apply Scout's HUD scrollbar treatment. Attach to the content *inside* a
    /// `ScrollView` so the probe can resolve the enclosing scroll view. Pairs
    /// with `.scrollIndicators(.visible)` on the `ScrollView`.
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
