// AgentDetailView — Full-screen agent profile with metadata, session access, and lifecycle controls.
//
// Sections: Header, Info, Session, Active Tasks, Actions, Recent Activity.
// Navigated to as a surface via ScoutRouter from the Agents list.

import SwiftUI

struct AgentDetailView: View {
    let agentId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var detail: MobileAgentDetail?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showStopConfirmation = false
    @State private var actionInProgress: String?

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        Group {
            if isLoading && detail == nil {
                loadingState
            } else if let detail {
                content(detail)
            } else if let error {
                errorState(error)
            } else {
                errorState("Agent not found")
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .task {
            await loadDetail()
        }
        .task(id: isConnected) {
            if isConnected { await loadDetail() }
        }
        .alert("Stop Agent", isPresented: $showStopConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Stop", role: .destructive) {
                Task { await performStop() }
            }
        } message: {
            Text("This will terminate the agent process. You can restart it later.")
        }
    }

    // MARK: - Content

    private func content(_ agent: MobileAgentDetail) -> some View {
        ScrollView {
            LazyVStack(spacing: ScoutSpacing.xl) {
                headerSection(agent)
                infoSection(agent)
                sessionSection(agent)

                if !agent.activeFlights.isEmpty {
                    flightsSection(agent)
                }

                actionsSection(agent)

                if !agent.recentActivity.isEmpty {
                    activitySection(agent)
                }

                Color.clear.frame(height: 120)
            }
            .padding(.horizontal, ScoutSpacing.lg)
            .padding(.top, ScoutSpacing.xl)
        }
        .refreshable {
            await loadDetail()
        }
    }

    // MARK: - Header

