import Foundation

public struct ScoutRelayChannelConfig: Codable, Hashable, Sendable {
    public var audio: Bool
    public var voice: String?

    public init(audio: Bool, voice: String? = nil) {
        self.audio = audio
        self.voice = voice
    }
}

public struct ScoutRelayConfig: Codable, Hashable, Sendable {
    public var agents: [String]
    public var created: Int
    public var projectRoot: String?
    public var channels: [String: ScoutRelayChannelConfig]
    public var defaultVoice: String?
    public var roster: [String]

    public init(
        agents: [String] = [],
        created: Int = Int(Date.now.timeIntervalSince1970 * 1000),
        projectRoot: String? = nil,
        channels: [String: ScoutRelayChannelConfig] = ["voice": ScoutRelayChannelConfig(audio: true)],
        defaultVoice: String? = nil,
        roster: [String] = []
    ) {
        self.agents = agents
        self.created = created
        self.projectRoot = projectRoot
        self.channels = channels
        self.defaultVoice = defaultVoice
        self.roster = roster
    }

    enum CodingKeys: String, CodingKey {
        case agents
        case created
        case projectRoot
        case channels
        case defaultVoice
        case roster
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.agents = try container.decodeIfPresent([String].self, forKey: .agents) ?? []
        self.created = try container.decodeIfPresent(Int.self, forKey: .created) ?? Int(Date.now.timeIntervalSince1970 * 1000)
        self.projectRoot = try container.decodeIfPresent(String.self, forKey: .projectRoot)
        self.channels = try container.decodeIfPresent([String: ScoutRelayChannelConfig].self, forKey: .channels) ?? ["voice": ScoutRelayChannelConfig(audio: true)]
        self.defaultVoice = try container.decodeIfPresent(String.self, forKey: .defaultVoice)
        self.roster = try container.decodeIfPresent([String].self, forKey: .roster) ?? []
    }

    public var voiceChannel: ScoutRelayChannelConfig? {
        channels["voice"]
    }

    public var resolvedDefaultVoice: String {
        voiceChannel?.voice ?? defaultVoice ?? "nova"
    }
}
