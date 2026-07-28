import SwiftUI
import HudsonUI

/// Scout layout metrics derived from the real phone width. The app keeps
/// standard iPhone as the roomy baseline, but the 13 mini gets native text/hit
/// sizes with tighter chrome instead of a blanket downscale.
struct ScoutLayoutMetrics: Equatable {
    let physicalWidth: CGFloat
    let designWidth: CGFloat
    let scale: CGFloat
    /// True when the window around us is a REGULAR-width environment — an iPad
    /// full screen or in a wide split. Keyed on the horizontal size class rather
    /// than the device idiom so a slide-over or a narrow split behaves exactly
    /// like a phone, and so a resize crosses the boundary live. Compact is the
    /// baseline: every metric below collapses to its phone value there.
    var isRegularWidth: Bool = false

    var isMiniPhone: Bool { physicalWidth > 0 && physicalWidth <= 380 }
    var isNarrowPhone: Bool { physicalWidth > 0 && physicalWidth < 390 }

    var titleHorizontalPadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var titleTopPadding: CGFloat { isNarrowPhone ? HudSpacing.sm : HudSpacing.sm }
    var titleBottomPadding: CGFloat { HudSpacing.xs }
    // A thin, small all-caps wordmark (set with wide tracking at the call site).
    // Kept compact so the masthead yields the top band to the host area.
    var wordmarkSize: CGFloat { isNarrowPhone ? 11.5 : 12.5 }
    var surfacePadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var surfaceTopPadding: CGFloat { isNarrowPhone ? HudSpacing.sm : HudSpacing.lg }
    var surfaceBottomPadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var surfaceSectionSpacing: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }

    var tabBarTopPadding: CGFloat { isNarrowPhone ? HudSpacing.xxs : HudSpacing.xs }
    // Tight side gutters so all six tabs (incl. the trailing "New") tile across a
    // native 393pt bar; the mini only fit them via its responsive downscale.
    var tabBarHorizontalPadding: CGFloat { HudSpacing.xs }
    // Slick: minimal top/bottom padding, a calm glyph — active state is carried
    // by accent color, not glyph heft. Kept low so the docked bar reads as a
    // trim strip (studio `.iTabs` ~52px total incl. safe area), not a slab.
    var tabButtonHeight: CGFloat { isNarrowPhone ? 42 : 44 }
    var tabGlyphSize: CGFloat { isNarrowPhone ? 16 : 16.5 }
    var tabLabelSize: CGFloat { isNarrowPhone ? HudTextSize.micro : HudTextSize.xxs }

    var statusSideInset: CGFloat { isNarrowPhone ? HudSpacing.xxxl : 42 }
    var statusCenterGap: CGFloat { isNarrowPhone ? HudSpacing.md : HudSpacing.lg }
    var statusMachineMaxLabelWidth: CGFloat { isNarrowPhone ? 72 : 120 }

    // MARK: - Regular width (iPad)

    /// The measure the WORKING COLUMN stops growing at. Scout's surfaces are
    /// authored against a ~360pt phone lane; running that same furniture out to
    /// 1000pt is exactly what makes an iPad read as a stretched phone — a
    /// full-bleed composer, a Connect card the width of the desk, and a void in
    /// between. Capping the column is the whole adaptation: the canvas, the
    /// masthead complications, and the tab bar all keep the full width.
    ///
    /// 660 by eye: wide enough that the composer and the destination rows feel
    /// like iPad furniture rather than a phone screenshot pasted on glass, and
    /// narrow enough that the recents lane still scans in one eye movement.
    var readableMeasure: CGFloat { 660 }

    /// Horizontal gutter for the working column. Compact: the surface padding,
    /// untouched. Regular: whatever centres a `readableMeasure` lane — but never
    /// less than the surface padding, so a regular-width window that is NARROWER
    /// than the measure (a 50/50 split on a big iPad) simply keeps the phone's
    /// full-bleed lane instead of inventing negative gutters.
    var contentInset: CGFloat {
        guard isRegularWidth else { return surfacePadding }
        return max(surfacePadding, (designWidth - readableMeasure) / 2)
    }

    /// The working column's own width — the regular-aware twin of the surfaces'
    /// `laneWidth`, and identical to it on every compact width.
    var contentWidth: CGFloat { max(0, designWidth - contentInset * 2) }
}

