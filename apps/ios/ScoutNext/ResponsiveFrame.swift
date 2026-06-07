import SwiftUI
import HudsonUI

/// ScoutNext layout metrics derived from the real phone width. The app keeps
/// standard iPhone as the roomy baseline, but the 13 mini gets native text/hit
/// sizes with tighter chrome instead of a blanket downscale.
struct ScoutNextLayoutMetrics: Equatable {
    let physicalWidth: CGFloat
    let designWidth: CGFloat
    let scale: CGFloat

    var isMiniPhone: Bool { physicalWidth > 0 && physicalWidth <= 380 }
    var isNarrowPhone: Bool { physicalWidth > 0 && physicalWidth < 390 }

    var titleHorizontalPadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var titleTopPadding: CGFloat { isNarrowPhone ? HudSpacing.md : HudSpacing.lg }
    var titleBottomPadding: CGFloat { isNarrowPhone ? HudSpacing.md : HudSpacing.xl }
    var wordmarkSize: CGFloat { isNarrowPhone ? HudTextSize.xl : HudTextSize.xxl }
    var nextBadgeSize: CGFloat { isNarrowPhone ? HudTextSize.xxs : HudTextSize.xs }
    var nextBadgeTracking: CGFloat { isNarrowPhone ? 1.5 : 2 }

    var surfacePadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var surfaceTopPadding: CGFloat { isNarrowPhone ? HudSpacing.lg : HudSpacing.xxl }
    var surfaceBottomPadding: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }
    var surfaceSectionSpacing: CGFloat { isNarrowPhone ? HudSpacing.xl : HudSpacing.xxl }

    var tabBarTopPadding: CGFloat { isNarrowPhone ? HudSpacing.xs : HudSpacing.sm }
    var tabBarHorizontalPadding: CGFloat { isNarrowPhone ? HudSpacing.md : HudSpacing.lg }
    var tabButtonHeight: CGFloat { isNarrowPhone ? 44 : 48 }
    var tabGlyphSize: CGFloat { isNarrowPhone ? 19 : 21 }
    var tabLabelSize: CGFloat { isNarrowPhone ? HudTextSize.micro : HudTextSize.xxs }

    var statusSideInset: CGFloat { isNarrowPhone ? HudSpacing.xxxl : 42 }
    var statusCenterGap: CGFloat { isNarrowPhone ? HudSpacing.md : HudSpacing.lg }
    var statusMachineMaxLabelWidth: CGFloat { isNarrowPhone ? 72 : 120 }
}

private struct ScoutNextLayoutMetricsKey: EnvironmentKey {
    static let defaultValue = ScoutNextLayoutMetrics(physicalWidth: 393, designWidth: 393, scale: 1)
}

extension EnvironmentValues {
    var scoutNextLayout: ScoutNextLayoutMetrics {
        get { self[ScoutNextLayoutMetricsKey.self] }
        set { self[ScoutNextLayoutMetricsKey.self] = newValue }
    }
}

/// ScoutNext is authored against the standard iPhone width (393pt portrait), but
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

    private let content: (ScoutNextLayoutMetrics) -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = { _ in content() }
    }

    init(@ViewBuilder content: @escaping (ScoutNextLayoutMetrics) -> Content) {
        self.content = content
    }

    var body: some View {
        GeometryReader { proxy in
            let avail = proxy.size
            let scale = scale(forWidth: avail.width)
            // At ≥ reference we lay out at the device's own width (fluid fill);
            // between mini and reference we lay out natively with compact metrics;
            // below mini we lay out at the mini width and shrink to fit.
            let designWidth = scale < 1 ? nativeMinimumWidth : avail.width
            let designHeight = scale > 0 ? avail.height / scale : avail.height
            let metrics = ScoutNextLayoutMetrics(physicalWidth: avail.width, designWidth: designWidth, scale: scale)

            content(metrics)
                .environment(\.scoutNextLayout, metrics)
                .frame(width: designWidth, height: designHeight, alignment: .top)
                .scaleEffect(scale, anchor: .top)
                .frame(width: avail.width, height: avail.height, alignment: .top)
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
