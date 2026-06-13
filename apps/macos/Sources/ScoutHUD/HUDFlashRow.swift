import SwiftUI

// Transient single-line alert row that lives between the panel content
// and the universal dock. Slides up from below with a soft spring
// "boing" when set; slides out cleanly on dismiss / auto-expire.
//
// Any component can fire one:
//   HUDFlashState.shared.flash("Voice capture unavailable.")
//
// The state owns the auto-dismiss timer so callers don't have to.

@MainActor
final class HUDFlashState: ObservableObject {
    static let shared = HUDFlashState()

    /// Currently visible flash row (nil when nothing's showing).
    @Published private(set) var current: Flash?
    /// Remembers the last dismissed flash so a small pip can stay in
    /// the masthead — "you dismissed this but it's not resolved." Tap
    /// the pip to re-show the flash; clears on next flash or explicit
    /// clearDismissed().
    @Published private(set) var dismissed: Flash?

    struct Flash: Identifiable {
        let id: UUID
        let kind: Kind
        let body: String
        let action: Action?

        enum Kind { case error, info, success }

        struct Action {
            let label: String       // e.g. "TRY AGAIN"
            let perform: () -> Void // ran on tap
        }
    }

    private var dismissTask: Task<Void, Never>?

    private init() {}

    /// Show `body` in the flash row. `action`, when set, renders a
    /// labeled button to the left of DISMISS and runs `perform` on tap
    /// (the flash dismisses after invoking). `duration` is auto-dismiss
    /// in seconds; pass `nil` to use the default (sticky if there's an
    /// action, 4s otherwise). Pass 0 to require manual dismiss
    /// explicitly. Re-firing supersedes any prior flash + clears any
    /// dismissed-pip.
    func flash(
        _ body: String,
        kind: Flash.Kind = .error,
        action: Flash.Action? = nil,
        duration: TimeInterval? = nil
    ) {
        dismissTask?.cancel()
        let next = Flash(id: UUID(), kind: kind, body: body, action: action)
        current = next
        dismissed = nil
        // Sticky by default when there's an action — the operator needs
        // time to read, decide, and click. Time-decay is fine for
        // information-only flashes.
        let resolved = duration ?? (action != nil ? 0 : 4.0)
        guard resolved > 0 else { return }
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(resolved * 1_000_000_000))
            await MainActor.run {
                guard let self else { return }
                if self.current?.id == next.id { self.current = nil }
            }
        }
    }

    /// Dismiss the current flash. If it had content worth remembering
    /// (an action attached → the operator might still want to act),
    /// stash it on `dismissed` so the masthead pip can reach back to it.
    func dismiss() {
        dismissTask?.cancel()
        dismissTask = nil
        if let c = current, c.action != nil {
            dismissed = c
        }
        current = nil
    }

    /// Drop the dismissed-pip indicator (e.g., the underlying condition
    /// resolved, or the operator explicitly cleared it).
    func clearDismissed() {
        dismissed = nil
    }

    /// Re-show a previously dismissed flash. Called by the masthead pip.
    /// Result is sticky (no auto-dismiss) since the operator opted to
    /// look at it again.
    func reshowDismissed() {
        guard let d = dismissed else { return }
        dismissed = nil
        flash(d.body, kind: d.kind, action: d.action, duration: 0)
    }
}

struct HUDFlashRow: View {
    @ObservedObject private var state = HUDFlashState.shared

    var body: some View {
        // ZStack so the layout is reserved when nothing's flashing (no
        // dock-jump on first appearance); height is 0 when current is
        // nil because the row only renders inside the `if`.
        ZStack(alignment: .bottom) {
            if let current = state.current {
                row(for: current)
                    .transition(
                        .move(edge: .bottom).combined(with: .opacity)
                    )
            }
        }
        // Spring with low damping = small overshoot on slide-in
        // (the "boing"). Response controls speed; damping the bounce.
        .animation(.spring(response: 0.32, dampingFraction: 0.58), value: state.current?.id)
    }

    private func row(for f: HUDFlashState.Flash) -> some View {
        let accent = color(for: f.kind)
        return HStack(spacing: 8) {
            Circle()
                .fill(accent)
                .frame(width: 5, height: 5)
            Text(f.body)
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let action = f.action {
                ActionPill(label: action.label, accent: accent) {
                    action.perform()
                    state.dismiss()
                }
            }
            Button(action: { state.dismiss() }) {
                Text("DISMISS")
                    .font(HUDType.mono(9, weight: .bold))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(accent.opacity(0.18))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(accent.opacity(0.70))
                .frame(height: 0.5)
        }
    }

    private func color(for kind: HUDFlashState.Flash.Kind) -> Color {
        switch kind {
        // Brighter, more saturated red than the masthead offline pip —
        // a flash needs to read as alert, not ambient status.
        case .error: return Color(red: 1.0, green: 0.28, blue: 0.28)
        case .info:  return HUDChrome.inkMuted
        case .success: return HUDChrome.accent
        }
    }
}

// Tiny pip rendered in the masthead's right cluster after a flash with
// an action is dismissed. Persistent reminder ("you still have an
// unresolved alert"); tap re-shows the flash sticky so the operator
// can act on it. Clears on next flash or explicit clearDismissed().
struct DismissedFlashPip: View {
    @ObservedObject private var state = HUDFlashState.shared
    @State private var hovered = false

    private let accent = Color(red: 1.0, green: 0.28, blue: 0.28)

    var body: some View {
        if let dismissed = state.dismissed {
            Button(action: { state.reshowDismissed() }) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(accent)
                        .frame(width: 5, height: 5)
                    Text("ALERT")
                        .font(HUDType.mono(9, weight: .bold))
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(hovered ? HUDChrome.ink : accent)
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(accent.opacity(hovered ? 0.85 : 0.55), lineWidth: 0.5)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovered = $0 }
            .help(dismissed.body)
            .transition(.scale.combined(with: .opacity))
        }
    }
}

// CTA pill rendered when a flash carries an action. Bordered chip with
// hover lift; reads as the recommended next move so the operator's eye
// lands on it before DISMISS.
private struct ActionPill: View {
    let label: String
    let accent: Color
    let onTap: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(HUDType.mono(9, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(hovered ? HUDChrome.canvas : accent)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(hovered ? accent : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(accent.opacity(hovered ? 0 : 0.75), lineWidth: 0.6)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}
