import Foundation

/// Pure, clock-injected reducer that turns a stream of agent snapshots into
/// attention decisions: which agents to announce, which announcements to
/// retract, and how many agents currently want the operator. It holds no
/// timers — maturation is evaluated on each `ingest`, using the injected clock.
public struct ScoutAttentionTracker {
    public struct Update {
        public let notify: [ScoutAgent]
        public let resolvedAgentIds: [String]
        public let attentionCount: Int
    }

    private enum EpisodeStage {
        /// Entered attention; waiting out the debounce before it can announce.
        case pending
        /// Announced once for this episode.
        case announced
        /// Will not announce this episode (baseline snapshot or refire cooldown).
        case suppressed
    }

    private struct Episode {
        var stage: EpisodeStage
        let candidateSince: Date
    }

    private let debounce: TimeInterval
    private let refireCooldown: TimeInterval

    private var hasBaseline = false
    private var episodes: [String: Episode] = [:]
    private var lastEmit: [String: Date] = [:]

    public init(debounce: TimeInterval = 3.0, refireCooldown: TimeInterval = 90) {
        self.debounce = debounce
        self.refireCooldown = refireCooldown
    }

    public mutating func ingest(agents: [ScoutAgent], at now: Date) -> Update {
        let attentionAgents = agents.filter { $0.state == .needsAttention }
        let attentionIds = Set(attentionAgents.map(\.id))
        let attentionCount = attentionAgents.count

        // The first-ever snapshot never announces: agents already waiting are
        // recorded as suppressed so they count for the badge without ambushing
        // the operator at launch.
        if !hasBaseline {
            hasBaseline = true
            for agent in attentionAgents {
                episodes[agent.id] = Episode(stage: .suppressed, candidateSince: now)
            }
            return Update(notify: [], resolvedAgentIds: [], attentionCount: attentionCount)
        }

        var resolved: [String] = []
        let leavingIds = episodes.keys.filter { !attentionIds.contains($0) }
        for id in leavingIds {
            if episodes[id]?.stage == .announced {
                resolved.append(id)
            }
            episodes.removeValue(forKey: id)
        }

        var notify: [ScoutAgent] = []
        for agent in attentionAgents {
            if let existing = episodes[agent.id] {
                if existing.stage == .pending,
                   now.timeIntervalSince(existing.candidateSince) >= debounce {
                    episodes[agent.id] = Episode(stage: .announced, candidateSince: existing.candidateSince)
                    lastEmit[agent.id] = now
                    notify.append(agent)
                }
            } else {
                let stage: EpisodeStage
                if let last = lastEmit[agent.id], now.timeIntervalSince(last) < refireCooldown {
                    stage = .suppressed
                } else {
                    stage = .pending
                }
                episodes[agent.id] = Episode(stage: stage, candidateSince: now)
            }
        }

        return Update(notify: notify, resolvedAgentIds: resolved, attentionCount: attentionCount)
    }
}
