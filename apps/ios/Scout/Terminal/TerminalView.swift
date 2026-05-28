// TerminalView - Full-screen Scout iOS terminal scaffold.

import SwiftUI
import UIKit
import MobileKeyboardKit

struct ScoutTerminalView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var store = ScoutTerminalStore()
    @State private var adapter = makeDefaultScoutTerminalAdapter()
    @State private var showingHostEditor = false
    @State private var editingHost: ScoutTerminalSavedHost?
    @State private var pendingDeleteHost: ScoutTerminalSavedHost?
    @State private var errorMessage: String?
    @State private var keyboardPresentation: ScoutTerminalKeyboardPresentation = .oneRow

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
            terminalKeyboardTray
        }
        .padding(usesCompactLayout ? ScoutSpacing.md : ScoutSpacing.xl)
        .padding(.bottom, 92)
    }

    private var terminalKeyboardTray: some View {
        ScoutTerminalKeyboardTray(
            presentation: $keyboardPresentation,
            onSendText: { adapter.sendText($0) },
            onSendBytes: { adapter.sendBytes($0) },
            onShortcut: { adapter.sendShortcut($0) }
        )
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

private enum ScoutTerminalKeyboardPresentation: String, CaseIterable {
    case hidden
    case oneRow
    case twoRow
    case threeRow
    case full
}

private struct ScoutTerminalKeyboardTray: View {
    @Binding var presentation: ScoutTerminalKeyboardPresentation

    let onSendText: (String) -> Void
    let onSendBytes: ([UInt8]) -> Void
    let onShortcut: (ScoutTerminalShortcut) -> Void

    private var visibleRows: [[ScoutTerminalKey]] {
        switch presentation {
        case .hidden, .full:
            []
        case .oneRow:
            [shortcutRows[0]]
        case .twoRow:
            Array(shortcutRows.prefix(2))
        case .threeRow:
            shortcutRows
        }
    }

    var body: some View {
        VStack(spacing: ScoutSpacing.sm) {
            if presentation == .hidden {
                collapsedLauncher
            } else {
                modeBar

                if presentation == .full {
                    MobileCompactKeyboardView(
                        onInsert: { insert($0) },
                        onDelete: { send(bytes: [0x7F]) },
                        onReturn: { send(bytes: [0x0D]) },
                        onVoice: {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                presentation = .oneRow
                            }
                        }
                    )
                    .frame(height: MobileCompactKeyboard.preferredHeight)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    VStack(spacing: 5) {
                        ForEach(Array(visibleRows.enumerated()), id: \.offset) { _, row in
                            HStack(spacing: 5) {
                                ForEach(row) { key in
                                    terminalKeyButton(key)
                                }
                            }
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .padding(.horizontal, ScoutSpacing.sm)
        .padding(.vertical, ScoutSpacing.sm)
        .background {
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .fill(ScoutColors.surfaceAdaptive.opacity(0.86))
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: ScoutRadius.lg))
        }
        .overlay {
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .stroke(ScoutColors.divider.opacity(0.65), lineWidth: 0.5)
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: presentation)
    }

    private var collapsedLauncher: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                presentation = .oneRow
            }
        } label: {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "keyboard")
                    .font(.system(size: 15, weight: .semibold))
                Text("Keyboard")
                    .font(ScoutTypography.code(11, weight: .semibold))
                Spacer()
                Text("Shortcuts")
                    .font(ScoutTypography.code(10, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .foregroundStyle(ScoutColors.textSecondary)
            .frame(height: 34)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show terminal keyboard")
    }

    private var modeBar: some View {
        HStack(spacing: ScoutSpacing.xs) {
            Image(systemName: "keyboard")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 28, height: 28)

            presentationButton(.oneRow, label: "1")
            presentationButton(.twoRow, label: "2")
            presentationButton(.threeRow, label: "3")
            presentationButton(.full, label: "ABC")

            Spacer(minLength: ScoutSpacing.sm)

            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    presentation = .hidden
                }
            } label: {
                Image(systemName: "keyboard.chevron.compact.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(width: 34, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide terminal keyboard")
        }
        .frame(height: 32)
    }

    private func presentationButton(
        _ target: ScoutTerminalKeyboardPresentation,
        label: String
    ) -> some View {
        let selected = presentation == target

        return Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                presentation = target
            }
        } label: {
            Text(label)
                .font(ScoutTypography.code(10, weight: .bold))
                .foregroundStyle(selected ? ScoutColors.textPrimary : ScoutColors.textSecondary)
                .frame(width: label.count > 1 ? 46 : 34, height: 30)
                .background {
                    RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                        .fill(selected ? ScoutColors.surfaceRaisedAdaptive : Color.clear)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label == "ABC" ? "Full keyboard" : "\(label) row keyboard")
    }

    private func terminalKeyButton(_ key: ScoutTerminalKey) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            perform(key)
        } label: {
            HStack(spacing: 4) {
                if let systemImage = key.systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(key.title)
                    .font(ScoutTypography.code(key.title.count > 4 ? 10 : 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .foregroundStyle(ScoutColors.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 38)
            .background {
                RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                    .fill(ScoutColors.cardBg.opacity(0.78))
            }
            .overlay {
                RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                    .stroke(ScoutColors.divider.opacity(0.55), lineWidth: 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(key.accessibilityLabel)
    }

    private func perform(_ key: ScoutTerminalKey) {
        switch key.action {
        case .text(let text):
            insert(text)
        case .bytes(let bytes):
            send(bytes: bytes)
        case .shortcut(let shortcut):
            onShortcut(shortcut)
        }
    }

    private func insert(_ text: String) {
        onSendText(text)
    }

    private func send(bytes: [UInt8]) {
        onSendBytes(bytes)
    }

    private var shortcutRows: [[ScoutTerminalKey]] {
        [
            [
                .shortcut("Esc", .escape),
                .bytes("C-c", [0x03], accessibilityLabel: "Control C"),
                .shortcut("Tab", .tab),
                .text("Space", " "),
                .bytes("Enter", [0x0D]),
                .bytes("Del", [0x7F], systemImage: "delete.left", accessibilityLabel: "Delete"),
            ],
            [
                .bytes("Left", Array("\u{1B}[D".utf8), systemImage: "arrow.left"),
                .bytes("Down", Array("\u{1B}[B".utf8), systemImage: "arrow.down"),
                .bytes("Up", Array("\u{1B}[A".utf8), systemImage: "arrow.up"),
                .bytes("Right", Array("\u{1B}[C".utf8), systemImage: "arrow.right"),
                .text("/", "/"),
                .text("-", "-"),
            ],
            [
                .bytes("C-d", [0x04], accessibilityLabel: "Control D"),
                .bytes("C-l", [0x0C], accessibilityLabel: "Control L"),
                .text("cd ..", "cd .."),
                .text("clear", "clear\r"),
                .text("|", "|"),
                .text("~", "~"),
            ],
        ]
    }
}

private struct ScoutTerminalKey: Identifiable {
    enum Action {
        case text(String)
        case bytes([UInt8])
        case shortcut(ScoutTerminalShortcut)
    }

    let id: String
    let title: String
    let systemImage: String?
    let accessibilityLabel: String
    let action: Action

    static func text(
        _ title: String,
        _ text: String,
        systemImage: String? = nil,
        accessibilityLabel: String? = nil
    ) -> ScoutTerminalKey {
        ScoutTerminalKey(
            id: "text-\(title)-\(text)",
            title: title,
            systemImage: systemImage,
            accessibilityLabel: accessibilityLabel ?? title,
            action: .text(text)
        )
    }

    static func bytes(
        _ title: String,
        _ bytes: [UInt8],
        systemImage: String? = nil,
        accessibilityLabel: String? = nil
    ) -> ScoutTerminalKey {
        ScoutTerminalKey(
            id: "bytes-\(title)-\(bytes.map(String.init).joined(separator: "-"))",
            title: title,
            systemImage: systemImage,
            accessibilityLabel: accessibilityLabel ?? title,
            action: .bytes(bytes)
        )
    }

    static func shortcut(
        _ title: String,
        _ shortcut: ScoutTerminalShortcut,
        systemImage: String? = nil,
        accessibilityLabel: String? = nil
    ) -> ScoutTerminalKey {
        ScoutTerminalKey(
            id: "shortcut-\(shortcut.rawValue)",
            title: title,
            systemImage: systemImage,
            accessibilityLabel: accessibilityLabel ?? shortcut.title,
            action: .shortcut(shortcut)
        )
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
