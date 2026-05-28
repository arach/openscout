import SwiftUI

/// Toggled on/off by `?` (shift+/) from anywhere in the HUD. Lists the
/// keymap operator-side so nothing has to be guessed. Lives as a
/// transparent overlay on top of whatever tab is showing — covers the
/// panel body, leaves the masthead + dock visible (still the global
/// chrome). Esc or `?` again dismisses.
@MainActor
final class HUDCheatsheetState: ObservableObject {
    static let shared = HUDCheatsheetState()
    @Published var visible: Bool = false
    func toggle()  { visible.toggle() }
    func show()    { visible = true }
    func dismiss() { visible = false }
    private init() {}
}

struct HUDCheatsheetOverlay: View {
    @ObservedObject private var sheet = HUDCheatsheetState.shared

    var body: some View {
        if sheet.visible {
            ZStack {
                // Scrim — readable but doesn't fully hide the panel
                // behind, so the operator keeps spatial context.
                HUDChrome.canvas.opacity(0.88)
                    .onTapGesture { sheet.dismiss() }

                content
                    .frame(maxWidth: 540)
                    .padding(24)
            }
            .transition(.opacity)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                HUDEyebrow(text: "KEYMAP  ·  HUD", color: HUDChrome.inkFaint)
                Spacer()
                HStack(spacing: 4) {
                    Text("?")
                        .font(HUDType.mono(10, weight: .bold))
                        .foregroundStyle(HUDChrome.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2.5)
                                .stroke(HUDChrome.accent.opacity(0.55), lineWidth: 0.5)
                        )
                    Text("toggle")
                        .font(HUDType.mono(9))
                        .tracking(HUDType.eyebrowTracking)
                        .foregroundStyle(HUDChrome.inkFaint)
                }
            }

            section("Navigation") {
                kbd("j", "next row")
                kbd("k", "prev row")
                kbd("g", "top")
                kbd("⇧G", "bottom")
                kbd("↵", "engage row (and again to stage @target on dock)")
            }

            section("Tail") {
                kbd("f", "toggle live FOLLOW / PAUSED")
            }

            section("Tabs · Tier") {
                kbd("1 2 3 4 5", "agents · activity · tail · sessions · assistant")
                kbd("⌘← ⌘→", "tier down / up (S / M / L)")
                kbd("[ ]", "tier down / up")
            }

            section("Dock") {
                kbd("i", "focus the message dock (insert)")
                kbd("/", "focus dock and start a slash command")
                kbd("m", "toggle voice dictation — transcript lands in dock")
                kbd("↵", "send message")
                kbd("Esc", "cascade: clear text → target → blur → unengage → dismiss")
            }

            HStack(spacing: 6) {
                Spacer()
                Text("Esc")
                    .font(HUDType.mono(10, weight: .bold))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2.5)
                            .stroke(HUDChrome.border, lineWidth: 0.5)
                    )
                Text("to close")
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(HUDChrome.canvasAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(HUDChrome.borderStrong, lineWidth: 0.75)
        )
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HUDEyebrow(text: title.uppercased(), color: HUDChrome.inkFaint)
            content()
        }
    }

    private func kbd(_ key: String, _ desc: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(key)
                .font(HUDType.mono(11, weight: .bold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.horizontal, 6)
                .padding(.vertical, 1.5)
                .frame(minWidth: 64, alignment: .leading)
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(HUDChrome.border, lineWidth: 0.5)
                )
            Text(desc)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
            Spacer(minLength: 0)
        }
    }
}
