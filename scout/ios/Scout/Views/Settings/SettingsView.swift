// SettingsView — Full-screen settings with organized sections.
//
// Sections: Connection, Voice, Appearance, About & Debug.
// Navigated to as a surface via ScoutRouter, not a sheet.

import SwiftUI

struct SettingsView: View {
    @Environment(ConnectionManager.self) private var connection
    @StateObject private var voice = ScoutVoice()
    @ObservedObject private var logStore = LogStore.shared

    @AppStorage("scoutAppearance") private var appearanceMode: String = "system"
    @State private var showingLogs = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: ScoutSpacing.xl) {
                connectionSection
                voiceSection
                appearanceSection
                aboutSection

                // Bottom padding for the bar
                Color.clear.frame(height: 120)
            }
            .padding(.horizontal, ScoutSpacing.lg)
            .padding(.top, ScoutSpacing.xl)
        }
        .background(ScoutColors.backgroundAdaptive)
        .sheet(isPresented: $showingLogs) {
            NavigationStack {
                LogView()
                    .navigationTitle("Logs")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        SettingsSectionCard(title: "Connection", icon: "antenna.radiowaves.left.and.right") {
            SettingsRow(icon: "circle.fill", iconColor: connectionColor, label: "Status") {
                Text(connectionLabel)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            if connection.hasTrustedBridge {
                SettingsRow(icon: "checkmark.shield", iconColor: ScoutColors.statusActive, label: "Trusted Bridge") {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(ScoutColors.statusActive)
                }

                Divider().padding(.leading, 40)

                if connection.state == .connected {
                    SettingsButton(icon: "bolt.slash", label: "Disconnect", role: .regular) {
                        connection.disconnect()
                    }
                } else {
                    SettingsButton(icon: "arrow.clockwise", label: "Reconnect", role: .regular) {
                        Task { await connection.reconnect() }
                    }
                }

                SettingsButton(icon: "trash", label: "Forget Bridge", role: .destructive) {
                    connection.clearTrustedBridge()
                }
            }
        }
    }

    // MARK: - Voice

    private var voiceSection: some View {
        SettingsSectionCard(title: "Voice", icon: "waveform") {
            SettingsRow(icon: "cpu", iconColor: ScoutColors.accent, label: "Engine") {
                Text(engineName)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            SettingsRow(icon: "circle.fill", iconColor: voiceStateColor, label: "State") {
                Text(voiceStateName)
                    .foregroundStyle(voiceStateColor)
            }

            #if canImport(FluidAudio)
            SettingsRow(icon: "brain", iconColor: ScoutColors.accent, label: "Parakeet") {
                Text(parakeetStatus)
                    .foregroundStyle(ScoutColors.textSecondary)
            }
            #endif

            SettingsRow(icon: "clock", iconColor: ScoutColors.textMuted, label: "Last Used") {
                Text(voice.lastEngine)
                    .foregroundStyle(ScoutColors.textSecondary)
            }
        } footer: {
            #if canImport(FluidAudio)
            "Parakeet provides on-device AI transcription. Apple Speech is used as a fallback."
            #else
            "Using Apple Speech for on-device transcription."
            #endif
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        SettingsSectionCard(title: "Appearance", icon: "paintbrush") {
            VStack(alignment: .leading, spacing: ScoutSpacing.md) {
                Text("Theme")
                    .font(ScoutTypography.caption(12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                HStack(spacing: ScoutSpacing.sm) {
                    AppearancePill(label: "System", value: "system", selection: $appearanceMode)
                    AppearancePill(label: "Light", value: "light", selection: $appearanceMode)
                    AppearancePill(label: "Dark", value: "dark", selection: $appearanceMode)
                }
            }
            .padding(.vertical, ScoutSpacing.xs)
        }
    }

    // MARK: - About & Debug

    private var aboutSection: some View {
        SettingsSectionCard(title: "About", icon: "info.circle") {
            SettingsRow(icon: "hammer", iconColor: ScoutColors.textMuted, label: "Version") {
                Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            SettingsRow(icon: "iphone", iconColor: ScoutColors.textMuted, label: "Device") {
                Text(UIDevice.current.name)
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
            }

            SettingsRow(icon: "gear", iconColor: ScoutColors.textMuted, label: "iOS") {
                Text(UIDevice.current.systemVersion)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            Divider().padding(.leading, 40)

            SettingsButton(icon: "doc.text", label: "Logs", role: .regular) {
                showingLogs = true
            }

            Divider().padding(.leading, 40)

            SettingsButton(icon: "arrow.counterclockwise", label: "Reset Onboarding", role: .regular) {
                UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
            }
        }
    }

    // MARK: - Computed

    private var engineName: String {
        #if canImport(FluidAudio)
        "Parakeet + Apple Speech"
        #else
        "Apple Speech"
        #endif
    }

    private var voiceStateName: String {
        switch voice.state {
        case .idle: "Idle"
        case .preparing: "Preparing..."
        case .ready: "Ready"
        case .recording: "Recording"
        case .transcribing: "Transcribing"
        case .error(let e): "Error: \(e)"
        }
    }

    private var voiceStateColor: Color {
        switch voice.state {
        case .ready: ScoutColors.statusActive
        case .recording: ScoutColors.statusError
        case .transcribing: ScoutColors.statusStreaming
        case .error: ScoutColors.statusError
        default: ScoutColors.textSecondary
        }
    }

    #if canImport(FluidAudio)
    private var parakeetStatus: String {
        switch ParakeetModelManager.shared.state {
        case .notDownloaded: "Not downloaded"
        case .downloading(let p): "Downloading \(Int(p * 100))%"
        case .downloaded: "Downloaded"
        case .loading: "Loading..."
        case .ready:
            ParakeetModelManager.shared.isWarmedUp ? "Ready" : "Warming up..."
        case .error(let e): "Error: \(e)"
        }
    }
    #endif

    private var connectionColor: Color {
        switch connection.state {
        case .connected: ScoutColors.statusActive
        case .connecting, .handshaking, .reconnecting: ScoutColors.statusStreaming
        case .disconnected: ScoutColors.statusIdle
        case .failed: ScoutColors.statusError
        }
    }

    private var connectionLabel: String {
        switch connection.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .handshaking: "Handshaking"
        case .reconnecting: "Reconnecting"
        case .disconnected: "Disconnected"
        case .failed: "Failed"
        }
    }
}

// MARK: - Section Card

private struct SettingsSectionCard<Content: View>: View {
    let title: String
    let icon: String
    var footer: String? = nil
    @ViewBuilder let content: Content

    init(title: String, icon: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.footer = nil
        self.content = content()
    }

    init(title: String, icon: String, @ViewBuilder content: () -> Content, footer: () -> String) {
        self.title = title
        self.icon = icon
        self.footer = footer()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutColors.accent)
                Text(title.uppercased())
                    .font(ScoutTypography.caption(12, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.leading, ScoutSpacing.xs)

            VStack(spacing: 0) {
                content
            }
            .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)

            if let footer {
                Text(footer)
                    .font(ScoutTypography.caption(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.horizontal, ScoutSpacing.xs)
            }
        }
    }
}

// MARK: - Row Components

private struct SettingsRow<Trailing: View>: View {
    let icon: String
    let iconColor: Color
    let label: String
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: ScoutSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: 20)

            Text(label)
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textPrimary)

            Spacer()

            trailing
                .font(ScoutTypography.body(14))
        }
        .padding(.vertical, ScoutSpacing.xs)
    }
}

private struct SettingsNavRow<Trailing: View, Destination: View>: View {
    let icon: String
    let iconColor: Color
    let label: String
    @ViewBuilder let trailing: Trailing
    @ViewBuilder let destination: Destination

    var body: some View {
        NavigationLink {
            destination
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(iconColor)
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15))
                    .foregroundStyle(ScoutColors.textPrimary)

                Spacer()

                trailing
                    .font(ScoutTypography.body(14))

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.xs)
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsButton: View {
    enum Role { case regular, destructive }

    let icon: String
    let label: String
    let role: Role
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(role == .destructive ? ScoutColors.statusError : ScoutColors.accent)
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15))
                    .foregroundStyle(role == .destructive ? ScoutColors.statusError : ScoutColors.textPrimary)

                Spacer()
            }
            .padding(.vertical, ScoutSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Appearance Picker

private struct AppearancePill: View {
    let label: String
    let value: String
    @Binding var selection: String

    private var isSelected: Bool { selection == value }

    var body: some View {
        Button {
            selection = value
        } label: {
            Text(label)
                .font(ScoutTypography.body(14, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? ScoutColors.textPrimary : ScoutColors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, ScoutSpacing.sm)
                .background(isSelected ? ScoutColors.accent.opacity(0.15) : ScoutColors.surfaceAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                        .strokeBorder(isSelected ? ScoutColors.accent.opacity(0.4) : ScoutColors.border, lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
    }
}
