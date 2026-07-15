import Foundation
import SwiftUI

/// Stable surface ids — must match web `scoutSurface.id` values.
enum ScoutEmbedSurfaceId: String, CaseIterable, Identifiable, Sendable {
    case dispatch
    case lanes

    var id: String { rawValue }
}

/// Native mirror of a web screen's `scoutSurface.embed` declaration.
struct ScoutEmbedSurface: Identifiable, Sendable {
    let id: ScoutEmbedSurfaceId
    let label: String
    let shellPath: String
    let embedPath: String
    let profile: String
    let systemImage: String
    let section: ScoutSection?

    var envOverrideKey: String {
        "OPENSCOUT_EMBED_URL_\(id.rawValue.uppercased())"
    }

    var legacyEnvOverrideKey: String? {
        switch id {
        case .lanes: return "OPENSCOUT_LANES_EMBED_URL"
        default: return nil
        }
    }
}

enum ScoutEmbedSurfaceRegistry {
    /// Surfaces the macOS app can host via `ScoutWebEmbedContent`.
    /// Add a row here when a web screen exports `scoutSurface.embed`.
    static let embeddable: [ScoutEmbedSurface] = [
        ScoutEmbedSurface(
            id: .dispatch,
            label: "Dispatch",
            shellPath: "/dispatch",
            embedPath: "/embed/dispatch",
            profile: "macos.dispatch",
            systemImage: "paperplane",
            section: .dispatch
        ),
        ScoutEmbedSurface(
            id: .lanes,
            label: "Lanes",
            shellPath: "/ops/lanes",
            embedPath: "/embed/agent-lanes",
            profile: "macos.lanes",
            systemImage: "rectangle.split.3x1",
            section: .lanes
        ),
    ]

    static func surface(id: ScoutEmbedSurfaceId) -> ScoutEmbedSurface {
        guard let match = embeddable.first(where: { $0.id == id }) else {
            preconditionFailure("missing ScoutEmbedSurface registry entry for \(id.rawValue)")
        }
        return match
    }

    static func surface(for section: ScoutSection) -> ScoutEmbedSurface? {
        embeddable.first { $0.section == section }
    }
}

extension ScoutEmbedSurfaceId {
    var descriptor: ScoutEmbedSurface {
        ScoutEmbedSurfaceRegistry.surface(id: self)
    }

    var title: String { descriptor.label }
    var shellPath: String { descriptor.shellPath }
    var embedPath: String { descriptor.embedPath }
    var profile: String { descriptor.profile }
    var systemImage: String { descriptor.systemImage }
}

extension ScoutSection {
    var embedSurfaceId: ScoutEmbedSurfaceId? {
        ScoutEmbedSurfaceRegistry.surface(for: self)?.id
    }

    static var webEmbedSections: [ScoutSection] {
        ScoutEmbedSurfaceRegistry.embeddable.compactMap(\.section)
    }
}