import SwiftUI

public struct MessageCodeBlockStyle: @unchecked Sendable {
    let labelFont: Font
    let codeFont: Font
    let labelColor: Color
    let codeColor: Color
    let backgroundColor: Color
    let borderColor: Color
    let cornerRadius: CGFloat
    let borderWidth: CGFloat
    let contentInsets: EdgeInsets
    let blockSpacing: CGFloat
    let labelTracking: CGFloat
    let showsScrollIndicators: Bool

    public init(
        labelFont: Font,
        codeFont: Font,
        labelColor: Color,
        codeColor: Color,
        backgroundColor: Color,
        borderColor: Color,
        cornerRadius: CGFloat = 6,
        borderWidth: CGFloat = 1,
        contentInsets: EdgeInsets = EdgeInsets(top: 9, leading: 10, bottom: 9, trailing: 10),
        blockSpacing: CGFloat = 7,
        labelTracking: CGFloat = 1.0,
        showsScrollIndicators: Bool = false
    ) {
        self.labelFont = labelFont
        self.codeFont = codeFont
        self.labelColor = labelColor
        self.codeColor = codeColor
        self.backgroundColor = backgroundColor
        self.borderColor = borderColor
        self.cornerRadius = cornerRadius
        self.borderWidth = borderWidth
        self.contentInsets = contentInsets
        self.blockSpacing = blockSpacing
        self.labelTracking = labelTracking
        self.showsScrollIndicators = showsScrollIndicators
    }
}

public struct MessageCodeBlock: View {
    private let language: String?
    private let text: String
    private let style: MessageCodeBlockStyle

    public init(
        language: String?,
        text: String,
        style: MessageCodeBlockStyle
    ) {
        let trimmedLanguage = language?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.language = trimmedLanguage?.isEmpty == false ? trimmedLanguage : nil
        self.text = text
        self.style = style
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: style.blockSpacing) {
            if let language {
                Text(language.uppercased())
                    .font(style.labelFont)
                    .tracking(style.labelTracking)
                    .foregroundStyle(style.labelColor)
            }

            ScrollView(.horizontal) {
                Text(text)
                    .font(style.codeFont)
                    .foregroundStyle(style.codeColor)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(style.showsScrollIndicators ? .visible : .hidden)
        }
        .padding(style.contentInsets)
        .background(
            RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
                .fill(style.backgroundColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
                .stroke(style.borderColor, lineWidth: style.borderWidth)
        )
    }
}
