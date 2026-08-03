import SwiftUI
import HudsonUI
import ScoutCapabilities

/// v3 Projects — the places view (design/studio/views/mobile-timeline.tsx §4):
/// what lives where, and who's on it. A deliberately plain list built from
/// data the app already syncs: each online Mac's `listWorkspaces` inventory,
/// joined with the fleet agent list (`listAgents`) for who's working there
/// and — when a live agent reports it — branch/dirty posture.
/// The study's terminal row is intentionally NOT built here: terminal access
/// stays contextual (the shipped Terminal tab), not a v3 affordance.
struct V3ProjectsSurface: View {
    let model: AppModel
    let isActive: Bool

    private static let pollSeconds: Double = 30

    @State private var places: [V3Place] = []
    @State private var hasLoaded = false
    @State private var onlineMachineCount = 0

    private struct V3Place: Identifiable {
        let id: String
        let name: String
        var machineName: String
        /// Harnesses the Mac reports as usable here (e.g. "claude · codex").
        let harnesses: String
        var branch: String?
        var dirtyCount: Int?
        var agentNames: [String] = []
        var lastActiveAt: Date?

        var gitLine: String? {
            guard let branch else { return nil }
            if let dirtyCount, dirtyCount > 0 {
                return "\(branch) · \(dirtyCount) uncommitted"
            }
            return "\(branch) · clean"
        }

        var isDirty: Bool { (dirtyCount ?? 0) > 0 }
    }

    private var reloadKey: String {
        "\(model.fleetDataReadyToken).\(model.fleetRevision).\(model.machineFilterKey)"
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                if places.isEmpty {
                    emptyState
                } else {
                    ForEach(places) { place in
                        placeCard(place)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, HudSpacing.md)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .refreshable { await fetchOnce() }
        .task(id: "\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            while !Task.isCancelled {
                await fetchOnce()
                try? await Task.sleep(for: .seconds(Self.pollSeconds))
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        Group {
            if onlineMachineCount == 0, hasLoaded {
                ScoutEmptyState(
                    title: "No Macs online",
                    subtitle: "Projects appear once a paired Mac is reachable.",
                    icon: "network.slash"
                )
            } else {
                ScoutEmptyState(
                    title: hasLoaded ? "No projects yet" : "Looking for projects",
                    subtitle: hasLoaded
                        ? "Workspaces your Macs know about land here."
                        : "Reading the workspace inventory.",
                    icon: "folder"
                )
            }
        }
        .padding(.top, HudSpacing.xxl)
    }

    private func placeCard(_ place: V3Place) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(place.name)
                    .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let gitLine = place.gitLine {
                    Text(gitLine)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(place.isDirty ? ScoutPalette.statusWarn : ScoutInk.dim)
                        .lineLimit(1)
                }
            }
            if !place.agentNames.isEmpty {
                Text(place.agentNames.joined(separator: " · "))
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                Text(place.machineName)
                    .foregroundStyle(ScoutInk.dim)
                if !place.harnesses.isEmpty {
                    Text("·")
                        .foregroundStyle(ScoutInk.dim)
                    Text(place.harnesses)
                        .foregroundStyle(ScoutInk.dim)
                }
                if let lastActive = place.lastActiveAt {
                    Text("·")
                        .foregroundStyle(ScoutInk.dim)
                    Text("active \(V3HomeSurface.ageLabel(since: lastActive))")
                        .foregroundStyle(ScoutInk.dim)
                }
            }
            .font(HudFont.mono(HudTextSize.micro))
            .lineLimit(1)
        }
        .padding(HudSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(ScoutSurface.raised))
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
        )
        .accessibilityElement(children: .combine)
    }

    private func fetchOnce() async {
        let machines = model.agentMachines()
        onlineMachineCount = machines.filter(\.isOnline).count

        var collected: [V3Place] = []
        var agentsByMachine: [(machineId: String, agents: [AgentSummary])] = []
        for machine in machines {
            guard let client = machine.client else { continue }
            async let workspaceRows = client.listWorkspaces(query: nil, limit: 200)
            async let agentRows = client.listAgents(query: nil, limit: 200)
            guard !Task.isCancelled else { return }
            if let agents = try? await agentRows {
                agentsByMachine.append((machine.id, agents))
            }
            guard let workspaces = try? await workspaceRows, !Task.isCancelled else { continue }
            for workspace in workspaces {
                collected.append(
                    V3Place(
                        id: "\(machine.id)::\(workspace.id)",
                        name: workspace.projectName.isEmpty ? workspace.title : workspace.projectName,
                        machineName: machine.name,
                        harnesses: workspace.harnesses
                            .filter(\.isUsable)
                            .map(\.harness)
                            .joined(separator: " · ")
                    )
                )
            }
        }
        guard !Task.isCancelled else { return }

        // Join agents onto places by project name (per the Mac that reported
        // both): who's on it, branch/dirty posture, most-recent activity.
        let allAgents = agentsByMachine.flatMap(\.agents)
        var merged: [String: V3Place] = [:]
        for place in collected {
            let key = place.name.lowercased()
            var existing = merged[key] ?? place
            // Match on the reported project name. (A workspace-root fallback
            // can join agents whose project name is unset once `AgentSummary`
            // grows a `workspaceRoot` — that field ships with the fleet lanes.)
            let matches = allAgents.filter {
                $0.projectName?.lowercased() == key
            }
            for agent in matches {
                if !existing.agentNames.contains(agent.title) {
                    existing.agentNames.append(agent.title)
                }
                if existing.branch == nil, let branch = agent.branch {
                    existing.branch = branch
                    existing.dirtyCount = agent.git?.dirty
                }
                if let active = agent.lastActiveAt,
                   active > existing.lastActiveAt ?? .distantPast {
                    existing.lastActiveAt = active
                }
            }
            // Two Macs can know the same project; keep one row, name both.
            if let first = merged[key], first.machineName != place.machineName,
               !existing.machineName.contains(place.machineName) {
                existing.machineName = "\(first.machineName) · \(place.machineName)"
            }
            merged[key] = existing
        }
        places = merged.values.sorted { lhs, rhs in
            let lhsLive = !lhs.agentNames.isEmpty
            let rhsLive = !rhs.agentNames.isEmpty
            if lhsLive != rhsLive { return lhsLive }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
        hasLoaded = true
    }
}
