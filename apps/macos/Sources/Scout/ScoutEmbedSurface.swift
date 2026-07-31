import Foundation
import SwiftUI

/// Stable surface ids — must match web `scoutSurface.id` values.
enum ScoutEmbedSurfaceId: String, CaseIterable, Identifiable, Sendable {
    case projects
    case dispatch
    case lanes
    case code
    case thread
    case voice

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
            id: .projects,
            label: "Projects",
            shellPath: "/projects",
            embedPath: "/embed/projects",
            profile: "macos.projects",
            systemImage: "folder",
            section: .agents
        ),
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
        ScoutEmbedSurface(
            id: .code,
            label: "Code",
            shellPath: "/code",
            embedPath: "/embed/code",
            profile: "macos.code",
            systemImage: "chevron.left.forwardslash.chevron.right",
            section: .code
        ),
        // The shared conversation body. The embed boundary defers message input
        // to the native composer, which owns pasteboard, drag-drop, dictation,
        // and keyboard commands. `section` is nil on purpose: unlike the
        // surfaces above this is not a nav destination; it renders inside the
        // native Comms shell.
        ScoutEmbedSurface(
            id: .thread,
            label: "Thread",
            shellPath: "/chat",
            embedPath: "/embed/thread",
            profile: "macos.thread",
            systemImage: "bubble.left.and.bubble.right",
            section: nil
        ),
        // The live Scoutbot call. Embedded rather than reimplemented: the web
        // client already holds the WebRTC peer connection, the lease/admission
        // handshake, and the ask_scoutbot tool loop. `section` is nil — it
        // mounts from the footer status control, not the nav rail.
        ScoutEmbedSurface(
            id: .voice,
            label: "Live voice",
            shellPath: "/settings/voice",
            embedPath: "/embed/voice",
            profile: "macos.voice",
            systemImage: "waveform",
            section: nil
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
