// TerminalView - Full-screen Scout iOS terminal scaffold.

import SwiftUI
import UIKit

struct ScoutTerminalView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var store = ScoutTerminalStore()
    @State private var adapter = makeDefaultScoutTerminalAdapter()
    @State private var showingHostEditor = false
    @State private var editingHost: ScoutTerminalSavedHost?
    @State private var pendingDeleteHost: ScoutTerminalSavedHost?
    @State private var errorMessage: String?

    private var usesCompactLayout: Bool {
        horizontalSizeClass == .compact
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if usesCompactLayout {
                compactTerminalLayout
            } else {
                HStack(spacing: 0) {
                    sidebar
                        .frame(width: 320)

                    terminalPane
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutColors.pageBg.ignoresSafeArea())
        .sheet(isPresented: $showingHostEditor) {
            ScoutTerminalHostEditor(
                host: editingHost,
                defaultProfile: store.selectedStartupProfile,
                onCancel: {
                    showingHostEditor = false
                    editingHost = nil
                },
                onSave: { draft in
                    do {
                        try store.saveHost(
                            label: draft.label,
                            host: draft.host,
                            port: draft.port,
                            username: draft.username,
                            credentialKind: draft.credentialKind,
                            secret: draft.secret,
                            startupProfile: draft.startupProfile,
                            startupCommandOverride: draft.startupCommandOverride
                        )
                        showingHostEditor = false
                        editingHost = nil
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .alert("Delete Host?", isPresented: Binding(
            get: { pendingDeleteHost != nil },
            set: { isPresented in
                if !isPresented { pendingDeleteHost = nil }
            }
        )) {
            Button("Delete", role: .destructive) {
                if let pendingDeleteHost {
                    store.delete(pendingDeleteHost)
                }
                pendingDeleteHost = nil
            }
            Button("Cancel", role: .cancel) {
                pendingDeleteHost = nil
            }
        } message: {
            Text(pendingDeleteHost?.title ?? "")
        }
        .alert("Terminal Error", isPresented: Binding(
            get: { errorMessage != nil },
            set: { isPresented in
                if !isPresented { errorMessage = nil }
            }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var header: some View {
        HStack(spacing: usesCompactLayout ? ScoutSpacing.sm : ScoutSpacing.lg) {
            VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                Text("TERMINAL")
                    .font(ScoutTypography.code(10, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
                Text(store.selectedHost?.title ?? "No host selected")
                    .font(ScoutTypography.body(20, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)
            }
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

            if !usesCompactLayout {
                Picker("Startup Profile", selection: $store.selectedStartupProfile) {
                    ForEach(ScoutTerminalStartupProfile.allCases) { profile in
                        Text(profile.title).tag(profile)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 260)
            }

            Button {
                connectSelectedHost()
            } label: {
                Label(usesCompactLayout ? "" : "Connect", systemImage: "bolt.horizontal")
                    .font(ScoutTypography.caption(13, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.selectedHost == nil || adapter.state == .connecting)

            Button {
                adapter.disconnect()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.bordered)
            .disabled(adapter.state == .idle)
            .accessibilityLabel("Disconnect")
        }
        .padding(.horizontal, ScoutSpacing.xl)
        .padding(.top, usesCompactLayout ? ScoutSpacing.lg : ScoutSpacing.xl)
        .padding(.bottom, ScoutSpacing.lg)
        .background(ScoutColors.surfaceAdaptive)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 0.5)
        }
    }

    private var compactTerminalLayout: some View {
        VStack(spacing: 0) {
            compactHostStrip
            terminalPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var compactHostStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: ScoutSpacing.sm) {
                Button {
                    editingHost = nil
                    showingHostEditor = true
                } label: {
                    Label("Host", systemImage: "plus")
                        .font(ScoutTypography.caption(12, weight: .semibold))
                }
                .buttonStyle(.bordered)

                Picker("Profile", selection: $store.selectedStartupProfile) {
                    ForEach(ScoutTerminalStartupProfile.allCases) { profile in
                        Text(profile.title).tag(profile)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 210)

                ForEach(store.savedHosts) { host in
                    Button {
                        store.selectedHostID = host.id
                        store.selectedStartupProfile = host.startupProfile
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Label(host.title, systemImage: host.credentialKind == .privateKey ? "key.horizontal" : "terminal")
                            .lineLimit(1)
                    }
                    .buttonStyle(.bordered)
                    .tint(store.selectedHost?.id == host.id ? ScoutColors.ledGreen : ScoutColors.textMuted)
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
            .padding(.vertical, ScoutSpacing.sm)
        }
        .background(ScoutColors.surfaceAdaptive)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(height: 0.5)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("HOSTS")
                    .font(ScoutTypography.code(10, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
                Button {
                    editingHost = nil
                    showingHostEditor = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add host")
            }
            .padding(ScoutSpacing.xl)

            if store.savedHosts.isEmpty {
                emptyHostState
                    .padding(.horizontal, ScoutSpacing.xl)
            } else {
                ScrollView {
                    LazyVStack(spacing: ScoutSpacing.sm) {
                        ForEach(store.savedHosts) { host in
                            hostRow(host)
                        }
                    }
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.bottom, 120)
                }
            }

            Spacer()
        }
        .background(ScoutColors.cardBg)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(width: 0.5)
        }
    }

    private var emptyHostState: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            Image(systemName: "server.rack")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
            Text("Add an SSH host to prepare a TerminiSSH launch request.")
                .font(ScoutTypography.caption(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                editingHost = nil
                showingHostEditor = true
            } label: {
                Label("Add Host", systemImage: "plus")
            }
            .buttonStyle(.bordered)
        }
        .padding(ScoutSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutColors.surfaceRaisedAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
    }

    private func hostRow(_ host: ScoutTerminalSavedHost) -> some View {
        let isSelected = store.selectedHost?.id == host.id

        return Button {
            store.selectedHostID = host.id
            store.selectedStartupProfile = host.startupProfile
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            HStack(alignment: .top, spacing: ScoutSpacing.md) {
                Image(systemName: host.credentialKind == .privateKey ? "key.horizontal" : "terminal")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isSelected ? ScoutColors.textPrimary : ScoutColors.textSecondary)
                    .frame(width: 24, height: 24)

                VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                    Text(host.title)
                        .font(ScoutTypography.body(14, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)
                    Text(host.endpoint)
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                    Text(host.startupProfile.title)
                        .font(ScoutTypography.code(10, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer()

                Menu {
                    Button {
                        editingHost = host
                        showingHostEditor = true
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        pendingDeleteHost = host
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                        .frame(width: 28, height: 28)
                }
            }
            .padding(ScoutSpacing.md)
            .background(isSelected ? ScoutColors.surfaceRaisedAdaptive : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var terminalPane: some View {
        VStack(spacing: ScoutSpacing.lg) {
            profileSummary
            adapter.makeTerminalView()
            terminalShortcutBar
        }
        .padding(usesCompactLayout ? ScoutSpacing.md : ScoutSpacing.xl)
        .padding(.bottom, 92)
    }

    private var terminalShortcutBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: ScoutSpacing.sm) {
                ForEach(ScoutTerminalShortcut.allCases) { shortcut in
                    Button {
                        adapter.sendShortcut(shortcut)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Text(shortcut.title)
                            .font(ScoutTypography.code(11, weight: .semibold))
                            .frame(minWidth: 48)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var profileSummary: some View {
        HStack(alignment: .top, spacing: ScoutSpacing.lg) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                Text(store.selectedStartupProfile.title)
                    .font(ScoutTypography.body(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                Text(store.selectedStartupProfile.subtitle)
                    .font(ScoutTypography.caption(12))
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            Spacer()

            Text(adapter.state.title.uppercased())
                .font(ScoutTypography.code(10, weight: .bold))
                .foregroundStyle(statusColor)
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
    }

    private var statusColor: Color {
        switch adapter.state {
        case .idle: ScoutColors.textMuted
        case .connecting: ScoutColors.ledAmber
        case .connected: ScoutColors.ledGreen
        case .failed: ScoutColors.ledRed
        }
    }

    private func connectSelectedHost() {
        guard let selectedHost = store.selectedHost else { return }

        Task {
            do {
                let credential = try store.credential(for: selectedHost)
                let request = ScoutTerminalLaunchRequest(
                    host: selectedHost,
                    startupProfile: store.selectedStartupProfile,
                    credential: credential
                )
                store.markUsed(selectedHost)
                await adapter.connect(request)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct ScoutTerminalHostEditor: View {
    struct Draft {
        var label: String
        var host: String
        var port: Int
        var username: String
        var credentialKind: ScoutTerminalCredentialKind
        var secret: String
        var startupProfile: ScoutTerminalStartupProfile
        var startupCommandOverride: String
    }

    let host: ScoutTerminalSavedHost?
    let defaultProfile: ScoutTerminalStartupProfile
    let onCancel: () -> Void
    let onSave: (Draft) -> Void

    @State private var label: String
    @State private var hostName: String
    @State private var port: String
    @State private var username: String
    @State private var credentialKind: ScoutTerminalCredentialKind
    @State private var secret: String = ""
    @State private var startupProfile: ScoutTerminalStartupProfile
    @State private var startupCommandOverride: String

    init(
        host: ScoutTerminalSavedHost?,
        defaultProfile: ScoutTerminalStartupProfile,
        onCancel: @escaping () -> Void,
        onSave: @escaping (Draft) -> Void
    ) {
        self.host = host
        self.defaultProfile = defaultProfile
        self.onCancel = onCancel
        self.onSave = onSave
        _label = State(initialValue: host?.label ?? "")
        _hostName = State(initialValue: host?.host ?? "")
        _port = State(initialValue: String(host?.port ?? 22))
        _username = State(initialValue: host?.username ?? "")
        _credentialKind = State(initialValue: host?.credentialKind ?? .privateKey)
        _startupProfile = State(initialValue: host?.startupProfile ?? defaultProfile)
        _startupCommandOverride = State(initialValue: host?.startupCommandOverride ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Host") {
                    TextField("Label", text: $label)
                    TextField("Host", text: $hostName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Port", text: $port)
                        .keyboardType(.numberPad)
                    TextField("Username", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Credential") {
                    Picker("Kind", selection: $credentialKind) {
                        ForEach(ScoutTerminalCredentialKind.allCases, id: \.self) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }

                    if credentialKind != .none {
                        SecureField(host?.credentialReference == nil ? "Secret" : "Replace saved secret", text: $secret)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    Text("Secrets are stored in the iOS Keychain. Saved host config keeps only a credential reference.")
                        .font(ScoutTypography.caption(12))
                        .foregroundStyle(ScoutColors.textSecondary)
                }

                Section("Startup") {
                    Picker("Profile", selection: $startupProfile) {
                        ForEach(ScoutTerminalStartupProfile.allCases) { profile in
                            Text(profile.title).tag(profile)
                        }
                    }
                    TextField("Command override", text: $startupCommandOverride, axis: .vertical)
                        .font(ScoutTypography.code(12))
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(host == nil ? "Add Host" : "Edit Host")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(Draft(
                            label: label,
                            host: hostName,
                            port: Int(port) ?? 22,
                            username: username,
                            credentialKind: credentialKind,
                            secret: secret,
                            startupProfile: startupProfile,
                            startupCommandOverride: startupCommandOverride
                        ))
                    }
                    .disabled(hostName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
