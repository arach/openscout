import HudsonShell
import HudsonUI
import SwiftUI

// A reusable, high-end dropdown vocabulary — a styled key/value chip *trigger*
// plus a flush floating *panel* of rows. Unlike `.popover` (which forces a
// system arrow on macOS), the panel is a plain anchored overlay, so it reads as
// a clean flush dropdown. The host positions the panel from the trigger's
// `DropdownAnchorKey` bounds; see `ScoutSessionComposer.dropdownOverlay`.

// Trigger bounds, keyed by an id, so the host can place the open panel under it.
struct DropdownAnchorKey: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

// The chip trigger: uppercase key on the left, value (+ optional dot) + chevron
// on the right, in a bordered inset box. Publishes its bounds for the host.
struct ScoutDropdownTrigger: View {
    let id: String
    let key: String
    let value: String
    var valueDot: Color? = nil
    var width: CGFloat? = nil
    let isOpen: Bool
    let onTap: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.sm) {
                Text(key)
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                    .textCase(.uppercase)
                Spacer(minLength: HudSpacing.sm)
                if let valueDot {
                    Circle().fill(valueDot).frame(width: 6, height: 6)
                }
                Text(value)
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Image(systemName: "chevron.down")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(isOpen ? ScoutPalette.accent : ScoutPalette.dim)
                    .rotationEffect(.degrees(isOpen ? 180 : 0))
            }
            .padding(.leading, HudSpacing.md)
            .padding(.trailing, HudSpacing.sm)
            .frame(width: width, height: 38)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill((hovering || isOpen) ? ScoutSurface.hover : ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(
                        isOpen ? ScoutPalette.accent.opacity(0.50) : ScoutDesign.hairlineStrong,
                        lineWidth: HudStrokeWidth.thin
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .anchorPreference(key: DropdownAnchorKey.self, value: .bounds) { [id: $0] }
    }
}

// The floating panel surface — a flush rounded card with a thin border + shallow
// lift, sized to its rows (the host caps width via `.frame`).
struct ScoutDropdownPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            content()
        }
        .padding(HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutDesign.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .shadow(color: ScoutSurface.shadow(0.26), radius: 12, y: 4)
    }
}

// A muted uppercase section header inside a panel (e.g. a harness group).
struct ScoutDropdownSectionLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .foregroundStyle(ScoutPalette.dim)
            .textCase(.uppercase)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.top, HudSpacing.sm)
            .padding(.bottom, HudSpacing.xxs)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// One selectable row — optional state dot, label, optional detail, a check on
// the active row, accent-soft active / hover fills.
struct ScoutDropdownRow: View {
    let label: String
    var detail: String? = nil
    var dot: Color? = nil
    let selected: Bool
    var active: Bool = false          // keyboard cursor — highlights like hover
    var leadingSymbol: String? = nil  // e.g. "plus" for a Create row
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.sm) {
                if let leadingSymbol {
                    Image(systemName: leadingSymbol)
                        .font(HudFont.ui(HudTextSize.xs, weight: .bold))
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(width: 9, height: 9)
                } else if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                Text(label)
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                if let detail {
                    Text(detail)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                }
                Spacer(minLength: HudSpacing.md)
                if selected {
                    Image(systemName: "checkmark")
                        .font(HudFont.ui(HudTextSize.xs, weight: .bold))
                        .foregroundStyle(ScoutPalette.accent)
                }
            }
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 30)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(selected || active ? ScoutPalette.accentSoft.opacity(0.42) : (hovering ? ScoutSurface.hover : Color.clear))
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
    }
}
