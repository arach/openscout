import SwiftUI

public struct MessageRouteChipStyle: @unchecked Sendable {
    let font: Font
    let textColor: Color
    let borderColor: Color
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let cornerRadius: CGFloat

    public init(
        font: Font,
        textColor: Color,
        borderColor: Color,
        horizontalPadding: CGFloat = 6,
        verticalPadding: CGFloat = 2,
        cornerRadius: CGFloat = 3
    ) {
        self.font = font
        self.textColor = textColor
        self.borderColor = borderColor
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
        self.cornerRadius = cornerRadius
    }
}

public struct MessageRouteChip: View {
    private let label: String
    private let prefix: String
    private let style: MessageRouteChipStyle

    public init(
        label: String,
        prefix: String = "@",
        style: MessageRouteChipStyle
    ) {
        self.label = label
        self.prefix = prefix
        self.style = style
    }

    public var body: some View {
        Text(displayLabel)
            .font(style.font)
            .foregroundStyle(style.textColor)
            .lineLimit(1)
            .padding(.horizontal, style.horizontalPadding)
            .padding(.vertical, style.verticalPadding)
            .overlay(
                RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
                    .stroke(style.borderColor, lineWidth: 0.5)
            )
            .fixedSize()
    }

    private var displayLabel: String {
        if label.hasPrefix("@") || label.hasPrefix("#") || Self.isRouteLabel(label) {
            return label
        }
        return prefix + label
    }

    private static func isRouteLabel(_ value: String) -> Bool {
        let lower = value.lowercased()
        return lower.hasPrefix("session:") || lower.hasPrefix("sid:")
    }
}

public struct MessageContextPillStyle: @unchecked Sendable {
    let separatorFont: Font
    let textFont: Font
    let separatorColor: Color
    let textColor: Color

    public init(
        separatorFont: Font,
        textFont: Font,
        separatorColor: Color,
        textColor: Color
    ) {
        self.separatorFont = separatorFont
        self.textFont = textFont
        self.separatorColor = separatorColor
        self.textColor = textColor
    }
}

public struct MessageContextPill: View {
    private let name: String
    private let separator: String
    private let style: MessageContextPillStyle

    public init(
        name: String,
        separator: String = "·",
        style: MessageContextPillStyle
    ) {
        self.name = name
        self.separator = separator
        self.style = style
    }

    public var body: some View {
        HStack(spacing: 3) {
            Text(separator)
                .font(style.separatorFont)
                .foregroundStyle(style.separatorColor)
            Text(name)
                .font(style.textFont)
                .foregroundStyle(style.textColor)
                .lineLimit(1)
        }
        .fixedSize()
    }
}

public struct MessageSendChipStyle: @unchecked Sendable {
    let keyFont: Font
    let titleFont: Font
    let tracking: CGFloat
    let enabledColor: Color
    let hoverColor: Color
    let disabledColor: Color
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat

    public init(
        keyFont: Font,
        titleFont: Font,
        tracking: CGFloat,
        enabledColor: Color,
        hoverColor: Color,
        disabledColor: Color,
        horizontalPadding: CGFloat = 4,
        verticalPadding: CGFloat = 2
    ) {
        self.keyFont = keyFont
        self.titleFont = titleFont
        self.tracking = tracking
        self.enabledColor = enabledColor
        self.hoverColor = hoverColor
        self.disabledColor = disabledColor
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
    }
}

public struct MessageSendChip: View {
    private let isEnabled: Bool
    private let isSending: Bool
    private let keyGlyph: String
    private let title: String
    private let sendingTitle: String
    private let style: MessageSendChipStyle
    private let action: () -> Void

    @State private var hovered = false

    public init(
        isEnabled: Bool,
        isSending: Bool = false,
        keyGlyph: String = "↵",
        title: String = "SEND",
        sendingTitle: String = "SENDING",
        style: MessageSendChipStyle,
        action: @escaping () -> Void
    ) {
        self.isEnabled = isEnabled
        self.isSending = isSending
        self.keyGlyph = keyGlyph
        self.title = title
        self.sendingTitle = sendingTitle
        self.style = style
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(isSending ? "…" : keyGlyph)
                    .font(style.keyFont)
                    .foregroundStyle(color)
                Text(isSending ? sendingTitle : title)
                    .font(style.titleFont)
                    .tracking(style.tracking)
                    .foregroundStyle(color)
            }
            .padding(.horizontal, style.horizontalPadding)
            .padding(.vertical, style.verticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isSending)
        .onHover { hovered = $0 }
        .help(isEnabled && !isSending ? "Send (↵)" : "")
    }

    private var color: Color {
        if !isEnabled || isSending { return style.disabledColor }
        return hovered ? style.hoverColor : style.enabledColor
    }
}
