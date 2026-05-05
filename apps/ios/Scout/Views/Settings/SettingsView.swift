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
    @AppStorage("scout.tsn.enabled") private var tsnEnabled = true
    @AppStorage("scout.osn.enabled") private var osnEnabled = false
    @AppStorage("scout.osn.meshId") private var osnMeshId = MeshRendezvousConfiguration.defaultMeshId
    @State private var showingLogs = false
    @State private var showingOSNDiscovery = false
    @State private var notificationStatus: PushAuthorizationStatus = .notDetermined

    var body: some View {
        ScrollView {
            LazyVStack(spacing: ScoutSpacing.xl) {
                connectionSection
                notificationsSection
                networkSection
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
        .task {
            notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task {
                notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
            }
        }
        .sheet(isPresented: $showingLogs) {
            NavigationStack {
                LogView()
                    .navigationTitle("Logs")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingOSNDiscovery) {
            NavigationStack {
                OSNDiscoveryView()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") {
                                showingOSNDiscovery = false
                            }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        SettingsSectionCard(title: "Connection", icon: "antenna.radiowaves.left.and.right") {
            SettingsRow(icon: "circle.fill", iconColor: ScoutColors.textMuted, label: "Status") {
                Text(connectionLabel)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            if connection.transportKind != .none, let host = connection.bridgeHost {
                SettingsRow(icon: "network", iconColor: ScoutColors.textMuted, label: "Transport") {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(transportLEDColor)
                            .frame(width: 6, height: 6)
                        Text(connection.transportKind.label)
                            .font(ScoutTypography.code(11, weight: .semibold))
                            .foregroundStyle(ScoutColors.textPrimary)
                        Text("·")
                            .foregroundStyle(ScoutColors.textMuted)
                        Text(host)
                            .font(ScoutTypography.code(11))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }

            if connection.hasTrustedBridge {
                SettingsRow(icon: "checkmark.shield", iconColor: ScoutColors.textMuted, label: "Trusted Bridge") {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(ScoutColors.textSecondary)
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

    // MARK: - Notifications

    private var notificationsSection: some View {
        SettingsSectionCard(title: "Notifications", icon: "bell") {
            SettingsRow(icon: "circle.fill", iconColor: notificationStatusColor, label: "Status") {
                Text(notificationStatusLabel)
                    .foregroundStyle(notificationStatusColor)
            }

            Divider().padding(.leading, 40)

            SettingsRow(icon: "shippingbox", iconColor: ScoutColors.textMuted, label: "Environment") {
                HStack(spacing: 6) {
                    Circle()
                        .fill(apnsEnvironmentColor)
                        .frame(width: 6, height: 6)
                    Text(APNSEnvironment.current.displayLabel)
                        .font(ScoutTypography.code(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                }
            }

            Divider().padding(.leading, 40)

            if notificationStatus == .notDetermined {
                SettingsButton(icon: "bell.badge", label: "Allow Notifications", role: .regular) {
                    Task {
                        _ = await PermissionAuthorizations.requestNotifications()
                        notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
                        await connection.refreshPushRegistration()
                    }
                }
            } else {
                SettingsButton(icon: "arrow.up.right.square", label: "Open System Settings", role: .regular) {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        } footer: {
            notificationFooter
        }
    }

    private var apnsEnvironmentColor: Color {
        switch APNSEnvironment.current {
        case .development: return ScoutColors.ledAmber
        case .production:  return ScoutColors.ledGreen
        }
    }

    private var notificationStatusLabel: String {
        switch notificationStatus {
        case .authorized:    return "Allowed"
        case .denied:        return "Denied"
        case .notDetermined: return "Not Set"
        case .provisional:   return "Quiet Delivery"
        case .ephemeral:     return "Ephemeral"
        }
    }

    private var notificationStatusColor: Color {
        switch notificationStatus {
        case .authorized:                return ScoutColors.ledGreen
        case .provisional, .ephemeral:   return ScoutColors.ledAmber
        case .denied:                    return ScoutColors.ledRed
        case .notDetermined:             return ScoutColors.textMuted
        }
    }

    private var notificationFooter: String {
        switch notificationStatus {
        case .authorized:
            return "Approvals and inbox alerts arrive as push notifications."
        case .provisional, .ephemeral:
            return "Notifications are delivered quietly. Open System Settings to upgrade."
        case .denied:
            return "Notifications are off. Open System Settings → Scout → Notifications to enable."
        case .notDetermined:
            return "Tap Allow Notifications to receive approvals and alerts when Scout is in the background."
        }
    }

    // MARK: - Network

    private var networkSection: some View {
        SettingsSectionCard(title: "Network", icon: "point.3.connected.trianglepath.dotted") {
            SettingsRow(icon: "house", iconColor: ScoutColors.textMuted, label: "Local") {
                Text("Always")
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            SettingsRow(icon: "point.3.connected.trianglepath.dotted", iconColor: ScoutColors.textMuted, label: "TSN") {
                Toggle("", isOn: $tsnEnabled)
                    .labelsHidden()
                    .tint(ScoutColors.accent)
            }

            SettingsRow(icon: "cloud", iconColor: ScoutColors.textMuted, label: "OSN") {
                Toggle("", isOn: $osnEnabled)
                    .labelsHidden()
                    .tint(ScoutColors.accent)
            }

            SettingsRow(icon: "person.2.badge.key", iconColor: ScoutColors.textMuted, label: "Mesh") {
                Text(osnMeshId)
                    .font(ScoutTypography.code(12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if connection.transportKind != .none {
                SettingsRow(icon: "arrow.triangle.branch", iconColor: ScoutColors.textMuted, label: "Current") {
                    Text(connection.transportKind.label)
                        .font(ScoutTypography.code(12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            SettingsButton(icon: "list.bullet.rectangle", label: "Mesh Nodes", role: .regular) {
                showingOSNDiscovery = true
            } trailing: {
                Text(osnAccessLabel)
                    .foregroundStyle(ScoutColors.textSecondary)
            }
        } footer: {
            "Local is always available. TSN and OSN are independent remote routes."
        }
    }

    // MARK: - Voice

    private var voiceSection: some View {
        SettingsSectionCard(title: "Voice", icon: "waveform") {
            SettingsRow(icon: "cpu", iconColor: ScoutColors.textMuted, label: "Engine") {
                Text(engineName)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            SettingsRow(icon: "circle.fill", iconColor: voiceStateColor, label: "State") {
                Text(voiceStateName)
                    .foregroundStyle(voiceStateColor)
            }

            #if canImport(FluidAudio)
            SettingsRow(icon: "brain", iconColor: ScoutColors.textMuted, label: "Parakeet") {
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
        ScoutColors.textSecondary
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
        ScoutColors.textMuted
    }

    private var connectionLabel: String {
        connection.statusDetails.shortLabel
    }

    private var transportLEDColor: Color {
        switch connection.transportKind {
        case .lan: return ScoutColors.ledGreen
        case .tailnet, .oscout: return ScoutColors.ledAmber
        case .remote: return ScoutColors.ledRed
        case .loopback, .none: return ScoutColors.textMuted
        }
    }

    private var osnAccessLabel: String {
        if (try? ScoutIdentity.loadOSNSessionToken()) != nil {
            return "Open"
        }
        return "Sign In"
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
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                Text(title.uppercased())
                    .font(ScoutTypography.code(10, weight: .semibold))
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

                if trailing != nil {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                }
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
    let trailing: AnyView?

    init(icon: String, label: String, role: Role, action: @escaping () -> Void) {
        self.icon = icon
        self.label = label
        self.role = role
        self.action = action
        self.trailing = nil
    }

    init<Trailing: View>(
        icon: String,
        label: String,
        role: Role,
        action: @escaping () -> Void,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.icon = icon
        self.label = label
        self.role = role
        self.action = action
        self.trailing = AnyView(trailing())
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15))
                    .foregroundStyle(ScoutColors.textPrimary)

                Spacer()

                if let trailing {
                    trailing
                        .font(ScoutTypography.body(14))
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
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
                .background(isSelected ? ScoutColors.textPrimary.opacity(0.08) : ScoutColors.surfaceAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
