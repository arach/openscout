import HudsonUI
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI

private enum ScoutSettingsSection: String, CaseIterable, Identifiable {
    case appearance
    case terminal
    case voice
    case notifications
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .appearance: return "Appearance"
        case .terminal: return "Terminal"
        case .voice: return "Voice"
        case .notifications: return "Notifications"
        case .about: return "About"
        }
    }

    var icon: String {
        switch self {
        case .appearance: return "paintpalette"
        case .terminal: return "terminal"
        case .voice: return "waveform"
        case .notifications: return "bell"
        case .about: return "info.circle"
        }
    }

    var subtitle: String {
        switch self {
        case .appearance: return "Theme, accent, and window material."
        case .terminal: return "Workspace view, font, and shell presentation."
        case .voice: return "Dictation engine and live capture state."
        case .notifications: return "How Scout tells you an agent needs you."
        case .about: return "Local build details."
        }
    }
}

/// Native settings surface for the Scout desktop app.
struct ScoutSettingsView: View {
    @ObservedObject var appearance: ScoutAppearance
    @ObservedObject private var attention = ScoutAttentionCenter.shared
    @ObservedObject private var voice = ScoutRemoteVoiceService.shared
    /// When the dictation engine entered its current state — drives the live
    /// duration counter that makes a hung state self-evident.
    @State private var voiceStateEnteredAt = Date()
    @State private var voiceInputDevices: [ScoutVoiceInputDevice] = []
    @State private var voiceInputDeviceId: String = ""
    @AppStorage(ScoutTerminalSettings.rendererKey) private var terminalRenderer = ScoutTerminalRenderer.xterm.rawValue
    @AppStorage(ScoutTerminalSettings.fontFamilyKey) private var terminalFontFamily = ScoutTerminalSettings.defaultFontFamily
    @AppStorage(ScoutTerminalSettings.fontSizeKey) private var terminalFontSize = ScoutTerminalSettings.defaultFontSize
    @AppStorage(ScoutTerminalSettings.showNativeHeadersKey) private var showNativeTerminalHeaders = true
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
            // Cap the readable width but let it shrink so the panel never
            // overflows its viewport — a hard `width:` clipped the theme grid's
            // right edge when the window was narrower than `contentWidth`.
            .frame(maxWidth: contentWidth, alignment: .topLeading)
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
        case .terminal:
            terminalPage
        case .voice:
            voicePage
        case .notifications:
            notificationsPage
        case .about:
            aboutPage
        }
    }

    private var terminalPage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
            settingsBlock(title: "Workspace canvas") {
                settingRow(title: "Show first") {
                    Picker("Visible shell renderer", selection: $terminalRenderer) {
                        ForEach(ScoutTerminalRenderer.allCases, id: \.rawValue) { renderer in
                            Text(renderer.title).tag(renderer.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                    .tint(ScoutPalette.accent)
                    .labelsHidden()
                    .frame(width: 300)
                }
            }

            settingsBlock(title: "Typography") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("The same font is used by native terminals and Xterm. Nerd Fonts include Powerline and prompt glyphs.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)

                    settingRow(title: "Font") {
                        Picker("Terminal font", selection: $terminalFontFamily) {
                            ForEach(terminalFontChoices, id: \.self) { family in
                                Text(family).tag(family)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 300)
                    }

                    settingRow(title: "Size") {
                        HStack(spacing: HudSpacing.xl) {
                            Slider(value: $terminalFontSize, in: 9...24, step: 1)
                                .tint(ScoutPalette.accent)
                                .frame(width: 300)
                            Text("\(Int(terminalFontSize.rounded())) pt")
                                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                                .foregroundStyle(ScoutPalette.muted)
                                .monospacedDigit()
                                .frame(width: 42, alignment: .trailing)
                        }
                    }

                    settingRow(title: "Preview") {
                        Text("  ~/dev/openscout    git:main  ")
                            .font(.custom(terminalFontFamily, size: terminalFontSize))
                            .foregroundStyle(ScoutPalette.ink)
                            .padding(.horizontal, HudSpacing.md)
                            .frame(height: 36)
                            .background(
                                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                                    .fill(ScoutDesign.surface)
                            )
                    }
                }
            }

            settingsBlock(title: "Tiles") {
                settingRow(title: "Native headers") {
                    Toggle("Show native terminal tile headers", isOn: $showNativeTerminalHeaders)
                        .toggleStyle(.switch)
                        .tint(ScoutPalette.accent)
                        .labelsHidden()
                }
            }
        }
    }

    private var terminalFontChoices: [String] {
        let choices = ScoutTerminalSettings.availableFontFamilies
        return choices.contains(terminalFontFamily) ? choices : [terminalFontFamily] + choices
    }

    private var voicePage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
            settingsBlock(title: "Dictation") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("Speak into the composer and Scout types for you. This shows what the mic is doing right now.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)

                    DictationEngineStateView(
                        state: voice.state,
                        partial: voice.partial,
                        enteredAt: voiceStateEnteredAt,
                        onReset: { voice.cancel() }
                    )
                }
            }

            settingsBlock(title: "Microphone") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    micAccessRow

                    settingRow(title: "Input") {
                        if voiceInputDevices.isEmpty {
                            Text("No inputs detected")
                                .font(HudFont.mono(HudTextSize.xs))
                                .foregroundStyle(ScoutPalette.muted)
                        } else {
                            Picker("Input device", selection: $voiceInputDeviceId) {
                                ForEach(voiceInputDevices, id: \.id) { device in
                                    Text(device.isDefault ? "\(device.name) (system default)" : device.name)
                                        .tag(device.id)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 300)
                            .onChange(of: voiceInputDeviceId) { _, newValue in
                                ScoutVoiceSettingsStore.saveInputDeviceId(newValue.isEmpty ? nil : newValue)
                            }
                        }
                    }

                    Text("Dictation follows your system default unless you pick a device here.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
        }
        .onChange(of: voice.state) { _, _ in
            voiceStateEnteredAt = Date()
        }
        .task { loadVoiceInputs() }
    }

    private var micAccessRow: some View {
        let mic = ScoutVoicePermissions.microphoneStatus()
        let tint = mic.granted
            ? ScoutPalette.statusOk
            : (mic.isTerminal ? ScoutPalette.statusError : ScoutPalette.statusWarn)
        return settingRow(title: "Access") {
            HStack(spacing: HudSpacing.sm) {
                Circle()
                    .fill(tint)
                    .frame(width: 7, height: 7)
                Text(mic.granted ? "Granted" : mic.displayStatus)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(tint)
                if !mic.granted {
                    Button("Open mic settings") {
                        ScoutVoicePermissions.openMicrophonePrivacySettings()
                    }
                    .buttonStyle(.plain)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                }
            }
        }
    }

    private func loadVoiceInputs() {
        voiceInputDevices = ScoutVoiceSettingsStore.listInputDevices()
        voiceInputDeviceId = ScoutVoiceSettingsStore.loadInputDeviceId()
            ?? voiceInputDevices.first(where: { $0.isDefault })?.id
            ?? voiceInputDevices.first?.id
            ?? ""
    }

    private var notificationsPage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
            settingsBlock(title: "Attention") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("Scout can nudge you when an agent is waiting on your input.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)

                    settingRow(title: "Needs you") {
                        Toggle("Notify when an agent needs you", isOn: $attention.notificationsEnabled)
                            .toggleStyle(.switch)
                            .tint(ScoutPalette.accent)
                            .labelsHidden()
                    }

                    settingRow(title: "Sound") {
                        Toggle("Play sound", isOn: $attention.soundEnabled)
                            .toggleStyle(.switch)
                            .tint(ScoutPalette.accent)
                            .labelsHidden()
                            .disabled(!attention.notificationsEnabled)
                    }

                    settingRow(title: "Dock icon") {
                        Toggle("Show count on Dock icon", isOn: $attention.dockBadgeEnabled)
                            .toggleStyle(.switch)
                            .tint(ScoutPalette.accent)
                            .labelsHidden()
                    }

                    if attention.authorizationDenied {
                        HStack(spacing: HudSpacing.sm) {
                            Text("Notifications are turned off in System Settings.")
                                .font(HudFont.ui(HudTextSize.xs))
                                .foregroundStyle(ScoutPalette.muted)
                            Button("Open System Settings") {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                            .buttonStyle(.link)
                            .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                            .tint(ScoutPalette.accent)
                        }
                        .padding(.top, HudSpacing.xs)
                    }
                }
            }
        }
    }

    private var appearancePage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
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
                    .tint(ScoutPalette.accent)
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

                    // How loudly the accent is spent on stateful fills. Quiet
                    // keeps your turns and charts on a wash; Vivid fills them.
                    HStack(spacing: HudSpacing.xl) {
                        Picker("Accent volume", selection: $appearance.accentVolume) {
                            ForEach(ScoutAccentVolume.allCases) { volume in
                                Text(volume.label).tag(volume)
                            }
                        }
                        .pickerStyle(.segmented)
                        .tint(ScoutPalette.accent)
                        .labelsHidden()
                        .frame(width: 160)

                        Text(appearance.accentVolume == .quiet
                            ? "Your turns and charts sit on a soft wash."
                            : "Your turns and charts take the full accent.")
                            .font(HudFont.ui(HudTextSize.xs))
                            .foregroundStyle(ScoutPalette.dim)
                    }
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
        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
            settingsBlock(title: "Scout") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    aboutRow("Version", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")
                    aboutRow("Bundle", Bundle.main.bundleIdentifier ?? "app.openscout.scout")
                    aboutRow("Theme", appearance.themePreset.label)
                    aboutRow("Accent", appearance.accentPalette.label)
                }
            }

            settingsBlock(title: "Embeddable surfaces") {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text("Web screens that exported scoutSurface.embed and have a native host row in ScoutEmbedSurfaceRegistry.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(ScoutEmbedSurfaceRegistry.embeddable) { surface in
                        VStack(alignment: .leading, spacing: HudSpacing.xs) {
                            HStack(spacing: HudSpacing.sm) {
                                Image(systemName: surface.systemImage)
                                    .foregroundStyle(ScoutPalette.accent)
                                Text(surface.label)
                                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                                    .foregroundStyle(ScoutPalette.ink)
                                Text(surface.id.rawValue)
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .foregroundStyle(ScoutPalette.dim)
                            }
                            aboutRow("Shell", surface.shellPath)
                            aboutRow("Embed", surface.embedPath)
                            aboutRow("Profile", surface.profile)
                        }
                        .padding(.vertical, HudSpacing.xs)
                    }
                }
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

