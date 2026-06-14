import HudsonUI
import SwiftUI

struct ScoutSearchField: View {
    let placeholder: String
    @Binding var text: String
    var icon: String = "magnifyingglass"
    var focus: FocusState<Bool>.Binding?
    var height: CGFloat = HudLayout.fieldHeight

    @FocusState private var localFocus: Bool
    @State private var isHovering = false

    init(
        _ placeholder: String,
        text: Binding<String>,
        icon: String = "magnifyingglass",
        focus: FocusState<Bool>.Binding? = nil,
        height: CGFloat = HudLayout.fieldHeight
    ) {
        self.placeholder = placeholder
        self._text = text
        self.icon = icon
        self.focus = focus
        self.height = height
    }

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(isFocused ? ScoutPalette.accent : ScoutPalette.dim)

            focusedTextField
        }
        .padding(.horizontal, HudSpacing.xl)
        .frame(height: height)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(background)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(border, lineWidth: isFocused ? HudFocus.ringWidth : HudStrokeWidth.thin)
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.10), value: isFocused)
        .accessibilityLabel(placeholder)
    }

    @ViewBuilder
    private var focusedTextField: some View {
        if let focus {
            baseTextField.focused(focus)
        } else {
            baseTextField.focused($localFocus)
        }
    }

    private var baseTextField: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(HudFont.ui(HudTextSize.sm, weight: .medium))
            .foregroundStyle(ScoutPalette.ink)
            .tint(ScoutPalette.accent)
    }

    private var isFocused: Bool {
        focus?.wrappedValue ?? localFocus
    }

    private var background: Color {
        if isFocused { return ScoutSurface.controlFocused }
        if isHovering { return ScoutSurface.hover }
        return ScoutSurface.control
    }

    private var border: Color {
        if isFocused { return ScoutPalette.accent.opacity(0.70) }
        if isHovering { return ScoutDesign.hairlineStrong }
        return ScoutDesign.hairline
    }
}
