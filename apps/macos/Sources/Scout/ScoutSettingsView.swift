import HudsonUI
import SwiftUI

private enum ScoutSettingsSection: String, CaseIterable, Identifiable {
    case appearance
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .appearance: return "Appearance"
        case .about: return "About"
        }
    }

    var icon: String {
        switch self {
        case .appearance: return "paintpalette"
        case .about: return "info.circle"
        }
    }

    var subtitle: String {
        switch self {
        case .appearance: return "Theme, accent, and window material."
        case .about: return "Local build details."
        }
    }
}

/// Native settings surface for the Scout desktop app.
struct ScoutSettingsView: View {
    @ObservedObject var appearance: ScoutAppearance
    @State private var selectedSection: ScoutSettingsSection = .appearance
    /// Accent currently hovered in the swatch row — previews into the theme
    /// cards when `previewAccentsOnHover` is on. Contained to this panel.
    @State private var hoverAccent: ScoutAccentPalette?

    /// The accent the theme-card swatches should render: the hover preview when
    /// active, otherwise the committed selection.
    private var previewAccent: ScoutAccentPalette {
        hoverAccent ?? appearance.accentPalette
    }

    private let settingsSidebarWidth: CGFloat = 190
    private let contentWidth: CGFloat = 820

    var body: some View {
        HStack(spacing: 0) {
            settingsSidebar
            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(width: HudStrokeWidth.thin)
            settingsContent
        }
        .background(ScoutDesign.bg)
    }

