import SwiftUI
import HudsonUI

/// The vertical-rail settings shell (matching the HudsonKit settings concept):
/// a rotated-text tab rail on the left switches panels; the panel shows green
/// key→value rows, stat tiles, and tinted action affordances. Composed from
/// HudsonKit tokens since this shell isn't a packaged atom (yet).

/// Left-edge vertical tab rail with rotated labels. Selecting switches the panel.
struct SettingsTabRail: View {
    let tabs: [String]
    @Binding var selection: String

    var body: some View {
        VStack(spacing: 0) {
            ForEach(tabs, id: \.self) { tab in
                Button { selection = tab } label: {
                    Text(tab)
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(2)
                        .fixedSize()
                        .rotationEffect(.degrees(-90))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .foregroundStyle(tab == selection ? HudPalette.accent : HudPalette.dim)
                        .background(tab == selection ? HudPalette.accent.opacity(0.08) : Color.clear)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(tab == selection ? HudPalette.accent : Color.clear)
                                .frame(width: 2)
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .frame(width: 54)
        .frame(maxHeight: .infinity)
        .overlay(alignment: .trailing) {
            Rectangle().fill(HudHairline.standard).frame(width: 1)
        }
    }
}

/// A flat key→value row: "Title · subtitle" on the left, a tinted value (and
/// optional accessory glyph) right-aligned. Hairline divider drawn below.
struct SettingsValueRow: View {
    let title: String
    var subtitle: String? = nil
    let value: String
    var valueTint: Color = HudTint.green.color
    var accessory: String? = nil
    var onTap: (() -> Void)? = nil

    var body: some View {
        let row = HStack(spacing: HudSpacing.md) {
            HStack(spacing: HudSpacing.sm) {
                Text(title)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(HudPalette.ink)
                if let subtitle {
                    Text("· \(subtitle)")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: HudSpacing.lg)
            Text(value)
                .font(HudFont.ui(HudTextSize.md, weight: .medium))
                .foregroundStyle(valueTint)
            if let accessory {
                Image(systemName: accessory)
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(HudPalette.dim)
            }
        }
        .padding(.vertical, HudSpacing.lg)
        .contentShape(Rectangle())

        VStack(spacing: 0) {
            if let onTap {
                Button(action: onTap) { row }.buttonStyle(.plain)
            } else {
                row
            }
            Rectangle().fill(HudHairline.subtle).frame(height: 1)
        }
    }
}

/// Three (or more) equal-width stat tiles separated by vertical hairlines:
/// a small tracked label over a large value. The screenshot's NODES/LIVE/LOOP.
struct SettingsStatTiles: View {
    let tiles: [(label: String, value: String)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { index, tile in
                VStack(spacing: HudSpacing.xs) {
                    Text(tile.label)
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(HudPalette.muted)
                    Text(tile.value)
                        .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                }
                .frame(maxWidth: .infinity)
                if index < tiles.count - 1 {
                    Rectangle().fill(HudHairline.standard).frame(width: 1, height: 36)
                }
            }
        }
        .padding(.vertical, HudSpacing.xl)
    }
}

/// A settings panel: a breadcrumb header + grouped sections, scrolling.
struct SettingsPanel<Content: View>: View {
    let breadcrumb: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                Text(breadcrumb)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(2)
                    .foregroundStyle(HudPalette.dim)
                content()
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A labelled group of rows inside a panel.
struct SettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel(title)
            VStack(spacing: 0) { content() }
        }
    }
}

/// The shell chrome: a "APP · SETTINGS context" title row above the rail+panel.
struct SettingsShell<Panel: View>: View {
    let app: String
    let context: String
    let tabs: [String]
    @Binding var selection: String
    @ViewBuilder let panel: () -> Panel
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                Text(app)
                    .font(HudFont.ui(HudTextSize.lg, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(HudPalette.ink)
                Text("· SETTINGS")
                    .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(HudPalette.muted)
                Text(context)
                    .font(HudFont.mono(HudTextSize.xs))
                    .tracking(2)
                    .foregroundStyle(HudPalette.dim)
                Spacer()
                Button { onDone() } label: {
                    Image(systemName: "xmark")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(HudPalette.muted)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(HudSurface.inset))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.top, HudSpacing.xl)
            .padding(.bottom, HudSpacing.lg)

            HStack(spacing: 0) {
                SettingsTabRail(tabs: tabs, selection: $selection)
                panel()
            }
        }
        .background(HudPalette.bg)
        .preferredColorScheme(.dark)
    }
}
