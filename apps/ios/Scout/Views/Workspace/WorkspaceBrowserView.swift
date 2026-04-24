// WorkspaceBrowserView — Browse and open projects from the bridge's workspace.
//
// Tap a project → opens a claude-code session in that directory → navigates to it.
// Long-press for adapter options. Browsing into subdirectories supported.

import SwiftUI

struct WorkspaceBrowserView: View {
    @Environment(ConnectionManager.self) private var connection

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
        default:
            return connection.statusDetails.message
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
        .background(ScoutColors.backgroundAdaptive)
        .searchable(text: $searchText, prompt: "Find projects or folders")
        .overlay {
            if isOpening {
                openingOverlay
            }
        }
        .sheet(item: $selectedProject) { project in
            HarnessPickerView(
                projectName: project.name,
                projectPath: project.path,
                projectBranch: project.currentBranch
            ) { action in
                switch action {
                case .createNew(let config):
                    openProject(project, config: config)
                case .resume(let sessionId):
                    selectedProject = nil
                    onSessionCreated?(sessionId)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: 0)
        }
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
                                .listRowInsets(EdgeInsets(top: 0, leading: ScoutSpacing.lg, bottom: 0, trailing: ScoutSpacing.lg))
                            }
                        } header: {
                            Text("PROJECTS  \(projects.count)")
                                .font(ScoutTypography.code(10, weight: .semibold))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                    }

                    if !dirs.isEmpty {
                        Section {
                            ForEach(dirs) { entry in
                                DirectoryRow(entry: entry) {
                                    navigateInto(entry)
                                }
                                .listRowInsets(EdgeInsets(top: 0, leading: ScoutSpacing.lg, bottom: 0, trailing: ScoutSpacing.lg))
                            }
                        } header: {
                            Text("FOLDERS  \(dirs.count)")
                                .font(ScoutTypography.code(10, weight: .semibold))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Breadcrumb navigation

    private var breadcrumbBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 3) {
                Button {
                    Task { await browse(path: nil) }
                } label: {
                    Text("~")
                        .font(ScoutTypography.code(12, weight: .medium))
                        .foregroundStyle(ScoutColors.textSecondary)
                }

                ForEach(Array(breadcrumbs.enumerated()), id: \.offset) { index, crumb in
                    Text("/")
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textMuted)

                    Button {
                        let subPath = breadcrumbs.prefix(index + 1).joined(separator: "/")
                        Task { await browse(path: subPath) }
                    } label: {
                        Text(crumb)
                            .font(ScoutTypography.code(12, weight: index == breadcrumbs.count - 1 ? .medium : .regular))
                            .foregroundStyle(
                                index == breadcrumbs.count - 1
                                    ? ScoutColors.textPrimary
                                    : ScoutColors.textSecondary
                            )
                    }
                    .disabled(index == breadcrumbs.count - 1)
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
            .padding(.vertical, ScoutSpacing.sm)
        }
        .background(ScoutColors.surfaceAdaptive)
    }

    // MARK: - Opening overlay

    private var openingOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: ScoutSpacing.lg) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                Text("Starting session...")
                    .font(ScoutTypography.body(16, weight: .medium))
                    .foregroundStyle(.white)
            }
            .padding(ScoutSpacing.xxl)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        }
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
            Text("Loading workspace...")
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noWorkspaceView: some View {
        VStack(spacing: ScoutSpacing.xl) {
            Spacer()
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(ScoutColors.textMuted)

            VStack(spacing: ScoutSpacing.sm) {
                Text("No workspace configured")
                    .font(ScoutTypography.body(18, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                Text("Run `scout setup` on your computer to set up a workspace root.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ScoutColors.statusError)

            Text(message)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task { await loadWorkspace() }
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func connectionStateView(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: connection.statusDetails.symbol)
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ScoutColors.statusError)
            Text(message)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
            if connection.statusDetails.allowsRetry {
                Button("Retry") {
                    Task { await connection.reconnect() }
                }
                .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private var emptyDirectory: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "folder")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ScoutColors.textMuted)
            Text("Empty directory")
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
            Spacer()
        }
    }

    private var emptySearchResults: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "magnifyingglass")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(ScoutColors.textMuted)
            Text("No projects match")
                .font(ScoutTypography.body(15, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
            Text("Try a broader search for the project or folder name.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
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
                    agentName: entry.name,
                    worktree: config.worktree ? "auto" : nil,
                    branch: config.branch,
                    model: config.model,
                    forceNew: true
                )
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
            HStack(spacing: ScoutSpacing.sm) {
                Text(entry.name)
                    .font(ScoutTypography.code(13, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)

                ForEach(entry.markers, id: \.self) { marker in
                    Text(marker)
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer(minLength: 0)

                if let branch = entry.currentBranch?.trimmedNonEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 8, weight: .medium))
                        Text(branch)
                            .font(ScoutTypography.code(10))
                    }
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                }

                Button(action: onNavigate) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Directory Row (non-project)

private struct DirectoryRow: View {
    let entry: DirectoryEntry
    let onNavigate: () -> Void

    var body: some View {
        Button(action: onNavigate) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "folder")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 16)

                Text(entry.name)
                    .font(ScoutTypography.code(13))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
