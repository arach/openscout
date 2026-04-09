// SessionDiscoveryView — Deep search and browsing for past bridge sessions.
//
// Default mode browses discovered session files grouped by project.
// Typing into search switches to transcript + session search across older work.

import SwiftUI

struct SessionDiscoveryView: View {
    var projectFilter: String? = nil
    var onResumed: ((String) -> Void)?

    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [DiscoveredSession] = []
    @State private var transcriptMatches: [SearchMatch] = []
    @State private var isLoading = true
    @State private var isSearching = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var selectedSession: DiscoveredSession?
    @State private var selectedMatch: SearchMatch?

    private var query: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearchMode: Bool {
        !query.isEmpty
    }

    private var groupedByProject: [(project: String, sessions: [DiscoveredSession])] {
        let grouped = Dictionary(grouping: sessions) { $0.project }
        return grouped
            .map { (project: $0.key, sessions: $0.value.sorted { $0.modifiedAt > $1.modifiedAt }) }
            .sorted { lhs, rhs in
                let lhsLatest = lhs.sessions.map(\.modifiedAt).max() ?? 0
                let rhsLatest = rhs.sessions.map(\.modifiedAt).max() ?? 0
                return lhsLatest > rhsLatest
            }
    }

    private var matchingSessions: [DiscoveredSession] {
        guard isSearchMode else { return sessions }
        let tokens = query.searchTokens
        return sessions.filter { session in
            let haystacks = [
                session.project,
                session.path,
                sessionDisplayName(session.path),
                AdapterIcon.displayName(for: session.agent),
                session.agent,
            ]

            return tokens.allSatisfy { token in
                haystacks.contains { $0.localizedCaseInsensitiveContains(token) }
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && sessions.isEmpty {
                    loadingState
                } else if let error, sessions.isEmpty {
                    errorState(error)
                } else if isSearchMode {
                    searchResults
                } else if sessions.isEmpty {
                    emptyState
                } else {
                    browseResults
                }
            }
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle(projectFilter ?? "Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(ScoutColors.textMuted)
                            .symbolRenderingMode(.hierarchical)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search transcript, project, or session")
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
            .fullScreenCover(item: $selectedMatch) { match in
                SpectatorView(
                    sessionPath: match.path,
                    sessionName: match.project,
                    agentType: match.agent
                ) { newSessionId in
                    selectedMatch = nil
                    dismiss()
                    onResumed?(newSessionId)
                }
            }
        }
        .task {
            await loadSessions()
        }
        .task(id: query) {
            await searchHistoryIfNeeded()
        }
    }

    private var browseResults: some View {
        List {
            ForEach(groupedByProject, id: \.project) { group in
                Section {
                    ForEach(group.sessions) { session in
                        discoveredSessionRow(session)
                    }
                } header: {
                    HStack(spacing: ScoutSpacing.sm) {
                        Image(systemName: agentIcon(for: group.sessions.first?.agent ?? "unknown"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(ScoutColors.accent)
                        Text(group.project)
                            .font(ScoutTypography.caption(12, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                        Spacer()
                        Text("\(group.sessions.count)")
                            .font(ScoutTypography.caption(11, weight: .medium))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await loadSessions()
        }
    }

    private var searchResults: some View {
        List {
            if isSearching {
                HStack(spacing: ScoutSpacing.sm) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Searching...")
                        .font(ScoutTypography.body(14))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
                .padding(.vertical, ScoutSpacing.sm)
                .listRowBackground(ScoutColors.backgroundAdaptive)
            } else {
                if !transcriptMatches.isEmpty {
                    Section("Transcript") {
                        ForEach(transcriptMatches) { match in
                            transcriptMatchRow(match)
                                .listRowBackground(ScoutColors.backgroundAdaptive)
                        }
                    }
                }

                if !matchingSessions.isEmpty {
                    Section("Sessions") {
                        ForEach(matchingSessions) { session in
                            discoveredSessionRow(session)
                                .listRowBackground(ScoutColors.backgroundAdaptive)
                        }
                    }
                }

                if transcriptMatches.isEmpty && matchingSessions.isEmpty {
                    VStack(spacing: ScoutSpacing.sm) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(ScoutColors.textMuted)
                        Text("No results")
                            .font(ScoutTypography.body(15, weight: .semibold))
                            .foregroundStyle(ScoutColors.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xl)
                    .listRowBackground(ScoutColors.backgroundAdaptive)
                }
            }
        }
        .listStyle(.plain)
    }

    private func discoveredSessionRow(_ session: DiscoveredSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(ScoutColors.accent.opacity(0.15))
                    .frame(width: 4, height: 32)

                VStack(alignment: .leading, spacing: 3) {
                    Text(sessionDisplayName(session.path))
                        .font(ScoutTypography.code(13, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)

                    HStack(spacing: ScoutSpacing.md) {
                        Label(AdapterIcon.displayName(for: session.agent), systemImage: agentIcon(for: session.agent))
                            .font(ScoutTypography.caption(11))
                            .foregroundStyle(ScoutColors.textMuted)
                        Text(RelativeTime.string(from: session.modifiedDate))
                            .font(ScoutTypography.caption(11))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }

                Spacer()

                Image(systemName: "play.circle")
                    .font(.system(size: 20, weight: .light))
                    .foregroundStyle(ScoutColors.accent.opacity(0.6))
            }
            .padding(.vertical, ScoutSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func transcriptMatchRow(_ match: SearchMatch) -> some View {
        Button {
            selectedMatch = match
        } label: {
            VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                HStack(spacing: ScoutSpacing.sm) {
                    Image(systemName: AdapterIcon.systemName(for: match.agent))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(ScoutColors.accent)

                    Text(match.project)
                        .font(ScoutTypography.body(14, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)

                    Spacer()

                    Text("\(match.matchCount)")
                        .font(ScoutTypography.caption(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .padding(.horizontal, ScoutSpacing.sm)
                        .padding(.vertical, ScoutSpacing.xxs)
                        .background(ScoutColors.surfaceAdaptive)
                        .clipShape(Capsule())
                }

                Text((match.path as NSString).lastPathComponent)
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)

                ForEach(Array(match.preview.enumerated()), id: \.offset) { previewLine in
                    Text(previewLine.element.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(ScoutTypography.body(12))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(2)
                }
            }
            .padding(.vertical, ScoutSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
            Text("Loading...")
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(ScoutColors.statusError)
            Text(message)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await loadSessions() }
            }
            .font(ScoutTypography.body(14, weight: .medium))
            .foregroundStyle(ScoutColors.accent)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(ScoutColors.textMuted)
            Text("No sessions")
                .font(ScoutTypography.body(16, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func loadSessions() async {
        isLoading = true
        error = nil

        do {
            let response = try await connection.historyDiscover(
                maxAge: 3650,
                limit: 500,
                project: projectFilter
            )
            sessions = response.sessions.sorted { $0.modifiedAt > $1.modifiedAt }
        } catch {
            self.error = "Failed to load sessions: \(error.localizedDescription)"
        }

        isLoading = false
    }

    @MainActor
    private func searchHistoryIfNeeded() async {
        guard query.count >= 2 else {
            transcriptMatches = []
            isSearching = false
            return
        }

        isSearching = true

        do {
            try await Task.sleep(for: .milliseconds(250))
            let response = try await connection.historySearch(query: query, maxAge: 3650, limit: 100)
            transcriptMatches = response.matches
        } catch is CancellationError {
            return
        } catch {
            transcriptMatches = []
        }

        isSearching = false
    }

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

#Preview {
    SessionDiscoveryView()
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}
