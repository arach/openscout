// SettingsView - Full-screen inspector settings surface.
//
// Sections: Connect, Notify, Voice, Look, Lab, About.
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

    @State private var active: SettingsInspectorTab
    @State private var showingLogs = false
    @State private var showingOSNDiscovery = false
    @State private var showingPairing = false
    @State private var notificationStatus: PushAuthorizationStatus = .notDetermined
    @State private var connectionActionState: SettingsConnectionActionState = .idle

    private static let appearanceChoices: [SettingsChoice] = [
        SettingsChoice(id: "system", title: "System"),
        SettingsChoice(id: "light", title: "Light"),
        SettingsChoice(id: "dark", title: "Dark"),
    ]

    init() {
        let args = ProcessInfo.processInfo.arguments
        let initialTab: SettingsInspectorTab
        if let flagIndex = args.firstIndex(where: { $0.hasPrefix("--settingsTab=") }) {
            let value = args[flagIndex].dropFirst("--settingsTab=".count)
            initialTab = SettingsInspectorTab.from(launchArg: String(value)) ?? .connect
        } else if let flagIndex = args.firstIndex(of: "--settingsTab"),
                  flagIndex + 1 < args.count,
                  let tab = SettingsInspectorTab.from(launchArg: args[flagIndex + 1]) {
            initialTab = tab
        } else {
            initialTab = .connect
        }
        _active = State(initialValue: initialTab)
    }

    var body: some View {
        ZStack {
            ScoutColors.backgroundAdaptive.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().overlay(ScoutColors.divider)

                HStack(spacing: 0) {
                    rail
                    panel
                }
            }
        }
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
                            Button("Done") { showingOSNDiscovery = false }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingPairing) {
            NavigationStack {
                PairingView()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { showingPairing = false }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Shell

    private var header: some View {
        HStack(spacing: ScoutSpacing.md) {
            Text("OPENSCOUT")
                .font(ScoutTypography.code(12, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(ScoutColors.textPrimary.opacity(0.82))

            Text("*")
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textMuted)

            Text("SETTINGS")
                .font(ScoutTypography.code(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(ScoutColors.textSecondary)

            Spacer()

            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(connectionStatusColor)
                    .frame(width: 7, height: 7)
                Text(connectionLabel.uppercased())
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, ScoutSpacing.md)
            .frame(height: 28)
            .background(ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
        .padding(.horizontal, ScoutSpacing.xl)
        .padding(.top, ScoutSpacing.xl)
        .padding(.bottom, ScoutSpacing.lg)
    }

    private var rail: some View {
        VStack(spacing: 0) {
            ForEach(SettingsInspectorTab.allCases) { tab in
                railChip(tab)
                if tab != SettingsInspectorTab.allCases.last {
                    Rectangle()
                        .fill(ScoutColors.divider)
                        .frame(height: 1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(width: 44)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(width: 1)
        }
    }

    private func railChip(_ tab: SettingsInspectorTab) -> some View {
        let isActive = tab == active

        return Button {
            withAnimation(.easeOut(duration: 0.18)) { active = tab }
        } label: {
            ZStack {
                Text(tab.rawValue)
                    .font(ScoutTypography.code(9, weight: isActive ? .semibold : .medium))
                    .tracking(2.6)
                    .foregroundStyle(isActive ? ScoutColors.textPrimary : ScoutColors.textMuted)
                    .fixedSize()
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 44, height: 88)
            .background(isActive ? ScoutColors.accent.opacity(0.10) : Color.clear)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(isActive ? ScoutColors.accent : Color.clear)
                    .frame(width: 3)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.accessibilityLabel)
        .accessibilityValue(isActive ? "Selected" : "Not selected")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    @ViewBuilder
    private var panel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("INSPECTOR * \(active.rawValue)")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
            }
            .padding(.horizontal, ScoutSpacing.xl)
            .padding(.top, ScoutSpacing.lg)
            .padding(.bottom, ScoutSpacing.md)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch active {
                    case .connect: connectPanel
                    case .notify: notifyPanel
                    case .voice: voicePanel
                    case .look: lookPanel
                    case .lab: labPanel
                    case .about: aboutPanel
                    }
                }
                .padding(.horizontal, ScoutSpacing.xl)
                .padding(.bottom, 128)
            }
            .refreshable {
                await refreshActiveInspector()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Panels

    private var connectPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("PRIMARY")
            field("Status", connectionLabel, hint: connection.statusDetails.message, valueColor: connectionStatusColor)

            if let host = connection.bridgeHost {
                field("Host", host, hint: connection.transportKind.label)
            }

            if let room = connection.relayRoomId {
                field("Relay room", room)
            }

            field("Paired primaries", "\(connection.pairedPrimaries.count)")

            if connection.hasTrustedBridge {
                ForEach(connection.pairedPrimaries) { primary in
                    primaryInspectorRow(primary)
                }

                if connection.state == .connected {
                    actionRow("Disconnect", systemImage: "bolt.slash", tone: .neutral) {
                        connection.disconnect()
                        connectionActionState = .success("Disconnected from the active primary.")
                    }
                } else {
                    connectionActionRow("Reconnect", systemImage: "arrow.clockwise", tone: .accent) {
                        Task { await runConnectionCheck(forceReconnect: true) }
                    }
                }

                connectionActionFeedback

                navRow("Add Primary", systemImage: "plus.circle") {
                    showingPairing = true
                }

                actionRow("Forget Active Primary", systemImage: "trash", tone: .warn) {
                    connection.clearTrustedBridge()
                }
            } else {
                navRow("Add Primary", systemImage: "qrcode.viewfinder") {
                    showingPairing = true
                }
            }

            sectionHeader("ROUTES")
            metricStrip(
                title: "ROUTE HEALTH",
                metrics: [
                    ("LAN", "ALWAYS"),
                    ("TSN", tsnEnabled ? "ON" : "OFF"),
                    ("OSN", osnEnabled ? "ON" : "OFF"),
                ]
            )
            toggleRow(
                "TSN",
                isOn: $tsnEnabled,
                valueOn: "On",
                valueOff: "Off",
                hint: "Tailnet route"
            )
            toggleRow(
                "OSN",
                isOn: $osnEnabled,
                valueOn: "On",
                valueOff: "Off",
                hint: "OpenScout Network"
            )
            field("Mesh", osnMeshId)

            if connection.transportKind != .none {
                field("Current route", connection.transportKind.label)
            }

            navRow("Mesh Nodes", systemImage: "list.bullet.rectangle", value: osnAccessLabel) {
                showingOSNDiscovery = true
            }
        }
    }

    private var notifyPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("PUSH")
            field("Status", notificationStatusLabel, hint: notificationFooter, valueColor: notificationStatusColor)
            field("Environment", APNSEnvironment.current.displayLabel, valueColor: apnsEnvironmentColor)
            field("Remote token", remotePushTokenLabel)

            if notificationStatus == .notDetermined {
                actionRow("Allow Notifications", systemImage: "bell.badge", tone: .accent) {
                    Task {
                        _ = await PermissionAuthorizations.requestNotifications()
                        notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
                        await connection.refreshPushRegistration()
                    }
                }
            } else {
                actionRow("Open System Settings", systemImage: "arrow.up.right.square", tone: .neutral) {
                    openSystemSettings()
                }
            }

            actionRow("Sync Push Registration", systemImage: "arrow.triangle.2.circlepath", tone: .neutral) {
                Task {
                    notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
                    await connection.refreshPushRegistration()
                }
            }
        }
    }

    private var voicePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("DICTATION")
            field("Engine", engineName)
            field("State", voiceStateName, valueColor: voiceStateColor)
            field("Last Used", voice.lastEngine)
            metricStrip(
                title: "PERMISSIONS",
                metrics: [
                    ("MIC", PermissionAuthorizations.microphoneGranted() ? "OK" : "ASK"),
                    ("SPEECH", PermissionAuthorizations.speechGranted() ? "OK" : "ASK"),
                    ("STATE", compactVoiceState),
                ]
            )

            actionRow("Prepare Engine", systemImage: "waveform", tone: .neutral) {
                Task { await voice.prepare() }
            }

            #if canImport(FluidAudio)
            sectionHeader("PARAKEET")
            field("Model", "v3")
            field("Status", parakeetStatus)
            actionRow("Load Parakeet", systemImage: "brain", tone: .accent) {
                Task {
                    do {
                        try await ParakeetModelManager.shared.downloadAndLoad()
                    } catch {
                        ScoutLog.voice.warning("Parakeet load failed from settings: \(error.localizedDescription)")
                    }
                }
            }
            #endif
        }
    }

    private var lookPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("APPEARANCE")
            cycleRow(
                "Theme",
                selection: $appearanceMode,
                choices: Self.appearanceChoices,
                hint: resolvedAppearanceHint
            )
            appearancePickerRow
        }
    }

    private var labPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("LOGS")
            field("Entries", "\(logStore.entries.count)")
            field("Errors", "\(logStore.errorCount)")
            navRow("Logs", systemImage: "doc.text") {
                showingLogs = true
            }

            sectionHeader("DEVELOPER")
            actionRow("Reset Onboarding", systemImage: "arrow.counterclockwise", tone: .neutral) {
                UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
            }
            actionRow("Refresh Push Registration", systemImage: "shippingbox", tone: .neutral) {
                Task { await connection.refreshPushRegistration() }
            }
        }
    }

    private var aboutPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("APP")
            field("Version", Bundle.main.shortVersion)
            field("Build", Bundle.main.buildNumber)
            field("Bundle", Bundle.main.bundleIdentifier ?? "com.openscout.scout")
            field("Device", UIDevice.current.name)
            field("iOS", UIDevice.current.systemVersion)

            sectionHeader("POSTURE")
            field("Channel", APNSEnvironment.current.displayLabel)
            field("Runtime", "Local broker")
            field("Mesh", osnMeshId)
        }
    }

    // MARK: - Row primitives

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(ScoutTypography.code(10, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(ScoutColors.textMuted)
            Spacer()
        }
        .frame(height: 34)
        .padding(.top, ScoutSpacing.md)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 1)
        }
    }

    private func field(
        _ label: String,
        _ value: String,
        hint: String? = nil,
        valueColor: Color = ScoutColors.textSecondary
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
            Text(label)
                .font(ScoutTypography.body(15, weight: .medium))
                .foregroundStyle(ScoutColors.textPrimary)
                .layoutPriority(2)

            if let hint, !hint.isEmpty {
                Text("* \(hint)")
                    .font(ScoutTypography.caption(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(0)
            }

            Spacer(minLength: ScoutSpacing.md)

            Text(value)
                .font(ScoutTypography.code(12, weight: .semibold))
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .truncationMode(.middle)
                .multilineTextAlignment(.trailing)
                .layoutPriority(1)
        }
        .frame(height: 44)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 1)
        }
    }

    private func toggleRow(
        _ label: String,
        isOn: Binding<Bool>,
        valueOn: String,
        valueOff: String,
        hint: String? = nil
    ) -> some View {
        HStack(spacing: ScoutSpacing.sm) {
            Text(label)
                .font(ScoutTypography.body(15, weight: .medium))
                .foregroundStyle(ScoutColors.textPrimary)
                .layoutPriority(2)

            if let hint {
                Text("* \(hint)")
                    .font(ScoutTypography.caption(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: ScoutSpacing.md)

            Text(isOn.wrappedValue ? valueOn : valueOff)
                .font(ScoutTypography.code(12, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(1)

            SettingsCompactToggle(label: label, isOn: isOn)
        }
        .frame(height: 44)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 1)
        }
    }

    private func cycleRow(
        _ label: String,
        selection: Binding<String>,
        choices: [SettingsChoice],
        hint: String? = nil
    ) -> some View {
        let current = choices.first { $0.id == selection.wrappedValue }
            ?? choices.first
            ?? SettingsChoice(id: selection.wrappedValue, title: selection.wrappedValue)

        return Button {
            guard !choices.isEmpty else { return }
            let currentIndex = choices.firstIndex { $0.id == selection.wrappedValue }
            let nextIndex = currentIndex.map { choices.index(after: $0) % choices.count } ?? choices.startIndex
            selection.wrappedValue = choices[nextIndex].id
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
                Text(label)
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .layoutPriority(2)

                if let hint {
                    Text("* \(hint)")
                        .font(ScoutTypography.caption(12))
                        .foregroundStyle(ScoutColors.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: ScoutSpacing.md)

                Text(current.title)
                    .font(ScoutTypography.code(12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)

                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .accessibilityHidden(true)
            }
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label): \(current.title)")
        .accessibilityHint("Cycles to the next option")
    }

    private enum ActionTone { case neutral, accent, warn }

    private func navRow(
        _ label: String,
        systemImage: String,
        value: String? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)

                Spacer()

                if let value {
                    Text(value)
                        .font(ScoutTypography.code(12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .accessibilityHidden(true)
            }
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private func actionRow(
        _ label: String,
        systemImage: String,
        tone: ActionTone,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(actionColor(tone))
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)

                Spacer()

                Text("RUN")
                    .font(ScoutTypography.code(10, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(actionColor(tone))
            }
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private func connectionActionRow(
        _ label: String,
        systemImage: String,
        tone: ActionTone,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(actionColor(tone))
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)

                Spacer()

                if connectionActionState.isRunning {
                    HStack(spacing: ScoutSpacing.sm) {
                        ProgressView()
                            .controlSize(.mini)
                        Text("WORKING")
                            .font(ScoutTypography.code(10, weight: .bold))
                            .tracking(0.8)
                            .foregroundStyle(actionColor(tone))
                    }
                } else {
                    Text("RUN")
                        .font(ScoutTypography.code(10, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(actionColor(tone))
                }
            }
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(connectionActionState.isRunning)
    }

    @ViewBuilder
    private var connectionActionFeedback: some View {
        switch connectionActionState {
        case .idle:
            EmptyView()
        case .running(let message):
            connectionFeedbackRow(message, symbol: "arrow.triangle.2.circlepath", color: ScoutColors.ledAmber)
        case .success(let message):
            connectionFeedbackRow(message, symbol: "checkmark.circle", color: ScoutColors.ledGreen)
        case .failure(let message):
            connectionFeedbackRow(message, symbol: "exclamationmark.triangle", color: ScoutColors.ledRed)
        }
    }

    private func connectionFeedbackRow(_ message: String, symbol: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 20)

            Text(message)
                .font(ScoutTypography.caption(12))
                .foregroundStyle(ScoutColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: ScoutSpacing.md)
        }
        .padding(.vertical, ScoutSpacing.md)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func actionColor(_ tone: ActionTone) -> Color {
        switch tone {
        case .neutral: return ScoutColors.textSecondary
        case .accent: return ScoutColors.accent
        case .warn: return ScoutColors.ledRed
        }
    }

    private func metricStrip(title: String, metrics: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title)
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
            }
            .frame(height: 34)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }

            HStack(spacing: 0) {
                ForEach(metrics.indices, id: \.self) { index in
                    VStack(spacing: ScoutSpacing.sm) {
                        Text(metrics[index].0)
                            .font(ScoutTypography.code(9, weight: .semibold))
                            .tracking(0.7)
                            .foregroundStyle(ScoutColors.textMuted)
                        Text(metrics[index].1)
                            .font(ScoutTypography.code(13, weight: .semibold))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xl)

                    if index < metrics.count - 1 {
                        Rectangle()
                            .fill(ScoutColors.divider)
                            .frame(width: 1)
                            .padding(.vertical, ScoutSpacing.md)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
    }

    private func primaryInspectorRow(_ primary: PairedPrimarySummary) -> some View {
        Button {
            guard !primary.isActive else { return }
            Task { await connection.activatePrimary(publicKeyHex: primary.publicKeyHex) }
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: primary.isActive ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(primary.isActive ? ScoutColors.ledGreen : ScoutColors.textMuted)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: ScoutSpacing.sm) {
                        Text(primary.name)
                            .font(ScoutTypography.body(15, weight: .medium))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(1)

                        if primary.isActive {
                            Text("ACTIVE")
                                .font(ScoutTypography.code(9, weight: .bold))
                                .foregroundStyle(ScoutColors.ledGreen)
                        }
                    }

                    Text(primary.publicKeyHex.prefix(12))
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                        .lineLimit(1)
                }

                Spacer()

                Text(primary.lastSeen.map { $0.formatted(.relative(presentation: .named)) } ?? "No contact")
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)

                if !primary.isActive {
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)
                }
            }
            .frame(minHeight: 52)
            .padding(.vertical, ScoutSpacing.xs)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(ScoutColors.divider)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(primary.isActive)
    }

    private var appearancePickerRow: some View {
        HStack(spacing: ScoutSpacing.sm) {
            ForEach(Self.appearanceChoices) { choice in
                AppearanceChoiceButton(
                    label: choice.title,
                    value: choice.id,
                    selection: $appearanceMode
                )
            }
        }
        .padding(.vertical, ScoutSpacing.xl)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 1)
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
        case .error(let error): "Error: \(error)"
        }
    }

    private var compactVoiceState: String {
        switch voice.state {
        case .idle: "IDLE"
        case .preparing: "PREP"
        case .ready: "READY"
        case .recording: "REC"
        case .transcribing: "BUSY"
        case .error: "ERR"
        }
    }

    private var voiceStateColor: Color {
        switch voice.state {
        case .error: return ScoutColors.ledRed
        case .recording, .transcribing: return ScoutColors.ledAmber
        case .ready: return ScoutColors.ledGreen
        case .idle, .preparing: return ScoutColors.textSecondary
        }
    }

    #if canImport(FluidAudio)
    private var parakeetStatus: String {
        switch ParakeetModelManager.shared.state {
        case .notDownloaded: "Not downloaded"
        case .downloading(let progress): "Downloading \(Int(progress * 100))%"
        case .downloaded: "Downloaded"
        case .loading: "Loading..."
        case .ready:
            ParakeetModelManager.shared.isWarmedUp ? "Ready" : "Warming up..."
        case .error(let error): "Error: \(error)"
        }
    }
    #endif

    private var connectionLabel: String {
        connection.statusDetails.shortLabel
    }

    private var connectionStatusColor: Color {
        switch connection.state {
        case .connected: return ScoutColors.ledGreen
        case .connecting, .handshaking, .reconnecting: return ScoutColors.ledAmber
        case .failed: return ScoutColors.ledRed
        case .disconnected: return connection.hasTrustedBridge ? ScoutColors.textMuted : ScoutColors.ledAmber
        }
    }

    private var apnsEnvironmentColor: Color {
        switch APNSEnvironment.current {
        case .development: return ScoutColors.ledAmber
        case .production: return ScoutColors.ledGreen
        }
    }

    private var notificationStatusLabel: String {
        switch notificationStatus {
        case .authorized: return "Allowed"
        case .denied: return "Denied"
        case .notDetermined: return "Not Set"
        case .provisional: return "Quiet Delivery"
        case .ephemeral: return "Ephemeral"
        }
    }

    private var notificationStatusColor: Color {
        switch notificationStatus {
        case .authorized: return ScoutColors.ledGreen
        case .provisional, .ephemeral: return ScoutColors.ledAmber
        case .denied: return ScoutColors.ledRed
        case .notDetermined: return ScoutColors.textMuted
        }
    }

    private var notificationFooter: String {
        switch notificationStatus {
        case .authorized:
            return "Approvals and inbox alerts"
        case .provisional, .ephemeral:
            return "Quiet delivery"
        case .denied:
            return "Enable in iOS Settings"
        case .notDetermined:
            return "Ask when enabled"
        }
    }

    private var osnAccessLabel: String {
        if (try? ScoutIdentity.loadOSNSessionToken()) != nil {
            return "Open"
        }
        return "Sign In"
    }

    private var resolvedAppearanceHint: String {
        switch appearanceMode {
        case "light": return "Force light"
        case "dark": return "Force dark"
        default: return "Follow system"
        }
    }

    private var remotePushTokenLabel: String {
        let token = UserDefaults.standard.string(forKey: "scout.remotePushToken")?.trimmedNonEmpty
        guard let token else { return "None" }
        return "\(token.prefix(8))..."
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    @MainActor
    private func refreshActiveInspector() async {
        notificationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()

        switch active {
        case .connect:
            await runConnectionCheck(forceReconnect: connection.state != .connected)
        case .notify:
            await connection.refreshPushRegistration()
        case .voice, .look, .lab, .about:
            break
        }
    }

    @MainActor
    private func runConnectionCheck(forceReconnect: Bool) async {
        guard connection.hasTrustedBridge else {
            connectionActionState = .failure("Pair this iPhone with Scout on your Mac before reconnecting.")
            return
        }

        connectionActionState = .running(
            forceReconnect ? "Reconnecting to the active primary..." : "Checking the active primary..."
        )

        if forceReconnect || connection.state != .connected {
            await connection.reconnect()
        }

        switch connection.state {
        case .connected:
            do {
                _ = try await connection.bridgeStatus()
                let route = connection.transportKind == .none ? "the active route" : connection.transportKind.label
                connectionActionState = .success("Connected. Latest bridge status loaded over \(route).")
            } catch {
                connectionActionState = .failure(error.scoutUserFacingMessage)
            }
        case .connecting, .handshaking, .reconnecting:
            connectionActionState = .running(
                connection.statusDetails.message ?? "Still reconnecting to your Mac..."
            )
        case .disconnected, .failed:
            connectionActionState = .failure(connection.statusDetails.message ?? connection.statusDetails.title)
        }
    }
}

