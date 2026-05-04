// NodeDetailView — Full-screen node profile listing the agents running on a
// specific Mac on the mesh.
//
// Sections: Header, Info, Agents.
// Navigated to as a surface via ScoutRouter from the Fleet list.

import SwiftUI

struct NodeDetailView: View {
    let nodeId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var node: FleetNodeDetail?
    @State private var agents: [MobileAgentSummary] = []
    @State private var isLoading = true
    @State private var error: String?

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        Group {
            if isLoading && node == nil {
                loadingState
            } else if let node {
                content(node)
            } else if let error {
                errorState(error)
            } else {
                errorState("Host not found")
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .task {
            await loadDetail()
        }
        .task(id: isConnected) {
            if isConnected { await loadDetail() }
        }
    }

    // MARK: - Content

    private func content(_ node: FleetNodeDetail) -> some View {
        ScrollView {
            LazyVStack(spacing: ScoutSpacing.xl) {
                headerSection(node)
                infoSection(node)
                agentsSection

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

    private func headerSection(_ node: FleetNodeDetail) -> some View {
        VStack(spacing: ScoutSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                    .fill(healthColor(node).opacity(0.12))
                    .frame(width: 72, height: 72)

                Image(systemName: "desktopcomputer")
                    .font(.system(size: 32, weight: .medium))
                    .foregroundStyle(healthColor(node))
            }

            Text(node.name)
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            HStack(spacing: ScoutSpacing.sm) {
                healthBadge(node)

                Text(node.id.prefix(12))
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity)
        .scoutCard(padding: ScoutSpacing.xl, cornerRadius: ScoutRadius.lg)
    }

    // MARK: - Info

    private func infoSection(_ node: FleetNodeDetail) -> some View {
        DetailSectionCard(title: "Info", icon: "info.circle") {
            DetailRow(icon: "circle.fill", iconColor: healthColor(node), label: "Status") {
                Text(node.healthLabel)
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            if let uptime = node.uptimeLabel {
                DetailRow(icon: "clock", iconColor: ScoutColors.accent, label: "Uptime") {
                    Text(uptime)
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            if let lastHeartbeat = node.lastHeartbeat {
                DetailRow(icon: "waveform.path.ecg", iconColor: ScoutColors.textMuted, label: "Last Heartbeat") {
                    Text(RelativeTime.string(from: lastHeartbeat))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
            }

            DetailRow(icon: "cpu", iconColor: ScoutColors.accent, label: "Agents") {
                Text("\(agents.count)")
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            DetailRow(icon: "bubble.left.and.bubble.right", iconColor: ScoutColors.textMuted, label: "Active Sessions") {
                Text("\(activeSessionCount)")
                    .foregroundStyle(ScoutColors.textSecondary)
            }
        }
    }

    // MARK: - Agents

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "person.2")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutColors.accent)
                Text("AGENTS")
                    .font(ScoutTypography.caption(12, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
                Text("\(agents.count)")
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.leading, ScoutSpacing.xs)

            if agents.isEmpty {
                VStack(spacing: ScoutSpacing.sm) {
                    Text("NO AGENTS")
                        .font(ScoutTypography.code(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)

                    Text("This host has no agents registered.")
                        .font(ScoutTypography.body(13))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, ScoutSpacing.xl)
                .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(agents.enumerated()), id: \.element.id) { index, agent in
                        agentRow(agent)

                        if index < agents.count - 1 {
                            Divider().padding(.leading, 40)
                        }
                    }
                }
                .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
            }
        }
    }

    private func agentRow(_ agent: MobileAgentSummary) -> some View {
        Button {
            router.push(.agentDetail(agentId: agent.id))
        } label: {
            HStack(spacing: ScoutSpacing.md) {
                Circle()
                    .fill(rowStatusColor(for: agent.state))
                    .frame(width: 7, height: 7)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                    Text(agent.title)
                        .font(ScoutTypography.body(15, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)

                    if let subtitle = agentSubtitle(agent) {
                        Text(subtitle)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                Spacer()

                Text(agent.statusLabel)
                    .font(ScoutTypography.caption(11, weight: .semibold))
                    .foregroundStyle(rowStatusColor(for: agent.state))
                    .padding(.horizontal, ScoutSpacing.sm)
                    .padding(.vertical, ScoutSpacing.xxs)
                    .background(rowStatusColor(for: agent.state).opacity(0.08), in: Capsule())

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private var activeSessionCount: Int {
        agents.filter { $0.sessionId != nil }.count
    }

    private func rowStatusColor(for state: String) -> Color {
        switch state {
        case "working": return ScoutColors.ledGreen
        case "available": return ScoutColors.ledAmber
        default: return ScoutColors.textMuted
        }
    }

    private func agentSubtitle(_ agent: MobileAgentSummary) -> String? {
        var parts: [String] = []
        if let sessionId = agent.sessionId {
            parts.append("session \(sessionId.prefix(8))")
        }
        if let lastActive = agent.lastActiveDate {
            parts.append(RelativeTime.string(from: lastActive))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func healthBadge(_ node: FleetNodeDetail) -> some View {
        HStack(spacing: ScoutSpacing.xs) {
            Circle()
                .fill(healthColor(node))
                .frame(width: 7, height: 7)

            Text(node.healthLabel)
                .font(ScoutTypography.caption(11, weight: .semibold))
                .foregroundStyle(healthColor(node))
        }
        .padding(.horizontal, ScoutSpacing.sm)
        .padding(.vertical, ScoutSpacing.xxs)
        .background(healthColor(node).opacity(0.08), in: Capsule())
    }

    private func healthColor(_ node: FleetNodeDetail) -> Color {
        switch node.health {
        case .online: return ScoutColors.ledGreen
        case .degraded: return ScoutColors.ledAmber
        case .offline: return ScoutColors.textMuted
        }
    }

    // MARK: - Data Loading

    private func loadDetail() async {
        guard isConnected else {
            isLoading = false
            return
        }

        isLoading = node == nil
        error = nil

        do {
            let loadedAgents = try await connection.listMobileAgents(limit: 500)
            let health: FleetNodeDetail.Health = {
                switch connection.health {
                case .healthy: return .online
                case .suspect, .degraded: return .degraded
                default: return .offline
                }
            }()
            node = FleetNodeDetail(
                id: connection.pairedBridgeFingerprint ?? nodeId,
                name: connection.pairedBridgeName ?? "Mac",
                health: health,
                lastHeartbeat: connection.pairedBridgeLastSeen,
                connectedSince: connection.pairedBridgeLastSeen
            )
            agents = loadedAgents
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
            Text("Loading host...")
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

            HStack(spacing: ScoutSpacing.md) {
                Button {
                    router.pop()
                } label: {
                    Text("Back to Fleet")
                        .font(ScoutTypography.body(14, weight: .semibold))
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.vertical, ScoutSpacing.sm)
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await loadDetail() }
                } label: {
                    Text("Retry")
                        .font(ScoutTypography.body(14, weight: .semibold))
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.vertical, ScoutSpacing.sm)
                }
                .buttonStyle(.borderedProminent)
            }

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}

// MARK: - Local model

/// View model for a single node detail. Replace with the canonical model
/// exposed by ConnectionManager once the fleet RPC ships.
struct FleetNodeDetail: Identifiable, Sendable, Equatable {
    enum Health: Sendable, Equatable {
        case online
        case degraded
        case offline
    }

    let id: String
    let name: String
    let health: Health
    let lastHeartbeat: Date?
    let connectedSince: Date?

    var healthLabel: String {
        switch health {
        case .online: return "Online"
        case .degraded: return "Degraded"
        case .offline: return "Offline"
        }
    }

    var uptimeLabel: String? {
        guard health != .offline, let connectedSince else { return nil }
        let seconds = Int(Date().timeIntervalSince(connectedSince))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        return "\(days)d"
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