    private var settingsSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Settings")
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .padding(.horizontal, HudSpacing.xxl)
                .padding(.top, HudSpacing.xxxl)
                .padding(.bottom, HudSpacing.xl)

            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                ForEach(ScoutSettingsSection.allCases) { section in
                    settingsSidebarItem(section)
                }
            }
            .padding(.horizontal, HudSpacing.md)

            Spacer(minLength: 0)
        }
        .frame(width: settingsSidebarWidth)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.chrome)
    }

    private func settingsSidebarItem(_ section: ScoutSettingsSection) -> some View {
        let selected = selectedSection == section
        return Button {
            selectedSection = section
        } label: {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: section.icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(selected ? ScoutPalette.accent : ScoutPalette.muted)
                    .frame(width: 18)
                Text(section.title)
                    .font(HudFont.ui(HudTextSize.sm, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? ScoutPalette.ink : ScoutPalette.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, HudSpacing.md)
            .frame(height: 34)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(selected ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
            )
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: HudStrokeWidth.standard, style: .continuous)
                    .fill(selected ? ScoutPalette.accent : Color.clear)
                    .frame(width: HudStrokeWidth.bold)
                    .padding(.vertical, HudSpacing.xs)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(section.title)
    }

    private var settingsContent: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: HudSpacing.huge) {
                pageHeader
                selectedPage
            }
            .padding(.horizontal, HudSpacing.huge)
            .padding(.vertical, HudSpacing.xxxl)
            .frame(width: contentWidth, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollContentBackground(.hidden)
        .scoutOverlayScrollers()
    }

    private var pageHeader: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Image(systemName: selectedSection.icon)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
            Text(selectedSection.title)
                .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            Text(selectedSection.subtitle)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
        }
    }

    @ViewBuilder
    private var selectedPage: some View {
        switch selectedSection {
        case .appearance:
            appearancePage
        case .about:
            aboutPage
        }
    }

    private var appearancePage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.huge) {
            settingsBlock(title: "Theme") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("The preset sets the surfaces; mode and accent layer on top.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)

                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 220, maximum: 260), spacing: HudSpacing.md)],
                        alignment: .leading,
                        spacing: HudSpacing.md
                    ) {
                        ForEach(ScoutThemePreset.settingsCases) { preset in
                            themeButton(preset)
                        }
                    }
                }
            }

            settingsBlock(title: "Mode") {
                settingRow(title: "Appearance") {
                    Picker("Appearance", selection: $appearance.themeMode) {
                        ForEach(ScoutThemeMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 300)
                }
            }

            settingsBlock(title: "Accent") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("Tints actions, selection, and live state.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)

                    HStack(spacing: HudSpacing.xl) {
                        ForEach(ScoutAccentPalette.settingsCases) { palette in
                            accentDot(palette)
                        }
                    }
                    .frame(height: 28)
                }
            }

            settingsBlock(title: "Window Material") {
                settingRow(title: "Surface opacity") {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        HStack(spacing: HudSpacing.xl) {
                            Slider(
                                value: $appearance.windowOpacity,
                                in: ScoutAppearance.minOpacity...ScoutAppearance.maxOpacity
                            )
                            .tint(ScoutPalette.accent)
                            .frame(width: 360)

                            Text("\(Int((appearance.windowOpacity * 100).rounded()))%")
                                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                                .foregroundStyle(ScoutPalette.muted)
                                .monospacedDigit()
                                .frame(width: 42, alignment: .trailing)
                        }

                        HStack {
                            Text("Clear")
                            Spacer()
                            Text("Solid")
                        }
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .foregroundStyle(ScoutPalette.dim)
                        .frame(width: 360)
                    }
                }

                settingRow(title: "Preview accent on hover") {
                    Toggle("", isOn: $appearance.previewAccentsOnHover)
                        .toggleStyle(.switch)
                        .tint(ScoutPalette.accent)
                        .labelsHidden()
                }
            }
        }
    }

    private var aboutPage: some View {
        settingsBlock(title: "Scout") {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                aboutRow("Version", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")
                aboutRow("Bundle", Bundle.main.bundleIdentifier ?? "com.openscout.scout")
                aboutRow("Theme", appearance.themePreset.label)
                aboutRow("Accent", appearance.accentPalette.label)
            }
        }
    }

    private func settingsBlock<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            Text(title)
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            content()
        }
        .padding(.bottom, HudSpacing.xxl)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    private func settingRow<Control: View>(
        title: String,
        @ViewBuilder control: () -> Control
    ) -> some View {
        HStack(alignment: .center, spacing: HudSpacing.xxl) {
            Text(title)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .frame(width: 132, alignment: .leading)
            control()
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: HudLayout.rowHeightRegular, alignment: .leading)
    }

    private func themeButton(_ preset: ScoutThemePreset) -> some View {
        let selected = appearance.themePreset == preset
        return Button {
            appearance.themePreset = preset
        } label: {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    paletteSwatch(preset.lightPreview.applying(palette: previewAccent))
                    paletteSwatch(preset.darkPreview.applying(palette: previewAccent))
                    Spacer(minLength: 0)
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(selected ? ScoutPalette.accent : ScoutPalette.dim)
                }

                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(preset.label)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(selected ? ScoutPalette.ink : ScoutPalette.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text(preset.toneLabel.uppercased())
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .foregroundStyle(selected ? ScoutPalette.accent : ScoutPalette.dim)
                        .lineLimit(1)
                }
            }
            .padding(HudSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
            .background(tileFill(selected: selected))
            .overlay(tileStroke(selected: selected))
        }
        .buttonStyle(.plain)
        .help(preset.label)
    }

    /// Inline accent swatch — a tinted dot with a ring on the selected one.
    /// Replaces the old labeled tiles; the label moves to a tooltip + the row
    /// hint. Hovering (when enabled) previews the accent in the theme cards.
    private func accentDot(_ palette: ScoutAccentPalette) -> some View {
        let selected = appearance.accentPalette == palette
        return Button {
            appearance.accentPalette = palette
        } label: {
            Circle()
                .fill(palette.accent)
                .frame(width: 22, height: 22)
                .overlay(Circle().stroke(Color.white.opacity(0.16), lineWidth: HudStrokeWidth.thin))
                .overlay {
                    Circle()
                        .stroke(palette.accent, lineWidth: HudStrokeWidth.bold)
                        .padding(-3)
                        .opacity(selected ? 1 : 0)
                }
                .scaleEffect(hoverAccent == palette ? 1.14 : 1)
                .animation(.easeOut(duration: 0.12), value: hoverAccent)
                .contentShape(Rectangle())
                .padding(2)
        }
        .buttonStyle(.plain)
        .help(palette.label)
        .onHover { hovering in
            guard appearance.previewAccentsOnHover else {
                if hoverAccent != nil { hoverAccent = nil }
                return
            }
            if hovering {
                hoverAccent = palette
            } else if hoverAccent == palette {
                hoverAccent = nil
            }
        }
    }

    private func tileFill(selected: Bool) -> some ShapeStyle {
        selected ? AnyShapeStyle(ScoutPalette.accentSoft) : AnyShapeStyle(ScoutDesign.surface)
    }

    private func tileStroke(selected: Bool) -> some View {
        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
            .stroke(selected ? ScoutSurface.tintBorder(ScoutPalette.accent) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
    }

    private func paletteSwatch(_ colors: ScoutThemeColors) -> some View {
        HStack(spacing: 0) {
            Rectangle().fill(colors.bg)
            Rectangle().fill(colors.chrome)
            Rectangle().fill(colors.surface)
            Rectangle().fill(colors.accent)
        }
        .frame(width: 64, height: 16)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(colors.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
    }

    private func aboutRow(_ key: String, _ value: String) -> some View {
        HStack(spacing: HudSpacing.xxl) {
            Text(key)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .frame(width: 132, alignment: .leading)
            Text(value)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
    }
}