/// A transparent, real-time readout of the dictation state machine. Renders the
/// current `ScoutDictationState`, the linear capture pipeline with the active
/// stage highlighted, a live duration counter that turns amber once a transient
/// state overruns its watchdog ceiling, and an always-reachable Reset. Engine-
/// agnostic: takes plain values so any voice surface can host it.
private struct DictationEngineStateView: View {
    let state: ScoutDictationState
    let partial: String
    let enteredAt: Date
    let onReset: () -> Void

    private struct Stage: Identifiable {
        let id: String
        let label: String
        let isCurrent: Bool
    }

    private var stages: [Stage] {
        [
            Stage(id: "idle", label: "Idle", isCurrent: state == .idle),
            Stage(id: "starting", label: "Starting", isCurrent: state == .starting),
            Stage(id: "recording", label: "Recording", isCurrent: state == .recording),
            Stage(id: "processing", label: "Processing", isCurrent: state == .processing),
        ]
    }

    private var isActive: Bool { state.isCaptureActive || state.isProcessing }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            header
            descriptionLine
            pipelineSection
        }
        .padding(HudSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutDesign.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(borderColor, lineWidth: HudStrokeWidth.thin)
        )
    }

    private var header: some View {
        HStack(spacing: HudSpacing.sm) {
            Circle()
                .fill(Self.color(for: state))
                .frame(width: 10, height: 10)

            Text(Self.humanTitle(state))
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            if isActive {
                TimelineView(.periodic(from: enteredAt, by: 1)) { context in
                    let elapsed = max(0, context.date.timeIntervalSince(enteredAt))
                    Text(Self.elapsedLabel(elapsed))
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Self.isStuck(state: state, elapsed: elapsed)
                            ? ScoutPalette.statusWarn
                            : ScoutPalette.muted)
                }
            }

            Spacer(minLength: 0)

            if isActive {
                Button("Reset", action: onReset)
                    .buttonStyle(.plain)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
            }
        }
    }

    private var pipelineSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text("CAPTURE FLOW")
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ScoutPalette.dim)
            pipeline
        }
    }

    private var pipeline: some View {
        HStack(spacing: HudSpacing.xs) {
            ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                if index > 0 {
                    Rectangle()
                        .fill(ScoutDesign.hairline)
                        .frame(width: 14, height: HudStrokeWidth.thin)
                }
                stageChip(stage)
            }
        }
        .opacity(state.isUnavailable ? 0.4 : 1)
    }

    private func stageChip(_ stage: Stage) -> some View {
        Text(stage.label.uppercased())
            .font(HudFont.mono(HudTextSize.micro, weight: stage.isCurrent ? .bold : .medium))
            .tracking(0.4)
            .foregroundStyle(stage.isCurrent ? ScoutPalette.ink : ScoutPalette.dim)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(stage.isCurrent ? ScoutSurface.selected(Self.color(for: state)) : ScoutDesign.bg)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(stage.isCurrent ? Self.color(for: state) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            )
    }

    /// The plain-language line — the hero. Says what's happening in words, not
    /// state-machine jargon. Falls back to the live partial or an error reason.
    @ViewBuilder
    private var descriptionLine: some View {
        if case .unavailable(let reason) = state {
            Text(reason)
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.statusError)
                .fixedSize(horizontal: false, vertical: true)
        } else if !partial.isEmpty {
            Text("“\(partial)”")
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(2)
        } else {
            Text(Self.humanDescription(state))
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var borderColor: Color {
        if state.isUnavailable { return ScoutSurface.tintBorder(ScoutPalette.statusError) }
        if isActive { return ScoutSurface.tintBorder(Self.color(for: state)) }
        return ScoutDesign.hairline
    }

    // MARK: - State presentation (static so callers can reuse the labels)

    /// Human, present-tense title for the current state — no internal jargon.
    static func humanTitle(_ state: ScoutDictationState) -> String {
        switch state {
        case .probing: return "Checking…"
        case .idle: return "Idle"
        case .starting: return "Starting…"
        case .recording: return "Listening"
        case .processing: return "Transcribing…"
        case .unavailable: return "Unavailable"
        }
    }

    /// One plain sentence explaining what the engine is doing and, when idle,
    /// what to do next.
    static func humanDescription(_ state: ScoutDictationState) -> String {
        switch state {
        case .probing: return "Making sure the voice host is reachable."
        case .idle: return "The mic is off. Tap the mic in the composer to start dictating."
        case .starting: return "Opening the microphone."
        case .recording: return "Capturing your voice — the mic is live."
        case .processing: return "Turning your speech into text."
        case .unavailable: return "Dictation isn’t available right now."
        }
    }

    static func color(for state: ScoutDictationState) -> Color {
        switch state {
        case .idle: return ScoutPalette.dim
        case .probing: return ScoutPalette.statusInfo
        case .starting: return ScoutPalette.accent
        case .recording: return ScoutPalette.accent
        case .processing: return ScoutPalette.statusInfo
        case .unavailable: return ScoutPalette.statusError
        }
    }

    /// Mirrors the service watchdog ceilings so the counter flags a hang before
    /// the auto-recovery fires.
    static func isStuck(state: ScoutDictationState, elapsed: TimeInterval) -> Bool {
        switch state {
        case .starting: return elapsed > 12
        case .processing: return elapsed > 25
        default: return false
        }
    }

    static func elapsedLabel(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        if total < 60 { return "\(total)s" }
        return "\(total / 60)m \(String(format: "%02d", total % 60))s"
    }
}
