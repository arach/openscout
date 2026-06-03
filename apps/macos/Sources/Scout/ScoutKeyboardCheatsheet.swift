import HudsonUI
import SwiftUI

/// Keyboard cheatsheet for the Scout desktop app, toggled by ⌘/ from Comms or
/// Agents. A scrim overlay listing the live chords so nothing has to be
/// guessed — the group matching the active section is emphasized. Mirrors the
/// menu-bar HUD's cheatsheet, restyled with Scout's Hudson tokens. Esc, ⌘/, or
/// a scrim tap dismisses.
struct ScoutKeyboardCheatsheet: View {
    let section: ScoutSection
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            ScoutDesign.bg.opacity(0.9)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            card
                .frame(maxWidth: 520)
                .padding(HudSpacing.xxl)

            // Esc / ⌘/ to close — kept live regardless of focus.
            Group {
                Button("", action: onDismiss).keyboardShortcut(.cancelAction)
                Button("", action: onDismiss).keyboardShortcut("/", modifiers: .command)
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HStack(alignment: .firstTextBaseline) {
                HudSectionLabel("Keyboard")
                Spacer()
                HStack(spacing: HudSpacing.xs) {
                    keyCap("⌘/")
                    Text("toggle")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.dim)
                }
            }

            keyGroup("Navigate · when not typing", active: false) {
                kbd("j  ↓  ·  k  ↑", "next / previous item")
                kbd("l  ·  h", "next / previous item")
                kbd("g  ·  ⇧G", "first / last item")
                kbd("⌘↑  ⌘↓", "next / previous (works while typing too)")
            }

            keyGroup("Comms", active: section == .comms) {
                kbd("⌘K", "focus search")
                kbd("⌘L", "focus composer")
                kbd("Esc", "leave composer (then j/k to navigate)")
                kbd("⌘1  ⌘2  ⌘3", "filter all / direct / shared")
                kbd("⌘R", "refresh")
                kbd("↵  ·  ⇧↵", "send  ·  newline (in composer)")
            }

            keyGroup("Agents", active: section == .agents) {
                kbd("⌘↩", "open agent's channel")
                kbd("⌘O", "observe agent")
            }

            keyGroup("Global", active: false) {
                kbd("?  ·  ⌘/", "toggle this help")
                kbd("Esc", "close help / dismiss suggestions")
            }

            HStack(spacing: HudSpacing.xs) {
                Spacer()
                keyCap("Esc")
                Text("to close")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.dim)
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.xl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutDesign.chrome)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: Color.black.opacity(0.3), radius: 24, y: 12)
    }

    private func keyGroup<Content: View>(
        _ title: String,
        active: Bool,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.xs) {
                HudSectionLabel(title)
                if active {
                    Text("active")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(HudPalette.accent)
                        .padding(.horizontal, HudSpacing.xs)
                        .padding(.vertical, 1)
                        .overlay(
                            RoundedRectangle(cornerRadius: HudRadius.tight)
                                .stroke(HudPalette.accent.opacity(0.55), lineWidth: HudStrokeWidth.thin)
                        )
                }
            }
            content()
                .opacity(active ? 1 : 0.78)
        }
    }

    private func kbd(_ key: String, _ desc: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            keyCap(key)
                .frame(minWidth: 96, alignment: .leading)
            Text(desc)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.muted)
            Spacer(minLength: 0)
        }
    }

    private func keyCap(_ key: String) -> some View {
        Text(key)
            .font(HudFont.mono(HudTextSize.xs, weight: .bold))
            .foregroundStyle(HudPalette.ink)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, 1.5)
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
    }
}
