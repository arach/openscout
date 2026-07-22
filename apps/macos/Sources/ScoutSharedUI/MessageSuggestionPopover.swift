import SwiftUI

public struct MessageSuggestionPopoverStyle: @unchecked Sendable {
    let eyebrowFont: Font
    let markFont: Font
    let labelFont: Font
    let detailFont: Font
    let eyebrowColor: Color
    let commandAccent: Color
    let agentAccent: Color
    let sessionAccent: Color
    let selectedLabelColor: Color
    let labelColor: Color
    let detailColor: Color
    let selectedBackgroundColor: Color
    let backgroundColor: Color
    let borderColor: Color
    let shadowColor: Color
    let cornerRadius: CGFloat
    let borderWidth: CGFloat

    public init(
        eyebrowFont: Font,
        markFont: Font,
        labelFont: Font,
        detailFont: Font,
        eyebrowColor: Color,
        commandAccent: Color,
        agentAccent: Color,
        sessionAccent: Color,
        selectedLabelColor: Color,
        labelColor: Color,
        detailColor: Color,
        selectedBackgroundColor: Color,
        backgroundColor: Color,
        borderColor: Color,
        shadowColor: Color,
        cornerRadius: CGFloat = 6,
        borderWidth: CGFloat = 0.75
    ) {
        self.eyebrowFont = eyebrowFont
        self.markFont = markFont
        self.labelFont = labelFont
        self.detailFont = detailFont
        self.eyebrowColor = eyebrowColor
        self.commandAccent = commandAccent
        self.agentAccent = agentAccent
        self.sessionAccent = sessionAccent
        self.selectedLabelColor = selectedLabelColor
        self.labelColor = labelColor
        self.detailColor = detailColor
        self.selectedBackgroundColor = selectedBackgroundColor
        self.backgroundColor = backgroundColor
        self.borderColor = borderColor
        self.shadowColor = shadowColor
        self.cornerRadius = cornerRadius
        self.borderWidth = borderWidth
    }

    func accent(for kind: MessageSuggestionKind) -> Color {
        switch kind {
        case .command: return commandAccent
        case .agent: return agentAccent
        case .project: return commandAccent
        case .session: return sessionAccent
        }
    }
}

public struct MessageSuggestionPopover: View {
    private let suggestions: [MessageSuggestion]
    private let selectedIndex: Int
    private let style: MessageSuggestionPopoverStyle
    private let onHover: (Int) -> Void
    private let onSelect: (MessageSuggestion) -> Void

    public init(
        suggestions: [MessageSuggestion],
        selectedIndex: Int,
        style: MessageSuggestionPopoverStyle,
        onHover: @escaping (Int) -> Void,
        onSelect: @escaping (MessageSuggestion) -> Void
    ) {
        self.suggestions = suggestions
        self.selectedIndex = selectedIndex
        self.style = style
        self.onHover = onHover
        self.onSelect = onSelect
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(suggestions.first?.kind.eyebrow ?? "SUGGEST")
                .font(style.eyebrowFont)
                .foregroundStyle(style.eyebrowColor)
                .padding(.horizontal, 10)
                .padding(.top, 7)
                .padding(.bottom, 4)

            ForEach(Array(suggestions.prefix(7).enumerated()), id: \.element.id) { index, suggestion in
                Button {
                    onSelect(suggestion)
                } label: {
                    row(suggestion: suggestion, selected: index == selectedIndex)
                }
                .buttonStyle(.plain)
                .onHover { hovering in
                    if hovering { onHover(index) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
                .fill(style.backgroundColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
                .stroke(style.borderColor, lineWidth: style.borderWidth)
        )
        .shadow(color: style.shadowColor, radius: 10, x: 0, y: 4)
    }

    private func row(suggestion: MessageSuggestion, selected: Bool) -> some View {
        let accent = style.accent(for: suggestion.kind)
        return HStack(spacing: 9) {
            Text(suggestion.kind.mark)
                .font(style.markFont)
                .foregroundStyle(selected ? accent : style.eyebrowColor)
                .frame(width: 24, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text(suggestion.label)
                    .font(style.labelFont)
                    .foregroundStyle(selected ? style.selectedLabelColor : style.labelColor)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(suggestion.detail)
                    .font(style.detailFont)
                    .foregroundStyle(style.detailColor)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
        .background(
            Rectangle()
                .fill(selected ? style.selectedBackgroundColor : Color.clear)
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(selected ? accent : Color.clear)
                .frame(width: 1.5)
        }
        .contentShape(Rectangle())
    }
}
