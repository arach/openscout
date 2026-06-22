import Foundation

/// Status of the OpenScout broker launch agent + runtime.
///
/// Shared between the main Scout app's settings surface and the menu helper.
/// Constructed from a `BrokerServiceStatus` (see `init(from:)`).
public struct BrokerState: Sendable {
    public var label: String
    public var brokerURL: String
    public var launchAgentPath: String
    public var installed: Bool
    public var loaded: Bool
    public var reachable: Bool
    public var pid: Int?
    public var lastExitStatus: Int?
    public var restartTelemetry: BrokerRestartTelemetry?
    public var statusDetail: String

    public init(
        label: String = "OpenScout Broker",
        brokerURL: String = "http://127.0.0.1:65535",
        launchAgentPath: String = "",
        installed: Bool = false,
        loaded: Bool = false,
        reachable: Bool = false,
        pid: Int? = nil,
        lastExitStatus: Int? = nil,
        restartTelemetry: BrokerRestartTelemetry? = nil,
        statusDetail: String = "Checking broker status..."
    ) {
        self.label = label
        self.brokerURL = brokerURL
        self.launchAgentPath = launchAgentPath
        self.installed = installed
        self.loaded = loaded
        self.reachable = reachable
        self.pid = pid
        self.lastExitStatus = lastExitStatus
        self.restartTelemetry = restartTelemetry
        self.statusDetail = statusDetail
    }

    public var hasRestartWarning: Bool {
        guard loaded || reachable else { return false }
        return restartTelemetry?.shouldWarn == true
    }

    public var restartWarningSummary: String? {
        guard let restartTelemetry, restartTelemetry.shouldWarn else { return nil }
        return restartTelemetry.compactWarning(reachable: reachable)
    }
}

extension BrokerState {
    public init(from status: BrokerServiceStatus) {
        self.init(
            label: status.label,
            brokerURL: status.brokerURL,
            launchAgentPath: status.launchAgentPath,
            installed: status.installed,
            loaded: status.loaded,
            reachable: status.reachable,
            pid: status.pid,
            lastExitStatus: status.lastExitStatus,
            restartTelemetry: status.restartTelemetry,
            statusDetail: {
                if status.reachable {
                    return "Broker is responding at \(status.brokerURL)."
                } else if status.loaded {
                    return "Launch agent is loaded but the broker did not answer."
                } else if status.installed {
                    return "Launch agent is installed but not loaded."
                } else {
                    return "Launch agent is not installed."
                }
            }()
        )
    }
}

/// Status of the OpenScout pairing relay runtime (the mobile bridge).
public struct PairingViewState: Sendable {
    public var status: String
    public var statusLabel: String
    public var statusDetail: String
    public var relay: String?
    public var workspaceRoot: String?
    public var identityFingerprint: String?
    public var trustedPeerCount: Int
    public var qrArt: String?
    public var qrValue: String?
    public var lastUpdatedLabel: String?
    public var isRunning: Bool
    public var controlAvailable: Bool
    public var controlHint: String?

    public init(
        status: String = "stopped",
        statusLabel: String = "Stopped",
        statusDetail: String = "Checking pairing state...",
        relay: String? = nil,
        workspaceRoot: String? = nil,
        identityFingerprint: String? = nil,
        trustedPeerCount: Int = 0,
        qrArt: String? = nil,
        qrValue: String? = nil,
        lastUpdatedLabel: String? = nil,
        isRunning: Bool = false,
        controlAvailable: Bool = false,
        controlHint: String? = nil
    ) {
        self.status = status
        self.statusLabel = statusLabel
        self.statusDetail = statusDetail
        self.relay = relay
        self.workspaceRoot = workspaceRoot
        self.identityFingerprint = identityFingerprint
        self.trustedPeerCount = trustedPeerCount
        self.qrArt = qrArt
        self.qrValue = qrValue
        self.lastUpdatedLabel = lastUpdatedLabel
        self.isRunning = isRunning
        self.controlAvailable = controlAvailable
        self.controlHint = controlHint
    }
}

/// Status of the local Tailscale tailnet membership.
public struct TailscaleViewState: Sendable {
    public var status: String
    public var statusLabel: String
    public var statusDetail: String
    public var backendState: String?
    public var dnsName: String?
    public var address: String?
    public var peerCount: Int
    public var onlinePeerCount: Int
    public var health: [String]
    public var cliPath: String?
    public var available: Bool
    public var running: Bool
    public var controlAvailable: Bool
    public var controlHint: String?

    public init(
        status: String = "checking",
        statusLabel: String = "Checking",
        statusDetail: String = "Checking Tailscale...",
        backendState: String? = nil,
        dnsName: String? = nil,
        address: String? = nil,
        peerCount: Int = 0,
        onlinePeerCount: Int = 0,
        health: [String] = [],
        cliPath: String? = nil,
        available: Bool = false,
        running: Bool = false,
        controlAvailable: Bool = false,
        controlHint: String? = nil
    ) {
        self.status = status
        self.statusLabel = statusLabel
        self.statusDetail = statusDetail
        self.backendState = backendState
        self.dnsName = dnsName
        self.address = address
        self.peerCount = peerCount
        self.onlinePeerCount = onlinePeerCount
        self.health = health
        self.cliPath = cliPath
        self.available = available
        self.running = running
        self.controlAvailable = controlAvailable
        self.controlHint = controlHint
    }
}

/// Resolved OpenScout Network settings + session state, derived from the
/// persisted settings file and the Keychain session token.
public struct OpenScoutNetworkViewState: Sendable {
    public var discoveryEnabled: Bool
    public var rendezvousURL: String
    public var pairingRelayURL: String
    public var keepPairingRelayRunning: Bool
    public var sessionAvailable: Bool
    public var settingsPath: String
    public var statusLabel: String
    public var statusDetail: String

    public init(
        discoveryEnabled: Bool = OpenScoutNetworkSettings.defaultDiscoveryEnabled,
        rendezvousURL: String = OpenScoutNetworkSettings.defaultRendezvousURL,
        pairingRelayURL: String = OpenScoutNetworkSettings.defaultPairingRelayURL,
        keepPairingRelayRunning: Bool = true,
        sessionAvailable: Bool = false,
        settingsPath: String = OpenScoutNetworkSettingsStore.settingsPath(),
        statusLabel: String = "Sign in required",
        statusDetail: String = "Sign in to OpenScout Network before publishing this Mac."
    ) {
        self.discoveryEnabled = discoveryEnabled
        self.rendezvousURL = rendezvousURL
        self.pairingRelayURL = pairingRelayURL
        self.keepPairingRelayRunning = keepPairingRelayRunning
        self.sessionAvailable = sessionAvailable
        self.settingsPath = settingsPath
        self.statusLabel = statusLabel
        self.statusDetail = statusDetail
    }
}
