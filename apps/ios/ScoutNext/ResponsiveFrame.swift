import SwiftUI

/// ScoutNext is authored against a single reference width — the standard iPhone
/// (393pt portrait). `DesignFrame` is the responsive envelope that honors that
/// contract so every surface can be tuned once, for the optimized (larger)
/// canvas, and still render correctly on the small one.
///
/// - **Larger screens (≥ reference).** The optimized native target. No scaling:
///   the layout fills the available width fluidly at 1.0×. Standard, Plus, Pro,
///   and Pro Max all land here.
/// - **The 13 mini (375pt) — and any narrower device.** Graceful degradation:
///   the whole UI is laid out at the 393pt reference and uniformly scaled down
///   to fit (≈0.95×). Proportions stay pixel-identical — nothing is re-tuned
///   per device. Because the mini shares the standard aspect ratio almost
///   exactly (375×812 ≈ 2.165 vs 393×852 ≈ 2.168), the single width-ratio
///   scale fits both dimensions, so the bottom-docked chrome stays flush.
///
/// Implementation: lay the content out at the design width and a height that,
/// once scaled, exactly fills the available height (no letterbox); apply the
/// uniform `scaleEffect`; then claim the real available footprint so siblings
/// (the full-bleed canvas) cover the physical edges.
struct DesignFrame<Content: View>: View {
    /// Width every surface is designed against — standard iPhone portrait.
    /// Devices at or above this render natively; narrower ones scale down.
    var referenceWidth: CGFloat = 393

    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { proxy in
            let avail = proxy.size
            let scale = scale(forWidth: avail.width)
            // At ≥ reference we lay out at the device's own width (fluid fill);
            // below it we lay out at the fixed reference and shrink to fit.
            let designWidth = scale < 1 ? referenceWidth : avail.width
            let designHeight = scale > 0 ? avail.height / scale : avail.height

            content()
                .frame(width: designWidth, height: designHeight, alignment: .top)
                .scaleEffect(scale, anchor: .top)
                .frame(width: avail.width, height: avail.height, alignment: .top)
        }
    }

    /// Shrink-only: `1.0` for the optimized large canvas, the width ratio below
    /// the reference. Floored so a hypothetical ultra-narrow device can't shrink
    /// the UI into illegibility.
    private func scale(forWidth width: CGFloat) -> CGFloat {
        guard width > 0 else { return 1 }
        return max(0.8, min(1, width / referenceWidth))
    }
}
