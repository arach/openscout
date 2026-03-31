// SessionDiscoveryView — Browse past sessions from the bridge's history/discover RPC.
//
// Groups discovered JSONL sessions by project, sorted by recency.
// Tapping a session opens it in SpectatorView (WKWebView).
// Shows live scanning status with skeleton shimmer during load.
// Optionally filters to a specific project (e.g., current session context).

import SwiftUI

struct SessionDiscoveryView: View {
    /// Optional project filter — when set, only shows sessions for this project.
    var projectFilter: String? = nil
    /// Called with the new session ID when a session is resumed from spectator.
    var onResumed: ((String) -> Void)?

    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [DiscoveredSession] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var scanStatus: String = "Connecting to bridge..."
    @State private var selectedSession: DiscoveredSession?

    private var groupedByProject: [(project: String, sessions: [DiscoveredSession])] {
        let grouped = Dictionary(grouping: sessions) { $0.project }
        return grouped
            .map { (project: $0.key, sessions: $0.value) }
            .sorted { lhs, rhs in
                let lhsLatest = lhs.sessions.map(\.modifiedAt).max() ?? 0
                let rhsLatest = rhs.sessions.map(\.modifiedAt).max() ?? 0
                return lhsLatest > rhsLatest
            }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if sessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(DispatchColors.backgroundAdaptive)
            .navigationTitle(projectFilter ?? "Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(DispatchColors.textMuted)
                            .symbolRenderingMode(.hierarchical)
                    }
                }
            }
            .fullScreenCover(item: $selectedSession) { session in
                SpectatorView(
                    sessionPath: session.path,
                    sessionName: session.project,
                    agentType: session.agent
                ) { newSessionId in
                    selectedSession = nil
                    dismiss()
                    onResumed?(newSessionId)
                }
            }
        }
        .task {
            await loadSessions()
        }
    }

    // MARK: - Session List

    private var sessionList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(groupedByProject, id: \.project) { group in
                    projectSection(group.project, sessions: group.sessions)
                }
            }
            .padding(.top, DispatchSpacing.sm)
        }
    }

    private func projectSection(_ project: String, sessions: [DiscoveredSession]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DispatchSpacing.sm) {
                Image(systemName: agentIcon(for: sessions.first?.agent ?? "unknown"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DispatchColors.accent)
                Text(project)
                    .font(DispatchTypography.caption(13, weight: .semibold))
                    .foregroundStyle(DispatchColors.textSecondary)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                Text("\(sessions.count)")
                    .font(DispatchTypography.caption(12, weight: .medium))
                    .foregroundStyle(DispatchColors.textMuted)
            }
            .padding(.horizontal, DispatchSpacing.lg)
            .padding(.vertical, DispatchSpacing.md)

            ForEach(sessions) { session in
                sessionRow(session)
            }
        }
    }

    private func sessionRow(_ session: DiscoveredSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: DispatchSpacing.md) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(DispatchColors.accent.opacity(0.15))
                    .frame(width: 4, height: 32)

                VStack(alignment: .leading, spacing: 3) {
                    Text(sessionDisplayName(session.path))
                        .font(DispatchTypography.code(13, weight: .medium))
                        .foregroundStyle(DispatchColors.textPrimary)
                        .lineLimit(1)

                    HStack(spacing: DispatchSpacing.md) {
                        Label(AdapterIcon.displayName(for: session.agent), systemImage: agentIcon(for: session.agent))
                            .font(DispatchTypography.caption(11))
                            .foregroundStyle(DispatchColors.textMuted)
                        Text("\(session.lineCount) lines")
                            .font(DispatchTypography.caption(11))
                            .foregroundStyle(DispatchColors.textMuted)
                        Text(RelativeTime.string(from: session.modifiedDate))
                            .font(DispatchTypography.caption(11))
                            .foregroundStyle(DispatchColors.textMuted)
                    }
                }

                Spacer()

                Image(systemName: "play.circle")
                    .font(.system(size: 20, weight: .light))
                    .foregroundStyle(DispatchColors.accent.opacity(0.6))
            }
            .padding(.horizontal, DispatchSpacing.lg)
            .padding(.vertical, DispatchSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Loading State (skeleton + live status)

    private var loadingState: some View {
        VStack(spacing: 0) {
            // Live status bar
            HStack(spacing: DispatchSpacing.sm) {
                BrailleSpinner()
                Text(scanStatus)
                    .font(DispatchTypography.code(12, weight: .medium))
                    .foregroundStyle(DispatchColors.accent)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, DispatchSpacing.lg)
            .padding(.vertical, DispatchSpacing.md)
            .background(DispatchColors.accent.opacity(0.06))

            // Skeleton rows with shimmer
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(0..<3, id: \.self) { _ in skeletonSection }
                }
                .padding(.top, DispatchSpacing.sm)
            }
            .allowsHitTesting(false)
        }
    }

    private var skeletonSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DispatchSpacing.sm) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(DispatchColors.textMuted.opacity(0.15))
                    .frame(width: 14, height: 14)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(DispatchColors.textMuted.opacity(0.12))
                    .frame(width: 80, height: 12)
                Spacer()
            }
            .padding(.horizontal, DispatchSpacing.lg)
            .padding(.vertical, DispatchSpacing.md)

            ForEach(0..<3, id: \.self) { idx in
                HStack(spacing: DispatchSpacing.md) {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(DispatchColors.accent.opacity(0.08))
                        .frame(width: 4, height: 32)

                    VStack(alignment: .leading, spacing: 5) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(DispatchColors.textMuted.opacity(0.12))
                            .frame(width: [140, 160, 120][idx], height: 12)
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(DispatchColors.textMuted.opacity(0.08))
                            .frame(width: [180, 200, 170][idx], height: 10)
                    }
                    Spacer()
                }
                .padding(.horizontal, DispatchSpacing.lg)
                .padding(.vertical, DispatchSpacing.md)
            }
        }
        .shimmering()
    }

    // MARK: - Error / Empty States

    private func errorState(_ message: String) -> some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(DispatchColors.statusError)
            Text(message)
                .font(DispatchTypography.body(14))
                .foregroundStyle(DispatchColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await loadSessions() }
            }
            .font(DispatchTypography.body(14, weight: .medium))
            .foregroundStyle(DispatchColors.accent)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    private var emptyState: some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(DispatchColors.textMuted)
            Text("No sessions found")
                .font(DispatchTypography.body(16, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)
            Text(projectFilter != nil
                 ? "No JSONL sessions found for \(projectFilter!) in the last 14 days."
                 : "No JSONL session files found in the last 14 days.")
                .font(DispatchTypography.body(14))
                .foregroundStyle(DispatchColors.textMuted)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }

    // MARK: - Data Loading

    /// Scan known locations, updating status as we go.
    private func loadSessions() async {
        isLoading = true
        error = nil
        sessions = []

        let scanDirs = [
            ("~/.claude/projects", "claude-code"),
            ("~/.codex", "codex"),
            ("~/.openai-codex", "codex"),
        ]

        var allSessions: [DiscoveredSession] = []

        for (dir, _) in scanDirs {
            scanStatus = "Scanning \(dir)..."

            do {
                let response = try await connection.historyDiscover(
                    maxAge: 14, limit: 50, project: projectFilter
                )

                let existingPaths = Set(allSessions.map(\.path))
                let newSessions = response.sessions.filter { !existingPaths.contains($0.path) }
                allSessions.append(contentsOf: newSessions)
                allSessions.sort { $0.modifiedAt > $1.modifiedAt }
                sessions = allSessions

                if !newSessions.isEmpty {
                    let projects = Set(allSessions.map(\.project))
                    scanStatus = "Found \(allSessions.count) sessions across \(projects.count) projects"
                }

                // Bridge scans all roots in one call for now — break after first success
                break
            } catch {
                self.error = "Failed to discover sessions: \(error.localizedDescription)"
                break
            }
        }

        if allSessions.isEmpty && error == nil {
            scanStatus = "No sessions found"
        } else if !allSessions.isEmpty {
            let projects = Set(allSessions.map(\.project))
            scanStatus = "⠿ \(allSessions.count) sessions · \(projects.count) projects"
        }

        isLoading = false
    }

    // MARK: - Helpers

    private func sessionDisplayName(_ path: String) -> String {
        let filename = (path as NSString).lastPathComponent
        let name = filename.replacingOccurrences(of: ".jsonl", with: "")
        if name.count > 24 {
            return String(name.prefix(10)) + "..." + String(name.suffix(8))
        }
        return name
    }

    private func agentIcon(for agent: String) -> String {
        switch agent.lowercased() {
        case "claude-code", "claude": "terminal"
        case "codex": "brain"
        case "aider": "text.cursor"
        default: "cpu"
        }
    }
}

// MARK: - Braille spinner

struct BrailleSpinner: View {
    private static let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    @State private var index = 0
    @State private var timer: Timer?

    var body: some View {
        Text(Self.frames[index])
            .font(DispatchTypography.code(14, weight: .bold))
            .foregroundStyle(DispatchColors.accent)
            .onAppear {
                timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [self] _ in
                    Task { @MainActor in
                        index = (index + 1) % Self.frames.count
                    }
                }
            }
            .onDisappear {
                timer?.invalidate()
                timer = nil
            }
    }
}

// MARK: - Shimmer effect for skeleton loading

struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                LinearGradient(
                    colors: [.clear, .white.opacity(0.08), .white.opacity(0.14), .white.opacity(0.08), .clear],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .offset(x: phase * 350)
                .allowsHitTesting(false)
            }
            .clipped()
            .onAppear {
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

extension View {
    func shimmering() -> some View {
        modifier(ShimmerModifier())
    }
}

// MARK: - Preview

#Preview {
    SessionDiscoveryView()
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}
