import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Home — a glanceable read of live agents and recent sessions, loaded from the
/// broker client. Renders two sections of `HudListRow`s with harness/status
/// expressed via `HudBadge` / `HudStatusDot`.
struct HomeSurface: View {
    let client: any ScoutBrokerClient

    @State private var sessions: [SessionSummary] = []
    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                if isLoading {
                    HudEmptyState(title: "Loading fleet", subtitle: "Reading sessions and agents from the broker.", icon: "antenna.radiowaves.left.and.right")
                } else {
                    agentsSection
                    sessionsSection
                }
            }
            .padding(HudSpacing.xxl)
        }
        .task { await load() }
    }

    // MARK: - Agents

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Agents · \(agents.count)")
            if agents.isEmpty {
                HudEmptyState(title: "No agents", icon: "person.crop.circle")
            } else {
                ForEach(agents) { agent in
                    HudListRow(
                        title: agent.title,
                        subtitle: subtitle(for: agent),
                        icon: "cpu",
                        iconTint: tint(for: agent.harness)
                    ) {
                        HudBadge(stateLabel(agent.state), tint: stateColor(agent.state), dot: true)
                    }
                }
            }
        }
    }

    private func subtitle(for agent: AgentSummary) -> String {
        var parts: [String] = []
        if let project = agent.projectName { parts.append(project) }
        if let harness = agent.harness { parts.append(harness) }
        if let label = agent.statusLabel { parts.append(label) }
        return parts.joined(separator: " · ")
    }

    private func stateLabel(_ state: AgentSummary.State) -> String {
        switch state {
        case .live: return "live"
        case .idle: return "idle"
        case .offline: return "offline"
        case .unknown: return "unknown"
        }
    }

    private func stateColor(_ state: AgentSummary.State) -> Color {
        switch state {
        case .live: return HudPalette.statusOk
        case .idle: return HudPalette.statusWarn
        case .offline: return HudPalette.dim
        case .unknown: return HudPalette.muted
        }
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Sessions · \(sessions.count)")
            if sessions.isEmpty {
                HudEmptyState(title: "No sessions", icon: "bubble.left.and.bubble.right")
            } else {
                ForEach(sessions) { session in
                    HudListRow(
                        title: session.title,
                        subtitle: subtitle(for: session),
                        icon: "bubble.left",
                        iconTint: tint(for: session.harness)
                    ) {
                        HudBadge(session.status.rawValue, tint: statusColor(session.status), dot: true)
                    }
                }
            }
        }
    }

    private func subtitle(for session: SessionSummary) -> String {
        var parts: [String] = []
        if let project = session.projectName { parts.append(project) }
        if let count = session.messageCount { parts.append("\(count) msgs") }
        if let preview = session.preview { parts.append(preview) }
        return parts.joined(separator: " · ")
    }

    private func statusColor(_ status: SessionSummary.Status) -> Color {
        switch status {
        case .active: return HudPalette.statusOk
        case .idle: return HudPalette.statusWarn
        case .connecting: return HudPalette.statusInfo
        case .closed: return HudPalette.dim
        case .unknown: return HudPalette.muted
        }
    }

    // MARK: - Shared

    private func tint(for harness: String?) -> HudTint {
        switch harness?.lowercased() {
        case "claude": return .violet
        case "codex": return .cyan
        default: return .blue
        }
    }

    private func load() async {
        isLoading = true
        async let s = try? await client.listSessions(query: nil, limit: 20)
        async let a = try? await client.listAgents(query: nil, limit: 20)
        let (loadedSessions, loadedAgents) = await (s, a)
        sessions = loadedSessions ?? []
        agents = loadedAgents ?? []
        isLoading = false
    }
}
