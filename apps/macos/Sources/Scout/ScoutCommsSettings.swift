import Foundation

/// Defaults keys for the shared Comms surface, kept beside the presentation
/// values so Settings and ScoutRootView cannot drift on the string.
enum ScoutCommsSettings {
    static let threadPresentationKey = "scout.comms.threadPresentation"
    static let threadRendererKey = "scout.comms.threadRenderer"
}

/// Which implementation draws the Comms transcript. `shared` mounts the web
/// `/embed/thread` surface so web, macOS and iOS read one implementation;
/// `native` keeps the SwiftUI message list, which still builds and is the
/// escape hatch when the embed can't load.
enum ScoutThreadRenderer: String, CaseIterable, Hashable, Identifiable {
    case shared
    case native

    var id: String { rawValue }

    static let fallback = ScoutThreadRenderer.shared
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