    private func headerSection(_ agent: MobileAgentDetail) -> some View {
        VStack(spacing: ScoutSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                    .fill(statusColor(agent).opacity(0.12))
                    .frame(width: 72, height: 72)

                Image(systemName: AdapterIcon.systemName(for: agent.harness ?? agent.transport ?? "relay"))
                    .font(.system(size: 32, weight: .medium))
                    .foregroundStyle(statusColor(agent))
            }

            Text(agent.title)
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            HStack(spacing: ScoutSpacing.sm) {
                statusBadge(agent)

                if let selector = agent.resolvedSelector {
                    Text(selector)
                        .font(ScoutTypography.code(12))
                        .foregroundStyle(ScoutColors.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .scoutCard(padding: ScoutSpacing.xl, cornerRadius: ScoutRadius.lg)
    }

    // MARK: - Info

    private func infoSection(_ agent: MobileAgentDetail) -> some View {
        DetailSectionCard(title: "Info", icon: "info.circle") {
            if let project = agent.projectName {
                DetailRow(icon: "folder", iconColor: ScoutColors.accent, label: "Workspace") {
                    Text(project)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let harness = agent.harness?.trimmedNonEmpty {
                DetailRow(icon: AdapterIcon.systemName(for: harness), iconColor: ScoutColors.accent, label: "Harness") {
                    Text(AdapterIcon.displayName(for: harness))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let transport = agent.transport?.trimmedNonEmpty {
                DetailRow(icon: "network", iconColor: ScoutColors.textMuted, label: "Transport") {
                    Text(transport)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let branch = agent.branch?.trimmedNonEmpty {
                DetailRow(icon: "arrow.triangle.branch", iconColor: ScoutColors.textMuted, label: "Branch") {
                    Text(branch)
                        .font(ScoutTypography.code(13))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            if let model = agent.model?.trimmedNonEmpty {
                let descriptor = ScoutModelLabel.describe(model)
                DetailRow(icon: "cpu", iconColor: ScoutColors.accent, label: "Model") {
                    Text(descriptor?.title ?? model)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let role = agent.role?.trimmedNonEmpty {
                DetailRow(icon: "person", iconColor: ScoutColors.textMuted, label: "Role") {
                    Text(role)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let wakePolicy = agent.wakePolicy?.trimmedNonEmpty {
                DetailRow(icon: "alarm", iconColor: ScoutColors.textMuted, label: "Wake Policy") {
                    Text(wakePolicy)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if !agent.capabilities.isEmpty {
                DetailRow(icon: "sparkles", iconColor: ScoutColors.accent, label: "Capabilities") {
                    Text(agent.capabilities.joined(separator: ", "))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(2)
                }
            }

            if let lastActive = agent.lastActiveDate {
                DetailRow(icon: "clock", iconColor: ScoutColors.textMuted, label: "Last Active") {
                    Text(RelativeTime.string(from: lastActive))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }
        }
    }

    // MARK: - Session

    private func sessionSection(_ agent: MobileAgentDetail) -> some View {
        DetailSectionCard(title: "Session", icon: "bubble.left.and.bubble.right") {
            DetailRow(icon: "text.bubble", iconColor: ScoutColors.textMuted, label: "Messages") {
                Text("\(agent.messageCount)")
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            Divider().padding(.leading, 40)

            if agent.sessionId != nil {
                DetailButton(icon: "bubble.left.and.text.bubble.right", label: "Open Chat", role: .regular) {
                    if let sessionId = agent.sessionId {
                        router.push(.sessionDetail(sessionId: sessionId))
                    }
                }
            }
        }
    }

    // MARK: - Active Flights

    private func flightsSection(_ agent: MobileAgentDetail) -> some View {
        DetailSectionCard(title: "Active Tasks", icon: "airplane.departure") {
            ForEach(agent.activeFlights) { flight in
                HStack(spacing: ScoutSpacing.md) {
                    Image(systemName: "play.circle")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(ScoutColors.statusStreaming)
                        .frame(width: 20)

                    VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                        Text(flight.summary ?? flight.id)
                            .font(ScoutTypography.body(14, weight: .medium))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(2)

                        HStack(spacing: ScoutSpacing.sm) {
                            Text(flight.state)
                                .font(ScoutTypography.caption(11, weight: .semibold))
                                .foregroundStyle(ScoutColors.statusStreaming)

                            if let date = flight.date {
                                Text(RelativeTime.string(from: date))
                                    .font(ScoutTypography.caption(11))
                                    .foregroundStyle(ScoutColors.textMuted)
                            }
                        }
                    }

                    Spacer()
                }
                .padding(.vertical, ScoutSpacing.xs)
            }
        }
    }

    // MARK: - Actions

    private func actionsSection(_ agent: MobileAgentDetail) -> some View {
        DetailSectionCard(title: "Actions", icon: "gearshape") {
            if actionInProgress != nil {
                HStack {
                    ProgressView()
                        .controlSize(.small)
                    Text(actionInProgress == "restart" ? "Restarting..." : "Stopping...")
                        .font(ScoutTypography.body(14))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
                .padding(.vertical, ScoutSpacing.xs)
            } else {
                DetailButton(icon: "arrow.clockwise", label: "Restart Agent", role: .regular) {
                    Task { await performRestart() }
                }

                Divider().padding(.leading, 40)

                DetailButton(icon: "stop.circle", label: "Stop Agent", role: .destructive) {
                    showStopConfirmation = true
                }
            }
        }
    }

    // MARK: - Recent Activity

    private func activitySection(_ agent: MobileAgentDetail) -> some View {
        DetailSectionCard(title: "Recent Activity", icon: "clock.arrow.circlepath") {
            ForEach(agent.recentActivity) { item in
                HStack(spacing: ScoutSpacing.md) {
                    Image(systemName: item.kindIcon)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(item.kindColor)
                        .frame(width: 20)

                    VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                        Text(item.summary ?? item.title ?? item.kindLabel)
                            .font(ScoutTypography.body(14))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(2)

                        Text(RelativeTime.string(from: item.date))
                            .font(ScoutTypography.caption(11))
                            .foregroundStyle(ScoutColors.textMuted)
                    }

                    Spacer()
                }
                .padding(.vertical, ScoutSpacing.xxs)

                if item.id != agent.recentActivity.last?.id {
                    Divider().padding(.leading, 40)
                }
            }
        }
    }

    // MARK: - Helpers

    private func statusBadge(_ agent: MobileAgentDetail) -> some View {
        HStack(spacing: ScoutSpacing.xs) {
            Circle()
                .fill(statusColor(agent))
                .frame(width: 7, height: 7)

            Text(agent.statusLabel)
                .font(ScoutTypography.caption(11, weight: .semibold))
                .foregroundStyle(statusColor(agent))
        }
        .padding(.horizontal, ScoutSpacing.sm)
        .padding(.vertical, ScoutSpacing.xxs)
        .background(statusColor(agent).opacity(0.08), in: Capsule())
    }

    private func statusColor(_ agent: MobileAgentDetail) -> Color {
        switch agent.state {
        case "working": ScoutColors.statusStreaming
        case "available": ScoutColors.statusActive
        default: ScoutColors.textMuted
        }
    }

    // MARK: - Data Loading

    private func loadDetail() async {
        guard isConnected else {
            isLoading = false
            return
        }

        isLoading = detail == nil
        error = nil

        do {
            detail = try await connection.getAgentDetail(agentId: agentId)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func performRestart() async {
        actionInProgress = "restart"
        do {
            _ = try await connection.restartAgent(agentId: agentId)
            try? await Task.sleep(for: .seconds(1))
            await loadDetail()
        } catch {
            self.error = error.localizedDescription
        }
        actionInProgress = nil
    }

    private func performStop() async {
        actionInProgress = "stop"
        do {
            _ = try await connection.stopAgent(agentId: agentId)
            try? await Task.sleep(for: .seconds(1))
            await loadDetail()
        } catch {
            self.error = error.localizedDescription
        }
        actionInProgress = nil
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
            Text("Loading agent...")
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                Task { await loadDetail() }
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}

// MARK: - Section Card

private struct DetailSectionCard<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutColors.accent)
                Text(title.uppercased())
                    .font(ScoutTypography.caption(12, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.leading, ScoutSpacing.xs)

            VStack(spacing: 0) {
                content
            }
            .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
        }
    }
}

// MARK: - Row Components

private struct DetailRow<Trailing: View>: View {
    let icon: String
    let iconColor: Color
    let label: String
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: ScoutSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: 20)

            Text(label)
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textPrimary)

            Spacer()

            trailing
                .font(ScoutTypography.body(14))
        }
        .padding(.vertical, ScoutSpacing.xs)
    }
}

private struct DetailButton: View {
    enum Role { case regular, destructive }

    let icon: String
    let label: String
    let role: Role
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(role == .destructive ? ScoutColors.statusError : ScoutColors.accent)
                    .frame(width: 20)

                Text(label)
                    .font(ScoutTypography.body(15))
                    .foregroundStyle(role == .destructive ? ScoutColors.statusError : ScoutColors.textPrimary)

                Spacer()
            }
            .padding(.vertical, ScoutSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
