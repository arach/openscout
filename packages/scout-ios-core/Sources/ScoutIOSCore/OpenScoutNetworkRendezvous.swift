import Foundation

public let defaultOpenScoutNetworkFrontDoorBaseURL = "https://mesh.oscout.net"
public let defaultOpenScoutNetworkMobileRelayURL = "wss://mesh.oscout.net/v1/relay"

public struct OpenScoutMeshRendezvousList: Decodable, Equatable, Sendable {
    public let v: Int
    public let meshId: String
    public let nodes: [OpenScoutMeshPresenceRecord]
}

public struct OpenScoutMeshPresenceRecord: Decodable, Equatable, Sendable {
    public let meshId: String
    public let nodeId: String
    public let nodeName: String
    public let expiresAt: Int64
    public let observedAt: Int64
    public let entrypoints: [OpenScoutMeshEntrypoint]
}

public enum OpenScoutMeshEntrypoint: Decodable, Equatable, Sendable {
    case mobilePairing(MobilePairingMeshEntrypoint)
    case other(kind: String)

    private enum CodingKeys: String, CodingKey {
        case kind
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "mobile_pairing":
            self = .mobilePairing(try MobilePairingMeshEntrypoint(from: decoder))
        default:
            self = .other(kind: kind)
        }
    }
}

public struct MobilePairingMeshEntrypoint: Decodable, Equatable, Sendable {
    public let relay: String
    public let fallbackRelays: [String]?
    public let room: String
    public let publicKey: String
    public let expiresAt: Int64
    public let lastSeenAt: Int64?
}

public struct OpenScoutNetworkPairingCandidate: Identifiable, Equatable, Sendable {
    public let nodeId: String
    public let nodeName: String
    public let observedAt: Int64
    public let entrypoint: MobilePairingMeshEntrypoint

    public var id: String { "\(nodeId):\(entrypoint.room)" }

    public var qrPayload: QRPayload {
        QRPayload(
            v: 1,
            relay: entrypoint.relay,
            fallbackRelays: entrypoint.fallbackRelays,
            room: entrypoint.room,
            publicKey: entrypoint.publicKey,
            expiresAt: entrypoint.expiresAt
        )
    }
}

public func openScoutNetworkPairingCandidates(
    from list: OpenScoutMeshRendezvousList,
    now: Date = Date()
) -> [OpenScoutNetworkPairingCandidate] {
    let nowMs = Int64(now.timeIntervalSince1970 * 1_000)
    var candidates: [OpenScoutNetworkPairingCandidate] = []

    for node in list.nodes where node.expiresAt > nowMs {
        for entrypoint in node.entrypoints {
            guard case .mobilePairing(let mobilePairing) = entrypoint,
                  mobilePairing.expiresAt > nowMs,
                  mobilePairing.publicKey.count == 64,
                  !mobilePairing.relay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !mobilePairing.room.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                continue
            }

            candidates.append(OpenScoutNetworkPairingCandidate(
                nodeId: node.nodeId,
                nodeName: node.nodeName,
                observedAt: node.observedAt,
                entrypoint: mobilePairing
            ))
        }
    }

    return candidates.sorted {
        if $0.observedAt != $1.observedAt { return $0.observedAt > $1.observedAt }
        return $0.nodeName.localizedCaseInsensitiveCompare($1.nodeName) == .orderedAscending
    }
}
