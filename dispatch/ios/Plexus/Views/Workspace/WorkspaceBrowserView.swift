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

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    loadingView
                } else if !workspaceConfigured {
                    noWorkspaceView
                } else if let error {
                    errorView(error)
                } else {
                    directoryList
                }
            }
            .background(PlexusColors.backgroundAdaptive)
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .overlay {
                if isOpening {
                    openingOverlay
                }
            }
            .sheet(item: $selectedProject) { project in
                HarnessPickerView(
                    projectName: project.name,
                    projectPath: project.path
                ) { harness in
                    openProject(project, harness: harness)
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
            } else {
                List {
                    let projects = entries.filter(\.isProject)
                    let dirs = entries.filter { !$0.isProject }

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
                                .font(PlexusTypography.caption(12, weight: .semibold))
                                .foregroundStyle(PlexusColors.textSecondary)
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
                                .font(PlexusTypography.caption(12, weight: .semibold))
                                .foregroundStyle(PlexusColors.textSecondary)
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
                        .foregroundStyle(PlexusColors.accent)
                }

                ForEach(Array(breadcrumbs.enumerated()), id: \.offset) { index, crumb in
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(PlexusColors.textMuted)

                    Button {
                        let subPath = breadcrumbs.prefix(index + 1).joined(separator: "/")
                        Task { await browse(path: subPath) }
                    } label: {
                        Text(crumb)
                            .font(PlexusTypography.caption(13, weight: .medium))
                            .foregroundStyle(
                                index == breadcrumbs.count - 1
                                    ? PlexusColors.textPrimary
                                    : PlexusColors.accent
                            )
                    }
                    .disabled(index == breadcrumbs.count - 1)
                }
            }
            .padding(.horizontal, PlexusSpacing.lg)
            .padding(.vertical, PlexusSpacing.sm)
        }
        .background(PlexusColors.surfaceAdaptive)
    }

    // MARK: - Opening overlay

    private var openingOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: PlexusSpacing.lg) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                Text("Starting session...")
                    .font(PlexusTypography.body(16, weight: .medium))
                    .foregroundStyle(.white)
            }
            .padding(PlexusSpacing.xxl)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.lg, style: .continuous))
        }
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: PlexusSpacing.lg) {
            ProgressView()
            Text("Loading workspace...")
                .font(PlexusTypography.body(15))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noWorkspaceView: some View {
        VStack(spacing: PlexusSpacing.xl) {
            Spacer()
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(PlexusColors.textMuted)

            VStack(spacing: PlexusSpacing.sm) {
                Text("No workspace configured")
                    .font(PlexusTypography.body(18, weight: .semibold))
                    .foregroundStyle(PlexusColors.textPrimary)

                Text("Run `plexus init` on your computer to set up a workspace root.")
                    .font(PlexusTypography.body(14))
                    .foregroundStyle(PlexusColors.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(PlexusColors.statusError)

            Text(message)
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task { await loadWorkspace() }
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }

    private var emptyDirectory: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            Image(systemName: "folder")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(PlexusColors.textMuted)
            Text("Empty directory")
                .font(PlexusTypography.body(15))
                .foregroundStyle(PlexusColors.textSecondary)
            Spacer()
        }
    }

    // MARK: - Actions

    private func loadWorkspace() async {
        isLoading = true
        error = nil

        do {
            let info = try await connection.workspaceInfo()
            workspaceConfigured = info.configured

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

    private func openProject(_ entry: DirectoryEntry, harness: Harness? = nil) {
        guard !isOpening else { return }
        isOpening = true

        let adapter = harness?.id ?? "claude-code"

        Task {
            do {
                let session = try await connection.workspaceOpen(
                    path: entry.path,
                    adapter: adapter,
                    name: entry.name
                )
                dismiss()
                try? await Task.sleep(for: .milliseconds(300))
                onSessionCreated?(session.id)
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
            HStack(spacing: PlexusSpacing.md) {
                // Project icon with marker-based color
                ZStack {
                    RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous)
                        .fill(markerColor.opacity(0.12))
                        .frame(width: 40, height: 40)

                    Image(systemName: markerIcon)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(markerColor)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(PlexusTypography.body(16, weight: .semibold))
                        .foregroundStyle(PlexusColors.textPrimary)

                    HStack(spacing: 6) {
                        ForEach(entry.markers, id: \.self) { marker in
                            Text(marker)
                                .font(PlexusTypography.caption(11, weight: .medium))
                                .foregroundStyle(PlexusColors.textMuted)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(PlexusColors.surfaceAdaptive)
                                .clipShape(Capsule())
                        }
                    }
                }

                Spacer()

                // Navigate into folder
                Button(action: onNavigate) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PlexusColors.textMuted)
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
        default:               return PlexusColors.accent
        }
    }
}

// MARK: - Directory Row (non-project)

private struct DirectoryRow: View {
    let entry: DirectoryEntry
    let onNavigate: () -> Void

    var body: some View {
        Button(action: onNavigate) {
            HStack(spacing: PlexusSpacing.md) {
                Image(systemName: "folder")
                    .font(.system(size: 17))
                    .foregroundStyle(PlexusColors.textMuted)
                    .frame(width: 40, height: 40)

                Text(entry.name)
                    .font(PlexusTypography.body(15))
                    .foregroundStyle(PlexusColors.textSecondary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PlexusColors.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
