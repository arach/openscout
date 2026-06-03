import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Terminal — a quick shell into your paired Mac and agent workspaces. Scaffolded
/// console for now (a preview banner + prompt); the live PTY wires in later. The
/// point today is that the terminal has a permanent, easy-to-find home in the nav.
struct TerminalSurface: View {
    let client: any ScoutBrokerClient

    @State private var command = ""

    private let lines: [(String, Color)] = [
        ("scout terminal — connected to arachs-mac-mini", HudPalette.muted),
        ("", HudPalette.muted),
        ("$ scout agents --live", HudPalette.ink),
        ("openscout · hudson · narrative-studio · sco061 …", HudPalette.muted),
        ("$ scout tail --follow", HudPalette.ink),
        ("▏streaming activity across the fleet", HudPalette.accent),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            console
        }
        .background(HudPalette.bg)
        .safeAreaInset(edge: .bottom) { prompt }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "terminal")
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudTint.green.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("Terminal")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Text("arachs-mac-mini")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.muted)
            }
            Spacer()
            HudBadge("preview", tint: HudPalette.statusWarn)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.lg)
    }

    private var console: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line.0.isEmpty ? " " : line.0)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(line.1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
            .padding(HudSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
            .padding(.horizontal, HudSpacing.xxl)
        }
    }

    private var prompt: some View {
        HStack(spacing: HudSpacing.sm) {
            Text("$")
                .font(HudFont.mono(HudTextSize.sm, weight: .bold))
                .foregroundStyle(HudTint.green.color)
            TextField("run a command…", text: $command)
                .textFieldStyle(.plain)
                .font(HudFont.mono(HudTextSize.sm))
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
                .disabled(true)
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.md)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
        .padding(.horizontal, HudSpacing.lg)
        .padding(.bottom, HudSpacing.sm)
    }
}
