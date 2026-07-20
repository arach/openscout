// ScoutBrokerClient (SCO-061).
//
// The composed broker contract: a single type that satisfies every capability
// the app consumes. `ScoutBrokerClient` is intentionally a *composition* of
// small semantic protocols, never a monolithic endpoint-shaped client. Each
// platform provides one conformer:
//   - macOS: WebBrokerClient (HTTP/SSE via ScoutWeb.baseURL)
//   - iOS:   BridgeBrokerClient (WS+Noise+tRPC, in scout-ios-core)
//   - demos/tests: an in-memory mock
//
// Conversation + Control capabilities joined here in Phase 2.

import Foundation

public protocol ScoutBrokerClient:
    SessionInitiationCapability,
    ListingCapability,
    TailCapability,
    ConversationCapability,
    ControlCapability,
    AttachmentHostingCapability,
    CommsCapability,
    MobilePushRegistrationCapability,
    Sendable
{}
