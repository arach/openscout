/// Resolves the app-wide New command without making one surface own every
/// section's context. In Terminals, ⌘N creates a shell in place; elsewhere it
/// retains Scout's existing new-conversation behavior.
public enum ScoutNewItemDestination: Equatable, Sendable {
    case conversation
    case terminalShell

    public static func resolve(sectionRawValue: String) -> Self {
        sectionRawValue == "terminals" ? .terminalShell : .conversation
    }
}
