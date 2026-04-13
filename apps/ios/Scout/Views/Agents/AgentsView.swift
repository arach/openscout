import SwiftUI

struct AgentsView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var agents: [MobileAgentSummary] = []
    @State private var launchableWorkspaceRoots: Set<String> = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var openingAgentId: String?

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var filteredAgents: [MobileAgentSummary] {
        let tokens = searchText.searchTokens
        guard !tokens.isEmpty else { return agents }

        return agents.filter { agent in
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

    private var workingCount: Int {
        agents.filter { $0.state == "working" }.count
    }

    private var availableCount: Int {
        agents.filter { $0.state == "available" }.count
    }

    private var offlineCount: Int {
        agents.filter { $0.state == "offline" }.count
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

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: ScoutSpacing.xl) {
                overviewCard
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                if let error {
                    inlineErrorCard(error)
                        .padding(.horizontal, ScoutSpacing.lg)
                }

                if filteredAgents.isEmpty {
                    emptyState
                        .padding(.top, 48)
                        .padding(.horizontal, ScoutSpacing.xxl)
                } else {
                    ForEach(groupedAgents, id: \.title) { group in
                        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                            Text(group.title.uppercased())
                                .font(ScoutTypography.caption(12, weight: .bold))
                                .foregroundStyle(ScoutColors.textMuted)
                                .padding(.horizontal, ScoutSpacing.lg)

                            VStack(spacing: ScoutSpacing.md) {
                                ForEach(group.agents, id: \.id) { agent in
                                    agentRow(agent)
                                }
                            }
                            .padding(.horizontal, ScoutSpacing.lg)
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

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            Text("Jump straight into any live agent, or start a session from the same workspace when one is available.")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)

            HStack(spacing: ScoutSpacing.sm) {
                countPill(title: "Working", value: workingCount, color: ScoutColors.statusStreaming)
                countPill(title: "Available", value: availableCount, color: ScoutColors.statusActive)
                countPill(title: "Offline", value: offlineCount, color: ScoutColors.textMuted)
            }
        }
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    private func countPill(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
            Text("\(value)")
                .font(ScoutTypography.body(20, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
            Text(title)
                .font(ScoutTypography.caption(11, weight: .semibold))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, ScoutSpacing.md)
        .padding(.vertical, ScoutSpacing.sm)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
    }

    private func inlineErrorCard(_ message: String) -> some View {
        Text(message)
            .font(ScoutTypography.caption(13))
            .foregroundStyle(ScoutColors.statusError)
            .padding(ScoutSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ScoutColors.statusError.opacity(0.08), in: RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
    }

    private func agentRow(_ agent: MobileAgentSummary) -> some View {
        let isLaunchable = isLaunchable(agent)

        return HStack(spacing: ScoutSpacing.md) {
            // Row body — tap navigates to agent detail
            Button {
                router.push(.agentDetail(agentId: agent.id))
            } label: {
                HStack(spacing: ScoutSpacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                            .fill(agentStatusColor(agent).opacity(0.12))
                            .frame(width: 44, height: 44)

                        Image(systemName: AdapterIcon.systemName(for: agent.harness ?? agent.transport ?? "relay"))
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(agentStatusColor(agent))
                    }

                    VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                        HStack(spacing: ScoutSpacing.xs) {
                            Text(agent.title)
                                .font(ScoutTypography.body(15, weight: .semibold))
                                .foregroundStyle(ScoutColors.textPrimary)
                                .lineLimit(1)

                            if agent.sessionId != nil {
                                Text("LIVE")
                                    .font(ScoutTypography.caption(10, weight: .bold))
                                    .foregroundStyle(ScoutColors.accent)
                                    .padding(.horizontal, ScoutSpacing.sm)
                                    .padding(.vertical, ScoutSpacing.xxs)
                                    .background(ScoutColors.accent.opacity(0.12), in: Capsule())
                            }
                        }

                        if let selector = agent.resolvedSelector {
                            Text(selector)
                                .font(ScoutTypography.code(11))
                                .foregroundStyle(ScoutColors.textMuted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }

                        HStack(spacing: ScoutSpacing.sm) {
                            statusBadge(for: agent)

                            if let project = agent.projectName {
                                metaPill(project, icon: "folder")
                            }

                            if let harness = agent.harness?.trimmedNonEmpty {
                                metaPill(AdapterIcon.displayName(for: harness), icon: AdapterIcon.systemName(for: harness))
                            }

                            if let lastActive = agent.lastActiveDate {
                                Text(RelativeTime.string(from: lastActive))
                                    .font(ScoutTypography.caption(11))
                                    .foregroundStyle(ScoutColors.textMuted)
                            }
                        }
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Trailing action — quick session open/start
            Button {
                handleSelection(for: agent, isLaunchable: isLaunchable)
            } label: {
                trailingAction(for: agent, isLaunchable: isLaunchable)
            }
            .buttonStyle(.plain)
            .disabled(!isInteractive(agent, isLaunchable: isLaunchable))
        }
        .scoutCard(padding: ScoutSpacing.md, cornerRadius: ScoutRadius.lg)
    }

    private func trailingAction(for agent: MobileAgentSummary, isLaunchable: Bool) -> some View {
        Group {
            if openingAgentId == agent.id {
                ProgressView()
                    .controlSize(.small)
            } else {
                Text(actionLabel(for: agent, isLaunchable: isLaunchable))
                    .font(ScoutTypography.caption(11, weight: .semibold))
                    .foregroundStyle(actionColor(for: agent, isLaunchable: isLaunchable))
                    .padding(.horizontal, ScoutSpacing.md)
                    .padding(.vertical, ScoutSpacing.sm)
                    .background(actionColor(for: agent, isLaunchable: isLaunchable).opacity(0.12), in: Capsule())
            }
        }
    }

    private func statusBadge(for agent: MobileAgentSummary) -> some View {
        HStack(spacing: ScoutSpacing.xs) {
            Circle()
                .fill(agentStatusColor(agent))
                .frame(width: 7, height: 7)

            Text(agent.statusLabel)
                .font(ScoutTypography.caption(11, weight: .semibold))
                .foregroundStyle(agentStatusColor(agent))
        }
        .padding(.horizontal, ScoutSpacing.sm)
        .padding(.vertical, ScoutSpacing.xxs)
        .background(agentStatusColor(agent).opacity(0.08), in: Capsule())
    }

    private func metaPill(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(ScoutTypography.caption(11))
            .foregroundStyle(ScoutColors.textMuted)
            .lineLimit(1)
            .padding(.horizontal, ScoutSpacing.sm)
            .padding(.vertical, ScoutSpacing.xxs)
            .background(ScoutColors.surfaceAdaptive, in: Capsule())
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Image(systemName: searchText.isEmpty ? "person.3" : "magnifyingglass")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(ScoutColors.textMuted)

            Text(searchText.isEmpty ? "No agents available" : "No matching agents")
                .font(ScoutTypography.body(17, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)

            Text(searchText.isEmpty
                 ? "Start a session from Home or connect to your Mac to load live agents."
                 : "Try a broader search for the agent name, selector, or workspace.")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
            Text("Loading agents...")
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var connectionStateView: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()

            Image(systemName: connection.statusDetails.symbol)
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ScoutColors.statusError)

            Text(connection.statusDetails.message ?? "Scout is not connected to your Mac right now.")
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

    private func errorState(_ message: String) -> some View {
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
                Task { await refreshAgents() }
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func isLaunchable(_ agent: MobileAgentSummary) -> Bool {
        guard let workspaceRoot = agent.workspaceRoot?.trimmedNonEmpty else { return false }
        return launchableWorkspaceRoots.contains(workspaceRoot)
    }

    private func isInteractive(_ agent: MobileAgentSummary, isLaunchable: Bool) -> Bool {
        agent.sessionId != nil || (isConnected && isLaunchable)
    }

    private func actionLabel(for agent: MobileAgentSummary, isLaunchable: Bool) -> String {
        if agent.sessionId != nil {
            return "Open"
        }
        if isConnected && isLaunchable {
            return "Start"
        }
        return isConnected ? "Unavailable" : "Offline"
    }

    private func actionColor(for agent: MobileAgentSummary, isLaunchable: Bool) -> Color {
        if agent.sessionId != nil || (isConnected && isLaunchable) {
            return ScoutColors.accent
        }
        return ScoutColors.textMuted
    }

    private func agentStatusColor(_ agent: MobileAgentSummary) -> Color {
        switch agent.state {
        case "working":
            return ScoutColors.statusStreaming
        case "available":
            return ScoutColors.statusActive
        default:
            return ScoutColors.textMuted
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
