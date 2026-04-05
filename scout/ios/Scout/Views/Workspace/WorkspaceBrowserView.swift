// WorkspaceBrowserView — Browse and open projects from the bridge's workspace.
//
// Tap a project → opens a claude-code session in that directory → navigates to it.
// Long-press for adapter options. Browsing into subdirectories supported.

import SwiftUI

struct WorkspaceBrowserView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    /// Called with the new session ID after successfully opening a project.
    var onSessionCreated: ((String) -> Void)?

    @State private var entries: [DirectoryEntry] = []
    @State private var currentPath: String = ""
    @State private var rootPath: String = ""
    @State private var breadcrumbs: [String] = []
    @State private var isLoading = true
    @State private var isOpening = false
    @State private var error: String?
    @State private var workspaceConfigured = false
    @State private var selectedProject: DirectoryEntry?
    @State private var searchText = ""
    @State private var allowedWorkspaceRoots: Set<String> = []

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var connectionMessage: String? {
        switch connection.state {
        case .connected:
            return nil
        case .connecting, .handshaking:
            return "Connecting to Scout on your Mac…"
        case .reconnecting:
            return "Reconnecting to Scout on your Mac…"
        case .failed:
            return "Scout on your Mac is unavailable right now."
        case .disconnected:
            return connection.hasTrustedBridge ? "Scout on your Mac is unavailable right now." : "Pair with Scout on your Mac first."
        }
    }

    private var filteredEntries: [DirectoryEntry] {
        let tokens = searchText.searchTokens
        let eligibleEntries = entries.filter { entry in
            !entry.isProject || allowedWorkspaceRoots.contains(entry.path)
        }
        guard !tokens.isEmpty else { return eligibleEntries }

        return eligibleEntries.filter { entry in
            tokens.allSatisfy { token in
                entry.name.localizedCaseInsensitiveContains(token)
                    || entry.path.localizedCaseInsensitiveContains(token)
                    || entry.markers.contains(where: { $0.localizedCaseInsensitiveContains(token) })
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let connectionMessage, !isConnected {
                    connectionStateView(connectionMessage)
                } else if isLoading {
                    loadingView
                } else if !workspaceConfigured {
                    noWorkspaceView
                } else if let error {
                    errorView(error)
                } else {
                    directoryList
                }
            }
            .background(DispatchColors.backgroundAdaptive)
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .searchable(text: $searchText, prompt: "Find projects or folders")
            .overlay {
                if isOpening {
                    openingOverlay
                }
            }
            .sheet(item: $selectedProject) { project in
                HarnessPickerView(
                    projectName: project.name,
                    projectPath: project.path
                ) { config in
                    openProject(project, config: config)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await loadWorkspace() }
    }

    // MARK: - Directory listing

    private var directoryList: some View {
        VStack(spacing: 0) {
            if !breadcrumbs.isEmpty {
                breadcrumbBar
            }

            if entries.isEmpty {
                emptyDirectory
            } else if filteredEntries.isEmpty {
                emptySearchResults
            } else {
                List {
                    let projects = filteredEntries.filter(\.isProject)
                    let dirs = filteredEntries.filter { !$0.isProject }

                    if !projects.isEmpty {
                        Section {
                            ForEach(projects) { entry in
                                ProjectRow(entry: entry) {
                                    selectedProject = entry
                                } onNavigate: {
                                    navigateInto(entry)
                                }
                            }
                        } header: {
                            Text("Projects")
                                .font(DispatchTypography.caption(12, weight: .semibold))
                                .foregroundStyle(DispatchColors.textSecondary)
                        }
                    }

                    if !dirs.isEmpty {
                        Section {
                            ForEach(dirs) { entry in
                                DirectoryRow(entry: entry) {
                                    navigateInto(entry)
                                }
                            }
                        } header: {
                            Text("Folders")
                                .font(DispatchTypography.caption(12, weight: .semibold))
                                .foregroundStyle(DispatchColors.textSecondary)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
    }

    // MARK: - Breadcrumb navigation

    private var breadcrumbBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Button {
                    Task { await browse(path: nil) }
                } label: {
                    Image(systemName: "house.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DispatchColors.accent)
                }

                ForEach(Array(breadcrumbs.enumerated()), id: \.offset) { index, crumb in
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(DispatchColors.textMuted)

                    Button {
                        let subPath = breadcrumbs.prefix(index + 1).joined(separator: "/")
                        Task { await browse(path: subPath) }
                    } label: {
                        Text(crumb)
                            .font(DispatchTypography.caption(13, weight: .medium))
                            .foregroundStyle(
                                index == breadcrumbs.count - 1
                                    ? DispatchColors.textPrimary
                                    : DispatchColors.accent
                            )
                    }
                    .disabled(index == breadcrumbs.count - 1)
                }
            }
            .padding(.horizontal, DispatchSpacing.lg)
            .padding(.vertical, DispatchSpacing.sm)
        }
        .background(DispatchColors.surfaceAdaptive)
    }

    // MARK: - Opening overlay

    private var openingOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: DispatchSpacing.lg) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                Text("Starting session...")
                    .font(DispatchTypography.body(16, weight: .medium))
                    .foregroundStyle(.white)
            }
            .padding(DispatchSpacing.xxl)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.lg, style: .continuous))
        }
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: DispatchSpacing.lg) {
            ProgressView()
            Text("Loading workspace...")
                .font(DispatchTypography.body(15))
                .foregroundStyle(DispatchColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noWorkspaceView: some View {
        VStack(spacing: DispatchSpacing.xl) {
            Spacer()
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(DispatchColors.textMuted)

            VStack(spacing: DispatchSpacing.sm) {
                Text("No workspace configured")
                    .font(DispatchTypography.body(18, weight: .semibold))
                    .foregroundStyle(DispatchColors.textPrimary)

                Text("Run `scout setup` on your computer to set up a workspace root.")
                    .font(DispatchTypography.body(14))
                    .foregroundStyle(DispatchColors.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(DispatchColors.statusError)

            Text(message)
                .font(DispatchTypography.body(14))
                .foregroundStyle(DispatchColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task { await loadWorkspace() }
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    private func connectionStateView(_ message: String) -> some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(DispatchColors.statusError)
            Text(message)
                .font(DispatchTypography.body(14))
                .foregroundStyle(DispatchColors.textSecondary)
                .multilineTextAlignment(.center)
            if connection.hasTrustedBridge {
                Button("Retry") {
                    Task { await connection.reconnect() }
                }
                .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    private var emptyDirectory: some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "folder")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(DispatchColors.textMuted)
            Text("Empty directory")
                .font(DispatchTypography.body(15))
                .foregroundStyle(DispatchColors.textSecondary)
            Spacer()
        }
    }

    private var emptySearchResults: some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "magnifyingglass")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(DispatchColors.textMuted)
            Text("No projects match")
                .font(DispatchTypography.body(15, weight: .semibold))
                .foregroundStyle(DispatchColors.textPrimary)
            Text("Try a broader search for the project or folder name.")
                .font(DispatchTypography.body(13))
                .foregroundStyle(DispatchColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    // MARK: - Actions

    private func loadWorkspace() async {
        guard isConnected else {
            isLoading = false
            return
        }
        isLoading = true
        error = nil

        do {
            async let infoTask = connection.workspaceInfo()
            async let workspaceTask = connection.listMobileWorkspaces(limit: 500)
            let (info, workspaces) = try await (infoTask, workspaceTask)
            workspaceConfigured = info.configured
            allowedWorkspaceRoots = Set(workspaces.map(\.root))

            if info.configured {
                rootPath = info.root ?? ""
                await browse(path: nil)
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func browse(path: String?) async {
        do {
            let response = try await connection.workspaceList(path: path)
            entries = response.entries
            currentPath = response.path

            if response.path == response.root || response.path.isEmpty {
                breadcrumbs = []
            } else {
                let relative = response.path
                    .replacingOccurrences(of: response.root, with: "")
                    .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                breadcrumbs = relative.isEmpty ? [] : relative.components(separatedBy: "/")
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func navigateInto(_ entry: DirectoryEntry) {
        Task {
            let relative = entry.path
                .replacingOccurrences(of: rootPath, with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            await browse(path: relative)
        }
    }

    private func openProject(_ entry: DirectoryEntry, config: HarnessConfig) {
        guard !isOpening else { return }
        guard allowedWorkspaceRoots.contains(entry.path) else {
            error = "This project is not registered with Scout yet."
            return
        }
        isOpening = true

        Task {
            do {
                let session = try await connection.createMobileSession(
                    workspaceId: entry.path,
                    harness: config.harness.id,
                    agentName: entry.name
                )
                dismiss()
                try? await Task.sleep(for: .milliseconds(300))
                onSessionCreated?(session.session.conversationId)
            } catch {
                isOpening = false
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Project Row

private struct ProjectRow: View {
    let entry: DirectoryEntry
    let onOpen: () -> Void
    let onNavigate: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: DispatchSpacing.md) {
                // Project icon with marker-based color
                ZStack {
                    RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous)
                        .fill(markerColor.opacity(0.12))
                        .frame(width: 40, height: 40)

                    Image(systemName: markerIcon)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(markerColor)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(DispatchTypography.body(16, weight: .semibold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    HStack(spacing: 6) {
                        ForEach(entry.markers, id: \.self) { marker in
                            Text(marker)
                                .font(DispatchTypography.caption(11, weight: .medium))
                                .foregroundStyle(DispatchColors.textMuted)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DispatchColors.surfaceAdaptive)
                                .clipShape(Capsule())
                        }
                    }
                }

                Spacer()

                // Navigate into folder
                Button(action: onNavigate) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DispatchColors.textMuted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var markerIcon: String {
        let m = entry.markers.first ?? ""
        switch m {
        case "swift", "xcode": return "swift"
        case "rust":           return "gearshape.2"
        case "go":             return "arrow.right.arrow.left"
        case "python":         return "chevron.left.forwardslash.chevron.right"
        case "node":           return "cube"
        case "ruby":           return "diamond"
        case "java":           return "cup.and.saucer"
        case "cpp", "make":    return "wrench"
        default:               return "folder.fill"
        }
    }

    private var markerColor: Color {
        let m = entry.markers.first ?? ""
        switch m {
        case "swift", "xcode": return .orange
        case "rust":           return .brown
        case "go":             return .cyan
        case "python":         return .yellow
        case "node":           return .green
        case "ruby":           return .red
        case "java":           return .blue
        case "cpp", "make":    return .purple
        default:               return DispatchColors.accent
        }
    }
}

// MARK: - Directory Row (non-project)

private struct DirectoryRow: View {
    let entry: DirectoryEntry
    let onNavigate: () -> Void

    var body: some View {
        Button(action: onNavigate) {
            HStack(spacing: DispatchSpacing.md) {
                Image(systemName: "folder")
                    .font(.system(size: 17))
                    .foregroundStyle(DispatchColors.textMuted)
                    .frame(width: 40, height: 40)

                Text(entry.name)
                    .font(DispatchTypography.body(15))
                    .foregroundStyle(DispatchColors.textSecondary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DispatchColors.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
