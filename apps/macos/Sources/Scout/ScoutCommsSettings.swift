import Foundation

/// Defaults keys for the Comms surface, kept beside the renderer choice they
/// configure so Settings and ScoutRootView can't drift on the string.
enum ScoutCommsSettings {
    static let threadRendererKey = "scout.comms.threadRenderer"
    static let threadPresentationKey = "scout.comms.threadPresentation"
}

/// How the conversation transcript is laid out — Settings › Appearance ›
/// Conversations. Ported from the readability study at
/// design/studio/views/message-panel-readability.tsx; the raw values are the
/// `treatment` query param the web surface reads.
enum ScoutThreadPresentation: String, CaseIterable, Hashable, Identifiable {
    case rail
    case ledger
    case document
    case standard

    var id: String { rawValue }

    static let fallback = ScoutThreadPresentation.rail

    var title: String {
        switch self {
        case .rail: return "Rail"
        case .ledger: return "Ledger"
        case .document: return "Document"
        case .standard: return "Standard"
        }
    }

    var detail: String {
        switch self {
        case .rail: return "Author in a left margin, prose on one hard edge."
        case .ledger: return "A dense log — time, author and text on one line."
        case .document: return "Reading-first: bigger type, tighter measure."
        case .standard: return "The bordered cards this app shipped with."
        }
    }
}

/// Which implementation draws the conversation transcript.
///
/// `shared` mounts the web `/embed/thread` surface — the same `ConversationScreen`
/// the web app renders — so the reading layout is decided once for web, macOS
/// and iOS. `native` keeps this app's own message stack. Either way the
/// composer stays native: a transcript is worth unifying, typing and
/// attachments are not.
///
/// Not surfaced in Settings. The native stack reads the same web API, so it is
/// a fallback for nothing — it stays here as a debugging escape hatch:
/// `defaults write app.openscout.scout scout.comms.threadRenderer native`.
enum ScoutThreadRenderer: String, CaseIterable, Hashable, Identifiable {
    case shared
    case native

    var id: String { rawValue }

    static let fallback = ScoutThreadRenderer.shared

    var title: String {
        switch self {
        case .shared: return "Shared"
        case .native: return "Native"
        }
    }

    var detail: String {
        switch self {
        case .shared: return "The same renderer as the web and iOS apps."
        case .native: return "This app's own message stack."
        }
    }
}
