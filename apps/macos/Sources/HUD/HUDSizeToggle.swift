import SwiftUI

// Three-position segmented control — compact · medium · large.
// Sits in the masthead's right cluster. Mirrors the studio's
// HudSizeToggle.tsx: same labels, same affordance, same visual weight.
//
// Selected = lime accent on canvasAlt fill; idle = inkFaint on canvas.
// Tap any segment to jump; the global `[` / `]` hotkey also walks it.

struct HUDSizeToggle: View {
    @ObservedObject var state = HUDState.shared

    var body: some View {
        HStack(spacing: 0) {
            ForEach(HUDSize.allCases) { size in
                Button(action: { state.setSize(size) }) {
                    Text(size.label)
                        .font(HUDType.mono(9, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(
                            state.size == size
                                ? HUDChrome.accent
                                : HUDChrome.inkFaint
                        )
                        .frame(width: 18, height: 16)
                        .background(
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(
                                    state.size == size
                                        ? HUDChrome.canvasAlt
                                        : Color.clear
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(HUDChrome.border, lineWidth: 0.75)
        )
    }
}