private struct ScoutLayoutMetricsKey: EnvironmentKey {
    static let defaultValue = ScoutLayoutMetrics(physicalWidth: 393, designWidth: 393, scale: 1)
}

extension EnvironmentValues {
    var scoutLayout: ScoutLayoutMetrics {
        get { self[ScoutLayoutMetricsKey.self] }
        set { self[ScoutLayoutMetricsKey.self] = newValue }
    }
}

/// Scout is authored against the standard iPhone width (393pt portrait), but
/// compact phones are real layout targets rather than compatibility-scaled
/// previews. `DesignFrame` publishes responsive metrics so app chrome can tighten
/// on the 13 mini while keeping native text size and 44pt tap targets.
///
/// - **Larger screens (≥ reference).** The optimized native target. No scaling:
///   the layout fills the available width fluidly at 1.0×. Standard, Plus, Pro,
///   and Pro Max all land here.
/// - **The 13 mini (375pt).** Native rendering with compact chrome metrics:
///   slightly tighter padding, shorter tab bar, and narrower status readouts.
/// - **Anything narrower than the mini.** Graceful degradation: lay out at the
///   mini width and uniformly shrink from there.
///
/// Implementation: lay the content out at either the real width or the mini
/// minimum, publish metrics, then apply shrink-only scaling for ultra-narrow
/// widths and claim the real footprint so the full-bleed canvas covers the edges.
struct DesignFrame<Content: View>: View {
    /// Width every surface is designed against — standard iPhone portrait.
    /// Devices at or above this render with roomy metrics.
    var referenceWidth: CGFloat = 393
    /// Smallest native phone target. The 13 mini is 375pt wide.
    var nativeMinimumWidth: CGFloat = 375

    /// Regular vs compact comes from the environment, not from the measured
    /// width: the system already accounts for split view, slide over, and Stage
    /// Manager, and reading it here means every surface downstream gets the
    /// answer through `scoutLayout` without touching the environment itself.
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private let content: (ScoutLayoutMetrics) -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = { _ in content() }
    }

    init(@ViewBuilder content: @escaping (ScoutLayoutMetrics) -> Content) {
        self.content = content
    }

    var body: some View {
        GeometryReader { proxy in
            let avail = proxy.size
            let scale = scale(forWidth: avail.width)
            // At ≥ reference we lay out at the device's own width (fluid fill);
            // between mini and reference we lay out natively with compact metrics;
            // below mini we lay out at the width that, once shrunk, exactly fills
            // the screen. Deriving the design width from the *floored* scale (rather
            // than pinning it to the mini) means the rendered footprint is always
            // `designWidth * scale == avail.width`, so an ultra-narrow phone (or a
            // resized "responsive" simulator) shrinks to fit instead of overflowing
            // and clipping both edges.
            let designWidth = scale < 1 ? avail.width / scale : avail.width
            let designHeight = scale > 0 ? avail.height / scale : avail.height
            let metrics = ScoutLayoutMetrics(
                physicalWidth: avail.width,
                designWidth: designWidth,
                scale: scale,
                isRegularWidth: horizontalSizeClass == .regular
            )

            content(metrics)
                .environment(\.scoutLayout, metrics)
                // Pin content to the top-leading corner (not top-center) so that if
                // anything ever lays out wider than the frame it clips off the right
                // edge — where a horizontal scroll can absorb it — instead of being
                // centered and clipping the leading edge (masthead, section labels).
                .frame(width: designWidth, height: designHeight, alignment: .topLeading)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: avail.width, height: avail.height, alignment: .topLeading)
        }
    }

    /// Shrink-only: `1.0` for mini and larger, the width ratio below the mini.
    /// Floored so a hypothetical ultra-narrow device can't shrink the UI into
    /// illegibility.
    private func scale(forWidth width: CGFloat) -> CGFloat {
        guard width > 0 else { return 1 }
        return max(0.84, min(1, width / nativeMinimumWidth))
    }
}
