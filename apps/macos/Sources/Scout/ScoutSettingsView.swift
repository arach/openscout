import HudsonUI
import SwiftUI

/// Native appearance settings for the Scout desktop app — replaces the old
/// jump out to the web `/settings` page. v1 controls window transparency;
/// theme (light/dark) and editable design tokens land alongside the adaptive
/// palette. Styled with the same Hud tokens as the rest of the app.
struct ScoutSettingsView: View {
    @ObservedObject var appearance: ScoutAppearance
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
            header
            opacitySection
            Spacer(minLength: 0)
            footerNote
        }
        .padding(HudSpacing.xxxl)
        .frame(width: 440, height: 320)
        .background(ScoutDesign.surface)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text("APPEARANCE")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(HudPalette.dim)
                Text("Settings")
                    .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
            }
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(HudFont.ui(HudTextSize.sm, weight: .bold))
                    .foregroundStyle(HudPalette.muted)
                    .frame(width: 24, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .fill(HudSurface.hover)
                    )
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .help("Close")
        }
    }

    private var opacitySection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack {
                Text("Window opacity")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                Spacer()
                Text("\(Int((appearance.windowOpacity * 100).rounded()))%")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
                    .monospacedDigit()
            }
            Slider(
                value: $appearance.windowOpacity,
                in: ScoutAppearance.minOpacity...ScoutAppearance.maxOpacity
            )
            .tint(HudPalette.accent)
            Text("Lower lets more of your desktop show through the window.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(HudPalette.dim)
        }
        .padding(HudSpacing.xl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutDesign.bg)
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )
        )
    }

    private var footerNote: some View {
        Text("Theme (light / dark) and editable design tokens are coming next.")
            .font(HudFont.ui(HudTextSize.xs))
            .foregroundStyle(HudPalette.dim)
    }
}