// MARK: - Support types

private enum SettingsInspectorTab: String, CaseIterable, Identifiable {
    case connect = "CONNECT"
    case notify = "NOTIFY"
    case voice = "VOICE"
    case look = "LOOK"
    case lab = "LAB"
    case about = "ABOUT"

    var id: String { rawValue }

    var accessibilityLabel: String {
        switch self {
        case .connect: return "Connection settings"
        case .notify: return "Notification settings"
        case .voice: return "Voice settings"
        case .look: return "Appearance settings"
        case .lab: return "Lab settings"
        case .about: return "About settings"
        }
    }

    static func from(launchArg value: String) -> SettingsInspectorTab? {
        allCases.first { tab in
            tab.rawValue.caseInsensitiveCompare(value) == .orderedSame
                || tab.rawValue.lowercased().hasPrefix(value.lowercased())
        }
    }
}

private enum SettingsConnectionActionState: Equatable {
    case idle
    case running(String)
    case success(String)
    case failure(String)

    var isRunning: Bool {
        if case .running = self { return true }
        return false
    }
}

private struct SettingsChoice: Identifiable, Equatable {
    let id: String
    let title: String
}

private struct SettingsCompactToggle: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.18, dampingFraction: 0.82)) {
                isOn.toggle()
            }
        } label: {
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(isOn ? ScoutColors.accent.opacity(0.72) : ScoutColors.surfaceRaisedAdaptive)
                    .overlay {
                        Capsule()
                            .stroke(isOn ? ScoutColors.accent.opacity(0.88) : ScoutColors.divider, lineWidth: 1)
                    }

                Circle()
                    .fill(isOn ? ScoutColors.backgroundAdaptive : ScoutColors.textMuted.opacity(0.72))
                    .frame(width: 16, height: 16)
                    .offset(x: isOn ? 24 : 2)
            }
            .frame(width: 42, height: 20)
        }
        .buttonStyle(.plain)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
        .accessibilityRepresentation {
            Toggle(label, isOn: $isOn)
        }
    }
}

private struct AppearanceChoiceButton: View {
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

// MARK: - Bundle convenience

private extension Bundle {
    var shortVersion: String {
        (object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "?"
    }

    var buildNumber: String {
        (object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "?"
    }
}
