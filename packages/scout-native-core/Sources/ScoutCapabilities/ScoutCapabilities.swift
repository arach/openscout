// ScoutCapabilities — shared semantic capability layer (SCO-061).
//
// This module is the spine of the cross-platform Scout architecture: it holds
// the capability *contracts* (protocols naming what the app needs, never which
// endpoint serves it), the pure data they exchange, and — added in later phases
// — the conversation projection and the queue/steering state machine.
//
// Hard constraints (enforced by review + CI):
//   - imports Foundation ONLY (no transport, no SwiftUI/Hudson, no @MainActor).
//   - per-platform transport adapters live in the apps / scout-ios-core.
//   - views live in the apps.
//
// See docs/eng/sco-061-implementation-plan.md.

import Foundation

/// Namespace + version marker for the capability layer. Phase 1 adds the first
/// real contract (`SessionInitiationCapability`); this keeps the target wired
/// and buildable in Phase 0.
public enum ScoutCapabilities {
    /// Schema revision of the capability contracts. Bump when a contract's
    /// semantic shape changes so contract fixtures can gate adapters.
    public static let contractVersion = 1
}
