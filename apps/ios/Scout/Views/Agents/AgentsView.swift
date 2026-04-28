import SwiftUI

struct AgentsView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var agents: [MobileAgentSummary] = []
    @State private var launchableWorkspaceRoots: Set<String> = []
    @State private var searchText = ""
    @State private var selectedWorkspace: String?
    @State private var isLoading = true
    @State private var error: String?
    @State private var openingAgentId: String?

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var workspaceFilteredAgents: [MobileAgentSummary] {
        guard let selectedWorkspace else { return agents }
        return agents.filter { ($0.workspaceRoot ?? "") == selectedWorkspace }
    }

    private var filteredAgents: [MobileAgentSummary] {
        let base = workspaceFilteredAgents
        let tokens = searchText.searchTokens
        guard !tokens.isEmpty else { return base }

        return base.filter { agent in
            let fields = [
                agent.title,
                agent.id,
                agent.resolvedSelector ?? "",
                agent.workspaceRoot ?? "",
                agent.harness ?? "",
                agent.transport ?? "",
                agent.statusLabel,
            ]

            return tokens.allSatisfy { token in
                fields.contains { $0.localizedCaseInsensitiveContains(token) }
            }
        }
    }

    private var groupedAgents: [(title: String, agents: [MobileAgentSummary])] {
        let working = filteredAgents.filter { $0.state == "working" }
        let available = filteredAgents.filter { $0.state == "available" }
        let offline = filteredAgents.filter { $0.state == "offline" }

        return [
            ("Working", working),
            ("Available", available),
            ("Offline", offline),
        ]
        .filter { !$0.agents.isEmpty }
    }

    private var workingCount: Int { agents.filter { $0.state == "working" }.count }
    private var availableCount: Int { agents.filter { $0.state == "available" }.count }
    private var offlineCount: Int { agents.filter { $0.state == "offline" }.count }
    private var onlineCount: Int { agents.count - offlineCount }

    /// Top workspaces by agent count, used for the filter rail.
    private var workspaceBuckets: [(root: String, name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for agent in agents {
            guard let root = agent.workspaceRoot?.trimmedNonEmpty else { continue }
            counts[root, default: 0] += 1
        }
        return counts
            .map { (root, count) in
                (root: root, name: URL(fileURLWithPath: root).lastPathComponent, count: count)
            }
            .sorted { lhs, rhs in
                lhs.count == rhs.count ? lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
                                       : lhs.count > rhs.count
            }
    }

    var body: some View {
        Group {
            if isLoading && agents.isEmpty {
                loadingState
            } else if !isConnected && agents.isEmpty {
                connectionStateView
            } else if let error, agents.isEmpty {
                errorState(error)
            } else {
                content
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .searchable(text: $searchText, prompt: "Search agents")
        .task {
            await refreshAgents()
        }
        .task(id: isConnected) {
            if isConnected {
                await refreshAgents()
            } else if agents.isEmpty {
                isLoading = false
            }
        }
    }

    // MARK: - Content

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                heroSection
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                if !workspaceBuckets.isEmpty {
                    workspaceRail
                        .padding(.top, ScoutSpacing.lg)
                }

                if let error {
                    Text(error)
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .padding(ScoutSpacing.lg)
                }

                if filteredAgents.isEmpty {
                    emptyState
                        .padding(.top, 48)
                        .padding(.horizontal, ScoutSpacing.xxl)
                } else {
                    ForEach(groupedAgents, id: \.title) { group in
                        HStack(spacing: ScoutSpacing.sm) {
                            Circle()
                                .fill(groupColor(for: group.title))
                                .frame(width: 6, height: 6)

                            Text(group.title.uppercased())
                                .font(ScoutTypography.code(10, weight: .semibold))
                                .foregroundStyle(ScoutColors.textMuted)
                            Spacer()
                            Text("\(group.agents.count)")
                                .font(ScoutTypography.code(10))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.top, ScoutSpacing.xl)
                        .padding(.bottom, ScoutSpacing.xs)

                        ForEach(Array(group.agents.enumerated()), id: \.element.id) { index, agent in
                            agentRow(agent)

                            if index < group.agents.count - 1 {
                                Rectangle()
                                    .fill(ScoutColors.divider)
                                    .frame(height: 0.5)
                                    .padding(.leading, ScoutSpacing.lg + 6 + ScoutSpacing.md)
                            }
                        }
                    }
                }

                Color.clear.frame(height: 100)
            }
        }
        .refreshable {
            await refreshAgents()
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
                Text("Fleet")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                Text("/")
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)

                Text("Agents")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)

                Spacer()

                if onlineCount > 0 {
                    HStack(spacing: ScoutSpacing.xs) {
                        PulseIndicator()
                        Text("\(onlineCount) active")
                            .font(ScoutTypography.code(10, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                    }
                }
            }

            Text("All agents")
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            Text(heroSubtitle)
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(2)

            HStack(spacing: ScoutSpacing.sm) {
                metric(label: "Working", value: workingCount, tint: ScoutColors.ledGreen)
                metric(label: "Available", value: availableCount, tint: ScoutColors.ledAmber)
                metric(label: "Offline", value: offlineCount, tint: ScoutColors.textMuted)
                metric(label: "Total", value: agents.count, tint: ScoutColors.accent)
            }
            .padding(.top, ScoutSpacing.xs)
        }
    }

    private var heroSubtitle: String {
        if agents.isEmpty {
            return "No agents registered yet."
        }

        let total = agents.count
        let workspaceCount = workspaceBuckets.count
        let workspaceClause: String = {
            switch workspaceCount {
            case 0: return ""
            case 1: return " across 1 workspace"
            default: return " across \(workspaceCount) workspaces"
            }
        }()

        return "\(total) registered\(workspaceClause), sorted by live status."
    }

    private func metric(label: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(ScoutTypography.code(8, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text("\(value)")
                .font(ScoutTypography.code(20, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, ScoutSpacing.sm)
        .padding(.horizontal, ScoutSpacing.md)
        .background(ScoutColors.surfaceRaisedAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
    }

    // MARK: - Workspace Rail

    private var workspaceRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: ScoutSpacing.sm) {
                workspacePill(
                    name: "All",
                    count: agents.count,
                    isSelected: selectedWorkspace == nil,
                    onTap: { selectedWorkspace = nil }
                )

                ForEach(workspaceBuckets, id: \.root) { bucket in
                    workspacePill(
                        name: bucket.name,
                        count: bucket.count,
                        isSelected: selectedWorkspace == bucket.root,
                        onTap: {
                            selectedWorkspace = (selectedWorkspace == bucket.root) ? nil : bucket.root
                        }
                    )
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
        }
    }

    private func workspacePill(
        name: String,
        count: Int,
        isSelected: Bool,
        onTap: @escaping () -> Void
    ) -> some View {
        Button(action: onTap) {
            HStack(spacing: ScoutSpacing.xs) {
                Text(name)
                    .font(ScoutTypography.code(11, weight: .semibold))
                    .foregroundStyle(isSelected ? ScoutColors.textPrimary : ScoutColors.textSecondary)

                Text("\(count)")
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(isSelected ? ScoutColors.textSecondary : ScoutColors.textMuted)
            }
            .padding(.horizontal, ScoutSpacing.md)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(isSelected ? ScoutColors.accent.opacity(0.18) : ScoutColors.surfaceRaisedAdaptive)
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(isSelected ? ScoutColors.accent.opacity(0.45) : Color.clear, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    private func groupColor(for title: String) -> Color {
        switch title {
        case "Working": return ScoutColors.ledGreen
        case "Available": return ScoutColors.ledAmber
        default: return ScoutColors.textMuted
        }
    }

    // MARK: - Agent Row

    private func agentRow(_ agent: MobileAgentSummary) -> some View {
        Button {
            if agent.sessionId != nil {
                router.push(.agentDashboard(agentId: agent.id))
            } else if isLaunchable(agent) {
                handleSelection(for: agent, isLaunchable: true)
            } else {
                router.push(.agentDetail(agentId: agent.id))
            }
        } label: {
            HStack(alignment: .top, spacing: ScoutSpacing.md) {
                Circle()
                    .fill(rowStatusColor(for: agent.state))
                    .frame(width: 6, height: 6)
                    .padding(.top, 6)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: ScoutSpacing.sm) {
                        Text(agent.title)
                            .font(ScoutTypography.code(13, weight: .medium))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(1)

                        if let selector = agent.resolvedSelector {
                            Text(selector)
                                .font(ScoutTypography.code(10))
                                .foregroundStyle(ScoutColors.textMuted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    if let subtitle = subtitle(for: agent) {
                        Text(subtitle)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                Spacer(minLength: ScoutSpacing.sm)

                if agent.sessionId != nil {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ScoutColors.accent)
                }

                if openingAgentId == agent.id {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                }
            }
            .padding(.vertical, ScoutSpacing.md)
            .padding(.horizontal, ScoutSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                router.push(.agentDetail(agentId: agent.id))
            } label: {
                Label("Details", systemImage: "info.circle")
            }

            if let sessionId = agent.sessionId {
                Button {
                    router.push(.sessionDetail(sessionId: sessionId))
                } label: {
                    Label("Open Session", systemImage: "arrow.right")
                }
            }

            if isLaunchable(agent), agent.sessionId == nil {
                Button {
                    handleSelection(for: agent, isLaunchable: true)
                } label: {
                    Label("Start Session", systemImage: "play")
                }
            }
        }
    }

    // MARK: - States

    private var emptyState: some View {
        let hasFilter = !searchText.isEmpty || selectedWorkspace != nil
        return VStack(spacing: ScoutSpacing.md) {
            Text(hasFilter ? "NO MATCHES" : "NO AGENTS")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text(hasFilter
                 ? "Try a broader search or clear the workspace filter."
                 : "Start a session from Home or connect to your Mac.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            if hasFilter {
                Button("Clear filters") {
                    searchText = ""
                    selectedWorkspace = nil
                }
                .font(ScoutTypography.code(11, weight: .semibold))
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.md) {
            ProgressView()
            Text("Loading agents...")
                .font(ScoutTypography.code(12))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var connectionStateView: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Text(connection.statusDetails.message ?? "Not connected.")
                .font(ScoutTypography.code(12))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            if connection.statusDetails.allowsRetry {
                Button("Retry") {
                    Task { await connection.reconnect() }
                }
                .font(ScoutTypography.code(11, weight: .semibold))
                .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Text(message)
                .font(ScoutTypography.code(12))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task { await refreshAgents() }
            }
            .font(ScoutTypography.code(11, weight: .semibold))
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Helpers

    private func rowStatusColor(for state: String) -> Color {
        switch state {
        case "working": return ScoutColors.ledGreen
        case "available": return ScoutColors.ledAmber
        default: return ScoutColors.textMuted
        }
    }

    private func subtitle(for agent: MobileAgentSummary) -> String? {
        var parts: [String] = []
        if let project = agent.projectName, !project.isEmpty {
            parts.append(project)
        }
        if let harness = agent.harness?.trimmedNonEmpty {
            parts.append(AdapterIcon.displayName(for: harness))
        }
        if let lastActive = agent.lastActiveDate {
            parts.append(RelativeTime.string(from: lastActive))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func isLaunchable(_ agent: MobileAgentSummary) -> Bool {
        guard let workspaceRoot = agent.workspaceRoot?.trimmedNonEmpty else { return false }
        return launchableWorkspaceRoots.contains(workspaceRoot)
    }

    private func handlePrimaryTap(for agent: MobileAgentSummary) {
        if let sessionId = agent.sessionId {
            router.push(.sessionDetail(sessionId: sessionId))
        } else if isLaunchable(agent) {
            handleSelection(for: agent, isLaunchable: true)
        } else {
            router.push(.agentDetail(agentId: agent.id))
        }
    }

    private func handleSelection(for agent: MobileAgentSummary, isLaunchable: Bool) {
        if let sessionId = agent.sessionId {
            router.push(.sessionDetail(sessionId: sessionId))
            return
        }

        guard isConnected,
              isLaunchable,
              let workspaceRoot = agent.workspaceRoot?.trimmedNonEmpty,
              openingAgentId == nil else { return }

        openingAgentId = agent.id
        error = nil

        Task {
            do {
                let sessionHandle = try await connection.createMobileSession(
                    workspaceId: workspaceRoot,
                    harness: agent.harness,
                    forceNew: false
                )
                await connection.refreshRelaySessions()

                await MainActor.run {
                    openingAgentId = nil
                    router.push(.sessionDetail(sessionId: sessionHandle.session.conversationId))
                }
            } catch {
                await MainActor.run {
                    openingAgentId = nil
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func refreshAgents() async {
        guard isConnected else {
            isLoading = false
            agents = []
            launchableWorkspaceRoots = []
            error = nil
            return
        }

        isLoading = true
        error = nil

        do {
            async let agentsTask = connection.listMobileAgents(limit: 500)
            async let workspacesTask = connection.listMobileWorkspaces(limit: 500)
            let (loadedAgents, workspaces) = try await (agentsTask, workspacesTask)

            agents = loadedAgents
            launchableWorkspaceRoots = Set(workspaces.map(\.root))
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}
