/// Keyboard policy for the native New Chat composer.
///
/// Return submits the draft. Shift-Return and Option-Return remain available
/// for explicit line breaks, while Command-Return and Control-Return keep the
/// legacy submit shortcuts working.
public enum ScoutSessionSubmitPolicy {
    public static func shouldSubmit(
        isReturn: Bool,
        shift: Bool,
        option: Bool,
        composerOwnsReturn: Bool = true
    ) -> Bool {
        composerOwnsReturn && isReturn && !shift && !option
    }
}
