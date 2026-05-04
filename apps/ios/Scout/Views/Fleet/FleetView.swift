// FleetView — Top-level ops surface listing every Mac node on the mesh.
//
// Each row drills into NodeDetailView for that node's running agents.
// Rendezvous already exposes a node directory; agent count and session
// count are not yet aggregated server-side, so we surface what's known
// today and leave the rest as TODOs to wire when the API lands.

import SwiftUI

struct FleetView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var nodes: [FleetNode] = []
    @State private var isLoading = true
    @State private var error: String?

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var onlineCount: Int {
        nodes.filter { $0.isOnline }.count
    }

    private var totalAgents: Int {
        nodes.reduce(0) { $0 + $1.agentCount }
    }

    private var totalSessions: Int {
        nodes.reduce(0) { $0 + $1.activeSessionCount }
    }

    var body: some View {
        Group {
            if isLoading && nodes.isEmpty {
                loadingState
            } else if let error, nodes.isEmpty {
                errorState(error)
            } else if nodes.isEmpty {
                emptyState
            } else if nodes.count == 1, let host = nodes.first {
                // Single host — skip the list, show agents directly.
                HostAgentsView(host: host)
            } else {
                content
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .task {
            await refreshNodes()
        }
        .task(id: isConnected) {
            if isConnected {
                await refreshNodes()
            } else if nodes.isEmpty {
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

                if let error {
                    inlineErrorPill(error)
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.top, ScoutSpacing.md)
                }

                HStack(spacing: ScoutSpacing.sm) {
                    Circle()
                        .fill(ScoutColors.ledGreen)
                        .frame(width: 6, height: 6)

                    Text("HOSTS")
                        .font(ScoutTypography.code(10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)

                    Spacer()

                    Text("\(nodes.count)")
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .padding(.horizontal, ScoutSpacing.lg)
                .padding(.top, ScoutSpacing.xl)
                .padding(.bottom, ScoutSpacing.xs)

                ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
                    nodeRow(node)

                    if index < nodes.count - 1 {
                        Rectangle()
                            .fill(ScoutColors.divider)
                            .frame(height: 0.5)
                            .padding(.leading, ScoutSpacing.lg + 6 + ScoutSpacing.md)
                    }
                }

                Color.clear.frame(height: 100)
            }
        }
        .refreshable {
            await refreshNodes()
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
                Text("Ops")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                Spacer()

                if onlineCount > 0 {
                    HStack(spacing: ScoutSpacing.xs) {
                        PulseIndicator()
                        Text("\(onlineCount) online")
                            .font(ScoutTypography.code(10, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                    }
                }
            }

            Text("Hosts")
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            Text(heroSubtitle)
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(2)

            HStack(spacing: ScoutSpacing.sm) {
                metric(label: "Online", value: onlineCount, tint: ScoutColors.ledGreen)
                metric(label: "Offline", value: nodes.count - onlineCount, tint: ScoutColors.textMuted)
                metric(label: "Agents", value: totalAgents, tint: ScoutColors.accent)
                metric(label: "Active", value: totalSessions, tint: ScoutColors.ledAmber)
            }
            .padding(.top, ScoutSpacing.xs)
        }
    }

    private var heroSubtitle: String {
        if nodes.isEmpty {
            return "No hosts registered yet."
        }
        let word = nodes.count == 1 ? "host" : "hosts"
        return "\(nodes.count) \(word) reachable, sorted by last heartbeat."
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

    // MARK: - Node Row

    private func nodeRow(_ node: FleetNode) -> some View {
        Button {
            // TODO: requires .nodeDetail surface in ScoutRouter
            router.push(.nodeDetail(nodeId: node.id))
        } label: {
            HStack(alignment: .top, spacing: ScoutSpacing.md) {
                Circle()
                    .fill(node.isOnline ? ScoutColors.ledGreen : ScoutColors.textMuted)
                    .frame(width: 6, height: 6)
                    .padding(.top, 6)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: ScoutSpacing.sm) {
                        Text(node.name)
                            .font(ScoutTypography.code(13, weight: .medium))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(1)

                        Text(node.id.prefix(8))
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }

                    Text(rowSubtitle(for: node))
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer(minLength: ScoutSpacing.sm)

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.md)
            .padding(.horizontal, ScoutSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func rowSubtitle(for node: FleetNode) -> String {
        var parts: [String] = []
        parts.append("\(node.agentCount) \(node.agentCount == 1 ? "agent" : "agents")")
        if node.activeSessionCount > 0 {
            parts.append("\(node.activeSessionCount) active")
        }
        if let lastSeen = node.lastHeartbeat {
            parts.append(RelativeTime.string(from: lastSeen))
        } else if !node.isOnline {
            parts.append("offline")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - States

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.md) {
            Spacer()

            Text("NO HOSTS")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text(isConnected
                 ? "Pair a Mac to see it here."
                 : "Connect to your Mac to discover hosts.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            HStack(spacing: ScoutSpacing.sm) {
                if !isConnected, connection.statusDetails.allowsRetry {
                    Button {
                        Task { await connection.reconnect() }
                    } label: {
                        Text("Reconnect")
                            .font(ScoutTypography.body(13, weight: .semibold))
                            .padding(.horizontal, ScoutSpacing.md)
                            .padding(.vertical, ScoutSpacing.xs)
                    }
                    .buttonStyle(.borderedProminent)
                }

                Button {
                    router.push(.settings)
                } label: {
                    Text(isConnected ? "Open Settings" : "Connection Settings")
                        .font(ScoutTypography.body(13, weight: .semibold))
                        .padding(.horizontal, ScoutSpacing.md)
                        .padding(.vertical, ScoutSpacing.xs)
                }
                .buttonStyle(.bordered)
            }
            .padding(.top, ScoutSpacing.sm)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.md) {
            ProgressView()
            Text("Connecting...")
                .font(ScoutTypography.code(12))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func inlineErrorPill(_ message: String) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ScoutColors.statusError)
                .padding(.top, 2)

            Text(message)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: ScoutSpacing.xs) {
                Button {
                    Task { await refreshNodes() }
                } label: {
                    Text("Retry")
                        .font(ScoutTypography.code(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .padding(.horizontal, ScoutSpacing.sm)
                        .padding(.vertical, ScoutSpacing.xxs)
                        .background(ScoutColors.surfaceAdaptive)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)

                Button {
                    error = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(.horizontal, ScoutSpacing.md)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.errorBackground)
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .strokeBorder(ScoutColors.statusError.opacity(0.25), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()
            Text(message)
                .font(ScoutTypography.code(12))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task { await refreshNodes() }
            }
            .font(ScoutTypography.code(11, weight: .semibold))
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Data Loading

    private func refreshNodes() async {
        guard isConnected else {
            isLoading = false
            nodes = []
            error = nil
            return
        }

        isLoading = nodes.isEmpty
        error = nil

        do {
            let agents = try await connection.listMobileAgents(limit: 500)
            let activeSessions = agents.filter { $0.sessionId != nil }.count

            let bridgeNode = FleetNode(
                id: connection.pairedBridgeFingerprint ?? "local",
                name: connection.pairedBridgeName ?? "Mac",
                isOnline: connection.state == .connected,
                agentCount: agents.count,
                activeSessionCount: activeSessions,
                lastHeartbeat: connection.pairedBridgeLastSeen
            )
            nodes = [bridgeNode]
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Local model

/// View model for a single Mac on the mesh. Replace with the canonical
/// model exposed by ConnectionManager once the fleet RPC ships.
struct FleetNode: Identifiable, Sendable, Equatable {
    let id: String
    let name: String
    let isOnline: Bool
    let agentCount: Int
    let activeSessionCount: Int
    let lastHeartbeat: Date?
}

// MARK: - HostAgentsView

/// Shown directly inside FleetView when there is exactly one host.
/// Skips the intermediate list — you land straight on the host's agents.
struct HostAgentsView: View {
    let host: FleetNode

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var agents: [MobileAgentSummary] = []
    @State private var isLoading = true
    @State private var error: String?

    private var isConnected: Bool { connection.state == .connected }
    private var activeCount: Int { agents.filter { $0.sessionId != nil }.count }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                hostHeader
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)
                    .padding(.bottom, ScoutSpacing.xl)

                agentList

                Color.clear.frame(height: 100)
            }
        }
        .refreshable { await load() }
        .background(ScoutColors.backgroundAdaptive)
        .task { await load() }
        .task(id: isConnected) { if isConnected { await load() } }
    }

    private var hostHeader: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(host.isOnline ? ScoutColors.ledGreen : ScoutColors.textMuted)
                    .frame(width: 7, height: 7)
                Text("OPS")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
                if host.isOnline {
                    HStack(spacing: ScoutSpacing.xs) {
                        PulseIndicator()
                        Text("live")
                            .font(ScoutTypography.code(10, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                    }
                }
            }

            Text(host.name)
                .font(ScoutTypography.body(22, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            HStack(spacing: ScoutSpacing.sm) {
                statPill(label: "Agents", value: host.agentCount, tint: ScoutColors.accent)
                statPill(label: "Active", value: activeCount, tint: ScoutColors.ledGreen)
            }
        }
    }

    private func statPill(label: String, value: Int, tint: Color) -> some View {
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

    private var agentList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(ScoutColors.accent)
                    .frame(width: 6, height: 6)
                Text("AGENTS")
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                Spacer()
                Text("\(agents.count)")
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.horizontal, ScoutSpacing.lg)
            .padding(.bottom, ScoutSpacing.xs)

            if isLoading && agents.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xxl)
            } else if agents.isEmpty {
                Text(isConnected ? "No agents on this host." : "Connect to load agents.")
                    .font(ScoutTypography.body(13))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ScoutSpacing.xxl)
                    .padding(.horizontal, ScoutSpacing.lg)
            } else {
                ForEach(Array(agents.enumerated()), id: \.element.id) { index, agent in
                    agentRow(agent)
                    if index < agents.count - 1 {
                        Rectangle()
                            .fill(ScoutColors.divider)
                            .frame(height: 0.5)
                            .padding(.leading, ScoutSpacing.lg + 20 + ScoutSpacing.md)
                    }
                }
            }
        }
    }

    private func agentRow(_ agent: MobileAgentSummary) -> some View {
        Button {
            router.push(.agentDetail(agentId: agent.id))
        } label: {
            HStack(alignment: .top, spacing: ScoutSpacing.md) {
                Circle()
                    .fill(statusColor(agent.state))
                    .frame(width: 6, height: 6)
                    .padding(.top, 6)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 3) {
                    Text(agent.title)
                        .font(ScoutTypography.code(13, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)

                    Text(agentMeta(agent))
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer(minLength: ScoutSpacing.sm)

                Text(agent.statusLabel)
                    .font(ScoutTypography.caption(11, weight: .semibold))
                    .foregroundStyle(statusColor(agent.state))
                    .padding(.horizontal, ScoutSpacing.sm)
                    .padding(.vertical, ScoutSpacing.xxs)
                    .background(statusColor(agent.state).opacity(0.08), in: Capsule())

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(.vertical, ScoutSpacing.md)
            .padding(.horizontal, ScoutSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func statusColor(_ state: String) -> Color {
        switch state {
        case "working": return ScoutColors.ledGreen
        case "available": return ScoutColors.ledAmber
        default: return ScoutColors.textMuted
        }
    }

    private func agentMeta(_ agent: MobileAgentSummary) -> String {
        var parts: [String] = []
        if let selector = agent.selector ?? agent.defaultSelector {
            parts.append(selector)
        }
        if let lastActive = agent.lastActiveDate {
            parts.append(RelativeTime.string(from: lastActive))
        }
        return parts.isEmpty ? agent.state : parts.joined(separator: " · ")
    }

    private func load() async {
        guard isConnected else { isLoading = false; return }
        isLoading = agents.isEmpty
        do {
            agents = try await connection.listMobileAgents(limit: 500)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
