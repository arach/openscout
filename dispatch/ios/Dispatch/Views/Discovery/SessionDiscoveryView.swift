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
            .background(DispatchColors.backgroundAdaptive)
            .navigationTitle(projectFilter ?? "Search")
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
                    HStack(spacing: DispatchSpacing.sm) {
                        Image(systemName: agentIcon(for: group.sessions.first?.agent ?? "unknown"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(DispatchColors.accent)
                        Text(group.project)
                            .font(DispatchTypography.caption(12, weight: .semibold))
                            .foregroundStyle(DispatchColors.textSecondary)
                        Spacer()
                        Text("\(group.sessions.count)")
                            .font(DispatchTypography.caption(11, weight: .medium))
                            .foregroundStyle(DispatchColors.textMuted)
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
                HStack(spacing: DispatchSpacing.sm) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Searching...")
                        .font(DispatchTypography.body(14))
                        .foregroundStyle(DispatchColors.textSecondary)
                }
                .padding(.vertical, DispatchSpacing.sm)
                .listRowBackground(DispatchColors.backgroundAdaptive)
            } else {
                if !transcriptMatches.isEmpty {
                    Section("Transcript") {
                        ForEach(transcriptMatches) { match in
                            transcriptMatchRow(match)
                                .listRowBackground(DispatchColors.backgroundAdaptive)
                        }
                    }
                }

                if !matchingSessions.isEmpty {
                    Section("Sessions") {
                        ForEach(matchingSessions) { session in
                            discoveredSessionRow(session)
                                .listRowBackground(DispatchColors.backgroundAdaptive)
                        }
                    }
                }

                if transcriptMatches.isEmpty && matchingSessions.isEmpty {
                    VStack(spacing: DispatchSpacing.sm) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(DispatchColors.textMuted)
                        Text("No results")
                            .font(DispatchTypography.body(15, weight: .semibold))
                            .foregroundStyle(DispatchColors.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DispatchSpacing.xl)
                    .listRowBackground(DispatchColors.backgroundAdaptive)
                }
            }
        }
        .listStyle(.plain)
    }

    private func discoveredSessionRow(_ session: DiscoveredSession) -> some View {
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
            .padding(.vertical, DispatchSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func transcriptMatchRow(_ match: SearchMatch) -> some View {
        Button {
            selectedMatch = match
        } label: {
            VStack(alignment: .leading, spacing: DispatchSpacing.xs) {
                HStack(spacing: DispatchSpacing.sm) {
                    Image(systemName: AdapterIcon.systemName(for: match.agent))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DispatchColors.accent)

                    Text(match.project)
                        .font(DispatchTypography.body(14, weight: .semibold))
                        .foregroundStyle(DispatchColors.textPrimary)
                        .lineLimit(1)

                    Spacer()

                    Text("\(match.matchCount)")
                        .font(DispatchTypography.caption(11, weight: .semibold))
                        .foregroundStyle(DispatchColors.textSecondary)
                        .padding(.horizontal, DispatchSpacing.sm)
                        .padding(.vertical, DispatchSpacing.xxs)
                        .background(DispatchColors.surfaceAdaptive)
                        .clipShape(Capsule())
                }

                Text((match.path as NSString).lastPathComponent)
                    .font(DispatchTypography.code(11))
                    .foregroundStyle(DispatchColors.textMuted)
                    .lineLimit(1)

                ForEach(Array(match.preview.enumerated()), id: \.offset) { previewLine in
                    Text(previewLine.element.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(DispatchTypography.body(12))
                        .foregroundStyle(DispatchColors.textSecondary)
                        .lineLimit(2)
                }
            }
            .padding(.vertical, DispatchSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var loadingState: some View {
        VStack(spacing: DispatchSpacing.lg) {
            ProgressView()
            Text("Loading...")
                .font(DispatchTypography.body(15))
                .foregroundStyle(DispatchColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

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
            Text("No sessions")
                .font(DispatchTypography.body(16, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
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
