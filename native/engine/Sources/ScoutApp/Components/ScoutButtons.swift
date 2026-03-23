import SwiftUI

enum ScoutButtonTone {
    case primary
    case secondary
    case quiet
}

struct ScoutButtonStyle: ButtonStyle {
    let tone: ScoutButtonTone

    init(tone: ScoutButtonTone = .secondary) {
        self.tone = tone
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .regular))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(backgroundStyle)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(borderColor, lineWidth: tone == .primary ? 0 : 0.75)
                    )
            )
            .shadow(color: tone == .primary ? ScoutTheme.shadow.opacity(0.45) : .clear, radius: 10, y: 3)
            .opacity(configuration.isPressed ? 0.94 : 1)
    }

    private var foregroundColor: some ShapeStyle {
        switch tone {
        case .primary:
            return AnyShapeStyle(Color.white)
        case .secondary:
            return AnyShapeStyle(ScoutTheme.ink)
        case .quiet:
            return AnyShapeStyle(ScoutTheme.inkMuted)
        }
    }

    private var backgroundStyle: some ShapeStyle {
        switch tone {
        case .primary:
            return AnyShapeStyle(ScoutTheme.accent)
        case .secondary:
            return AnyShapeStyle(ScoutTheme.surfaceMuted)
        case .quiet:
            return AnyShapeStyle(configurationBackground)
        }
    }

    private var borderColor: Color {
        switch tone {
        case .primary:
            return .clear
        case .secondary:
            return ScoutTheme.border.opacity(0.65)
        case .quiet:
            return .clear
        }
    }

    private var configurationBackground: Color {
        ScoutTheme.hover
    }
}
