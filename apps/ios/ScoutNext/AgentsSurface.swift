import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Agents — the permanent directory of every agent on the bridge (distinct from
/// Home's glance). Searchable, grouped live → idle → offline, tap-through to the
/// agent's conversation. Shares the broker client; reloads when the bridge connects.
struct AgentsSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: ConversationRoute?

    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                if isLoading {
                    HudEmptyState(title: "Loading agents", icon: "person.2")
                } else if agents.isEmpty {
                    HudEmptyState(title: "No agents", subtitle: "Connect to your Mac to see the directory.", icon: "person.2.slash")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else {
                    HudField("Search agents", text: $searchText, icon: "magnifyingglass")
                    group("LIVE", .live)
                    group("IDLE", .idle)
                    group("OFFLINE", .offline)
                }
            }
            .padding(HudSpacing.xxl)
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(client: client, conversationId: route.id, title: route.title, onClose: { self.route = nil })
        }
    }

    @ViewBuilder
    private func group(_ label: String, _ state: AgentSummary.State) -> some View {
        let rows = filtered.filter { $0.state == state }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.lg) {
                HudSectionLabel("\(label) · \(rows.count)")
                ForEach(rows) { agent in
                    HudListRow(
                        title: agent.title,
                        subtitle: subtitle(for: agent),
                        icon: harnessIcon(agent.harness),
                        iconTint: harnessTint(agent.harness),
                        onTap: agent.sessionId.map { sid in { route = ConversationRoute(id: sid, title: agent.title) } }
                    ) {
                        HudBadge(stateLabel(state), tint: stateColor(state), dot: state == .live)
                    }
                }
            }
        }
    }

    private var filtered: [AgentSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return agents }
        return agents.filter { a in
            [a.title, a.projectName, a.harness, a.statusLabel].compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
    }

    private func subtitle(for agent: AgentSummary) -> String {
        [agent.projectName, agent.harness, agent.statusLabel].compactMap { $0 }.joined(separator: " · ")
    }

    private func harnessIcon(_ harness: String?) -> String {
        switch harness?.lowercased() {
        case "claude": return "sparkle"
        case "codex": return "chevron.left.forwardslash.chevron.right"
        default: return "cpu"
        }
    }

    private func harnessTint(_ harness: String?) -> HudTint {
        switch harness?.lowercased() {
        case "claude": return .violet
        case "codex": return .cyan
        default: return .blue
        }
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
        case .live: return HudPalette.accent
        case .idle: return HudPalette.muted
        case .offline, .unknown: return HudPalette.dim
        }
    }

    private func load() async {
        isLoading = true
        agents = (try? await client.listAgents(query: nil, limit: 100)) ?? []
        isLoading = false
    }
}
