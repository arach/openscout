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
                        HStack {
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
                                    .padding(.leading, ScoutSpacing.lg + 6 + ScoutSpacing.sm)
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
            HStack(spacing: ScoutSpacing.md) {
                Text(agent.title)
                    .font(ScoutTypography.code(13, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)

                Spacer(minLength: 0)

                statusChip(for: agent.state)

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
        VStack(spacing: ScoutSpacing.md) {
            Text(searchText.isEmpty ? "NO AGENTS" : "NO MATCHES")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text(searchText.isEmpty
                 ? "Start a session from Home or connect to your Mac."
                 : "Try a broader search.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
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

    private func statusChip(for state: String) -> some View {
        let (label, color): (String, Color) = {
            switch state {
            case "working": return ("WORKING", ScoutColors.ledGreen)
            case "available": return ("AVAILABLE", ScoutColors.ledAmber)
            default: return ("OFFLINE", ScoutColors.textMuted)
            }
        }()

        return Text(label)
            .font(ScoutTypography.code(8, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(color.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
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
