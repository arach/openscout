import SwiftUI

/// A braille-cell activity spinner — the cockpit's answer to the stock
/// `ProgressView()` ring. Cycles the 8-dot braille frames in a monospaced cell
/// so it reads as terminal-native telemetry rather than a generic OS spinner.
///
/// Ported from talkie's `BrailleSpinner` (DebugKit), with a Scout tint + a
/// subtle opacity breathe so an active agent turn feels alive, not just busy.
/// Uses `TimelineView(.periodic)` so there's no timer/`@State` to manage and it
/// pauses automatically when the view is off-screen.
struct ScoutBrailleSpinner: View {
    var size: CGFloat = 13
    var speed: Double = 0.08
    var tint: Color = ScoutPalette.accent

    private static let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    var body: some View {
        TimelineView(.periodic(from: .now, by: speed)) { context in
            let elapsed = context.date.timeIntervalSinceReferenceDate
            let step = Int(elapsed / speed)
            let frame = ((step % Self.frames.count) + Self.frames.count) % Self.frames.count
            // Gentle 2-step breathe (1.0 → 0.78 → 1.0) keyed off the cycle so the
            // glyph pulses without a separate animation driver.
            let phase = Double(step % Self.frames.count) / Double(Self.frames.count)
            let breathe = 0.78 + 0.22 * (0.5 + 0.5 * cos(phase * 2 * .pi))
            Text(Self.frames[frame])
                .font(.system(size: size, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
                .opacity(breathe)
                .accessibilityLabel("Working")
        }
    }
}
